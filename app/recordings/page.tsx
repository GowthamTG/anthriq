'use client';

import { RecordingDetails } from '../recording-details';
import { useRecordingLibrary } from '../use-recording-library';
import { WorkbenchHeader } from '../workbench-header';

export default function Recordings() {
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
  } = useRecordingLibrary();

  return (
    <>
      <WorkbenchHeader current="recordings" />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-[1456px] px-12 py-12 max-[760px]:px-5 max-[760px]:py-8"
      >
        <p className="eyebrow">RECORDINGS / LOCAL WORKSPACE</p>
        <div className="mb-9 flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1>
              The captured record<span>.</span>
            </h1>
            <p className="mt-3 text-sm text-muted">
              Saved signals, their provenance, and the data that remains readable.
            </p>
          </div>
          <button className="inspect-button" onClick={refresh} disabled={loading}>
            Refresh library ↻
          </button>
        </div>
        {listError && (
          <p role="alert" className="notice error">
            {listError}
          </p>
        )}
        {loading && (
          <p role="status" className="mb-5 text-sm text-muted">
            Reading local metadata…
          </p>
        )}
        {!loading && !listError && page?.items.length === 0 && (
          <section className="border border-line bg-panel px-8 py-16">
            <p className="micro">AN EMPTY SHELF</p>
            <h2 className="my-4">No recordings yet</h2>
            <p className="mb-7 text-sm text-muted">
              Start a capture to save your first signal here.
            </p>
            <a
              href="/"
              className="inline-block bg-accent px-5 py-3 text-sm font-semibold text-black"
            >
              Start a capture
            </a>
          </section>
        )}
        {page && page.items.length > 0 && (
          <div className="grid grid-cols-[minmax(250px,0.7fr)_minmax(0,1.5fr)] items-start gap-6 max-[900px]:grid-cols-1">
            <section aria-label="Saved recordings" className="min-w-0 border border-line bg-panel">
              <div className="flex items-center justify-between border-b border-line p-5">
                <span className="micro">LOCAL BUNDLES</span>
                <span className="font-mono text-[10px] text-muted">
                  {page.items.length} on this page
                </span>
              </div>
              {page.items.map((entry) => (
                <button
                  key={entry.id}
                  data-testid="library-item"
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
                  <span className="mt-3 block text-xs text-muted">
                    {entry.recording
                      ? `${entry.recording.channels} channels · ${entry.recording.sampleRate.toLocaleString('en-US')} Hz · ${entry.recording.condition}`
                      : 'Unreadable metadata'}
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
                  disabled={!page.nextCursor || loading}
                  onClick={() => setCursor(page.nextCursor!)}
                >
                  Next page
                </button>
              </div>
            </section>
            <section aria-label="Selected recording" className="min-w-0">
              {inspecting && (
                <p role="status" className="p-6 text-sm text-muted">
                  Inspecting saved files…
                </p>
              )}
              {detailError && (
                <div role="alert" data-testid="inspection-error" className="notice error">
                  <h2 className="mb-3 text-xl">Recording unavailable</h2>
                  <p>{detailError}</p>
                </div>
              )}
              {details && <RecordingDetails details={details} />}
              {!selected && (
                <div className="border border-line bg-panel-deep px-8 py-16">
                  <p className="micro">INSPECTION</p>
                  <h2 className="my-4">Every recording has a story.</h2>
                  <p className="max-w-sm text-sm leading-relaxed text-muted">
                    Select a recording to inspect its configuration, physical file, and completion
                    state. Finalized does not mean verified.
                  </p>
                </div>
              )}
            </section>
          </div>
        )}
        {page?.items.length === 0 && detailError && (
          <p data-testid="inspection-error" role="alert" className="notice error mt-6">
            {detailError}
          </p>
        )}
        <footer className="mt-8 border-t border-line">
          <span>LOCAL FILES / METADATA INSPECTION</span>
          <span>Frame payloads are not scanned by this view.</span>
        </footer>
      </main>
    </>
  );
}
