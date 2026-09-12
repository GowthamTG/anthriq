import { inspect, readFrames, selection } from './storage.ts';

// The source emits all requested samples. The UI may draw a decimated preview.
// Callers must consume onFrames synchronously; lag is measured, never hidden.
export class Playback {
  /**
   * @param {string} directory
   * @param {(frames: import('./contracts.ts').Frame[]) => void} onFrames
   * @param {(status: { playing: boolean }) => void} onStatus
   */
  constructor(directory, onFrames = () => {}, onStatus = () => {}) {
    this.directory = directory;
    this.onFrames = onFrames;
    this.onStatus = onStatus;
    this.position = 0;
    this.speed = 1;
    this.playing = false;
    this.emittedFrames = 0;
    this.duplicates = 0;
    this.maxLagMs = 0;
    this.generation = 0;
  }
  async init() { this.metadata = await inspect(this.directory); this.channels = Array.from({ length: this.metadata.channels }, (_, i) => i); this.end = this.metadata.expectedFrames ?? this.metadata.recordedFrames; return this; }
  status() { return { position: this.position, seconds: this.position / this.metadata.sampleRate, duration: this.end / this.metadata.sampleRate, speed: this.speed, playing: this.playing, emittedFrames: this.emittedFrames, duplicates: this.duplicates, maxLagMs: this.maxLagMs, lagFrames: this.lagFrames || 0 }; }
  anchor() { this.basePosition = this.position; this.baseTime = performance.now(); }
  play() { if (this.playing) return; this.playing = true; this.anchor(); this.timer = setInterval(() => this.tick(), 10); this.onStatus(this.status()); }
  pause() { this.playing = false; clearInterval(this.timer); this.generation++; this.onStatus(this.status()); }
  seek(frame) { if (!Number.isSafeInteger(frame) || frame < 0 || frame > this.end) throw new Error('Seek is outside recording'); this.generation++; this.position = frame; this.anchor(); this.onStatus(this.status()); }
  setSpeed(speed) { if (!Number.isFinite(speed) || speed < 0.1 || speed > 8) throw new Error('Playback speed must be between 0.1× and 8×'); this.generation++; this.speed = speed; this.anchor(); this.onStatus(this.status()); }
  setChannels(channels) { selection(this.metadata, { start: 0, end: 0, channels }); this.generation++; this.channels = channels; this.anchor(); }
  async tick() {
    if (!this.playing || this.busy) return;
    this.busy = true;
    const generation = this.generation;
    const target = Math.min(this.end, Math.floor(this.basePosition + (performance.now() - this.baseTime) / 1000 * this.metadata.sampleRate * this.speed));
    // Bound catch-up per tick; the remaining lag is visible in metrics.
    const end = Math.min(target, this.position + 4096);
    const start = this.position;
    try {
      let frames = [], previous = -1;
      for await (const frame of readFrames(this.directory, { start, end, channels: this.channels })) {
        if (generation !== this.generation || !this.playing) return;
        if (frame.index === previous) { this.duplicates++; continue; }
        previous = frame.index;
        frames.push(frame);
        if (frames.length === 256) { this.onFrames(frames); this.emittedFrames += frames.length; frames = []; }
      }
      if (generation !== this.generation || !this.playing) return;
      if (frames.length) { this.onFrames(frames); this.emittedFrames += frames.length; }
      this.position = end;
      const nowTarget = Math.min(this.end, this.basePosition + (performance.now() - this.baseTime) / 1000 * this.metadata.sampleRate * this.speed);
      this.lagFrames = Math.max(0, nowTarget - this.position);
      this.maxLagMs = Math.max(this.maxLagMs, this.lagFrames / (this.metadata.sampleRate * this.speed) * 1000);
      if (this.position >= this.end) this.pause();
      this.onStatus(this.status());
    } catch (error) { this.pause(); this.onStatus({ ...this.status(), error: error.message }); }
    finally { this.busy = false; }
  }
  close() { this.pause(); }
}
