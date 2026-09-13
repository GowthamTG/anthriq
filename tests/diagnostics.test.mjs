import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiagnosticScenario } from '../core/diagnostics.ts';
import { inspect } from '../core/storage.ts';
import { verifyRecording } from '../core/verify.ts';

const execute = promisify(execFile);

async function source(t) {
  const root = await mkdtemp(join(tmpdir(), 'scope-diagnostics-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'source-recording');
  await execute(process.execPath, ['core/cli.ts', 'record', directory, '--channels', '2', '--sample-rate', '8', '--seed', '0', '--seconds', '0.125', '--display-name', 'Diagnostic source']);
  await verifyRecording(directory);
  return { root, directory };
}

async function evidence(directory) {
  return Promise.all(['metadata.json', 'frames.bin', 'verification.json'].map(name => readFile(join(directory, name))));
}

test('a clean diagnostic recording passes without changing its source recording or verification report', async t => {
  const { root, directory } = await source(t);
  const before = await evidence(directory);
  const id = await createDiagnosticScenario(root, 'source-recording', 'clean');
  const recording = await inspect(join(root, id));
  const report = await verifyRecording(join(root, id));

  assert.match(id, /^diagnostic-clean-[a-f0-9-]{36}$/);
  assert.equal(recording.diagnostic?.scenario, 'clean');
  assert.equal(recording.diagnostic?.sourceRecordingId, 'source-recording');
  assert.equal(recording.expectedFrames, 8);
  assert.equal(recording.recordedFrames, 8);
  assert.equal(recording.fileBytes, 128);
  assert.equal(report.result, 'PASS');
  assert.deepEqual(report.discrepancies, {
    missing: { samples: 0, first: null },
    duplicated: { samples: 0, first: null },
    incorrect: { samples: 0, first: null },
  });
  assert.deepEqual(await evidence(directory), before);
});

test('a duplicate diagnostic counts every channel and preserves the first physical ordinal', async t => {
  const { root } = await source(t);
  const id = await createDiagnosticScenario(root, 'source-recording', 'duplicate');
  const report = await verifyRecording(join(root, id));

  assert.equal(report.result, 'FAIL');
  assert.deepEqual(report.discrepancies.duplicated, { samples: 2, first: { frame: 1, channel: 0, physicalOrdinal: 2 } });
  assert.equal(report.discrepancies.missing.samples, 0);
  assert.equal(report.discrepancies.incorrect.samples, 0);
  assert.equal(report.formatErrors.count, 1);
});

test('an incorrect diagnostic exposes one finite and one nonfinite scalar value', async t => {
  const { root } = await source(t);
  const id = await createDiagnosticScenario(root, 'source-recording', 'incorrect');
  const report = await verifyRecording(join(root, id));

  assert.equal(report.result, 'FAIL');
  assert.deepEqual(report.discrepancies.incorrect, {
    samples: 2,
    first: { frame: 2, channel: 0, physicalOrdinal: 2, expected: 0.11999999731779099, actual: 99 },
  });
  assert.equal(report.discrepancies.missing.samples, 0);
  assert.equal(report.discrepancies.duplicated.samples, 0);
  assert.equal(report.formatErrors.count, 0);
});

test('a combined diagnostic keeps missing, duplicate, and incorrect classifications separate', async t => {
  const { root, directory } = await source(t);
  const before = await evidence(directory);
  const id = await createDiagnosticScenario(root, 'source-recording', 'combined');
  const report = await verifyRecording(join(root, id));

  assert.equal(report.result, 'FAIL');
  assert.deepEqual(report.discrepancies.missing, { samples: 6, first: { frame: 0, channel: 0 } });
  assert.deepEqual(report.discrepancies.duplicated, { samples: 2, first: { frame: 1, channel: 0, physicalOrdinal: 1 } });
  assert.deepEqual(report.discrepancies.incorrect, {
    samples: 2,
    first: { frame: 1, channel: 0, physicalOrdinal: 1, expected: -0.4000000059604645, actual: 7 },
  });
  assert.equal(report.formatErrors.count, 1);
  assert.match(report.formatErrors.first, /recorded and lost frame counts/i);
  assert.deepEqual(await evidence(directory), before);
});

test('the missing diagnostic exposes initial, interior, and trailing loss from the independent extent', async t => {
  const { root, directory } = await source(t);
  const before = await evidence(directory);
  const id = await createDiagnosticScenario(root, 'source-recording', 'missing');
  const report = await verifyRecording(join(root, id));

  assert.equal(report.result, 'FAIL');
  assert.deepEqual(report.counts, { expectedFrames: 8, expectedSamples: 16, recordedFrames: 4, recordedSamples: 8 });
  assert.deepEqual(report.discrepancies.missing, { samples: 8, first: { frame: 0, channel: 0 } });
  assert.equal(report.discrepancies.duplicated.samples, 0);
  assert.equal(report.discrepancies.incorrect.samples, 0);
  assert.equal(report.formatErrors.count, 0);
  assert.deepEqual(await evidence(directory), before);
});

test('diagnostic creation validates its inputs, refuses diagnostic chaining, and produces unique bundles', async t => {
  const { root, directory } = await source(t);
  await assert.rejects(createDiagnosticScenario(root, 'source-recording', 'unknown'), error => error.statusCode === 400);
  await assert.rejects(createDiagnosticScenario(root, '../source-recording', 'clean'), error => error.statusCode === 404);

  const first = await createDiagnosticScenario(root, 'source-recording', 'clean');
  const second = await createDiagnosticScenario(root, 'source-recording', 'clean');
  assert.notEqual(first, second);
  await assert.rejects(createDiagnosticScenario(root, first, 'missing'), error => error.statusCode === 409);

  const raw = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
  await writeFile(join(directory, 'metadata.json'), JSON.stringify({ ...raw, status: 'recording', expectedFrames: null, duration: null }));
  await assert.rejects(createDiagnosticScenario(root, 'source-recording', 'clean'), error => error.statusCode === 409);
  assert.equal((await readdir(root)).some(name => name.startsWith('.scope-diagnostic-')), false);
});

test('diagnostic provenance is rejected when its version or scenario is not recognized', async t => {
  const { root } = await source(t);
  const id = await createDiagnosticScenario(root, 'source-recording', 'clean');
  const path = join(root, id, 'metadata.json');
  const raw = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...raw, diagnostic: { ...raw.diagnostic, scenario: 'mystery' } }));
  await assert.rejects(inspect(join(root, id)), /Invalid diagnostic provenance/);
});
