# T16 long-recording evidence

This directory contains compact, reproducible evidence for retrieval, streamed CSV export, native
playback, transition handling, slow-sink backpressure, and complete verification of the retained T15
one-hour recording. The 1,958,400,000-byte `frames.bin` file is referenced in place and is neither
copied nor committed.

## Reproduce

Keep the Mac awake, stop unrelated UI and development work, then run from the repository root:

```sh
npm run evidence:long-recording -- \
  --recording /Users/gowthamtg/.codex/worktrees/23a4/Anthriq/recordings/t15-sustained-2026-09-14 \
  --workload quiet
npm run evidence:validate-long-recording
```

`--recording` must be absolute and `--workload` must honestly be `quiet`, `development`, or `ui`.
The runner rejects a mismatched recording or T15 platform context before writing a PASS summary. CSV
output is checked and hashed incrementally and is never retained. `measurements.jsonl` is streamed
as observations occur.

## Files

- `summary.json`: configuration, T15 identity, environment, bounds, and measured cases.
- `measurements.jsonl`: once-per-second and progress-boundary RSS observations.
- `verification.json`: compact report produced by the real CLI streaming verifier.
- `*.schema.json`: committed validation contracts.

Retrieval/export timings are observations, not pass thresholds. Playback uses an explicit ±10%
project engineering pacing tolerance; that tolerance is not an assessment requirement.
