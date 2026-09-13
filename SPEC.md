# SCOPE: Signal Acquisition, Recording, Playback, and Verification

Status: implementation specification, synthesized from the assessment and accepted design decisions.
Core implementation drafts exist; no completed application or measured results are claimed by this
document.

Deadline: Monday, September 14, 2026, end of day. The precise submission cutoff is unspecified.

The working product name is **SCOPE**. Naming is reversible and must not delay delivery.

## Problem Statement

A hiring assessment asks the candidate to demonstrate that they can build an instrument-style data
acquisition system using Node.js and React. A simulated instrument produces continuous multi-channel
samples at a fixed real-world rate. The recording software must keep up, persist those samples to
disk, and provide evidence that the stored signal is correct.

At the default configuration, the instrument produces 32 channels at 4,000 samples per second per
channel: 128,000 scalar values per second and 460,800,000 scalar values in one hour. Both channel
count and sample rate must be configurable at runtime.

The candidate needs a complete, understandable submission before Monday EOD. The solution must
prioritize correctness, predictable memory use, measured performance, and simple code. It should
also provide an impressive interface that makes the engineering visible to a reviewer, without
letting visualization interfere with acquisition.

The key challenge is preserving the source's clock under downstream pressure. Slowing the source to
match a stalled recorder does not satisfy the assessment. Neither does accumulating an unbounded
queue. Normal operation must record without sample loss; overload must follow a bounded, explicitly
documented policy and identify exactly where loss occurred.

The submitted recording must be independently interpretable, efficiently searchable by time,
replayable at controlled speeds, and verifiable without loading the entire signal into memory.

## Solution

Build a local instrument workbench with a Next.js/React interface and a plain Node.js acquisition
core. One command starts the local application after documented dependency installation and any
required initial build. The core also remains runnable and testable from the command line without
the browser.

The reviewer can configure a signal, start acquisition, watch selected channels and actual health
metrics, stop cleanly, inspect the saved recording, retrieve a time range, replay it, and run a
deterministic integrity check. The same interface exposes a small, isolated fault demonstration
showing that missing samples, duplicated samples, and incorrect values are detected rather than
hidden.

The generator and recorder are separate operating-system processes. The generator follows a
monotonic clock; the recorder saves compact binary frame records. A fixed byte budget bounds
outstanding sample data. When that budget is exhausted, the source timeline continues and newly due
frames are dropped with precise accounting. The system never labels that recording lossless.

The UI uses a bounded, decimated signal preview. A slow or disconnected browser cannot block
acquisition. The interface feels like a precision scientific instrument: graphite surfaces, clear
typography, restrained channel colors, large traces, and concise controls.

The primary handoff is a GitHub repository with reproducible local instructions, measured evidence,
and a short demonstration video. Public hosting is a final optional task, attempted only after the
local submission is complete and only if straightforward.

### Success criteria

1. Every mandatory assessment requirement is implemented and linked to a reproducible check.
2. A completed nominal acquisition verifies with zero missing, duplicated, or incorrect samples.
3. Generation pacing is measured independently of recorder performance.
4. Recording and verification working memory remain bounded as recording duration increases.
5. Retrieval and playback do not load or scan the complete recording merely to access a small time
   window.
6. Playback supports native speed, slower/faster speed, pause/resume, and arbitrary seek, with
   measured pacing.
7. A reviewer can interpret the binary recording from its metadata and written format specification
   without consulting application source code.
8. The browser demonstrates actual live and playback data while acquisition remains unaffected.
9. The README contains actual results, methods, platform details, trade-offs, and limitations.

## User Stories

### Setup and configuration

1. As a reviewer, I want clear installation and launch instructions, so that I can run the
   submission without reconstructing the developer's environment.
2. As a reviewer, I want one command to launch the local workbench after setup, so that I can focus
   on evaluating the system.
3. As a reviewer, I want to run the core without a browser, so that correctness and throughput can
   be evaluated independently of the UI.
4. As an operator, I want the default configuration to match 32 channels at 4,000 samples per second
   per channel, so that the assessment scenario works immediately.
5. As an operator, I want to change channel count and sample rate at runtime, so that I can exercise
   different workloads without editing code.
6. As an operator, I want a known waveform seed, so that I can reproduce the same signal later.
7. As an operator, I want invalid configurations rejected before acquisition starts, so that a
   recording is never created under ambiguous settings.
8. As an operator, I want to choose either a fixed duration or acquisition until I stop it, so that
   I can run both benchmarks and interactive sessions.

### Acquisition and recording

9. As an operator, I want the source to follow a real-world clock, so that the data represents an
   instrument rather than a maximum-speed loop.
10. As a reviewer, I want the generator and recorder to be distinct processes, so that I can inspect
    the required process boundary.
11. As an operator, I want generated values to be reproducible at any sample index, so that a
    recording can be independently checked.
12. As an operator, I want a nominal acquisition to persist every sample, so that the recording is
    complete.
13. As an operator, I want a bounded recording buffer, so that a long run does not exhaust memory
    merely because time has passed.
14. As a reviewer, I want to stall the recorder without slowing the source timeline, so that I can
    evaluate the overload design.
15. As an operator, I want the exact count and position of each lost interval, so that I can
    determine which signal intervals remain usable.
16. As an operator, I want recording to recover after a temporary stall, so that later samples
    retain their correct original positions.
17. As an operator, I want to stop from the interface or interrupt the process, so that buffered
    accepted data is drained and metadata finalized.
18. As an operator, I want disk failures reported explicitly, so that I do not mistake an incomplete
    recording for a successful one.
19. As an operator, I want the readable prefix of an interrupted recording preserved, so that useful
    data is not discarded because its final write was incomplete.

### Storage and retrieval

20. As a reviewer, I want self-describing metadata and a complete format specification, so that I
    can write an independent reader.
21. As an operator, I want to inspect channels, sample rate, timestamps, duration, counts, and
    completion state, so that I understand a recording before using it.
22. As a reviewer, I want sample counts and frame counts clearly distinguished, so that throughput
    and integrity results cannot be misinterpreted.
23. As an operator, I want to retrieve an interval by time, so that I can inspect a meaningful
    segment of the acquisition.
24. As an operator, I want to retrieve an interval by original sample index, so that I can reproduce
    a precise diagnostic query.
25. As an operator, I want to select any valid subset of channels, so that I receive only the
    signals relevant to my investigation.
26. As an operator, I want seeking and retrieval to remain efficient on a long recording, so that a
    small query does not require a complete-file scan.
27. As an operator, I want gaps and duplicate observations preserved in raw retrieval, so that the
    software does not silently rewrite the evidence.
28. As an operator, I want selected data exported as CSV, so that I can inspect it in another tool.
29. As a reviewer, I want storage-size and read-amplification trade-offs explained, so that I can
    assess why the layout was chosen.

### Playback

30. As an operator, I want to replay a completed recording at its native rate, so that I can review
    the original timing.
31. As an operator, I want both slower and faster playback, so that I can inspect detail or traverse
    a recording quickly.
32. As an operator, I want pause to preserve the next playback position, so that resuming does not
    omit or repeat emitted samples.
33. As an operator, I want to seek to a precise offset while paused or playing, so that I can move
    directly to an event.
34. As an operator, I want to change visible channels during playback, so that I can focus without
    altering the recording.
35. As a reviewer, I want observed playback timing and lag reported, so that a moving playhead
    cannot disguise incorrect emission pacing.
36. As an operator, I want playback to preserve missing intervals as gaps, so that loss does not
    compress the original timeline.
37. As an operator, I want playback to stop cleanly at the end, so that its final state and position
    are unambiguous.

### Verification

38. As a reviewer, I want streaming validation against the expected deterministic signal, so that
    verification is practical for long recordings.
39. As a reviewer, I want missing, duplicated, and incorrect samples counted separately, so that
    different failure modes are distinguishable.
40. As a reviewer, I want the first discrepancy position for every class, so that I can diagnose
    each failure without searching the entire recording manually.
41. As a reviewer, I want trailing sample loss detected, so that an apparently valid prefix cannot
    falsely pass as a complete run.
42. As a reviewer, I want malformed metadata, incomplete records, and invalid ordering reported, so
    that structural corruption cannot produce a misleading PASS.
43. As a reviewer, I want a machine-readable report and meaningful process exit status, so that I
    can automate validation.
44. As an operator, I want verification progress and a saved result associated with the recording,
    so that I can see whether a check is still running or has completed.
45. As a reviewer, I want isolated examples of each corruption class, so that I can prove the
    validator detects faults rather than merely approving its own output.

### Interface and handoff

46. As an operator, I want live waveforms for selected channels, so that I can immediately see that
    acquisition is producing data.
47. As an operator, I want actual counts, buffer use, timing, and loss metrics beside the traces, so
    that system health is visible in context.
48. As an operator, I want rendering to remain responsive at the default full data rate, so that
    using the interface does not disrupt recording.
49. As an operator, I want empty, starting, recording, stopping, completed, disconnected, and failed
    states to be distinguishable, so that controls accurately reflect what the system can do.
50. As an operator, I want recording completion and successful verification represented separately,
    so that a finalized file is not automatically presented as lossless.
51. As an operator, I want a recordings library, so that I can reopen and compare the metadata and
    results of earlier runs.
52. As a reviewer, I want readable labels, keyboard-accessible controls, and a usable smaller-screen
    layout, so that I can evaluate the product comfortably.
53. As a reviewer, I want a concise demonstration of capture, replay, and verification, so that I
    can understand the complete workflow quickly.
54. As a reviewer, I want measured performance and memory evidence with the measurement method, so
    that I can assess claims rather than estimates.
55. As a reviewer, I want documented limitations and rejected alternatives, so that I can understand
    the candidate's judgment.
56. As the candidate, I want public deployment deferred until the local deliverable is complete, so
    that hosting does not jeopardize the submission deadline.

## Implementation Decisions

### 1. Scope, terminology, and simplicity

- Use the established glossary: a **sample** is one channel value; a **frame** contains every
  channel at a single sample index. Sample indices and channel indices are zero-based.
- Report scalar sample counts to match the assessment's example. Label any frame counts explicitly.
- Use one repository, plain JavaScript ES modules for the Node.js core, Next.js/React for the
  interface, native CSS, and Canvas for traces. Add dependencies only for a concrete requirement.
- Prefer Node.js built-ins for process management, binary buffers, files, timing, tests, and the
  local HTTP service. Do not introduce an ORM, database, service framework, or message broker.
- Supabase and Yjs are omitted by agreement. No backend account or remote service is required to run
  the assessment.
- Support one active acquisition and one active playback session in the local workbench. Multiple
  stored recordings are supported. Verification runs separately from acquisition.
- Node.js 24 is the initial development baseline. Pin actual installed dependencies and document the
  tested runtime and operating system. macOS is the current development environment; do not claim
  other platforms are tested without evidence.

### 2. Module responsibilities and process boundaries

| Module                    | Responsibility                                                      | Observable contract                                                                        |
| ------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Signal/configuration      | Validate settings and define deterministic values                   | Same settings, channel, and sample index always yield the same float32 value               |
| Generator process         | Follow the source clock and offer indexed frame batches             | Source timeline does not wait for recorder credit; emitted and dropped counts are separate |
| Recorder process          | Grant byte credits, persist batches, record gaps, finalize metadata | Bounded outstanding data; no credit returned before write completion                       |
| Recording reader          | Inspect metadata, seek by original index, stream selected values    | Half-open intervals, ordered channel selection, intact-prefix reads                        |
| Playback engine           | Timed emission, position, speed, pause/resume, seek                 | Every emitted frame retains its original position; lag is measured                         |
| Validator                 | Stream physical records and compare with deterministic expectations | Counts, first discrepancies, format errors, and machine-checkable result                   |
| Local application service | Coordinate processes and expose application operations              | One owner of process lifecycle; browser events cannot throttle acquisition                 |
| React interface           | Present controls, traces, recordings, results, and status           | Real data, bounded preview, clear loading/error/empty states                               |

The local application service starts a recorder process. That recorder starts a generator process.
The generator and recorder have independent event loops and operating-system process identities.
Creating one process as the other's child satisfies process independence; implementing both in one
event loop does not.

Data flows from generator to recorder to local disk. Preview and telemetry flow separately from
recorder to application service to browser. Commands flow from the browser through the application
service to the relevant process. The command-line interface can launch the recorder directly without
the application service.

Use a custom local Node.js server to host Next.js and the application operations in one launch.
Avoid storing long-lived acquisition ownership in development-reloaded page modules. Bind to
localhost by default. A public host must later support long-lived Node.js processes and persistent
disk; a static page or a short-lived serverless function alone is insufficient.

### 3. Runtime configuration

| Setting                        | Default             | Contract                                                                                     |
| ------------------------------ | ------------------- | -------------------------------------------------------------------------------------------- |
| Channel count                  | 32                  | Integer from 1 to 256                                                                        |
| Sample rate                    | 4,000 frames/second | Integer from 1 to 100,000; equivalent to samples/second/channel                              |
| Seed                           | 42                  | Integer from 0 to 2,147,483,647                                                              |
| Outstanding sample-data budget | 4 MiB               | Configurable from 4 KiB to 64 MiB                                                            |
| Duration                       | Until stopped       | Zero means no configured duration limit; a positive finite duration supports repeatable runs |
| Recorder delay                 | 0 ms                | Explicit diagnostic-only setting for controlled overload tests                               |

These are input-validation bounds, not throughput promises for every combination. The default
workload must pass nominal testing. Unsupported throughput is handled through the documented
overload behavior, not a false guarantee of lossless acquisition.

Validate all fields before starting children or allocating recording data. Reject unknown fields,
missing option values, nonfinite numbers, fractional values for integer settings, and unsafe index
arithmetic. Document all CLI options. The UI need expose only channel count, sample rate, seed, and
optional duration; technical buffer and fault controls can remain in the diagnostic workflow.

There is no run-duration-dependent in-memory collection. Available disk space and the supported safe
integer index range are finite practical limits, and must be stated. Never wrap or silently round an
index after it exceeds the supported range.

### 4. Deterministic waveform

Use the initial prototype's triangle carrier with a smaller, faster triangle modulation. The signal
is illustrative rather than a simulation of a particular medical or industrial device. Amplitudes
are normalized values, not calibrated volts.

The format documentation must define the waveform independently of source code. The following
mathematical definition captures the prototype decision:

- Let n be the nonnegative original frame index, c the zero-based channel, r the sample rate, and s
  the seed.
- Let P be the greater of 8 and round(r / (2 + 0.37c)). Let Q be the greater of 4 and round(P / 7).
- Let phase A be ((n mod P) + ((97c + s) mod P)) mod P.
- Let phase B be ((n mod Q) + (s mod Q)) mod Q.
- Define triangle(p, L) as 1 − 4 × absolute(p / L − 0.5).
- The stored value is float32-round(0.8 × triangle(A, P) + 0.12 × triangle(B, Q)).

Use IEEE-754 double-precision intermediate operations in the stated order, nonnegative remainder,
positive half-up rounding for the period calculations, and one final conversion to float32. Publish
a short set of independently checked reference values with the format specification. Store the
waveform identifier/version and seed in metadata. Unknown waveform versions must fail validation
explicitly.

Validation compares the expected rounded float32 value with the stored float32 value exactly.
Nonfinite values are incorrect. There is no arbitrary numeric tolerance that can conceal corruption.

### 5. Source pacing and bounded transport

- Use a monotonic clock for elapsed acquisition time. Wall-clock time is used only for the
  human-readable start timestamp.
- Calculate the number of frames due from elapsed time multiplied by configured sample rate. Do not
  implement one timer per sample or accumulate timing by repeatedly adding an assumed timer
  interval.
- Wake approximately every 5 ms and send bounded batches targeting about 10 ms of signal. Cap each
  batch by both the configured byte budget and a fixed frame-count limit.
- If a timer wakes late, account for the actual elapsed source interval. Retain original indices and
  report scheduling lag. A general-purpose operating system does not provide hard real-time
  guarantees.
- Use Node.js child-process IPC with binary-capable serialization and explicit byte credits.
- Sending a batch consumes credits equal to its binary record bytes. Return those credits only after
  the recorder has completely written that batch. An IPC send callback is not a persistence
  acknowledgement.
- When credits are insufficient, advance the source timeline and drop newly due frames. Never block
  the source, shift timestamps, or keep a duration-growing backlog.
- Report scheduled frames, successfully offered/emitted frames, dropped frames, and persisted frames
  separately. Advancing a schedule counter is not evidence that samples were delivered.
- Retain no unbounded generator-side queue. Bound/coalesce control messages and telemetry too; a
  bounded sample buffer with an unbounded status-message queue is insufficient.
- The 4 MiB budget bounds application sample bytes in flight, including the batch being written.
  Serialized copies, operating-system buffers, and runtime memory are additional bounded overhead;
  do not describe the budget as a bound on total RSS.
- With default 136-byte records and no recording progress, 4 MiB represents approximately 7.7
  seconds of data. This is a capacity calculation, not a promise that every stall of that length is
  lossless.

### 6. Recording lifecycle and failure behavior

Acquisition states are idle, starting, recording, stopping, completed, and failed. Starting another
acquisition while one is starting, recording, or stopping returns a conflict. Stop is idempotent.

Create initial metadata before generation begins. Record frames through serial, short-write-safe
disk writes. Never acknowledge unwritten bytes. Detect gaps from original frame indices and append
lost intervals to a streaming loss log; keep only counters and first positions in memory.

Each lost interval records its start frame, exclusive end frame, frame count, scalar sample count,
and the known cause. Loss during an intentional buffer-exhaustion experiment must not be confused
with a disk I/O failure or unknown crash damage.

On Stop, SIGINT, or SIGTERM:

1. Stop the source schedule and establish its final expected frame extent.
2. Deliver the final extent after all previously offered data messages, using reliable ordered
   control delivery.
3. Drain accepted recorder batches.
4. Account for trailing missing frames against the final expected extent.
5. Flush/sync recording data and loss information, finalize metadata, and close file handles and
   children.
6. Report completion only when the finalization succeeds.

The user sees stopping while draining. If a child dies, IPC fails, or disk operations fail,
transition to failed and preserve the readable prefix. Do not wait forever on a dead child; use a
documented bounded shutdown timeout, with failure clearly reported if graceful draining cannot
finish.

A completed recording means clean finalization, not successful verification. A completed recording
with accounted overload loss remains completed but visibly degraded. An unexpected termination
without final source extent leaves completeness unknown and cannot earn an integrity PASS.

Power-loss transactional durability and automatic crash repair are not promised. Metadata
replacement should be atomic where supported; the README must distinguish clean-stop syncing from
stronger hardware durability guarantees.

### 7. Storage format and metadata

Use a versioned recording bundle containing a binary frame stream, a human-readable JSON metadata
sidecar, an append-only loss log, and optional measurement/verification artifacts. Their association
is unambiguous through the bundle and recording identifier.

Each physical frame record contains:

| Byte offset | Width                 | Meaning                                       |
| ----------- | --------------------- | --------------------------------------------- |
| 0           | 8 bytes               | Unsigned original frame index, little-endian  |
| 8 + 4c      | 4 bytes per channel c | IEEE-754 float32 channel value, little-endian |

Record width is 8 + 4C bytes for C channels. Records are frame-major, with channels in ascending
zero-based order. Original indices are nondecreasing. Repeated adjacent indices are preserved as
duplicated observations; decreasing indices are malformed order and must cause validation failure.
Readers must not silently interpret a file known to violate the ordering invariant as a valid
searchable recording.

Required metadata includes:

| Category       | Fields and semantics                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Identity       | Format identifier/version, recording ID, optional display name                                                |
| Signal         | Channel count, sample rate per channel, seed, waveform identifier/version                                     |
| Numeric layout | Value type, four-byte width, byte order, index width, record width, channel ordering                          |
| Time           | UTC acquisition start timestamp, optional stop timestamp, duration from expected frame extent and rate        |
| Counts         | Expected frame extent, recorded physical frame count, recorded scalar sample count, known dropped frame count |
| Lifecycle      | Recording, completed, or failed; failure reason when applicable                                               |
| Evidence       | Configuration, final generator metrics, buffer high-water mark, measured memory summary when available        |

The expected frame extent is the exclusive end of the acquisition timeline, not the number of
records found on disk. Keep it independently so trailing loss can be detected. Unknown final extent
and duration are explicitly unknown rather than inferred as complete from the last retained record.

At default settings, each record is 136 bytes, and the binary stream grows by 544,000 bytes per
second. A lossless one-hour recording contains 14,400,000 frames, 460,800,000 scalar samples, and
**1,958,400,000 bytes** of frame records: approximately **1.9584 GB / 1.824 GiB**, excluding
sidecars. The scalar values alone occupy 1,843,200,000 bytes; the difference is frame identity
overhead.

Float32 gives compact binary storage and exact comparison after deterministic rounding. JSON/CSV as
primary storage would add parsing and size overhead; float64 doubles value payload size without a
requirement for that precision; databases add setup without replacing local recording;
channel-blocked layouts improve subset I/O but complicate append and interruption handling. CSV
remains an export format.

For a truncated binary stream, complete-record count is the file size divided by record width,
rounded down. Readers may use the intact prefix but must report trailing partial bytes. The partial
final record is not treated as a valid frame. Verification fails if partial bytes, metadata
contradictions, or unconfirmed completeness remain.

### 8. Retrieval contract

- Metadata inspection works without reading the complete frame stream.
- Intervals are half-open: start is included and end is excluded.
- A frame at index n belongs to time interval [a, b) when a ≤ n/r < b. Convert time bounds to frame
  bounds using ceil(a × r) and ceil(b × r).
- Reject negative, nonfinite, inverted, or conflicting time/index bounds. Valid ranges beyond the
  known end return their available intersection; a start at or beyond the end returns an empty
  result.
- Channel indices are zero-based. Preserve requested channel order. Reject duplicates, an empty
  selection, and out-of-range indices. Omission means all channels.
- Binary-search physical records by their stored original frame indices. Multiplying the requested
  original index by record width is invalid when earlier frames are missing or duplicated.
- Range location takes O(log N) index probes for N physical records, followed by sequential reads of
  the matching records. An individual seek does not scan the complete recording.
- Read in reusable chunks targeting 64 KiB. Stream raw retrieval and export; materialize only
  explicitly bounded UI windows.
- Frame-major storage reads unselected channel bytes inside the requested interval. Document
  approximate value read amplification C/K for K selected channels, plus index overhead. Do not
  claim physically channel-selective reads.
- Raw retrieval retains every stored observation and its original index, including duplicates.
  Missing frames remain absent and are identifiable by gaps; do not fill them with zeros or
  interpolated values.
- JSON-lines output carries each original frame index and values in selected order. CSV export
  includes original frame index, time in seconds, and selected channel headings. Exports stream with
  backpressure; they never throttle the acquisition source.

### 9. Playback contract

- Playback operates on finalized recordings or an explicitly selected readable incomplete prefix.
  Incomplete data remains visibly incomplete; default playback is for finalized recordings.
- Support 1× native speed and configurable speeds from 0.1× to 8×. The UI offers convenient presets
  including 0.25×, 0.5×, 1×, 2×, and 4×. Slower/faster means forward playback at different speeds,
  not reverse playback.
- Define position as the next original frame index to be emitted. Derive the due position from a
  monotonic anchor, elapsed active time, recorded sample rate, and playback speed.
- Emit every available selected sample through the playback engine's output contract. The browser
  waveform receives a separately decimated preview; moving only a playhead is not playback.
- Bound each output batch and each catch-up interval. If a full-data consumer cannot keep up,
  preserve position/data and expose growing lag or suspend explicitly; do not claim native timing
  while silently dropping samples.
- Pause takes effect at an emission boundary. Already emitted frames are committed to position
  before an asynchronous read can be interrupted. No frames are emitted after pause acknowledges,
  and resume starts at the next un-emitted position.
- Seek changes position, invalidates pending reads/output from the prior position, and resets the
  clock anchor. Seeking while paused does not start playback. Seeking while playing continues from
  the new position.
- Reject seeks outside the known playable timeline; seeking exactly to the end is valid and leaves
  playback ended.
- Changing speed preserves the current next position and resets the anchor. Changing channel
  selection invalidates stale output without skipping or replaying the timeline.
- Preserve missing time intervals as gaps. For adjacent duplicate observations, playback emits the
  first observation for that index and reports the skipped duplicate count; raw retrieval and
  validation preserve all observations.
- Report emitted frame/sample counts, timeline position, active elapsed time, speed, current lag,
  and maximum observed lag. Exclude paused time and reset segment comparisons after seeks or speed
  changes.
- At end of recording, emit the final available frame once, stop the timer, and expose ended state.
  Repeated play at end does not loop implicitly; replay is an explicit restart action.

### 10. Streaming verification contract

The validator physically scans the recording in bounded chunks; it does not use the sorted seeking
assumption to skip data. It retains counters, the preceding observed index, expected next index, and
the first discrepancy of each class. It never materializes the full recorded or expected signal, or
accumulates an unbounded error list in memory.

Report:

| Result field       | Meaning                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Expected           | Expected scalar samples from the independent final source extent, or unknown                                       |
| Recorded           | Scalar observations in complete physical records                                                                   |
| Missing            | Expected scalar samples absent from the observed timeline                                                          |
| Duplicated         | Additional scalar observations at an already represented adjacent frame index                                      |
| Incorrect          | Stored scalar values differing from the deterministic float32 expectation                                          |
| First positions    | First frame/channel location for each discrepancy class; duplicate physical record ordinal where useful            |
| Format errors      | Invalid metadata, unknown versions, impossible indices, decreasing order, count contradictions, or partial records |
| Execution evidence | Validation elapsed time and measured memory                                                                        |
| Result             | PASS only when all integrity/format checks pass and final extent is confirmed                                      |

For a missing whole-frame interval of length L, increment missing samples by L × channel count. A
duplicated whole frame contributes channel count duplicated samples. An incorrect scalar contributes
one incorrect sample. If a duplicate also contains incorrect values, both counters increase; classes
are diagnostic and not mutually exclusive.

Check for missing frames at the beginning, middle, and end. Use independent final expected extent
for the trailing check. Validate count/duration/layout consistency before reporting success.
Decreasing order or an invalid frame index is a structural failure; do not invent precise
missing/duplicate classifications for an order-corrupted stream whose identity cannot be trusted.

Return exit code 0 for PASS, 1 for a completed verification that fails integrity or format checks,
and 2 for invocation or operational failures that prevent a report. UI results must distinguish a
failed integrity check from an inability to run verification. Malformed inputs must terminate with a
useful message rather than hang or allocate based on unchecked metadata.

Run UI-triggered verification in a child process so CPU-intensive checking cannot block the
application event loop. Report bounded progress updates and allow only one such job at a time. A
prior PASS is valid for the file state that was checked; if size or modification identity changes,
mark that result stale.

### 11. Application operations

These contracts describe the intended service boundary; route names are implementation details and
are not mandated here.

| Operation           | Input                                                   | Output / behavior                                                                       |
| ------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Get workbench state | None                                                    | Active acquisition, playback, verification, and connection state                        |
| Start acquisition   | Valid configuration and optional display name           | Recording identifier; starting state; conflict if another acquisition owns the recorder |
| Stop acquisition    | Active recording identifier                             | Stopping acknowledgement; final completion/failure arrives separately                   |
| List recordings     | Bounded page/cursor                                     | Metadata summaries and verification status; no binary scans                             |
| Inspect recording   | Recording identifier                                    | Metadata, physical size, complete-record count, partial-tail warning                    |
| Retrieve/export     | Recording identifier, interval, channels, output format | Streamed raw observations or CSV; bounded preview is a distinct operation               |
| Open playback       | Recording identifier                                    | Playback metadata and initial paused position                                           |
| Control playback    | Play, pause, seek, speed, or selected channels          | Updated state; invalid inputs leave prior state intact                                  |
| Start verification  | Finalized recording identifier                          | Job state and bounded progress, then structured result                                  |
| Read events         | Local event subscription                                | State, metrics, preview, completion, verification, and error events                     |

Use ordinary HTTP requests for commands and Server-Sent Events for browser updates; collaborative
editing protocols are unnecessary. A full-data playback sink is a separate contract from preview
events. Coalesce previews/telemetry to the most recent value. Bound each client's outgoing buffer
and disconnect a slow client when necessary. Reconnection refreshes current state rather than
replaying an unlimited event history.

Invalid arguments return a client error with a specific message, unknown recordings return not
found, incompatible active state returns conflict, and operational failures return an error without
a false completion state. Basic local path validation and escaping remain appropriate even though
enterprise security is out of scope.

### 12. Interface and demonstration

The workbench has three primary destinations: **Acquire**, **Recordings**, and **Verify**. Playback
lives within a selected recording rather than becoming a separate disconnected product.

| Surface          | Required content and interactions                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Acquire          | Configuration, Start/Stop, elapsed time, channel selection, large waveform plot, actual recording and buffer metrics                  |
| Recordings       | Bounded/paginated list, configuration and time summaries, completion/loss status, open recording action                               |
| Recording detail | Metadata, waveform window, exact range/channel selection, CSV export, play/pause, speed, seek, verification action                    |
| Verify           | Expected/recorded counts, separate discrepancy counts, first positions, format errors, duration, downloadable machine-readable result |

Visual direction: consistent graphite/dark surfaces, subtle grid divisions, strong readable type,
monospaced numeric telemetry, a restrained primary action accent, and stable distinct channel
colors. Color must not be the only indication of success or failure. Avoid decorative fake
measurements, marketing sections, excessive animation, or unreadable terminal effects.

Use Canvas for traces with a fixed-size rolling window and decimation bounded by display width and
selected channels. Prefer a min/max envelope when reducing dense windows so narrow peaks are not
concealed. Label previews as decimated; the stored signal retains full fidelity. Do not feed every
raw sample through React state.

Show only a manageable initial channel subset, while making every configured channel selectable.
Provide clear units, original index/time context, channel labels, and a distinction between
normalized amplitude and physical units. Never label an unknown unit as volts.

Buttons and controls have disabled/busy states, visible focus, text labels or accessible names, and
keyboard operation. On smaller screens, controls and metrics reflow without clipping or obstructing
the primary waveform and Stop control. Empty states explain the next action; failures show the
actionable cause. Disconnection must not look like frozen successful acquisition.

The demonstration sequence is: configure → capture → observe real metrics → stop and finalize →
select a recording → retrieve/export a range → play/pause/seek/change speed → verify clean data →
verify an isolated damaged fixture. The fixture operation never mutates an existing user recording.
Capture a short video only after the workflow is working; narration claims must match measured
results.

## Testing Decisions

### Primary test boundary

Prefer black-box tests at the **command-line workflow plus resulting recording**. Launch the actual
generator/recorder processes, wait for completion, inspect metadata, retrieve selected values, and
run the actual verification command. This exercises timing, process isolation, transport,
persistence, and validation together instead of asserting private queue implementation details.

Use Node.js's built-in test runner and temporary recording directories. Test observable data,
counts, positions, lifecycle, exit codes, and memory evidence. Tests must not merely invoke the same
encoder and decoder and assume their agreement proves correctness: include independently calculated
small fixtures/reference values and deliberate physical-file corruption.

The workspace currently has no executable tests or established testing framework. The existing
acceptance-scenario document supplies planned cases, not proven prior art. The user explicitly
approved this command-line-first testing approach, with a small browser suite, during specification
synthesis.

### Additional boundaries only where necessary

- Playback requires a focused test at its public control/output interface to exercise pause during
  reads, seek during playback, speed changes, and stale callback cancellation. Use a collecting
  bounded test sink and observable emitted frame identities; avoid inspecting timers or internal
  state.
- Add a small browser end-to-end suite against the local application for configuration, start/stop,
  selecting a recording, playback controls, export, verification results, empty/error states, and
  keyboard usability. Backend correctness remains covered primarily by the command-line tests.
- Inspect the final UI visually at desktop and a smaller viewport. Visual review supplements
  behavioral tests; it cannot prove acquisition correctness.

### Required acceptance matrix

| ID  | Scenario               | Passing observation                                                                                                                                                   |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Default nominal run    | All expected values persisted; verification reports zero missing, duplicated, incorrect, and format errors                                                            |
| A02 | Runtime configuration  | At least two nondefault channel/rate combinations pass without source changes                                                                                         |
| A03 | Determinism            | Known channel/index values match independent references; repeated access is identical                                                                                 |
| A04 | Process separation     | Generator and recorder have different process IDs and independently observable lifecycles                                                                             |
| A05 | Source timing          | Compare actual emitted counts with monotonic elapsed time; report endpoint error and batch timing deviations                                                          |
| A06 | Bounded overload       | Delayed/stalled recorder fills but never exceeds the configured sample-data budget; source timeline continues; lost intervals and scalar counts agree with validation |
| A07 | Recovery               | Resume recorder progress after a stall; later frames retain original indices and gaps are preserved                                                                   |
| A08 | Graceful interrupt     | Interrupt mid-run; accepted bytes drain; final extent and metadata agree; saved data remains readable                                                                 |
| A09 | Fatal failure          | Recorder/generator death or disk failure produces failed state, bounded shutdown, and no false PASS                                                                   |
| A10 | Truncated tail         | Reader exposes complete prefix and partial-byte warning; validator fails and diagnoses the tail                                                                       |
| A11 | Metadata               | Required fields, byte size, frame/sample counts, and duration reconcile                                                                                               |
| A12 | Range boundaries       | Beginning/middle/end, empty ranges, fractional times, and out-of-range cases follow the declared contract                                                             |
| A13 | Channel subsets        | Noncontiguous selections preserve requested order; invalid/duplicate selections are rejected                                                                          |
| A14 | Gap-aware seek         | A query after missing or duplicate frames finds the correct original indices without a full scan                                                                      |
| A15 | Export                 | CSV and JSON-lines represent the requested actual observations and stream within bounded memory                                                                       |
| A16 | Native playback        | Complete selected frame sequence is emitted at 1×; actual pacing/lag is recorded                                                                                      |
| A17 | Variable speed         | At least 0.5× and 2× playback produce the expected sequence and observed timing ratio                                                                                 |
| A18 | Pause/resume           | Pause at arbitrary emission/read boundaries; no subsequent output until resume; no skipped or repeated frame                                                          |
| A19 | Seek/speed races       | Commands during pending reads do not leak output from the previous position/selection                                                                                 |
| A20 | Playback gaps/end      | Gaps preserve elapsed signal time; duplicates follow policy; final frame is emitted once                                                                              |
| A21 | Missing fixture        | Exact missing count and first position for initial, interior, and trailing losses                                                                                     |
| A22 | Duplicate fixture      | Exact duplicated count and first position for adjacent repeated records                                                                                               |
| A23 | Incorrect fixture      | Exact incorrect count and first frame/channel, including a nonfinite value                                                                                            |
| A24 | Combined fixture       | Missing, duplicate, and incorrect classes remain separately reported in one recording                                                                                 |
| A25 | Malformed input        | Bad versions/counts/order/indices yield explicit failure without hangs or large unchecked allocations                                                                 |
| A26 | Exit status            | PASS, integrity failure, and invocation/operational failure follow the documented exit-code contract                                                                  |
| A27 | Browser isolation      | Throttle/disconnect browser updates during acquisition; source/recorder continue with no browser-induced sample loss                                                  |
| A28 | UI workflow            | Acquire, stop, inspect, retrieve/export, playback, and verify work through visible controls                                                                           |
| A29 | Verification isolation | Validation runs without blocking controls or becoming a dependency of source pacing                                                                                   |
| A30 | Clean launch/handoff   | A fresh dependency install and documented start command run successfully; README results are reproducible                                                             |

### Sustained measurements

Run short correctness checks first, then target a **one-hour acquisition at default settings** as
the principal evidence run. A one-hour run is the agreed engineering target, not a duration
explicitly mandated by the PDF. Save its final verification report and time-series measurements. Do
not commit the roughly 2 GB recording to Git; retain compact evidence and reproducible commands.

Record the platform, CPU, available memory, storage context, Node.js version, configuration, timing
method, run duration, and whether the UI or other heavy work was active. Sample generator/recorder
RSS, queue bytes, high-water mark, emitted/persisted/lost counts, and timing at a fixed bounded
frequency, such as once per second. Stream observations to disk rather than retaining the
measurement history in process memory.

Compare warmup, middle, and late-run memory windows and publish the actual ranges. Justify duration
independence through both fixed resource bounds and observations; a short flat graph alone is not
proof. Report exact binary throughput separately from optional logs and filesystem allocation.
Measure retrieval/seek near the beginning, middle, and end of the long file, and report
native/slower/faster playback timing with paused intervals excluded.

The binary acceptance condition for the nominal run is zero sample loss and a clean verification
PASS. Timing and UI responsiveness results must state what was achieved; the assessment does not
supply a numerical jitter or frame-rate threshold, and the submission must not invent one as a
quoted requirement. If the target sustained run cannot be completed, disclose its actual duration
and the unmet target.

## Out of Scope

- Supabase, cloud databases, authentication, accounts, organizations, permissions administration,
  billing, and enterprise audit systems.
- Yjs, collaborative editing, shared cursors, multi-user synchronization, and multiplayer features.
- Distributed acquisition, clusters, microservices, message brokers, and horizontal scaling.
- Real hardware drivers, clinical interpretation, physical-unit calibration, or claims that the
  waveform represents a particular instrument.
- Lossless behavior under an indefinitely stalled consumer or exhausted disk. Nominal losslessness
  and precise overload accounting remain mandatory.
- Hard real-time guarantees on a general-purpose operating system.
- Unlimited in-memory buffers, automatic infinite disk spooling, and silent loss concealment.
- Reverse chronological playback, waveform editing, DSP analysis suites, spectral analysis, and
  annotation tools.
- Compression, a columnar storage engine, or physically reading only selected channels. The accepted
  frame-major read cost is documented.
- Automatic repair of arbitrary reordered/corrupted files or recovery of an unknowable final
  acquisition extent. Detection and explicit failure remain in scope.
- Power-loss transactional durability, automatic restart/resume of a crashed acquisition, and
  unverified cross-platform guarantees.
- A public demo as a prerequisite for submission. It is a final optional extension after the local
  deliverable passes.
- Decorative product scope that delays acquisition correctness, testing, documentation, or the
  demonstration.

## Further Notes

### Delivery phases and integration gates

| Phase                           | Deliverable                                                                            | Gate before proceeding                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1. Signal and storage contracts | Configuration, waveform definition, binary layout, metadata, independent tiny fixtures | Known values and an independently interpretable fixture                    |
| 2. Acquisition                  | Real processes, clock pacing, credits, recording, loss logs, shutdown                  | Nominal zero-loss run and a correctly accounted overload run               |
| 3. Verification                 | Streaming validator and corruption fixtures                                            | Every required discrepancy class, trailing loss, and machine result tested |
| 4. Retrieval                    | Metadata, time/index windows, channel subsets, export                                  | Exact values and bounded reads on a longer recording                       |
| 5. Playback                     | Timed output and controls                                                              | Correct sequence across pause/seek/speed changes, measured pacing          |
| 6. Interface                    | Instrument workbench and recording workflow                                            | Real data, responsive preview, browser isolation, visual review            |
| 7. Evidence and submission      | Sustained results, README, video, repository                                           | All mandatory criteria accounted for and limitations disclosed             |

The sustained run can execute while independent UI/documentation work proceeds, provided concurrent
workload is disclosed in the measurement environment. Reserve Monday for fixes, evidence, the
walkthrough, and handoff. Additional AI tools may accelerate independent work, but do not substitute
for integration tests or measured results.

### Assessment traceability

| Assessment area                                     | Spec coverage                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| Signal parameters and determinism                   | Implementation decisions 1, 3, 4; A01–A03                         |
| Section 1: acquisition and recording                | Implementation decisions 2, 5, 6; A04–A10; sustained measurements |
| Section 2: storage format                           | Implementation decisions 4, 7, 8; A10–A15                         |
| Section 3: retrieval and playback                   | Implementation decisions 8, 9, 11; A12–A20                        |
| Section 4: verification                             | Implementation decision 10; A21–A26                               |
| Section 5: optional visualizer, accepted into scope | Implementation decision 12; A27–A29                               |
| Deliverables and required Node.js/React stack       | Solution, implementation decisions 1–2, delivery phases, A30      |

### README and repository handoff

The final repository must contain build/run instructions and dependencies; development and measured
platform details; architecture/process/data-flow explanation; independently implementable format and
waveform specifications; overload, interruption, and partial-file behavior; command/API semantics;
measured performance and memory with methods and durations; verification output from at least one
completed run; significant decisions and rejected alternatives; known limitations; and next work if
additional time were available.

Include a concise local demo walkthrough and the video or an accessible video link. Publish a GitHub
repository link as the assessment deliverable. Public-site hosting is distinct from publishing
source and does not replace the repository requirement.

### Current implementation and publication status

Initial drafts exist for signal/configuration, generator, recorder, storage, retrieval, playback,
verification, and a CLI. There is no frontend, installed project manifest, executable test suite,
completed benchmark evidence, or confirmed end-to-end run at the time of this specification.
Existing drafts must be reconciled with these contracts, particularly interrupted playback position,
input validation, lifecycle failures, and verification result semantics; draft code is not
acceptance evidence.

This specification supersedes unresolved-question wording in the earlier planning notes. The user
accepted the recommended architecture, overload policy, storage trade-off, local-first delivery, and
interface direction. New detail here makes those decisions executable; it is not an additional
request for a design interview.

The configured issue tracker is GitHub Issues in **GowthamTG/anthriq**, a private repository
approved by the user. This specification is ready for implementation under the **ready-for-agent**
triage role. The user approved the default five-label vocabulary, a root AGENTS instruction
document, and the existing single-context glossary/ADR layout.
