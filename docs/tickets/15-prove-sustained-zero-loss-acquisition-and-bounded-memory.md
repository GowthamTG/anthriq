# [T15] Prove sustained zero-loss acquisition and bounded memory

Published: [GitHub issue #16](https://github.com/GowthamTG/anthriq/issues/16). Publication label:
`ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

The reviewer can reproduce a sustained acquisition benchmark and inspect measured timing, memory,
loss accounting, and a clean validation report instead of relying on claims.

Scope traceability: user stories 12, 13, 14, 15, 16, 38, 54; acceptance scenarios A01, A05, A06,
A07, A27, A29 in the parent specification.

## Acceptance criteria

- [ ] Provide a repeatable benchmark workflow that runs a default configuration for the one-hour
      target, captures bounded-frequency metrics to disk, and invokes the real streaming validator
      on completion.
- [ ] Record actual platform/CPU/RAM/storage context, runtime versions, configuration, clock method,
      duration, and whether UI or other heavy work was active. Do not claim a quiet benchmark if
      development ran concurrently.
- [ ] Persist source scheduled/emitted counts, persisted/lost counts, source pacing deviations,
      generator/recorder RSS, queue usage/high-water, and validation time/memory with explicit
      units.
- [ ] Require zero missing, duplicated, incorrect, and format errors in the nominal completed run.
      If the target is not achieved, preserve the failure evidence and fix/retest or disclose the
      actual unmet target; no fabricated results.
- [ ] Compare warmup/middle/late memory windows and explain constant resource bounds separately from
      measured RSS. Stream measurement history so the benchmark itself does not grow acquisition
      memory.
- [ ] Include shorter controlled overload/recovery and slow-browser comparison evidence, reconciling
      independent source extent, persisted identities, and exact lost intervals.
- [ ] Retain compact machine-readable reports and human-readable measured summaries in version
      control, but keep the approximately 2 GB binary recording outside Git. Make the long recording
      available locally for dependent retrieval/playback measurements.
- [ ] Document the one-hour duration as the agreed engineering target, not a PDF-mandated test
      duration; report timing achieved without inventing a numerical assessment threshold.

## Blocked by

- #6: [T05] Demonstrate bounded overload loss and recorder recovery
- #7: [T06] Verify recordings through the CLI and workbench
- #14: [T13] Keep acquisition independent of slow or disconnected browsers
