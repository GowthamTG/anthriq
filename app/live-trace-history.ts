import type { AcquisitionState, LivePreview, LivePreviewBucket } from '../core/contracts';

const HISTORY_CAPACITY = 256;

export interface PreviewGap {
  start: number;
  end: number;
}

export interface LiveTraceHistory {
  acquisitionId: string;
  channels: number[];
  rolling: LivePreview;
  overview: LivePreview;
  confirmedFrames: number;
  previewGaps: PreviewGap[];
}

function confirmedFrames(state: AcquisitionState) {
  return Math.max(
    state.metrics?.recordedFrames ?? 0,
    state.metadata?.recordedFrames ?? 0,
    state.preview?.buckets.at(-1)?.end ?? 0,
  );
}

function sameChannels(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((channel, index) => channel === right[index]);
}

function mergeBuckets(
  channels: readonly number[],
  bucketFrames: number,
  buckets: readonly LivePreviewBucket[],
) {
  const merged = new Map<number, LivePreviewBucket>();
  for (const source of buckets) {
    const start = Math.floor(source.start / bucketFrames) * bucketFrames;
    const current = merged.get(start);
    if (!current) {
      merged.set(start, {
        start,
        end: source.end,
        minimum: channels.map((_, index) => source.minimum[index]),
        maximum: channels.map((_, index) => source.maximum[index]),
      });
      continue;
    }
    current.end = Math.max(current.end, source.end);
    for (let channel = 0; channel < channels.length; channel++) {
      current.minimum[channel] = Math.min(current.minimum[channel], source.minimum[channel]);
      current.maximum[channel] = Math.max(current.maximum[channel], source.maximum[channel]);
    }
  }
  return [...merged.values()].sort((left, right) => left.start - right.start);
}

function envelope(
  channels: readonly number[],
  previous: LivePreview | null,
  incoming: LivePreview,
  mode: 'rolling' | 'overview',
  rollingWindowFrames = 1,
): LivePreview {
  let bucketFrames = Math.max(previous?.bucketFrames ?? 1, incoming.bucketFrames, 1);
  let buckets = mergeBuckets(channels, bucketFrames, [
    ...(previous?.buckets ?? []),
    ...incoming.buckets,
  ]);
  if (mode === 'overview') {
    while (buckets.length > HISTORY_CAPACITY) {
      bucketFrames *= 2;
      buckets = mergeBuckets(channels, bucketFrames, buckets);
    }
  } else {
    const latestEnd = buckets.at(-1)?.end ?? 0;
    const windowStart = Math.max(0, latestEnd - Math.max(1, rollingWindowFrames));
    buckets = buckets.filter((bucket) => bucket.end > windowStart).slice(-HISTORY_CAPACITY);
  }
  return { channels: [...channels], bucketFrames, capacity: HISTORY_CAPACITY, buckets };
}

function mergeGaps(source: readonly PreviewGap[], bridgeFrames = 0) {
  const merged: PreviewGap[] = [];
  for (const gap of source) {
    const current = merged.at(-1);
    if (!current || gap.start > current.end + bridgeFrames) merged.push({ ...gap });
    else current.end = Math.max(current.end, gap.end);
  }
  return merged;
}

function gaps(previous: readonly PreviewGap[], resolution: number, next?: PreviewGap) {
  const ordered = [...previous, ...(next && next.end > next.start ? [next] : [])].sort(
    (left, right) => left.start - right.start,
  );
  let bridgeFrames = 0;
  let merged = mergeGaps(ordered);
  while (merged.length > HISTORY_CAPACITY) {
    bridgeFrames = Math.max(resolution, bridgeFrames * 2 || 1);
    merged = mergeGaps(merged, bridgeFrames);
  }
  return merged;
}

export function advanceLiveTrace(
  previous: LiveTraceHistory | null,
  state: AcquisitionState,
): LiveTraceHistory | null {
  if (!state.id) return null;
  const extent = confirmedFrames(state);
  if (!state.preview) {
    if (!previous || previous.acquisitionId !== state.id) return null;
    return { ...previous, confirmedFrames: Math.max(previous.confirmedFrames, extent) };
  }

  const channels = state.preview.channels;
  const compatible =
    previous?.acquisitionId === state.id && sameChannels(previous.channels, channels)
      ? previous
      : null;
  const priorEnd = compatible?.rolling.buckets.at(-1)?.end ?? 0;
  const incomingStart = state.preview.buckets[0]?.start;
  const previewGap =
    incomingStart !== undefined && incomingStart > priorEnd
      ? { start: priorEnd, end: incomingStart }
      : undefined;
  const rolling = envelope(
    channels,
    compatible?.rolling ?? null,
    state.preview,
    'rolling',
    state.settings.sampleRate * 2,
  );
  const overview = envelope(channels, compatible?.overview ?? null, state.preview, 'overview');

  return {
    acquisitionId: state.id,
    channels: [...channels],
    rolling,
    overview,
    confirmedFrames: Math.max(compatible?.confirmedFrames ?? 0, extent),
    previewGaps: gaps(compatible?.previewGaps ?? [], overview.bucketFrames, previewGap),
  };
}
