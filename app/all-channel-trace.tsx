'use client';

import { useEffect, useRef } from 'react';
import type { AllChannelOverview } from '../core/contracts';

const LANE_HEIGHT = 20;
const TOP = 34;
const BOTTOM = 48;
const LEFT = 4;
const RIGHT = 4;
const COLORS = ['#ff9b87', '#b8d6a5', '#8fc6cf', '#d4b4db'];

interface StaticTrace {
  bitmap: HTMLCanvasElement;
  width: number;
  height: number;
  ratio: number;
  extentEnd: number;
}

function buildStaticTrace(
  canvas: HTMLCanvasElement,
  overview: AllChannelOverview,
): StaticTrace | null {
  const width = Math.max(240, Math.floor(canvas.clientWidth));
  const height = TOP + overview.channels.length * LANE_HEIGHT + BOTTOM;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const bitmap = document.createElement('canvas');
  bitmap.width = canvas.width;
  bitmap.height = canvas.height;
  const context = bitmap.getContext('2d');
  if (!context) return null;
  context.scale(ratio, ratio);
  context.clearRect(0, 0, width, height);
  context.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
  context.textBaseline = 'middle';
  const plotWidth = Math.max(1, width - LEFT - RIGHT);
  const extentEnd = Math.max(1, overview.confirmedFrames - 1);
  const x = (frame: number) =>
    LEFT + (Math.max(0, Math.min(extentEnd, frame)) / extentEnd) * plotWidth;

  context.fillStyle = '#8f968f';
  context.textAlign = 'left';
  context.fillText('0.000 s', LEFT, 13);
  context.textAlign = 'right';
  context.fillText(
    `${(Math.max(0, overview.confirmedFrames - 1) / overview.sampleRate || 0).toFixed(3)} s`,
    width - RIGHT,
    13,
  );

  overview.channels.forEach((channel, channelIndex) => {
    const top = TOP + channelIndex * LANE_HEIGHT;
    const middle = top + LANE_HEIGHT / 2;
    context.strokeStyle = '#303530';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(LEFT, top + LANE_HEIGHT);
    context.lineTo(width - RIGHT, top + LANE_HEIGHT);
    context.stroke();
    context.strokeStyle = COLORS[channelIndex % COLORS.length];
    context.lineWidth = 1.2;
    context.beginPath();
    overview.observations.forEach((observation, observationIndex) => {
      const value = Math.max(-1, Math.min(1, observation.values[channelIndex] ?? 0));
      const y = middle - value * (LANE_HEIGHT * 0.38);
      if (observationIndex === 0) context.moveTo(x(observation.index), y);
      else context.lineTo(x(observation.index), y);
    });
    context.stroke();
  });

  context.fillStyle = '#8f968f';
  context.textAlign = 'left';
  context.fillText('0', LEFT, height - 18);
  context.textAlign = 'right';
  context.fillText(
    overview.confirmedFrames === 0
      ? 'no frames'
      : (overview.confirmedFrames - 1).toLocaleString('en-US'),
    width - RIGHT,
    height - 18,
  );
  return { bitmap, width, height, ratio, extentEnd };
}

function paintMarker(canvas: HTMLCanvasElement, trace: StaticTrace, cursorFrame: number) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(trace.bitmap, 0, 0);
  context.setTransform(trace.ratio, 0, 0, trace.ratio, 0, 0);
  const plotWidth = Math.max(1, trace.width - LEFT - RIGHT);
  const marker =
    LEFT + (Math.max(0, Math.min(trace.extentEnd, cursorFrame - 1)) / trace.extentEnd) * plotWidth;
  context.strokeStyle = '#ff715b';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(marker, TOP);
  context.lineTo(marker, trace.height - BOTTOM);
  context.stroke();
}

export function AllChannelTrace({
  overview,
  cursorFrame,
  label,
  testIdPrefix,
}: {
  overview: AllChannelOverview;
  cursorFrame: number;
  label: string;
  testIdPrefix: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const staticTrace = useRef<StaticTrace | null>(null);
  const current = useRef({ overview, cursorFrame });
  current.current = { overview, cursorFrame };
  const height = TOP + overview.channels.length * LANE_HEIGHT + BOTTOM;

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const rebuild = () => {
      staticTrace.current = buildStaticTrace(element, current.current.overview);
      if (staticTrace.current)
        paintMarker(element, staticTrace.current, current.current.cursorFrame);
    };
    const observer = new ResizeObserver(rebuild);
    observer.observe(element);
    rebuild();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canvas.current) return;
    staticTrace.current = buildStaticTrace(canvas.current, overview);
    if (staticTrace.current) paintMarker(canvas.current, staticTrace.current, cursorFrame);
  }, [overview]);

  useEffect(() => {
    if (canvas.current && staticTrace.current)
      paintMarker(canvas.current, staticTrace.current, cursorFrame);
  }, [cursorFrame]);

  return (
    <figure
      className="mt-5 border border-line bg-[#171917] p-4"
      data-testid={`${testIdPrefix}-panel`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="micro">ALL-CHANNEL PERSISTED OVERVIEW / STACKED LANES</span>
        <span className="font-mono text-[10px] text-muted">
          {overview.channels.length} channels | {overview.observations.length}/{overview.capacity}{' '}
          frames
        </span>
      </div>
      <figcaption
        className="text-xs leading-relaxed text-muted"
        data-testid={`${testIdPrefix}-context`}
      >
        {overview.confirmedFrames === 0 ? (
          <>No recorded frames; exclusive extent 0. </>
        ) : (
          <>
            Uniformly sampled persisted observations. Normalized amplitude per lane. Shared
            original-frame and elapsed-time domain from frame 0 through{' '}
            {(overview.confirmedFrames - 1).toLocaleString('en-US')} (exclusive extent{' '}
            {overview.confirmedFrames.toLocaleString('en-US')}).{' '}
          </>
        )}
        This overview is bounded and is not the full-rate sample stream.
      </figcaption>
      <div>
        <div role="img" aria-label={label} className="mt-4 min-w-0 overflow-hidden">
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)]">
            <div
              className="font-mono text-[11px] text-muted"
              data-testid={`${testIdPrefix}-labels`}
              aria-hidden="true"
              style={{ paddingTop: TOP, paddingBottom: BOTTOM }}
            >
              {overview.channels.map((channel) => (
                <span
                  key={channel}
                  className="flex items-center whitespace-nowrap"
                  data-channel-label={channel}
                  style={{ height: LANE_HEIGHT }}
                >
                  Ch {String(channel).padStart(2, '0')}
                </span>
              ))}
            </div>
            <canvas
              ref={canvas}
              data-testid={`${testIdPrefix}-canvas`}
              className="block min-w-0 w-full"
              style={{ height }}
              aria-hidden="true"
            />
          </div>
          <div className="sr-only" data-testid={`${testIdPrefix}-lanes`}>
            {overview.channels.map((channel) => (
              <span key={channel} data-channel={channel}>
                Channel {channel}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
