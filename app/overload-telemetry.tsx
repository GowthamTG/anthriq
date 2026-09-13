import type { AcquisitionState } from '../core/contracts';

const number = (value: number | undefined) =>
  value == null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
const memory = (value: number | undefined) =>
  value == null ? '—' : `${(value / 1048576).toFixed(1)} MiB`;
const stallLabels = {
  off: 'Diagnostics off',
  scheduled: 'Stall scheduled',
  active: 'Recorder stalled',
  recovered: 'Recorder resumed',
};

export function OverloadTelemetry({ state }: { state: AcquisitionState | null }) {
  const completed = state?.status === 'completed';
  const metrics = state?.metrics;
  const metadata = state?.metadata;
  const source = completed ? metadata?.generator : metrics?.generator;
  const persisted = completed ? metadata?.recordedFrames : metrics?.recordedFrames;
  const lost = completed ? metadata?.droppedFrames : source?.droppedFrames;
  const channels = state?.settings.channels;
  const stall = completed ? metadata?.recorderStall : metrics?.recorderStall;
  return (
    <section
      aria-label="Transport and loss measurements"
      className="border-t border-line px-[30px] py-6 max-[1050px]:px-[22px] max-[760px]:px-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="micro">SOURCE → DISK</span>
        <span data-testid="recorder-stall" className="font-mono text-[10px] text-muted">
          {stall
            ? stallLabels[stall]
            : state?.settings.stallForMs
              ? 'Stall scheduled'
              : 'Diagnostics off'}
        </span>
      </div>
      <p
        data-testid="loss-state"
        role="status"
        className={`mt-4 text-xs leading-relaxed ${lost ? 'text-[#ffba89]' : 'text-muted'}`}
      >
        {lost
          ? completed
            ? 'Completed with loss · missing values remain missing.'
            : 'Loss detected · the source clock continues.'
          : state?.id
            ? 'No loss reported so far.'
            : 'Waiting for source and recorder measurements.'}
      </p>
      <dl className="mt-5 grid grid-cols-4 gap-4 max-[1050px]:grid-cols-2">
        {(
          [
            ['Scheduled', source?.scheduledFrames, 'source-scheduled'],
            ['Offered to IPC', source?.emittedFrames, 'source-offered'],
            ['Persisted', persisted, 'persisted-frames'],
            ['Lost at source', lost, 'lost-frames'],
          ] as const
        ).map(([label, value, id]) => (
          <div key={id}>
            <dt className="text-[10px] text-muted">{label} · frames</dt>
            <dd
              data-testid={id}
              className={`mt-2 font-mono text-xl ${id === 'lost-frames' && lost ? 'text-[#ffba89]' : 'text-[#e2e6df]'}`}
            >
              {number(value)}
            </dd>
            <dd className="mt-1 font-mono text-[9px] text-muted">
              {number(value == null || channels == null ? undefined : value * channels)} scalar
              values
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-line pt-4 text-[10px] text-muted">
        {(
          [
            ['Uncredited sample bytes', completed ? '0' : number(source?.outstandingBytes)],
            ['Transport high-water · bytes', number(source?.peakOutstandingBytes)],
            [
              'Recorder high-water · bytes',
              number(completed ? metadata?.peakQueueBytes : metrics?.peakQueueBytes),
            ],
            ['Emission deficit · frames', number(source?.emissionDeficitFrames)],
            ['Last interval offered · frames/s', number(source?.emissionRateFramesPerSecond)],
            ['Longest emission gap · ms', number(source?.maxEmissionGapMs)],
            ['Timeline offset · frames', number(source?.pacingErrorFrames)],
            ['Source tick lag · ms', number(source?.maxLagMs)],
            ['Generator peak RSS', memory(source?.peakRssBytes)],
            [
              completed ? 'Recorder peak RSS' : 'Recorder current RSS',
              memory(completed ? metadata?.recorderPeakRssBytes : metrics?.recorderRssBytes),
            ],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mt-1 font-mono text-[#c7cbc6]">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[10px] leading-relaxed text-muted">
        Source and recorder snapshots arrive independently. The byte budget covers uncredited frame
        payloads; process memory also includes runtime, serialization and OS overhead.
      </p>
    </section>
  );
}
