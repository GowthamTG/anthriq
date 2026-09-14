import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, open, readFile, stat, statfs, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { format } from 'prettier';
import { validateAcquisitionEvidence } from './validate-acquisition-evidence.mjs';

const execute = promisify(execFile);
const DEFAULTS = { channels: 32, sampleRate: 4000, seconds: 3600, seed: 42, bufferBytes: 4194304 };
const RECORD_BYTES = 8 + DEFAULTS.channels * 4;

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [code, signal] = await once(child, 'close');
  return { code, signal, stdout, stderr };
}

async function latestMetric(directory) {
  let file;
  try {
    file = await open(join(directory, 'metrics.jsonl'), 'r');
    const { size } = await file.stat();
    const length = Math.min(size, 65536);
    if (!length) return null;
    const buffer = Buffer.allocUnsafe(length);
    await file.read(buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').trim().split('\n');
    for (let index = lines.length - 1; index >= 0; index--)
      try {
        return JSON.parse(lines[index]);
      } catch {
        // A concurrent append can leave only the last line incomplete.
      }
    return null;
  } catch {
    return null;
  } finally {
    await file?.close();
  }
}

function memoryWindow(rows, start, end, label) {
  const selected = rows.filter((row) => {
    const elapsed = row.generator?.elapsedSeconds ?? row.elapsedSeconds;
    return elapsed >= start && elapsed < end;
  });
  assert.ok(selected.length > 0, `${label} memory window has no measurements`);
  const stats = (values) => ({
    minimumBytes: Math.min(...values),
    maximumBytes: Math.max(...values),
    meanBytes: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
  });
  return {
    label,
    startSeconds: start,
    endSeconds: end,
    measurements: selected.length,
    generatorRss: stats(selected.map((row) => row.generator.rssBytes)),
    recorderRss: stats(selected.map((row) => row.recorderRssBytes)),
    maximumQueueBytes: Math.max(...selected.map((row) => row.queueBytes)),
    maximumOutstandingBytes: Math.max(...selected.map((row) => row.generator.outstandingBytes)),
  };
}

function windows(rows, seconds) {
  if (seconds >= 900)
    return [
      memoryWindow(rows, 0, 300, 'warmup'),
      memoryWindow(rows, seconds / 2 - 150, seconds / 2 + 150, 'middle'),
      memoryWindow(rows, seconds - 300, seconds, 'late'),
    ];
  const width = seconds / 3;
  return [
    memoryWindow(rows, 0, width, 'warmup'),
    memoryWindow(rows, width, width * 2, 'middle'),
    memoryWindow(rows, width * 2, seconds, 'late'),
  ];
}

function compareMemory(memoryWindows) {
  const [warmup, middle, late] = memoryWindows;
  return {
    equalWindowDurationSeconds: warmup.endSeconds - warmup.startSeconds,
    generatorMeanRssChangeBytes: {
      middleMinusWarmup: middle.generatorRss.meanBytes - warmup.generatorRss.meanBytes,
      lateMinusWarmup: late.generatorRss.meanBytes - warmup.generatorRss.meanBytes,
    },
    recorderMeanRssChangeBytes: {
      middleMinusWarmup: middle.recorderRss.meanBytes - warmup.recorderRss.meanBytes,
      lateMinusWarmup: late.recorderRss.meanBytes - warmup.recorderRss.meanBytes,
    },
    interpretation:
      'Observed RSS is reported separately from fixed transport, recorder-queue, measurement-frequency, and verifier-chunk bounds.',
  };
}

async function record(directory, settings) {
  const child = spawn(
    process.execPath,
    [
      'core/cli.ts',
      'record',
      directory,
      '--channels',
      String(settings.channels),
      '--sample-rate',
      String(settings.sampleRate),
      '--seed',
      String(settings.seed),
      '--seconds',
      String(settings.seconds),
      '--buffer-bytes',
      String(settings.bufferBytes),
      '--display-name',
      settings.displayName,
      ...(settings.stallForMs
        ? [
            '--stall-after-seconds',
            String(settings.stallAfterSeconds),
            '--stall-for-ms',
            String(settings.stallForMs),
          ]
        : []),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  let readingProgress = false;
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const progress = setInterval(async () => {
    if (readingProgress) return;
    readingProgress = true;
    try {
      const metric = await latestMetric(directory);
      if (metric)
        process.stdout.write(
          `${JSON.stringify({
            progress: true,
            elapsedSeconds: metric.generator?.elapsedSeconds ?? metric.elapsedSeconds,
            scheduledFrames: metric.generator?.scheduledFrames,
            persistedFrames: metric.recordedFrames,
            lostFrames: metric.droppedFrames,
            generatorRssBytes: metric.generator?.rssBytes,
            recorderRssBytes: metric.recorderRssBytes,
            queueBytes: metric.queueBytes,
          })}\n`,
        );
    } finally {
      readingProgress = false;
    }
  }, 30000);
  const [code, signal] = await once(child, 'close');
  clearInterval(progress);
  assert.equal(code, 0, stderr || `recording exited with ${signal}`);
  return JSON.parse(stdout.trim());
}

async function overloadEvidence(directory) {
  await record(directory, {
    ...DEFAULTS,
    seconds: 4,
    bufferBytes: 8192,
    stallAfterSeconds: 0.5,
    stallForMs: 2000,
    displayName: 'T15 controlled overload recovery',
  });
  const verification = await run(process.execPath, ['core/cli.ts', 'verify', directory]);
  assert.equal(verification.code, 1, 'loss-bearing overload verification must fail integrity');
  const [metadata, losses] = await Promise.all([
    readFile(join(directory, 'metadata.json'), 'utf8').then(JSON.parse),
    readFile(join(directory, 'losses.jsonl'), 'utf8').then((text) =>
      text.trim().split('\n').filter(Boolean).map(JSON.parse),
    ),
  ]);
  assert.ok(metadata.droppedFrames > 0);
  assert.equal(metadata.recordedFrames + metadata.droppedFrames, metadata.expectedFrames);
  assert.equal(metadata.generator.scheduledFrames, metadata.expectedFrames);
  assert.equal(
    metadata.generator.emittedFrames + metadata.generator.droppedFrames,
    metadata.expectedFrames,
  );
  assert.ok(losses.length > 0);
  assert.ok(losses.every((loss) => loss.frames === loss.endFrameExclusive - loss.startFrame));
  assert.equal(
    losses.reduce((total, loss) => total + loss.frames, 0),
    metadata.droppedFrames,
  );
  const report = JSON.parse(verification.stdout);
  assert.equal(report.counts.expectedFrames, metadata.expectedFrames);
  assert.equal(report.counts.recordedFrames, metadata.recordedFrames);
  assert.equal(report.discrepancies.missing.samples, metadata.droppedFrames * metadata.channels);
  assert.equal(report.discrepancies.duplicated.samples, 0);
  assert.equal(report.discrepancies.incorrect.samples, 0);
  assert.equal(report.formatErrors.count, 0);
  return {
    recordingId: metadata.id,
    expectedFrames: metadata.expectedFrames,
    scheduledFrames: metadata.generator.scheduledFrames,
    emittedFrames: metadata.generator.emittedFrames,
    persistedFrames: metadata.recordedFrames,
    lostFrames: metadata.droppedFrames,
    lossIntervals: losses,
    recovered: metadata.recorderStall === 'recovered',
    verification: report,
  };
}

async function browserComparison() {
  const evidence = '../issue-36/summary.json';
  const physicalVerificationEvidence = 'browser-verification.json';
  const [source, physical] = await Promise.all(
    [evidence, physicalVerificationEvidence].map(async (path) =>
      JSON.parse(await readFile(resolve('docs/evidence/t15', path), 'utf8')),
    ),
  );
  assert.equal(source.result, 'PASS');
  assert.equal(source.cases.length, 6);
  assert.ok(source.cases.every((item) => item.lostFrames === 0));
  assert.equal(physical.result, 'PASS');
  assert.deepEqual(
    physical.cases.map(({ name, verification }) => [name, verification.recordingId]),
    source.cases.map(({ name, recordingId }) => [name, recordingId]),
  );
  return {
    evidence,
    physicalVerificationEvidence,
    result: source.result,
    cases: source.cases.length,
    physicallyVerifiedCases: physical.cases.length,
  };
}

export async function runAcquisitionBenchmark({
  workload,
  seconds = DEFAULTS.seconds,
  outputDirectory = 'docs/evidence/t15',
  recordingDirectory,
  includeOverload = true,
} = {}) {
  assert.ok(
    ['quiet', 'ui', 'development'].includes(workload),
    'Declare --workload quiet|ui|development',
  );
  assert.ok(
    Number.isFinite(seconds) && seconds >= 3,
    'Benchmark duration must be at least 3 seconds',
  );
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const directory = resolve(recordingDirectory ?? join('recordings', `t15-${stamp}`));
  const output = resolve(outputDirectory);
  await Promise.all([
    mkdir(dirname(directory), { recursive: true }),
    mkdir(output, { recursive: true }),
  ]);
  await assert.rejects(stat(directory), { code: 'ENOENT' });
  const storage = await statfs(dirname(directory));
  const expectedFrameBytes = Math.floor(seconds * DEFAULTS.sampleRate) * RECORD_BYTES;
  const freeBytesBefore = storage.bavail * storage.bsize;
  assert.ok(
    freeBytesBefore >= expectedFrameBytes * 1.2 + 100 * 1024 * 1024,
    'Insufficient free disk for the recording plus evidence margin',
  );
  const npmVersion = (await execute('npm', ['--version'])).stdout.trim();
  const environment = {
    capturedAt: new Date().toISOString(),
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    storage: {
      path: relative(process.cwd(), dirname(directory)) || '.',
      fileSystemTypeCode: storage.type,
      blockSizeBytes: storage.bsize,
      totalBytes: storage.blocks * storage.bsize,
      freeBytesBefore,
    },
    node: process.version,
    npm: npmVersion,
    workload,
    uiOrHeavyWorkActive: workload !== 'quiet',
    workloadDeclaration:
      workload === 'quiet'
        ? 'No UI or development work was intentionally active during the benchmark.'
        : `The declared ${workload} workload was active; this is not presented as a quiet run.`,
    clockMethod: 'generator process.hrtime.bigint(); recorder performance.now()',
  };
  const began = performance.now();
  await record(directory, {
    ...DEFAULTS,
    seconds,
    stallAfterSeconds: 0,
    stallForMs: 0,
    displayName: `T15 sustained ${seconds}-second benchmark`,
  });
  const acquisitionWallMs = performance.now() - began;
  const verification = await run(process.execPath, ['core/cli.ts', 'verify', directory]);
  assert.equal(verification.code, 0, verification.stderr);
  const report = JSON.parse(verification.stdout);
  const [metadata, frameStat, metricsText, lossesText] = await Promise.all([
    readFile(join(directory, 'metadata.json'), 'utf8').then(JSON.parse),
    stat(join(directory, 'frames.bin')),
    readFile(join(directory, 'metrics.jsonl'), 'utf8'),
    readFile(join(directory, 'losses.jsonl'), 'utf8'),
  ]);
  const metrics = metricsText.trim().split('\n').filter(Boolean).map(JSON.parse);
  const expectedFrames = Math.floor(seconds * DEFAULTS.sampleRate);
  assert.equal(metadata.expectedFrames, expectedFrames);
  assert.equal(metadata.recordedFrames, expectedFrames);
  assert.equal(metadata.totalSamples, expectedFrames * DEFAULTS.channels);
  assert.equal(frameStat.size, expectedFrames * RECORD_BYTES);
  assert.equal(metadata.droppedFrames, 0);
  assert.equal(lossesText, '');
  assert.equal(metadata.generator.scheduledFrames, expectedFrames);
  assert.equal(metadata.generator.emittedFrames, expectedFrames);
  assert.equal(metadata.generator.droppedFrames, 0);
  assert.ok(metadata.generator.peakOutstandingBytes <= DEFAULTS.bufferBytes);
  assert.ok(metadata.peakQueueBytes <= DEFAULTS.bufferBytes);
  assert.equal(report.result, 'PASS');
  assert.deepEqual(report.discrepancies, {
    missing: { samples: 0, first: null },
    duplicated: { samples: 0, first: null },
    incorrect: { samples: 0, first: null },
  });
  assert.equal(report.formatErrors.count, 0);
  const overload = includeOverload
    ? await overloadEvidence(`${directory}-controlled-overload`)
    : null;
  const memoryWindows = windows(metrics, seconds);
  const summary = {
    format: 'SCOPE-ACQUISITION-BENCHMARK/1',
    createdAt: new Date().toISOString(),
    target: {
      agreedEngineeringDurationSeconds: 3600,
      assessmentMandatedDuration: false,
      achieved: seconds === 3600,
    },
    environment,
    configuration: { ...DEFAULTS, seconds, recordBytes: RECORD_BYTES },
    recording: {
      id: metadata.id,
      localDirectory: relative(process.cwd(), directory),
      wallElapsedMs: acquisitionWallMs,
      sourceElapsedSeconds: metadata.generator.elapsedSeconds,
      expectedFrames,
      scheduledFrames: metadata.generator.scheduledFrames,
      emittedFrames: metadata.generator.emittedFrames,
      persistedFrames: metadata.recordedFrames,
      lostFrames: metadata.droppedFrames,
      scalarSamples: metadata.totalSamples,
      frameBytes: frameStat.size,
      bytesPerSecond: frameStat.size / metadata.generator.elapsedSeconds,
      sourcePacing: {
        maximumLagMs: metadata.generator.maxLagMs,
        pacingErrorFrames: metadata.generator.pacingErrorFrames,
        emissionDeficitFrames: metadata.generator.emissionDeficitFrames,
        maximumEmissionGapMs: metadata.generator.maxEmissionGapMs,
      },
      bounds: {
        configuredTransportBytes: DEFAULTS.bufferBytes,
        peakOutstandingBytes: metadata.generator.peakOutstandingBytes,
        peakRecorderQueueBytes: metadata.peakQueueBytes,
      },
      peakMemory: {
        generatorRssBytes: metadata.generator.peakRssBytes,
        recorderRssBytes: metadata.recorderPeakRssBytes,
      },
    },
    memoryWindows,
    memoryComparison: compareMemory(memoryWindows),
    verification: report,
    controlledOverload: overload,
    browserComparison: await browserComparison(),
    constantResourceBounds: {
      transportBytes: DEFAULTS.bufferBytes,
      recorderQueueBytes: DEFAULTS.bufferBytes,
      measurementHistory: 'streamed to metrics.jsonl at no more than one row per second',
      verifierChunkBytes: 65536,
    },
    result: 'PASS',
  };
  await Promise.all([
    copyFile(join(directory, 'metadata.json'), join(output, 'metadata.json')),
    copyFile(join(directory, 'losses.jsonl'), join(output, 'losses.jsonl')),
    copyFile(join(directory, 'metrics.jsonl'), join(output, 'metrics.jsonl')),
    copyFile(join(directory, 'verification.json'), join(output, 'verification.json')),
    writeFile(
      join(output, 'environment.json'),
      await format(JSON.stringify(environment), { parser: 'json' }),
    ),
    writeFile(
      join(output, 'run-summary.json'),
      await format(JSON.stringify(summary), { parser: 'json' }),
    ),
  ]);
  await validateAcquisitionEvidence(output);
  process.stdout.write(
    `${JSON.stringify({ result: summary.result, recording: summary.recording.localDirectory, targetAchieved: summary.target.achieved })}\n`,
  );
  return summary;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await runAcquisitionBenchmark({
    workload: option('--workload'),
    seconds: option('--seconds') === undefined ? DEFAULTS.seconds : Number(option('--seconds')),
    outputDirectory: option('--output-directory') ?? 'docs/evidence/t15',
    recordingDirectory: option('--recording'),
    includeOverload: !process.argv.includes('--skip-overload'),
  });
