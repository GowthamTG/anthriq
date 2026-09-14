'use client';

import { useEffect, useRef, useState } from 'react';
import { requestJson } from './http';

export type ServiceConnection = 'connecting' | 'live' | 'reconnecting' | 'offline';

type EventHandlers = Record<string, (value: unknown) => void>;

export function useServiceEvents({
  url,
  handlers,
  snapshot,
  reconnectQuery,
}: {
  url: string | null;
  handlers: EventHandlers;
  snapshot?: { url: string; apply: (value: unknown) => void };
  reconnectQuery?: () => URLSearchParams;
}) {
  const handlersRef = useRef(handlers);
  const snapshotRef = useRef(snapshot);
  const reconnectQueryRef = useRef(reconnectQuery);
  const [connection, setConnection] = useState<ServiceConnection>('connecting');
  handlersRef.current = handlers;
  snapshotRef.current = snapshot;
  reconnectQueryRef.current = reconnectQuery;

  useEffect(() => {
    if (!url) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let delay = 250;

    const scheduleReconnect = () => {
      if (cancelled || retry) return;
      if (!navigator.onLine) {
        setConnection('offline');
        return;
      }
      setConnection('reconnecting');
      retry = setTimeout(connect, delay);
      delay = Math.min(4000, delay * 2);
    };

    const connect = async () => {
      retry = undefined;
      if (cancelled) return;
      setConnection((current) => (current === 'connecting' ? current : 'reconnecting'));
      try {
        if (snapshotRef.current) {
          const value = await requestJson<unknown>(snapshotRef.current.url);
          snapshotRef.current.apply(value);
        }
        if (cancelled) return;
        const query = reconnectQueryRef.current?.().toString();
        source = new EventSource(query ? `${url}?${query}` : url);
        for (const eventName of Object.keys(handlersRef.current)) {
          source.addEventListener(eventName, (event) => {
            try {
              handlersRef.current[eventName]?.(JSON.parse(event.data));
            } catch {
              // A malformed event is treated as a failed connection and refreshed from a snapshot.
              source?.close();
              source = null;
              scheduleReconnect();
            }
          });
        }
        source.onopen = () => {
          delay = 250;
          setConnection('live');
        };
        source.onerror = () => {
          source?.close();
          source = null;
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    const online = () => {
      if (!source && !retry) void connect();
    };
    const offline = () => {
      source?.close();
      source = null;
      if (retry) clearTimeout(retry);
      retry = undefined;
      setConnection('offline');
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    void connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      source?.close();
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [url]);

  return connection;
}
