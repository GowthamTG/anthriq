# [T13] Keep acquisition independent of slow or disconnected browsers

Published: [GitHub issue #14](https://github.com/GowthamTG/anthriq/issues/14). Publication label:
`ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

A slow tab, disconnected browser, or reopened workbench gets an honest current view while the
acquisition processes continue recording independently.

Scope traceability: user stories 48, 49; acceptance scenarios A27, A28 in the parent specification.

## Acceptance criteria

- [ ] Use HTTP commands and bounded Server-Sent Events for state/preview updates. Acquisition
      remains owned by the local service/processes rather than a page lifecycle.
- [ ] Bound each outgoing client buffer, coalesce telemetry to the latest state, and disconnect
      persistently slow clients without backpressuring the recorder or retaining event history
      indefinitely.
- [ ] On reconnection fetch/emit a fresh authoritative snapshot of acquisition and current metrics;
      do not replay an unlimited backlog or accidentally start a duplicate acquisition.
- [ ] Show disconnected, reconnecting, current running, stopping, failed, and completed states
      clearly. Disabled controls must not suggest a stale connection successfully stopped
      acquisition.
- [ ] Release client listeners and buffers on close. Closing a tab does not stop acquisition, while
      shutting down the local application uses the coordinated stop contract.
- [ ] Exercise a stalled SSE reader, network disconnect/reconnect, multiple observing tabs, and an
      intentionally busy browser during real acquisition.
- [ ] Compare recorded/expected samples and source timing with and without browser pressure;
      demonstrate zero browser-induced loss at default rate and bounded browser/service telemetry
      memory.
- [ ] Document preview loss/coalescing separately from recorded sample loss so skipped screen
      updates are not mislabeled as missing acquisition data.

## Blocked by

- #5: [T04] Stop safely and surface process or disk failures
- #13: [T12] Watch live channel traces with measured acquisition health
