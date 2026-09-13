import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execute = promisify(execFile);
const cli = (...args) => execute(process.execPath, ['core/cli.ts', ...args], { timeout: 10000 });
const { csvHeader, csvLines, csvRow } = await import('../core/export.ts');

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scope-range-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'fixture');
  await cli('record', directory, '--channels', '4', '--sample-rate', '100', '--seconds', '0.1');
  return directory;
}

test('retrieve uses half-open index/time ranges and preserves requested channel order', async t => {
  const directory = await fixture(t);
  const index = (await cli('retrieve', directory, '--start', '2', '--end', '5', '--channels', '3,1')).stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(index.map(frame => frame.index), [2, 3, 4]);
  assert.equal(index[0].values.length, 2);
  const time = (await cli('retrieve', directory, '--start-seconds', '0.021', '--end-seconds', '0.05')).stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(time.map(frame => frame.index), [3, 4]);
  assert.equal((await cli('retrieve', directory, '--start', '99')).stdout, '');
});

test('retrieve rejects conflicting and invalid selections', async t => {
  const directory = await fixture(t);
  for (const args of [['--start', '1', '--start-seconds', '0.1'], ['--channels', '1,1'], ['--channels', ''], ['--end', '-1']]) {
    await assert.rejects(cli('retrieve', directory, ...args), error => { assert.equal(error.code, 1); return true; });
  }
  for (const channels of ['1,', '1,,2', '01']) await assert.rejects(cli('retrieve', directory, '--channels', channels), { code: 1 });
});

test('retrieve preserves gaps and adjacent duplicate observations', async t => {
  const directory = await fixture(t);
  const frames = await readFile(join(directory, 'frames.bin'));
  const width = 24;
  // Keep original records 0, 2, 2, and 5: a gap plus an adjacent duplicate.
  await writeFile(join(directory, 'frames.bin'), Buffer.concat([frames.subarray(0, width), frames.subarray(2 * width, 3 * width), frames.subarray(2 * width, 3 * width), frames.subarray(5 * width, 6 * width)]));
  const result = (await cli('retrieve', directory, '--start', '0', '--end', '6')).stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(result.map(frame => frame.index), [0, 2, 2, 5]);
});

test('incomplete recordings require an explicit readable-prefix acknowledgement', async t => {
  const directory = await fixture(t);
  const metadataPath = join(directory, 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  await writeFile(metadataPath, JSON.stringify({ ...metadata, status: 'failed', expectedFrames: null, duration: null }));
  await assert.rejects(cli('retrieve', directory), { code: 1 });
  const output = await cli('retrieve', directory, '--prefix', 'true', '--end', '2');
  assert.equal(output.stdout.trim().split('\n').length, 2);
});

test('a current verifier ordering failure blocks seeking even when it is not the first format error', async t => {
  const directory = await fixture(t);
  const framePath = join(directory, 'frames.bin');
  const frames = await readFile(framePath);
  const width = 24;
  const reordered = Buffer.from(frames);
  frames.copy(reordered, 2 * width, 3 * width, 4 * width);
  frames.copy(reordered, 3 * width, 2 * width, 3 * width);
  await writeFile(framePath, reordered);
  const metadataPath = join(directory, 'metadata.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  await writeFile(metadataPath, JSON.stringify({ ...metadata, id: 'different-id' }));
  await assert.rejects(cli('verify', directory), { code: 1 });
  await assert.rejects(cli('retrieve', directory, '--start', '0', '--end', '5'), error => { assert.match(error.stderr, /malformed frame ordering/i); return true; });
});

test('CSV rows retain selected channel order and original timeline units', async t => {
  const directory = await fixture(t);
  const frames = (await cli('retrieve', directory, '--start', '2', '--end', '3', '--channels', '3,1')).stdout.trim().split('\n').map(JSON.parse);
  assert.equal(csvHeader([3, 1]), 'original_frame_index,time_seconds,channel_3,channel_1\n');
  assert.equal(csvRow(frames[0], 100), `2,0.02,${frames[0].values.join(',')}\n`);
  const lines = [];
  for await (const line of csvLines(directory, { start: 2, end: 3, channels: [3, 1] })) lines.push(line);
  assert.deepEqual(lines, [csvHeader([3, 1]), csvRow(frames[0], 100)]);
  const empty = [];
  for await (const line of csvLines(directory, { start: 99, end: 100 })) empty.push(line);
  assert.deepEqual(empty, [csvHeader([0, 1, 2, 3])]);
});
