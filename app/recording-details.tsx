'use client';

import { useEffect, useState } from 'react';
import type { RecordingInspection } from '../core/contracts';
import { AllChannelTrace } from './all-channel-trace';
import { PlaybackPanel } from './playback-panel';
import { RangeInspector } from './range-inspector';
import { useAllChannelOverview } from './use-all-channel-overview';
import { VerificationStatusText } from './verification-status';

const number = (value: number | null | undefined) =>
  value == null ? 'Unknown' : value.toLocaleString('en-US');
const timestamp = (value: string | undefined) =>
  value
    ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' })
    : 'Unknown';

export function RecordingDetails({
  details,
  showAllChannelOverview = true,
}: {
  details: RecordingInspection;
  showAllChannelOverview?: boolean;
}) {
  const playable = details.status === 'completed' && details.expectedFrames !== null;
  const [playbackPosition, setPlaybackPosition] = useState(0);
  const {
    overview: allChannelOverview,
    overviewError: allChannelOverviewError,
    overviewStale: allChannelOverviewStale,
  } = useAllChannelOverview({
    recordingId: playable && showAllChannelOverview ? details.id : null,
    enabled: playable && showAllChannelOverview,
    prefix: false,
    refresh: false,
  });
  useEffect(() => setPlaybackPosition(0), [details.id]);

  return (
    <section className="details-panel border border-line bg-panel-deep px-[30px] py-6 max-[760px]:px-5">
      <div className="details-heading flex items-center justify-between">
        <h2>Recording details</h2>
        <span className="micro" data-testid="format">
          {details.format}
        </span>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3 font-mono text-xs">
        <span className={details.condition === 'finalized' ? 'text-[#c1cfb2]' : 'text-[#ffba89]'}>
          {details.condition === 'finalized'
            ? 'Finalized'
            : details.condition === 'attention'
              ? 'Needs attention'
              : 'Incomplete / in progress'}
        </span>
        <VerificationStatusText status={details.verification.status} />
        {details.status === 'completed' && (
          <a
            className="ml-auto border border-[#78826e] px-3 py-2 text-[10px] text-white hover:bg-[#2e3429]"
            href={`/verify?id=${encodeURIComponent(details.id)}`}
          >
            Verify recording ↗
          </a>
        )}
      </div>
      {details.diagnostic && (
        <div
          data-testid="diagnostic-recording"
          className="mt-5 border border-[#7a6c42] bg-[#25231a] p-4 text-xs leading-relaxed text-[#e4d6ad]"
        >
          <span className="micro">
            DISPOSABLE DIAGNOSTIC / {details.diagnostic.scenario.toUpperCase()}
          </span>
          <p className="mt-2">
            Generated separately from the signal definition of{' '}
            <code>{details.diagnostic.sourceRecordingId}</code>. It is not an acquisition and does
            not alter or repair its source recording.
          </p>
        </div>
      )}
      {typeof details.error === 'string' && (
        <div
          data-testid="inspection-failure"
          role="alert"
          className="mt-5 border border-[#805a47] bg-[#2a211c] p-4 text-sm leading-relaxed text-[#ffba89]"
        >
          <p className="mb-1 font-semibold">Acquisition failed</p>
          <p className="break-words">{details.error}</p>
          <p className="mt-2 text-xs">
            The complete frames below remain readable. This recording has not passed integrity
            verification.
          </p>
        </div>
      )}
      {details.warnings.length > 0 && (
        <div
          data-testid="inspection-warnings"
          role="status"
          className="my-5 border border-[#7a6c42] bg-[#25231a] p-4 text-xs leading-relaxed text-[#e4d6ad]"
        >
          <p className="mb-2 font-semibold">Read this recording with care</p>
          <ul className="list-disc space-y-1 pl-4">
            {details.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <dl className="details-grid my-7 grid grid-cols-3 gap-6 max-[760px]:grid-cols-2 max-[760px]:gap-x-[15px] max-[760px]:gap-y-5">
        <div>
          <dt>Recording name</dt>
          <dd data-testid="saved-name">{details.displayName || 'Untitled recording'}</dd>
        </div>
        <div>
          <dt>Signal configuration</dt>
          <dd data-testid="saved-settings">
            {details.channels} channels · {number(details.sampleRate)} Hz · seed {details.seed}
          </dd>
        </div>
        <div>
          <dt>Requested duration</dt>
          <dd>{details.seconds ? `${details.seconds} seconds` : 'Until stopped'}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{timestamp(details.startedAt)}</dd>
        </div>
        <div>
          <dt>Stopped</dt>
          <dd>{timestamp(details.stoppedAt)}</dd>
        </div>
        <div>
          <dt>Source duration</dt>
          <dd data-testid="recording-duration">
            {details.duration == null ? 'Unknown' : `${details.duration.toFixed(3)} seconds`}
          </dd>
        </div>
        <div>
          <dt>Expected frames</dt>
          <dd data-testid="expected-frames">{number(details.expectedFrames)}</dd>
        </div>
        <div>
          <dt>Metadata frame count</dt>
          <dd data-testid="saved-frames">{number(details.recordedFrames)}</dd>
        </div>
        <div>
          <dt>Metadata scalar count</dt>
          <dd>{number(details.totalSamples)}</dd>
        </div>
        <div>
          <dt>Declared lost frames</dt>
          <dd>{number(details.droppedFrames)}</dd>
        </div>
        <div>
          <dt>Sample-byte budget</dt>
          <dd>{number(details.bufferBytes)} bytes</dd>
        </div>
        <div>
          <dt>Temporary recorder stall</dt>
          <dd>
            {details.stallForMs
              ? `${number(details.stallForMs)} ms after ${number(details.stallAfterSeconds)} s`
              : 'Off'}
          </dd>
        </div>
        <div>
          <dt>Binary layout</dt>
          <dd>Indexed float32 · Little-endian</dd>
        </div>
        <div>
          <dt>File size</dt>
          <dd>{number(details.fileBytes)} bytes</dd>
        </div>
        <div>
          <dt>Physical complete frames</dt>
          <dd data-testid="physical-frames">{number(details.completeRecords)}</dd>
        </div>
        <div>
          <dt>Readable scalar values</dt>
          <dd>{number(details.completeRecords * details.channels)}</dd>
        </div>
        <div>
          <dt>Readable prefix</dt>
          <dd>{number(details.readableBytes)} bytes</dd>
        </div>
        <div>
          <dt>Waveform version</dt>
          <dd>{details.waveform}</dd>
        </div>
        <div>
          <dt>Metadata lifecycle</dt>
          <dd>{details.status}</dd>
        </div>
        <div>
          <dt>Recording ID</dt>
          <dd>{details.id}</dd>
        </div>
        <div>
          <dt>Partial trailing bytes</dt>
          <dd data-testid="trailing-bytes">{details.trailingBytes}</dd>
        </div>
      </dl>
      <div className="location grid gap-2.5 border-t border-line pt-5">
        <span className="micro">LOCAL RECORDING</span>
        <code>{details.location}</code>
      </div>
      <PlaybackPanel details={details} onPositionChange={setPlaybackPosition} />
      <RangeInspector details={details} />
      {showAllChannelOverview && allChannelOverviewStale && (
        <p className="notice error mt-5" role="status">
          The persisted all-channel overview may be stale: {allChannelOverviewError}
        </p>
      )}
      {showAllChannelOverview && !allChannelOverview && allChannelOverviewError && (
        <p className="notice error mt-5" role="alert">
          All-channel overview unavailable: {allChannelOverviewError}
        </p>
      )}
      {showAllChannelOverview && allChannelOverview && (
        <AllChannelTrace
          overview={allChannelOverview}
          cursorFrame={playbackPosition}
          label="All recorded channel overview"
          testIdPrefix="playback-all-channel"
        />
      )}
    </section>
  );
}
