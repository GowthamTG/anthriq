# SCOPE/1 recording bundle

A recording is one directory. Its name is the recording ID; the display name is optional metadata and never a path. Every artifact in that directory belongs to the same acquisition. The generated browser IDs are UUIDs; the CLI also permits named directories.

| Artifact | Meaning |
| --- | --- |
| `metadata.json` | UTF-8 JSON identity, settings, waveform/layout version, timestamps, lifecycle, expected extent, recorded counts, and optional diagnostic measurements |
| `frames.bin` | Append-only physical frame records defined below |
| `losses.jsonl` | One JSON object per known missing interval: start frame, exclusive end, frame/sample counts, and cause |
| `metrics.jsonl` | Periodic telemetry written incrementally, not held as a growing in-memory history |
| `verification.json` | Versioned streaming-verification report associated with the exact metadata and frame-file state checked. A changed identity, size, or modification time makes it stale. |

## Physical record layout

For C channels, each record has width `W = 8 + 4C` bytes:

| Offset | Width | Encoding |
| --- | --- | --- |
| 0 | 8 bytes | Original frame index: unsigned uint64, little-endian |
| 8 + 4c | 4 bytes per channel c | IEEE-754 float32, little-endian; channels 0 through C−1 in ascending order |

Indices are nondecreasing in a searchable recording. An adjacent repeated index represents a duplicated observation and is preserved. Gaps retain the original timeline: physical ordinal k need not equal source index n. Decreasing indices are malformed; metadata-only inspection cannot establish ordering or value correctness, and must not claim it did. Full verification scans the physical stream separately. Read the [waveform reference](waveform.md) for the formula, rounding, and independent byte examples.

At defaults (C=32), W=136 bytes. At 4000 frames/second the frame file grows by **544,000 bytes/second**, or **1,958,400,000 bytes/hour**, excluding sidecars. Scalar float32 values contribute 1,843,200,000 bytes/hour; original frame indices contribute 115,200,000 bytes/hour.

Float32 matches the deterministic rounded signal and keeps storage compact. Float64 would double value bytes without a requirement for that precision. JSON/CSV as primary storage adds size/parsing overhead; CSV is a streamed derived export. A database adds setup without replacing local recording. Frame-major storage makes append, short writes, binary-search seeking, and prefix recovery simple; a channel-subset query still reads unselected channel bytes in its requested frames. Channel-blocked storage would reduce that read amplification but complicate writing and recovery.

## Metadata contract

`format` is `SCOPE/1`; `waveform` is `triangle-modulated-v1`. Numeric layout fields are `sampleType: float32`, `bytesPerSample: 4`, `byteOrder: little-endian`, `recordBytes: W`, and `layout: uint64 frame index, then interleaved channel values`.

Identity fields are `id` and optional `displayName`. Configuration fields are `channels`, `sampleRate`, `seed`, `bufferBytes`, `seconds`, `writeDelayMs`, `stallAfterSeconds`, and `stallForMs`; older bundles may omit the two temporary-stall fields (off). Their numeric bounds are in the README. Times are `startedAt` and optional `stoppedAt`. `status` is `recording`, `completed`, or `failed`.

An optional `diagnostic` object marks a disposable demonstration bundle. Its fields are `format: SCOPE-DIAGNOSTIC/1`, one of the scenarios `clean`, `missing`, `duplicate`, `incorrect`, or `combined`, the `sourceRecordingId`, and `createdAt`. The marker is validated when present; recordings created before T07 remain compatible without it.

`expectedFrames` is the independently confirmed exclusive source extent, or null while unconfirmed. `recordedFrames` is the recorder's physical frame count; `totalSamples` is that count multiplied by channels. `droppedFrames` counts known omitted source frames. A normal finalized recording reconciles recorded plus lost frames to expected extent. `duration` is expected extent / sample rate when known; inspection returns null when extent is unconfirmed, even if an older sidecar contains a stale duration. Requested duration remains in `seconds`.

The recorder creates initial metadata and atomically replaces it at finalization. During acquisition, sidecar counts can lag disk writes. A leftover `recording` lifecycle after process interruption is incomplete evidence, not proof that a process still exists. Inspection reports this limitation and keeps physical and declared counts separate.

## Inspection and readable prefixes

Inspection reads at most 64 KiB of metadata plus a sentinel byte, validates its types/version/layout/rate/counts, and obtains frame-file size using filesystem stat. It never reads the frame payload. Invalid interpretation fields or oversized metadata fail explicitly; safe but contradictory metadata remains inspectable with warnings.

For physical file length L:

- Complete physical records = floor(L / W).
- Readable bytes = complete records × W.
- Partial trailing bytes = L mod W; these are excluded from the readable prefix.

A prefix of complete records is structurally readable, not independently verified. Partial bytes, count/duration contradictions, or declared losses produce `condition: attention`. Non-finalized metadata is `incomplete` unless another warning requires attention. A structurally consistent completed recording is `finalized`; this never means verified or guaranteed lossless.

## Range retrieval

Retrieval uses half-open original-index intervals or time intervals converted with `ceil(seconds × sampleRate)`. A reader binary-searches stored frame indices by physical ordinal, then streams matching records in reusable approximately 64 KiB chunks. It retains stored gaps and adjacent duplicate indices; neither is interpolated, deduplicated, nor renumbered. Channels are zero-based and returned in requested order; omitted selection means all channels.

The frame-major layout reads every channel value in each matching record even when only a subset is returned. Selecting K of C channels therefore has roughly C/K value-byte read amplification, plus the eight-byte frame index. A non-finalized or unconfirmed bundle is readable only through explicit intact-prefix inspection; its available bound is derived from the last complete stored record and does not claim a final duration.

CSV export streams that same raw selection. Its header is `original_frame_index,time_seconds,channel_<n>...`, with selected channel headings in requested order; `time_seconds` is original frame index divided by sample rate. Empty valid selections contain only this header. JSON-lines retrieval retains `{ index, values }`. Both outputs preserve gaps and adjacent duplicates and never synthesize waveform values.

## Library and service

- `GET /api/recordings?limit=10&cursor=<id>` lists one page. Limit is 1–50, default 10. IDs use ascending lexical order, not timestamp order.
- `GET /api/recordings/:id` inspects one local bundle. Unknown files return 404; malformed interpretation metadata returns 422. The existing `/api/acquisitions/:id` inspection endpoint remains available.
- `npm run cli -- list [root] --limit 10 --cursor <id>` offers the same paging behavior. `inspect <directory>` prints the same physical-prefix and warning fields.

Pagination scans directory names and retains only the smallest limit+1 names after the cursor, then reads at most limit metadata files. Memory is O(page size); directory enumeration is O(number of directories) per request. This avoids a persistent catalog while keeping memory bounded. No binary payload is loaded or scanned. Malformed bundles appear as error entries instead of silently disappearing; unrelated safe-named directories under the recording root likewise appear as unavailable bundles. Symlink directories are not listed.

Paging is a live view, not a frozen snapshot. Newly added IDs before the current cursor appear after returning to First page or refreshing from the beginning. Browser requests are canceled when selection/page changes so stale results cannot replace the current details.

T05 adds optional generator emission-rate/gap/deficit, transport high-water, peak RSS, and recorder-stall observations. These are diagnostics rather than an integrity result; see [counter definitions](overload.md).

## Verification report

`verification.json` uses `format: SCOPE-VERIFICATION/1`. It records the recording ID and check time; recording duration; expected and physical frame/scalar counts; separate missing, adjacent-duplicated and incorrect scalar counts; first frame/channel positions; the duplicate physical ordinal; format-error count and first error; bytes/records scanned; elapsed milliseconds; and current/peak verifier RSS in bytes. Nonfinite stored values are incorrect and appear as JSON strings because JSON has no nonfinite number representation.

The verifier streams all complete physical records in reusable chunks targeting 64 KiB. It retains counters, preceding/next indices, first positions, file identity and one progress snapshot; memory does not grow with recording duration or anomaly count. A wrong duplicate increments both the duplicated and incorrect classes. Unsafe, out-of-extent or decreasing identities invalidate precise discrepancy classification instead of producing invented totals.

The checked state contains `dev`, `ino`, `size`, and `mtimeNs` for both `metadata.json` and `frames.bin`, captured through open handles and checked again before the atomic report replacement. Inspection reports `unverified`, `verified`, `integrity-failed`, or `stale`. Stale reports remain downloadable evidence but cannot establish the current recording's integrity.

CLI exit status is 0 for PASS, 1 for a completed integrity/format FAIL report, and 2 when invocation or operational failure prevents a trustworthy persisted report. Invalid metadata, contradictions, partial records, non-completed lifecycle, and unconfirmed extent are reportable format failures. Missing/unreadable artifacts, concurrent mutation, worker failure, and inability to persist the report are operational failures.

## Disposable integrity scenarios

`POST /api/verification-scenarios` accepts only `sourceRecordingId` and a supported `scenario`. The source must be a completed acquisition, not another diagnostic recording. Creation and verification share the one-job verification owner: another normal or diagnostic verification returns conflict while either creation or scanning is active.

Each scenario is an eight-frame recording generated from the source's signal definition without reading or copying its frame payload. It is built in a hidden temporary directory and atomically renamed before the verification worker opens it. Its source metadata, frames, and prior verification report are never opened for writing. Missing intervals are recorded with the cause `disposable diagnostic scenario`; the report itself still comes only from the physical streaming verifier.

Diagnostic bundles persist in the recordings directory, are visibly marked in library and result views, and are safe for an operator to remove manually. They are not acquisitions, do not prove anything about the source recording's integrity, and provide no editing or repair behavior.
