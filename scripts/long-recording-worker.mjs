import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { csvHeader, csvLines } from '../core/export.ts';
import { createRangeReadMetrics, RANGE_READ_CHUNK_BYTES, readFrames } from '../core/storage.ts';
import { Playback, PLAYBACK_LIMITS } from '../core/playback.ts';

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const peakRssBytes = () => process.resourceUsage().maxRSS * 1024;
const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

function independentSample(index, channel, { sampleRate, seed }) {
  const period = Math.max(8, Math.round(sampleRate / (2 + channel * 0.37)));
  const triangle = (phase, length) => 1 - 4 * Math.abs(phase / length - 0.5);
  const phase = ((index % period) + ((channel * 97 + seed) % period)) % period;
  const fastPeriod = Math.max(4, Math.round(period / 7));
  const fastPhase = ((index % fastPeriod) + (seed % fastPeriod)) % fastPeriod;
  return Math.fround(0.8 * triangle(phase, period) + 0.12 * triangle(fastPhase, fastPeriod));
}

function checker(metadata, channels, expectedIndex) {
  let next = expectedIndex;
  let count = 0;
  const digest = createHash('sha256');
  return {
    accept(frame) {
      assert.equal(frame.index, next, `expected frame ${next}, received ${frame.index}`);
      assert.equal(frame.values.length, channels.length);
      frame.values.forEach((actual, offset) =>
        assert.ok(
          Object.is(actual, independentSample(frame.index, channels[offset], metadata)),
          `incorrect value at frame ${frame.index}, channel ${channels[offset]}`,
        ),
      );
      const identity = Buffer.allocUnsafe(8);
      identity.writeBigUInt64LE(BigInt(frame.index));
      digest.update(identity);
      frame.values.forEach((value) => {
        const bytes = Buffer.allocUnsafe(4);
        bytes.writeFloatLE(value);
        digest.update(bytes);
      });
      next++;
      count++;
    },
    snapshot() {
      return { firstIndex: expectedIndex, nextIndex: next, frames: count };
    },
    digest() {
      return digest.digest('hex');
    },
  };
}

function statistics(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    first: values[0],
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    minimum: sorted[0],
    maximum: sorted.at(-1),
  };
}

async function retrieval(request, metadata) {
  const repetitions = [];
  for (let repetition = 0; repetition < 6; repetition++) {
    const metrics = createRangeReadMetrics();
    const checked = checker(metadata, request.channels, request.start);
    const rssBeforeBytes = process.memoryUsage().rss;
    const began = performance.now();
    for await (const frame of readFrames(
      request.recording,
      { start: request.start, end: request.end, channels: request.channels },
      metrics,
    ))
      checked.accept(frame);
    const elapsedMs = performance.now() - began;
    const identity = checked.snapshot();
    assert.equal(identity.nextIndex, request.end);
    assert.ok(metrics.maximumReadBytes <= RANGE_READ_CHUNK_BYTES);
    repetitions.push({
      elapsedMs,
      rssBeforeBytes,
      rssAfterBytes: process.memoryUsage().rss,
      processPeakRssBytes: peakRssBytes(),
      metrics,
      identity,
      digestSha256: checked.digest(),
    });
  }
  const measured = repetitions.slice(1);
  const metricStatistics = Object.fromEntries(
    Object.keys(createRangeReadMetrics()).map((key) => [
      key,
      statistics(measured.map((item) => item.metrics[key])),
    ]),
  );
  return {
    kind: request.kind,
    label: request.label,
    requestedWindow: { start: request.start, end: request.end },
    channels: request.channels,
    warmup: repetitions[0],
    measured,
    measuredStatistics: {
      elapsedMs: statistics(measured.map((item) => item.elapsedMs)),
      rssBeforeBytes: statistics(measured.map((item) => item.rssBeforeBytes)),
      rssAfterBytes: statistics(measured.map((item) => item.rssAfterBytes)),
      processPeakRssBytes: statistics(measured.map((item) => item.processPeakRssBytes)),
      metrics: metricStatistics,
    },
    selectedOutputBytes: (request.end - request.start) * (8 + request.channels.length * 4),
    frameMajorChannelReadAmplification:
      measured[0].metrics.dataBytesRead /
      (measured[0].metrics.recordsDecoded * request.channels.length * 4),
  };
}

function memoryWindows(windows) {
  return windows.map((window, index) => ({
    label: ['early', 'middle', 'late'][index],
    measurements: window.count,
    minimumRssBytes: window.minimum,
    maximumRssBytes: window.maximum,
    meanRssBytes: Math.round(window.total / window.count),
  }));
}

async function streamedExport(request, metadata) {
  const metrics = createRangeReadMetrics();
  const outputDigest = createHash('sha256');
  const windows = Array.from({ length: 3 }, () => ({
    count: 0,
    total: 0,
    minimum: Number.POSITIVE_INFINITY,
    maximum: 0,
  }));
  let rows = 0;
  let outputBytes = 0;
  let next = request.start;
  let consumerPauses = 0;
  const began = performance.now();
  const sampleMemory = () => {
    const rssBytes = process.memoryUsage().rss;
    const progress = rows / Math.max(1, request.end - request.start);
    const bucket = windows[Math.min(2, Math.floor(progress * 3))];
    bucket.count++;
    bucket.total += rssBytes;
    bucket.minimum = Math.min(bucket.minimum, rssBytes);
    bucket.maximum = Math.max(bucket.maximum, rssBytes);
    emit({
      type: 'measurement',
      operation: 'export',
      elapsedMs: performance.now() - began,
      rows,
      rssBytes,
    });
  };
  const timer = setInterval(sampleMemory, 1000);
  sampleMemory();
  try {
    let lineNumber = 0;
    for await (const line of csvLines(
      request.recording,
      { start: request.start, end: request.end, channels: request.channels },
      metrics,
    )) {
      outputDigest.update(line);
      outputBytes += Buffer.byteLength(line);
      if (lineNumber === 0) assert.equal(line, csvHeader(request.channels));
      else {
        const fields = line.trimEnd().split(',');
        const index = Number(fields[0]);
        assert.equal(index, next++);
        assert.equal(Number(fields[1]), index / metadata.sampleRate);
        request.channels.forEach((channel, offset) =>
          assert.ok(
            Object.is(Number(fields[offset + 2]), independentSample(index, channel, metadata)),
            `incorrect CSV value at frame ${index}, channel ${channel}`,
          ),
        );
        rows++;
        if (
          rows === Math.ceil((request.end - request.start) / 3) ||
          rows === Math.ceil((2 * (request.end - request.start)) / 3)
        )
          sampleMemory();
        if (rows % request.delayEveryRows === 0) {
          consumerPauses++;
          await delay(request.consumerDelayMs);
        }
      }
      lineNumber++;
    }
  } finally {
    clearInterval(timer);
  }
  sampleMemory();
  assert.equal(next, request.end);
  assert.equal(rows, request.end - request.start);
  assert.ok(metrics.maximumReadBytes <= RANGE_READ_CHUNK_BYTES);
  assert.ok(windows.every((window) => window.count > 0));
  const observedMemoryWindows = memoryWindows(windows);
  return {
    requestedWindow: { start: request.start, end: request.end },
    channels: request.channels,
    rows,
    outputBytes,
    digestSha256: outputDigest.digest('hex'),
    elapsedMs: performance.now() - began,
    consumerDelayMs: request.consumerDelayMs,
    delayEveryRows: request.delayEveryRows,
    consumerPauses,
    metrics,
    memoryWindows: observedMemoryWindows,
    memoryComparison: {
      middleMinusEarlyMeanRssBytes:
        observedMemoryWindows[1].meanRssBytes - observedMemoryWindows[0].meanRssBytes,
      lateMinusEarlyMeanRssBytes:
        observedMemoryWindows[2].meanRssBytes - observedMemoryWindows[0].meanRssBytes,
      interpretation:
        'RSS is compared across equal progress thirds while output history remains streamed.',
    },
    processPeakRssBytes: peakRssBytes(),
    frameMajorChannelReadAmplification:
      metrics.dataBytesRead / (metrics.recordsDecoded * request.channels.length * 4),
  };
}

function memorySampler(operation, began) {
  const timer = setInterval(
    () =>
      emit({
        type: 'measurement',
        operation,
        elapsedMs: performance.now() - began,
        rssBytes: process.memoryUsage().rss,
      }),
    1000,
  );
  return () => clearInterval(timer);
}

async function pauseAfter(playback, emittedFrames) {
  return new Promise((resolve, reject) => {
    let requested = false;
    const unsubscribe = playback.subscribe((state) => {
      if (state.status === 'error') {
        unsubscribe();
        reject(new Error(state.error));
      } else if (!requested && state.emittedFrames >= emittedFrames) {
        requested = true;
        void playback.pause().then((paused) => {
          unsubscribe();
          resolve(paused);
        }, reject);
      } else if (state.status === 'ended') {
        unsubscribe();
        resolve(state);
      }
    });
  });
}

async function playbackCase(request, metadata) {
  const checked = checker(metadata, request.channels, request.start);
  let maximumBatchFrames = 0;
  let maximumBatchBytes = 0;
  const began = performance.now();
  const stopSampling = memorySampler(`playback-${request.label}`, began);
  const playback = await Playback.open(request.recording, {
    async write(frames) {
      maximumBatchFrames = Math.max(maximumBatchFrames, frames.length);
      maximumBatchBytes = Math.max(
        maximumBatchBytes,
        frames.length * (8 + request.channels.length * 4),
      );
      if (request.sinkDelayMs) await delay(request.sinkDelayMs);
      frames.forEach((frame) => checked.accept(frame));
    },
  });
  try {
    await playback.setChannels(request.channels);
    await playback.seek(request.start);
    await playback.setSpeed(request.speed);
    const target = request.sourceFrames;
    const completion = pauseAfter(playback, target);
    const playBegan = performance.now();
    await playback.play();
    const state = await completion;
    const wallElapsedMs = performance.now() - playBegan;
    const identity = checked.snapshot();
    assert.equal(identity.frames, state.emittedFrames);
    assert.ok(maximumBatchFrames <= PLAYBACK_LIMITS.maximumBatchFrames);
    assert.ok(maximumBatchBytes <= PLAYBACK_LIMITS.maximumBatchBytes);
    assert.ok(identity.frames >= target || state.status === 'ended');
    const sourceElapsedSeconds = identity.frames / metadata.sampleRate;
    const achievedSpeed = sourceElapsedSeconds / (state.activeElapsedMs / 1000);
    if (request.pacingToleranceFraction !== null)
      assert.ok(
        Math.abs(achievedSpeed - request.speed) / request.speed <= request.pacingToleranceFraction,
        `${request.label}: achieved ${achievedSpeed}x instead of ${request.speed}x`,
      );
    if (request.requireLag) assert.ok(state.maxLagMs > 0, 'slow sink did not expose lag');
    return {
      label: request.label,
      speed: request.speed,
      requestedSourceFrames: target,
      emittedFrames: state.emittedFrames,
      emittedSamples: state.emittedSamples,
      position: state.position,
      sourceElapsedSeconds,
      activeElapsedMs: state.activeElapsedMs,
      wallElapsedMs,
      achievedSpeed,
      currentLagFrames: state.currentLagFrames,
      currentLagMs: state.currentLagMs,
      maximumLagMs: state.maxLagMs,
      maximumBatchFrames,
      maximumBatchBytes,
      sinkDelayMs: request.sinkDelayMs,
      skippedDuplicateFrames: state.skippedDuplicateFrames,
      identity,
      digestSha256: checked.digest(),
      finalRssBytes: process.memoryUsage().rss,
      processPeakRssBytes: peakRssBytes(),
    };
  } finally {
    stopSampling();
    await playback.close();
  }
}

async function transitions(request, metadata) {
  let activeChecker = checker(metadata, request.initialChannels, 0);
  let firstPostPlayingSeekIndex = null;
  const playback = await Playback.open(request.recording, {
    write(frames) {
      if (firstPostPlayingSeekIndex === null && request.awaitingPostSeek)
        firstPostPlayingSeekIndex = frames[0]?.index ?? null;
      frames.forEach((frame) => activeChecker.accept(frame));
    },
  });
  const playAdditional = async (frames) => {
    const target = playback.snapshot().emittedFrames + frames;
    const completion = pauseAfter(playback, target);
    await playback.play();
    return completion;
  };
  try {
    await playback.setChannels(request.initialChannels);
    await playback.setSpeed(1);
    const firstPause = await playAdditional(request.segmentFrames);
    const beforePausedWait = playback.snapshot();
    await delay(request.pauseMs);
    const afterPausedWait = playback.snapshot();
    assert.equal(afterPausedWait.position, beforePausedWait.position);
    assert.equal(afterPausedWait.emittedFrames, beforePausedWait.emittedFrames);
    assert.equal(afterPausedWait.activeElapsedMs, beforePausedWait.activeElapsedMs);
    const secondPause = await playAdditional(request.segmentFrames);
    assert.ok(secondPause.activeElapsedMs > firstPause.activeElapsedMs);

    const middle = await playback.seek(request.middle);
    assert.equal(middle.segmentStartPosition, request.middle);
    assert.equal(middle.activeElapsedMs, 0);
    assert.equal(middle.maxLagMs, 0);
    activeChecker = checker(metadata, request.middleChannels, request.middle);
    await playback.setChannels(request.middleChannels);
    const slowed = await playback.setSpeed(0.5);
    assert.equal(slowed.activeElapsedMs, 0);
    await playAdditional(request.segmentFrames);

    await playback.play();
    await delay(request.playingSeekDelayMs);
    const playingSeek = await playback.seek(request.nearEnd);
    assert.equal(playingSeek.segmentStartPosition, request.nearEnd);
    assert.ok(
      playingSeek.activeElapsedMs < 10,
      `playing seek timing did not reset: ${playingSeek.activeElapsedMs} ms`,
    );
    assert.equal(playingSeek.maxLagMs, 0);
    request.awaitingPostSeek = true;
    activeChecker = checker(metadata, request.finalChannels, request.nearEnd);
    await playback.setChannels(request.finalChannels);
    await playback.setSpeed(2);
    const ended = await new Promise((resolve, reject) => {
      const unsubscribe = playback.subscribe((state) => {
        if (state.status === 'ended') {
          unsubscribe();
          resolve(state);
        } else if (state.status === 'error') {
          unsubscribe();
          reject(new Error(state.error));
        }
      });
    });
    assert.equal(firstPostPlayingSeekIndex, request.nearEnd);
    assert.equal(ended.position, metadata.expectedFrames);
    return {
      pauseDurationMs: request.pauseMs,
      pausedPositionStable: true,
      pausedEmissionStable: true,
      pausedTimeExcluded: true,
      resumePreservedNextPosition: true,
      pausedSeekReset: true,
      speedReset: true,
      playingSeekTimingReset: true,
      playingSeekAcknowledgementActiveElapsedMs: playingSeek.activeElapsedMs,
      playingSeekAcknowledgedAt: request.nearEnd,
      firstPostPlayingSeekIndex,
      noStaleOutputAfterSeek: true,
      finalPosition: ended.position,
      processPeakRssBytes: peakRssBytes(),
    };
  } finally {
    await playback.close();
  }
}

const request = JSON.parse(process.argv[2]);
const metadata = JSON.parse(await readFile(`${request.recording}/metadata.json`, 'utf8'));
let result;
if (request.mode === 'retrieval') result = await retrieval(request, metadata);
else if (request.mode === 'export') result = await streamedExport(request, metadata);
else if (request.mode === 'playback') result = await playbackCase(request, metadata);
else if (request.mode === 'transitions') result = await transitions(request, metadata);
else throw new Error(`Unknown long-recording worker mode: ${request.mode}`);
emit({ type: 'result', result });
