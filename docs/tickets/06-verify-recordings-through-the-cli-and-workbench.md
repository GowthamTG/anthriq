# [T06] Verify recordings through the CLI and workbench

Published: [GitHub issue #7](https://github.com/GowthamTG/anthriq/issues/7). Publication label: `ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

A reviewer runs verification from the CLI or UI and receives a trustworthy streaming report with separate discrepancy counts, first positions, progress, and a machine-checkable result.

Scope traceability: user stories 38, 39, 40, 41, 42, 43, 44, 50; acceptance scenarios A01, A21, A22, A23, A24, A25, A26, A29 in the parent specification.

## Acceptance criteria

- [ ] Physically stream all complete records against deterministic rounded float32 expectations without loading the full recording/expected signal or retaining an unbounded anomaly list.
- [ ] Separately count missing scalar samples, adjacent duplicated scalar observations, and incorrect values; report the first frame/channel of each class and the first duplicate's physical ordinal.
- [ ] Detect beginning/interior/trailing loss using the independently confirmed expected extent; compare incorrect values in duplicate records too, with overlapping class counts documented.
- [ ] Fail explicitly on invalid/unknown metadata or waveform version, unsafe/out-of-extent indices, decreasing order, contradictory counts/duration/layout, partial records, or unconfirmed final extent. Do not invent precise classifications when record identity/order is malformed.
- [ ] Produce structured expected/recorded counts, discrepancy counts/positions, format errors, duration and memory evidence. Exit 0 for PASS, 1 for a completed failed integrity/format report, and 2 when invocation/operational failure prevents a report.
- [ ] Run UI verification in a separate child with at most one active job. Expose bounded progress, success, integrity failure, and operational failure without blocking controls or acquisition.
- [ ] Associate a saved/downloadable report with the checked recording state and mark it stale after detected file identity/size/modification changes.
- [ ] Use independent tiny fixtures and deliberate physical corruption to test initial/interior/trailing loss, adjacent duplicates, incorrect and nonfinite values, combined classes, truncation, bad metadata, and decreasing indices. Tests must not rely solely on the production encoder agreeing with the decoder.

## Blocked by

- #3: [T02] Configure acquisitions and reproduce exact signal values
