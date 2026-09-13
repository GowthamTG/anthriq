import { open, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { FileIdentity, RecordingMetadata, VerificationProgress, VerificationReport } from './contracts.ts';
import { readMetadataHandle } from './metadata.ts';
import { sample } from './signal.ts';

const REPORT_FORMAT = 'SCOPE-VERIFICATION/1' as const;
const CHUNK_BYTES = 65536;

function identity(value: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint }): FileIdentity {
  const size = Number(value.size);
  if (!Number.isSafeInteger(size)) throw new Error('Recording file size exceeds safe integer offsets');
  return { dev: String(value.dev), ino: String(value.ino), size, mtimeNs: String(value.mtimeNs) };
}

const sameIdentity = (left: FileIdentity, right: FileIdentity) => left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeNs === right.mtimeNs;

async function pathIdentity(path: string) {
  return identity(await stat(path, { bigint: true }) as never);
}

function rssBytes() {
  return process.memoryUsage.rss();
}

export async function verifyRecording(directory: string, options: { onProgress?: (progress: VerificationProgress) => void } = {}): Promise<VerificationReport> {
  const started = performance.now();
  const metadataPath = join(directory, 'metadata.json');
  const framesPath = join(directory, 'frames.bin');
  const [metadataFile, framesFile] = await Promise.all([open(metadataPath, 'r'), open(framesPath, 'r')]);
  let metadata: RecordingMetadata | null = null;
  let metadataError: string | null = null;
  let metadataIdentity: FileIdentity;
  let framesIdentity: FileIdentity;
  let peakRssBytes = rssBytes();
  try {
    [metadataIdentity, framesIdentity] = await Promise.all([
      metadataFile.stat({ bigint: true }).then(value => identity(value as never)),
      framesFile.stat({ bigint: true }).then(value => identity(value as never)),
    ]);
    try { metadata = await readMetadataHandle(metadataFile); }
    catch (error) { metadataError = error instanceof Error ? error.message : String(error); }

    let formatCount = 0;
    let firstFormat: string | null = null;
    let ordering: VerificationReport['formatErrors']['ordering'] = metadata ? 'valid' : 'unknown';
    const formatError = (message: string) => { formatCount++; firstFormat ??= message; };
    if (metadataError) formatError(metadataError);

    const width = metadata?.recordBytes ?? null;
    const completeRecords = width ? Math.floor(framesIdentity.size / width) : null;
    const trailingBytes = width ? framesIdentity.size % width : null;
    if (metadata) {
      if (metadata.id !== basename(directory)) formatError('Metadata recording identity differs from the bundle directory');
      if (metadata.status !== 'completed') formatError('Recording is not completed');
      if (metadata.expectedFrames === null) formatError('Final source extent is unconfirmed');
      if (trailingBytes) formatError(`Incomplete final record: ${trailingBytes} bytes`);
      if (metadata.recordedFrames !== completeRecords) formatError('Metadata record count differs from physical complete-record count');
      if (metadata.totalSamples !== metadata.recordedFrames * metadata.channels) formatError('Metadata scalar count contradicts its frame count');
      if (metadata.expectedFrames !== null && metadata.duration !== metadata.expectedFrames / metadata.sampleRate) formatError('Metadata duration contradicts the expected frame extent');
      if (!metadata.stoppedAt) formatError('Completed metadata has no stop timestamp');
      if (metadata.expectedFrames !== null && metadata.recordedFrames + (metadata.droppedFrames ?? 0) !== metadata.expectedFrames) formatError('Recorded and lost frame counts contradict the expected extent');
    }

    let missing: number | null = metadata?.expectedFrames === null || !metadata ? null : 0;
    let duplicated: number | null = metadata ? 0 : null;
    let incorrect: number | null = metadata ? 0 : null;
    let firstMissing: VerificationReport['discrepancies']['missing']['first'] = null;
    let firstDuplicated: VerificationReport['discrepancies']['duplicated']['first'] = null;
    let firstIncorrect: VerificationReport['discrepancies']['incorrect']['first'] = null;
    let previous = -1;
    let next = 0;
    let identityTrusted = true;
    let recordsScanned = 0;
    let bytesScanned = 0;
    let lastProgressAt = -Infinity;
    const totalBytes = completeRecords === null || width === null ? 0 : completeRecords * width;
    const progress = (force = false) => {
      const now = performance.now();
      if (!force && now - lastProgressAt < 250) return;
      lastProgressAt = now;
      const rss = rssBytes();
      peakRssBytes = Math.max(peakRssBytes, rss);
      options.onProgress?.({ recordsScanned, totalRecords: completeRecords, bytesScanned, totalBytes, percent: completeRecords === null ? null : completeRecords === 0 ? 100 : recordsScanned / completeRecords * 100, elapsedMs: Math.round(now - started), rssBytes: rss });
    };
    progress(true);

    if (metadata && completeRecords !== null && width !== null) {
      const recordsPerChunk = Math.max(1, Math.floor(CHUNK_BYTES / width));
      const buffer = Buffer.allocUnsafe(recordsPerChunk * width);
      for (let ordinal = 0; ordinal < completeRecords; ordinal += recordsPerChunk) {
        const count = Math.min(recordsPerChunk, completeRecords - ordinal);
        let offset = 0;
        const wanted = count * width;
        while (offset < wanted) {
          const { bytesRead } = await framesFile.read(buffer, offset, wanted - offset, ordinal * width + offset);
          if (!bytesRead) throw new Error('Recording changed while verification was reading it');
          offset += bytesRead;
        }
        for (let local = 0; local < count; local++) {
          const physicalOrdinal = ordinal + local;
          const recordOffset = local * width;
          const rawIndex = buffer.readBigUInt64LE(recordOffset);
          if (rawIndex > BigInt(Number.MAX_SAFE_INTEGER)) {
            formatError(`Unsafe frame index at physical record ${physicalOrdinal}`);
            ordering = 'invalid';
            identityTrusted = false;
            missing = duplicated = incorrect = null;
            continue;
          }
          const index = Number(rawIndex);
          if (index < previous) {
            formatError(`Decreasing frame index at physical record ${physicalOrdinal}`);
            ordering = 'invalid';
            identityTrusted = false;
            missing = duplicated = incorrect = null;
          }
          if (metadata.expectedFrames !== null && index >= metadata.expectedFrames) {
            formatError(`Frame ${index} lies outside expected extent`);
            identityTrusted = false;
            missing = duplicated = incorrect = null;
          }
          if (identityTrusted) {
            if (index === previous) {
              duplicated! += metadata.channels;
              firstDuplicated ??= { frame: index, channel: 0, physicalOrdinal };
            } else if (index >= next) {
              if (index > next && missing !== null) {
                missing += (index - next) * metadata.channels;
                firstMissing ??= { frame: next, channel: 0 };
              }
              next = index + 1;
            }
          }
          if (incorrect !== null) {
            for (let channel = 0; channel < metadata.channels; channel++) {
              const actual = buffer.readFloatLE(recordOffset + 8 + channel * 4);
              const expected = sample(index, channel, metadata);
              if (!Object.is(actual, expected)) {
                incorrect++;
                firstIncorrect ??= { frame: index, channel, physicalOrdinal, expected, actual: Number.isFinite(actual) ? actual : String(actual) };
              }
            }
          }
          previous = index;
        }
        recordsScanned += count;
        bytesScanned += wanted;
        progress();
      }
      if (identityTrusted && metadata.expectedFrames !== null && missing !== null && metadata.expectedFrames > next) {
        missing += (metadata.expectedFrames - next) * metadata.channels;
        firstMissing ??= { frame: next, channel: 0 };
      }
      if (identityTrusted && missing !== null && (metadata.droppedFrames ?? 0) !== missing / metadata.channels) {
        formatError('Declared lost frame count differs from physical timeline gaps');
      }
    }
    progress(true);

    const [metadataAfter, framesAfter, metadataPathAfter, framesPathAfter] = await Promise.all([
      metadataFile.stat({ bigint: true }).then(value => identity(value as never)),
      framesFile.stat({ bigint: true }).then(value => identity(value as never)),
      pathIdentity(metadataPath), pathIdentity(framesPath),
    ]);
    if (!sameIdentity(metadataIdentity, metadataAfter) || !sameIdentity(framesIdentity, framesAfter) || !sameIdentity(metadataIdentity, metadataPathAfter) || !sameIdentity(framesIdentity, framesPathAfter)) {
      throw new Error('Recording changed during verification');
    }

    const discrepancyTotal = (missing ?? 0) + (duplicated ?? 0) + (incorrect ?? 0);
    const elapsedMs = Math.round(performance.now() - started);
    const finalRssBytes = rssBytes();
    peakRssBytes = Math.max(peakRssBytes, finalRssBytes);
    const report: VerificationReport = {
      format: REPORT_FORMAT,
      recordingId: metadata?.id ?? basename(directory),
      checkedAt: new Date().toISOString(),
      recordingDurationSeconds: metadata?.duration ?? null,
      checkedFiles: { metadata: metadataIdentity, frames: framesIdentity },
      counts: {
        expectedFrames: metadata?.expectedFrames ?? null,
        expectedSamples: metadata?.expectedFrames == null ? null : metadata.expectedFrames * metadata.channels,
        recordedFrames: completeRecords,
        recordedSamples: completeRecords === null || !metadata ? null : completeRecords * metadata.channels,
      },
      discrepancies: {
        missing: { samples: missing, first: firstMissing },
        duplicated: { samples: duplicated, first: firstDuplicated },
        incorrect: { samples: incorrect, first: firstIncorrect },
      },
      formatErrors: { count: formatCount, first: firstFormat, ordering },
      execution: { recordsScanned, totalRecords: completeRecords, bytesScanned, totalBytes, percent: completeRecords === null ? null : 100, elapsedMs, rssBytes: finalRssBytes, peakRssBytes },
      result: formatCount === 0 && discrepancyTotal === 0 && missing !== null && duplicated !== null && incorrect !== null ? 'PASS' : 'FAIL',
    };
    const reportPath = join(directory, 'verification.json');
    const temporary = `${reportPath}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(report, null, 2) + '\n');
      const [metadataBeforeSave, framesBeforeSave] = await Promise.all([pathIdentity(metadataPath), pathIdentity(framesPath)]);
      if (!sameIdentity(metadataIdentity, metadataBeforeSave) || !sameIdentity(framesIdentity, framesBeforeSave)) throw new Error('Recording changed before the verification report could be saved');
      await rename(temporary, reportPath);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    return report;
  } finally {
    await Promise.allSettled([metadataFile.close(), framesFile.close()]);
  }
}
