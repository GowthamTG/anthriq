# [T09] Export selected observations as CSV and JSON-lines

Published: [GitHub issue #10](https://github.com/GowthamTG/anthriq/issues/10). Publication label: `ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

An operator exports the selected time range and channels from the recording detail, or streams machine-readable observations from the CLI, without loading the full export.

Scope traceability: user stories 28; acceptance scenarios A15, A28 in the parent specification.

## Acceptance criteria

- [ ] Provide CSV download from the visible selected range/channel controls and streamed JSON-lines output from the documented CLI/service contract.
- [ ] CSV includes original frame index, time in seconds, and the selected channel headings in requested order; JSON-lines includes original index and values in that same order.
- [ ] Export the actual available observations, preserving gaps and adjacent duplicates, with no waveform synthesis or silent repair.
- [ ] Stream with output backpressure and bounded memory, handling cancellation or a disconnected download by releasing readers. Export backpressure never throttles the independent acquisition source.
- [ ] Validate format/selection and distinguish invalid requests, missing recordings, and I/O failures without returning an apparently successful truncated export.
- [ ] Test CSV/JSON-lines values against independent fixtures, channel order, empty ranges, a slow output consumer, and cancellation; exercise the browser's download action.
- [ ] Document export semantics, units, and how to reproduce the same selection through the CLI.

## Blocked by

- #9: [T08] Inspect exact time ranges and channel subsets
