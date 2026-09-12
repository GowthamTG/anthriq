import type { GeneratorCommand, GeneratorMessage } from './contracts.ts';
import { config, encodeFrames, stride } from './signal.ts';
import { safeExtent } from './config.ts';

const settings = config(JSON.parse(process.argv[2]));
const width = stride(settings.channels);
const batchFrames = Math.max(1, Math.min(Math.round(settings.sampleRate / 100), Math.floor(settings.bufferBytes / width), 4096));
let credit = settings.bufferBytes, next = 0, emitted = 0, dropped = 0;
let start: bigint | undefined, timer: NodeJS.Timeout | undefined;
let stopped = false, statusPending = false, maxLagMs = 0;
const elapsed = () => start ? Number(process.hrtime.bigint() - start) / 1e9 : 0;
const send = (message: GeneratorMessage) => { if (process.connected) process.send!(message, err => { if (err) process.exit(1); }); };

function tick(final = false) {
  const seconds = elapsed();
  const due = Math.floor(Math.min(seconds, settings.seconds || Infinity) * settings.sampleRate);
  if (!safeExtent(due, settings.channels)) throw new Error('Source extent exceeds safe frame, sample-count, or file-offset range');
  maxLagMs = Math.max(maxLagMs, Math.max(0, due - next) / settings.sampleRate * 1000);
  while (next < due) {
    const count = Math.min(batchFrames, due - next);
    if (credit < count * width) {
      dropped += due - next;
      next = due;
      break;
    }
    const buffer = encodeFrames(next, count, settings);
    credit -= buffer.length;
    send({ type: 'batch', buffer, start: next, count });
    emitted += count;
    next += count;
  }
  if (!final && settings.seconds && seconds >= settings.seconds) stop();
}

function metrics() {
  const seconds = elapsed();
  return { elapsedSeconds: seconds, scheduledFrames: next, emittedFrames: emitted, droppedFrames: dropped, outstandingBytes: settings.bufferBytes - credit, rssBytes: process.memoryUsage().rss, maxLagMs, pacingErrorFrames: next - Math.floor(Math.min(seconds, settings.seconds || Infinity) * settings.sampleRate) };
}

function stop() {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  clearInterval(statusTimer);
  tick(true);
  send({ type: 'done', expectedFrames: next, generator: metrics() });
}

const statusTimer = setInterval(() => {
  if (!start || statusPending || stopped) return;
  statusPending = true;
  send({ type: 'status', generator: metrics() });
}, 250);

process.on('message', (message: GeneratorCommand) => {
  if (message.type === 'start' && !start) {
    start = process.hrtime.bigint();
    timer = setInterval(() => tick(), 5);
    send({ type: 'started', timestamp: new Date().toISOString() });
  } else if (message.type === 'credit') credit = Math.min(settings.bufferBytes, credit + message.bytes);
  else if (message.type === 'status-ack') statusPending = false;
  else if (message.type === 'stop') stop();
  else if (message.type === 'finish') process.exit(0);
});
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('disconnect', () => process.exit(1));
