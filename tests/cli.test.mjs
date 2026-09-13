import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execute = promisify(execFile);
const cli = (...args) => execute(process.execPath, ['core/cli.ts', ...args], { timeout: 15000 });

test('a real two-second acquisition is clock-paced, lossless, and independently readable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scope-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'nominal');
  const began = performance.now();
  await cli('record', directory, '--seconds', '2');
  assert.ok(performance.now() - began >= 1950, 'acquisition must follow real elapsed time');
  const { stdout } = await cli('inspect', directory);
  const metadata = JSON.parse(stdout);
  assert.equal(metadata.status, 'completed');
  assert.equal(metadata.expectedFrames, 8000);
  assert.equal(metadata.recordedFrames, 8000);
  assert.equal(metadata.totalSamples, 256000);
  assert.equal(metadata.fileBytes, 1088000);
  assert.equal(metadata.trailingBytes, 0);
  assert.ok(metadata.processes?.generator > 0, 'record the real generator PID');
  assert.ok(metadata.processes?.recorder > 0, 'record the real recorder PID');
  assert.notEqual(metadata.processes.generator, metadata.processes.recorder);
  const bytes = await readFile(join(directory, 'frames.bin'));
  assert.equal(bytes.readBigUInt64LE(0), 0n);
  assert.equal(bytes.readBigUInt64LE(bytes.length - 136), 7999n);
  // Independent rational evaluation of the spec at seed 42, channel 0, frame 0:
  // (4/5)*(-229/250) + (3/25)*(-59/143), rounded once to float32.
  assert.equal(bytes.readFloatLE(8), -0.7823104858398438);
  const result = JSON.parse((await cli('verify', directory)).stdout);
  assert.equal(result.result, 'PASS');
  assert.deepEqual([result.discrepancies.missing.samples, result.discrepancies.duplicated.samples, result.discrepancies.incorrect.samples], [0, 0, 0]);
});

test('interrupting continuous capture drains data and exits both owned processes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scope-stop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'manual');
  const child = spawn(process.execPath, ['core/cli.ts', 'record', directory], { stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  const deadline = Date.now() + 5000;
  while (true) {
    try { await readFile(join(directory, 'metadata.json')); break; }
    catch { if (Date.now() > deadline) assert.fail('recording did not start'); await new Promise(r => setTimeout(r, 10)); }
  }
  await new Promise(r => setTimeout(r, 200));
  child.kill('SIGINT');
  child.kill('SIGINT');
  const [code] = await closed;
  assert.equal(code, 0, stderr);
  const metadata = JSON.parse((await cli('inspect', directory)).stdout);
  assert.equal(metadata.status, 'completed');
  assert.ok(metadata.recordedFrames > 0);
  assert.equal(metadata.recordedFrames, metadata.expectedFrames);
  assert.equal(metadata.trailingBytes, 0);
  for (const pid of Object.values(metadata.processes)) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('a recording startup failure exits clearly without claiming completion', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scope-failure-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'exists');
  await cli('record', directory, '--seconds', '0.05');
  await assert.rejects(cli('record', directory, '--seconds', '0.05'), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /EEXIST/);
    assert.doesNotMatch(error.stdout, /completed/);
    return true;
  });
});
