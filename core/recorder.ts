import type { RecordingMetadata, GeneratorMetrics, Frame, Batch, SourceDone, GeneratorMessage, RecorderMessage, RecorderCommand } from './contracts.ts';
import { fork } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, open, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config, stride, WAVEFORM } from './signal.ts';
import { writeAll, saveMetadata } from './storage.ts';

const directory = resolve(process.argv[2]);
const settings = config(JSON.parse(process.argv[3] || '{}'));
await mkdir(directory, { recursive: true });
const file = await open(join(directory, 'frames.bin'), 'wx');
const lossFile = await open(join(directory, 'losses.jsonl'), 'wx');
const measurements = await open(join(directory, 'metrics.jsonl'), 'wx');
const metadata: RecordingMetadata = { format: 'SCOPE/1', id: directory.split('/').at(-1)!, ...settings, status: 'recording', startedAt: new Date().toISOString(), expectedFrames: null, recordedFrames: 0, totalSamples: 0, duration: null, sampleType: 'float32', bytesPerSample: 4, byteOrder: 'little-endian', layout: 'uint64 frame index, then interleaved channel values', waveform: WAVEFORM, recordBytes: stride(settings.channels) };
await saveMetadata(directory, metadata);
const generator = fork(new URL('./generator.ts', import.meta.url), [JSON.stringify(settings)], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
metadata.processes = { recorder: process.pid, generator: generator.pid! };
// Install before any await so even a very early exit is observed.
const generatorClosed = new Promise<number | null>(resolve => generator.once('close', code => resolve(code)));
const cancelled = new AbortController();
let stopTimer: ReturnType<typeof setTimeout> | undefined;
const queue: Batch[] = [];
let draining = false, finalMessage: SourceDone | undefined, finalized = false, failing = false;
let recorded = 0, nextExpected = 0, dropped = 0, queueBytes = 0, peakQueueBytes = 0, statusPending = false, metricsBusy = false;
let generatorMetrics: Partial<GeneratorMetrics> = {}, preview: Frame[] = [], lastPreview = 0, lastMeasurement = 0;
const started = performance.now();
const stats = (): Extract<RecorderMessage, { type: 'status' }> => ({ type: 'status', id: metadata.id, status: metadata.status, channels: settings.channels, sampleRate: settings.sampleRate, recordedFrames: recorded, totalSamples: recorded * settings.channels, droppedFrames: dropped, lostSamples: dropped * settings.channels, fileBytes: recorded * metadata.recordBytes, queueBytes, peakQueueBytes, bufferBytes: settings.bufferBytes, recorderRssBytes: process.memoryUsage().rss, elapsedSeconds: generatorMetrics.elapsedSeconds || (performance.now() - started) / 1000, generator: generatorMetrics, preview });
const send = (message: RecorderMessage) => { if (process.connected) process.send!(message, err => { if (err) requestStop(); }); };
const deliver = (message: RecorderMessage) => new Promise<void>((resolve, reject) => {
  if (!process.connected) return resolve();
  process.send!(message, error => error ? reject(error) : resolve());
});

async function recordGap(end: number) {
  if (end <= nextExpected) return;
  await writeAll(lossFile, Buffer.from(JSON.stringify({ startFrame: nextExpected, endFrameExclusive: end, frames: end - nextExpected, samples: (end - nextExpected) * settings.channels, cause: 'bounded transport exhausted' }) + '\n'));
  dropped += end - nextExpected;
}

async function drain() {
  if (draining || failing) return;
  draining = true;
  try {
    while (queue.length && !failing) {
      const batch = queue.shift()!;
      if (settings.writeDelayMs) await delay(settings.writeDelayMs, undefined, { signal: cancelled.signal });
      if (failing) return;
      await recordGap(batch.start);
      await writeAll(file, batch.buffer);
      recorded += batch.count;
      nextExpected = batch.start + batch.count;
      queueBytes -= batch.buffer.length;
      if (generator.connected) generator.send({ type: 'credit', bytes: batch.buffer.length }, error => { if (error && !finalized) void fail(error); });
      if (performance.now() - lastPreview > 100) {
        lastPreview = performance.now();
        const step = Math.max(1, Math.floor(batch.count / 80));
        preview = [];
        for (let i = 0; i < batch.count; i += step) preview.push({ index: batch.start + i, values: Array.from({ length: settings.channels }, (_, c) => batch.buffer.readFloatLE(i * metadata.recordBytes + 8 + c * 4)) });
      }
    }
    if (finalMessage) await finish();
  } catch (error) { await fail(error); }
  finally { draining = false; }
}

async function finish() {
  if (finalized || failing || !finalMessage) return;
  finalized = true;
  clearInterval(statusTimer);
  await recordGap(finalMessage.expectedFrames);
  metadata.expectedFrames = finalMessage.expectedFrames;
  metadata.recordedFrames = recorded;
  metadata.totalSamples = recorded * settings.channels;
  metadata.duration = finalMessage.expectedFrames / settings.sampleRate;
  metadata.status = 'completed';
  metadata.stoppedAt = new Date().toISOString();
  metadata.droppedFrames = dropped;
  metadata.generator = finalMessage.generator;
  metadata.peakQueueBytes = peakQueueBytes;
  metadata.recorderPeakRssBytes = process.resourceUsage().maxRSS * 1024;
  await file.sync();
  await lossFile.sync();
  await file.close();
  await lossFile.close();
  while (metricsBusy) await new Promise(r => setTimeout(r, 5));
  await writeAll(measurements, Buffer.from(JSON.stringify({ ...stats(), preview: undefined, final: true }) + '\n'));
  await measurements.close();
  if (generator.connected) generator.send({ type: 'finish' }, error => { if (error) void fail(error); });
  const exitCode = await generatorClosed;
  if (exitCode !== 0) throw new Error('Generator did not exit cleanly');
  if (failing) return;
  await saveMetadata(directory, metadata);
  await deliver({ type: 'completed', metadata });
  clearTimeout(stopTimer);
  if (process.connected) process.disconnect();
}

async function fail(cause: unknown) {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  if (failing) return;
  failing = true;
  cancelled.abort();
  clearTimeout(stopTimer);
  clearInterval(statusTimer);
  metadata.status = 'failed';
  metadata.error = error.message;
  metadata.recordedFrames = recorded;
  metadata.totalSamples = recorded * settings.channels;
  generator.kill('SIGKILL');
  await generatorClosed.catch(() => {});
  await Promise.allSettled([file.close(), lossFile.close(), measurements.close()]);
  const physical = await stat(join(directory, 'frames.bin')).catch(() => null);
  metadata.recordedFrames = physical ? Math.floor(physical.size / metadata.recordBytes) : recorded;
  metadata.totalSamples = metadata.recordedFrames * settings.channels;
  metadata.stoppedAt = new Date().toISOString();
  await saveMetadata(directory, metadata).catch(saveError => { metadata.error += `; failure metadata could not be saved: ${saveError.message}`; });
  await deliver({ type: 'error', error: metadata.error! }).catch(() => {});
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}

function boundStop() {
  stopTimer ??= setTimeout(() => void fail(new Error('Recorder did not finish within the 10-second shutdown limit')), 10000);
}
function requestStop() {
  if (failing) return;
  boundStop();
  if (generator.connected && !finalMessage) generator.send({ type: 'stop' }, error => { if (error) void fail(error); });
}
generator.on('message', (message: GeneratorMessage) => {
  if (message.type === 'batch') {
    queue.push(message);
    queueBytes += message.buffer.length;
    peakQueueBytes = Math.max(peakQueueBytes, queueBytes);
    if (queueBytes > settings.bufferBytes) { fail(new Error('Transport exceeded its byte budget')); return; }
    drain();
  } else if (message.type === 'status') {
    generatorMetrics = message.generator;
    if (generator.connected) generator.send({ type: 'status-ack' }, error => { if (error && !finalized) void fail(error); });
  } else if (message.type === 'done') {
    boundStop();
    finalMessage = message;
    generatorMetrics = message.generator;
    metadata.expectedFrames = message.expectedFrames;
    metadata.duration = message.expectedFrames / settings.sampleRate;
    send({ type: 'stopping', metadata });
    drain();
  } else if (message.type === 'started') { metadata.startedAt = message.timestamp; send({ type: 'started', metadata }); }
});
generator.on('error', fail);
generator.on('exit', (code, signal) => { if (!finalized && !failing) fail(new Error(`Generator exited unexpectedly (${signal || code})`)); });
process.on('message', (message: RecorderCommand) => { if (message.type === 'stop') requestStop(); else if (message.type === 'status-ack') statusPending = false; });
process.on('SIGINT', requestStop);
process.on('SIGTERM', requestStop);
process.on('disconnect', requestStop);
const statusTimer = setInterval(() => {
  if (!statusPending && process.connected) { statusPending = true; send(stats()); }
  if (!metricsBusy && performance.now() - lastMeasurement >= 1000) {
    lastMeasurement = performance.now();
    metricsBusy = true;
    writeAll(measurements, Buffer.from(JSON.stringify({ ...stats(), preview: undefined }) + '\n')).catch(fail).finally(() => { metricsBusy = false; });
  }
}, 100);
try {
  await saveMetadata(directory, metadata);
  generator.send({ type: 'start' }, error => { if (error) void fail(error); });
} catch (error) { await fail(error); }
