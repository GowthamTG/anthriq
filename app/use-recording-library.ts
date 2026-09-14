'use client';

import { useEffect, useState } from 'react';
import type { LibraryPage } from '../core/library';
import type { RecordingInspection } from '../core/contracts';
import { requestJson } from './http';

export function useRecordingLibrary(detailRevision = '') {
  const [page, setPage] = useState<LibraryPage | null>(null);
  const [cursor, setCursor] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [details, setDetails] = useState<RecordingInspection | null>(null);
  const [listError, setListError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const readSelection = () => setSelected(new URLSearchParams(window.location.search).get('id'));
    readSelection();
    window.addEventListener('popstate', readSelection);
    return () => window.removeEventListener('popstate', readSelection);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError('');
    requestJson<LibraryPage>(`/api/recordings?limit=10&cursor=${encodeURIComponent(cursor)}`, {
      signal: controller.signal,
    })
      .then(setPage)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setListError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [cursor, detailRevision, revision]);

  useEffect(() => {
    setDetails(null);
    setDetailError('');
    if (!selected) {
      setInspecting(false);
      return;
    }
    const controller = new AbortController();
    setInspecting(true);
    requestJson<RecordingInspection>(`/api/recordings/${encodeURIComponent(selected)}`, {
      signal: controller.signal,
    })
      .then(setDetails)
      .catch((cause) => {
        if (!controller.signal.aborted)
          setDetailError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setInspecting(false);
      });
    return () => controller.abort();
  }, [selected, revision, detailRevision]);

  function select(id: string) {
    setSelected(id);
    window.history.pushState(null, '', `${window.location.pathname}?id=${encodeURIComponent(id)}`);
  }

  return {
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
    refresh: () => setRevision((value) => value + 1),
  };
}
