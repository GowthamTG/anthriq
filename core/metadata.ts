import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { DIAGNOSTIC_SCENARIOS, type RecordingMetadata } from './contracts.ts';
import { stride, WAVEFORM } from './signal.ts';
import { safeExtent } from './config.ts';

const safeId = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(value);

const invalid = (message: string): never => {
  throw Object.assign(new Error(message), { statusCode: 422 });
};

export function parseMetadata(raw: unknown): RecordingMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('Metadata must be an object');
  const m = raw as Record<string, unknown>;
  const integer = (key: string, min: number, max: number) => {
    const value = m[key];
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max)
      invalid(`Invalid metadata ${key}`);
    return value as number;
  };
  const finite = (key: string) => {
    if (typeof m[key] !== 'number' || !Number.isFinite(m[key]) || m[key] < 0)
      invalid(`Invalid metadata ${key}`);
  };
  if (m.format !== 'SCOPE/1') invalid('Unsupported recording format');
  if (m.waveform !== WAVEFORM) invalid(`Unsupported waveform: ${m.waveform}`);
  const channels = integer('channels', 1, 256);
  integer('sampleRate', 1, 100000);
  integer('seed', 0, 2147483647);
  integer('bufferBytes', 4096, 67108864);
  finite('seconds');
  finite('writeDelayMs');
  if (
    m.sampleType !== 'float32' ||
    m.bytesPerSample !== 4 ||
    m.byteOrder !== 'little-endian' ||
    m.recordBytes !== stride(channels) ||
    m.layout !== 'uint64 frame index, then interleaved channel values'
  )
    invalid('Unsupported or contradictory recording layout');
  if (typeof m.status !== 'string' || !['recording', 'completed', 'failed'].includes(m.status))
    invalid('Invalid metadata lifecycle');
  if (typeof m.id !== 'string' || !m.id || m.id.length > 255) invalid('Invalid metadata identity');
  if (
    m.displayName !== undefined &&
    (typeof m.displayName !== 'string' || m.displayName.length > 120)
  )
    invalid('Invalid metadata display name');
  if (m.retention !== undefined) {
    if (!m.retention || typeof m.retention !== 'object' || Array.isArray(m.retention))
      invalid('Invalid recording retention');
    const retention = m.retention as Record<string, unknown>;
    if (
      retention.format !== 'SCOPE-RETENTION/1' ||
      retention.class !== 'temporary-public-demo' ||
      Object.keys(retention).some((key) => !['format', 'class'].includes(key))
    )
      invalid('Invalid recording retention');
  }
  if (m.diagnostic !== undefined) {
    if (!m.diagnostic || typeof m.diagnostic !== 'object' || Array.isArray(m.diagnostic))
      invalid('Invalid diagnostic provenance');
    const diagnostic = m.diagnostic as Record<string, unknown>;
    if (
      diagnostic.format !== 'SCOPE-DIAGNOSTIC/1' ||
      typeof diagnostic.scenario !== 'string' ||
      !DIAGNOSTIC_SCENARIOS.some((scenario) => scenario === diagnostic.scenario) ||
      typeof diagnostic.sourceRecordingId !== 'string' ||
      !safeId(diagnostic.sourceRecordingId) ||
      typeof diagnostic.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(diagnostic.createdAt)) ||
      Object.keys(diagnostic).some(
        (key) => !['format', 'scenario', 'sourceRecordingId', 'createdAt'].includes(key),
      )
    )
      invalid('Invalid diagnostic provenance');
  }
  for (const key of ['startedAt', 'stoppedAt']) {
    if (key === 'stoppedAt' && m[key] === undefined) continue;
    if (typeof m[key] !== 'string' || !Number.isFinite(Date.parse(m[key])))
      invalid(`Invalid metadata ${key}`);
  }
  const recorded = integer('recordedFrames', 0, Number.MAX_SAFE_INTEGER);
  integer('totalSamples', 0, Number.MAX_SAFE_INTEGER);
  if (!safeExtent(recorded, channels)) invalid('Unsafe recorded frame extent');
  if (m.expectedFrames !== null) {
    const expected = integer('expectedFrames', 0, Number.MAX_SAFE_INTEGER);
    if (!safeExtent(expected, channels)) invalid('Unsafe expected frame extent');
  }
  if (m.duration !== null) finite('duration');
  if (m.droppedFrames !== undefined) integer('droppedFrames', 0, Number.MAX_SAFE_INTEGER);
  return m as unknown as RecordingMetadata;
}

export async function readMetadataHandle(file: FileHandle): Promise<RecordingMetadata> {
  const buffer = Buffer.alloc(65537);
  let count = 0;
  while (count < buffer.length) {
    const { bytesRead } = await file.read(buffer, count, buffer.length - count, count);
    if (!bytesRead) break;
    count += bytesRead;
  }
  if (count > 65536) invalid('Metadata exceeds the 64 KiB limit');
  let raw: unknown;
  try {
    raw = JSON.parse(buffer.subarray(0, count).toString('utf8'));
  } catch {
    invalid('Invalid metadata JSON');
  }
  return parseMetadata(raw);
}

export async function readMetadata(directory: string): Promise<RecordingMetadata> {
  // Read a fixed maximum, including a sentinel byte; even a growing file is bounded.
  const file = await open(join(directory, 'metadata.json'), 'r');
  try {
    return await readMetadataHandle(file);
  } finally {
    await file.close();
  }
}
