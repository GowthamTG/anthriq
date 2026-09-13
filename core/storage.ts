import type { FileHandle } from 'node:fs/promises';
import type { FileIdentity, RecordingMetadata, RecordingInspection, VerificationReport, VerificationSummary } from './contracts.ts';
import { open, writeFile, rename, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { stride } from './signal.ts';
import { readMetadata } from './metadata.ts';

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
  const metadata = await readMetadata(directory);
  const metadataPhysical = await stat(join(directory, 'metadata.json'), { bigint: true });
  const physical = await stat(join(directory, 'frames.bin'), { bigint: true });
  if (!physical.isFile()) throw Object.assign(new Error('Frame data must be a regular file'), { statusCode: 422 });
  const size = Number(physical.size);
  if (!Number.isSafeInteger(size)) throw new Error('Recording file size exceeds safe integer offsets');
  const recordBytes = stride(metadata.channels);
  const completeRecords = Math.floor(size / recordBytes);
  const trailingBytes = size % recordBytes;
  const warnings: string[] = [];
  if (metadata.id !== basename(directory)) warnings.push('Metadata recording identity differs from the bundle directory');
  if (trailingBytes) warnings.push(`Partial trailing record: ${trailingBytes} bytes excluded from the readable prefix`);
  if (metadata.status === 'completed' && metadata.recordedFrames !== completeRecords) warnings.push('Metadata record count differs from physical complete-record count');
  if (metadata.totalSamples !== metadata.recordedFrames * metadata.channels) warnings.push('Metadata scalar count contradicts its frame count');
  if (metadata.expectedFrames !== null && metadata.duration !== metadata.expectedFrames / metadata.sampleRate) warnings.push('Metadata duration contradicts the expected frame extent');
  if (metadata.status === 'completed') {
    if (!metadata.stoppedAt) warnings.push('Finalized metadata has no stop timestamp');
    if (metadata.expectedFrames !== null && metadata.recordedFrames + (metadata.droppedFrames ?? 0) !== metadata.expectedFrames) warnings.push('Recorded and lost frame counts contradict the expected extent');
  }
  if (metadata.droppedFrames) warnings.push(`${metadata.droppedFrames} lost frames are declared; recording is not lossless`);
  const contradictory = warnings.length > 0;
  if (metadata.expectedFrames === null) warnings.push('Final source extent is unconfirmed; duration and completeness are unknown');
  if (metadata.status !== 'completed') warnings.push('Recording is not finalized; metadata counts may lag the readable physical prefix');
  const condition = contradictory || (metadata.status === 'completed' && metadata.expectedFrames === null) ? 'attention' : metadata.status === 'completed' ? 'finalized' : 'incomplete';
  const verification = await verificationSummary(directory, {
    metadata: fileIdentity(metadataPhysical),
    frames: fileIdentity(physical),
  });
  if (verification.status === 'stale') warnings.push('Saved verification is stale and no longer matches the current recording files');
  return { ...metadata, duration: metadata.expectedFrames === null ? null : metadata.duration, fileBytes: size, completeRecords, trailingBytes, recordBytes, readableBytes: completeRecords * recordBytes, warnings, condition, verification };

}

function fileIdentity(value: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint }): FileIdentity {
  return { dev: String(value.dev), ino: String(value.ino), size: Number(value.size), mtimeNs: String(value.mtimeNs) };
}

async function readBoundedJson(path: string): Promise<unknown> {
  const file = await open(path, 'r');
  const buffer = Buffer.alloc(65537);
  let count = 0;
  try {
    while (count < buffer.length) {
      const { bytesRead } = await file.read(buffer, count, buffer.length - count, count);
      if (!bytesRead) break;
      count += bytesRead;
    }
  } finally { await file.close(); }
  if (count > 65536) throw new Error('Verification report exceeds the 64 KiB limit');
  return JSON.parse(buffer.subarray(0, count).toString('utf8'));
}

const identitiesMatch = (left: FileIdentity, right: FileIdentity) => left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs;

async function verificationSummary(directory: string, current: VerificationReport['checkedFiles']): Promise<VerificationSummary> {
  let raw: unknown;
  try { raw = await readBoundedJson(join(directory, 'verification.json')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'unverified' };
    return { status: 'stale' };
  }
  if (!raw || typeof raw !== 'object') return { status: 'stale' };
  const report = raw as Partial<VerificationReport>;
  if (report.format !== 'SCOPE-VERIFICATION/1' || !report.checkedFiles?.metadata || !report.checkedFiles.frames || !['PASS', 'FAIL'].includes(report.result ?? '')) return { status: 'stale' };
  if (!identitiesMatch(report.checkedFiles.metadata, current.metadata) || !identitiesMatch(report.checkedFiles.frames, current.frames)) return { status: 'stale', checkedAt: report.checkedAt, result: report.result };
  return { status: report.result === 'PASS' ? 'verified' : 'integrity-failed', checkedAt: report.checkedAt, result: report.result };
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
