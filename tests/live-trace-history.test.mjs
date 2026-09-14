import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceLiveTrace } from '../app/live-trace-history.ts';

const bucket = (start, end, minimum, maximum) => ({ start, end, minimum, maximum });

function snapshot({
  id = 'recording-a',
  channels = [1],
  bucketFrames = 2,
  capacity = 256,
  buckets = [],
  recordedFrames = buckets.at(-1)?.end ?? 0,
  sampleRate = 1000,
} = {}) {
  return {
    status: 'recording',
    id,
    settings: {
      channels: 4,
      sampleRate,
      seed: 42,
      bufferBytes: 4194304,
      seconds: 0,
      writeDelayMs: 0,
      stallAfterSeconds: 0,
      stallForMs: 0,
      displayName: '',
    },
    metrics: { recordedFrames },
    preview: { channels, bucketFrames, capacity, buckets },
    metadata: null,
    error: null,
  };
}

test('live trace history merges overlapping snapshots at a common decimation', () => {
  const first = advanceLiveTrace(
    null,
    snapshot({
      buckets: [bucket(0, 2, [-0.5], [0.25]), bucket(2, 4, [-0.25], [0.5])],
    }),
  );
  const merged = advanceLiveTrace(
    first,
    snapshot({
      sampleRate: 4,
      bucketFrames: 4,
      buckets: [bucket(0, 4, [-0.75], [0.6]), bucket(4, 8, [-0.1], [0.8])],
    }),
  );

  assert.deepEqual(merged.rolling, {
    channels: [1],
    bucketFrames: 4,
    capacity: 256,
    buckets: [bucket(0, 4, [-0.75], [0.6]), bucket(4, 8, [-0.1], [0.8])],
  });
  assert.deepEqual(merged.overview, merged.rolling);
  assert.equal(merged.confirmedFrames, 8);
  assert.deepEqual(merged.previewGaps, []);
});

test('live trace history preserves the last confirmed view and marks a reconnect gap', () => {
  const before = advanceLiveTrace(
    null,
    snapshot({ buckets: [bucket(0, 2, [-0.5], [0.5]), bucket(2, 4, [-0.4], [0.4])] }),
  );
  const snapshotWithoutPreview = snapshot({ recordedFrames: 10 });
  snapshotWithoutPreview.preview = null;
  const reconnecting = advanceLiveTrace(before, snapshotWithoutPreview);
  const resumed = advanceLiveTrace(
    reconnecting,
    snapshot({ recordedFrames: 14, buckets: [bucket(10, 12, [-0.2], [0.2])] }),
  );

  assert.deepEqual(reconnecting.rolling.buckets, before.rolling.buckets);
  assert.equal(reconnecting.confirmedFrames, 10);
  assert.deepEqual(resumed.rolling.buckets, [
    bucket(0, 2, [-0.5], [0.5]),
    bucket(2, 4, [-0.4], [0.4]),
    bucket(10, 12, [-0.2], [0.2]),
  ]);
  assert.deepEqual(resumed.previewGaps, [{ start: 4, end: 10 }]);
});

test('completed history uses authoritative final metadata for its confirmed extent', () => {
  const completed = snapshot({
    buckets: [bucket(996, 998, [-0.5], [0.5])],
    recordedFrames: 950,
  });
  completed.status = 'completed';
  completed.metadata = { recordedFrames: 1000 };

  const history = advanceLiveTrace(null, completed);

  assert.equal(history.confirmedFrames, 1000);
});

test('live trace history bounds rolling detail and adaptively compacts the overview', () => {
  const buckets = Array.from({ length: 300 }, (_, index) =>
    bucket(index, index + 1, [-index], [index]),
  );
  const history = advanceLiveTrace(
    null,
    snapshot({ bucketFrames: 1, buckets, recordedFrames: 300 }),
  );

  assert.equal(history.rolling.buckets.length, 256);
  assert.equal(history.rolling.buckets[0].start, 44);
  assert.ok(history.overview.buckets.length <= 256);
  assert.equal(history.overview.bucketFrames, 2);
  assert.deepEqual(history.overview.buckets[0], bucket(0, 2, [-1], [1]));
  assert.deepEqual(history.overview.buckets.at(-1), bucket(298, 300, [-299], [299]));
});

test('transport compaction cannot expand the rolling detail beyond its frame span', () => {
  const first = advanceLiveTrace(
    null,
    snapshot({
      sampleRate: 4,
      bucketFrames: 4,
      capacity: 2,
      buckets: [bucket(0, 4, [-0.5], [0.5]), bucket(4, 8, [-0.4], [0.4])],
    }),
  );
  const advanced = advanceLiveTrace(
    first,
    snapshot({
      sampleRate: 4,
      bucketFrames: 4,
      capacity: 2,
      buckets: [bucket(8, 12, [-0.3], [0.3]), bucket(12, 16, [-0.2], [0.2])],
    }),
  );

  assert.deepEqual(advanced.rolling.buckets, [
    bucket(8, 12, [-0.3], [0.3]),
    bucket(12, 16, [-0.2], [0.2]),
  ]);
  assert.equal(advanced.overview.buckets.length, 4);
});

test('live trace history resets for a new acquisition or channel selection', () => {
  const initial = advanceLiveTrace(null, snapshot({ buckets: [bucket(0, 2, [-0.5], [0.5])] }));
  const changedChannels = advanceLiveTrace(
    initial,
    snapshot({ channels: [2], buckets: [bucket(8, 10, [-0.1], [0.1])] }),
  );
  const changedAcquisition = advanceLiveTrace(
    changedChannels,
    snapshot({ id: 'recording-b', channels: [2], buckets: [bucket(0, 2, [-0.9], [0.9])] }),
  );

  assert.deepEqual(changedChannels.rolling.buckets, [bucket(8, 10, [-0.1], [0.1])]);
  assert.deepEqual(changedChannels.previewGaps, [{ start: 0, end: 8 }]);
  assert.equal(changedAcquisition.acquisitionId, 'recording-b');
  assert.deepEqual(changedAcquisition.previewGaps, []);
});

test('live trace history keeps repeated reconnect gaps bounded', () => {
  let history = null;
  const observedGaps = [];
  for (let index = 0; index < 600; index++) {
    const start = index * 2;
    if (index > 0) observedGaps.push({ start: start - 1, end: start });
    history = advanceLiveTrace(
      history,
      snapshot({
        bucketFrames: 1,
        buckets: [bucket(start, start + 1, [-index], [index])],
        recordedFrames: start + 1,
      }),
    );
  }

  assert.ok(history.previewGaps.length <= 256);
  assert.ok(history.rolling.buckets.length <= 256);
  assert.ok(history.overview.buckets.length <= 256);
  for (const gap of observedGaps)
    assert.ok(
      history.previewGaps.some(
        (retained) => retained.start <= gap.start && retained.end >= gap.end,
      ),
      `gap ${gap.start}-${gap.end} remains represented after compaction`,
    );
});
