# [T16] Measure seeking, export, playback, and verification on a long recording

Published: [GitHub issue #17](https://github.com/GowthamTG/anthriq/issues/17). Publication label:
`ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

The reviewer sees reproducible evidence that small queries, export, playback controls, and
verification remain correct and memory-bounded on the sustained recording.

Scope traceability: user stories 26, 29, 35, 38, 54; acceptance scenarios A14, A15, A16, A17, A18,
A19, A20 in the parent specification.

## Acceptance criteria

- [ ] Use the long recording and recorded platform context from the sustained-acquisition ticket;
      retain identifiers and configuration so measurements can be reproduced.
- [ ] Measure range retrieval and seek near the beginning, middle, and end, including noncontiguous
      channel subsets. Report index probes/read cost, elapsed time, requested window, and working
      memory.
- [ ] Measure a streamed export with a slow consumer and show memory depends on bounded
      chunks/selected output rather than total recording duration.
- [ ] Measure actual native, slower, and faster playback output pacing, lag, emitted counts, and
      memory. Include pause/resume and seek transitions with paused time excluded and timing
      segments reset correctly.
- [ ] Check selected values and output identities against independent expectations so timings cannot
      mask missing/duplicated output or a playhead-only simulation.
- [ ] Report the frame-major channel-read amplification, binary-search seek behavior, bounded
      catch-up limits, and slow-full-data-sink policy without claiming unsupported guarantees.
- [ ] Confirm streaming verification memory/time on the completed long file and preserve its actual
      report.
- [ ] Publish compact measured results and exact reproduction steps. Fix newly exposed
      correctness/resource defects and rerun the affected measurement before marking the ticket
      done.

## Blocked by

- #10: [T09] Export selected observations as CSV and JSON-lines
- #12: [T11] Pause, seek, and change playback speed without losing position
- #16: [T15] Prove sustained zero-loss acquisition and bounded memory
