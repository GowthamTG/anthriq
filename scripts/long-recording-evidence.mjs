import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { arch, cpus, platform, release, totalmem } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { format } from 'prettier';
import { PLAYBACK_LIMITS } from '../core/playback.ts';
import { RANGE_READ_CHUNK_BYTES } from '../core/storage.ts';
import { validateLongRecordingEvidence } from './validate-long-recording-evidence.mjs';

const FULL_RECORDING = Object.freeze({
  id: 't15-sustained-2026-09-14',
  channels: 32,
  sampleRate: 4000,
  seed: 42,
  expectedFrames: 14_400_000,
  frameBytes: 1_958_400_000,
});
const SELECTED_CHANNELS = Object.freeze([31, 2, 17, 0]);
const WORKLOADS = new Set(['quiet', 'development', 'ui']);
const PLATFORM_CONTEXT_KEYS = Object.freeze([
  'platform',
  'release',
  'architecture',
  'cpu',
  'logicalCpuCount',
  'totalMemoryBytes',
  'node',
]);

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function jsonText(value) {
  return format(JSON.stringify(value), { parser: 'json' });
}

function currentEnvironment() {
  return {
    platform: platform(),
    release: release(),
    architecture: arch(),
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
    node: process.version,
  };
}

export function comparePlatformContext(recorded, current) {
  const fields = Object.fromEntries(
    PLATFORM_CONTEXT_KEYS.map((key) => [
      key,
      { recorded: recorded[key], current: current[key], matched: recorded[key] === current[key] },
    ]),
  );
  return {
    matched: Object.values(fields).every((field) => field.matched),
    fields,
  };
}

function fileIdentity(info) {
  return {
    dev: String(info.dev),
    ino: String(info.ino),
    size: Number(info.size),
    mtimeNs: String(info.mtimeNs),
  };
}

async function checkedFiles(recording) {
  const [metadata, frames] = await Promise.all([
    stat(join(recording, 'metadata.json'), { bigint: true }),
    stat(join(recording, 'frames.bin'), { bigint: true }),
  ]);
  return { metadata: fileIdentity(metadata), frames: fileIdentity(frames) };
}

async function run(command, arguments_, options = {}) {
  const child = spawn(command, arguments_, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const [code, signal] = await once(child, 'close');
  assert.equal(code, 0, stderr || `${command} exited with ${signal}`);
  return stdout;
}

async function runWorker(request, measurements) {
  const child = spawn(
    process.execPath,
    ['scripts/long-recording-worker.mjs', JSON.stringify(request)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stderr = '';
  let result;
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  for await (const line of createInterface({ input: child.stdout })) {
    const message = JSON.parse(line);
    if (message.type === 'measurement')
      await measurements.write(
        `${JSON.stringify({ ...message, worker: request.label ?? request.mode })}\n`,
      );
    else if (message.type === 'result') result = message.result;
  }
  const [code, signal] = await once(child, 'close');
  assert.equal(code, 0, stderr || `${request.mode} worker exited with ${signal}`);
  assert.ok(result, `${request.mode} worker did not return a result`);
  return result;
}

function profile(metadata, kind) {
  const full = kind === 'full';
  const sampleRate = metadata.sampleRate;
  const frames = metadata.expectedFrames;
  const sourceFrames = full ? 12 * sampleRate : Math.max(8, Math.round(sampleRate * 0.3));
  const rangeFrames = full ? sampleRate : Math.min(sampleRate, frames);
  const lastRange = frames - rangeFrames;
  const rangeStarts = full ? [0, 7_200_000, 14_396_000] : [0, Math.floor(frames / 2), lastRange];
  const seeks = full ? [0, 7_200_000, 14_399_999] : [0, Math.floor(frames / 2), frames - 1];
  const starts = [0, 0.2, 0.4, 0.6, 1].map((fraction, index) =>
    index === 4
      ? frames - sourceFrames
      : Math.min(frames - sourceFrames, Math.floor(frames * fraction)),
  );
  return {
    full,
    retrieval: [
      ...rangeStarts.map((start, index) => ({
        kind: 'window',
        label: `window-${['beginning', 'middle', 'end'][index]}`,
        start,
        end: start + rangeFrames,
      })),
      ...seeks.map((start, index) => ({
        kind: 'seek',
        label: `seek-${['beginning', 'middle', 'end'][index]}`,
        start,
        end: start + 1,
      })),
    ],
    playback: {
      speeds: full ? [0.25, 0.5, 1, 2, 4] : [1, 2],
      starts,
      sourceFrames,
      pacingToleranceFraction: full ? 0.1 : 0.5,
    },
    export: {
      consumerDelayMs: full ? 5 : 1,
      delayEveryRows: full ? 2048 : 32,
    },
    transition: {
      segmentFrames: full ? 8000 : Math.max(4, Math.round(sampleRate * 0.1)),
      pauseMs: full ? 2000 : 40,
      playingSeekDelayMs: full ? 500 : 20,
      nearEnd: full ? frames - 8000 : Math.max(0, frames - Math.max(8, sampleRate)),
    },
    slowSinkFrames: full ? 12 * sampleRate : sourceFrames,
  };
}

function discrepancySamples(report) {
  return ['missing', 'duplicated', 'incorrect'].reduce(
    (sum, kind) => sum + report.discrepancies[kind].samples,
    0,
  );
}

export async function runLongRecordingEvidence({
  recording,
  workload,
  outputDirectory = 'docs/evidence/t16',
  evidenceProfile = 'full',
} = {}) {
  assert.ok(recording, '--recording is required');
  assert.ok(isAbsolute(recording), '--recording must be an explicit absolute path');
  assert.ok(workload, '--workload is required');
  assert.ok(WORKLOADS.has(workload), '--workload must be quiet, development, or ui');
  assert.ok(['full', 'test'].includes(evidenceProfile), 'unknown evidence profile');
  const output = resolve(outputDirectory);
  const [metadata, t15, t15Verification] = await Promise.all([
    json(join(recording, 'metadata.json')),
    json(resolve('docs/evidence/t15/run-summary.json')),
    json(resolve('docs/evidence/t15/verification.json')),
  ]);
  const identityBefore = await checkedFiles(recording);
  const environment = currentEnvironment();
  const platformContext = comparePlatformContext(t15.environment, environment);
  assert.equal(metadata.status, 'completed');
  assert.equal(metadata.recordedFrames, metadata.expectedFrames);
  assert.equal(metadata.droppedFrames, 0);
  if (evidenceProfile === 'full') {
    for (const key of ['id', 'channels', 'sampleRate', 'seed', 'expectedFrames'])
      assert.equal(metadata[key], FULL_RECORDING[key], `retained recording ${key}`);
    assert.equal(identityBefore.frames.size, FULL_RECORDING.frameBytes);
    assert.deepEqual(identityBefore, t15Verification.checkedFiles);
    assert.equal(t15.verification.result, 'PASS');
    assert.equal(t15.recording.persistedFrames, FULL_RECORDING.expectedFrames);
    assert.equal(platformContext.matched, true, 'current platform context must match T15');
  }
  assert.ok(metadata.channels > Math.max(...SELECTED_CHANNELS));
  const settings = profile(metadata, evidenceProfile);
  const expectedAmplification = metadata.recordBytes / (SELECTED_CHANNELS.length * 4);
  await mkdir(output, { recursive: true });
  const measurements = await open(join(output, 'measurements.jsonl'), 'w');
  let retrieval;
  let exportResult;
  let playbackCases;
  let slowSink;
  let transitionResult;
  let verification;
  try {
    retrieval = [];
    for (const item of settings.retrieval)
      retrieval.push(
        await runWorker(
          {
            mode: 'retrieval',
            recording,
            channels: SELECTED_CHANNELS,
            ...item,
          },
          measurements,
        ),
      );
    exportResult = await runWorker(
      {
        mode: 'export',
        label: 'complete-streamed-export',
        recording,
        channels: SELECTED_CHANNELS,
        start: 0,
        end: metadata.expectedFrames,
        ...settings.export,
      },
      measurements,
    );
    playbackCases = [];
    for (const [index, speed] of settings.playback.speeds.entries())
      playbackCases.push(
        await runWorker(
          {
            mode: 'playback',
            label: `playback-${speed}x`,
            recording,
            channels: SELECTED_CHANNELS,
            start: settings.playback.starts[index],
            speed,
            sourceFrames: settings.playback.sourceFrames,
            sinkDelayMs: 0,
            pacingToleranceFraction: settings.playback.pacingToleranceFraction,
            requireLag: false,
          },
          measurements,
        ),
      );
    slowSink = await runWorker(
      {
        mode: 'playback',
        label: 'playback-4x-slow-sink',
        recording,
        channels: SELECTED_CHANNELS,
        start: Math.max(0, metadata.expectedFrames - settings.slowSinkFrames),
        speed: 4,
        sourceFrames: settings.slowSinkFrames,
        sinkDelayMs: 25,
        pacingToleranceFraction: null,
        requireLag: true,
      },
      measurements,
    );
    transitionResult = await runWorker(
      {
        mode: 'transitions',
        label: 'playback-transitions',
        recording,
        initialChannels: SELECTED_CHANNELS,
        middleChannels: [0, 31],
        finalChannels: SELECTED_CHANNELS,
        middle: Math.floor(metadata.expectedFrames / 2),
        awaitingPostSeek: false,
        ...settings.transition,
      },
      measurements,
    );
    verification = JSON.parse(await run(process.execPath, ['core/cli.ts', 'verify', recording]));
  } finally {
    await measurements.close();
  }
  const identityAfter = await checkedFiles(recording);
  assert.deepEqual(identityAfter, identityBefore, 'checked recording identity changed');
  assert.deepEqual(verification.checkedFiles, identityBefore);
  assert.equal(verification.recordingId, metadata.id);
  assert.equal(verification.counts.recordedFrames, metadata.expectedFrames);
  assert.equal(verification.execution.recordsScanned, metadata.expectedFrames);
  assert.equal(discrepancySamples(verification), 0);
  assert.equal(verification.formatErrors.count, 0);
  assert.equal(verification.result, 'PASS');
  await writeFile(join(output, 'verification.json'), await jsonText(verification));

  const pacingCases = playbackCases.map((item) => ({
    ...item,
    engineeringToleranceFraction: settings.playback.pacingToleranceFraction,
    withinEngineeringTolerance:
      Math.abs(item.achievedSpeed - item.speed) / item.speed <=
      settings.playback.pacingToleranceFraction,
  }));
  const summary = {
    format: 'SCOPE-LONG-RECORDING-EVIDENCE/1',
    createdAt: new Date().toISOString(),
    result: 'PASS',
    workload: {
      declaration: workload,
      quietWindow: workload === 'quiet',
      statement:
        workload === 'quiet'
          ? 'No UI or development work was intentionally active during final measurements.'
          : `Measurements were explicitly declared under a ${workload} workload.`,
    },
    environment,
    t15Reference: {
      evidence: '../t15/run-summary.json',
      verificationEvidence: '../t15/verification.json',
      recordedEnvironment: t15.environment,
      identityMatched: evidenceProfile === 'full',
      platformContext,
    },
    recording: {
      id: metadata.id,
      localDirectory: relative(process.cwd(), recording),
      absolutePathRequired: true,
      channels: metadata.channels,
      sampleRateFramesPerSecond: metadata.sampleRate,
      seed: metadata.seed,
      expectedFrames: metadata.expectedFrames,
      durationSeconds: metadata.duration,
      recordBytes: metadata.recordBytes,
      frameFileBytes: identityBefore.frames.size,
      status: metadata.status,
      checkedFiles: identityBefore,
    },
    workloadConfiguration: {
      profile: evidenceProfile,
      selectedChannels: SELECTED_CHANNELS,
      retrievalRepetitions: { warmup: 1, measured: 5 },
      exportConsumerDelayMilliseconds: settings.export.consumerDelayMs,
      exportDelayEveryDataRows: settings.export.delayEveryRows,
      playbackSourceTimelineSeconds: settings.playback.sourceFrames / metadata.sampleRate,
      playbackEngineeringToleranceFraction: settings.playback.pacingToleranceFraction,
      slowSinkDelayMillisecondsPerAcceptedBatch: 25,
      transitionPausedMilliseconds: settings.transition.pauseMs,
    },
    units: {
      bytes: 'bytes',
      elapsed: 'milliseconds',
      rate: 'frames or samples per second as named',
      lag: 'frames or milliseconds as named',
      positions: 'zero-based frame indices; range ends are exclusive',
    },
    bounds: {
      rangeReadBytes: RANGE_READ_CHUNK_BYTES,
      playback: PLAYBACK_LIMITS,
      exportRetention: 'SHA-256 and counters only; CSV bytes are not retained',
      measurementHistory: 'streamed to measurements.jsonl',
    },
    expectedAmplification: {
      value: expectedAmplification,
      formula: 'recordBytes / (selectedChannelCount * float32Bytes)',
      excludes: 'extent and lower-bound index probe bytes',
    },
    retrieval,
    export: exportResult,
    playback: {
      pacingTolerance:
        'Explicit project engineering evidence tolerance; not an assessment requirement.',
      cases: pacingCases,
      transitions: transitionResult,
      slowSink: {
        ...slowSink,
        noDroppedOrDuplicatedOutput: slowSink.identity.frames === slowSink.emittedFrames,
        interpretation:
          'The engine preserves data and position while bounded catch-up can extend completion.',
      },
    },
    verification: {
      format: verification.format,
      recordsScanned: verification.execution.recordsScanned,
      bytesScanned: verification.execution.bytesScanned,
      elapsedMs: verification.execution.elapsedMs,
      finalRssBytes: verification.execution.rssBytes,
      peakRssBytes: verification.execution.peakRssBytes,
      discrepancySamples: discrepancySamples(verification),
      formatErrors: verification.formatErrors.count,
      result: verification.result,
    },
  };
  await writeFile(join(output, 'summary.json'), await jsonText(summary));
  await validateLongRecordingEvidence(output);
  return summary;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const summary = await runLongRecordingEvidence({
    recording: option('--recording'),
    workload: option('--workload'),
    outputDirectory: option('--output') ?? 'docs/evidence/t16',
  });
  process.stdout.write(
    `${JSON.stringify({ result: summary.result, recordingId: summary.recording.id })}\n`,
  );
}
