import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { Acquisition } from '../core/acquisition.ts';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(read, accept, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await sleep(20);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function visibleGapCount(preview) {
  let gaps = 0;
  for (let index = 1; index < preview.buckets.length; index++) {
    const previous = preview.buckets[index - 1].end - 1;
    const current = preview.buckets[index].end - 1;
    if (current - previous > preview.bucketFrames) gaps++;
  }
  return gaps;
}

async function decodePrefix(directory, channels, frameCount, recordBytes) {
  const bytes = await readFile(join(directory, 'frames.bin'));
  assert.ok(
    bytes.length >= frameCount * recordBytes,
    'the physical file must contain the snapshot-confirmed persisted prefix',
  );
  const frames = [];
  for (let ordinal = 0; ordinal < frameCount; ordinal++) {
    const offset = ordinal * recordBytes;
    frames.push({
      ordinal,
      index: Number(bytes.readBigUInt64LE(offset)),
      values: channels.map((channel) => bytes.readFloatLE(offset + 8 + channel * 4)),
    });
  }
  return { frames, physicalBytesAtRead: bytes.length };
}

async function proveSnapshot(label, acquisition, directory) {
  const snapshot = acquisition.snapshot('evidence-client');
  const preview = snapshot.preview;
  const persistedFrames =
    snapshot.status === 'completed'
      ? snapshot.metadata?.recordedFrames
      : snapshot.metrics?.recordedFrames;
  assert.ok(preview, `${label}: preview must be explicitly available`);
  assert.ok(preview.buckets.length > 0, `${label}: preview must contain observed buckets`);
  assert.ok(Number.isSafeInteger(persistedFrames), `${label}: persisted extent must be known`);
  const decoded = await decodePrefix(
    directory,
    preview.channels,
    persistedFrames,
    snapshot.settings.channels * 4 + 8,
  );
  const bucketResults = preview.buckets.map((bucket) => {
    const members = decoded.frames.filter(
      (frame) => frame.index >= bucket.start && frame.index < bucket.end,
    );
    assert.ok(members.length > 0, `${label}: every bucket must contain a persisted frame`);
    const minimum = preview.channels.map((_, channel) =>
      Math.min(...members.map((frame) => frame.values[channel])),
    );
    const maximum = preview.channels.map((_, channel) =>
      Math.max(...members.map((frame) => frame.values[channel])),
    );
    assert.deepEqual(bucket.minimum, minimum, `${label}: bucket minimum must match disk`);
    assert.deepEqual(bucket.maximum, maximum, `${label}: bucket maximum must match disk`);
    assert.ok(
      members.every((frame) => frame.ordinal < persistedFrames),
      `${label}: preview must not include an unpersisted offered frame`,
    );
    return {
      start: bucket.start,
      end: bucket.end,
      persistedMembers: members.length,
      minimum,
      maximum,
    };
  });
  const physicalGaps = decoded.frames.reduce(
    (count, frame, index) =>
      index > 0 && frame.index > decoded.frames[index - 1].index + 1 ? count + 1 : count,
    0,
  );
  const displayedEnd = preview.buckets.at(-1).end;
  return {
    label,
    lifecycle: snapshot.status,
    availability: 'available',
    channels: preview.channels,
    bucketFrames: preview.bucketFrames,
    capacity: preview.capacity,
    persistedFrames,
    physicalBytesAtRead: decoded.physicalBytesAtRead,
    originalFrameWindow: {
      start: preview.buckets[0].start,
      end: displayedEnd,
    },
    unavailablePersistedFrameRange:
      displayedEnd < persistedFrames
        ? {
            start: displayedEnd,
            end: persistedFrames,
            reason:
              'No later coalesced preview snapshot was published before this lifecycle state.',
          }
        : null,
    physicalGapCount: physicalGaps,
    visibleGapCount: visibleGapCount(preview),
    buckets: bucketResults,
  };
}

async function nominal(root) {
  const directory = join(root, 'nominal');
  const acquisition = new Acquisition(root);
  acquisition.subscribePreview('evidence-client', [3, 1]);
  acquisition.start(
    { channels: 4, sampleRate: 800, seconds: 3, displayName: 'Preview provenance nominal' },
    directory,
  );
  await until(
    () => Promise.resolve(acquisition.snapshot('evidence-client')),
    (state) => state.status === 'recording' && (state.preview?.buckets.length ?? 0) >= 24,
    'recording preview',
  );
  const recording = await proveSnapshot('recording', acquisition, directory);
  acquisition.stop();
  const stopping = await proveSnapshot('stopping', acquisition, directory);
  await acquisition.finished;
  const completed = await proveSnapshot('completed', acquisition, directory);
  return [recording, stopping, completed];
}

async function completedWithLoss(root) {
  const directory = join(root, 'completed-with-loss');
  const acquisition = new Acquisition(root);
  acquisition.subscribePreview('evidence-client', [3, 1]);
  acquisition.start(
    {
      channels: 4,
      sampleRate: 4000,
      seconds: 4,
      bufferBytes: 8192,
      stallAfterSeconds: 0.5,
      stallForMs: 2000,
      displayName: 'Preview provenance overload',
    },
    directory,
  );
  const final = await acquisition.finished;
  assert.equal(final.status, 'completed');
  assert.ok((final.metadata?.droppedFrames ?? 0) > 0, 'overload fixture must retain declared loss');
  const result = await proveSnapshot('completed-with-loss', acquisition, directory);
  assert.ok(result.physicalGapCount > 0, 'loss fixture must contain a physical index gap');
  assert.ok(result.visibleGapCount > 0, 'loss fixture must expose a visible preview gap');
  return result;
}

async function failedPrefix(root) {
  const directory = join(root, 'failed-prefix');
  const acquisition = new Acquisition(root);
  acquisition.subscribePreview('evidence-client', [3, 1]);
  acquisition.start(
    { channels: 4, sampleRate: 800, seconds: 0, displayName: 'Preview provenance failure' },
    directory,
  );
  const active = await until(
    () => Promise.resolve(acquisition.snapshot('evidence-client')),
    (state) => state.status === 'recording' && (state.preview?.buckets.length ?? 0) >= 24,
    'failed-prefix source preview',
  );
  process.kill(active.metadata.processes.generator, 'SIGKILL');
  const final = await acquisition.finished;
  assert.equal(final.status, 'failed');
  return proveSnapshot('readable-failed-prefix', acquisition, directory);
}

export async function runPreviewEvidence({ recordingsRoot, output } = {}) {
  const root = resolve(
    recordingsRoot ??
      join('recordings', `issue-35-${new Date().toISOString().replaceAll(':', '-')}`),
  );
  await mkdir(root, { recursive: true });
  const states = [
    ...(await nominal(root)),
    await completedWithLoss(root),
    await failedPrefix(root),
  ];
  const result = {
    format: 'SCOPE-PREVIEW-EVIDENCE/1',
    createdAt: new Date().toISOString(),
    environment: {
      platform: platform(),
      release: release(),
      architecture: process.arch,
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      node: process.version,
    },
    recordingRoot: relative(process.cwd(), root),
    states,
    result: 'PASS',
  };
  if (output) {
    const destination = resolve(output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await format(JSON.stringify(result), { parser: 'json' }));
  }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--output');
  const rootIndex = process.argv.indexOf('--recordings-root');
  const result = await runPreviewEvidence({
    output: outputIndex >= 0 ? process.argv[outputIndex + 1] : 'docs/evidence/issue-35/result.json',
    recordingsRoot: rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined,
  });
  process.stdout.write(
    `${JSON.stringify({ result: result.result, states: result.states.map((state) => state.label) })}\n`,
  );
}
