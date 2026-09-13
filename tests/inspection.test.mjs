import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, truncate, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execute = promisify(execFile);
const cli = (...args) => execute(process.execPath, ['core/cli.ts', ...args], { timeout: 10000 });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scope-inspect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'fixture');
  await cli('record', directory, '--seconds', '0.01');
  return { root, directory };
}

test('inspection exposes a truncated prefix and never presents it as a sound finalized recording', async (t) => {
  const { directory } = await fixture(t);
  await truncate(join(directory, 'frames.bin'), 3 * 136 + 5);
  const result = JSON.parse((await cli('inspect', directory)).stdout);
  assert.equal(result.completeRecords, 3);
  assert.equal(result.trailingBytes, 5);
  assert.equal(result.readableBytes, 408);
  assert.equal(result.condition, 'attention');
  assert.match(result.warnings.join(' '), /partial|trailing/i);
  assert.match(result.warnings.join(' '), /count/i);
});

test('unconfirmed extent keeps duration unknown even when the metadata has a stale duration', async (t) => {
  const { directory } = await fixture(t);
  const path = join(directory, 'metadata.json');
  const metadata = JSON.parse(await readFile(path, 'utf8'));
  Object.assign(metadata, { status: 'failed', expectedFrames: null, duration: 99 });
  await writeFile(path, JSON.stringify(metadata));
  const result = JSON.parse((await cli('inspect', directory)).stdout);
  assert.equal(result.duration, null);
  assert.equal(result.expectedFrames, null);
  assert.equal(result.condition, 'incomplete');
  assert.match(result.warnings.join(' '), /unconfirmed/i);
  assert.equal(result.completeRecords, 40);
});

test('inspection rejects invalid metadata types, versions, layouts, and unsafe counts before interpreting data', async (t) => {
  const { directory } = await fixture(t);
  const path = join(directory, 'metadata.json');
  const original = JSON.parse(await readFile(path, 'utf8'));
  for (const update of [
    { format: 'SCOPE/99' },
    { sampleRate: 1.5 },
    { sampleType: 'float64' },
    { byteOrder: 'big-endian' },
    { recordBytes: 128 },
    { totalSamples: '1280' },
    { expectedFrames: -1 },
    { recordedFrames: 1e20 },
    { startedAt: 'yesterday' },
    { status: ['completed'] },
  ]) {
    await writeFile(path, JSON.stringify({ ...original, ...update }));
    await assert.rejects(cli('inspect', directory), { code: 1 });
  }
});

test('the CLI library is empty when absent and pages saved bundles without losing malformed entries', async (t) => {
  const { root, directory } = await fixture(t);
  const empty = JSON.parse((await cli('list', join(root, 'absent'), '--limit', '1')).stdout);
  assert.deepEqual(empty, { items: [], nextCursor: null });
  await cli('record', join(root, 'second'), '--seconds', '0.01');
  await writeFile(join(directory, 'metadata.json'), '{bad json');
  const first = JSON.parse((await cli('list', root, '--limit', '1')).stdout);
  assert.equal(first.items.length, 1);
  assert.equal(first.items[0].id, 'fixture');
  assert.match(first.items[0].error, /Invalid metadata JSON/);
  assert.equal(first.nextCursor, 'fixture');
  const second = JSON.parse(
    (await cli('list', root, '--limit', '1', '--cursor', first.nextCursor)).stdout,
  );
  assert.equal(second.items[0].id, 'second');
  assert.equal(second.items[0].recording.condition, 'finalized');
  assert.equal(second.nextCursor, null);
});

test('contradictory counts remain inspectable with warnings, and oversized metadata is rejected', async (t) => {
  const { directory } = await fixture(t);
  const path = join(directory, 'metadata.json');
  const metadata = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...metadata, totalSamples: 1, duration: 7 }));
  const result = JSON.parse((await cli('inspect', directory)).stdout);
  assert.equal(result.condition, 'attention');
  assert.match(result.warnings.join(' '), /scalar count/);
  assert.match(result.warnings.join(' '), /duration/);
  await writeFile(path, JSON.stringify({ ...metadata, padding: 'x'.repeat(70000) }));
  await assert.rejects(cli('inspect', directory), (error) => {
    assert.match(error.stderr, /64 KiB/);
    return true;
  });
});
