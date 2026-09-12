import type { FileHandle } from 'node:fs/promises';
import type { RecordingMetadata, RecordingInspection } from './contracts.ts';
import { open, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { stride, WAVEFORM } from './signal.ts';

export async function writeAll(file: FileHandle, buffer: Buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset);
    if (!bytesWritten) throw new Error('Disk write made no progress');
    offset += bytesWritten;
  }
}

export async function saveMetadata(directory: string, metadata: RecordingMetadata) {
  const target = join(directory, 'metadata.json');
  await writeFile(`${target}.tmp`, JSON.stringify(metadata, null, 2) + '\n');
  await rename(`${target}.tmp`, target);
}

export async function inspect(directory: string): Promise<RecordingInspection> {
  const metadata: RecordingMetadata = JSON.parse(await readFile(join(directory, 'metadata.json'), 'utf8'));
  if (metadata.format !== 'SCOPE/1' || !Number.isInteger(metadata.channels) || metadata.channels < 1 || metadata.channels > 256 || !Number.isFinite(metadata.sampleRate) || metadata.sampleRate <= 0) throw new Error('Unsupported or invalid recording metadata');
  if (metadata.waveform !== WAVEFORM) throw new Error(`Unsupported waveform: ${metadata.waveform}`);
  const { size } = await stat(join(directory, 'frames.bin'));
  const recordBytes = stride(metadata.channels);
  return { ...metadata, fileBytes: size, completeRecords: Math.floor(size / recordBytes), trailingBytes: size % recordBytes, recordBytes };
}

async function readExact(file: FileHandle, buffer: Buffer, position: number, bytes = buffer.length) {
  let offset = 0;
  while (offset < bytes) {
    const { bytesRead } = await file.read(buffer, offset, bytes - offset, position + offset);
    if (!bytesRead) throw new Error('Unexpected end of recording');
    offset += bytesRead;
  }
  return buffer;
}

export async function lowerBound(file: FileHandle, count: number, width: number, frame: number) {
  let low = 0, high = count;
  const index = Buffer.allocUnsafe(8);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    await readExact(file, index, mid * width);
    if (Number(index.readBigUInt64LE()) < frame) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function selection(metadata: RecordingMetadata, options: { channels?: number[]; start?: number; end?: number } = {}) {
  const channels = options.channels ?? Array.from({ length: metadata.channels }, (_, i) => i);
  if (!Array.isArray(channels) || !channels.length || new Set(channels).size !== channels.length || channels.some(c => !Number.isInteger(c) || c < 0 || c >= metadata.channels)) throw new Error('Choose unique, valid zero-based channel indices');
  const start = options.start ?? 0;
  const end = options.end ?? metadata.expectedFrames ?? metadata.recordedFrames;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) throw new Error('Range must be nonnegative integer frame indices with end >= start');
  return { start, end, channels };
}

// Reads at most 64 KiB of frame data at once. Callers consume the generator,
// so export and playback need not materialize the entire requested interval.
export async function* readFrames(directory: string, options: { channels?: number[]; start?: number; end?: number } = {}) {
  const metadata = await inspect(directory);
  const { start, end, channels } = selection(metadata, options);
  const file = await open(join(directory, 'frames.bin'), 'r');
  try {
    const first = await lowerBound(file, metadata.completeRecords, metadata.recordBytes, start);
    const last = await lowerBound(file, metadata.completeRecords, metadata.recordBytes, end);
    const batch = Math.max(1, Math.floor(65536 / metadata.recordBytes));
    const buffer = Buffer.allocUnsafe(batch * metadata.recordBytes);
    for (let ordinal = first; ordinal < last; ordinal += batch) {
      const count = Math.min(batch, last - ordinal);
      await readExact(file, buffer, ordinal * metadata.recordBytes, count * metadata.recordBytes);
      for (let n = 0; n < count; n++) {
        const offset = n * metadata.recordBytes;
        yield { index: Number(buffer.readBigUInt64LE(offset)), values: channels.map(c => buffer.readFloatLE(offset + 8 + c * 4)) };
      }
    }
  } finally { await file.close(); }
}

// Full physical scan for verification, deliberately bypassing the sorted index
// assumption used for seeking. This also detects malformed/reordered records.
export async function* scanFrames(directory: string, metadata: RecordingInspection) {
  const file = await open(join(directory, 'frames.bin'), 'r');
  const width = metadata.recordBytes;
  const batch = Math.max(1, Math.floor(65536 / width));
  const buffer = Buffer.allocUnsafe(batch * width);
  try {
    for (let ordinal = 0; ordinal < metadata.completeRecords; ordinal += batch) {
      const count = Math.min(batch, metadata.completeRecords - ordinal);
      await readExact(file, buffer, ordinal * width, count * width);
      for (let n = 0; n < count; n++) yield { buffer, offset: n * width, ordinal: ordinal + n };
    }
  } finally { await file.close(); }
}
