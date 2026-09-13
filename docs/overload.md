# Bounded overload and recovery

The source owns the monotonic acquisition timeline. It encodes only batches covered by current byte credits, debits credit before offering a batch to IPC, and drops newly due frames when the next batch cannot fit. It continues advancing original positions; it neither queues an unlimited backlog nor waits for the recorder to catch up. Batch granularity can leave a few unused bytes: the byte budget is a ceiling, not a promise to fill every byte.

The recorder returns a batch's credit only after every byte has been written, including serial short writes. Queued, in-flight and currently written payloads therefore share the same credit budget. Credit IPC callbacks do not grant persistence credit. Returns are accumulated into one pending numeric counter and at most one outstanding credit send, preventing an accumulation of tiny control messages when the source is temporarily unable to receive.

## Explicit temporary stall

`stallForMs` defaults to zero (off); an integer 1–5,000 pauses one write for that duration. `stallAfterSeconds` is the earliest onset, 0–86,400 seconds after the recorder receives source-start acknowledgement. The first batch reaching the write stage at or after that onset triggers the stall. The recorder keeps receiving bounded data and source telemetry while awaiting the timer, then automatically resumes writes. No source rate, frame indices or values change. Timer scheduling and OS load affect the exact onset and exact number of dropped frames.

The browser exposes these fields and the byte budget under **Overload diagnostics**. Settings are saved in metadata. An onset beyond the acquisition is simply not reached (`scheduled`); nothing is injected silently. The existing per-batch `writeDelayMs` remains separate and does not automatically recover. Normal Stop still drains accepted data; T04's ten-second shutdown limit applies to a diagnostic backlog too. If it expires the outcome is failed, not completed-with-loss.

## Counters and units

| Measurement | Meaning |
| --- | --- |
| Scheduled frames | Original timeline extent processed by the latest source tick; may lag the clock between ticks |
| Offered to IPC | Frames actually encoded and submitted for transport; not a disk-persistence claim |
| Persisted frames | Complete frames written by the recorder |
| Lost at source | Newly due frames dropped because transport credit was insufficient |
| Scalar values | Corresponding frame count × configured channels |
| Emission deficit | Clock-derived due extent minus actually offered frames; includes loss and current tick lag |
| Last interval offered frames/s | Change in offered count divided by measured time between source metric snapshots; it is not the scheduled rate |
| Longest emission gap | Maximum observed time between batch offers, including ongoing time since the last offer |
| Timeline offset | Processed extent minus clock-derived due extent; zero alone does not establish output throughput |
| Source tick lag | Largest due-minus-processed extent at a tick, expressed in milliseconds |
| Uncredited sample bytes | Source-side bytes offered but not yet credited back, including IPC, recorder queue/write work and credit-return latency |
| Recorder queue | Bytes received and not fully written; includes the current write |

Source status is coalesced with one unacknowledged snapshot at a time, nominally every 250 ms. Recorder status is coalesced at 100 ms; the owner acknowledges independently of browser delivery. The browser receives at most ten updates per second and stalled subscriptions close. Disk metrics are streamed about once per second plus a final row, so a short event can occur between logged snapshots. Source and recorder observations are asynchronous; reconcile their final counters, not unrelated live snapshots.

## Loss intervals and completion

For each incoming original frame index, the recorder compares it with the next expected position, initially zero. A gap before the first frame covers initial loss; subsequent gaps cover interior loss. The independent final source extent closes any missing tail. Each interval is streamed to `losses.jsonl` with `startFrame`, `endFrameExclusive`, frame/scalar counts and `cause: bounded transport exhausted`. No growing array of intervals is kept in the recorder. Initial loss is not normally produced by the current policy because the source starts with a full credit budget.

At clean completion, offered equals persisted, and persisted plus dropped equals final expected extent. A lossful recording is still `status: completed` if accepted writes and metadata finalized correctly, but the UI labels it **Completed with loss**, and inspection warns that it is not lossless. Loss does not become a fabricated value or an independently verified PASS. A process/disk failure remains `failed`; unconfirmed extent remains unknown.

## Memory and evidence

The configured budget bounds logical uncredited **frame payload bytes**. It is not a bound on total RSS: JS objects, serialized/decoded copies, runtime/Next/browser memory, file buffers and OS pipes have additional overhead. Recorder queue and source uncredited-byte high-water marks are measured independently, alongside current/peak process RSS. Counters, bounded previews, coalesced controls and a credit-bounded queue remain in memory; loss and metric histories stream to files.

`tests/overload.test.mjs` runs real CLI processes, reconstructs every gap independently from physical frame identities, compares the loss log and scalar totals, checks the byte ceiling, observes a zero-emission interval and recovered throughput, and verifies a missing tail beyond the last persisted frame. Existing nominal tests still require zero loss. The production browser test exercises configuration, stall, loss, recovery, completed-with-loss and inspection. See [T05 evidence](evidence/t05/README.md). These short tests do not replace the one-hour benchmark or establish a platform-independent throughput guarantee.
