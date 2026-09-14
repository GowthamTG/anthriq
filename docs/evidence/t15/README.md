# T15 — sustained zero-loss acquisition and bounded memory

This evidence is produced by the real CLI acquisition path and then checked by the real streaming
verifier. The default command is the agreed one-hour engineering target at 32 channels and 4,000
frames per second; the duration is not presented as a PDF-mandated assessment threshold.

Run the quiet benchmark from a clean, otherwise idle checkout:

```sh
npm run benchmark:acquisition -- --workload quiet
npm run evidence:validate-acquisition -- docs/evidence/t15
```

Use `--seconds N`, `--recording PATH`, `--output-directory PATH`, or `--skip-overload` only for
short diagnostics. The committed `run-summary.json` states whether the full target was achieved. The
binary bundle remains under ignored `recordings/` for T16 and must not be committed.

`metrics.jsonl` is the recorder's bounded-frequency source of truth. The benchmark's progress view
reads only a bounded 64 KiB tail, so acquisition-time monitoring does not accumulate history in
memory. `run-summary.json` compares equal warmup, middle, and late windows. Those RSS observations
are distinct from the fixed 4 MiB transport bound, fixed 4 MiB recorder-queue bound, one-row-per-
second metrics frequency, and 64 KiB verifier chunk size.

The short controlled overload uses an 8 KiB transport and a two-second recorder stall. Its loss
intervals reconcile to the independently declared source extent and to the streaming verifier's
physical missing-sample count. Slow and disconnected browser behavior is incorporated by reference
from [`../issue-36/summary.json`](../issue-36/summary.json), which covers six observer conditions.
The retained local bundles were also passed through the real streaming verifier; the six compact
reports are in `browser-verification.json`. Reproduce that physical identity check while those
ignored bundles remain available with:

```sh
npm run evidence:verify-browser-comparison -- --recording-root recordings/issue-36-<timestamp>
```

Every committed JSON document and every JSONL row is checked against the schemas in this directory.
`losses.jsonl` is intentionally empty for a successful nominal run.

## Measured result on 2026-09-14

The quiet Apple M5 Pro / 24 GiB run achieved the full target. The source scheduled and emitted
14,400,000 frames, the recorder persisted all 14,400,000 frames (460,800,000 scalar samples and
1,958,400,000 frame bytes), and zero frames were lost. Source elapsed time was 3,600.003 seconds;
wall elapsed acquisition time was 3,600.165 seconds. The streaming verifier scanned the complete
1.9584 GB frame file in 4,712 ms with 104,316,928 peak RSS bytes and reported zero missing,
duplicated, or incorrect samples and zero format errors.

The equal five-minute warmup, middle, and late windows had generator mean RSS of 62,848,366,
60,781,836, and 56,329,945 bytes. Recorder mean RSS was 65,650,250, 70,116,812, and 63,542,906
bytes. The late-minus-warmup changes were -6,518,421 generator bytes and -2,107,344 recorder bytes;
there is no observed sustained memory growth. Peak transport/outstanding and recorder-queue usage
were both 8,432 bytes, below their independent 4 MiB ceilings.

The controlled overload independently scheduled 16,000 frames, persisted 8,025, and accounted for
the other 7,975 in one exact loss interval. The recorder recovered after its stall; verification
found exactly 255,200 missing channel samples (7,975 × 32), no duplicates or incorrect values, and
no format errors.
