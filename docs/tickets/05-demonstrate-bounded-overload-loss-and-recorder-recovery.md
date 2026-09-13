# [T05] Demonstrate bounded overload loss and recorder recovery

Published: [GitHub issue #6](https://github.com/GowthamTG/anthriq/issues/6). Publication label:
`ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

A reviewer deliberately slows recording, sees the source remain clock-paced, and gets exact lost
intervals plus successful recovery when recording catches up.

Scope traceability: user stories 13, 14, 15, 16; acceptance scenarios A05, A06, A07 in the parent
specification.

## Acceptance criteria

- [ ] Enforce the configured byte-credit budget across sample batches waiting for IPC, queued for
      writing, and being written. A send callback never returns persistence credit.
- [ ] When insufficient credit is available, keep advancing the original source timeline and drop
      newly due frames; never build an unbounded generator queue, throttle the source, or rewrite
      positions.
- [ ] Expose scheduled, emitted/offered, persisted, and dropped counts separately with explicit
      frame/scalar units; include observed emission/pacing deviations rather than using a schedule
      counter as proof of output.
- [ ] Detect initial, interior, and trailing lost intervals from frame identities and independent
      final extent. Stream each interval with start, exclusive end, scalar/frame counts, and known
      cause; retain bounded counters only in memory.
- [ ] Provide a documented diagnostic recorder delay/stall mechanism that can recover during a run.
      Keep it explicit and off by default; an ordinary nominal recording is never silently
      fault-injected.
- [ ] Show actual buffer usage/high-water mark, lost counts, source timing, and degraded state in
      the UI; completed-with-loss is distinct from failed finalization and from verified PASS.
- [ ] Run automated real-process tests with a small budget, temporary stall, and recovery. Reconcile
      saved identities, loss-log intervals, source timing, and final extent; nominal mode still has
      zero loss.
- [ ] Measure queue high-water and process memory, bound/coalesce control telemetry as well as
      sample messages, and document runtime/serialization/OS overhead outside the sample-byte
      budget.

## Blocked by

- #3: [T02] Configure acquisitions and reproduce exact signal values
- #5: [T04] Stop safely and surface process or disk failures
