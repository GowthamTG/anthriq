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

export function handoffCommandPlan() {
  return [
    ['npm', ['ci']],
    ['npm', ['run', 'format:check']],
    ['npm', ['run', 'typecheck']],
    ['npm', ['test']],
    ['npm', ['run', 'build']],
    ['npm', ['run', 'format:check']],
    ['npm', ['run', 'check:clean']],
    ['npm', ['run', 'check:links']],
    ['npx', ['playwright', 'install', 'chromium']],
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
    outputDirectory: resolve(options.output),
    workload: options.workload,
  };
}

export function boundedAppend(previous, chunk, limit = HANDOFF_OUTPUT_LIMIT_BYTES) {
  const combined = Buffer.concat([previous, Buffer.from(chunk)]);
  return combined.length <= limit ? combined : combined.subarray(combined.length - limit);
}

export function createOutputCollector({ echo = false } = {}) {
  const hashes = { stdout: createHash('sha256'), stderr: createHash('sha256') };
  const bytes = { stdout: 0, stderr: 0 };
  const tails = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  return {
    write(stream, chunk) {
      bytes[stream] += chunk.length;
      hashes[stream].update(chunk);
      tails[stream] = boundedAppend(tails[stream], chunk);
      if (echo) process[stream].write(chunk);
    },
    tail(stream) {
      return tails[stream].toString('utf8');
    },
    summary() {
      return {
        stdoutBytes: bytes.stdout,
        stderrBytes: bytes.stderr,
        stdoutSha256: hashes.stdout.digest('hex'),
        stderrSha256: hashes.stderr.digest('hex'),
      };
    },
  };
}

export function assertNode24(version = process.versions.node) {
  assert.equal(version.split('.')[0], '24', 'T17 rehearsal requires Node.js 24');
}

export async function runCommand(command, args, options = {}) {
  const began = performance.now();
  const output = createOutputCollector({ echo: options.echo });
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => output.write('stdout', chunk));
  child.stderr.on('data', (chunk) => output.write('stderr', chunk));
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
    ...output.summary(),
    stdoutTail: output.tail('stdout'),
    stderrTail: output.tail('stderr'),
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
    assertApplicationStillRunning(child);
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

export function assertApplicationStillRunning(child) {
  if (child.exitCode !== null || child.signalCode !== null)
    throw new Error(
      `application exited early with ${child.signalCode ?? `code ${child.exitCode}`}`,
    );
}

export function waitForChildClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`application did not stop within ${timeoutMs} ms`)),
      timeoutMs,
    );
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (exitCode, exitSignal) => {
      clearTimeout(timeout);
      resolvePromise({ code: exitCode, signal: exitSignal });
    });
  });
}

export async function startAndStopApplication(
  checkout,
  recordings,
  { command = 'npm', args = ['start'], shutdownTimeoutMs = 10_000 } = {},
) {
  const port = await unusedPort();
  const began = performance.now();
  const child = spawn(command, args, {
    cwd: checkout,
    env: { ...process.env, PORT: String(port), SCOPE_RECORDINGS_DIR: recordings },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output = createOutputCollector();
  child.stdout.on('data', (chunk) => output.write('stdout', chunk));
  child.stderr.on('data', (chunk) => output.write('stderr', chunk));
  try {
    const ready = await waitForApplication(port, child);
    const stopping = performance.now();
    child.kill('SIGTERM');
    const { code, signal } = await waitForChildClose(child, shutdownTimeoutMs);
    assert.equal(code, 0, output.tail('stderr'));
    return {
      ...ready,
      command: [command, ...args].join(' '),
      port,
      exitCode: code,
      signal,
      shutdownMs: Math.round((performance.now() - stopping) * 1000) / 1000,
      totalElapsedMs: Math.round((performance.now() - began) * 1000) / 1000,
      ...output.summary(),
    };
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

function publicStep(result) {
  const { stdoutTail: _stdout, stderrTail: _stderr, ...summary } = result;
  return summary;
}

export async function runRequiredSteps(checkout, runner = runCommand) {
  const results = [];
  for (const [command, args] of handoffCommandPlan())
    results.push(publicStep(await runner(command, args, { cwd: checkout, echo: true })));
  return results;
}

function parseJsonTail(result, stream = 'stdoutTail') {
  const text = result[stream].trim();
  assert.ok(text, `${result.command} produced no ${stream}`);
  return JSON.parse(text);
}

export function independentHandoffSample(index, channel, sampleRate = 4000, seed = 42) {
  const period = Math.max(8, Math.floor(sampleRate / (2 + 0.37 * channel) + 0.5));
  const modulationPeriod = Math.max(4, Math.floor(period / 7 + 0.5));
  const phase = ((index % period) + ((97 * channel + seed) % period)) % period;
  const modulationPhase =
    ((index % modulationPeriod) + (seed % modulationPeriod)) % modulationPeriod;
  const triangle = (position, length) => 1 - 4 * Math.abs(position / length - 0.5);
  return Math.fround(
    0.8 * triangle(phase, period) + 0.12 * triangle(modulationPhase, modulationPeriod),
  );
}

export function assertRetrievalObservations(observations, window) {
  assert.deepEqual(
    observations.map((item) => item.index),
    Array.from({ length: window.end - window.start }, (_, offset) => window.start + offset),
  );
  for (const observation of observations) {
    assert.equal(observation.values.length, HANDOFF_CHANNELS.length);
    HANDOFF_CHANNELS.forEach((channel, offset) =>
      assert.equal(
        observation.values[offset],
        independentHandoffSample(observation.index, channel),
        `frame ${observation.index} selected channel ${channel}`,
      ),
    );
  }
}

export function summarizeCliVerification(verification) {
  assert.equal(verification.result, 'PASS');
  assert.equal(verification.counts.recordedFrames, 8000);
  assert.equal(verification.formatErrors.count, 0);
  for (const kind of ['missing', 'duplicated', 'incorrect'])
    assert.equal(verification.discrepancies[kind].samples, 0);
  return {
    result: verification.result,
    recordsScanned: verification.counts.recordedFrames,
    formatErrors: verification.formatErrors.count,
    missingSamples: verification.discrepancies.missing.samples,
    duplicatedSamples: verification.discrepancies.duplicated.samples,
    incorrectSamples: verification.discrepancies.incorrect.samples,
    elapsedMs: verification.execution.elapsedMs,
    peakRssBytes: verification.execution.peakRssBytes,
  };
}

export function summarizeCliRecording(recorded, inspection) {
  assert.deepEqual(
    { status: recorded.status, frames: recorded.frames, droppedFrames: recorded.droppedFrames },
    { status: 'completed', frames: 8000, droppedFrames: 0 },
  );
  assert.deepEqual(
    {
      status: inspection.status,
      channels: inspection.channels,
      sampleRate: inspection.sampleRate,
      seed: inspection.seed,
      expectedFrames: inspection.expectedFrames,
      recordedFrames: inspection.recordedFrames,
      totalSamples: inspection.totalSamples,
      frameFileBytes: inspection.fileBytes,
      droppedFrames: inspection.droppedFrames,
      trailingBytes: inspection.trailingBytes,
    },
    {
      status: 'completed',
      channels: 32,
      sampleRate: 4000,
      seed: 42,
      expectedFrames: 8000,
      recordedFrames: 8000,
      totalSamples: 256000,
      frameFileBytes: 1088000,
      droppedFrames: 0,
      trailingBytes: 0,
    },
  );
  assert.ok(inspection.processes.generator > 0 && inspection.processes.recorder > 0);
  assert.notEqual(inspection.processes.generator, inspection.processes.recorder);
  return {
    status: inspection.status,
    channels: inspection.channels,
    sampleRate: inspection.sampleRate,
    seed: inspection.seed,
    expectedFrames: inspection.expectedFrames,
    recordedFrames: inspection.recordedFrames,
    totalSamples: inspection.totalSamples,
    frameFileBytes: inspection.fileBytes,
    droppedFrames: inspection.droppedFrames,
    trailingBytes: inspection.trailingBytes,
    processSeparation: true,
  };
}

async function cliWorkflow(checkout, root) {
  const recording = join(root, 't17-cli-recording');
  const node = process.execPath;
  const record = await runCommand(node, ['core/cli.ts', 'record', recording, '--seconds', '2'], {
    cwd: checkout,
  });
  const recorded = parseJsonTail(record);

  const inspectResult = await runCommand(node, ['core/cli.ts', 'inspect', recording], {
    cwd: checkout,
  });
  const inspection = parseJsonTail(inspectResult);
  const recordingSummary = summarizeCliRecording(recorded, inspection);

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
    assertRetrievalObservations(observations, window);
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
  const verificationSummary = summarizeCliVerification(verification);

  return {
    recording: recordingSummary,
    retrieval,
    playback: {
      status: playback.status,
      position: playback.position,
      emittedFrames: playback.emittedFrames,
      emittedSamples: playback.emittedSamples,
      elapsedMs: playbackResult.elapsedMs,
    },
    verification: verificationSummary,
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
  assertNode24();
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
    steps.push(...(await runRequiredSteps(checkout)));

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
    const output = join(options.outputDirectory, 'rehearsal.json');
    await writeJsonAtomic(output, report);
    return report;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseHandoffArguments(process.argv.slice(2));
    const report = await runHandoffEvidence(options);
    process.stdout.write(
      `T17 handoff rehearsal ${report.result}: ${join(options.outputDirectory, 'rehearsal.json')}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
