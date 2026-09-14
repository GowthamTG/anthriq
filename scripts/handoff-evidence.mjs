import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HANDOFF_OUTPUT_LIMIT_BYTES = 64 * 1024;
export const HANDOFF_SCHEMA_VERSION = 'SCOPE-T17-HANDOFF/1';
export const HANDOFF_CHANNELS = [31, 2, 17, 0];
export const HANDOFF_WINDOWS = [
  { name: 'beginning', start: 0, end: 4 },
  { name: 'middle', start: 3998, end: 4002 },
  { name: 'end', start: 7996, end: 8000 },
];

export function handoffCommandPlan(skipBrowserInstall = false) {
  return [
    ['npm', ['ci']],
    ['npm', ['run', 'format:check']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['test']],
    ['npm', ['run', 'build']],
    ['npm', ['run', 'format:check']],
    ['npm', ['run', 'check:clean']],
    ['npm', ['run', 'check:links']],
    ...(skipBrowserInstall ? [] : [['npx', ['playwright', 'install', 'chromium']]]),
    ['npm', ['run', 'test:browser']],
    ['npm', ['run', 'evidence:validate-acquisition']],
    ['npm', ['run', 'evidence:validate-long-recording']],
  ];
}

const now = () => new Date().toISOString();

export function parseHandoffArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--'))
      throw new Error('Options must be provided as --name value pairs');
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) throw new Error(`Duplicate option: ${key}`);
    options[name] = value;
  }
  for (const name of ['source', 'ref', 'output', 'workload'])
    if (!options[name]) throw new Error(`Missing required option: --${name}`);
  if (!['quiet', 'development', 'ui'].includes(options.workload))
    throw new Error('--workload must be quiet, development, or ui');
  return {
    source: options.source,
    ref: options.ref,
    output: resolve(options.output),
    workload: options.workload,
    skipBrowserInstall: options['skip-browser-install'] === 'true',
  };
}

export function boundedAppend(previous, chunk, limit = HANDOFF_OUTPUT_LIMIT_BYTES) {
  const combined = Buffer.concat([previous, Buffer.from(chunk)]);
  return combined.length <= limit ? combined : combined.subarray(combined.length - limit);
}

export async function runCommand(command, args, options = {}) {
  const began = performance.now();
  const stdoutHash = createHash('sha256');
  const stderrHash = createHash('sha256');
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTail = Buffer.alloc(0);
  let stderrTail = Buffer.alloc(0);
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    stdoutHash.update(chunk);
    stdoutTail = boundedAppend(stdoutTail, chunk);
    if (options.echo) process.stdout.write(chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    stderrHash.update(chunk);
    stderrTail = boundedAppend(stderrTail, chunk);
    if (options.echo) process.stderr.write(chunk);
  });
  const { code, signal } = await new Promise((resolvePromise, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, exitSignal) =>
      resolvePromise({ code: exitCode, signal: exitSignal }),
    );
  });
  const result = {
    command: [command, ...args].join(' '),
    exitCode: code,
    signal,
    elapsedMs: Math.round((performance.now() - began) * 1000) / 1000,
    stdoutBytes,
    stderrBytes,
    stdoutSha256: stdoutHash.digest('hex'),
    stderrSha256: stderrHash.digest('hex'),
    stdoutTail: stdoutTail.toString('utf8'),
    stderrTail: stderrTail.toString('utf8'),
  };
  if (code !== 0 && !options.allowFailure)
    throw Object.assign(
      new Error(`${result.command} failed with exit ${code}\n${result.stderrTail}`),
      {
        result,
      },
    );
  return result;
}

export async function runtimeTreeDigest(directory) {
  const listed = await runCommand('git', ['ls-files', '-z'], { cwd: directory });
  const files = listed.stdoutTail
    .split('\0')
    .filter(Boolean)
    .filter((path) => !path.startsWith('docs/evidence/t17/'))
    .sort();
  // A repository with more than 64 KiB of path names must not be silently truncated.
  assert.equal(
    listed.stdoutBytes,
    Buffer.byteLength(listed.stdoutTail),
    'git file list exceeded bound',
  );
  const digest = createHash('sha256');
  for (const path of files) {
    digest.update(path);
    digest.update('\0');
    digest.update(await readFile(join(directory, path)));
    digest.update('\0');
  }
  return { sha256: digest.digest('hex'), files: files.length };
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolvePromise) => server.close(resolvePromise));
  return address.port;
}

async function waitForApplication(port, child, timeoutMs = 60_000) {
  const began = performance.now();
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`application exited early with ${child.exitCode}`);
    try {
      const state = await fetch(`http://127.0.0.1:${port}/api/state`);
      const page = await fetch(`http://127.0.0.1:${port}/`);
      if (state.status === 200 && page.status === 200) {
        const stateBody = await state.json();
        const pageBody = await page.text();
        assert.ok(pageBody.includes('SCOPE'));
        return {
          elapsedMs: Math.round((performance.now() - began) * 1000) / 1000,
          stateStatus: state.status,
          pageStatus: page.status,
          acquisitionStatus: stateBody.status,
        };
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`application did not become ready: ${lastError ?? 'timeout'}`);
}

async function startAndStopApplication(checkout, recordings) {
  const port = await unusedPort();
  const began = performance.now();
  const child = spawn(process.execPath, ['server.ts'], {
    cwd: checkout,
    env: { ...process.env, PORT: String(port), SCOPE_RECORDINGS_DIR: recordings },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = Buffer.alloc(0);
  let stderr = Buffer.alloc(0);
  const stdoutHash = createHash('sha256');
  const stderrHash = createHash('sha256');
  let stdoutBytes = 0;
  let stderrBytes = 0;
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    stdoutHash.update(chunk);
    stdout = boundedAppend(stdout, chunk);
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    stderrHash.update(chunk);
    stderr = boundedAppend(stderr, chunk);
  });
  try {
    const ready = await waitForApplication(port, child);
    const stopping = performance.now();
    child.kill('SIGTERM');
    const { code, signal } = await new Promise((resolvePromise, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, exitSignal) =>
        resolvePromise({ code: exitCode, signal: exitSignal }),
      );
    });
    assert.equal(code, 0, stderr.toString('utf8'));
    return {
      ...ready,
      port,
      exitCode: code,
      signal,
      shutdownMs: Math.round((performance.now() - stopping) * 1000) / 1000,
      totalElapsedMs: Math.round((performance.now() - began) * 1000) / 1000,
      stdoutBytes,
      stderrBytes,
      stdoutSha256: stdoutHash.digest('hex'),
      stderrSha256: stderrHash.digest('hex'),
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

function publicStep(result) {
  const { stdoutTail: _stdout, stderrTail: _stderr, ...summary } = result;
  return summary;
}

function parseJsonTail(result, stream = 'stdoutTail') {
  const text = result[stream].trim();
  assert.ok(text, `${result.command} produced no ${stream}`);
  return JSON.parse(text);
}

async function cliWorkflow(checkout, root) {
  const recording = join(root, 't17-cli-recording');
  const node = process.execPath;
  const record = await runCommand(node, ['core/cli.ts', 'record', recording, '--seconds', '2'], {
    cwd: checkout,
  });
  const recorded = parseJsonTail(record);
  assert.deepEqual(
    { status: recorded.status, frames: recorded.frames, droppedFrames: recorded.droppedFrames },
    { status: 'completed', frames: 8000, droppedFrames: 0 },
  );

  const inspectResult = await runCommand(node, ['core/cli.ts', 'inspect', recording], {
    cwd: checkout,
  });
  const inspection = parseJsonTail(inspectResult);
  assert.equal(inspection.channels, 32);
  assert.equal(inspection.sampleRate, 4000);
  assert.equal(inspection.seed, 42);
  assert.equal(inspection.expectedFrames, 8000);
  assert.equal(inspection.recordedFrames, 8000);
  assert.equal(inspection.totalSamples, 256000);
  assert.equal(inspection.fileBytes, 1088000);
  assert.equal(inspection.trailingBytes, 0);
  assert.equal(inspection.status, 'completed');
  assert.equal(inspection.droppedFrames, 0);
  assert.ok(inspection.processes.generator > 0 && inspection.processes.recorder > 0);
  assert.notEqual(inspection.processes.generator, inspection.processes.recorder);

  const retrieval = [];
  for (const window of HANDOFF_WINDOWS) {
    const result = await runCommand(
      node,
      [
        'core/cli.ts',
        'retrieve',
        recording,
        '--start',
        String(window.start),
        '--end',
        String(window.end),
        '--channels',
        HANDOFF_CHANNELS.join(','),
      ],
      { cwd: checkout },
    );
    const observations = result.stdoutTail.trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.deepEqual(
      observations.map((item) => item.index),
      Array.from({ length: window.end - window.start }, (_, offset) => window.start + offset),
    );
    assert.ok(observations.every((item) => item.values.length === HANDOFF_CHANNELS.length));
    retrieval.push({ ...window, rows: observations.length, ...publicStep(result) });
  }

  const playbackResult = await runCommand(node, ['core/cli.ts', 'playback', recording], {
    cwd: checkout,
  });
  const playback = parseJsonTail(playbackResult, 'stderrTail');
  assert.equal(playback.status, 'ended');
  assert.equal(playback.position, 8000);
  assert.equal(playback.emittedFrames, 8000);
  assert.equal(playback.emittedSamples, 256000);

  const verificationResult = await runCommand(node, ['core/cli.ts', 'verify', recording], {
    cwd: checkout,
  });
  const verification = parseJsonTail(verificationResult);
  assert.equal(verification.result, 'PASS');
  assert.equal(verification.recordsScanned, 8000);
  assert.equal(verification.formatErrors.count, 0);
  for (const kind of ['missing', 'duplicated', 'incorrect'])
    assert.equal(verification.discrepancies[kind].samples, 0);

  return {
    recording: {
      status: inspection.status,
      channels: inspection.channels,
      sampleRate: inspection.sampleRate,
      seed: inspection.seed,
      expectedFrames: inspection.expectedFrames,
      recordedFrames: inspection.recordedFrames,
      totalSamples: inspection.totalSamples,
      frameBytes: inspection.fileBytes,
      droppedFrames: inspection.droppedFrames,
      trailingBytes: inspection.trailingBytes,
      processSeparation: inspection.processes.generator !== inspection.processes.recorder,
    },
    retrieval,
    playback: {
      status: playback.status,
      position: playback.position,
      emittedFrames: playback.emittedFrames,
      emittedSamples: playback.emittedSamples,
      elapsedMs: playbackResult.elapsedMs,
    },
    verification: {
      result: verification.result,
      recordsScanned: verification.recordsScanned,
      formatErrors: verification.formatErrors.count,
      missingSamples: verification.discrepancies.missing.samples,
      duplicatedSamples: verification.discrepancies.duplicated.samples,
      incorrectSamples: verification.discrepancies.incorrect.samples,
      elapsedMs: verification.elapsedMs,
      peakRssBytes: verification.peakRssBytes,
    },
    commands: [record, inspectResult, playbackResult, verificationResult].map(publicStep),
  };
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

export async function runHandoffEvidence(options) {
  assert.equal(process.versions.node.split('.')[0], '24', 'T17 rehearsal requires Node.js 24');
  const current = await runCommand('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: resolve('.'),
  });
  assert.equal(current.stdoutTail, '', 'source worktree must be clean before rehearsal');

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'scope-t17-handoff-'));
  const checkout = join(temporaryRoot, 'checkout');
  const recordingRoot = join(temporaryRoot, 'recordings');
  const steps = [];
  const beganAt = now();
  try {
    steps.push(
      publicStep(
        await runCommand('git', ['clone', '--no-checkout', options.source, checkout], {
          echo: true,
        }),
      ),
    );
    steps.push(
      publicStep(
        await runCommand('git', ['checkout', '--detach', options.ref], {
          cwd: checkout,
          echo: true,
        }),
      ),
    );
    const commit = (
      await runCommand('git', ['rev-parse', 'HEAD'], { cwd: checkout })
    ).stdoutTail.trim();
    const sourceStatus = await runCommand(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      {
        cwd: checkout,
      },
    );
    assert.equal(sourceStatus.stdoutTail, '', 'cloned source must be clean');
    const tree = await runtimeTreeDigest(checkout);
    for (const [command, args] of handoffCommandPlan(options.skipBrowserInstall))
      steps.push(publicStep(await runCommand(command, args, { cwd: checkout, echo: true })));

    await mkdir(recordingRoot);
    const server = await startAndStopApplication(checkout, recordingRoot);
    const cli = await cliWorkflow(checkout, recordingRoot);
    const finalStatus = await runCommand(
      'git',
      ['status', '--porcelain=v1', '--untracked-files=all'],
      {
        cwd: checkout,
      },
    );
    assert.equal(finalStatus.stdoutTail, '', 'rehearsal changed the cloned worktree');
    const report = {
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      result: 'PASS',
      beganAt,
      completedAt: now(),
      workload: options.workload,
      source: { repository: options.source, requestedRef: options.ref, commit, runtimeTree: tree },
      environment: {
        platform: process.platform,
        release: (await import('node:os')).release(),
        arch: process.arch,
        node: process.version,
        npm: (await runCommand('npm', ['--version'])).stdoutTail.trim(),
      },
      steps,
      server,
      cli,
    };
    await writeJsonAtomic(options.output, report);
    return report;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseHandoffArguments(process.argv.slice(2));
    const report = await runHandoffEvidence(options);
    process.stdout.write(`T17 handoff rehearsal ${report.result}: ${options.output}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
