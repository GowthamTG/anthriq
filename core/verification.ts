import { fork, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  DIAGNOSTIC_SCENARIOS,
  type DiagnosticScenario,
  type VerificationState,
  type VerificationWorkerCommand,
  type VerificationWorkerMessage,
} from './contracts.ts';
import { createDiagnosticScenario } from './diagnostics.ts';
import { recordingId } from './library.ts';
import { inspect } from './storage.ts';

export class Verification {
  root: string;
  child: ChildProcess | null = null;
  listeners = new Set<(state: VerificationState) => void>();
  state: VerificationState = {
    status: 'idle',
    recordingId: null,
    scenario: null,
    sourceRecordingId: null,
    workerPid: null,
    progress: null,
    report: null,
    error: null,
  };

  constructor(root = resolve('recordings')) {
    this.root = root;
  }
  snapshot() {
    return structuredClone(this.state);
  }
  subscribe(listener: (state: VerificationState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish() {
    for (const listener of this.listeners) listener(this.snapshot());
  }
  active() {
    return (
      Boolean(this.child) || this.state.status === 'creating' || this.state.status === 'running'
    );
  }

  async start(id: string) {
    if (!recordingId(id))
      throw Object.assign(new Error('Recording not found'), { statusCode: 404 });
    if (this.active())
      throw Object.assign(new Error('A verification is already active'), { statusCode: 409 });
    this.state = {
      status: 'running',
      recordingId: id,
      scenario: null,
      sourceRecordingId: null,
      workerPid: null,
      progress: null,
      report: null,
      error: null,
    };
    this.publish();
    const directory = join(this.root, id);
    try {
      const recording = await inspect(directory);
      if (recording.status !== 'completed')
        throw Object.assign(
          new Error('Only completed recordings can be verified from the workbench'),
          { statusCode: 409 },
        );
    } catch (error) {
      this.state = {
        status: 'idle',
        recordingId: null,
        scenario: null,
        sourceRecordingId: null,
        workerPid: null,
        progress: null,
        report: null,
        error: null,
      };
      this.publish();
      throw error;
    }
    return this.launch(id);
  }

  async startDiagnostic(sourceRecordingId: string, scenario: DiagnosticScenario) {
    if (!recordingId(sourceRecordingId))
      throw Object.assign(new Error('Source recording not found'), { statusCode: 404 });
    if (!DIAGNOSTIC_SCENARIOS.includes(scenario))
      throw Object.assign(new Error('Unsupported diagnostic scenario'), { statusCode: 400 });
    if (this.active())
      throw Object.assign(new Error('A verification is already active'), { statusCode: 409 });
    this.state = {
      status: 'creating',
      recordingId: null,
      scenario,
      sourceRecordingId,
      workerPid: null,
      progress: null,
      report: null,
      error: null,
    };
    this.publish();
    try {
      const id = await createDiagnosticScenario(this.root, sourceRecordingId, scenario);
      this.state = { ...this.state, status: 'running', recordingId: id };
      this.publish();
      return this.launch(id);
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      this.state = { ...this.state, status: 'failed-operational', error: error.message };
      this.publish();
      throw error;
    }
  }

  launch(id: string) {
    let stderr = '';
    const directory = join(this.root, id);
    const child = fork(new URL('./verification-worker.ts', import.meta.url), [directory], {
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    this.child = child;
    this.state.workerPid = child.pid ?? null;
    this.publish();
    child.stderr!.on('data', (data) => {
      stderr = (stderr + data).slice(-4096);
    });
    const acknowledge = () => {
      if (child.connected)
        child.send({ type: 'progress-ack' } satisfies VerificationWorkerCommand, () => {});
    };
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
    child.on('error', (error) => {
      this.state.status = 'failed-operational';
      this.state.error = error.message;
      this.publish();
    });
    child.on('close', (code, signal) => {
      if (this.state.status === 'running') {
        this.state.status = 'failed-operational';
        this.state.error =
          stderr.trim() || `Verification worker exited before reporting (${signal || code})`;
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
    const closed = new Promise<void>((resolveClosed) => child.once('close', () => resolveClosed()));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    await closed;
    clearTimeout(timer);
  }
}
