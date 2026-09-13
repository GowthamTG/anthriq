import type { Frame, RangeQuery } from './contracts.ts';
import { rangeSelection, readFrames } from './storage.ts';

export const csvHeader = (channels: number[]) => `original_frame_index,time_seconds,${channels.map(channel => `channel_${channel}`).join(',')}\n`;

export function csvRow(frame: Frame, sampleRate: number) {
  return `${frame.index},${frame.index / sampleRate},${frame.values.join(',')}\n`;
}

// The caller consumes this generator, so each CSV line is produced only when
// the destination accepts it. The frame reader retains its bounded chunk size.
export async function* csvLines(directory: string, query: RangeQuery = {}) {
  const { inspection, selection } = await rangeSelection(directory, query);
  yield csvHeader(selection.channels);
  for await (const frame of readFrames(directory, query)) yield csvRow(frame, inspection.sampleRate);
}
