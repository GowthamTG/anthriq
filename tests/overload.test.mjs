import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execute = promisify(execFile);
const cli = (...args) => execute(process.execPath, ['core/cli.ts', ...args], { timeout: 15000 });

test('temporary recorder stall drops exact intervals and recovers on the original clock', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scope-overload-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'recovery');
  const began = performance.now();
  await cli('record', directory, '--seconds', '4', '--buffer-bytes', '8192', '--stall-after-seconds', '0.5', '--stall-for-ms', '2000');
  assert.ok(performance.now() - began >= 3950);
  const saved = JSON.parse((await cli('inspect', directory)).stdout);
  const data = await readFile(join(directory, 'frames.bin'));
  const losses = (await readFile(join(directory, 'losses.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  const indices = Array.from({ length: data.length / 136 }, (_, i) => Number(data.readBigUInt64LE(i * 136)));
  let next = 0;
  const gaps = [];
  for (const index of indices) {
    assert.ok(index >= next, 'no duplicate or reordered positions');
    if (index > next) gaps.push([next, index]);
    next = index + 1;
  }
  if (next < 16000) gaps.push([next, 16000]);
  assert.equal(saved.status, 'completed');
  assert.equal(saved.expectedFrames, 16000);
  assert.ok(saved.droppedFrames > 0);
  assert.equal(saved.recordedFrames + saved.droppedFrames, 16000);
  assert.equal(saved.generator.emittedFrames, indices.length);
  assert.equal(saved.generator.droppedFrames, saved.droppedFrames);
  assert.deepEqual(losses.map(x => [x.startFrame, x.endFrameExclusive]), gaps);
  for (const gap of losses) {
    assert.equal(gap.frames, gap.endFrameExclusive - gap.startFrame);
    assert.equal(gap.samples, gap.frames * 32);
    assert.equal(gap.cause, 'bounded transport exhausted');
  }
  assert.ok(indices.at(-1) >= 15900, 'recorder resumes near the end of the original timeline');
  assert.ok(indices.filter(i => i >= 12000).length > 3500, 'last second recovers useful throughput');
  assert.ok(saved.peakQueueBytes <= 8192);
  assert.ok(saved.generator.peakOutstandingBytes <= 8192);
  assert.ok(saved.generator.peakOutstandingBytes > 0);
  assert.equal(saved.generator.emissionDeficitFrames, saved.droppedFrames);
  assert.ok(Number.isFinite(saved.generator.maxEmissionGapMs));
  assert.ok(saved.generator.peakRssBytes > 0);
  assert.ok(saved.recorderPeakRssBytes > 0);
  const telemetry = (await readFile(join(directory, 'metrics.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(telemetry.some(m => m.recorderStall === 'active' && m.generator.emissionRateFramesPerSecond === 0));
  assert.ok(telemetry.some(m => m.recorderStall === 'recovered' && m.generator.emissionRateFramesPerSecond > 0));
  for (const m of telemetry) {
    assert.ok(m.queueBytes <= 8192);
    if (m.generator.outstandingBytes !== undefined) assert.ok(m.generator.outstandingBytes <= 8192);
  }
});

test('a stall lasting past source completion accounts for trailing loss', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scope-tail-loss-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'tail');
  await cli('record', directory, '--seconds', '0.5', '--sample-rate', '200', '--buffer-bytes', '4096', '--stall-for-ms', '1000');
  const saved = JSON.parse((await cli('inspect', directory)).stdout);
  const data = await readFile(join(directory, 'frames.bin'));
  const losses = (await readFile(join(directory, 'losses.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(saved.status, 'completed');
  assert.equal(saved.expectedFrames, 100);
  assert.ok(saved.recordedFrames <= 30, 'no credit returns before the stalled batch is written');
  assert.equal(saved.recordedFrames + saved.droppedFrames, 100);
  assert.equal(losses.at(-1).startFrame, Number(data.readBigUInt64LE(data.length - 136)) + 1);
  assert.equal(losses.at(-1).endFrameExclusive, 100);
  assert.equal(saved.generator.emittedFrames, saved.recordedFrames);
  assert.ok(saved.generator.peakOutstandingBytes <= 4096);
  assert.ok(saved.peakQueueBytes <= 4096);
});

test('invalid diagnostic controls fail before recording allocation', async () => {
  for (const options of [['--stall-for-ms', '5001'], ['--stall-for-ms', '-1'], ['--stall-after-seconds', '-1']]) {
    await assert.rejects(cli('record', '/unused-scope-invalid-diagnostic', ...options), error => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Stall|stall/);
      return true;
    });
  }
});
