import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import {
  comparePlatformContext,
  runLongRecordingEvidence,
} from '../scripts/long-recording-evidence.mjs';
import { validateLongRecordingEvidence } from '../scripts/validate-long-recording-evidence.mjs';

const execute = promisify(execFile);

async function fixture(t, name = 'recording') {
  const root = await mkdtemp(join(tmpdir(), 'scope-t16-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, name);
  await execute(process.execPath, [
    'core/cli.ts',
    'record',
    directory,
    '--channels',
    '32',
    '--sample-rate',
    '100',
    '--seconds',
    '3',
    '--seed',
    '42',
  ]);
  return { root, directory };
}

test(
  'short T16 reproduction checks retrieval, export, playback, transitions, and verification',
  {
    timeout: 15_000,
  },
  async (t) => {
    const { root, directory } = await fixture(t);
    const output = join(root, 'evidence');
    const summary = await runLongRecordingEvidence({
      recording: directory,
      workload: 'development',
      outputDirectory: output,
      evidenceProfile: 'test',
    });

    assert.equal(summary.result, 'PASS');
    assert.equal(summary.retrieval.length, 6);
    assert.ok(summary.retrieval.every((item) => item.measured.length === 5));
    assert.ok(
      summary.retrieval.every((item) => item.measured[0].metrics.maximumReadBytes <= 65536),
    );
    assert.equal(summary.export.rows, 300);
    assert.equal(summary.export.metrics.recordsDecoded, 300);
    assert.equal(summary.export.consumerPauses, Math.floor(300 / 32));
    assert.deepEqual(
      summary.export.memoryWindows.map((window) => window.label),
      ['early', 'middle', 'late'],
    );
    assert.ok(summary.export.memoryWindows.every((window) => window.measurements > 0));
    assert.deepEqual(
      summary.playback.cases.map((item) => item.speed),
      [1, 2],
    );
    assert.ok(summary.playback.cases.every((item) => item.withinEngineeringTolerance));
    assert.equal(summary.playback.transitions.pausedTimeExcluded, true);
    assert.equal(summary.playback.transitions.noStaleOutputAfterSeek, true);
    assert.equal(summary.playback.slowSink.noDroppedOrDuplicatedOutput, true);
    assert.ok(summary.playback.slowSink.maximumLagMs > 0);
    assert.equal(summary.verification.recordsScanned, 300);
    assert.equal(summary.verification.result, 'PASS');
    await validateLongRecordingEvidence(output);
    assert.ok((await readFile(join(output, 'measurements.jsonl'), 'utf8')).trim());
  },
);

test(
  'the harness fails before writing a false PASS when independent value checks fail',
  {
    timeout: 10_000,
  },
  async (t) => {
    const { root, directory } = await fixture(t, 'corrupt');
    const frames = await open(join(directory, 'frames.bin'), 'r+');
    try {
      const changed = Buffer.alloc(4);
      changed.writeFloatLE(123.5);
      await frames.write(changed, 0, changed.length, 8 + 31 * 4);
    } finally {
      await frames.close();
    }
    const output = join(root, 'failed-evidence');
    await assert.rejects(
      runLongRecordingEvidence({
        recording: directory,
        workload: 'development',
        outputDirectory: output,
        evidenceProfile: 'test',
      }),
      /incorrect value/,
    );
    await assert.rejects(readFile(join(output, 'summary.json')), /ENOENT/);
  },
);

test('the harness requires an absolute recording and an honest workload declaration', async () => {
  await assert.rejects(
    runLongRecordingEvidence({ recording: 'recordings/example', workload: 'quiet' }),
    /absolute path/,
  );
  await assert.rejects(
    runLongRecordingEvidence({ recording: '/tmp/example' }),
    /workload is required/,
  );
});

test('platform comparison requires every recorded measurement-context field to match', () => {
  const recorded = {
    platform: 'darwin',
    release: '25.6.0',
    architecture: 'arm64',
    cpu: 'Example CPU',
    logicalCpuCount: 8,
    totalMemoryBytes: 16_000,
    node: 'v24.0.0',
  };
  assert.equal(comparePlatformContext(recorded, { ...recorded }).matched, true);
  const mismatch = comparePlatformContext(recorded, { ...recorded, architecture: 'x64' });
  assert.equal(mismatch.matched, false);
  assert.equal(mismatch.fields.architecture.matched, false);
});
