# SCOPE/1 recording bundle

A recording is one directory. Its name is the recording ID; the display name is optional metadata and never a path. Every artifact in that directory belongs to the same acquisition. The generated browser IDs are UUIDs; the CLI also permits named directories.

| Artifact | Meaning |
| --- | --- |
| `metadata.json` | UTF-8 JSON identity, settings, waveform/layout version, timestamps, lifecycle, expected extent, recorded counts, and optional diagnostic measurements |
| `frames.bin` | Append-only physical frame records defined below |
| `losses.jsonl` | One JSON object per known missing interval: start frame, exclusive end, frame/sample counts, and cause |
| `metrics.jsonl` | Periodic telemetry written incrementally, not held as a growing in-memory history |
| Future verification result | Belongs to this recording and must identify the checked file state. T03 does not create or consume a persisted PASS result; a prior result cannot establish validity after file changes. |

## Physical record layout

For C channels, each record has width `W = 8 + 4C` bytes:

| Offset | Width | Encoding |
| --- | --- | --- |
| 0 | 8 bytes | Original frame index: unsigned uint64, little-endian |
| 8 + 4c | 4 bytes per channel c | IEEE-754 float32, little-endian; channels 0 through C−1 in ascending order |

Indices are nondecreasing in a searchable recording. An adjacent repeated index represents a duplicated observation and is preserved. Gaps retain the original timeline: physical ordinal k need not equal source index n. Decreasing indices are malformed; metadata-only inspection cannot establish ordering or value correctness, and must not claim it did. Full verification scans the physical stream separately. Read the [waveform reference](waveform.md) for the formula, rounding, and independent byte examples.

At defaults (C=32), W=136 bytes. At 4000 frames/second the frame file grows by **544,000 bytes/second**, or **1,958,400,000 bytes/hour**, excluding sidecars. Scalar float32 values contribute 1,843,200,000 bytes/hour; original frame indices contribute 115,200,000 bytes/hour.

Float32 matches the deterministic rounded signal and keeps storage compact. Float64 would double value bytes without a requirement for that precision. JSON/CSV as primary storage adds size/parsing overhead; CSV remains a later export. A database adds setup without replacing local recording. Frame-major storage makes append, short writes, binary-search seeking, and prefix recovery simple; a channel-subset query still reads unselected channel bytes in its requested frames. Channel-blocked storage would reduce that read amplification but complicate writing and recovery.

## Metadata contract

`format` is `SCOPE/1`; `waveform` is `triangle-modulated-v1`. Numeric layout fields are `sampleType: float32`, `bytesPerSample: 4`, `byteOrder: little-endian`, `recordBytes: W`, and `layout: uint64 frame index, then interleaved channel values`.

Identity fields are `id` and optional `displayName`. Configuration fields are `channels`, `sampleRate`, `seed`, `bufferBytes`, `seconds`, and `writeDelayMs`; their numeric bounds are in the README. Times are `startedAt` and optional `stoppedAt`. `status` is `recording`, `completed`, or `failed`.

`expectedFrames` is the independently confirmed exclusive source extent, or null while unconfirmed. `recordedFrames` is the recorder's physical frame count; `totalSamples` is that count multiplied by channels. `droppedFrames` counts known omitted source frames. A normal finalized recording reconciles recorded plus lost frames to expected extent. `duration` is expected extent / sample rate when known; inspection returns null when extent is unconfirmed, even if an older sidecar contains a stale duration. Requested duration remains in `seconds`.

The recorder creates initial metadata and atomically replaces it at finalization. During acquisition, sidecar counts can lag disk writes. A leftover `recording` lifecycle after process interruption is incomplete evidence, not proof that a process still exists. Inspection reports this limitation and keeps physical and declared counts separate.

## Inspection and readable prefixes

Inspection reads at most 64 KiB of metadata plus a sentinel byte, validates its types/version/layout/rate/counts, and obtains frame-file size using filesystem stat. It never reads the frame payload. Invalid interpretation fields or oversized metadata fail explicitly; safe but contradictory metadata remains inspectable with warnings.

For physical file length L:

- Complete physical records = floor(L / W).
- Readable bytes = complete records × W.
- Partial trailing bytes = L mod W; these are excluded from the readable prefix.

A prefix of complete records is structurally readable, not independently verified. Partial bytes, count/duration contradictions, or declared losses produce `condition: attention`. Non-finalized metadata is `incomplete` unless another warning requires attention. A structurally consistent completed recording is `finalized`; this never means verified or guaranteed lossless.

## Library and service

- `GET /api/recordings?limit=10&cursor=<id>` lists one page. Limit is 1–50, default 10. IDs use ascending lexical order, not timestamp order.
- `GET /api/recordings/:id` inspects one local bundle. Unknown files return 404; malformed interpretation metadata returns 422. The existing `/api/acquisitions/:id` inspection endpoint remains available.
- `npm run cli -- list [root] --limit 10 --cursor <id>` offers the same paging behavior. `inspect <directory>` prints the same physical-prefix and warning fields.

Pagination scans directory names and retains only the smallest limit+1 names after the cursor, then reads at most limit metadata files. Memory is O(page size); directory enumeration is O(number of directories) per request. This avoids a persistent catalog while keeping memory bounded. No binary payload is loaded or scanned. Malformed bundles appear as error entries instead of silently disappearing; unrelated safe-named directories under the recording root likewise appear as unavailable bundles. Symlink directories are not listed.

Paging is a live view, not a frozen snapshot. Newly added IDs before the current cursor appear after returning to First page or refreshing from the beginning. Browser requests are canceled when selection/page changes so stale results cannot replace the current details.
