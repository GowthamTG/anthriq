import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { appendFile, chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRecording } from '../core/verify.ts';

const execute = promisify(execFile);
const cli = (...args) => execute(process.execPath, ['core/cli.ts', ...args], { timeout: 10000 });
const values = [-0.9200000166893005, -0.4000000059604645, 0.11999999731779099, 0.4000000059604645, 0.6800000071525574, 0.4000000059604645, 0.11999999731779099, -0.4000000059604645];

async function fixture(t, records = values.map((value, index) => ({ index, value })), update = {}) {
  const root = await mkdtemp(join(tmpdir(), 'scope-verify-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'fixture');
  await mkdir(directory);
  const frames = Buffer.alloc(records.length * 12);
  records.forEach(({ index, value }, ordinal) => {
    frames.writeBigUInt64LE(BigInt(index), ordinal * 12);
    frames.writeFloatLE(value, ordinal * 12 + 8);
  });
  await writeFile(join(directory, 'frames.bin'), frames);
  await writeFile(join(directory, 'metadata.json'), JSON.stringify({
    format: 'SCOPE/1', waveform: 'triangle-modulated-v1', id: 'fixture', displayName: 'Independent fixture',
    status: 'completed', startedAt: '2026-09-13T00:00:00.000Z', stoppedAt: '2026-09-13T00:00:01.000Z',
    channels: 1, sampleRate: 8, seed: 0, bufferBytes: 4096, seconds: 1, writeDelayMs: 0,
    stallAfterSeconds: 0, stallForMs: 0, expectedFrames: 8, recordedFrames: records.length,
    totalSamples: records.length, droppedFrames: 8 - records.length, duration: 1,
    sampleType: 'float32', bytesPerSample: 4, byteOrder: 'little-endian',
    recordBytes: 12, layout: 'uint64 frame index, then interleaved channel values',
    ...update,
  }));
  return directory;
}

test('CLI verification streams an independent clean fixture and persists its checked file identity', async t => {
  const directory = await fixture(t);
  const { stdout } = await cli('verify', directory);
  const report = JSON.parse(stdout);
  assert.equal(report.format, 'SCOPE-VERIFICATION/1');
  assert.equal(report.result, 'PASS');
  assert.deepEqual(report.counts, { expectedFrames: 8, expectedSamples: 8, recordedFrames: 8, recordedSamples: 8 });
  assert.deepEqual(report.discrepancies, {
    missing: { samples: 0, first: null },
    duplicated: { samples: 0, first: null },
    incorrect: { samples: 0, first: null },
  });
  assert.deepEqual(report.formatErrors, { count: 0, first: null });
  assert.equal(report.checkedFiles.frames.size, 96);
  assert.match(report.checkedFiles.frames.mtimeNs, /^\d+$/);
  assert.ok(report.execution.elapsedMs >= 0);
  assert.equal(report.execution.bytesScanned, 96);
  assert.ok(report.execution.peakRssBytes > 0);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'verification.json'), 'utf8')), report);
});

test('verification exposes bounded latest-value progress with an initial and terminal snapshot', async t => {
  const directory = await fixture(t);
  const updates = [];
  await verifyRecording(directory, { onProgress: progress => updates.push(progress) });
  assert.equal(updates.length, 2);
  assert.deepEqual([updates[0].recordsScanned, updates[0].percent], [0, 0]);
  assert.deepEqual([updates[1].recordsScanned, updates[1].percent], [8, 100]);
  assert.ok(updates.every(update => update.totalRecords === 8 && update.totalBytes === 96));
});

test('verification counts initial, interior, and trailing missing samples from the independent extent', async t => {
  const records = [1, 2, 4, 5].map(index => ({ index, value: values[index] }));
  const directory = await fixture(t, records, { droppedFrames: 4 });
  await assert.rejects(cli('verify', directory), error => {
    assert.equal(error.code, 1);
    const report = JSON.parse(error.stdout);
    assert.equal(report.result, 'FAIL');
    assert.deepEqual(report.discrepancies.missing, { samples: 4, first: { frame: 0, channel: 0 } });
    assert.equal(report.discrepancies.duplicated.samples, 0);
    assert.equal(report.discrepancies.incorrect.samples, 0);
    return true;
  });
});

test('duplicates and incorrect values overlap while keeping their first physical positions', async t => {
  const records = values.map((value, index) => ({ index, value }));
  records.splice(2, 0, { index: 1, value: 99 });
  records[5] = { index: 4, value: Number.NaN };
  const directory = await fixture(t, records, { recordedFrames: 9, totalSamples: 9, droppedFrames: 0 });
  await assert.rejects(cli('verify', directory), error => {
    assert.equal(error.code, 1);
    const report = JSON.parse(error.stdout);
    assert.deepEqual(report.discrepancies.duplicated, { samples: 1, first: { frame: 1, channel: 0, physicalOrdinal: 2 } });
    assert.equal(report.discrepancies.incorrect.samples, 2);
    assert.deepEqual(report.discrepancies.incorrect.first, { frame: 1, channel: 0, physicalOrdinal: 2, expected: values[1], actual: 99 });
    return true;
  });
});

test('combined corruption keeps missing, duplicate, and incorrect classes distinct', async t => {
  const records = [
    { index: 1, value: values[1] },
    { index: 1, value: 7 },
    { index: 3, value: Number.POSITIVE_INFINITY },
    { index: 4, value: values[4] },
    { index: 5, value: values[5] },
    { index: 6, value: values[6] },
  ];
  const directory = await fixture(t, records, { recordedFrames: 6, totalSamples: 6, droppedFrames: 2 });
  await assert.rejects(cli('verify', directory), error => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.discrepancies.missing.samples, 3);
    assert.equal(report.discrepancies.duplicated.samples, 1);
    assert.equal(report.discrepancies.incorrect.samples, 2);
    assert.equal(report.discrepancies.incorrect.first.actual, 7);
    return true;
  });
});

test('format failures produce reports, while malformed record identity suppresses invented totals', async t => {
  const invalidMetadata = await fixture(t);
  await writeFile(join(invalidMetadata, 'metadata.json'), '{bad json');
  await assert.rejects(cli('verify', invalidMetadata), error => {
    assert.equal(error.code, 1);
    const report = JSON.parse(error.stdout);
    assert.match(report.formatErrors.first, /Invalid metadata JSON/);
    assert.equal(report.counts.expectedFrames, null);
    assert.equal(report.discrepancies.missing.samples, null);
    return true;
  });

  const decreasing = await fixture(t, [0, 2, 1, 3].map(index => ({ index, value: values[index] })), { recordedFrames: 4, totalSamples: 4, droppedFrames: 4 });
  await assert.rejects(cli('verify', decreasing), error => {
    const report = JSON.parse(error.stdout);
    assert.match(report.formatErrors.first, /Decreasing frame index/);
    assert.equal(report.discrepancies.missing.samples, null);
    assert.equal(report.discrepancies.duplicated.samples, null);
    assert.equal(report.discrepancies.incorrect.samples, null);
    return true;
  });
});

test('partial records and unconfirmed extent fail explicitly without treating a readable prefix as verified', async t => {
  const directory = await fixture(t, values.slice(0, 4).map((value, index) => ({ index, value })), { expectedFrames: null, duration: null, recordedFrames: 4, totalSamples: 4, droppedFrames: 0 });
  await appendFile(join(directory, 'frames.bin'), Buffer.from([1, 2, 3]));
  await assert.rejects(cli('verify', directory), error => {
    const report = JSON.parse(error.stdout);
    assert.ok(report.formatErrors.count >= 2);
    assert.match(JSON.stringify(report), /unconfirmed/i);
    assert.equal(report.discrepancies.missing.samples, null);
    assert.equal(report.counts.recordedFrames, 4);
    return true;
  });
});

test('unknown metadata versions and count, duration, layout, and lifecycle contradictions are reportable format failures', async t => {
  const changes = [
    [{ waveform: 'triangle-v99' }, /Unsupported waveform/],
    [{ totalSamples: 7 }, /scalar count/i],
    [{ duration: 99 }, /duration/i],
    [{ recordedFrames: 7 }, /record count/i],
    [{ recordBytes: 16 }, /layout/i],
    [{ status: 'failed' }, /not completed/i],
  ];
  for (const [update, expected] of changes) {
    const directory = await fixture(t, undefined, update);
    await assert.rejects(cli('verify', directory), error => {
      assert.equal(error.code, 1);
      assert.match(JSON.parse(error.stdout).formatErrors.first, expected);
      return true;
    });
  }
});

test('unsafe and out-of-extent frame identities fail without precise discrepancy claims', async t => {
  const unsafe = await fixture(t);
  const bytes = await readFile(join(unsafe, 'frames.bin'));
  bytes.writeBigUInt64LE(9007199254740992n, 0);
  await writeFile(join(unsafe, 'frames.bin'), bytes);
  await assert.rejects(cli('verify', unsafe), error => {
    const report = JSON.parse(error.stdout);
    assert.match(report.formatErrors.first, /Unsafe frame index/);
    assert.equal(report.discrepancies.missing.samples, null);
    assert.equal(report.discrepancies.incorrect.samples, null);
    return true;
  });

  const outside = await fixture(t, [{ index: 0, value: values[0] }, { index: 8, value: values[0] }], { recordedFrames: 2, totalSamples: 2, droppedFrames: 6 });
  await assert.rejects(cli('verify', outside), error => {
    const report = JSON.parse(error.stdout);
    assert.match(report.formatErrors.first, /outside expected extent/);
    assert.equal(report.discrepancies.missing.samples, null);
    return true;
  });
});

test('invocation and operational failures exit 2 without a false report', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scope-verify-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(cli('verify', join(root, 'missing')), error => {
    assert.equal(error.code, 2);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /ENOENT/);
    return true;
  });
  await assert.rejects(cli('verify'), error => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /directory is required/i);
    return true;
  });
});

test('inspection marks a saved result stale after frame state changes and a rerun replaces it', async t => {
  const directory = await fixture(t);
  await cli('verify', directory);
  assert.equal(JSON.parse((await cli('inspect', directory)).stdout).verification.status, 'verified');
  await appendFile(join(directory, 'frames.bin'), Buffer.from([1]));
  assert.equal(JSON.parse((await cli('inspect', directory)).stdout).verification.status, 'stale');
  await assert.rejects(cli('verify', directory), error => {
    assert.equal(error.code, 1);
    return true;
  });
  assert.equal(JSON.parse((await cli('inspect', directory)).stdout).verification.status, 'integrity-failed');
});

test('atomic metadata replacement also makes a saved verification stale', async t => {
  const directory = await fixture(t);
  await cli('verify', directory);
  const metadataPath = join(directory, 'metadata.json');
  const replacement = join(directory, 'metadata-next.json');
  await writeFile(replacement, await readFile(metadataPath));
  await rename(replacement, metadataPath);
  const inspection = JSON.parse((await cli('inspect', directory)).stdout);
  assert.equal(inspection.verification.status, 'stale');
  assert.match(inspection.warnings.join(' '), /verification.*stale/i);
});

test('a report persistence failure exits 2 and leaves no false saved result', async t => {
  const directory = await fixture(t);
  await chmod(directory, 0o555);
  try {
    await assert.rejects(cli('verify', directory), error => {
      assert.equal(error.code, 2);
      assert.equal(error.stdout, '');
      return true;
    });
  } finally { await chmod(directory, 0o700); }
  await assert.rejects(readFile(join(directory, 'verification.json')), { code: 'ENOENT' });
});
