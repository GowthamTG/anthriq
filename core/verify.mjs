import { inspect, scanFrames } from './storage.ts';
import { sample } from './signal.ts';

export async function verify(directory) {
  const started = performance.now();
  const metadata = await inspect(directory);
  const report = { expected: metadata.expectedFrames == null ? null : metadata.expectedFrames * metadata.channels, recorded: metadata.completeRecords * metadata.channels, missing: 0, duplicated: 0, incorrect: 0, first: { missing: null, duplicated: null, incorrect: null }, formatErrors: 0, firstFormatError: null, trailingBytes: metadata.trailingBytes, result: 'FAIL' };
  const error = message => { report.formatErrors++; report.firstFormatError ??= message; };
  if (metadata.status !== 'completed' || !Number.isSafeInteger(metadata.expectedFrames) || metadata.expectedFrames < 0) error('Recording is incomplete; expected final extent is unknown or unconfirmed');
  if (metadata.trailingBytes) error(`Incomplete final record: ${metadata.trailingBytes} bytes`);
  if (metadata.recordedFrames !== metadata.completeRecords) error('Metadata record count differs from file');
  let next = 0, previous = -1;
  for await (const { buffer, offset, ordinal } of scanFrames(directory, metadata)) {
    const rawIndex = buffer.readBigUInt64LE(offset);
    if (rawIndex > BigInt(Number.MAX_SAFE_INTEGER)) { error(`Unsafe frame index at record ${ordinal}`); continue; }
    const index = Number(rawIndex);
    if (index < previous) error(`Decreasing frame index at record ${ordinal}`);
    if (metadata.expectedFrames != null && index >= metadata.expectedFrames) error(`Frame ${index} lies outside expected extent`);
    if (index === previous) {
      report.duplicated += metadata.channels;
      report.first.duplicated ??= { frame: index, channel: 0, record: ordinal };
    } else if (index >= next) {
      if (index > next) {
        report.missing += (index - next) * metadata.channels;
        report.first.missing ??= { frame: next, channel: 0 };
      }
      next = index + 1;
    }
    for (let c = 0; c < metadata.channels; c++) {
      const actual = buffer.readFloatLE(offset + 8 + c * 4);
      if (!Object.is(actual, sample(index, c, metadata))) {
        report.incorrect++;
        report.first.incorrect ??= { frame: index, channel: c, expected: sample(index, c, metadata), actual: Number.isFinite(actual) ? actual : String(actual) };
      }
    }
    previous = index;
  }
  if (metadata.expectedFrames > next) {
    report.missing += (metadata.expectedFrames - next) * metadata.channels;
    report.first.missing ??= { frame: next, channel: 0 };
  }
  report.elapsedMs = Math.round(performance.now() - started);
  report.peakRssBytes = process.resourceUsage().maxRSS * 1024;
  report.result = report.missing + report.duplicated + report.incorrect + report.formatErrors === 0 ? 'PASS' : 'FAIL';
  return report;
}
