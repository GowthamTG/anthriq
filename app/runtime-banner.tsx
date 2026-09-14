'use client';

import { useRuntime } from './use-runtime';

export function RuntimeBanner() {
  const runtime = useRuntime();
  if (runtime?.mode !== 'public-demo' || !runtime.limits) return null;
  return (
    <aside
      data-testid="public-demo-banner"
      className="border-b border-[#736233] bg-[#211f17] px-5 py-3 text-center text-xs leading-relaxed text-[#e4d6ad]"
    >
      <strong>Public demonstration:</strong> this is the genuine acquisition pipeline with shared
      controls and persistent hosted storage. Captures are limited to{' '}
      {runtime.limits.maximumDurationSeconds} seconds, the oldest of{' '}
      {runtime.limits.retainedRecordings} temporary recordings rotates out, and the hosted service
      sleeps when idle, so the first request after a quiet period may need a moment to wake. For the
      unbounded local experience (continuous capture, full diagnostics, no shared state), clone and
      run it yourself from{' '}
      <a
        href="https://github.com/GowthamTG/anthriq"
        target="_blank"
        rel="noreferrer"
        className="underline decoration-dotted underline-offset-2 hover:text-[#f5ecd2]"
      >
        github.com/GowthamTG/anthriq
      </a>
      .
    </aside>
  );
}
