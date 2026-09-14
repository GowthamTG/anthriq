'use client';

import { useEffect, useState } from 'react';
import type { AllChannelOverview } from '../core/contracts';
import { requestJson } from './http';

interface OverviewState {
  recordingId: string;
  prefix: boolean;
  value: AllChannelOverview;
}

export function useAllChannelOverview({
  recordingId,
  enabled,
  prefix,
  refresh,
}: {
  recordingId: string | null;
  enabled: boolean;
  prefix: boolean;
  refresh: boolean;
}) {
  const [state, setState] = useState<OverviewState | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !recordingId) return;
    setError('');
    let mounted = true;
    let controller: AbortController | null = null;
    let timer: number | null = null;
    const load = async () => {
      controller = new AbortController();
      try {
        const value = await requestJson<AllChannelOverview>(
          `/api/recordings/${encodeURIComponent(recordingId)}/channel-overview${prefix ? '?prefix=true' : ''}`,
          { signal: controller.signal },
        );
        if (mounted) {
          setState({ recordingId, prefix, value });
          setError('');
        }
      } catch (cause) {
        if (mounted && !(cause instanceof DOMException && cause.name === 'AbortError'))
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        controller = null;
        if (mounted && refresh) timer = window.setTimeout(() => void load(), 500);
      }
    };
    void load();
    return () => {
      mounted = false;
      controller?.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, prefix, recordingId, refresh]);

  const overview = state?.recordingId === recordingId ? state.value : null;
  return {
    overview,
    overviewError: error,
    overviewStale: Boolean(overview && (state?.prefix !== prefix || error)),
  };
}
