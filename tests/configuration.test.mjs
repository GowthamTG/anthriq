import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
const cli = (...args) => execute(process.execPath, ['core/cli.ts', ...args], { timeout: 10000 });

test('unknown acquisition options fail before creating a recording', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scope-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    cli('record', join(root, 'invalid'), '--seconds', '0.01', '--channelz', '8'),
    (error) => {
      assert.match(error.stderr, /Unknown.*channelz/i);
      assert.equal(error.code, 1);
      return true;
    },
  );
  assert.deepEqual(await readdir(root), []);
});

test('a missing CLI value cannot silently turn a timed capture into continuous capture', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scope-missing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    cli('record', join(root, 'invalid'), '--seconds', '0.01', '--display-name'),
    (error) => {
      assert.match(error.stderr, /Missing value for --display-name/);
      return true;
    },
  );
  assert.deepEqual(await readdir(root), []);
});

test('invalid numeric inputs and unsafe timed extents are rejected before allocation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scope-bounds-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const invalid = [
    ['channels', '0'],
    ['channels', '257'],
    ['channels', '1.5'],
    ['sample-rate', '0'],
    ['sample-rate', '100001'],
    ['sample-rate', 'Infinity'],
    ['seed', '-1'],
    ['seed', '2147483648'],
    ['seed', 'NaN'],
    ['buffer-bytes', '4095'],
    ['buffer-bytes', '67108865'],
    ['seconds', '-1'],
    ['seconds', '1e300'],
    ['seed', ''],
  ];
  for (const [key, value] of invalid) {
    const args = key === 'seconds' ? [] : ['--seconds', '0.01'];
    await assert.rejects(cli('record', join(root, `invalid-${key}`), ...args, `--${key}`, value), {
      code: 1,
    });
  }
  assert.deepEqual(await readdir(root), []);
});

test('two nondefault timed acquisitions retain their settings, names, and independently checked values', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scope-custom-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    {
      channels: 8,
      rate: 1000,
      seed: 7,
      seconds: 0.5,
      frames: 500,
      values: [
        [0, 0, -0.8278760313987732],
        [499, 7, 0.6293341517448425],
      ],
    },
    {
      channels: 3,
      rate: 200,
      seed: 123,
      seconds: 0.25,
      frames: 50,
      values: [
        [0, 2, 0.31989040970802307],
        [49, 2, -0.780164361000061],
      ],
    },
  ];
  for (const fixture of cases) {
    const directory = join(root, `channels-${fixture.channels}`);
    const displayName = `Bench ${fixture.channels}`;
    await cli(
      'record',
      directory,
      '--channels',
      String(fixture.channels),
      '--sample-rate',
      String(fixture.rate),
      '--seed',
      String(fixture.seed),
      '--seconds',
      String(fixture.seconds),
      '--display-name',
      displayName,
    );
    const metadata = JSON.parse((await cli('inspect', directory)).stdout);
    assert.equal(metadata.displayName, displayName);
    assert.equal(metadata.channels, fixture.channels);
    assert.equal(metadata.sampleRate, fixture.rate);
    assert.equal(metadata.seed, fixture.seed);
    assert.equal(metadata.seconds, fixture.seconds);
    assert.equal(metadata.expectedFrames, fixture.frames);
    assert.equal(metadata.recordedFrames, fixture.frames);
    assert.equal(metadata.totalSamples, fixture.frames * fixture.channels);
    assert.equal(metadata.waveform, 'triangle-modulated-v1');
    const bytes = await readFile(join(directory, 'frames.bin'));
    for (const [frame, channel, expected] of fixture.values) {
      assert.equal(
        bytes.readFloatLE(frame * (8 + 4 * fixture.channels) + 8 + 4 * channel),
        expected,
      );
    }
    const report = JSON.parse((await cli('verify', directory)).stdout);
    assert.equal(report.result, 'PASS');
  }
});

test('an unknown waveform version is rejected instead of silently verified with the current formula', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scope-waveform-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'fixture');
  await cli('record', directory, '--seconds', '0.01');
  const path = join(directory, 'metadata.json');
  const metadata = JSON.parse(await readFile(path, 'utf8'));
  metadata.waveform = 'unknown-v2';
  await writeFile(path, JSON.stringify(metadata));
  await assert.rejects(cli('inspect', directory), (error) => {
    assert.match(error.stderr, /Unsupported waveform/);
    return true;
  });
  await assert.rejects(cli('verify', directory), (error) => {
    assert.equal(error.code, 1);
    assert.match(JSON.parse(error.stdout).formatErrors.first, /Unsupported waveform/);
    return true;
  });
});
