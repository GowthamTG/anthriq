import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAcquisitionBenchmark, windows } from '../scripts/acquisition-benchmark.mjs';
import { validateAcquisitionEvidence } from '../scripts/validate-acquisition-evidence.mjs';

test(
  'the acquisition benchmark preflights, records, verifies, and summarizes a short run',
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'scope-benchmark-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const summary = await runAcquisitionBenchmark({
      workload: 'development',
      seconds: 3,
      recordingDirectory: join(root, 'recording'),
      outputDirectory: join(root, 'evidence'),
      includeOverload: false,
    });
    assert.equal(summary.result, 'PASS');
    assert.equal(summary.target.achieved, false);
    assert.equal(summary.recording.expectedFrames, 12000);
    assert.equal(summary.recording.persistedFrames, 12000);
    assert.equal(summary.recording.lostFrames, 0);
    assert.equal(summary.verification.result, 'PASS');
    assert.equal(summary.memoryWindows.length, 3);
    assert.equal(summary.memoryComparison.equalWindowDurationSeconds, 1);
    await validateAcquisitionEvidence(join(root, 'evidence'));
  },
);

test('the benchmark requires an honest workload declaration', async () => {
  await assert.rejects(runAcquisitionBenchmark({ seconds: 3 }), /Declare --workload/);
});

test('a terminal short-run metric is included in the late memory window', () => {
  const metric = (elapsedSeconds, rssBytes) => ({
    generator: { elapsedSeconds, rssBytes, outstandingBytes: 0 },
    recorderRssBytes: rssBytes,
    queueBytes: 0,
  });
  const result = windows([metric(0.5, 10), metric(1.5, 20), metric(3.001, 30)], 3);
  assert.deepEqual(
    result.map(({ label, measurements }) => ({ label, measurements })),
    [
      { label: 'warmup', measurements: 1 },
      { label: 'middle', measurements: 1 },
      { label: 'late', measurements: 1 },
    ],
  );
  assert.equal(result[2].endSeconds, 3);
});
