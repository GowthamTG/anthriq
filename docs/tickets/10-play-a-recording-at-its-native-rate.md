# [T10] Play a recording at its native rate

Published: [GitHub issue #11](https://github.com/GowthamTG/anthriq/issues/11). Publication label: `ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

An operator opens a saved recording and plays the actual selected samples at their native rate, with truthful position and timing metrics in the detail view.

Scope traceability: user stories 30, 35, 36, 37; acceptance scenarios A16, A20, A28 in the parent specification.

## Acceptance criteria

- [ ] Open a finalized recording in paused state and add a working Play action. Keep one active playback session and release the old session when opening another recording.
- [ ] Drive emission from a monotonic anchor at the recorded sample rate. Emit all available selected samples to a bounded full-data sink; the UI preview is a separate decimated output.
- [ ] Define position as the next original frame to emit. Preserve missing time intervals, emit the first adjacent duplicate observation, and count skipped duplicates without altering raw retrieval.
- [ ] Bound output batches and catch-up work. Respect a slow full-data sink by preserving data/position and reporting lag or explicit suspension rather than silently dropping samples.
- [ ] Expose actual emitted frame/sample counts, active elapsed time, current position, current lag, and maximum observed lag. A moving playhead alone is not playback.
- [ ] Show the playing/ended/error state and a basic playback trace/preview using bounded recorded data; do not synthesize display values from the signal function.
- [ ] Emit the final available frame once and stop cleanly at the end. An explicit restart returns to the beginning; repeated Play at end does not implicitly loop.
- [ ] Use the public output interface to check the complete expected sequence, gaps, duplicates, end behavior, slow-sink behavior, and measured 1× timing; include a browser playback smoke test.

## Blocked by

- #9: [T08] Inspect exact time ranges and channel subsets
