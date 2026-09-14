'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import {
  TRACE_CHANNEL_LIMIT,
  type PlaybackCommand,
  type PlaybackState,
  type RecordingInspection,
} from '../core/contracts';
import { requestJson } from './http';
import { useServiceEvents } from './use-service-events';
import { channelWindowLabel } from './channel-window';

const SignalTrace = dynamic(() => import('./signal-trace').then((module) => module.SignalTrace), {
  ssr: false,
  loading: () => (
    <div className="mt-5 min-h-[340px] border border-line bg-[#171917] p-4 text-xs text-muted">
      Loading signal chart...
    </div>
  ),
});

const statusName = {
  idle: 'Idle',
  paused: 'Paused',
  playing: 'Playing',
  ended: 'Ended',
  error: 'Error',
};
const SPEED_PRESETS = [0.25, 0.5, 1, 2, 4];
const integer = (value: number) => value.toLocaleString('en-US');
const seconds = (value: number) => `${value.toFixed(3)} s`;
const milliseconds = (value: number) => `${value.toFixed(1)} ms`;
export function PlaybackPanel({
  details,
  onPositionChange,
}: {
  details: RecordingInspection;
  onPositionChange?: (position: number) => void;
}) {
  const playable = details.status === 'completed' && details.expectedFrames !== null;
  const [state, setState] = useState<PlaybackState | null>(null);
  const [busy, setBusy] = useState(playable);
  const [error, setError] = useState('');
  const [seekMode, setSeekMode] = useState<'position' | 'positionSeconds'>('position');
  const [seekValue, setSeekValue] = useState('0');
  const [timelineDraft, setTimelineDraft] = useState(0);
  const [editingTimeline, setEditingTimeline] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const scrubTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubGeneration = useRef(0);
  const scrubPending = useRef<{ position: number; generation: number } | null>(null);
  const scrubDrain = useRef<Promise<void> | null>(null);
  const [speedValue, setSpeedValue] = useState('1');
  const connection = useServiceEvents({
    url: playable ? '/api/events' : null,
    handlers: { playback: (value) => setState(value as PlaybackState) },
  });
  const connected = connection === 'live';
  useEffect(() => {
    if (!playable) return;
    let active = true;
    const controller = new AbortController();
    requestJson<PlaybackState>('/api/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', recordingId: details.id }),
      signal: controller.signal,
    })
      .then((result) => {
        if (active) setState(result);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [details.id, playable]);

  const activeHere = state?.recordingId === details.id;
  const current = activeHere ? state : null;
  const chartStart = current
    ? Math.max(0, current.channels.indexOf(current.preview.channels[0]))
    : 0;

  useEffect(() => {
    if (current && !editingTimeline) setTimelineDraft(current.position);
  }, [current, editingTimeline]);
  useEffect(
    () => onPositionChange?.(current?.position ?? 0),
    [current?.position, onPositionChange],
  );
  useEffect(() => {
    if (current) setSpeedValue(String(current.speed));
  }, [current?.speed]);
  useEffect(
    () => () => {
      if (scrubTimer.current) clearTimeout(scrubTimer.current);
      scrubPending.current = null;
      scrubGeneration.current++;
    },
    [],
  );

  async function command(request: PlaybackCommand) {
    setBusy(true);
    setError('');
    try {
      if (scrubTimer.current) {
        clearTimeout(scrubTimer.current);
        scrubTimer.current = null;
        scrubPending.current = {
          position: timelineDraft,
          generation: ++scrubGeneration.current,
        };
      }
      if (scrubPending.current || scrubDrain.current) await drainTimeline();
      const result = await requestJson<PlaybackState>('/api/playback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      setState(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  function seek(position: number) {
    if (!current) return;
    void command({ action: 'seek', recordingId: details.id, position });
  }

  function previewTimeline(position: number) {
    setTimelineDraft(position);
    if (!current || current.status === 'playing') return;
    if (scrubTimer.current) clearTimeout(scrubTimer.current);
    const generation = ++scrubGeneration.current;
    scrubTimer.current = setTimeout(() => {
      scrubTimer.current = null;
      scrubPending.current = { position, generation };
      void drainTimeline();
    }, 50);
  }

  function drainTimeline(): Promise<void> {
    if (scrubDrain.current) return scrubDrain.current;
    const drain = (async () => {
      setScrubbing(true);
      while (scrubPending.current) {
        const pending = scrubPending.current;
        scrubPending.current = null;
        try {
          const result = await requestJson<PlaybackState>('/api/playback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'seek',
              recordingId: details.id,
              position: pending.position,
            }),
          });
          if (scrubGeneration.current === pending.generation && scrubPending.current === null)
            setState(result);
        } catch (cause) {
          if (scrubGeneration.current === pending.generation && scrubPending.current === null)
            setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    })();
    scrubDrain.current = drain;
    void drain.finally(() => {
      if (scrubDrain.current === drain) scrubDrain.current = null;
      setScrubbing(false);
    });
    return drain;
  }

  function commitTimeline() {
    if (scrubTimer.current) clearTimeout(scrubTimer.current);
    scrubTimer.current = null;
    setEditingTimeline(false);
    if (
      current &&
      (timelineDraft !== current.position || scrubPending.current || scrubDrain.current)
    ) {
      scrubPending.current = {
        position: timelineDraft,
        generation: ++scrubGeneration.current,
      };
      void drainTimeline();
    }
  }

  function submitExactSeek() {
    const value = Number(seekValue);
    if (!Number.isFinite(value)) {
      setError('Enter a finite playback offset.');
      return;
    }
    if (seekMode === 'position') seek(value);
    else void command({ action: 'seek', recordingId: details.id, positionSeconds: value });
  }

  function toggleChannel(channel: number) {
    if (!current) return;
    const channels = current.channels.includes(channel)
      ? current.channels.filter((candidate) => candidate !== channel)
      : [...current.channels, channel].sort((left, right) => left - right);
    if (!channels.length) {
      setError('Keep at least one playback channel selected.');
      return;
    }
    void command({ action: 'channels', recordingId: details.id, channels });
  }

  function showChartChannels(start: number) {
    if (!current) return;
    void command({
      action: 'preview-channels',
      recordingId: details.id,
      channels: current.channels.slice(start, start + TRACE_CHANNEL_LIMIT),
    });
  }
  const timelineUnavailable = busy || !connected;
  const commandsUnavailable = timelineUnavailable || scrubbing;

  return (
    <section className="mt-8 border-t border-line pt-6" aria-label="Recording playback">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="micro">CONTROLLED FORWARD PLAYBACK / 0.1×–8×</p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">
            Full selected frames cross the bounded playback sink. The chart is a separate decimated
            view of accepted stored observations.
          </p>
        </div>
        {current && (
          <span
            data-testid="playback-status"
            role="status"
            className={current.status === 'error' ? 'state state-failed' : 'state'}
          >
            {statusName[current.status]}
          </span>
        )}
      </div>
      {!playable && (
        <p className="notice mt-4">
          Playback requires a completed recording with a confirmed source extent. The readable
          prefix remains available through exact range inspection.
        </p>
      )}
      {playable && busy && !current && (
        <p role="status" className="mt-4 text-sm text-muted">
          Opening playback…
        </p>
      )}
      {playable && !busy && state && !activeHere && (
        <div role="status" className="notice mt-4">
          <p>Another recording now owns the playback session.</p>
          <button
            className="inspect-button mt-3"
            onClick={() => void command({ action: 'open', recordingId: details.id })}
            disabled={commandsUnavailable}
          >
            Reopen this playback
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="notice error mt-4">
          {error}
        </p>
      )}
      {playable && !connected && (
        <p role="status" className="notice mt-4">
          {connection === 'offline'
            ? 'Playback controls are disconnected.'
            : 'Restoring playback controls.'}{' '}
          The last displayed position may be stale.
        </p>
      )}
      {current && (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="start-button min-w-32"
              onClick={() => void command({ action: 'play', recordingId: details.id })}
              disabled={
                commandsUnavailable ||
                current.status === 'playing' ||
                current.status === 'ended' ||
                current.status === 'error'
              }
            >
              {current.position === 0 ? 'Play' : 'Resume'}
            </button>
            <button
              className="stop-button min-w-32"
              onClick={() => void command({ action: 'pause', recordingId: details.id })}
              disabled={commandsUnavailable || current.status !== 'playing'}
            >
              Pause
            </button>
            <button
              className="inspect-button min-w-32"
              onClick={() => void command({ action: 'restart', recordingId: details.id })}
              disabled={timelineUnavailable}
            >
              Restart
            </button>
          </div>

          <div className="mt-6 border border-line bg-[#171917] p-4">
            <label className="micro" htmlFor="playback-timeline">
              TIMELINE / NEXT ORIGINAL FRAME {integer(timelineDraft)} OF{' '}
              {integer(current.expectedFrames)}
            </label>
            <input
              id="playback-timeline"
              data-testid="playback-timeline"
              className="mt-3 w-full accent-[#b8d6a5]"
              type="range"
              min="0"
              max={current.expectedFrames}
              step="1"
              value={timelineDraft}
              disabled={commandsUnavailable}
              onPointerDown={() => setEditingTimeline(true)}
              onChange={(event) => previewTimeline(Number(event.target.value))}
              onPointerUp={commitTimeline}
              onKeyUp={(event) => {
                if (
                  ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(
                    event.key,
                  )
                )
                  commitTimeline();
              }}
            />
            <p className="mt-2 font-mono text-[10px] text-muted">
              {seconds(timelineDraft / current.sampleRate!)} on the original acquisition timeline.
              Seeking to the final exclusive frame ends playback.
            </p>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="block text-xs text-muted">
                <span className="micro block">EXACT SEEK BY</span>
                <select
                  className="mt-2 border border-line bg-[#111311] px-2 py-2 text-sm text-white"
                  value={seekMode}
                  onChange={(event) =>
                    setSeekMode(event.target.value as 'position' | 'positionSeconds')
                  }
                  disabled={commandsUnavailable}
                >
                  <option value="position">Original frame</option>
                  <option value="positionSeconds">Elapsed seconds</option>
                </select>
              </label>
              <label className="block text-xs text-muted">
                <span className="micro block">OFFSET</span>
                <input
                  data-testid="playback-exact-seek"
                  className="mt-2 w-40 border border-line bg-[#111311] px-2 py-2 font-mono text-sm text-white"
                  type="number"
                  min="0"
                  step={seekMode === 'position' ? '1' : '0.001'}
                  value={seekValue}
                  onChange={(event) => setSeekValue(event.target.value)}
                  disabled={commandsUnavailable}
                />
              </label>
              <button
                className="inspect-button"
                onClick={submitExactSeek}
                disabled={commandsUnavailable}
              >
                Seek
              </button>
            </div>
          </div>

          <div className="mt-5 border border-line bg-[#171917] p-4">
            <div className="flex flex-wrap items-end gap-4">
              <div role="group" aria-label="Playback speed presets">
                <p className="micro">PLAYBACK SPEED</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {SPEED_PRESETS.map((speed) => (
                    <button
                      key={speed}
                      className={current.speed === speed ? 'start-button' : 'inspect-button'}
                      aria-pressed={current.speed === speed}
                      onClick={() =>
                        void command({ action: 'speed', recordingId: details.id, speed })
                      }
                      disabled={commandsUnavailable}
                    >
                      {speed}×
                    </button>
                  ))}
                </div>
              </div>
              <label className="block text-xs text-muted">
                <span className="micro block">CUSTOM / 0.1×–8×</span>
                <div className="mt-2 flex gap-2">
                  <input
                    data-testid="playback-speed"
                    className="w-24 border border-line bg-[#111311] px-2 py-2 font-mono text-sm text-white"
                    type="number"
                    min="0.1"
                    max="8"
                    step="0.1"
                    value={speedValue}
                    onChange={(event) => setSpeedValue(event.target.value)}
                    disabled={commandsUnavailable}
                  />
                  <button
                    className="inspect-button"
                    onClick={() =>
                      void command({
                        action: 'speed',
                        recordingId: details.id,
                        speed: Number(speedValue),
                      })
                    }
                    disabled={commandsUnavailable}
                  >
                    Apply
                  </button>
                </div>
              </label>
            </div>
          </div>

          <fieldset
            className="mt-8 border border-line bg-[#171917] p-4"
            disabled={commandsUnavailable}
          >
            <legend className="micro px-1">
              PLAYBACK CHANNELS / {current.channels.length} SELECTED
            </legend>
            <p className="mt-1 text-xs text-muted">
              All selected channels are emitted by playback. The chart displays four at a time.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                className="inspect-button"
                type="button"
                aria-label="Previous trace group"
                onClick={() => showChartChannels(Math.max(0, chartStart - TRACE_CHANNEL_LIMIT))}
                disabled={chartStart === 0}
              >
                Previous
              </button>
              <output
                className="font-mono text-xs text-muted"
                data-testid="playback-chart-channels"
              >
                Chart: {channelWindowLabel(current.preview.channels)}
              </output>
              <button
                className="inspect-button"
                type="button"
                aria-label="Next trace group"
                onClick={() => showChartChannels(chartStart + TRACE_CHANNEL_LIMIT)}
                disabled={chartStart + TRACE_CHANNEL_LIMIT >= current.channels.length}
              >
                Next
              </button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-x-3 gap-y-2 text-xs sm:grid-cols-6 lg:grid-cols-8">
              {Array.from({ length: details.channels }, (_, channel) => (
                <label key={channel} className="flex items-center gap-2 text-muted">
                  <input
                    type="checkbox"
                    checked={current.channels.includes(channel)}
                    onChange={() => toggleChannel(channel)}
                  />
                  Ch {channel}
                </label>
              ))}
            </div>
          </fieldset>

          {current.error && (
            <p role="alert" className="notice error mt-4">
              {current.error}
            </p>
          )}
          <dl
            data-testid="playback-metrics"
            className="details-grid mt-6 grid grid-cols-4 gap-5 max-[900px]:grid-cols-2"
          >
            <div>
              <dt>Next original frame</dt>
              <dd>
                {integer(current.position)} / {integer(current.expectedFrames)}
              </dd>
            </div>
            <div>
              <dt>Position / duration</dt>
              <dd>
                {seconds(current.positionSeconds)} / {seconds(current.durationSeconds)}
              </dd>
            </div>
            <div>
              <dt>Speed</dt>
              <dd>{current.speed}×</dd>
            </div>
            <div>
              <dt>Segment start</dt>
              <dd>{integer(current.segmentStartPosition)}</dd>
            </div>
            <div>
              <dt>Emitted frames</dt>
              <dd>{integer(current.emittedFrames)}</dd>
            </div>
            <div>
              <dt>Emitted samples</dt>
              <dd>{integer(current.emittedSamples)}</dd>
            </div>
            <div>
              <dt>Active segment</dt>
              <dd>{milliseconds(current.activeElapsedMs)}</dd>
            </div>
            <div>
              <dt>Current lag</dt>
              <dd>
                {milliseconds(current.currentLagMs)} / {integer(current.currentLagFrames)} frames
              </dd>
            </div>
            <div>
              <dt>Maximum segment lag</dt>
              <dd>{milliseconds(current.maxLagMs)}</dd>
            </div>
            <div>
              <dt>Skipped duplicate frames</dt>
              <dd>{integer(current.skippedDuplicateFrames)}</dd>
            </div>
          </dl>
          <SignalTrace
            label="Playback signal trace with original-frame and elapsed-time axes"
            model={{
              channels: current.preview.channels,
              observations: current.preview.observations,
              sampleRate: current.sampleRate!,
              decimation: current.preview.decimation,
              capacity: current.preview.capacity,
              nextIndex: current.position,
              expectedFrames: current.expectedFrames,
            }}
          />
        </>
      )}
    </section>
  );
}
