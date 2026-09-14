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
      {runtime.limits.retainedRecordings} temporary recordings rotates out, and the free-tier
      service may need a moment to wake.
    </aside>
  );
}
