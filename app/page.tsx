'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import {
  TRACE_CHANNEL_LIMIT,
  type AcquisitionState,
  type RecordingInspection,
} from '../core/contracts';
import { OverloadTelemetry } from './overload-telemetry';
import { RecordingDetails } from './recording-details';
import { config } from '../core/config';
import { ConfigurationForm, draftFrom, type ConfigurationDraft } from './configuration-form';
import { requestJson } from './http';
import { useServiceEvents } from './use-service-events';
import { VerificationStatusText } from './verification-status';
import { WorkbenchHeader } from './workbench-header';
import { advanceLiveTrace, type LiveTraceHistory } from './live-trace-history';
import { channelWindowLabel } from './channel-window';
import { AllChannelTrace } from './all-channel-trace';
import { useAllChannelOverview } from './use-all-channel-overview';
import { useRuntime } from './use-runtime';
const SignalTrace = dynamic(() => import('./signal-trace').then((module) => module.SignalTrace), {
  ssr: false,
});

const names = {
  idle: 'Ready',
  starting: 'Starting',
  recording: 'Recording',
  stopping: 'Stopping',
  completed: 'Completed',
  failed: 'Failed',
};
const descriptions = {
  idle: 'Your instrument is ready. Choose your configuration below, then start a recording.',
  starting: 'Opening the recording and connecting the source. Your acquisition will begin shortly.',
  recording: 'The source is running on its own clock. Samples are being written to local disk.',
  stopping:
    'Finishing the source and writing accepted samples. Keep this window open to see the result.',
  completed: 'The recording has been finalized and saved. Inspect its metadata below.',
  failed: 'The acquisition could not finish successfully. Review the error before trying again.',
};
const number = (value: number | null | undefined) =>
  value == null ? '—' : value.toLocaleString('en-US');
const bytes = (value: number | null | undefined) =>
  value == null
    ? '—'
    : value < 1000000
      ? `${(value / 1000).toFixed(1)} kB`
      : `${(value / 1000000).toFixed(2)} MB`;
function clock(value: number | null | undefined) {
  if (value == null) return '—';
  const s = Math.floor(value);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function Acquire() {
  const runtime = useRuntime();
  const [state, setState] = useState<AcquisitionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<RecordingInspection | null>(null);
  const [recordingSummary, setRecordingSummary] = useState<RecordingInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(config()));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [clientId, setClientId] = useState<string | null>(null);
  const [traceHistory, setTraceHistory] = useState<LiveTraceHistory | null>(null);
  const observedId = useRef<string | null | undefined>(undefined);
  const selectedChannels = useRef([0, 1, 2, 3]);
  const subscribedRecording = useRef<string | null>(null);
  useEffect(() => setClientId(crypto.randomUUID()), []);
  const applyState = (snapshot: AcquisitionState) => {
    setState(snapshot);
    setTraceHistory((previous) => advanceLiveTrace(previous, snapshot));
    const channels = selectedChannels.current.filter(
      (channel) => channel < snapshot.settings.channels,
    );
    selectedChannels.current = channels.length ? channels : [0];
    if (observedId.current !== snapshot.id) {
      setDraft(draftFrom(snapshot.settings));
      observedId.current = snapshot.id;
    }
  };
  const connection = useServiceEvents({
    url: clientId ? '/api/events' : null,
    reconnectQuery: () =>
      new URLSearchParams({
        clientId: clientId!,
        channels: selectedChannels.current.join(','),
      }),
    snapshot: clientId
      ? { url: '/api/state', apply: (value) => applyState(value as AcquisitionState) }
      : undefined,
    handlers: { state: (value) => applyState(value as AcquisitionState) },
  });

  const connected = connection === 'live';

  useEffect(() => {
    if (!clientId || !connected || state?.status !== 'recording' || !state.id) return;
    if (subscribedRecording.current === state.id) return;
    subscribedRecording.current = state.id;
    const channels = selectedChannels.current.filter(
      (channel) => channel < state.settings.channels,
    );
    selectedChannels.current = channels.length ? channels : [0];
    void fetch(`/api/acquisitions/${state.id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, channels: selectedChannels.current }),
    })
      .then(async (response) => {
        const snapshot = await response.json();
        if (response.ok) setState(snapshot);
      })
      .catch(() => {
        // The connection loop will obtain the current state after a transient failure.
      });
  }, [clientId, connected, state?.id, state?.settings.channels, state?.status]);

  const status = state?.status || 'idle';
  const active = ['starting', 'recording', 'stopping'].includes(status);
  const complete = status === 'completed';
  const metadata = state?.metadata;
  const metrics = state?.metrics;
  const lost = complete ? metadata?.droppedFrames : metrics?.generator?.droppedFrames;
  const frames = complete ? metadata?.recordedFrames : metrics?.recordedFrames;
  const samples = complete ? metadata?.totalSamples : metrics?.totalSamples;
  const size =
    complete && metadata ? metadata.recordedFrames * metadata.recordBytes : metrics?.fileBytes;
  const elapsed = complete ? metadata?.duration : metrics?.generator?.elapsedSeconds;
  const plannedChannels = Number(draft.channels);
  const measuredChannels = state?.id
    ? state.settings.channels
    : Number.isInteger(plannedChannels) && plannedChannels >= 1 && plannedChannels <= 256
      ? plannedChannels
      : undefined;
  const budget = state?.settings?.bufferBytes ?? 4194304;
  const queued = complete ? 0 : metrics?.queueBytes;
  const bufferPercent = queued == null ? 0 : Math.min(100, (queued / budget) * 100);
  const preview =
    state?.preview ??
    (active && state
      ? {
          channels: selectedChannels.current.filter((channel) => channel < state.settings.channels),
          bucketFrames: Math.max(1, Math.ceil((state.settings.sampleRate * 2) / 256)),
          capacity: 256,
          buckets: [],
        }
      : null);
  const rollingPreview = traceHistory?.rolling ?? preview;
  const overviewPreview = traceHistory?.overview ?? preview;
  const confirmedPreviewFrames =
    traceHistory?.confirmedFrames ??
    metrics?.recordedFrames ??
    rollingPreview?.buckets.at(-1)?.end ??
    0;
  const rollingPreviewFrames =
    state?.preview === null
      ? (rollingPreview?.buckets.at(-1)?.end ?? confirmedPreviewFrames)
      : confirmedPreviewFrames;
  const {
    overview: allChannelOverview,
    overviewError: allChannelOverviewError,
    overviewStale: allChannelOverviewStale,
  } = useAllChannelOverview({
    recordingId: state?.id ?? null,
    enabled: Boolean(state?.id),
    prefix: status !== 'completed',
    refresh: active,
  });

  useEffect(() => {
    if (!state?.id || !['completed', 'failed'].includes(state.status)) {
      setRecordingSummary(null);
      return;
    }
    let controller: AbortController | null = null;
    const refreshSummary = () => {
      controller?.abort();
      controller = new AbortController();
      requestJson<RecordingInspection>(`/api/acquisitions/${state.id}`, {
        signal: controller.signal,
      })
        .then(setRecordingSummary)
        .catch(() => {
          // The explicit Inspect action reports failures; background refresh preserves last truth.
        });
    };
    refreshSummary();
    window.addEventListener('focus', refreshSummary);
    return () => {
      controller?.abort();
      window.removeEventListener('focus', refreshSummary);
    };
  }, [state?.id, state?.status]);

  function changeSetting(key: keyof ConfigurationDraft, value: string) {
    setError(null);
    setDraft((previous) => ({ ...previous, [key]: value }));
    setFields((previous) => ({ ...previous, [key]: '' }));
  }

  async function command(action: 'start' | 'stop') {
    setBusy(true);
    setError(null);
    setFields({});
    if (action === 'start') {
      setDetails(null);
      setRecordingSummary(null);
      setTraceHistory(null);
    }
    try {
      const response = await fetch(
        action === 'start' ? '/api/acquisitions' : `/api/acquisitions/${state?.id}/stop`,
        {
          method: 'POST',
          ...(action === 'start'
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }
            : {}),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        setFields(result.fields || {});
        throw new Error(result.error || `Request failed (${response.status}).`);
      }
      setState(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setBusy(false);
    }
  }

  async function inspect() {
    setInspecting(true);
    setError(null);
    try {
      const result = await requestJson<RecordingInspection>(`/api/acquisitions/${state?.id}`);
      setRecordingSummary(result);
      setDetails(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setInspecting(false);
    }
  }

  async function updatePreviewChannels(channels: number[]) {
    if (!state?.id) return;
    if (!channels.length) return setError('Keep at least one live preview channel selected.');
    if (channels.length > TRACE_CHANNEL_LIMIT)
      return setError(`Show at most ${TRACE_CHANNEL_LIMIT} live preview channels at once.`);
    try {
      const result = await requestJson<AcquisitionState>(`/api/acquisitions/${state.id}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, channels }),
      });
      selectedChannels.current = channels;
      setTraceHistory(null);
      setState(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preview selection failed');
    }
  }

  function selectPreview(channel: number) {
    const current = selectedChannels.current;
    const channels = current.includes(channel)
      ? current.filter((value) => value !== channel)
      : [...current, channel].sort((left, right) => left - right);
    void updatePreviewChannels(channels);
  }

  function showLiveChartChannels(start: number) {
    if (!state) return;
    void updatePreviewChannels(
      Array.from(
        { length: Math.min(TRACE_CHANNEL_LIMIT, state.settings.channels - start) },
        (_, index) => start + index,
      ),
    );
  }

  return (
    <>
      <WorkbenchHeader current="acquire" connection={connection} sessionId={clientId} />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[1456px] px-12 max-[1050px]:px-7 max-[760px]:px-5 max-[760px]:pb-[90px]"
      >
        <div className="page-heading flex items-center justify-between pt-[49px] pb-[37px] max-[760px]:pt-8 max-[760px]:pb-[25px]">
          <div>
            <p className="eyebrow">
              ACQUIRE <span>/</span> LOCAL WORKSPACE
            </p>
            <h1>
              Signal capture<span>.</span>
            </h1>
            <p className="intro m-0 text-sm leading-[1.6] text-muted max-[760px]:text-xs">
              A precise record of every moment.
            </p>
          </div>
          <div className="session-label grid gap-[9px] text-right max-[760px]:hidden">
            <span className="micro">ACQUISITION MODE</span>
            <strong>{Number(draft.seconds) > 0 ? 'Timed capture' : 'Continuous'}</strong>
            <span>
              {Number(draft.seconds) > 0
                ? `${draft.seconds} seconds requested`
                : 'Until you press Stop'}
            </span>
          </div>
        </div>

        {!connected && state && (
          <div role="status" className="notice">
            {connection === 'offline'
              ? 'Connection unavailable.'
              : 'Reconnecting to the local service.'}{' '}
            This is the last confirmed view; acquisition may still be running. Coalesced preview
            updates are never missing recorded samples.
          </div>
        )}
        {(error || state?.error) && (
          <div role="alert" className="notice error">
            <strong>Acquisition notice</strong>
            <p>{error || state?.error}</p>
          </div>
        )}

        <div className="workspace grid grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)] border border-line max-[1050px]:grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)] max-[760px]:grid-cols-1">
          <section
            className="instrument flex min-w-0 flex-col bg-panel"
            aria-label="Acquisition measurements"
          >
            <div className="instrument-heading flex items-center justify-between border-b border-line px-[30px] py-6 max-[1050px]:px-[22px] max-[760px]:p-5">
              <span className="micro">RECORDING TELEMETRY</span>
              <span
                className={`state state-${status}${lost ? ' state-loss' : ''}`}
                data-testid="acquisition-state"
                role="status"
              >
                {state ? (complete && lost ? 'Completed with loss' : names[status]) : 'Connecting'}
              </span>
            </div>
            {rollingPreview && overviewPreview && (
              <div className="px-[30px] pt-6 max-[1050px]:px-[22px] max-[760px]:px-5">
                <SignalTrace
                  label="Live rolling signal detail"
                  caption="LAST TWO SECONDS / DECIMATED PERSISTED-FRAME DETAIL"
                  testIdPrefix="live-rolling"
                  model={{
                    channels: rollingPreview.channels,
                    envelope: rollingPreview,
                    sampleRate: state!.settings.sampleRate,
                    decimation: rollingPreview.bucketFrames,
                    capacity: rollingPreview.capacity,
                    nextIndex: rollingPreviewFrames,
                    rollingWindowFrames: state!.settings.sampleRate * 2,
                    previewGaps: traceHistory?.previewGaps,
                  }}
                />
                <SignalTrace
                  label="Whole acquisition signal overview"
                  caption="WHOLE ACQUISITION VIEW HISTORY / SCROLLABLE + ADAPTIVELY DECIMATED"
                  testIdPrefix="live-overview"
                  horizontalScroll
                  followResetKey={state!.id ?? undefined}
                  model={{
                    channels: overviewPreview.channels,
                    envelope: overviewPreview,
                    sampleRate: state!.settings.sampleRate,
                    decimation: overviewPreview.bucketFrames,
                    capacity: overviewPreview.capacity,
                    nextIndex: confirmedPreviewFrames,
                    expectedFrames: confirmedPreviewFrames,
                    domainMode: 'extent',
                    previewGaps: traceHistory?.previewGaps,
                  }}
                />
                {allChannelOverview && (
                  <AllChannelTrace
                    overview={allChannelOverview}
                    cursorFrame={confirmedPreviewFrames}
                    label="All configured channel overview"
                    testIdPrefix="live-all-channel"
                  />
                )}
                {allChannelOverviewStale && (
                  <p className="notice error mt-3" role="status">
                    {allChannelOverviewError
                      ? `The persisted all-channel overview may be stale: ${allChannelOverviewError}`
                      : 'Refreshing the finalized persisted all-channel overview.'}
                  </p>
                )}
                {!active && !allChannelOverview && allChannelOverviewError && (
                  <p className="notice error mt-5" role="alert">
                    All-channel overview unavailable: {allChannelOverviewError}
                  </p>
                )}
                <p
                  className="mt-3 text-xs leading-relaxed text-muted"
                  data-testid="live-preview-gaps"
                  data-preview-gap-count={traceHistory?.previewGaps.length ?? 0}
                >
                  {traceHistory?.previewGaps.length
                    ? `Preview not observed across ${traceHistory.previewGaps.length.toLocaleString('en-US')} interval${traceHistory.previewGaps.length === 1 ? '' : 's'}. The recorder may still contain every sample.`
                    : 'No browser preview gaps observed. The overview remains bounded and does not contain the full-rate sample stream.'}
                </p>
                <fieldset
                  className="mt-8 flex flex-wrap gap-3 border border-line bg-[#171917] p-4"
                  data-testid="live-chart-channel-panel"
                  disabled={!active}
                >
                  <legend className="micro px-2">
                    CHART CHANNELS / FOUR AT A TIME / ALL CHANNELS ARE RECORDED
                  </legend>
                  <div className="flex w-full flex-wrap items-center gap-3">
                    <button
                      className="inspect-button"
                      type="button"
                      aria-label="Previous trace group"
                      onClick={() =>
                        showLiveChartChannels(
                          Math.max(
                            0,
                            Math.floor((selectedChannels.current[0] ?? 0) / TRACE_CHANNEL_LIMIT) *
                              TRACE_CHANNEL_LIMIT -
                              TRACE_CHANNEL_LIMIT,
                          ),
                        )
                      }
                      disabled={(selectedChannels.current[0] ?? 0) < TRACE_CHANNEL_LIMIT}
                    >
                      Previous
                    </button>
                    <output
                      className="font-mono text-xs text-muted"
                      data-testid="live-chart-channels"
                    >
                      Chart: {channelWindowLabel(selectedChannels.current)}
                    </output>
                    <button
                      className="inspect-button"
                      type="button"
                      aria-label="Next trace group"
                      onClick={() =>
                        showLiveChartChannels(
                          Math.floor((selectedChannels.current[0] ?? 0) / TRACE_CHANNEL_LIMIT) *
                            TRACE_CHANNEL_LIMIT +
                            TRACE_CHANNEL_LIMIT,
                        )
                      }
                      disabled={
                        Math.floor((selectedChannels.current[0] ?? 0) / TRACE_CHANNEL_LIMIT) *
                          TRACE_CHANNEL_LIMIT +
                          TRACE_CHANNEL_LIMIT >=
                        state!.settings.channels
                      }
                    >
                      Next
                    </button>
                  </div>
                  {Array.from({ length: state!.settings.channels }, (_, channel) => (
                    <label key={channel} className="text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={selectedChannels.current.includes(channel)}
                        onChange={() => selectPreview(channel)}
                      />{' '}
                      Ch {channel}
                    </label>
                  ))}
                </fieldset>
              </div>
            )}
            <div className="primary-reading flex flex-1 flex-col justify-center px-[30px] pt-[35px] pb-[30px] max-[1050px]:px-[22px] max-[760px]:px-5 max-[760px]:py-[25px]">
              <div className="reading-label flex items-center gap-3.5 text-sm text-[#c7cbc6]">
                Recorded samples <span>ALL CHANNELS</span>
              </div>
              <output className="sample-count" data-testid="recorded-samples">
                {number(samples)}
              </output>
              <div className="count-caption mt-0.5 text-xs text-muted">
                {status === 'idle'
                  ? 'No recording started'
                  : complete
                    ? 'Final count · saved to disk'
                    : 'Scalar values written to disk'}
              </div>
            </div>
            <div className="measurements grid grid-cols-3 gap-5 px-[30px] pb-7 max-[1050px]:gap-2.5 max-[1050px]:px-[22px] max-[760px]:gap-2 max-[760px]:px-5 max-[760px]:pb-[25px]">
              <div>
                <span className="micro">SOURCE ELAPSED</span>
                <output>{clock(elapsed)}</output>
                <span>Monotonic clock</span>
              </div>
              <div>
                <span className="micro">RECORDED FRAMES</span>
                <output>{number(frames)}</output>
                <span>{number(measuredChannels)} values per frame</span>
              </div>
              <div>
                <span className="micro">FRAME DATA</span>
                <output>{bytes(size)}</output>
                <span>
                  {number(measuredChannels == null ? undefined : 8 + 4 * measuredChannels)} bytes
                  per frame
                </span>
              </div>
            </div>
            <div className="buffer border-t border-line px-[30px] py-[25px] max-[1050px]:px-[22px] max-[760px]:px-5 max-[760px]:py-[23px]">
              <div>
                <span className="micro">RECORDER QUEUE</span>
                <span>
                  {queued == null ? 'Awaiting acquisition' : `${bytes(queued)} / ${bytes(budget)}`}
                </span>
              </div>
              <div
                className="buffer-track mt-4 h-1 bg-[#343835]"
                role="meter"
                aria-label="Recording buffer usage"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={bufferPercent}
              >
                <span style={{ width: `${bufferPercent}%` }} />
              </div>
              <p>
                {complete
                  ? 'Accepted samples drained before finalization.'
                  : 'A fixed buffer keeps recording memory independent of run duration.'}
              </p>
            </div>
            <OverloadTelemetry state={state} />
            <div className="record-id flex items-center gap-[18px] border-t border-line bg-panel-deep px-[30px] py-5 max-[1050px]:px-[22px] max-[760px]:flex-wrap max-[760px]:gap-2 max-[760px]:px-5 max-[760px]:py-[18px]">
              <span className="micro">RECORDING ID</span>
              <code data-testid="recording-id">
                {state?.id || 'Assigned when acquisition starts'}
              </code>
            </div>
          </section>

          <aside
            className="control-panel border-l border-line bg-[#191b19] px-7 py-[26px] max-[1050px]:px-[22px] max-[1050px]:py-[25px] max-[760px]:border-t max-[760px]:border-l-0 max-[760px]:px-5"
            aria-label="Acquisition controls"
          >
            <div className="control-heading flex items-center justify-between">
              <span className="micro">INSTRUMENT SETUP</span>
              <span className="default-label border border-[#424641] px-[7px] py-[5px] font-mono text-[9px] tracking-[1px] text-muted">
                {active ? 'LOCKED' : 'EDITABLE'}
              </span>
            </div>
            <h2>
              {complete
                ? lost
                  ? 'Saved with gaps.'
                  : 'Safely on disk.'
                : status === 'recording'
                  ? 'Capture in progress.'
                  : status === 'stopping'
                    ? 'Finishing the record.'
                    : status === 'failed'
                      ? 'Attention required.'
                      : 'Ready when you are.'}
            </h2>
            <p className="control-description m-0 min-h-11 max-w-[330px] text-xs leading-[1.8] text-muted max-[760px]:min-h-0 max-[760px]:max-w-none">
              {descriptions[status]}
            </p>
            <ConfigurationForm
              draft={draft}
              fields={fields}
              disabled={!connected || busy || active}
              onChange={changeSetting}
              onStart={() => command('start')}
              runtime={runtime}
            />
            <div
              className={`controls grid gap-[9px] max-[760px]:fixed max-[760px]:z-10 max-[760px]:[&_button]:min-h-[46px] ${
                active
                  ? 'max-[760px]:right-5 max-[760px]:bottom-[max(14px,env(safe-area-inset-bottom))] max-[760px]:w-[180px] max-[760px]:grid-cols-1 max-[760px]:[&_.start-button]:hidden'
                  : 'max-[760px]:inset-x-0 max-[760px]:bottom-0 max-[760px]:grid-cols-[1.2fr_1fr] max-[760px]:border-t max-[760px]:border-line max-[760px]:bg-background max-[760px]:px-5 max-[760px]:pt-3.5 max-[760px]:pb-[max(14px,env(safe-area-inset-bottom))]'
              }`}
            >
              <button
                className="start-button"
                type="submit"
                form="acquisition-setup"
                aria-label="Start acquisition"
                disabled={!connected || busy || active}
              >
                <span
                  className="button-marker size-[7px] border border-current"
                  aria-hidden="true"
                />
                {status === 'starting' ? 'Starting acquisition…' : 'Start acquisition'}
                <span aria-hidden="true">↗</span>
              </button>
              <button
                className="stop-button"
                aria-label="Stop acquisition"
                disabled={!connected || busy || !active || status === 'stopping'}
                onClick={() => command('stop')}
              >
                <span aria-hidden="true">■</span>
                {status === 'stopping' ? 'Finishing writes…' : 'Stop acquisition'}
              </button>
            </div>
            <p className="control-note mt-4 mb-0 text-center text-[10px] leading-[1.6] text-muted">
              {runtime?.mode === 'public-demo'
                ? 'Saved on a shared persistent volume. Temporary recordings rotate automatically.'
                : 'Saved locally. No account or cloud connection required.'}
            </p>
          </aside>
        </div>

        {complete && (
          <section
            className="saved-panel flex items-center justify-between gap-6 border border-t-0 border-line bg-[#191c18] px-[30px] py-[25px] max-[1050px]:items-start max-[900px]:flex-col max-[900px]:gap-5 max-[760px]:px-5 max-[760px]:py-[23px]"
            aria-label="Saved recording"
          >
            <div className="saved-title flex items-center gap-5">
              <span
                className="saved-symbol grid size-[34px] shrink-0 place-items-center border border-[#565f4f] text-[17px] text-[#c1cfb2]"
                aria-hidden="true"
              >
                {lost ? '!' : '✓'}
              </span>
              <div>
                <p className="micro">ACQUISITION COMPLETE</p>
                <h2>Recording saved</h2>
                <p>
                  {lost
                    ? `${number(lost)} frames lost · ${number(lost * (state?.settings.channels ?? 0))} scalar values missing. Accepted samples are saved.`
                    : 'Accepted samples are on disk and metadata is finalized.'}
                </p>
              </div>
            </div>
            <div className="saved-action grid shrink-0 gap-3 text-right max-[900px]:w-full max-[900px]:text-left">
              <span className="font-mono text-[9px]">
                <VerificationStatusText
                  status={recordingSummary?.verification.status ?? 'unverified'}
                />
              </span>
              <div className="flex flex-wrap justify-end gap-2 max-[900px]:justify-start">
                <button
                  className="inspect-button"
                  onClick={inspect}
                  disabled={inspecting || !connected}
                >
                  {inspecting ? 'Reading metadata…' : 'Inspect recording'}{' '}
                  <span aria-hidden="true">↗</span>
                </button>
                <a
                  className="inspect-button"
                  href={`/recordings?id=${encodeURIComponent(state!.id!)}`}
                >
                  Open in Recordings
                </a>
                <a className="inspect-button" href={`/verify?id=${encodeURIComponent(state!.id!)}`}>
                  Verify recording
                </a>
              </div>
            </div>
          </section>
        )}

        {status === 'failed' && state?.id && (
          <section
            className="saved-panel flex items-center justify-between gap-6 border border-t-0 border-[#805a47] bg-[#211916] px-[30px] py-[25px] max-[760px]:flex-col max-[760px]:items-start max-[760px]:px-5"
            aria-label="Failed recording recovery"
          >
            <div>
              <p className="micro">READABLE PREFIX RETAINED</p>
              <h2 className="mt-2">Inspect what reached disk.</h2>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                This acquisition failed and cannot be verified as complete. Complete physical
                records remain available for inspection with explicit prefix acknowledgement.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                className="inspect-button"
                onClick={inspect}
                disabled={inspecting || !connected}
              >
                {inspecting ? 'Reading metadata…' : 'Inspect readable recording'}
              </button>
              <a className="inspect-button" href={`/recordings?id=${encodeURIComponent(state.id)}`}>
                Open in Recordings
              </a>
            </div>
          </section>
        )}

        {details && <RecordingDetails details={details} showAllChannelOverview={false} />}

        <section
          className="method grid grid-cols-[1.1fr_1fr_1fr_1fr] items-start gap-[30px] border-b border-line pt-[34px] pb-8 max-[1050px]:gap-4 max-[760px]:grid-cols-2 max-[760px]:gap-x-4 max-[760px]:gap-y-[25px] max-[760px]:py-7"
          aria-label="How recording works"
        >
          <div className="method-intro">
            <span className="micro">THE RECORDING PATH</span>
            <p>
              One clock.
              <br />
              An honest record.
            </p>
          </div>
          <div>
            <span className="step font-mono text-[9px] tracking-[.8px] text-muted">
              01 / SOURCE
            </span>
            <h3>Clock-paced signal</h3>
            <p>A deterministic signal generated against elapsed time.</p>
          </div>
          <div>
            <span className="step font-mono text-[9px] tracking-[.8px] text-muted">
              02 / CAPTURE
            </span>
            <h3>Independent recorder</h3>
            <p>A separate process writes accepted samples to disk.</p>
          </div>
          <div>
            <span className="step font-mono text-[9px] tracking-[.8px] text-muted">
              03 / STORAGE
            </span>
            <h3>Indexed binary data</h3>
            <p>Original frame positions and readable metadata.</p>
          </div>
        </section>
        <footer>
          <span>
            SCOPE <span className="footer-slash px-2.5">/</span> LOCAL ACQUISITION
          </span>
          <span>Deterministic by design. Measured in operation.</span>
        </footer>
      </main>
    </>
  );
}
