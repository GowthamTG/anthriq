# [T01] Launch locally, capture a nominal signal, and inspect the saved result

Published: [GitHub issue #2](https://github.com/GowthamTG/anthriq/issues/2). Publication label: `ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

One documented local command opens a minimal React workbench; Start runs the real default-rate generator and recorder, and Stop produces an inspectable recording. The same narrow workflow works through the CLI.

Scope traceability: user stories 1, 2, 3, 4, 9, 10, 12, 17, 49; acceptance scenarios A01, A04, A08, A28, A30 in the parent specification.

## Acceptance criteria

- [ ] Install a pinned minimal Next.js/React project and a custom local Node.js application service; one documented command launches the workbench after setup, and a browser-free acquisition command remains available.
- [ ] Reuse and reconcile the existing core drafts. Perform only the smallest local prefactoring needed to share lifecycle/configuration contracts; do not create a general service framework or a separate cleanup project.
- [ ] Start a default 32-channel, 4,000-frame/second acquisition using distinct generator and recorder OS processes. The source uses elapsed monotonic time, not an as-fast-as-possible loop.
- [ ] Expose starting, recording, stopping, completed, and failed state through commands and bounded state updates. Allow only one active acquisition; return a conflict for a second start and make stop idempotent.
- [ ] Display a graphite Acquire surface with functional Start/Stop, actual elapsed time, recorded frame/sample counts, and an inspectable completion summary. No placeholder health metrics or fake trace data.
- [ ] Persist indexed little-endian float32 frames and initial/final metadata; establish expected final frame extent independently of saved record count. A normal UI/CLI stop drains accepted data before reporting completed.
- [ ] Add Node built-in black-box smoke tests launching the real processes and inspecting a short nominal recording, plus a browser smoke test for Start/Stop. Use independently checked expected values for at least a small fixture.
- [ ] Provide a passing production build, basic automated smoke checks in CI, and current local startup instructions. Document that remaining overload, fault, retrieval, playback, and evidence scenarios are owned by subsequent tickets.

## Blocked by

None (can start immediately).
