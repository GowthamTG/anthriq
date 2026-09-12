export interface Settings {
  channels: number;
  sampleRate: number;
  seed: number;
  bufferBytes: number;
  seconds: number;
  writeDelayMs: number;
}
export type SettingsInput = Partial<Record<keyof Settings, number | string>>;
export interface GeneratorMetrics {
  elapsedSeconds: number;
  scheduledFrames: number;
  emittedFrames: number;
  droppedFrames: number;
  outstandingBytes: number;
  rssBytes: number;
  maxLagMs: number;
  pacingErrorFrames: number;
}
export interface RecordingMetadata extends Settings {
  format: string;
  id: string;
  status: 'recording' | 'completed' | 'failed';
  startedAt: string;
  stoppedAt?: string;
  expectedFrames: number | null;
  recordedFrames: number;
  totalSamples: number;
  duration: number;
  sampleType: string;
  bytesPerSample: number;
  byteOrder: string;
  layout: string;
  waveform: string;
  recordBytes: number;
  processes?: { recorder: number; generator: number };
  droppedFrames?: number;
  generator?: GeneratorMetrics;
  peakQueueBytes?: number;
  recorderPeakRssBytes?: number;
  error?: string;
}
export interface RecordingInspection extends RecordingMetadata {
  fileBytes: number;
  completeRecords: number;
  trailingBytes: number;
  location?: string;
}
export interface Frame { index: number; values: number[] }
export interface AcquisitionMetrics {
  id: string;
  status: RecordingMetadata['status'];
  channels: number;
  sampleRate: number;
  recordedFrames: number;
  totalSamples: number;
  droppedFrames: number;
  lostSamples: number;
  fileBytes: number;
  queueBytes: number;
  peakQueueBytes: number;
  bufferBytes: number;
  recorderRssBytes: number;
  elapsedSeconds: number;
  generator: Partial<GeneratorMetrics>;
}
export type AcquisitionStatus = 'idle' | 'starting' | 'recording' | 'stopping' | 'completed' | 'failed';
export interface AcquisitionState {
  status: AcquisitionStatus;
  id: string | null;
  settings: Settings;
  metrics: AcquisitionMetrics | null;
  metadata: RecordingMetadata | null;
  error: string | null;
}
export type GeneratorCommand = { type: 'start' | 'stop' | 'finish' | 'status-ack' } | { type: 'credit'; bytes: number };
export type Batch = { type: 'batch'; start: number; count: number; buffer: Buffer };
export type SourceDone = { type: 'done'; expectedFrames: number; generator: GeneratorMetrics };
export type GeneratorMessage = Batch | SourceDone | { type: 'started'; timestamp: string } | { type: 'status'; generator: GeneratorMetrics };
export type RecorderCommand = { type: 'stop' | 'status-ack' };
export type RecorderMessage = { type: 'started' | 'completed'; metadata: RecordingMetadata } | { type: 'error'; error: string } | ({ type: 'status'; preview: Frame[] } & AcquisitionMetrics);
