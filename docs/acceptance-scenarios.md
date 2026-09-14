# Acceptance scenarios

Status: implemented and evidence-backed. The machine-validated source of truth is
[`docs/evidence/t17/traceability.json`](evidence/t17/traceability.json), which maps every scenario
to implementation, tests, committed evidence, a reproduction command, and the demonstration where
applicable.

| ID  | Scenario               | Final observation                                                                                 | Primary evidence                      |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- |
| A01 | Default nominal run    | 14.4 million frames persisted and verified with zero discrepancies or format errors               | `docs/evidence/t15/`                  |
| A02 | Runtime configuration  | Two nondefault channel/rate combinations pass without source changes                              | `tests/configuration.test.mjs`        |
| A03 | Determinism            | Known values match independently calculated float32 references and repeat identically             | `docs/waveform.md`                    |
| A04 | Process separation     | Recorded generator and recorder PIDs are distinct and exit independently                          | `tests/cli.test.mjs`                  |
| A05 | Source timing          | Monotonic one-hour emitted count and timing deviations are reported                               | `docs/evidence/t15/run-summary.json`  |
| A06 | Bounded overload       | Controlled stall respects the byte budget and loss reconciles to the source extent                | `tests/overload.test.mjs`             |
| A07 | Recovery               | Recorder resumes after the stall and later original indices preserve the gap                      | `docs/evidence/t15/run-summary.json`  |
| A08 | Graceful interrupt     | Accepted bytes drain, final extent reconciles, and both child processes exit                      | `tests/cli.test.mjs`                  |
| A09 | Fatal failure          | Child, IPC, disk, and shutdown failures remain bounded and cannot claim completion or PASS        | `tests/failures.test.mjs`             |
| A10 | Truncated tail         | Inspection preserves the complete prefix and verification reports the partial record              | `tests/inspection.test.mjs`           |
| A11 | Metadata               | Required fields, bytes, counts, duration, and physical data reconcile                             | `docs/recording-format.md`            |
| A12 | Range boundaries       | Beginning/middle/end, empty, fractional, and out-of-range selections follow the contract          | `tests/range.test.mjs`                |
| A13 | Channel subsets        | Ordered noncontiguous selections work; duplicate and invalid channels fail                        | `tests/range.test.mjs`                |
| A14 | Gap-aware seek         | Lower-bound probes find original indices around gaps and duplicates without a full scan           | `docs/evidence/t16/summary.json`      |
| A15 | Export                 | CSV and JSON-lines preserve actual observations and stream in bounded memory                      | `docs/evidence/t16/summary.json`      |
| A16 | Native playback        | Complete selected sequence is emitted at measured 1x timing                                       | `docs/evidence/t16/summary.json`      |
| A17 | Variable speed         | 0.25x, 0.5x, 1x, 2x, and 4x preserve sequence within the stated engineering tolerance             | `docs/evidence/t16/summary.json`      |
| A18 | Pause/resume           | Paused time emits nothing; resume continues at the next exact position                            | `tests/playback.test.mjs`             |
| A19 | Seek/speed races       | Acknowledged controls invalidate pending stale output                                             | `tests/playback.test.mjs`             |
| A20 | Playback gaps/end      | Gaps preserve source time, adjacent duplicates follow policy, and the final frame emits once      | `tests/playback.test.mjs`             |
| A21 | Missing fixture        | Initial, interior, and trailing missing counts and first positions are exact                      | `tests/diagnostics.test.mjs`          |
| A22 | Duplicate fixture      | Duplicate scalar count and first physical position are exact                                      | `tests/diagnostics.test.mjs`          |
| A23 | Incorrect fixture      | Finite and nonfinite incorrect values report exact count and first channel                        | `tests/diagnostics.test.mjs`          |
| A24 | Combined fixture       | Missing, duplicate, and incorrect classes remain separate in one physical recording               | `tests/diagnostics.test.mjs`          |
| A25 | Malformed input        | Bad versions, counts, layouts, order, and indices fail without unsafe allocation or invented data | `tests/verification.test.mjs`         |
| A26 | Exit status            | Verification exits 0 for PASS, 1 for completed FAIL, and 2 for operational failure                | `tests/verification.test.mjs`         |
| A27 | Browser isolation      | Slow, stale, disconnected, and excess observers do not cause recorded sample loss                 | `docs/evidence/t13/README.md`         |
| A28 | UI workflow            | Keyboard and pointer workflows cover acquire, inspect, retrieve/export, playback, and verify      | `tests/browser/t14-workflow.spec.mjs` |
| A29 | Verification isolation | Worker-backed verification remains separate from acquisition pacing and responsive controls       | `tests/browser/verification.spec.mjs` |
| A30 | Clean launch/handoff   | Exact remote clone installs, builds, launches, tests, and completes the browser-free CLI workflow | `docs/evidence/t17/rehearsal.json`    |

## Interpretation

Timings are measured observations unless explicitly labeled as project engineering tolerances. The
assessment supplies no numeric jitter threshold and no hard real-time requirement. A frame contains
one sample per configured channel; aggregate sample counts are always labeled separately. Completed
means finalized, while verified PASS is a later independent physical scan.
