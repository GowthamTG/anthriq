import type { FileHandle } from 'node:fs/promises';
import type {
  Frame,
  AllChannelOverview,
  FileIdentity,
  RangePreview,
  RangeQuery,
  RangeReadMetrics,
  RangeSelection,
  RecordingMetadata,
  RecordingInspection,
  VerificationReport,
  VerificationSummary,
} from './contracts.ts';
import { open, writeFile, rename, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { stride } from './signal.ts';
import { readMetadata } from './metadata.ts';

export const RANGE_READ_CHUNK_BYTES = 64 * 1024;
export const ALL_CHANNEL_OVERVIEW_VALUE_LIMIT = 2048;
export const ALL_CHANNEL_OVERVIEW_FRAME_LIMIT = 64;

export const createRangeReadMetrics = (): RangeReadMetrics => ({
  extentProbeReads: 0,
  extentProbeBytes: 0,
  lowerBoundProbeReads: 0,
  lowerBoundProbeBytes: 0,
  dataReadCalls: 0,
  dataBytesRead: 0,
  maximumReadBytes: 0,
  recordsDecoded: 0,
  selectedSamplesReturned: 0,
});

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
  if (!physical.isFile())
    throw Object.assign(new Error('Frame data must be a regular file'), { statusCode: 422 });
  const size = Number(physical.size);
  if (!Number.isSafeInteger(size))
    throw new Error('Recording file size exceeds safe integer offsets');
  const recordBytes = stride(metadata.channels);
  const completeRecords = Math.floor(size / recordBytes);
  const trailingBytes = size % recordBytes;
  const warnings: string[] = [];
  if (metadata.id !== basename(directory))
    warnings.push('Metadata recording identity differs from the bundle directory');
  if (trailingBytes)
    warnings.push(
      `Partial trailing record: ${trailingBytes} bytes excluded from the readable prefix`,
    );
  if (metadata.status === 'completed' && metadata.recordedFrames !== completeRecords)
    warnings.push('Metadata record count differs from physical complete-record count');
  if (metadata.totalSamples !== metadata.recordedFrames * metadata.channels)
    warnings.push('Metadata scalar count contradicts its frame count');
  if (
    metadata.expectedFrames !== null &&
    metadata.duration !== metadata.expectedFrames / metadata.sampleRate
  )
    warnings.push('Metadata duration contradicts the expected frame extent');
  if (metadata.status === 'completed') {
    if (!metadata.stoppedAt) warnings.push('Finalized metadata has no stop timestamp');
    if (
      metadata.expectedFrames !== null &&
      metadata.recordedFrames + (metadata.droppedFrames ?? 0) !== metadata.expectedFrames
    )
      warnings.push('Recorded and lost frame counts contradict the expected extent');
  }
  if (metadata.droppedFrames)
    warnings.push(`${metadata.droppedFrames} lost frames are declared; recording is not lossless`);
  const contradictory = warnings.length > 0;
  if (metadata.expectedFrames === null)
    warnings.push('Final source extent is unconfirmed; duration and completeness are unknown');
  if (metadata.status !== 'completed')
    warnings.push(
      'Recording is not finalized; metadata counts may lag the readable physical prefix',
    );
  const condition =
    contradictory || (metadata.status === 'completed' && metadata.expectedFrames === null)
      ? 'attention'
      : metadata.status === 'completed'
        ? 'finalized'
        : 'incomplete';
  const verification = await verificationSummary(directory, {
    metadata: fileIdentity(metadataPhysical),
    frames: fileIdentity(physical),
  });
  if (verification.status === 'stale')
    warnings.push('Saved verification is stale and no longer matches the current recording files');
  return {
    ...metadata,
    duration: metadata.expectedFrames === null ? null : metadata.duration,
    fileBytes: size,
    completeRecords,
    trailingBytes,
    recordBytes,
    readableBytes: completeRecords * recordBytes,
    warnings,
    condition,
    verification,
  };
}

function fileIdentity(value: {
  dev: bigint;
  ino: bigint;
  size: bigint;
  mtimeNs: bigint;
}): FileIdentity {
  return {
    dev: String(value.dev),
    ino: String(value.ino),
    size: Number(value.size),
    mtimeNs: String(value.mtimeNs),
  };
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
  } finally {
    await file.close();
  }
  if (count > 65536) throw new Error('Verification report exceeds the 64 KiB limit');
  return JSON.parse(buffer.subarray(0, count).toString('utf8'));
}

const identitiesMatch = (left: FileIdentity, right: FileIdentity) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs;

async function verificationSummary(
  directory: string,
  current: VerificationReport['checkedFiles'],
): Promise<VerificationSummary> {
  let raw: unknown;
  try {
    raw = await readBoundedJson(join(directory, 'verification.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'unverified' };
    return { status: 'stale' };
  }
  if (!raw || typeof raw !== 'object') return { status: 'stale' };
  const report = raw as Partial<VerificationReport>;
  if (
    report.format !== 'SCOPE-VERIFICATION/1' ||
    !report.checkedFiles?.metadata ||
    !report.checkedFiles.frames ||
    !['PASS', 'FAIL'].includes(report.result ?? '')
  )
    return { status: 'stale' };
  if (
    !identitiesMatch(report.checkedFiles.metadata, current.metadata) ||
    !identitiesMatch(report.checkedFiles.frames, current.frames)
  )
    return { status: 'stale', checkedAt: report.checkedAt, result: report.result };
  return {
    status: report.result === 'PASS' ? 'verified' : 'integrity-failed',
    checkedAt: report.checkedAt,
    result: report.result,
  };
}

async function readExact(
  file: FileHandle,
  buffer: Buffer,
  position: number,
  bytes = buffer.length,
  metrics?: RangeReadMetrics,
  kind: 'extent' | 'lower-bound' | 'data' = 'data',
) {
  let offset = 0;
  while (offset < bytes) {
    const { bytesRead } = await file.read(buffer, offset, bytes - offset, position + offset);
    if (!bytesRead) throw new Error('Unexpected end of recording');
    if (metrics) {
      metrics.maximumReadBytes = Math.max(metrics.maximumReadBytes, bytesRead);
      if (kind === 'extent') {
        metrics.extentProbeReads++;
        metrics.extentProbeBytes += bytesRead;
      } else if (kind === 'lower-bound') {
        metrics.lowerBoundProbeReads++;
        metrics.lowerBoundProbeBytes += bytesRead;
      } else {
        metrics.dataReadCalls++;
        metrics.dataBytesRead += bytesRead;
      }
    }
    offset += bytesRead;
  }
  return buffer;
}

export async function lowerBound(
  file: FileHandle,
  count: number,
  width: number,
  frame: number,
  metrics?: RangeReadMetrics,
) {
  let low = 0,
    high = count;
  const index = Buffer.allocUnsafe(8);
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    await readExact(file, index, mid * width, index.length, metrics, 'lower-bound');
    if (index.readBigUInt64LE() < BigInt(frame)) low = mid + 1;
    else high = mid;
  }
  return low;
}

function badRange(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

export function parseChannelList(raw: string | undefined) {
  if (raw === undefined) return undefined;
  const tokens = raw.split(',');
  if (!tokens.length || tokens.some((token) => !/^(0|[1-9][0-9]*)$/.test(token)))
    badRange('Choose comma-separated zero-based channel indices');
  const channels = tokens.map(Number);
  if (channels.some((channel) => !Number.isSafeInteger(channel)))
    badRange('Choose safe zero-based channel indices');
  return channels;
}

export function selection(
  metadata: RecordingMetadata,
  availableEnd: number,
  options: RangeQuery = {},
): RangeSelection {
  const channels = options.channels ?? Array.from({ length: metadata.channels }, (_, i) => i);
  if (
    !Array.isArray(channels) ||
    !channels.length ||
    new Set(channels).size !== channels.length ||
    channels.some((c) => !Number.isSafeInteger(c) || c < 0 || c >= metadata.channels)
  )
    badRange('Choose unique, valid zero-based channel indices');
  const indexInput = options.start !== undefined || options.end !== undefined;
  const timeInput = options.startSeconds !== undefined || options.endSeconds !== undefined;
  if (indexInput && timeInput)
    badRange('Use either original-index bounds or time bounds, not both');
  const value = (input: number | undefined, name: string) => {
    if (input === undefined) return undefined;
    if (!Number.isFinite(input) || input < 0)
      badRange(`${name} must be a nonnegative finite number`);
    return input;
  };
  let start: number, end: number;
  if (timeInput) {
    const from = value(options.startSeconds, 'Start time') ?? 0;
    const to = value(options.endSeconds, 'End time');
    start = Math.ceil(from * metadata.sampleRate);
    end = to === undefined ? availableEnd : Math.ceil(to * metadata.sampleRate);
  } else {
    start = value(options.start, 'Start index') ?? 0;
    end = value(options.end, 'End index') ?? availableEnd;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    ((timeInput ? options.endSeconds : options.end) !== undefined && end < start)
  )
    badRange('Range bounds must resolve to safe frame indices with end >= start');
  if ((metadata.status !== 'completed' || metadata.expectedFrames === null) && !options.prefix)
    badRange('Select the readable intact prefix before retrieving an incomplete recording');
  return {
    start: Math.min(start, availableEnd),
    end: Math.max(Math.min(end, availableEnd), Math.min(start, availableEnd)),
    availableEnd,
    channels,
    prefix: Boolean(options.prefix),
  };
}

async function availableBound(
  file: FileHandle,
  metadata: RecordingInspection,
  metrics?: RangeReadMetrics,
) {
  if (!metadata.completeRecords) return 0;
  const index = Buffer.allocUnsafe(8);
  await readExact(
    file,
    index,
    (metadata.completeRecords - 1) * metadata.recordBytes,
    index.length,
    metrics,
    'extent',
  );
  const last = index.readBigUInt64LE();
  if (last > BigInt(Number.MAX_SAFE_INTEGER))
    throw Object.assign(new Error('Stored frame index exceeds the supported safe range'), {
      statusCode: 422,
    });
  const bound = Number(last) + 1;
  if (metadata.expectedFrames !== null && bound > metadata.expectedFrames)
    throw Object.assign(new Error('Stored frame index exceeds the confirmed source extent'), {
      statusCode: 422,
    });
  return metadata.expectedFrames ?? bound;
}

// Reads at most 64 KiB of frame data at once. Callers consume the generator,
// so export and playback need not materialize the entire requested interval.
export async function rangeSelection(
  directory: string,
  options: RangeQuery = {},
  metrics?: RangeReadMetrics,
): Promise<{ inspection: RecordingInspection; selection: RangeSelection }> {
  const metadata = await inspect(directory);
  if (metadata.verification.status === 'integrity-failed') {
    const report = (await readBoundedJson(
      join(directory, 'verification.json'),
    )) as Partial<VerificationReport>;
    if (report.formatErrors?.ordering === 'invalid')
      throw Object.assign(
        new Error('Retrieval is unavailable because verification found malformed frame ordering'),
        { statusCode: 422 },
      );
  }
  const file = await open(join(directory, 'frames.bin'), 'r');
  try {
    return {
      inspection: metadata,
      selection: selection(metadata, await availableBound(file, metadata, metrics), options),
    };
  } finally {
    await file.close();
  }
}

// Reads at most 64 KiB of frame data at once; the caller owns materialization.
export async function* readFrames(
  directory: string,
  options: RangeQuery = {},
  metrics?: RangeReadMetrics,
) {
  const { inspection: metadata, selection: chosen } = await rangeSelection(
    directory,
    options,
    metrics,
  );
  const { start, end, channels } = chosen;
  const file = await open(join(directory, 'frames.bin'), 'r');
  try {
    const first = await lowerBound(
      file,
      metadata.completeRecords,
      metadata.recordBytes,
      start,
      metrics,
    );
    const last = await lowerBound(
      file,
      metadata.completeRecords,
      metadata.recordBytes,
      end,
      metrics,
    );
    const batch = Math.max(1, Math.floor(RANGE_READ_CHUNK_BYTES / metadata.recordBytes));
    const buffer = Buffer.allocUnsafe(batch * metadata.recordBytes);
    for (let ordinal = first; ordinal < last; ordinal += batch) {
      const count = Math.min(batch, last - ordinal);
      await readExact(
        file,
        buffer,
        ordinal * metadata.recordBytes,
        count * metadata.recordBytes,
        metrics,
      );
      for (let n = 0; n < count; n++) {
        const offset = n * metadata.recordBytes;
        const index = buffer.readBigUInt64LE(offset);
        if (index > BigInt(Number.MAX_SAFE_INTEGER))
          throw Object.assign(new Error('Stored frame index exceeds the supported safe range'), {
            statusCode: 422,
          });
        metrics && metrics.recordsDecoded++;
        if (metrics) metrics.selectedSamplesReturned += channels.length;
        yield {
          index: Number(index),
          values: channels.map((c) => buffer.readFloatLE(offset + 8 + c * 4)),
        };
      }
    }
  } finally {
    await file.close();
  }
}

export async function previewFrames(
  directory: string,
  options: RangeQuery = {},
  limit = 200,
): Promise<RangePreview> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Preview limit must be a safe integer from 1 to 1000');
  const { inspection, selection: chosen } = await rangeSelection(directory, options);
  const observations = [] as RangePreview['observations'];
  for await (const frame of readFrames(directory, options)) {
    if (observations.length === limit)
      return { ...chosen, warnings: inspection.warnings, observations, truncated: true };
    observations.push(frame);
  }
  return { ...chosen, warnings: inspection.warnings, observations, truncated: false };
}

export async function samplePreviewFrames(
  directory: string,
  options: RangeQuery = {},
  limit = 200,
): Promise<Frame[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('Preview frame limit must be a safe integer from 1 to 1000');
  const { inspection: metadata, selection: chosen } = await rangeSelection(directory, options);
  const file = await open(join(directory, 'frames.bin'), 'r');
  try {
    const first = await lowerBound(
      file,
      metadata.completeRecords,
      metadata.recordBytes,
      chosen.start,
    );
    const last = await lowerBound(file, metadata.completeRecords, metadata.recordBytes, chosen.end);
    const count = last - first;
    if (!count) return [];
    const ordinals =
      count <= limit
        ? Array.from({ length: count }, (_, index) => first + index)
        : limit === 1
          ? [last - 1]
          : Array.from(
              { length: limit },
              (_, index) => first + Math.floor((index * (count - 1)) / (limit - 1)),
            );
    const record = Buffer.allocUnsafe(metadata.recordBytes);
    const observations: Frame[] = [];
    for (const ordinal of ordinals) {
      await readExact(file, record, ordinal * metadata.recordBytes, metadata.recordBytes);
      const index = record.readBigUInt64LE();
      if (index > BigInt(Number.MAX_SAFE_INTEGER))
        throw Object.assign(new Error('Stored frame index exceeds the supported safe range'), {
          statusCode: 422,
        });
      observations.push({
        index: Number(index),
        values: chosen.channels.map((channel) => record.readFloatLE(8 + channel * 4)),
      });
    }
    return observations;
  } finally {
    await file.close();
  }
}

export async function allChannelOverview(
  directory: string,
  prefix = false,
): Promise<AllChannelOverview> {
  const { inspection, selection: chosen } = await rangeSelection(directory, { prefix });
  const capacity = Math.min(
    ALL_CHANNEL_OVERVIEW_FRAME_LIMIT,
    Math.max(1, Math.floor(ALL_CHANNEL_OVERVIEW_VALUE_LIMIT / chosen.channels.length)),
  );
  return {
    channels: chosen.channels,
    sampleRate: inspection.sampleRate,
    confirmedFrames: chosen.end,
    capacity,
    observations: await samplePreviewFrames(
      directory,
      { channels: chosen.channels, start: 0, end: chosen.end, prefix },
      capacity,
    ),
  };
}

// Full physical scan for verification, deliberately bypassing the sorted index
// assumption used for seeking. This also detects malformed/reordered records.
export async function* scanFrames(directory: string, metadata: RecordingInspection) {
  const file = await open(join(directory, 'frames.bin'), 'r');
  const width = metadata.recordBytes;
  const batch = Math.max(1, Math.floor(RANGE_READ_CHUNK_BYTES / width));
  const buffer = Buffer.allocUnsafe(batch * width);
  try {
    for (let ordinal = 0; ordinal < metadata.completeRecords; ordinal += batch) {
      const count = Math.min(batch, metadata.completeRecords - ordinal);
      await readExact(file, buffer, ordinal * width, count * width);
      for (let n = 0; n < count; n++) yield { buffer, offset: n * width, ordinal: ordinal + n };
    }
  } finally {
    await file.close();
  }
}
