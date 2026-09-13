'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlaybackState, RecordingInspection } from '../core/contracts';

const statusName = {
  idle: 'Idle',
  paused: 'Paused',
  playing: 'Playing',
  ended: 'Ended',
  error: 'Error',
};
const colors = ['#ff9b87', '#b8d6a5', '#8fc6cf', '#d4b4db'];
const integer = (value: number) => value.toLocaleString('en-US');
const seconds = (value: number) => `${value.toFixed(3)} s`;
const milliseconds = (value: number) => `${value.toFixed(1)} ms`;

function PlaybackTrace({ state }: { state: PlaybackState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = state.preview;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const context = element.getContext('2d');
      if (!context) return;
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, element.clientWidth);
      const height = Math.max(1, element.clientHeight);
      element.width = Math.floor(width * ratio);
      element.height = Math.floor(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = '#323733';
      context.lineWidth = 1;
      for (let line = 1; line < 4; line++) {
        const y = (height * line) / 4;
        context.beginPath();
        context.moveTo(0, y);
        context.lineTo(width, y);
        context.stroke();
      }
      const observations = preview.observations;
      if (!observations.length) return;
      const first = observations[0].index;
      const last = observations.at(-1)!.index;
      const span = Math.max(1, last - first);
      preview.channels.forEach((_, channelIndex) => {
        context.strokeStyle = colors[channelIndex % colors.length];
        context.lineWidth = 1.5;
        context.beginPath();
        let previousIndex: number | null = null;
        for (const observation of observations) {
          const x = ((observation.index - first) / span) * width;
          const value = Math.max(-1, Math.min(1, observation.values[channelIndex] ?? 0));
          const y = height / 2 - value * (height * 0.42);
          if (previousIndex === null || observation.index - previousIndex > preview.decimation * 2)
            context.moveTo(x, y);
          else context.lineTo(x, y);
          previousIndex = observation.index;
        }
        context.stroke();
      });
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(element);
    return () => observer.disconnect();
  }, [preview]);
  const latest = preview.observations.at(-1);
  return (
    <div className="mt-5 border border-line bg-[#171917] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="micro">DECIMATED PREVIEW FROM STORED OBSERVATIONS</span>
        <span className="font-mono text-[10px] text-muted">
          {preview.observations.length}/{preview.capacity} points · every {preview.decimation} frame
          {preview.decimation === 1 ? '' : 's'}
        </span>
      </div>
      <canvas
        ref={canvas}
        data-testid="playback-trace"
        className="mt-4 h-52 w-full"
        aria-label="Playback signal trace"
      />
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] text-muted">
        {preview.channels.map((channel, index) => (
          <span key={channel}>
            <span
              className="mr-2 inline-block size-2"
              style={{ backgroundColor: colors[index % colors.length] }}
              aria-hidden="true"
            />
            Channel {channel}: {latest ? latest.values[index]?.toFixed(5) : '—'}
          </span>
        ))}
        <span data-testid="playback-latest-frame">
          Latest original frame: {latest ? integer(latest.index) : '—'}
        </span>
      </div>
    </div>
  );
}

export function PlaybackPanel({ details }: { details: RecordingInspection }) {
  const playable = details.status === 'completed' && details.expectedFrames !== null;
  const [state, setState] = useState<PlaybackState | null>(null);
  const [busy, setBusy] = useState(playable);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!playable) return;
    let active = true;
    const controller = new AbortController();
    const events = new EventSource('/api/events');
    events.addEventListener('playback', (event) => {
      if (active) setState(JSON.parse(event.data));
    });
    fetch('/api/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open', recordingId: details.id }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Playback could not be opened');
        return result as PlaybackState;
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
      events.close();
    };
  }, [details.id, playable]);

  async function command(action: 'open' | 'play' | 'restart') {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/playback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, recordingId: details.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Playback ${action} failed`);
      setState(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const activeHere = state?.recordingId === details.id;
  const current = activeHere ? state : null;
  return (
    <section className="mt-8 border-t border-line pt-6" aria-label="Recording playback">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="micro">NATIVE-RATE PLAYBACK / 1×</p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-muted">
            Full selected frames cross the bounded playback sink. This trace is a separate,
            decimated view of accepted stored observations.
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
          <button className="inspect-button mt-3" onClick={() => void command('open')}>
            Reopen this playback
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="notice error mt-4">
          {error}
        </p>
      )}
      {current && (
        <>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="start-button min-w-32"
              onClick={() => void command('play')}
              disabled={
                busy ||
                current.status === 'playing' ||
                current.status === 'ended' ||
                current.status === 'error'
              }
            >
              {current.status === 'playing' ? 'Playing…' : 'Play at 1×'}
            </button>
            <button
              className="stop-button min-w-32"
              onClick={() => void command('restart')}
              disabled={busy || current.status === 'playing' || current.status === 'paused'}
            >
              Restart
            </button>
          </div>
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
              <dt>Emitted frames</dt>
              <dd>{integer(current.emittedFrames)}</dd>
            </div>
            <div>
              <dt>Emitted samples</dt>
              <dd>{integer(current.emittedSamples)}</dd>
            </div>
            <div>
              <dt>Active elapsed</dt>
              <dd>{milliseconds(current.activeElapsedMs)}</dd>
            </div>
            <div>
              <dt>Current lag</dt>
              <dd>
                {milliseconds(current.currentLagMs)} / {integer(current.currentLagFrames)} frames
              </dd>
            </div>
            <div>
              <dt>Maximum lag</dt>
              <dd>{milliseconds(current.maxLagMs)}</dd>
            </div>
            <div>
              <dt>Skipped duplicate frames</dt>
              <dd>{integer(current.skippedDuplicateFrames)}</dd>
            </div>
          </dl>
          <PlaybackTrace state={current} />
        </>
      )}
    </section>
  );
}
