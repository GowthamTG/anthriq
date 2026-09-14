import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  HANDOFF_OUTPUT_LIMIT_BYTES,
  assertApplicationStillRunning,
  assertNode24,
  assertRetrievalObservations,
  boundedAppend,
  createOutputCollector,
  handoffCommandPlan,
  independentHandoffSample,
  parseHandoffArguments,
  runCommand,
  runRequiredSteps,
  runtimeTreeDigest,
  summarizeCliRecording,
  summarizeCliVerification,
  waitForChildClose,
} from '../scripts/handoff-evidence.mjs';
import { validateHandoffEvidence } from '../scripts/validate-handoff-evidence.mjs';
import { localMarkdownTargets } from '../scripts/check-markdown-links.mjs';

const execute = promisify(execFile);

test('handoff arguments require an exact source, ref, output, and honest workload', () => {
  const parsed = parseHandoffArguments([
    '--source',
    'git@example/repo.git',
    '--ref',
    'abc123',
    '--output',
    'result.json',
    '--workload',
    'quiet',
  ]);
  assert.equal(parsed.ref, 'abc123');
  assert.equal(parsed.workload, 'quiet');
  assert.equal(parsed.outputDirectory, resolve('result.json'));
  assert.throws(() => parseHandoffArguments([]), /Missing required option/);
  assert.throws(
    () =>
      parseHandoffArguments([
        '--source',
        'x',
        '--ref',
        'y',
        '--output',
        'z',
        '--workload',
        'undisclosed',
      ]),
    /quiet, development, or ui/,
  );
  assert.throws(
    () =>
      parseHandoffArguments([
        '--source',
        'x',
        '--source',
        'y',
        '--ref',
        'z',
        '--output',
        'o',
        '--workload',
        'quiet',
      ]),
    /Duplicate option/,
  );
});

test('Node preflight rejects every non-24 runtime before any rehearsal work', () => {
  assert.doesNotThrow(() => assertNode24('24.21.0'));
  assert.throws(() => assertNode24('23.11.0'), /requires Node.js 24/);
  assert.throws(() => assertNode24('25.0.0'), /requires Node.js 24/);
});

test('handoff command plan preserves the complete clean-clone gate order', () => {
  assert.deepEqual(
    handoffCommandPlan().map(([command, args]) => [command, ...args].join(' ')),
    [
      'npm ci',
      'npm run format:check',
      'npm run typecheck',
      'npm test',
      'npm run build',
      'npm run format:check',
      'npm run check:clean',
      'npm run check:links',
      'npx playwright install chromium',
      'npm run test:browser',
      'npm run evidence:validate-acquisition',
      'npm run evidence:validate-long-recording',
    ],
  );
});

test('required install and build stages stop immediately on their named failure', async () => {
  for (const failing of ['npm ci', 'npm run build']) {
    const called = [];
    await assert.rejects(
      runRequiredSteps('/tmp/unused', async (command, args) => {
        const label = [command, ...args].join(' ');
        called.push(label);
        if (label === failing) throw new Error(`${failing} failed`);
        return {
          command: label,
          exitCode: 0,
          signal: null,
          elapsedMs: 0,
          stdoutBytes: 0,
          stderrBytes: 0,
          stdoutSha256: 'x',
          stderrSha256: 'y',
          stdoutTail: '',
          stderrTail: '',
        };
      }),
      new RegExp(`${failing} failed`),
    );
    assert.equal(called.at(-1), failing);
  }
});

test('local Markdown target extraction excludes external and in-page links', () => {
  assert.deepEqual(
    localMarkdownTargets('[local](docs/file.md) [web](https://example.com) [anchor](#part)'),
    ['docs/file.md'],
  );
});

test('command capture is bounded, hashed, and fails closed on nonzero exit', async () => {
  const output = Buffer.alloc(HANDOFF_OUTPUT_LIMIT_BYTES + 123, 97);
  assert.equal(boundedAppend(Buffer.alloc(0), output).length, HANDOFF_OUTPUT_LIMIT_BYTES);
  const success = await runCommand(process.execPath, [
    '-e',
    `process.stdout.write('x'.repeat(70000))`,
  ]);
  assert.equal(success.stdoutBytes, 70000);
  assert.equal(success.stdoutTail.length, HANDOFF_OUTPUT_LIMIT_BYTES);
  assert.match(success.stdoutSha256, /^[a-f0-9]{64}$/);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(7)']), /exit 7/);
});

test('shared output collector bounds raw data while preserving exact counts and hashes', () => {
  const collector = createOutputCollector();
  collector.write('stdout', Buffer.alloc(HANDOFF_OUTPUT_LIMIT_BYTES + 4, 1));
  collector.write('stderr', Buffer.from('failure'));
  assert.equal(Buffer.byteLength(collector.tail('stdout')), HANDOFF_OUTPUT_LIMIT_BYTES);
  assert.equal(collector.tail('stderr'), 'failure');
  assert.deepEqual(collector.summary(), {
    stdoutBytes: HANDOFF_OUTPUT_LIMIT_BYTES + 4,
    stderrBytes: 7,
    stdoutSha256: '779320860686da69ae3b6d2a6f10181c7585c14350903523b3c3e0726d3185d9',
    stderrSha256: '16d34b5e7bcb341ee6cb3d16495d90e93fbe57c46d3827432613210a24ebca30',
  });
});

test('CLI verification summary follows the real grouped report and rejects a flattened lookalike', () => {
  const report = {
    result: 'PASS',
    counts: { recordedFrames: 8000 },
    formatErrors: { count: 0 },
    discrepancies: {
      missing: { samples: 0 },
      duplicated: { samples: 0 },
      incorrect: { samples: 0 },
    },
    execution: { elapsedMs: 12, peakRssBytes: 1024 },
  };
  assert.deepEqual(summarizeCliVerification(report), {
    result: 'PASS',
    recordsScanned: 8000,
    formatErrors: 0,
    missingSamples: 0,
    duplicatedSamples: 0,
    incorrectSamples: 0,
    elapsedMs: 12,
    peakRssBytes: 1024,
  });
  assert.throws(() => summarizeCliVerification({ ...report, counts: undefined }));
});

test('CLI recording reconciliation rejects incomplete, lossy, or contradictory results', () => {
  const recorded = { status: 'completed', frames: 8000, droppedFrames: 0 };
  const inspection = {
    status: 'completed',
    channels: 32,
    sampleRate: 4000,
    seed: 42,
    expectedFrames: 8000,
    recordedFrames: 8000,
    totalSamples: 256000,
    fileBytes: 1088000,
    droppedFrames: 0,
    trailingBytes: 0,
    processes: { generator: 101, recorder: 102 },
  };
  assert.equal(summarizeCliRecording(recorded, inspection).processSeparation, true);
  assert.throws(() => summarizeCliRecording({ ...recorded, status: 'failed' }, inspection));
  assert.throws(() => summarizeCliRecording({ ...recorded, droppedFrames: 1 }, inspection));
  assert.throws(() => summarizeCliRecording(recorded, { ...inspection, recordedFrames: 7999 }));
  assert.throws(() =>
    summarizeCliRecording(recorded, {
      ...inspection,
      processes: { generator: 101, recorder: 101 },
    }),
  );
});

test('retrieval checks independent float32 values in requested channel order', () => {
  const window = { start: 0, end: 1 };
  const values = [31, 2, 17, 0].map((channel) => independentHandoffSample(0, channel));
  assert.doesNotThrow(() => assertRetrievalObservations([{ index: 0, values }], window));
  const reordered = [values[1], values[0], values[2], values[3]];
  assert.throws(
    () => assertRetrievalObservations([{ index: 0, values: reordered }], window),
    /selected channel/,
  );
  assert.throws(
    () => assertRetrievalObservations([{ index: 0, values: [0, 0, 0, 0] }], window),
    /selected channel/,
  );
});

test('application startup and bounded shutdown failures cannot pass', async () => {
  assert.throws(
    () => assertApplicationStillRunning({ exitCode: 7, signalCode: null }),
    /exited early with code 7/,
  );
  assert.throws(
    () => assertApplicationStillRunning({ exitCode: null, signalCode: 'SIGTERM' }),
    /exited early with SIGTERM/,
  );
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  await assert.rejects(waitForChildClose(child, 5), /did not stop within 5 ms/);
  const closing = waitForChildClose(child, 100);
  child.emit('close', 0, null);
  assert.deepEqual(await closing, { code: 0, signal: null });
});

test('runtime tree digest ignores only T17 evidence and detects product changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'scope-t17-tree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs/evidence/t17'), { recursive: true });
  await writeFile(join(root, 'runtime.txt'), 'one');
  await writeFile(join(root, 'docs/evidence/t17/result.json'), 'first');
  await execute('git', ['init'], { cwd: root });
  await execute('git', ['add', '.'], { cwd: root });
  const initial = await runtimeTreeDigest(root);
  await writeFile(join(root, 'docs/evidence/t17/result.json'), 'second');
  assert.deepEqual(await runtimeTreeDigest(root), initial);
  await writeFile(join(root, 'runtime.txt'), 'two');
  assert.notEqual((await runtimeTreeDigest(root)).sha256, initial.sha256);
});

async function makeEvidenceFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scope-t17-validation-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'docs/evidence/t17');
  await mkdir(directory, { recursive: true });
  for (const name of ['traceability', 'rehearsal', 'video'])
    await cp(
      resolve(`docs/evidence/t17/${name}.schema.json`),
      join(directory, `${name}.schema.json`),
    );
  await writeFile(join(root, 'evidence.txt'), 'evidence');
  const entry = (id) => ({
    id,
    requirement: id,
    status: 'verified',
    implementation: ['evidence.txt'],
    tests: ['evidence.txt'],
    evidence: ['evidence.txt'],
    reproductionCommand: 'npm test',
    demoTimestamp: null,
  });
  const traceability = {
    schemaVersion: 'SCOPE-T17-TRACEABILITY/1',
    result: 'PASS',
    source: {
      title: 'Technical Assessment: Streaming Signal Capture and Playback',
      pages: 3,
      sha256: 'x',
      auditedAt: new Date().toISOString(),
    },
    pdfRequirements: Array.from({ length: 41 }, (_, index) =>
      entry(`P${String(index + 1).padStart(2, '0')}`),
    ),
    acceptanceScenarios: Array.from({ length: 30 }, (_, index) =>
      entry(`A${String(index + 1).padStart(2, '0')}`),
    ),
    limitations: [{ name: 'n', impact: 'i', rationale: 'r', nextWork: 'w' }],
  };
  const command = {
    command: 'npm test',
    exitCode: 0,
    signal: null,
    elapsedMs: 1,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutSha256: 'x',
    stderrSha256: 'y',
  };
  const requiredCommands = handoffCommandPlan().map(([commandName, args]) => ({
    ...command,
    command: [commandName, ...args].join(' '),
  }));
  const rehearsal = {
    schemaVersion: 'SCOPE-T17-HANDOFF/1',
    result: 'PASS',
    beganAt: 'x',
    completedAt: 'y',
    workload: 'quiet',
    source: {
      repository: 'x',
      requestedRef: 'x',
      commit: 'x',
      runtimeTree: { sha256: 'x', files: 1 },
    },
    environment: { platform: 'x', release: 'x', arch: 'x', node: 'v24', npm: '11' },
    steps: [
      { ...command, command: 'git clone --no-checkout source checkout' },
      { ...command, command: 'git checkout --detach x' },
      ...requiredCommands,
    ],
    server: {
      elapsedMs: 1,
      command: 'npm start',
      stateStatus: 200,
      pageStatus: 200,
      acquisitionStatus: 'idle',
      port: 1,
      exitCode: 0,
      signal: null,
      shutdownMs: 1,
      totalElapsedMs: 2,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutSha256: 'x',
      stderrSha256: 'y',
    },
    cli: {
      recording: {
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
        processSeparation: true,
      },
      retrieval: [{}, {}, {}],
      playback: {},
      verification: {
        result: 'PASS',
        recordsScanned: 8000,
        formatErrors: 0,
        missingSamples: 0,
        duplicatedSamples: 0,
        incorrectSamples: 0,
        elapsedMs: 1,
        peakRssBytes: 1,
      },
      commands: [command, command, command, command],
    },
  };
  const video = {
    schemaVersion: 'SCOPE-T17-VIDEO/1',
    status: 'reviewed',
    recordedAt: 'x',
    recordedCommit: 'x',
    runtimeTreeSha256: 'x',
    filename: 'scope-t17-demo.m4v',
    durationSeconds: 360,
    width: 1920,
    height: 1080,
    videoCodec: 'H.264',
    audioCodec: 'AAC',
    audioPresent: true,
    byteSize: 1,
    asset: {
      url: 'https://github.com/GowthamTG/anthriq/releases/download/t17-submission/scope-t17-demo.m4v',
      sha256: 'a'.repeat(64),
    },
    release: {
      tag: 't17-submission',
      url: 'https://github.com/GowthamTG/anthriq/releases/tag/t17-submission',
      visibility: 'private-repository-access',
    },
    shots: Array.from({ length: 8 }, (_, index) => ({
      id: String(index),
      timestamp: '00:00',
      description: 'shot',
      reviewed: true,
    })),
    review: {
      readable: true,
      truthful: true,
      audioClear: true,
      noCredentials: true,
      localPlaybackVerified: true,
      reviewedByOwner: true,
    },
  };
  for (const [name, value] of Object.entries({ traceability, rehearsal, video }))
    await writeFile(join(directory, `${name}.json`), `${JSON.stringify(value)}\n`);
  return { root, directory, traceability, video };
}

test('T17 validation requires exact traceability, reviewed video, and no broken local evidence', async (t) => {
  const fixture = await makeEvidenceFixture(t);
  await validateHandoffEvidence({
    directory: fixture.directory,
    root: fixture.root,
    checkRuntimeTree: false,
  });

  fixture.traceability.acceptanceScenarios[29].id = 'A29';
  await writeFile(
    join(fixture.directory, 'traceability.json'),
    JSON.stringify(fixture.traceability),
  );
  await assert.rejects(
    validateHandoffEvidence({
      directory: fixture.directory,
      root: fixture.root,
      checkRuntimeTree: false,
    }),
    /IDs must be unique|coverage must be exact/,
  );

  fixture.traceability.acceptanceScenarios[29].id = 'A30';
  fixture.traceability.pdfRequirements[0].evidence = ['missing.txt'];
  await writeFile(
    join(fixture.directory, 'traceability.json'),
    JSON.stringify(fixture.traceability),
  );
  await assert.rejects(
    validateHandoffEvidence({
      directory: fixture.directory,
      root: fixture.root,
      checkRuntimeTree: false,
    }),
    /ENOENT/,
  );

  fixture.traceability.pdfRequirements[0].evidence = ['evidence.txt'];
  fixture.video.status = 'pending';
  await writeFile(
    join(fixture.directory, 'traceability.json'),
    JSON.stringify(fixture.traceability),
  );
  await writeFile(join(fixture.directory, 'video.json'), JSON.stringify(fixture.video));
  await assert.rejects(
    validateHandoffEvidence({
      directory: fixture.directory,
      root: fixture.root,
      checkRuntimeTree: false,
    }),
    /const/,
  );
});

test('repository traceability covers exactly every PDF requirement and A01-A30', async () => {
  const traceability = JSON.parse(await readFile('docs/evidence/t17/traceability.json', 'utf8'));
  assert.equal(traceability.pdfRequirements.length, 41);
  assert.equal(traceability.acceptanceScenarios.length, 30);
  assert.equal(new Set(traceability.pdfRequirements.map(({ id }) => id)).size, 41);
  assert.equal(new Set(traceability.acceptanceScenarios.map(({ id }) => id)).size, 30);
  assert.ok(traceability.pdfRequirements.every(({ status }) => status === 'verified'));
  assert.ok(traceability.acceptanceScenarios.every(({ status }) => status === 'verified'));
});
