import type { AcquisitionState, AcquisitionStatus, RecordingMetadata, SettingsInput, RecorderCommand, RecorderMessage } from './contracts.ts';
import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve, join, basename } from 'node:path';
import { config } from './signal.ts';

const active = (state: AcquisitionStatus) => ['starting', 'recording', 'stopping'].includes(state);

export class Acquisition {
  root: string;
  listeners = new Set<(state: AcquisitionState) => void>();
  state: AcquisitionState;
  child: ChildProcess | null = null;
  directory?: string;
  stopRequested = false;
  finalMetadata: RecordingMetadata | null = null;
  finished: Promise<AcquisitionState> | null = null;
  resolveFinished: (state: AcquisitionState) => void = () => {};
  constructor(root = resolve('recordings')) {
    this.root = root;
    this.state = { status: 'idle', id: null, settings: config(), metrics: null, metadata: null, error: null };
  }

  snapshot() { return structuredClone(this.state); }
  subscribe(listener: (state: AcquisitionState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  publish() { for (const listener of this.listeners) listener(this.snapshot()); }

  start(settings: SettingsInput = {}, directory?: string) {
    if (this.child || active(this.state.status)) throw Object.assign(new Error('An acquisition is already active'), { statusCode: 409 });
    const effective = config(settings);
    directory = resolve(directory || join(this.root, randomUUID()));
    this.directory = directory;
    this.stopRequested = false;
    this.finalMetadata = null;
    this.state = { status: 'starting', id: basename(directory), settings: effective, metrics: null, metadata: null, error: null };
    this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
    this.publish();
    let stderr = '';
    const child = fork(new URL('./recorder.ts', import.meta.url), [directory, JSON.stringify(effective)], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    this.child = child;
    child.stderr!.on('data', data => { stderr = (stderr + data).slice(-4096); });
    const send = (message: RecorderCommand) => { if (child.connected) child.send(message, () => {}); };
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
      } else if (message.type === 'completed') {
        this.finalMetadata = message.metadata;
        this.state.status = 'stopping';
      } else if (message.type === 'error') {
        this.state.error = message.error;
        this.state.status = 'failed';
      }
      this.publish();
    });
    child.on('error', error => { this.state.error = error.message; });
    child.on('close', (code, signal) => {
      if (code === 0 && this.finalMetadata && !this.state.error) {
        this.state.status = 'completed';
        this.state.metadata = this.finalMetadata;
      } else {
        this.state.status = 'failed';
        this.state.error ||= stderr.match(/Error: ([^\n]+)/)?.[1] || stderr.trim() || `Recorder exited without completing (${signal || code})`;
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
    this.state.status = 'stopping';
    // During startup the request is latched until the source acknowledges start.
    if (this.state.metadata && this.child?.connected) this.child.send({ type: 'stop' }, () => {});
    this.publish();
    return this.snapshot();
  }

  async shutdown() {
    if (!this.child) return;
    this.stop();
    const timer = setTimeout(() => {
      this.state.error = 'Acquisition did not finish within the 10-second shutdown limit';
      const generator = this.state.metadata?.processes?.generator;
      if (generator) { try { process.kill(generator, 'SIGKILL'); } catch {} }
      this.child?.kill('SIGKILL');
    }, 10000);
    try { await this.finished; } finally { clearTimeout(timer); }
  }
}
