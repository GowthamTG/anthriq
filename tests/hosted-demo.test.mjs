import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../core/config.ts';
import {
  hideHostedLocation,
  prunePublicDemoRecordings,
  RollingWindowLimit,
  serverRuntime,
  validatePublicDemoSettings,
} from '../core/hosted-demo.ts';

test('runtime defaults to loopback and public mode requires an explicit public bind', () => {
  assert.deepEqual(serverRuntime({}), {
    hostname: '127.0.0.1',
    publicDemo: false,
    info: {
      mode: 'local',
      storage: 'local-filesystem',
      limits: null,
      availability: 'local',
    },
  });
  assert.throws(() => serverRuntime({ SCOPE_DEMO_MODE: 'public' }), /SCOPE_HOST=0\.0\.0\.0/);
  assert.equal(
    serverRuntime({ SCOPE_DEMO_MODE: 'public', SCOPE_HOST: '0.0.0.0' }).info.mode,
    'public-demo',
  );
  assert.throws(() => serverRuntime({ SCOPE_DEMO_MODE: 'preview' }), /must be public/);
});

test('public demo settings are timed, bounded, and cannot enable recorder diagnostics', () => {
  assert.doesNotThrow(() => validatePublicDemoSettings(config({ seconds: 3 })));
  for (const input of [
    { seconds: 0 },
    { seconds: 6 },
    { seconds: 3, channels: 33 },
    { seconds: 3, sampleRate: 4001 },
    { seconds: 3, bufferBytes: 8 * 1024 * 1024 },
    { seconds: 3, stallForMs: 1 },
    { seconds: 3, stallAfterSeconds: 1 },
    { seconds: 3, writeDelayMs: 1 },
  ])
    assert.throws(
      () => validatePublicDemoSettings(config(input)),
      (error) => {
        assert.equal(error.statusCode, 400);
        assert.ok(error.fields);
        return true;
      },
    );
});

test('rolling limits expose a stable retry interval and recover after their window', () => {
  const limit = new RollingWindowLimit(2, 1_000);
  limit.take(100);
  limit.take(200);
  assert.throws(
    () => limit.take(500),
    (error) => {
      assert.equal(error.statusCode, 429);
      assert.equal(error.retryAfterSeconds, 1);
      return true;
    },
  );
  assert.doesNotThrow(() => limit.take(1_101));
});

test('hosted inspection responses omit filesystem locations', () => {
  const result = hideHostedLocation({ location: '/private/data', id: 'recording' });
  assert.equal('location' in result, false);
});

const metadata = (id, startedAt) => ({
  format: 'SCOPE/1',
  id,
  status: 'completed',
  startedAt,
  stoppedAt: startedAt,
  expectedFrames: 0,
  recordedFrames: 0,
  totalSamples: 0,
  duration: 0,
  channels: 1,
  sampleRate: 1,
  seed: 42,
  bufferBytes: 4096,
  seconds: 0,
  writeDelayMs: 0,
  stallAfterSeconds: 0,
  stallForMs: 0,
  displayName: '',
  sampleType: 'float32',
  bytesPerSample: 4,
  byteOrder: 'little-endian',
  layout: 'uint64 frame index, then interleaved channel values',
  waveform: 'triangle-modulated-v1',
  recordBytes: 12,
  droppedFrames: 0,
});

async function recording(root, id, startedAt) {
  const directory = join(root, id);
  await mkdir(directory);
  await writeFile(join(directory, 'metadata.json'), JSON.stringify(metadata(id, startedAt)));
  await writeFile(join(directory, 'frames.bin'), '');
}

test('retention removes only the oldest unprotected recording inside its root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scope-public-retention-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await recording(root, 'oldest', '2026-01-01T00:00:00.000Z');
  await recording(root, 'protected', '2026-01-02T00:00:00.000Z');
  await recording(root, 'newest', '2026-01-03T00:00:00.000Z');
  assert.deepEqual(await prunePublicDemoRecordings(root, new Set(['protected']), 3), ['oldest']);
  assert.deepEqual((await readdir(root)).sort(), ['newest', 'protected']);
});
