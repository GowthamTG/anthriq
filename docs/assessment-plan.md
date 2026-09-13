# Assessment breakdown and proposed build plan

Status: design recommendations accepted. Initial core code is drafted but untested. The complete
implementation specification is in `SPEC.md`, which supersedes provisional wording in this planning
document.

Deadline confirmed by the user: Monday EOD, following Saturday 2026-09-12 (Monday 2026-09-14). Exact
cutoff time is unspecified. The user can use multiple AI coding tools. Plan to reserve Monday for
testing, measurements, fixes, and submission preparation rather than treating tool availability as a
guarantee of delivery speed.

Source: `Technical_Assessment 1.pdf`, all three pages. The assessment is the source of acceptance
criteria. The user's priorities are a simple implementation, limited development time, complete
assessment coverage, and an impressive interface. The pasted architecture persona is reference
material, not an additional set of deliverables.

## What the problem actually asks for

Build an instrument-style data recorder. A source produces deterministic multi-channel data on a
real-world clock. An independent recorder must keep up, save it to disk with bounded memory, and
make it possible to retrieve, replay, and verify the saved data.

The required stack is Node.js and React. The user has accepted plain Node.js acquisition processes
with Next.js/React for the interface and authorized the recommended minimal tools. Supabase and Yjs
have no identified assessment role and will be omitted.

Default load: 32 channels × 4,000 samples/second/channel = 128,000 numeric values/second, or
460,800,000 values/hour. Distinguish a single-channel sample from a frame of all channels.

## Complete acceptance checklist

### Acquisition and recording

- Runtime-configurable channel count and sample rate, with documented configuration.
- Deterministic values reproducible independently for any channel and original sample index.
- Generator and recorder run as two independent operating-system processes.
- Clock-paced generation, independent of recorder backpressure.
- Document pacing strategy and measure emitted count versus elapsed time over a sustained run.
- Continuous disk recording with no fixed recording-duration limit.
- Steady-state memory independent of recording duration.
- Explicit buffering upper bound and overload policy.
- Report loss counts and positions, including loss at the end of a run.
- Graceful interrupt drains accepted data and finalizes readable metadata.
- Zero loss in nominal operation; overload behavior and limitations explained.

### Storage

- Interpret a recording without application source code using its metadata and a written format
  specification.
- Include channels, sample rate, total sample count, duration, numeric type, width, byte order,
  layout, and start timestamp.
- Retrieve arbitrary time ranges and channel subsets without a full-file scan where the layout
  permits; document any extra reads.
- Explain bytes per sample, approximate default one-hour size, alternatives, and format rationale.
- Explain interruption and truncated-file readability.

### Retrieval and playback

- Metadata inspection.
- Retrieval by time interval and by sample-index interval.
- Arbitrary channel subsets.
- Native-rate playback with measured pacing accuracy.
- Configurable slower and faster playback speeds. The text does not explicitly require reverse
  chronological playback.
- Pause/resume without losing position.
- Arbitrary seek with documented cost.
- Memory scales with the requested window and selected channels rather than total recording size.

### Verification

- Streaming comparison against the deterministic expected signal.
- Separate missing, duplicated, and incorrect counts.
- First discrepancy position for each class.
- Bounded working memory, including reporting; do not accumulate every anomaly in RAM.
- Machine-checkable result, such as a nonzero exit status on failure.
- Preserve original sample indices so missing/duplicated samples can be identified independently of
  numeric values.
- Establish the expected acquisition extent independently of the number of records saved, so
  trailing loss cannot silently pass.

### Optional visualizer, included in proposed scope

- Live acquisition and playback views.
- Decimation/windowing keeps rendering responsive at full acquisition rate.
- A slow browser must not slow the recorder or cause acquisition loss.
- Honest empty, running, paused, disconnected, and failed states; no fabricated metrics.

### Submission

- GitHub repository link.
- README: build/run instructions, dependencies, development and measurement platform.
- Architecture, process boundaries, and data flow.
- Independently implementable storage-format specification.
- Measured throughput and memory, measurement method, and run duration.
- Verification output for at least one completed run.
- Decisions, accepted trade-offs, limitations, and future work.

## Phases and integration gates

| Phase                   | Build                                                                                                      | Done when                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1. Contracts            | Signal function, sample/frame terminology, configuration, format specification, tiny reader/writer fixture | A known fixture can be interpreted and reproduced exactly                                                      |
| 2. Acquisition          | Independent generator and recorder, clock pacing, bounded transport/buffers, interruption                  | Default-rate run records without loss; a slow recorder does not throttle the source                            |
| 3. Verification         | Streaming validator and corruption fixtures                                                                | Missing, duplicate, incorrect, and trailing-loss cases produce correct counts, first positions, and exit codes |
| 4. Retrieval            | Metadata, time/index windows, channel selection                                                            | Exact requested values are returned without scanning the complete recording                                    |
| 5. Playback             | Timed emission, speed, pause/resume, seek, pacing metrics                                                  | Controls preserve position and report actual timing accuracy                                                   |
| 6. Interface            | Next.js instrument dashboard, bounded waveform preview, recordings browser, verifier results               | Both live and playback data are visible without affecting acquisition throughput                               |
| 7. Evidence and handoff | Sustained benchmarks, overload/interruption checks, README, demo steps                                     | Submission claims are supported by saved measured results and reproducible commands                            |

Use one repository and share small signal/format utilities across the processes, reader, and
validator. Avoid introducing service layers, queues, or ORMs unless a proven requirement needs them.

## Accepted product direction

- Next.js/React interface plus plain Node.js acquisition processes and local files.
- Omit Supabase and Yjs; no account/catalogue or collaborative-editing requirement justifies them.
- Primary delivery: one-command local execution and a short demonstration video.
- Public hosting is last priority and only worthwhile if it is straightforward after the local
  submission is complete.
- Precision-instrument visual direction: dark graphite, crisp typography, restrained channel colors,
  large waveform views, and measured health/correctness metrics.
- Prefer standard Node.js libraries for the recorder, files, and process management.
- The UI receives bounded previews and metrics; it never receives every raw value merely to draw a
  waveform.

## Accepted technical direction

- Fixed-width binary frames containing an original uint64 index and interleaved float32 channel
  values, with readable JSON metadata.
- Credit-bounded IPC; exhausted credits cause newly due frames to be dropped and precisely accounted
  for while the source timeline continues.
- Default one-hour frame data occupies 1,958,400,000 bytes including eight-byte frame indices. This
  is a size calculation, not a measured result.
- The accepted wow moment is live traces and measured health metrics, then stop, inspect, seek, and
  verify the recording in the same interface. Controlled fault demonstrations use disposable
  copies/runs.

## Next work

1. Reconcile the initial core drafts with the specification and run the acceptance checks.
2. Build the interface, measure sustained behavior, and prepare the submission.

Engineering-skills setup is complete. The specification is published as GitHub issue #1 in
`GowthamTG/anthriq`, labeled `ready-for-agent`.

The user has confirmed shared understanding and authorized the recommended implementation. Further
interviews are unnecessary for routine implementation choices.
