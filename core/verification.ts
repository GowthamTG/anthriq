import { fork, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { VerificationState, VerificationWorkerCommand, VerificationWorkerMessage } from './contracts.ts';
import { recordingId } from './library.ts';
import { inspect } from './storage.ts';

export class Verification {
  root: string;
  child: ChildProcess | null = null;
  listeners = new Set<(state: VerificationState) => void>();
  state: VerificationState = { status: 'idle', recordingId: null, workerPid: null, progress: null, report: null, error: null };

  constructor(root = resolve('recordings')) { this.root = root; }
  snapshot() { return structuredClone(this.state); }
  subscribe(listener: (state: VerificationState) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  publish() { for (const listener of this.listeners) listener(this.snapshot()); }

  async start(id: string) {
    if (!recordingId(id)) throw Object.assign(new Error('Recording not found'), { statusCode: 404 });
    if (this.child || this.state.status === 'running') throw Object.assign(new Error('A verification is already active'), { statusCode: 409 });
    this.state = { status: 'running', recordingId: id, workerPid: null, progress: null, report: null, error: null };
    this.publish();
    const directory = join(this.root, id);
    try {
      const recording = await inspect(directory);
      if (recording.status !== 'completed') throw Object.assign(new Error('Only completed recordings can be verified from the workbench'), { statusCode: 409 });
    } catch (error) {
      this.state = { status: 'idle', recordingId: null, workerPid: null, progress: null, report: null, error: null };
      this.publish();
      throw error;
    }
    let stderr = '';
    const child = fork(new URL('./verification-worker.ts', import.meta.url), [directory], { serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    this.child = child;
    this.state.workerPid = child.pid ?? null;
    this.publish();
    child.stderr!.on('data', data => { stderr = (stderr + data).slice(-4096); });
    const acknowledge = () => { if (child.connected) child.send({ type: 'progress-ack' } satisfies VerificationWorkerCommand, () => {}); };
    child.on('message', (message: VerificationWorkerMessage) => {
      if (message.type === 'progress') {
        this.state.progress = message.progress;
        acknowledge();
      } else if (message.type === 'report') {
        this.state.report = message.report;
        this.state.progress = message.report.execution;
        this.state.status = message.report.result === 'PASS' ? 'passed' : 'failed-integrity';
      } else {
        this.state.status = 'failed-operational';
        this.state.error = message.error;
      }
      this.publish();
    });
    child.on('error', error => {
      this.state.status = 'failed-operational';
      this.state.error = error.message;
      this.publish();
    });
    child.on('close', (code, signal) => {
      if (this.state.status === 'running') {
        this.state.status = 'failed-operational';
        this.state.error = stderr.trim() || `Verification worker exited before reporting (${signal || code})`;
      }
      this.child = null;
      this.state.workerPid = null;
      this.publish();
    });
    return this.snapshot();
  }

  async shutdown() {
    const child = this.child;
    if (!child) return;
    const closed = new Promise<void>(resolveClosed => child.once('close', () => resolveClosed()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    await closed;
    clearTimeout(timer);
  }
}
