# [T08] Inspect exact time ranges and channel subsets

Published: [GitHub issue #9](https://github.com/GowthamTG/anthriq/issues/9). Publication label:
`ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

An operator selects a recording, enters time or original-index bounds and channels, and inspects the
exact requested observations without scanning the whole file.

Scope traceability: user stories 23, 24, 25, 26, 27; acceptance scenarios A12, A13, A14, A25, A28 in
the parent specification.

## Acceptance criteria

- [ ] Expose range retrieval through the reader, CLI, application operation, and recording-detail
      UI. Original frame indices and requested channel ordering remain visible.
- [ ] Implement half-open intervals. Convert time bounds with ceil(time × rate); reject
      negative/nonfinite/inverted/conflicting bounds and duplicate/empty/out-of-range channel
      selections.
- [ ] Default an omitted channel selection to all channels. Intersect otherwise valid ranges with
      the available timeline; an empty/end-of-file range returns an empty result.
- [ ] Binary-search stored original indices using physical record ordinals for probes, so queries
      after gaps and adjacent duplicates locate the right interval. Reject files known to have
      malformed ordering.
- [ ] Read in bounded reusable chunks targeting 64 KiB. Materialize only a bounded UI window, stream
      full raw results, and explain the read cost of unselected channels within frame-major windows.
- [ ] Preserve duplicate observations and missing gaps in raw retrieval. Never silently interpolate,
      renumber, or fill missing samples with zeros.
- [ ] Support explicit intact-prefix inspection for incomplete recordings with persistent warnings
      and a known available bound; never present unknown final duration as complete.
- [ ] Test exact beginning/middle/end values, fractional times, empty/out-of-range intervals,
      noncontiguous channel order, gaps, duplicates, malformed inputs, and the public UI/API
      interaction.

## Blocked by

- #3: [T02] Configure acquisitions and reproduce exact signal values
- #4: [T03] Browse self-describing recordings and inspect incomplete prefixes
