'use client';

import { useEffect, useState } from 'react';
import type { RuntimeInfo } from '../core/contracts';
import { requestJson } from './http';

export function useRuntime() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    requestJson<RuntimeInfo>('/api/runtime', { signal: controller.signal })
      .then(setRuntime)
      .catch(() => {
        // Operational views already report service connectivity; this hint is nonessential.
      });
    return () => controller.abort();
  }, []);
  return runtime;
}
