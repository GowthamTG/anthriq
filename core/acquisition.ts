import type {
  AcquisitionState,
  AcquisitionStatus,
  RecordingMetadata,
  SettingsInput,
  RecorderCommand,
  RecorderMessage,
} from './contracts.ts';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, join, basename } from 'node:path';
import { config } from './signal.ts';
import { inspect, saveMetadata } from './storage.ts';
import { readMetadata } from './metadata.ts';

const active = (state: AcquisitionStatus) => ['starting', 'recording', 'stopping'].includes(state);

export class Acquisition {
  root: string;
  listeners = new Set<(state: AcquisitionState) => void>();
  state: AcquisitionState;
  child: ChildProcess | null = null;
  directory?: string;
  stopRequested = false;
  stopTimer?: ReturnType<typeof setTimeout>;
  finalMetadata: RecordingMetadata | null = null;
  finished: Promise<AcquisitionState> | null = null;
  resolveFinished: (state: AcquisitionState) => void = () => {};
  constructor(root = resolve('recordings')) {
    this.root = root;
    this.state = {
      status: 'idle',
      id: null,
      settings: config(),
      metrics: null,
      metadata: null,
      error: null,
    };
  }

  snapshot() {
    return structuredClone(this.state);
  }
  subscribe(listener: (state: AcquisitionState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish() {
    for (const listener of this.listeners) listener(this.snapshot());
  }

  start(settings: SettingsInput = {}, directory?: string) {
    if (this.child || active(this.state.status))
      throw Object.assign(new Error('An acquisition is already active'), { statusCode: 409 });
    const effective = config(settings);
    directory = resolve(directory || join(this.root, randomUUID()));
    this.directory = directory;
    this.stopRequested = false;
    this.finalMetadata = null;
    this.state = {
      status: 'starting',
      id: basename(directory),
      settings: effective,
      metrics: null,
      metadata: null,
      error: null,
    };
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
    this.publish();
    let stderr = '',
      disconnected = false;
    const child = fork(
      new URL('./recorder.ts', import.meta.url),
      [directory, JSON.stringify(effective)],
      { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
    );
    this.child = child;
    child.stderr!.on('data', (data) => {
      stderr = (stderr + data).slice(-4096);
    });
    const send = (message: RecorderCommand) => {
      if (child.connected) child.send(message, () => {});
    };
    child.on('message', (message: RecorderMessage) => {
      if (message.type === 'started') {
        this.state.metadata = message.metadata;
        this.state.status = this.stopRequested ? 'stopping' : 'recording';
        if (this.stopRequested) send({ type: 'stop' });
      } else if (message.type === 'status') {
        // Acknowledge immediately, independently of browser delivery or painting.
        send({ type: 'status-ack' });
        const { preview, type, ...metrics } = message;
        this.state.metrics = metrics;
      } else if (message.type === 'stopping') {
        this.state.metadata = message.metadata;
        this.state.status = 'stopping';
        this.armStopTimeout();
      } else if (message.type === 'completed') {
        this.finalMetadata = message.metadata;
        this.state.status = 'stopping';
      } else if (message.type === 'error') {
        this.state.error = message.error;
        this.state.status = 'failed';
        this.armStopTimeout();
      }
      this.publish();
    });
    child.on('disconnect', () => {
      disconnected = true;
      if (!this.finalMetadata) this.armStopTimeout();
    });
    child.on('error', (error) => {
      this.state.error = error.message;
      this.armStopTimeout();
    });
    child.on('exit', (code) => {
      if (code !== 0 || !this.finalMetadata) void this.terminateGenerator(child, directory);
    });
    child.on('close', async (code, signal) => {
      clearTimeout(this.stopTimer);
      this.stopTimer = undefined;
      if (code === 0 && this.finalMetadata && !this.state.error) {
        this.state.status = 'completed';
        this.state.metadata = this.finalMetadata;
      } else {
        this.state.status = 'failed';
        this.state.error ||=
          stderr.match(/Error: ([^\n]+)/)?.[1] ||
          stderr.trim() ||
          (disconnected && code === 0
            ? 'Recorder IPC disconnected before completion was acknowledged'
            : `Recorder exited without completing (${signal || code})`);
      }
      if (this.state.status === 'failed') {
        try {
          const saved = await inspect(directory);
          // A failed attempt to reopen an existing bundle must never alter it.
          if (saved.processes?.recorder === child.pid) {
            const {
              fileBytes,
              completeRecords,
              trailingBytes,
              readableBytes,
              warnings,
              condition,
              ...metadata
            } = saved;
            if (metadata.expectedFrames === null && this.state.metadata?.expectedFrames != null) {
              metadata.expectedFrames = this.state.metadata.expectedFrames;
              metadata.duration = metadata.expectedFrames / metadata.sampleRate;
            }
            metadata.status = 'failed';
            metadata.error = this.state.error!;
            metadata.recordedFrames = completeRecords;
            metadata.totalSamples = completeRecords * metadata.channels;
            metadata.stoppedAt = new Date().toISOString();
            this.state.metadata = metadata;
            await saveMetadata(directory, metadata);
          }
        } catch (error) {
          if (this.state.metadata)
            this.state.error += `; failure metadata could not be saved: ${error instanceof Error ? error.message : error}`;
        }
      }
      this.child = null;
      this.publish();
      this.resolveFinished(this.snapshot());
    });
    return this.snapshot();
  }

  stop() {
    if (!active(this.state.status)) return this.snapshot();
    this.stopRequested = true;
    this.armStopTimeout();
    this.state.status = 'stopping';
    // During startup the request is latched until the source acknowledges start.
    if (this.state.metadata && this.child?.connected) this.child.send({ type: 'stop' }, () => {});
    this.publish();
    return this.snapshot();
  }

  armStopTimeout() {
    if (this.stopTimer) return;
    this.stopTimer = setTimeout(() => {
      this.state.error ||= 'Acquisition did not finish within the 10-second shutdown limit';
      if (this.child) {
        void this.terminateGenerator(this.child, this.directory!);
        this.child.kill('SIGKILL');
      }
    }, 10000);
  }

  async terminateGenerator(child: ChildProcess, directory: string) {
    try {
      const metadata = this.state.metadata ?? (await readMetadata(directory));
      if (metadata.processes && metadata.processes.recorder === child.pid)
        process.kill(metadata.processes.generator, 'SIGKILL');
    } catch {
      /* Already exited, or startup never created a source. */
    }
  }

  async shutdown() {
    if (!this.child) return;
    this.armStopTimeout();
    this.stop();
    await this.finished;
  }
}
