export const TRACE_CHANNEL_LIMIT = 4;

export interface Settings {
  channels: number;
  sampleRate: number;
  seed: number;
  bufferBytes: number;
  seconds: number;
  writeDelayMs: number;
  stallAfterSeconds: number;
  stallForMs: number;
  displayName: string;
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
  emissionDeficitFrames: number;
  emissionRateFramesPerSecond: number;
  maxEmissionGapMs: number;
  peakOutstandingBytes: number;
  peakRssBytes: number;
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
  duration: number | null;
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
  recorderStall?: RecorderStall;
  diagnostic?: DiagnosticProvenance;
  error?: string;
}
export const DIAGNOSTIC_SCENARIOS = [
  'clean',
  'missing',
  'duplicate',
  'incorrect',
  'combined',
] as const;
export type DiagnosticScenario = (typeof DIAGNOSTIC_SCENARIOS)[number];
export interface DiagnosticProvenance {
  format: 'SCOPE-DIAGNOSTIC/1';
  scenario: DiagnosticScenario;
  sourceRecordingId: string;
  createdAt: string;
}
export interface RecordingInspection extends RecordingMetadata {
  fileBytes: number;
  completeRecords: number;
  trailingBytes: number;
  readableBytes: number;
  warnings: string[];
  condition: 'finalized' | 'incomplete' | 'attention';
  verification: VerificationSummary;
  location?: string;
}
export type VerificationStatus = 'unverified' | 'verified' | 'integrity-failed' | 'stale';
export interface FileIdentity {
  dev: string;
  ino: string;
  size: number;
  mtimeNs: string;
}
export interface VerificationProgress {
  recordsScanned: number;
  totalRecords: number | null;
  bytesScanned: number;
  totalBytes: number;
  percent: number | null;
  elapsedMs: number;
  rssBytes: number;
}
export interface VerificationPosition {
  frame: number;
  channel: number;
}
export interface DuplicatePosition extends VerificationPosition {
  physicalOrdinal: number;
}
export interface IncorrectPosition extends DuplicatePosition {
  expected: number;
  actual: number | string;
}
export interface VerificationReport {
  format: 'SCOPE-VERIFICATION/1';
  recordingId: string;
  checkedAt: string;
  recordingDurationSeconds: number | null;
  checkedFiles: { metadata: FileIdentity; frames: FileIdentity };
  counts: {
    expectedFrames: number | null;
    expectedSamples: number | null;
    recordedFrames: number | null;
    recordedSamples: number | null;
  };
  discrepancies: {
    missing: { samples: number | null; first: VerificationPosition | null };
    duplicated: { samples: number | null; first: DuplicatePosition | null };
    incorrect: { samples: number | null; first: IncorrectPosition | null };
  };
  formatErrors: { count: number; first: string | null; ordering: 'valid' | 'invalid' | 'unknown' };
  execution: VerificationProgress & { peakRssBytes: number };
  result: 'PASS' | 'FAIL';
}
export interface VerificationSummary {
  status: VerificationStatus;
  checkedAt?: string;
  result?: VerificationReport['result'];
}
export type VerificationJobStatus =
  'idle' | 'creating' | 'running' | 'passed' | 'failed-integrity' | 'failed-operational';
export interface VerificationState {
  status: VerificationJobStatus;
  recordingId: string | null;
  scenario: DiagnosticScenario | null;
  sourceRecordingId: string | null;
  workerPid: number | null;
  progress: VerificationProgress | null;
  report: VerificationReport | null;
  error: string | null;
}
export type VerificationWorkerCommand = { type: 'progress-ack' };
export type VerificationWorkerMessage =
  | { type: 'progress'; progress: VerificationProgress }
  | { type: 'report'; report: VerificationReport }
  | { type: 'error'; error: string };
export interface Frame {
  index: number;
  values: number[];
}
export type PlaybackStatus = 'idle' | 'paused' | 'playing' | 'ended' | 'error';
export interface PlaybackPreview {
  channels: number[];
  observations: Frame[];
  decimation: number;
  capacity: number;
}
export interface PlaybackState {
  status: PlaybackStatus;
  recordingId: string | null;
  channels: number[];
  sampleRate: number | null;
  speed: number;
  position: number;
  positionSeconds: number;
  segmentStartPosition: number;
  expectedFrames: number;
  durationSeconds: number;
  emittedFrames: number;
  emittedSamples: number;
  skippedDuplicateFrames: number;
  activeElapsedMs: number;
  currentLagFrames: number;
  currentLagMs: number;
  maxLagMs: number;
  preview: PlaybackPreview;
  error: string | null;
}
export type PlaybackCommand =
  | { action: 'open'; recordingId: string }
  | { action: 'play'; recordingId: string }
  | { action: 'pause'; recordingId: string }
  | { action: 'restart'; recordingId: string }
  | { action: 'seek'; recordingId: string; position: number }
  | { action: 'seek'; recordingId: string; positionSeconds: number }
  | { action: 'speed'; recordingId: string; speed: number }
  | { action: 'channels'; recordingId: string; channels: number[] }
  | { action: 'preview-channels'; recordingId: string; channels: number[] };
export type PlaybackControlCommand = Exclude<
  PlaybackCommand,
  { action: 'open'; recordingId: string }
>;
export interface PlaybackSink {
  write(frames: readonly Frame[]): void | Promise<void>;
}
export interface RangeQuery {
  channels?: number[];
  start?: number;
  end?: number;
  startSeconds?: number;
  endSeconds?: number;
  prefix?: boolean;
}
export interface RangeSelection {
  start: number;
  end: number;
  availableEnd: number;
  channels: number[];
  prefix: boolean;
}
export interface RangeReadMetrics {
  extentProbeReads: number;
  extentProbeBytes: number;
  lowerBoundProbeReads: number;
  lowerBoundProbeBytes: number;
  dataReadCalls: number;
  dataBytesRead: number;
  maximumReadBytes: number;
  recordsDecoded: number;
  selectedSamplesReturned: number;
}
export interface RangePreview extends RangeSelection {
  warnings: string[];
  observations: Frame[];
  truncated: boolean;
}
export interface AllChannelOverview {
  channels: number[];
  sampleRate: number;
  confirmedFrames: number;
  capacity: number;
  observations: Frame[];
}
export type RecorderStall = 'off' | 'scheduled' | 'active' | 'recovered';
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
  recorderStall: RecorderStall;
  elapsedSeconds: number;
  generator: Partial<GeneratorMetrics>;
}
export interface LivePreviewBucket {
  start: number;
  end: number;
  minimum: number[];
  maximum: number[];
}
export interface LivePreview {
  channels: number[];
  bucketFrames: number;
  capacity: number;
  buckets: LivePreviewBucket[];
}
export type AcquisitionStatus =
  'idle' | 'starting' | 'recording' | 'stopping' | 'completed' | 'failed';
export interface AcquisitionState {
  status: AcquisitionStatus;
  id: string | null;
  settings: Settings;
  metrics: AcquisitionMetrics | null;
  preview: LivePreview | null;
  metadata: RecordingMetadata | null;
  error: string | null;
}
export type GeneratorCommand =
  { type: 'start' | 'stop' | 'finish' | 'status-ack' } | { type: 'credit'; bytes: number };
export type Batch = { type: 'batch'; start: number; count: number; buffer: Buffer };
export type SourceDone = { type: 'done'; expectedFrames: number; generator: GeneratorMetrics };
export type GeneratorMessage =
  | Batch
  | SourceDone
  | { type: 'started'; timestamp: string }
  | { type: 'status'; generator: GeneratorMetrics };
export type RecorderCommand =
  | { type: 'stop' | 'status-ack' }
  | { type: 'preview-subscription'; clientId: string; channels: number[] | null };
export type RecorderMessage =
  | { type: 'started' | 'stopping' | 'completed'; metadata: RecordingMetadata }
  | { type: 'error'; error: string }
  | ({ type: 'status'; previews: Record<string, LivePreview> } & AcquisitionMetrics);
