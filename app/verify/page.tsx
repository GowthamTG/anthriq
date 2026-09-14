'use client';

import { useEffect, useState } from 'react';
import type {
  DiagnosticScenario,
  VerificationReport,
  VerificationState,
} from '../../core/contracts';
import { requestJson } from '../http';
import { useRecordingLibrary } from '../use-recording-library';
import { useServiceEvents } from '../use-service-events';
import { WorkbenchHeader } from '../workbench-header';

const number = (value: number | null | undefined) =>
  value == null ? 'Unknown' : value.toLocaleString('en-US');
const initialState: VerificationState = {
  status: 'idle',
  recordingId: null,
  scenario: null,
  sourceRecordingId: null,
  workerPid: null,
  progress: null,
  report: null,
  error: null,
};
const scenarios: { id: DiagnosticScenario; name: string; description: string }[] = [
  { id: 'clean', name: 'Clean', description: 'Eight untouched frames establish the PASS control.' },
  {
    id: 'missing',
    name: 'Missing',
    description: 'Removes initial, interior, and trailing frames.',
  },
  {
    id: 'duplicate',
    name: 'Duplicate',
    description: 'Repeats frame 1 as an adjacent physical observation.',
  },
  {
    id: 'incorrect',
    name: 'Incorrect',
    description: 'Injects one finite and one nonfinite scalar value.',
  },
  {
    id: 'combined',
    name: 'Combined',
    description: 'Overlaps missing, duplicate, and incorrect evidence.',
  },
];
type ScenarioRun = {
  scenario: DiagnosticScenario;
  sourceRecordingId: string;
  recordingId: string | null;
  error: string | null;
};

export default function Verify() {
  const [job, setJob] = useState<VerificationState>(initialState);
  const [savedReport, setSavedReport] = useState<VerificationReport | null>(null);
  const [error, setError] = useState('');
  const [scenarioRun, setScenarioRun] = useState<ScenarioRun | null>(null);
  const reportRevision = job.report?.checkedAt ?? '';
  const {
    page,
    cursor,
    setCursor,
    selected,
    select,
    details,
    loading,
    inspecting,
    listError,
    detailError,
    refresh,
  } = useRecordingLibrary(reportRevision);
  const connection = useServiceEvents({
    url: '/api/events',
    snapshot: { url: '/api/verification', apply: (value) => setJob(value as VerificationState) },
    handlers: { verification: (value) => setJob(value as VerificationState) },
  });
  const connected = connection === 'live';

  useEffect(() => {
    setSavedReport(null);
    if (!selected || !details || details.verification.status === 'unverified') return;
    const controller = new AbortController();
    requestJson<VerificationReport>(
      `/api/recordings/${encodeURIComponent(selected)}/verification`,
      { signal: controller.signal },
    )
      .then(setSavedReport)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause.message);
      });
    return () => controller.abort();
  }, [selected, details, reportRevision]);

  const creating = job.status === 'creating';
  const running = job.status === 'running';
  const busy = creating || running;
  const runningHere = running && job.recordingId === selected;
  const report = runningHere
    ? null
    : job.recordingId === selected && job.report
      ? job.report
      : savedReport;
  const stale = details?.verification.status === 'stale';
  const progress = runningHere ? job.progress : null;
  const operationalFailureHere =
    job.status === 'failed-operational' && job.recordingId === selected;
  const statusLabel = !selected
    ? 'Awaiting selection'
    : inspecting
      ? 'Loading recording'
      : creating && job.sourceRecordingId === selected
        ? 'Creating diagnostic'
        : runningHere
          ? 'Verification running'
          : operationalFailureHere
            ? 'Operational failure'
            : stale
              ? 'Report stale'
              : report?.result === 'PASS'
                ? 'Integrity verified'
                : report?.result === 'FAIL'
                  ? 'Integrity failed'
                  : 'Not yet verified';
  const canVerify = details?.status === 'completed' && !busy && connected;
  const selectedEntry = page?.items.find((item) => item.id === selected);
  const eligibleSource = details?.status === 'completed' && !details.diagnostic;
  const scenarioState = scenarioRun
    ? scenarioRun.error
      ? `Error · ${scenarioRun.error}`
      : job.scenario === scenarioRun.scenario &&
          job.sourceRecordingId === scenarioRun.sourceRecordingId
        ? job.status === 'creating'
          ? `Creating ${scenarioRun.scenario} scenario…`
          : job.status === 'running'
            ? `Scanning ${scenarioRun.scenario} scenario…`
            : job.status === 'passed'
              ? `Completed · ${scenarioRun.scenario} · PASS`
              : job.status === 'failed-integrity'
                ? `Completed · ${scenarioRun.scenario} · FAIL`
                : job.status === 'failed-operational'
                  ? `Error · ${job.error}`
                  : 'Ready'
        : 'Ready'
    : 'Ready';

  async function start() {
    if (!selected || !connected) return;
    setError('');
    try {
      setJob(
        (current) =>
          ({
            ...current,
            status: 'creating',
            recordingId: selected,
            error: null,
          }) as VerificationState,
      );
      setJob(
        await requestJson<VerificationState>('/api/verifications', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recordingId: selected }),
        }),
      );
    } catch (cause) {
      setJob((current) => ({ ...current, status: 'idle' }));
      setError(cause instanceof Error ? cause.message : 'Verification request failed');
    }
  }

  async function startScenario(scenario: DiagnosticScenario) {
    if (!selected || !eligibleSource || !connected) return;
    const sourceRecordingId = selected;
    setError('');
    setScenarioRun({ scenario, sourceRecordingId, recordingId: null, error: null });
    try {
      const state = await requestJson<VerificationState>('/api/verification-scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceRecordingId, scenario }),
      });
      setJob(state);
      setScenarioRun({ scenario, sourceRecordingId, recordingId: state.recordingId, error: null });
      if (state.recordingId) {
        select(state.recordingId);
        setCursor('');
        refresh();
      }
    } catch (cause) {
      setScenarioRun({
        scenario,
        sourceRecordingId,
        recordingId: null,
        error: cause instanceof Error ? cause.message : 'Scenario creation failed',
      });
    }
  }

  return (
    <>
      <WorkbenchHeader current="verify" connection={connection} />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[1456px] px-12 py-12 max-[760px]:px-5 max-[760px]:py-8"
      >
        <p className="eyebrow">VERIFY / PHYSICAL RECORD SCAN</p>
        <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1>
              Trust, measured<span>.</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
              Stream every stored observation against its deterministic float32 expectation.
              Finalized is only a storage state; PASS belongs to the exact files checked.
            </p>
          </div>
          <span
            className={`state ${report?.result === 'PASS' && !stale ? 'text-[#c1cfb2]' : report || stale ? 'state-loss' : ''}`}
            role="status"
            data-testid="verification-status"
          >
            {statusLabel}
          </span>
        </div>
        {!connected && (
          <div role="status" className="notice">
            {connection === 'offline'
              ? 'The local verification service is unavailable.'
              : 'Reconnecting to the local verification service.'}{' '}
            Displayed results may be stale; verification controls remain disabled until the current
            state is restored.
          </div>
        )}
        {(error || listError || detailError) && (
          <div role="alert" className="notice error">
            {error || detailError || listError}
          </div>
        )}
        {job.status === 'failed-operational' && job.recordingId === selected && (
          <div role="alert" className="notice error">
            <strong>Verification could not run</strong>
            <p>{job.error}</p>
          </div>
        )}
        <section aria-label="Integrity scenario lab" className="mb-6 border border-line bg-panel">
          <div className="flex flex-wrap items-start justify-between gap-5 border-b border-line p-5">
            <div>
              <p className="micro">INTEGRITY SCENARIO LAB / DISPOSABLE</p>
              <h2 className="mt-3">Prove the detector.</h2>
              <p className="mt-3 max-w-2xl text-xs leading-relaxed text-muted">
                Choose a completed acquisition as the signal source. SCOPE synthesizes a separate
                eight-frame bundle, injects one known condition, then scans the persisted files
                through the real verification worker. The source bundle is never opened for writing.
              </p>
            </div>
            <output
              data-testid="scenario-state"
              role={scenarioRun?.error ? 'alert' : 'status'}
              aria-live={scenarioRun?.error ? 'assertive' : 'polite'}
              className={`font-mono text-[10px] uppercase tracking-[.08em] ${scenarioRun?.error ? 'text-[#ffba89]' : 'text-muted'}`}
            >
              {scenarioState}
            </output>
          </div>
          <div className="grid grid-cols-5 gap-px bg-line max-[1050px]:grid-cols-2 max-[560px]:grid-cols-1">
            {scenarios.map((scenario) => (
              <div key={scenario.id} className="flex min-h-[150px] flex-col bg-panel-deep p-5">
                <span className="micro">{scenario.name}</span>
                <p className="my-4 text-xs leading-relaxed text-muted">{scenario.description}</p>
                <button
                  className="mt-auto border border-[#78826e] px-3 py-2 text-left font-mono text-[10px] uppercase tracking-[.06em] text-white hover:bg-[#2e3429] disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!eligibleSource || busy || !connected}
                  onClick={() => startScenario(scenario.id)}
                >
                  Create {scenario.name} scenario ↗
                </button>
              </div>
            ))}
          </div>
          {!eligibleSource && (
            <p className="border-t border-line p-4 text-xs text-muted">
              {details?.diagnostic
                ? 'Diagnostic bundles cannot seed another scenario. Select a completed acquisition recording.'
                : 'Select a completed acquisition recording to enable the scenario controls.'}
            </p>
          )}
        </section>
        <div className="grid grid-cols-[minmax(250px,.7fr)_minmax(0,1.5fr)] items-start gap-6 max-[900px]:grid-cols-1">
          <section
            aria-label="Recordings to verify"
            className="min-w-0 border border-line bg-panel"
          >
            <div className="flex items-center justify-between border-b border-line p-5">
              <span className="micro">LOCAL BUNDLES</span>
              <button className="font-mono text-[10px] text-muted" onClick={refresh}>
                REFRESH ↻
              </button>
            </div>
            {loading && (
              <p role="status" className="p-5 text-xs text-muted">
                Reading recording states…
              </p>
            )}
            {!loading && page?.items.length === 0 && (
              <p className="p-5 text-xs leading-relaxed text-muted">
                No recordings are available. Complete an acquisition first.
              </p>
            )}
            {page?.items.map((entry) => (
              <button
                key={entry.id}
                data-testid="verification-recording"
                aria-pressed={selected === entry.id}
                onClick={() => select(entry.id)}
                className="block w-full border-b border-line p-5 text-left hover:bg-[#222622] aria-pressed:border-l-2 aria-pressed:border-l-accent aria-pressed:bg-[#242822]"
              >
                <span className="block break-words text-sm font-semibold">
                  {entry.recording?.displayName || entry.id}
                </span>
                <span className="mt-2 block break-all font-mono text-[10px] text-muted">
                  {entry.id}
                </span>
                <span className="mt-3 block font-mono text-[10px] uppercase tracking-[.08em] text-muted">
                  {entry.recording
                    ? entry.recording.verification.status.replace('-', ' ')
                    : 'unavailable'}
                </span>
                {entry.recording?.diagnostic && (
                  <span className="mt-2 block font-mono text-[9px] uppercase tracking-[.08em] text-[#e4d6ad]">
                    Diagnostic / {entry.recording.diagnostic.scenario}
                  </span>
                )}
              </button>
            ))}
            <div className="flex justify-between gap-3 p-4">
              <button
                className="text-xs text-muted"
                disabled={!cursor || loading}
                onClick={() => setCursor('')}
              >
                First page
              </button>
              <button
                className="text-xs text-muted"
                disabled={!page?.nextCursor || loading}
                onClick={() => setCursor(page!.nextCursor!)}
              >
                Next page
              </button>
            </div>
          </section>

          <section
            aria-label="Verification console"
            className="min-w-0 border border-line bg-panel-deep"
          >
            {!selected && (
              <div className="px-8 py-16">
                <p className="micro">CHECK TARGET</p>
                <h2 className="my-4">Select a recording.</h2>
                <p className="max-w-md text-sm leading-relaxed text-muted">
                  The scan reads physical records in bounded chunks and saves one machine-checkable
                  result beside the recording.
                </p>
              </div>
            )}
            {selected && (
              <>
                {details?.diagnostic && (
                  <div
                    data-testid="diagnostic-provenance"
                    className="border-b border-[#7a6c42] bg-[#25231a] p-5 text-xs leading-relaxed text-[#e4d6ad]"
                  >
                    <span className="micro">
                      DISPOSABLE DIAGNOSTIC / {details.diagnostic.scenario.toUpperCase()}
                    </span>
                    <p className="mt-2">
                      Derived from the signal definition of{' '}
                      <code>{details.diagnostic.sourceRecordingId}</code>. Its files are separate
                      from the source. Finalized means this bundle was safely closed; only the
                      actual report below determines whether it is lossless.
                    </p>
                    {['missing', 'combined'].includes(details.diagnostic.scenario) && (
                      <p className="mt-2">
                        The independent eight-frame expected extent exposes trailing loss even
                        though the diagnostic bundle is finalized.
                      </p>
                    )}
                  </div>
                )}
                <div className="flex flex-wrap items-start justify-between gap-5 border-b border-line p-7 max-[760px]:p-5">
                  <div className="min-w-0">
                    <p className="micro">TARGET RECORDING</p>
                    <h2 className="mt-3 mb-2 break-words">
                      {details?.displayName || selectedEntry?.recording?.displayName || selected}
                    </h2>
                    <code className="break-all text-[10px] text-muted">{selected}</code>
                  </div>
                  <button
                    className="start-button min-w-[190px]"
                    onClick={start}
                    disabled={!canVerify}
                  >
                    {runningHere
                      ? 'Scanning records…'
                      : inspecting
                        ? 'Loading recording…'
                        : busy
                          ? 'Another check is running'
                          : details?.status !== 'completed'
                            ? 'Recording not completed'
                            : stale
                              ? 'Run fresh verification'
                              : report
                                ? 'Verify again'
                                : 'Start verification'}
                    <span aria-hidden="true">↗</span>
                  </button>
                </div>
                {stale && (
                  <div
                    data-testid="stale-warning"
                    role="status"
                    className="border-b border-[#7a6c42] bg-[#25231a] p-5 text-xs leading-relaxed text-[#e4d6ad]"
                  >
                    The saved report describes an earlier file identity, size, or modification time.
                    Run a fresh verification before trusting it.
                  </div>
                )}
                {runningHere && (
                  <div className="border-b border-line p-7 max-[760px]:p-5">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <span className="micro">STREAM PROGRESS</span>
                      <output className="font-mono text-xl" data-testid="verification-progress">
                        {progress?.percent == null
                          ? 'Preparing'
                          : `${progress.percent.toFixed(1)}%`}
                      </output>
                    </div>
                    <div
                      role="progressbar"
                      aria-label="Verification progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress?.percent ?? 0}
                      className="h-1 bg-[#343835]"
                    >
                      <span
                        className="block h-full bg-accent"
                        style={{ width: `${progress?.percent ?? 0}%` }}
                      />
                    </div>
                    <p className="mt-4 font-mono text-[10px] text-muted">
                      {number(progress?.recordsScanned)} / {number(progress?.totalRecords)} physical
                      records · worker PID {job.workerPid ?? 'starting'}
                    </p>
                  </div>
                )}
                {report && (
                  <div data-testid="verification-report">
                    <div className="grid grid-cols-4 border-b border-line max-[760px]:grid-cols-2">
                      {[
                        {
                          label: 'EXPECTED SAMPLES',
                          value: report.counts.expectedSamples,
                          id: 'expected',
                        },
                        {
                          label: 'RECORDED SAMPLES',
                          value: report.counts.recordedSamples,
                          id: 'recorded',
                        },
                        {
                          label: 'MISSING',
                          value: report.discrepancies.missing.samples,
                          id: 'missing',
                        },
                        {
                          label: 'DUPLICATED',
                          value: report.discrepancies.duplicated.samples,
                          id: 'duplicated',
                        },
                        {
                          label: 'INCORRECT',
                          value: report.discrepancies.incorrect.samples,
                          id: 'incorrect',
                        },
                        {
                          label: 'FORMAT ERRORS',
                          value: report.formatErrors.count,
                          id: 'format-errors',
                        },
                        { label: 'ELAPSED · MS', value: report.execution.elapsedMs, id: 'elapsed' },
                        {
                          label: 'PEAK RSS · BYTES',
                          value: report.execution.peakRssBytes,
                          id: 'peak-rss',
                        },
                      ].map((metric) => (
                        <dl
                          key={metric.id}
                          className="border-r border-b border-line p-5 last:border-r-0"
                        >
                          <dt className="micro">{metric.label}</dt>
                          <dd
                            data-testid={`metric-${metric.id}`}
                            className="mt-3 font-mono text-xl"
                          >
                            {number(metric.value)}
                          </dd>
                        </dl>
                      ))}
                    </div>
                    <div className="grid grid-cols-3 gap-5 p-7 max-[760px]:grid-cols-1 max-[760px]:p-5">
                      <Position
                        testId="first-missing"
                        label="FIRST MISSING"
                        value={report.discrepancies.missing.first}
                      />
                      <Position
                        testId="first-duplicate"
                        label="FIRST DUPLICATE"
                        value={report.discrepancies.duplicated.first}
                      />
                      <Position
                        testId="first-incorrect"
                        label="FIRST INCORRECT"
                        value={report.discrepancies.incorrect.first}
                      />
                    </div>
                    {report.formatErrors.first && (
                      <div
                        role="alert"
                        className="mx-7 mb-7 border border-[#805a47] bg-[#2a211c] p-4 text-xs text-[#ffba89] max-[760px]:mx-5 max-[760px]:mb-5"
                      >
                        <span className="micro">FIRST FORMAT ERROR</span>
                        <p className="mt-2">{report.formatErrors.first}</p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line p-5">
                      <span className="font-mono text-[10px] text-muted">
                        CHECKED {new Date(report.checkedAt).toLocaleString('en-GB')}
                      </span>
                      <a
                        className="inspect-button"
                        href={`/api/recordings/${encodeURIComponent(selected)}/verification`}
                        download
                      >
                        Download JSON report ↓
                      </a>
                    </div>
                  </div>
                )}
                {!runningHere && !report && details && (
                  <div className="p-8 max-[760px]:p-5">
                    <p className="micro">NO CHECKED RESULT</p>
                    <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
                      This completed recording has not been independently verified. The acquisition
                      lifecycle and declared loss counters are not a substitute for scanning its
                      values and identities.
                    </p>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
        <footer className="mt-8 border-t border-line">
          <span>LOCAL CHILD PROCESS / BOUNDED SCAN</span>
          <span>Reports remain valid only for the exact checked file state.</span>
        </footer>
      </main>
    </>
  );
}

function Position({
  testId,
  label,
  value,
}: {
  testId: string;
  label: string;
  value: { frame: number; channel: number; physicalOrdinal?: number } | null;
}) {
  return (
    <dl>
      <dt className="micro">{label}</dt>
      <dd data-testid={testId} className="mt-3 font-mono text-xs leading-relaxed text-muted">
        {value
          ? `frame ${value.frame} · channel ${value.channel}${value.physicalOrdinal === undefined ? '' : ` · physical ${value.physicalOrdinal}`}`
          : 'None'}
      </dd>
    </dl>
  );
}
