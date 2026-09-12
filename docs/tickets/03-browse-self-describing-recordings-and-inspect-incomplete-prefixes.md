# [T03] Browse self-describing recordings and inspect incomplete prefixes

Published: [GitHub issue #4](https://github.com/GowthamTG/anthriq/issues/4). Publication label: `ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

A reviewer opens the recordings library, inspects any saved recording, and understands its format, counts, completion state, and readable prefix without reading the whole signal.

Scope traceability: user stories 19, 20, 21, 22, 27, 29, 50, 51; acceptance scenarios A10, A11, A25, A28 in the parent specification.

## Acceptance criteria

- [ ] Provide a bounded/paginated recordings library backed by local metadata, with inspect operations in the UI, service, and CLI; listing and inspection must not scan complete frame streams or retain every recording's payload in memory.
- [ ] Show identity, channels, rate, seed, waveform version, timestamps, expected extent, recorded frame/scalar counts, duration, bytes, and lifecycle. A finalized recording is not automatically marked verified or lossless.
- [ ] Specify the complete recording bundle and record layout independently of source code: eight-byte little-endian uint64 original index, followed by C little-endian float32 values in channel order, stride 8 + 4C.
- [ ] Document nondecreasing indices, preserved adjacent duplicates, independently known expected extent, and the association of metadata, loss log, measurements, and validation result.
- [ ] Validate metadata type/version/layout/rate/counts before allocating or reading. Report contradictions, unknown format versions, and partial trailing bytes clearly rather than treating them as successful completion.
- [ ] Inspect a truncated file using only its complete physical records and expose the intact prefix. If final source extent was never confirmed, display duration/completeness as unknown instead of inferring a complete run.
- [ ] Document 544,000 bytes/second and 1,958,400,000 bytes/hour at defaults, excluding sidecars; explain float32, frame identity overhead, rejected formats, and channel-read amplification.
- [ ] Test empty and paginated libraries, missing recording IDs, invalid metadata, a normal recording, and a truncated/incomplete fixture through public inspection behavior and the visible detail view.

## Blocked by

- #2: [T01] Launch locally, capture a nominal signal, and inspect the saved result
