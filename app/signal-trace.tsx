'use client';

import { useEffect, useRef } from 'react';
import UPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { Frame, LivePreview } from '../core/contracts';

const CHANNEL_COLORS = ['#ff9b87', '#b8d6a5', '#8fc6cf', '#d4b4db'];
const CHART_HEIGHT = 276;
const MIN_CHART_WIDTH = 240;

export interface SignalTraceModel {
  channels: readonly number[];
  observations?: readonly Frame[];
  envelope?: LivePreview;
  sampleRate: number;
  decimation: number;
  capacity: number;
  nextIndex: number;
  expectedFrames?: number;
}

interface PreparedTrace {
  data: UPlot.AlignedData;
  domain: [number, number];
  gapCount: number;
  windowStart: number;
  windowEnd: number;
}

const integer = (value: number) => value.toLocaleString('en-US');

function traceObservations(model: SignalTraceModel): readonly Frame[] {
  if (model.envelope)
    return model.envelope.buckets.map((bucket) => ({
      index: bucket.end - 1,
      values: bucket.maximum,
    }));
  return model.observations ?? [];
}

function traceDomain(model: SignalTraceModel): [number, number] {
  const stride = Math.max(1, model.decimation);
  const windowSpan = Math.max(1, stride * Math.max(1, model.capacity - 1));
  const extentEnd =
    model.expectedFrames === undefined ? null : Math.max(0, model.expectedFrames - 1);
  const initialEnd = extentEnd === null ? windowSpan : Math.min(extentEnd, windowSpan);
  const progressedEnd = Math.max(0, model.nextIndex - 1);
  const end =
    extentEnd === null
      ? Math.max(initialEnd, progressedEnd)
      : Math.min(extentEnd, Math.max(initialEnd, progressedEnd));
  const start = Math.max(0, end - windowSpan);
  return end > start ? [start, end] : [start, start + 1];
}

function prepareTrace(model: SignalTraceModel): PreparedTrace {
  const stride = Math.max(1, model.decimation);
  const domain = traceDomain(model);
  const x: number[] = [];
  const values = model.channels.map(() => [] as (number | null)[]);
  let previousIndex: number | null = null;

  const observations = traceObservations(model);
  for (const observation of observations) {
    if (previousIndex !== null && observation.index - previousIndex > stride) {
      const gapIndex = previousIndex + stride;
      if (gapIndex < observation.index) {
        x.push(gapIndex);
        for (const series of values) series.push(null);
      }
    }
    x.push(observation.index);
    for (let channelIndex = 0; channelIndex < values.length; channelIndex++)
      values[channelIndex].push(observation.values[channelIndex] ?? null);
    previousIndex = observation.index;
  }

  const inWindow = observations.filter(
    (observation) => observation.index >= domain[0] && observation.index <= domain[1],
  );
  const first = inWindow[0];
  const last = inWindow.at(-1);
  let gapCount = 0;
  for (let index = 1; index < inWindow.length; index++)
    if (inWindow[index].index - inWindow[index - 1].index > stride) gapCount++;
  const expectedFirst = Math.ceil(domain[0] / stride) * stride;
  if (first && first.index > expectedFirst) gapCount++;
  const atConfirmedEnd =
    model.expectedFrames !== undefined && model.nextIndex >= model.expectedFrames;
  const confirmedLast =
    model.expectedFrames === undefined
      ? domain[1]
      : Math.min(domain[1], Math.max(0, model.expectedFrames - 1));
  const expectedLast = Math.floor(confirmedLast / stride) * stride;
  if (atConfirmedEnd && last && last.index < expectedLast) gapCount++;
  if (atConfirmedEnd && !last && model.expectedFrames !== 0) gapCount++;

  return {
    data: [x, ...values],
    domain,
    gapCount,
    windowStart: domain[0],
    windowEnd: confirmedLast,
  };
}

function chartOptions(
  model: SignalTraceModel,
  width: number,
  cursorReadout: HTMLElement,
  currentModel: () => SignalTraceModel,
): UPlot.Options {
  const axisFont = '10px ui-monospace, SFMono-Regular, Consolas, monospace';
  const labelFont = '9px ui-monospace, SFMono-Regular, Consolas, monospace';
  const axis = '#9ba19d';
  const grid = '#303330';

  return {
    width,
    height: CHART_HEIGHT,
    padding: [8, 8, 0, 0],
    scales: {
      x: { time: false, auto: false, range: traceDomain(model) },
      y: { auto: false, range: [-1, 1] },
    },
    axes: [
      {
        scale: 'x',
        side: 2,
        label: 'ORIGINAL FRAME',
        labelFont,
        labelSize: 18,
        font: axisFont,
        stroke: axis,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid, width: 1 },
        values: (_chart, splits) => splits.map((value) => integer(Math.round(value))),
      },
      {
        scale: 'y',
        side: 3,
        label: 'NORMALIZED AMPLITUDE',
        labelFont,
        labelSize: 18,
        size: 48,
        font: axisFont,
        stroke: axis,
        grid: { stroke: grid, width: 1 },
        ticks: { stroke: grid, width: 1 },
        values: (_chart, splits) => splits.map((value) => value.toFixed(1)),
      },
      {
        scale: 'x',
        side: 0,
        label: 'ELAPSED TIME',
        labelFont,
        labelSize: 18,
        font: axisFont,
        stroke: axis,
        grid: { show: false },
        ticks: { stroke: grid, width: 1 },
        values: (_chart, splits) =>
          splits.map((value) => `${(value / model.sampleRate).toFixed(3)} s`),
      },
    ],
    cursor: {
      show: true,
      x: true,
      y: true,
      drag: { x: false, y: false, setScale: false },
      points: { size: 6, width: 1 },
    },
    legend: { show: false },
    series: [
      { label: 'Original frame', value: (_chart, value) => integer(Math.round(value)) },
      ...model.channels.map((channel, index) => ({
        label: `Channel ${channel}`,
        scale: 'y',
        stroke: model.envelope ? 'transparent' : CHANNEL_COLORS[index % CHANNEL_COLORS.length],
        width: 1.5,
        spanGaps: false,
        points: { show: false },
        value: (_chart: UPlot, value: number | null) =>
          value === null ? 'No observation' : value.toFixed(5),
      })),
    ],
    hooks: {
      draw: [
        (chart) => {
          const envelope = currentModel().envelope;
          if (!envelope) return;
          const context = chart.ctx;
          context.save();
          context.lineWidth = 1.5;
          for (const bucket of envelope.buckets) {
            const x = chart.valToPos((bucket.start + bucket.end - 1) / 2, 'x', true);
            for (let channel = 0; channel < envelope.channels.length; channel++) {
              context.strokeStyle = CHANNEL_COLORS[channel % CHANNEL_COLORS.length];
              context.beginPath();
              context.moveTo(x, chart.valToPos(bucket.minimum[channel], 'y', true));
              context.lineTo(x, chart.valToPos(bucket.maximum[channel], 'y', true));
              context.stroke();
            }
          }
          context.restore();
        },
      ],
      setCursor: [
        (chart) => {
          const index = chart.cursor.idx;
          if (index === null || index === undefined) {
            cursorReadout.textContent = 'Move across the trace to inspect a stored observation.';
            return;
          }
          const frame = chart.data[0][index];
          const channelValues = model.channels.map((channel, channelIndex) => {
            const value = chart.data[channelIndex + 1][index];
            return `Channel ${channel}: ${value === null || value === undefined ? 'gap' : Number(value).toFixed(5)}`;
          });
          cursorReadout.textContent = `Frame ${integer(Number(frame))} | ${(Number(frame) / model.sampleRate).toFixed(3)} s | ${channelValues.join(' | ')}`;
        },
      ],
    },
  };
}

export function SignalTrace({ model, label }: { model: SignalTraceModel; label: string }) {
  const host = useRef<HTMLDivElement>(null);
  const cursorReadout = useRef<HTMLParagraphElement>(null);
  const chart = useRef<UPlot | null>(null);
  const modelRef = useRef(model);
  const paint = useRef<(() => void) | null>(null);
  modelRef.current = model;
  const configurationKey = `${model.sampleRate}:${model.channels.join(',')}`;
  const prepared = prepareTrace(model);
  const latest = traceObservations(model).at(-1);
  const latestBucket = model.envelope?.buckets.at(-1);

  useEffect(() => {
    const element = host.current;
    const readout = cursorReadout.current;
    if (!element || !readout) return;
    let frame = 0;
    const width = () => Math.max(MIN_CHART_WIDTH, Math.floor(element.clientWidth));
    const current = prepareTrace(modelRef.current);
    chart.current = new UPlot(
      chartOptions(modelRef.current, width(), readout, () => modelRef.current),
      current.data,
      element,
    );

    const schedulePaint = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const instance = chart.current;
        if (!instance) return;
        const next = prepareTrace(modelRef.current);
        instance.batch(() => {
          instance.setData(next.data, false);
          instance.setScale('x', { min: next.domain[0], max: next.domain[1] });
        });
      });
    };
    paint.current = schedulePaint;
    const observer = new ResizeObserver(() => {
      const instance = chart.current;
      if (instance) instance.setSize({ width: width(), height: CHART_HEIGHT });
    });
    observer.observe(element);

    return () => {
      paint.current = null;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      chart.current?.destroy();
      chart.current = null;
    };
  }, [configurationKey]);

  useEffect(() => paint.current?.(), [model]);

  return (
    <figure className="signal-trace mt-5 border border-line bg-[#171917] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="micro">
          {model.envelope
            ? 'DECIMATED MIN-MAX ENVELOPE FROM PERSISTED FRAMES'
            : 'DECIMATED PREVIEW FROM STORED OBSERVATIONS'}
        </figcaption>
        <span className="font-mono text-[10px] text-muted">
          {traceObservations(model).length}/{model.capacity} {model.envelope ? 'buckets' : 'points'}
          {' | '}every {model.decimation} frame
          {model.decimation === 1 ? '' : 's'}
        </span>
      </div>
      <div
        ref={host}
        data-testid="playback-trace"
        className="mt-4 min-h-[276px] w-full overflow-hidden"
        role="img"
        aria-label={label}
      />
      <p
        ref={cursorReadout}
        data-testid="playback-cursor-readout"
        className="mt-3 min-h-4 font-mono text-[10px] text-muted"
      >
        Move across the trace to inspect a stored observation.
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] text-muted">
        {model.channels.map((channel, index) => (
          <span key={channel}>
            <span
              className="mr-2 inline-block size-2"
              style={{ backgroundColor: CHANNEL_COLORS[index % CHANNEL_COLORS.length] }}
              aria-hidden="true"
            />
            Channel {channel}:{' '}
            {latestBucket
              ? `${latestBucket.minimum[index]?.toFixed(5)} – ${latestBucket.maximum[index]?.toFixed(5)}`
              : latest
                ? latest.values[index]?.toFixed(5)
                : 'Not available'}
          </span>
        ))}
        <span data-testid="playback-latest-frame">
          Latest original frame: {latest ? integer(latest.index) : 'Not available'}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] text-muted">
        <span data-testid="playback-visible-window">
          Visible window: frames {integer(prepared.windowStart)}-{integer(prepared.windowEnd)}
        </span>
        <span data-testid="playback-visible-gaps">
          Visible gaps in preview: {integer(prepared.gapCount)}
        </span>
      </div>
    </figure>
  );
}
