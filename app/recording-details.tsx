import type { RecordingInspection } from '../core/contracts';

const number = (value: number | null | undefined) => value == null ? 'Unknown' : value.toLocaleString('en-US');
const timestamp = (value: string | undefined) => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }) : 'Unknown';

export function RecordingDetails({ details }: { details: RecordingInspection }) {
  return <section className="details-panel border border-line bg-panel-deep px-[30px] py-6 max-[760px]:px-5">
        <div className="details-heading flex items-center justify-between"><h2>Recording details</h2><span className="micro" data-testid="format">{details.format}</span></div>
        <div className="mt-5 flex flex-wrap items-center gap-3 font-mono text-xs">
          <span className={details.condition === 'finalized' ? 'text-[#c1cfb2]' : 'text-[#ffba89]'}>{details.condition === 'finalized' ? 'Finalized' : details.condition === 'attention' ? 'Needs attention' : 'Incomplete / in progress'}</span>
          <span className="text-muted">Integrity not verified</span>
        </div>
        {details.warnings.length > 0 && <div data-testid="inspection-warnings" role="status" className="my-5 border border-[#7a6c42] bg-[#25231a] p-4 text-xs leading-relaxed text-[#e4d6ad]">
          <p className="mb-2 font-semibold">Read this recording with care</p>
          <ul className="list-disc space-y-1 pl-4">{details.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
        </div>}
        <dl className="details-grid my-7 grid grid-cols-3 gap-6 max-[760px]:grid-cols-2 max-[760px]:gap-x-[15px] max-[760px]:gap-y-5">
          <div><dt>Recording name</dt><dd data-testid="saved-name">{details.displayName || 'Untitled recording'}</dd></div>
          <div><dt>Signal configuration</dt><dd data-testid="saved-settings">{details.channels} channels · {number(details.sampleRate)} Hz · seed {details.seed}</dd></div>
          <div><dt>Requested duration</dt><dd>{details.seconds ? `${details.seconds} seconds` : 'Until stopped'}</dd></div>
          <div><dt>Started</dt><dd>{timestamp(details.startedAt)}</dd></div>
          <div><dt>Stopped</dt><dd>{timestamp(details.stoppedAt)}</dd></div>
          <div><dt>Source duration</dt><dd data-testid="recording-duration">{details.duration == null ? 'Unknown' : `${details.duration.toFixed(3)} seconds`}</dd></div>
          <div><dt>Expected frames</dt><dd data-testid="expected-frames">{number(details.expectedFrames)}</dd></div>
          <div><dt>Metadata frame count</dt><dd data-testid="saved-frames">{number(details.recordedFrames)}</dd></div>
          <div><dt>Metadata scalar count</dt><dd>{number(details.totalSamples)}</dd></div>
          <div><dt>Binary layout</dt><dd>Indexed float32 · Little-endian</dd></div>
          <div><dt>File size</dt><dd>{number(details.fileBytes)} bytes</dd></div>
          <div><dt>Physical complete frames</dt><dd data-testid="physical-frames">{number(details.completeRecords)}</dd></div>
          <div><dt>Readable scalar values</dt><dd>{number(details.completeRecords * details.channels)}</dd></div>
          <div><dt>Readable prefix</dt><dd>{number(details.readableBytes)} bytes</dd></div>
          <div><dt>Waveform version</dt><dd>{details.waveform}</dd></div>
          <div><dt>Metadata lifecycle</dt><dd>{details.status}</dd></div>
          <div><dt>Recording ID</dt><dd>{details.id}</dd></div>
          <div><dt>Partial trailing bytes</dt><dd data-testid="trailing-bytes">{details.trailingBytes}</dd></div>
        </dl>
        <div className="location grid gap-2.5 border-t border-line pt-5"><span className="micro">LOCAL RECORDING</span><code>{details.location}</code></div>
      </section>;
}
