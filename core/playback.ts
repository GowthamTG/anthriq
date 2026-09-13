import { join, resolve } from 'node:path';
import type { Frame, PlaybackPreview, PlaybackSink, PlaybackState } from './contracts.ts';
import { inspect, rangeSelection, readFrames } from './storage.ts';

const TICK_MS = 10;
const MAX_BATCH_FRAMES = 256;
const MAX_BATCH_BYTES = 64 * 1024;
const MAX_CATCH_UP_RECORDS = 4096;
const PREVIEW_CAPACITY = 256;
const PREVIEW_POINTS_PER_SECOND = 200;

const emptyPreview = (): PlaybackPreview => ({
  channels: [],
  observations: [],
  decimation: 1,
  capacity: PREVIEW_CAPACITY,
});

export const idlePlaybackState = (): PlaybackState => ({
  status: 'idle',
  recordingId: null,
  channels: [],
  sampleRate: null,
  speed: 1,
  position: 0,
  positionSeconds: 0,
  expectedFrames: 0,
  durationSeconds: 0,
  emittedFrames: 0,
  emittedSamples: 0,
  skippedDuplicateFrames: 0,
  activeElapsedMs: 0,
  currentLagFrames: 0,
  currentLagMs: 0,
  maxLagMs: 0,
  preview: emptyPreview(),
  error: null,
});

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

export class Playback {
  private listeners = new Set<(state: PlaybackState) => void>();
  private iterator: AsyncIterator<Frame> | null = null;
  private pending: Frame | null = null;
  private iteratorDone = false;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight: Promise<void> | null = null;
  private busy = false;
  private closed = false;
  private generation = 0;
  private anchorPosition = 0;
  private anchorTime = 0;
  private lastObservedIndex: number | null = null;
  private readonly maxBatchFrames: number;
  private readonly previewChannels: number[];
  private readonly directory: string;
  private readonly sink: PlaybackSink;
  private state: PlaybackState;

  private constructor(directory: string, sink: PlaybackSink, state: PlaybackState) {
    this.directory = directory;
    this.sink = sink;
    this.state = state;
    this.previewChannels = state.channels.slice(0, 4);
    this.maxBatchFrames = Math.max(
      1,
      Math.min(MAX_BATCH_FRAMES, Math.floor(MAX_BATCH_BYTES / (8 + state.channels.length * 4))),
    );
  }

  static async open(
    directory: string,
    sink: PlaybackSink = { write: () => {} },
  ): Promise<Playback> {
    const inspected = await inspect(directory);
    if (inspected.status !== 'completed' || inspected.expectedFrames === null)
      throw Object.assign(new Error('Only finalized recordings can be played'), {
        statusCode: 409,
      });
    const { inspection, selection } = await rangeSelection(directory);
    if (inspection.status !== 'completed' || inspection.expectedFrames === null)
      throw Object.assign(new Error('Only finalized recordings can be played'), {
        statusCode: 409,
      });
    const expectedFrames = inspection.expectedFrames;
    const state: PlaybackState = {
      ...idlePlaybackState(),
      status: expectedFrames === 0 ? 'ended' : 'paused',
      recordingId: inspection.id,
      channels: selection.channels,
      sampleRate: inspection.sampleRate,
      expectedFrames,
      durationSeconds: expectedFrames / inspection.sampleRate,
      preview: {
        channels: selection.channels.slice(0, 4),
        observations: [],
        decimation: Math.max(1, Math.ceil(inspection.sampleRate / PREVIEW_POINTS_PER_SECOND)),
        capacity: PREVIEW_CAPACITY,
      },
    };
    const playback = new Playback(directory, sink, state);
    await playback.openReader();
    return playback;
  }

  snapshot() {
    this.refreshTiming();
    return structuredClone(this.state);
  }

  subscribe(listener: (state: PlaybackState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play() {
    if (this.closed) throw new Error('Playback is closed');
    if (this.state.status === 'playing' || this.state.status === 'ended') return this.snapshot();
    if (this.state.status === 'error')
      throw Object.assign(new Error('Restart playback after an error'), { statusCode: 409 });
    this.state.status = 'playing';
    this.anchorPosition = this.state.position;
    this.anchorTime = performance.now();
    this.timer = setInterval(() => this.scheduleTick(), TICK_MS);
    this.publish();
    return this.snapshot();
  }

  async restart() {
    if (this.closed) throw new Error('Playback is closed');
    this.stopTimer();
    this.generation++;
    await this.inFlight?.catch(() => {});
    await this.closeReader();
    this.pending = null;
    this.iteratorDone = false;
    this.lastObservedIndex = null;
    this.state = {
      ...this.state,
      status: this.state.expectedFrames === 0 ? 'ended' : 'paused',
      position: 0,
      positionSeconds: 0,
      emittedFrames: 0,
      emittedSamples: 0,
      skippedDuplicateFrames: 0,
      activeElapsedMs: 0,
      currentLagFrames: 0,
      currentLagMs: 0,
      maxLagMs: 0,
      preview: { ...this.state.preview, observations: [] },
      error: null,
    };
    await this.openReader();
    this.publish();
    return this.snapshot();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.stopTimer();
    this.generation++;
    await this.inFlight?.catch(() => {});
    await this.closeReader();
    this.listeners.clear();
  }

  private async openReader() {
    this.iterator = readFrames(this.directory, { start: 0, end: this.state.expectedFrames })[
      Symbol.asyncIterator
    ]();
    await this.readNext();
  }

  private async closeReader() {
    const iterator = this.iterator;
    this.iterator = null;
    if (iterator?.return) await iterator.return();
  }

  private async readNext() {
    if (!this.iterator || this.iteratorDone) {
      this.pending = null;
      return;
    }
    const next = await this.iterator.next();
    this.iteratorDone = Boolean(next.done);
    this.pending = next.done ? null : next.value;
  }

  private duePosition(now = performance.now()) {
    if (this.state.status !== 'playing' || this.state.sampleRate === null)
      return this.state.position;
    return Math.min(
      this.state.expectedFrames,
      Math.floor(this.anchorPosition + ((now - this.anchorTime) / 1000) * this.state.sampleRate),
    );
  }

  private refreshTiming(now = performance.now()) {
    if (this.state.status !== 'playing' || this.state.sampleRate === null) return;
    this.state.activeElapsedMs = Math.max(0, now - this.anchorTime);
    const lagFrames = Math.max(0, this.duePosition(now) - this.state.position);
    this.state.currentLagFrames = lagFrames;
    this.state.currentLagMs = (lagFrames / this.state.sampleRate) * 1000;
    this.state.maxLagMs = Math.max(this.state.maxLagMs, this.state.currentLagMs);
  }

  private publish() {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private scheduleTick() {
    if (this.closed || this.state.status !== 'playing') return;
    if (this.busy) {
      this.publish();
      return;
    }
    const operation = this.tick();
    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
  }

  private async tick() {
    if (this.closed || this.state.status !== 'playing') return;
    this.busy = true;
    const generation = this.generation;
    try {
      await this.emitDue(generation);
      if (generation !== this.generation || this.closed) return;
      if (this.state.position >= this.state.expectedFrames && this.iteratorDone) {
        this.refreshTiming();
        this.state.position = this.state.expectedFrames;
        this.state.positionSeconds = this.state.durationSeconds;
        this.state.currentLagFrames = 0;
        this.state.currentLagMs = 0;
        this.state.status = 'ended';
        this.stopTimer();
        await this.closeReader();
      }
      this.publish();
    } catch (cause) {
      if (generation !== this.generation || this.closed) return;
      this.stopTimer();
      this.refreshTiming();
      this.state.status = 'error';
      this.state.error = message(cause);
      await this.closeReader().catch(() => {});
      this.publish();
    } finally {
      this.busy = false;
    }
  }

  private async emitDue(generation: number) {
    const due = this.duePosition();
    let processed = 0;
    let batch: Frame[] = [];
    let duplicates = 0;

    const commit = async () => {
      if (!batch.length) return;
      const accepted = batch;
      batch = [];
      await this.sink.write(accepted);
      if (generation !== this.generation || this.closed) return;
      this.state.emittedFrames += accepted.length;
      this.state.emittedSamples += accepted.length * this.state.channels.length;
      this.state.position = Math.max(this.state.position, accepted[accepted.length - 1].index + 1);
      this.state.positionSeconds = this.state.position / this.state.sampleRate!;
      this.appendPreview(accepted);
      this.publish();
    };

    while (this.pending && this.pending.index < due && processed < MAX_CATCH_UP_RECORDS) {
      const frame = this.pending;
      processed++;
      await this.readNext();
      if (this.lastObservedIndex === frame.index) {
        duplicates++;
        continue;
      }
      this.lastObservedIndex = frame.index;
      batch.push(frame);
      if (batch.length >= this.maxBatchFrames) {
        await commit();
        if (generation !== this.generation || this.closed) return;
      }
    }
    await commit();
    if (generation !== this.generation || this.closed) return;
    this.state.skippedDuplicateFrames += duplicates;
    if ((!this.pending || this.pending.index >= due) && processed < MAX_CATCH_UP_RECORDS) {
      this.state.position = Math.max(this.state.position, due);
      this.state.positionSeconds = this.state.position / this.state.sampleRate!;
    }
    this.refreshTiming();
  }

  private appendPreview(frames: readonly Frame[]) {
    const stride = this.state.preview.decimation;
    const selected: Frame[] = [];
    for (const frame of frames)
      if (frame.index % stride === 0)
        selected.push({
          index: frame.index,
          values: this.previewChannels.map(
            (channel) => frame.values[this.state.channels.indexOf(channel)],
          ),
        });
    const last = frames.at(-1)!;
    if (selected.at(-1)?.index !== last.index)
      selected.push({
        index: last.index,
        values: this.previewChannels.map(
          (channel) => last.values[this.state.channels.indexOf(channel)],
        ),
      });
    this.state.preview.observations = [...this.state.preview.observations, ...selected].slice(
      -PREVIEW_CAPACITY,
    );
  }
}

export class PlaybackOwner {
  private listeners = new Set<(state: PlaybackState) => void>();
  private session: Playback | null = null;
  private unsubscribe: (() => void) | null = null;
  private openGeneration = 0;
  private state = idlePlaybackState();
  private readonly root: string;
  private readonly sink: PlaybackSink;

  constructor(root = resolve('recordings'), sink: PlaybackSink = { write: () => {} }) {
    this.root = root;
    this.sink = sink;
  }

  snapshot() {
    return this.session?.snapshot() ?? structuredClone(this.state);
  }

  subscribe(listener: (state: PlaybackState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(state: PlaybackState) {
    this.state = state;
    for (const listener of this.listeners) listener(structuredClone(state));
  }

  async open(recordingId: string) {
    const generation = ++this.openGeneration;
    if (this.session && this.state.recordingId === recordingId) return this.snapshot();
    const candidate = await Playback.open(join(this.root, recordingId), this.sink);
    if (generation !== this.openGeneration) {
      await candidate.close();
      return this.snapshot();
    }
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.session?.close();
    this.session = candidate;
    this.state = candidate.snapshot();
    this.unsubscribe = candidate.subscribe((state) => this.publish(state));
    this.publish(this.state);
    return this.snapshot();
  }

  async control(recordingId: string, action: 'play' | 'restart') {
    if (!this.session || this.state.recordingId !== recordingId)
      throw Object.assign(new Error('The recording is not the active playback session'), {
        statusCode: 409,
      });
    return action === 'play' ? this.session.play() : this.session.restart();
  }

  async shutdown() {
    this.openGeneration++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.session?.close();
    this.session = null;
    this.state = idlePlaybackState();
  }
}
