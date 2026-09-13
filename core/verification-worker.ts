import type {
  VerificationProgress,
  VerificationWorkerCommand,
  VerificationWorkerMessage,
} from './contracts.ts';
import { verifyRecording } from './verify.ts';

const directory = process.argv[2];
if (!directory || !process.send)
  throw new Error('Verification worker requires a recording directory and IPC');

let awaitingProgressAck = false;
let pendingProgress: VerificationProgress | null = null;

function send(message: VerificationWorkerMessage, callback?: () => void) {
  if (!process.connected) return;
  if (callback) process.send!(message, () => callback());
  else process.send!(message);
}

function sendProgress(progress: VerificationProgress) {
  if (awaitingProgressAck) {
    pendingProgress = progress;
    return;
  }
  awaitingProgressAck = true;
  send({ type: 'progress', progress });
}

process.on('message', (message: VerificationWorkerCommand) => {
  if (message.type !== 'progress-ack') return;
  awaitingProgressAck = false;
  if (pendingProgress) {
    const latest = pendingProgress;
    pendingProgress = null;
    sendProgress(latest);
  }
});

try {
  const report = await verifyRecording(directory, { onProgress: sendProgress });
  send({ type: 'report', report }, () => process.disconnect());
} catch (error) {
  send({ type: 'error', error: error instanceof Error ? error.message : String(error) }, () =>
    process.disconnect(),
  );
}
