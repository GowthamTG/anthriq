'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import type { AcquisitionState, RecordingInspection } from '../core/contracts';
import { OverloadTelemetry } from './overload-telemetry';
import { RecordingDetails } from './recording-details';
import { config } from '../core/config';
import { ConfigurationForm, draftFrom, type ConfigurationDraft } from './configuration-form';
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
  const [state, setState] = useState<AcquisitionState | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting' | 'offline'>(
    'connecting',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<RecordingInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [draft, setDraft] = useState(() => draftFrom(config()));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [clientId, setClientId] = useState<string | null>(null);
  const observedId = useRef<string | null | undefined>(undefined);
  const selectedChannels = useRef([0, 1, 2, 3]);
  const subscribedRecording = useRef<string | null>(null);
  useEffect(() => setClientId(crypto.randomUUID()), []);
  useEffect(() => {
    if (!clientId) return;
    let events: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let delay = 250;
    const apply = (snapshot: AcquisitionState) => {
      setState(snapshot);
      if (observedId.current !== snapshot.id) {
        setDraft(draftFrom(snapshot.settings));
        observedId.current = snapshot.id;
      }
    };
    const connect = async () => {
      if (cancelled) return;
      setConnection((current) => (current === 'connecting' ? current : 'reconnecting'));
      try {
        // A browser session is established by SSE; use the public current state to hydrate before
        // that subscription exists, then replace it with the session-specific SSE snapshot.
        const response = await fetch('/api/state');
        if (!response.ok) throw new Error('Snapshot unavailable');
        const snapshot = await response.json();
        apply(snapshot);
        if (cancelled) return;
        // The selected channels belong to this browser, but the previous recording may have
        // used fewer channels than the default four.  Clamp before opening the strict SSE
        // subscription so a fresh tab can always establish its initial connection.
        const channels = selectedChannels.current.filter(
          (channel) => channel < snapshot.settings.channels,
        );
        selectedChannels.current = channels.length ? channels : [0];
        const query = new URLSearchParams({
          clientId,
          channels: selectedChannels.current.join(','),
        });
        events = new EventSource(`/api/events?${query}`);
        events.addEventListener('state', (event) => {
          apply(JSON.parse(event.data));
          delay = 250;
          setConnection('live');
        });
        events.onerror = () => {
          events?.close();
          events = null;
          if (cancelled) return;
          setConnection(navigator.onLine ? 'reconnecting' : 'offline');
          retry = setTimeout(connect, delay);
          delay = Math.min(4000, delay * 2);
        };
      } catch {
        if (cancelled) return;
        setConnection(navigator.onLine ? 'reconnecting' : 'offline');
        retry = setTimeout(connect, delay);
        delay = Math.min(4000, delay * 2);
      }
    };
    const online = () => {
      if (!events && !retry) void connect();
    };
    const offline = () => setConnection('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      events?.close();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [clientId]);

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

  function changeSetting(key: keyof ConfigurationDraft, value: string) {
    setError(null);
    setDraft((previous) => ({ ...previous, [key]: value }));
    setFields((previous) => ({ ...previous, [key]: '' }));
  }

  async function command(action: 'start' | 'stop') {
    setBusy(true);
    setError(null);
    setFields({});
    if (action === 'start') setDetails(null);
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
        throw new Error(result.error);
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
      const response = await fetch(`/api/acquisitions/${state?.id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDetails(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setInspecting(false);
    }
  }

  async function selectPreview(channel: number) {
    if (!state?.id) return;
    const current = selectedChannels.current;
    const channels = current.includes(channel)
      ? current.filter((value) => value !== channel)
      : [...current, channel].sort((left, right) => left - right);
    if (!channels.length) return setError('Keep at least one live preview channel selected.');
    if (channels.length > 4) return setError('Show at most four live preview channels at once.');
    const response = await fetch(`/api/acquisitions/${state.id}/preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, channels }),
    });
    const result = await response.json();
    if (!response.ok) return setError(result.error || 'Preview selection failed');
    selectedChannels.current = channels;
    setState(result);
  }

  return (
    <>
      <header className="topbar flex h-[86px] items-center justify-between border-b border-line px-12 max-[1050px]:px-7 max-[760px]:h-[70px] max-[760px]:px-5">
        <a
          href="/"
          className="brand flex items-center gap-3 text-[23px] font-extrabold tracking-[3px] max-[760px]:text-xl"
          aria-label="SCOPE home"
        >
          <span
            className="brand-mark grid size-[30px] place-items-center bg-accent pr-[3px] text-[22px] tracking-[-3px] text-[#111]"
            aria-hidden="true"
          >
            S
          </span>
          SCOPE
          <span className="brand-caption ml-[18px] font-mono text-[9px] font-normal tracking-[1.2px] text-muted max-[760px]:hidden">
            SIGNAL INSTRUMENTS
          </span>
        </a>
        <nav aria-label="Workspace" className="ml-auto mr-6 flex items-center gap-5 text-xs">
          <a href="/recordings" className="text-muted hover:text-white">
            Recordings
          </a>
          <a href="/verify" className="text-muted hover:text-white">
            Verify ↗
          </a>
        </nav>
        <div
          className="connection flex items-center gap-2.5 font-mono text-[11px] text-muted max-[760px]:gap-[7px] max-[760px]:text-[9px]"
          data-browser-session={clientId || undefined}
        >
          <span className={connected ? 'connection-dot online' : 'connection-dot'} />
          <span>
            {connected
              ? 'Local connection'
              : connection === 'offline'
                ? 'Disconnected'
                : state
                  ? 'Reconnecting'
                  : 'Connecting'}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-[1456px] px-12 max-[1050px]:px-7 max-[760px]:px-5 max-[760px]:pb-[90px]">
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
            {preview && (
              <div className="px-[30px] pt-6 max-[1050px]:px-[22px] max-[760px]:px-5">
                <SignalTrace
                  label="Live acquired signal trace"
                  model={{
                    channels: preview.channels,
                    envelope: preview,
                    sampleRate: state!.settings.sampleRate,
                    decimation: preview.bucketFrames,
                    capacity: preview.capacity,
                    nextIndex: preview.buckets.at(-1)?.end || 0,
                  }}
                />
                <fieldset className="mt-4 flex flex-wrap gap-3" disabled={!active}>
                  <legend className="micro">
                    LIVE CHANNELS / DECIMATED MIN-MAX FROM PERSISTED FRAMES
                  </legend>
                  {Array.from({ length: state!.settings.channels }, (_, channel) => (
                    <label key={channel} className="text-xs text-muted">
                      <input
                        type="checkbox"
                        checked={selectedChannels.current.includes(channel)}
                        onChange={() => void selectPreview(channel)}
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
            />
            <div className="controls grid gap-[9px] max-[760px]:fixed max-[760px]:inset-x-0 max-[760px]:bottom-0 max-[760px]:z-10 max-[760px]:grid-cols-[1.2fr_1fr] max-[760px]:border-t max-[760px]:border-line max-[760px]:bg-background max-[760px]:px-5 max-[760px]:pt-3.5 max-[760px]:pb-[max(14px,env(safe-area-inset-bottom))] max-[760px]:[&_button]:min-h-[46px]">
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
              Saved locally. No account or cloud connection required.
            </p>
          </aside>
        </div>

        {complete && (
          <section
            className="saved-panel flex items-center justify-between gap-6 border border-t-0 border-line bg-[#191c18] px-[30px] py-[25px] max-[1050px]:items-start max-[760px]:flex-col max-[760px]:gap-5 max-[760px]:px-5 max-[760px]:py-[23px]"
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
            <div className="saved-action grid shrink-0 gap-3 text-right max-[760px]:w-full max-[760px]:text-left">
              <span className="unverified font-mono text-[9px] text-[#c0ba9c]">
                Integrity not yet verified
              </span>
              <button
                className="inspect-button"
                onClick={inspect}
                disabled={inspecting || !connected}
              >
                {inspecting ? 'Reading metadata…' : 'Inspect recording'}{' '}
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </section>
        )}

        {details && <RecordingDetails details={details} />}

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
