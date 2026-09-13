import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execute = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(read, accept, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch {}
    await sleep(20);
  }
  assert.fail('Timed out waiting for observable recording state');
}
async function capture(t, options = [], env = {}) {
  const root = await mkdtemp(join(tmpdir(), 'scope-fault-'));
  const directory = join(root, 'capture');
  const child = spawn(process.execPath, ['core/cli.ts', 'record', directory, ...options], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d;
  });
  let pids = [];
  t.after(async () => {
    for (const pid of [...pids, child.pid]) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    await closed;
    await rm(root, { recursive: true, force: true });
  });
  const metadata = await until(
    async () => JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8')),
    (m) => m.processes,
  );
  pids = Object.values(metadata.processes);
  return { directory, child, closed, metadata, stderr: () => stderr };
}
async function inspection(directory) {
  return JSON.parse(
    (await execute(process.execPath, ['core/cli.ts', 'inspect', directory], { timeout: 5000 }))
      .stdout,
  );
}

test(
  'recorder death leaves a failed inspectable prefix and terminates its generator',
  { timeout: 15000 },
  async (t) => {
    const run = await capture(t);
    await sleep(200);
    process.kill(run.metadata.processes.recorder, 'SIGKILL');
    const [code] = await run.closed;
    assert.equal(code, 1);
    assert.match(run.stderr(), /Recorder.*SIGKILL/);
    const result = await inspection(run.directory);
    assert.equal(result.status, 'failed');
    assert.equal(result.expectedFrames, null);
    assert.ok(result.completeRecords > 0);
    assert.equal(result.recordedFrames, result.completeRecords);
    assert.match(result.warnings.join(' '), /completeness.*unknown/);
    await until(async () => {
      try {
        process.kill(run.metadata.processes.generator, 0);
        return false;
      } catch {
        return true;
      }
    }, Boolean);
  },
);

test(
  'generator death during a delayed write preserves a readable failed prefix',
  { timeout: 15000 },
  async (t) => {
    const run = await capture(t, ['--write-delay-ms', '200']);
    await sleep(350);
    process.kill(run.metadata.processes.generator, 'SIGKILL');
    assert.equal((await run.closed)[0], 1);
    const result = await inspection(run.directory);
    assert.equal(result.status, 'failed');
    assert.match(result.error, /Generator exited unexpectedly/);
    assert.equal(result.expectedFrames, null);
    assert.equal(result.recordedFrames, result.completeRecords);
    assert.ok(result.completeRecords > 0);
  },
);

const faultEnvironment = (mode) => ({
  NODE_OPTIONS: `--import=${new URL('./fixtures/disk-fault.mjs', import.meta.url).href}`,
  SCOPE_TEST_DISK_FAULT: mode,
});
test(
  'disk exhaustion after a partial write preserves only complete frames and reports the cause',
  { timeout: 15000 },
  async (t) => {
    const run = await capture(t, [], faultEnvironment('ENOSPC'));
    assert.equal((await run.closed)[0], 1);
    assert.match(run.stderr(), /ENOSPC/);
    const saved = await inspection(run.directory);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.completeRecords, 1);
    assert.equal(saved.trailingBytes, 5);
    assert.equal(saved.readableBytes, 136);
    assert.equal(saved.recordedFrames, 1);
    assert.equal(saved.expectedFrames, null);
    assert.match(saved.error, /ENOSPC/);
  },
);

test('serial short writes preserve exact binary observations', { timeout: 15000 }, async (t) => {
  const run = await capture(t, ['--seconds', '0.05'], faultEnvironment('short'));
  assert.equal((await run.closed)[0], 0, run.stderr());
  const saved = await inspection(run.directory);
  assert.equal(saved.status, 'completed');
  assert.equal(saved.recordedFrames, 200);
  assert.equal(saved.fileBytes, 27200);
  assert.equal(saved.trailingBytes, 0);
  const bytes = await readFile(join(run.directory, 'frames.bin'));
  assert.equal(bytes.readBigUInt64LE(bytes.length - 136), 199n);
  assert.equal(bytes.readFloatLE(8), -0.7823104858398438);
});

test(
  'finalization failure is explicit and keeps the independently confirmed extent',
  { timeout: 15000 },
  async (t) => {
    const run = await capture(t, ['--seconds', '0.1'], faultEnvironment('finalize'));
    assert.equal((await run.closed)[0], 1);
    assert.match(run.stderr(), /EACCES.*finalization/);
    const saved = await inspection(run.directory);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.expectedFrames, 400);
    assert.equal(saved.recordedFrames, 400);
    assert.equal(saved.trailingBytes, 0);
    assert.match(saved.error, /EACCES/);
  },
);

test(
  'recorder death also terminates a suspended generator without waiting for IPC cleanup',
  { timeout: 4000 },
  async (t) => {
    const run = await capture(t);
    process.kill(run.metadata.processes.generator, 'SIGSTOP');
    process.kill(run.metadata.processes.recorder, 'SIGKILL');
    assert.equal((await run.closed)[0], 1);
    const saved = await inspection(run.directory);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.expectedFrames, null);
  },
);

test('loss of recorder IPC cannot claim successful completion', { timeout: 15000 }, async (t) => {
  const run = await capture(t, [], faultEnvironment('recorder-ipc'));
  assert.equal((await run.closed)[0], 1);
  assert.match(run.stderr(), /Recorder IPC disconnected/);
  const saved = await inspection(run.directory);
  assert.equal(saved.status, 'failed');
  assert.ok(saved.completeRecords > 0);
});

for (const [signal, pause] of [
  ['SIGINT', 0],
  ['SIGTERM', 100],
]) {
  test(
    `${signal} before or during delayed writes drains accepted frames cleanly`,
    { timeout: 15000 },
    async (t) => {
      const run = await capture(t, [
        '--channels',
        '1',
        '--sample-rate',
        '20',
        '--write-delay-ms',
        '300',
      ]);
      await sleep(pause);
      run.child.kill(signal);
      run.child.kill(signal);
      assert.equal((await run.closed)[0], 0, run.stderr());
      const saved = await inspection(run.directory);
      assert.equal(saved.status, 'completed');
      assert.equal(saved.recordedFrames, saved.expectedFrames);
      assert.equal(saved.completeRecords, saved.recordedFrames);
      assert.equal(saved.trailingBytes, 0);
      for (const pid of Object.values(saved.processes))
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    },
  );
}

test(
  'a timed drain exceeding the deadline fails but retains the confirmed source extent',
  { timeout: 15000 },
  async (t) => {
    const run = await capture(t, ['--seconds', '0.1', '--write-delay-ms', '5000']);
    const began = performance.now();
    assert.equal((await run.closed)[0], 1);
    assert.ok(performance.now() - began < 12000);
    assert.match(run.stderr(), /10-second shutdown limit/);
    const saved = await inspection(run.directory);
    assert.equal(saved.status, 'failed');
    assert.equal(saved.expectedFrames, 400);
    assert.equal(saved.duration, 0.1);
    assert.equal(saved.recordedFrames, saved.completeRecords);
    assert.ok(saved.completeRecords < 400);
    await assert.rejects(
      execute(process.execPath, ['core/cli.ts', 'verify', run.directory]),
      (error) => {
        assert.equal(JSON.parse(error.stdout).result, 'FAIL');
        return true;
      },
    );
  },
);
