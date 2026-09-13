import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Playback, PlaybackOwner } from '../core/playback.ts';

const execute = promisify(execFile);

async function recording(t, { name = 'recording', channels = 2, rate = 40, seconds = 0.2 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'scope-playback-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, name);
  await execute(process.execPath, [
    'core/cli.ts',
    'record',
    directory,
    '--channels',
    String(channels),
    '--sample-rate',
    String(rate),
    '--seconds',
    String(seconds),
  ]);
  return { root, directory };
}

function terminal(playback) {
  const state = playback.snapshot();
  if (state.status === 'ended' || state.status === 'error') return Promise.resolve(state);
  return new Promise((resolve) => {
    const unsubscribe = playback.subscribe((next) => {
      if (next.status === 'ended' || next.status === 'error') {
        unsubscribe();
        resolve(next);
      }
    });
  });
}

async function waitFor(read, predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for playback state');
}

test('native playback emits the complete selected sequence and measured 1x timing', async (t) => {
  const { directory } = await recording(t);
  const output = [];
  const emissionTimes = [];
  const started = performance.now();
  const playback = await Playback.open(directory, {
    write(frames) {
      output.push(...frames);
      emissionTimes.push(performance.now() - started);
    },
  });
  t.after(() => playback.close());

  assert.equal(playback.snapshot().status, 'paused');
  const done = terminal(playback);
  playback.play();
  const state = await done;

  assert.equal(state.status, 'ended');
  assert.deepEqual(
    output.map((frame) => frame.index),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  assert.equal(state.position, 8);
  assert.equal(state.emittedFrames, 8);
  assert.equal(state.emittedSamples, 16);
  assert.ok(state.activeElapsedMs >= 160, `playback ended too early: ${state.activeElapsedMs} ms`);
  assert.ok(state.activeElapsedMs < 1000, `playback ended too late: ${state.activeElapsedMs} ms`);
  assert.ok(
    emissionTimes.at(-1) - emissionTimes[0] >= 120,
    `observations were not paced across the native interval: ${emissionTimes}`,
  );
});

test('gaps retain timeline duration, adjacent duplicates emit once, and restart is explicit', async (t) => {
  const { directory } = await recording(t, { rate: 50, seconds: 0.16 });
  const path = join(directory, 'frames.bin');
  const frames = await readFile(path);
  const width = 16;
  await writeFile(
    path,
    Buffer.concat([
      frames.subarray(width, 2 * width),
      frames.subarray(2 * width, 3 * width),
      frames.subarray(2 * width, 3 * width),
      frames.subarray(5 * width, 6 * width),
    ]),
  );
  const output = [];
  const playback = await Playback.open(directory, { write: (batch) => output.push(...batch) });
  t.after(() => playback.close());
  let done = terminal(playback);
  playback.play();
  const ended = await done;

  assert.deepEqual(
    output.map((frame) => frame.index),
    [1, 2, 5],
  );
  assert.equal(ended.skippedDuplicateFrames, 1);
  assert.equal(ended.position, 8);
  assert.ok(ended.activeElapsedMs >= 125, `gaps were compressed: ${ended.activeElapsedMs} ms`);
  const count = output.length;
  playback.play();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(output.length, count);

  const restarted = await playback.restart();
  assert.equal(restarted.status, 'paused');
  assert.equal(restarted.position, 0);
  assert.equal(restarted.emittedFrames, 0);
  assert.equal(restarted.skippedDuplicateFrames, 0);
  done = terminal(playback);
  playback.play();
  await done;
  assert.deepEqual(
    output.slice(count).map((frame) => frame.index),
    [1, 2, 5],
  );
});

test('a slow bounded sink increases lag without dropping output', async (t) => {
  const { directory } = await recording(t, { channels: 4, rate: 100, seconds: 0.1 });
  const output = [];
  const batchSizes = [];
  const playback = await Playback.open(directory, {
    async write(batch) {
      batchSizes.push(batch.length);
      await new Promise((resolve) => setTimeout(resolve, 35));
      output.push(...batch);
    },
  });
  t.after(() => playback.close());
  const done = terminal(playback);
  playback.play();
  const state = await done;

  assert.deepEqual(
    output.map((frame) => frame.index),
    Array.from({ length: 10 }, (_, index) => index),
  );
  assert.ok(batchSizes.every((size) => size <= 256));
  assert.ok(state.maxLagMs >= 10, `slow sink lag was not exposed: ${state.maxLagMs} ms`);
  assert.equal(state.emittedSamples, 40);
});

test('a rejected sink reports error without committing the rejected batch', async (t) => {
  const { directory } = await recording(t, { rate: 50, seconds: 0.08 });
  const playback = await Playback.open(directory, {
    write() {
      throw new Error('test sink refused batch');
    },
  });
  t.after(() => playback.close());
  const done = terminal(playback);
  playback.play();
  const state = await done;

  assert.equal(state.status, 'error');
  assert.equal(state.position, 0);
  assert.equal(state.emittedFrames, 0);
  assert.ok(state.activeElapsedMs > 0);
  assert.match(state.error, /test sink refused batch/);
});

test('the owner keeps one session, makes same-recording open idempotent, and drains replacement', async (t) => {
  const first = await recording(t, { name: 'first', rate: 50, seconds: 0.3 });
  const secondDirectory = join(first.root, 'second');
  await execute(process.execPath, [
    'core/cli.ts',
    'record',
    secondDirectory,
    '--channels',
    '2',
    '--sample-rate',
    '50',
    '--seconds',
    '0.1',
  ]);
  const output = [];
  const owner = new PlaybackOwner(first.root, {
    async write(batch) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      output.push(...batch);
    },
  });
  t.after(() => owner.shutdown());
  await Promise.all([owner.open('first'), owner.open('second')]);
  assert.equal(owner.snapshot().recordingId, 'second', 'the latest overlapping open must win');
  await owner.open('first');
  await owner.control('first', 'play');
  await waitFor(
    () => owner.snapshot(),
    (state) => state.emittedFrames > 0,
  );
  const before = owner.snapshot();
  assert.equal((await owner.open('first')).emittedFrames, before.emittedFrames);

  const replacement = await owner.open('second');
  assert.equal(replacement.recordingId, 'second');
  assert.equal(replacement.status, 'paused');
  const count = output.length;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(output.length, count, 'the replaced session emitted after replacement completed');
  await assert.rejects(owner.control('first', 'play'), /not the active playback session/);
});

test('opening an incomplete replacement leaves the valid owner session unchanged', async (t) => {
  const first = await recording(t, { name: 'valid' });
  const invalid = join(first.root, 'invalid');
  await execute(process.execPath, [
    'core/cli.ts',
    'record',
    invalid,
    '--channels',
    '2',
    '--sample-rate',
    '40',
    '--seconds',
    '0.1',
  ]);
  const metadataPath = join(invalid, 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  await writeFile(
    metadataPath,
    JSON.stringify({ ...metadata, status: 'failed', expectedFrames: null, duration: null }),
  );
  const owner = new PlaybackOwner(first.root);
  t.after(() => owner.shutdown());
  await owner.open('valid');
  await assert.rejects(owner.open('invalid'), /Only finalized recordings/);
  assert.equal(owner.snapshot().recordingId, 'valid');
  assert.equal(owner.snapshot().status, 'paused');
});

test('the CLI optionally streams accepted playback frames and reports final metrics', async (t) => {
  const { directory } = await recording(t, { rate: 20, seconds: 0.1 });
  const result = await execute(process.execPath, [
    'core/cli.ts',
    'playback',
    directory,
    '--output',
    'jsonl',
  ]);
  const frames = result.stdout.trim().split('\n').map(JSON.parse);
  const state = JSON.parse(result.stderr.trim());
  assert.deepEqual(
    frames.map((frame) => frame.index),
    [0, 1],
  );
  assert.equal(state.status, 'ended');
  assert.equal(state.position, 2);
  assert.equal(state.emittedFrames, 2);
  assert.equal(state.emittedSamples, 4);
  await assert.rejects(
    execute(process.execPath, ['core/cli.ts', 'playback', directory, '--speed', '2']),
    /Unknown playback option: speed/,
  );
});
