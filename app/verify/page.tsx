'use client';

import { useEffect, useState } from 'react';
import type { LibraryPage } from '../../core/library';
import type { RecordingInspection, VerificationReport, VerificationState } from '../../core/contracts';

const number = (value: number | null | undefined) => value == null ? 'Unknown' : value.toLocaleString('en-US');
const initialState: VerificationState = { status: 'idle', recordingId: null, workerPid: null, progress: null, report: null, error: null };

export default function Verify() {
  const [page, setPage] = useState<LibraryPage | null>(null);
  const [cursor, setCursor] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<RecordingInspection | null>(null);
  const [job, setJob] = useState<VerificationState>(initialState);
  const [savedReport, setSavedReport] = useState<VerificationReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const reportRevision = job.report?.checkedAt ?? '';

  useEffect(() => {
    const readSelection = () => setSelected(new URLSearchParams(window.location.search).get('id'));
    readSelection();
    window.addEventListener('popstate', readSelection);
    return () => window.removeEventListener('popstate', readSelection);
  }, []);

  useEffect(() => {
    fetch('/api/verification').then(response => response.json()).then(setJob).catch(() => {});
    const events = new EventSource('/api/events');
    events.addEventListener('verification', event => setJob(JSON.parse(event.data)));
    return () => events.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch(`/api/recordings?limit=10&cursor=${encodeURIComponent(cursor)}`, { signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result as LibraryPage; })
      .then(setPage)
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cursor, refresh]);

  useEffect(() => {
    setDetails(null); setSavedReport(null); setError('');
    if (!selected) return;
    const controller = new AbortController();
    fetch(`/api/recordings/${encodeURIComponent(selected)}`, { signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result as RecordingInspection; })
      .then(async recording => {
        setDetails(recording);
        if (recording.verification.status !== 'unverified') {
          const response = await fetch(`/api/recordings/${encodeURIComponent(selected)}/verification`, { signal: controller.signal });
          if (response.ok) setSavedReport(await response.json());
        }
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [selected, refresh, reportRevision]);

  const running = job.status === 'running';
  const runningHere = running && job.recordingId === selected;
  const report = runningHere ? null : job.recordingId === selected && job.report ? job.report : savedReport;
  const stale = details?.verification.status === 'stale';
  const progress = runningHere ? job.progress : null;
  const operationalFailureHere = job.status === 'failed-operational' && job.recordingId === selected;
  const statusLabel = !selected ? 'Awaiting selection' : runningHere ? 'Verification running' : operationalFailureHere ? 'Operational failure' : stale ? 'Report stale' : report?.result === 'PASS' ? 'Integrity verified' : report?.result === 'FAIL' ? 'Integrity failed' : 'Not yet verified';
  const canVerify = details?.status === 'completed' && !running;
  const selectedEntry = page?.items.find(item => item.id === selected);

  function select(id: string) {
    setSelected(id);
    window.history.pushState(null, '', `/verify?id=${encodeURIComponent(id)}`);
  }

  async function start() {
    if (!selected) return;
    setError('');
    const response = await fetch('/api/verifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recordingId: selected }) });
    const result = await response.json();
    if (!response.ok) { setError(result.error); return; }
    setJob(result);
  }

  return <>
    <header className="topbar flex h-[86px] items-center justify-between border-b border-line px-12 max-[760px]:h-[70px] max-[760px]:px-5">
      <a href="/" className="brand flex items-center gap-3 text-xl font-extrabold tracking-[3px]"><span className="grid size-[30px] place-items-center bg-accent text-[#111]" aria-hidden="true">S</span>SCOPE</a>
      <nav aria-label="Workspace" className="flex items-center gap-6 text-xs"><a href="/" className="text-muted hover:text-white">Acquire</a><a href="/recordings" className="text-muted hover:text-white">Recordings</a><span aria-current="page">Verify</span></nav>
    </header>
    <main className="mx-auto max-w-[1456px] px-12 py-12 max-[760px]:px-5 max-[760px]:py-8">
      <p className="eyebrow">VERIFY / PHYSICAL RECORD SCAN</p>
      <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
        <div><h1>Trust, measured<span>.</span></h1><p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">Stream every stored observation against its deterministic float32 expectation. Finalized is only a storage state; PASS belongs to the exact files checked.</p></div>
        <span className={`state ${report?.result === 'PASS' && !stale ? 'text-[#c1cfb2]' : report || stale ? 'state-loss' : ''}`} role="status" data-testid="verification-status">{statusLabel}</span>
      </div>
      {error && <div role="alert" className="notice error">{error}</div>}
      {job.status === 'failed-operational' && job.recordingId === selected && <div role="alert" className="notice error"><strong>Verification could not run</strong><p>{job.error}</p></div>}
      <div className="grid grid-cols-[minmax(250px,.7fr)_minmax(0,1.5fr)] items-start gap-6 max-[900px]:grid-cols-1">
        <section aria-label="Recordings to verify" className="min-w-0 border border-line bg-panel">
          <div className="flex items-center justify-between border-b border-line p-5"><span className="micro">LOCAL BUNDLES</span><button className="font-mono text-[10px] text-muted" onClick={() => setRefresh(value => value + 1)}>REFRESH ↻</button></div>
          {loading && <p role="status" className="p-5 text-xs text-muted">Reading recording states…</p>}
          {!loading && page?.items.length === 0 && <p className="p-5 text-xs leading-relaxed text-muted">No recordings are available. Complete an acquisition first.</p>}
          {page?.items.map(entry => <button key={entry.id} data-testid="verification-recording" aria-pressed={selected === entry.id} onClick={() => select(entry.id)} className="block w-full border-b border-line p-5 text-left hover:bg-[#222622] aria-pressed:border-l-2 aria-pressed:border-l-accent aria-pressed:bg-[#242822]">
            <span className="block break-words text-sm font-semibold">{entry.recording?.displayName || entry.id}</span>
            <span className="mt-2 block break-all font-mono text-[10px] text-muted">{entry.id}</span>
            <span className="mt-3 block font-mono text-[10px] uppercase tracking-[.08em] text-muted">{entry.recording ? entry.recording.verification.status.replace('-', ' ') : 'unavailable'}</span>
          </button>)}
          <div className="flex justify-between gap-3 p-4"><button className="text-xs text-muted" disabled={!cursor || loading} onClick={() => setCursor('')}>First page</button><button className="text-xs text-muted" disabled={!page?.nextCursor || loading} onClick={() => setCursor(page!.nextCursor!)}>Next page</button></div>
        </section>

        <section aria-label="Verification console" className="min-w-0 border border-line bg-panel-deep">
          {!selected && <div className="px-8 py-16"><p className="micro">CHECK TARGET</p><h2 className="my-4">Select a recording.</h2><p className="max-w-md text-sm leading-relaxed text-muted">The scan reads physical records in bounded chunks and saves one machine-checkable result beside the recording.</p></div>}
          {selected && <>
            <div className="flex flex-wrap items-start justify-between gap-5 border-b border-line p-7 max-[760px]:p-5">
              <div className="min-w-0"><p className="micro">TARGET RECORDING</p><h2 className="mt-3 mb-2 break-words">{details?.displayName || selectedEntry?.recording?.displayName || selected}</h2><code className="break-all text-[10px] text-muted">{selected}</code></div>
              <button className="start-button min-w-[190px]" onClick={start} disabled={!canVerify}>{runningHere ? 'Scanning records…' : running ? 'Another check is running' : details?.status !== 'completed' ? 'Recording not completed' : stale ? 'Run fresh verification' : report ? 'Verify again' : 'Start verification'}<span aria-hidden="true">↗</span></button>
            </div>
            {stale && <div data-testid="stale-warning" role="status" className="border-b border-[#7a6c42] bg-[#25231a] p-5 text-xs leading-relaxed text-[#e4d6ad]">The saved report describes an earlier file identity, size, or modification time. Run a fresh verification before trusting it.</div>}
            {runningHere && <div className="border-b border-line p-7 max-[760px]:p-5">
              <div className="mb-4 flex items-center justify-between gap-4"><span className="micro">STREAM PROGRESS</span><output className="font-mono text-xl" data-testid="verification-progress">{progress?.percent == null ? 'Preparing' : `${progress.percent.toFixed(1)}%`}</output></div>
              <div role="progressbar" aria-label="Verification progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress?.percent ?? 0} className="h-1 bg-[#343835]"><span className="block h-full bg-accent" style={{ width: `${progress?.percent ?? 0}%` }} /></div>
              <p className="mt-4 font-mono text-[10px] text-muted">{number(progress?.recordsScanned)} / {number(progress?.totalRecords)} physical records · worker PID {job.workerPid ?? 'starting'}</p>
            </div>}
            {report && <div data-testid="verification-report">
              <div className="grid grid-cols-4 border-b border-line max-[760px]:grid-cols-2">
                {[
                  ['EXPECTED SAMPLES', report.counts.expectedSamples], ['RECORDED SAMPLES', report.counts.recordedSamples],
                  ['MISSING', report.discrepancies.missing.samples], ['DUPLICATED', report.discrepancies.duplicated.samples],
                  ['INCORRECT', report.discrepancies.incorrect.samples], ['FORMAT ERRORS', report.formatErrors.count],
                  ['ELAPSED · MS', report.execution.elapsedMs], ['PEAK RSS · BYTES', report.execution.peakRssBytes],
                ].map(([label, value]) => <dl key={String(label)} className="border-r border-b border-line p-5 last:border-r-0"><dt className="micro">{label}</dt><dd className="mt-3 font-mono text-xl">{number(value as number | null)}</dd></dl>)}
              </div>
              <div className="grid grid-cols-3 gap-5 p-7 max-[760px]:grid-cols-1 max-[760px]:p-5">
                <Position label="FIRST MISSING" value={report.discrepancies.missing.first} />
                <Position label="FIRST DUPLICATE" value={report.discrepancies.duplicated.first} />
                <Position label="FIRST INCORRECT" value={report.discrepancies.incorrect.first} />
              </div>
              {report.formatErrors.first && <div role="alert" className="mx-7 mb-7 border border-[#805a47] bg-[#2a211c] p-4 text-xs text-[#ffba89] max-[760px]:mx-5 max-[760px]:mb-5"><span className="micro">FIRST FORMAT ERROR</span><p className="mt-2">{report.formatErrors.first}</p></div>}
              <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line p-5"><span className="font-mono text-[10px] text-muted">CHECKED {new Date(report.checkedAt).toLocaleString('en-GB')}</span><a className="inspect-button" href={`/api/recordings/${encodeURIComponent(selected)}/verification`} download>Download JSON report ↓</a></div>
            </div>}
            {!runningHere && !report && details && <div className="p-8 max-[760px]:p-5"><p className="micro">NO CHECKED RESULT</p><p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">This completed recording has not been independently verified. The acquisition lifecycle and declared loss counters are not a substitute for scanning its values and identities.</p></div>}
          </>}
        </section>
      </div>
      <footer className="mt-8 border-t border-line"><span>LOCAL CHILD PROCESS / BOUNDED SCAN</span><span>Reports remain valid only for the exact checked file state.</span></footer>
    </main>
  </>;
}

function Position({ label, value }: { label: string; value: { frame: number; channel: number; physicalOrdinal?: number } | null }) {
  return <dl><dt className="micro">{label}</dt><dd className="mt-3 font-mono text-xs leading-relaxed text-muted">{value ? `frame ${value.frame} · channel ${value.channel}${value.physicalOrdinal === undefined ? '' : ` · physical ${value.physicalOrdinal}`}` : 'None'}</dd></dl>;
}
