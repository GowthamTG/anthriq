# T14 — accessible instrument workflow

Captured from the real local application with:

```sh
SCOPE_CAPTURE_T14_EVIDENCE=1 npm run test:browser
```

The browser suite drives visible controls through acquisition, persisted range inspection, CSV
download, playback, verification, and report download. It also captures actual empty, recording,
stopping, completed, completed-with-loss, failed, integrity-failed, verified, stale, and
disconnected states. Diagnostic recordings remain separate from their source acquisition.

## Representative review set

- `desktop-empty.png`: empty recordings library and recovery action.
- `desktop-recording.png`: live persisted-frame trace and measured acquisition health.
- `desktop-stopping.png`: accepted writes draining before finalization.
- `desktop-completed.png`: finalized recording, explicitly not yet verified.
- `desktop-populated.png`: selected recording with range, export, and playback controls.
- `desktop-completed-with-loss.png`: finalized lifecycle with loss stated independently.
- `desktop-failed.png`: failed acquisition with readable-prefix recovery actions.
- `desktop-integrity-failed.png`: completed verification with discrepancy/format evidence.
- `desktop-verified.png` and `mobile-verified.png`: clean PASS and downloadable report.
- `mobile-stale.png`: saved PASS invalidated by a changed file identity.
- `mobile-disconnected.png`: stale-view warning and disabled acquisition controls.

Screenshots are evidence of visual review, not substitutes for behavioral assertions. The same run
asserts keyboard focus, pressed-state semantics, live status announcements, reduced motion, no
horizontal overflow at 390/768/1440 px, and the integrated reviewer workflow.

## Reviewed result

Reviewed on 14 September 2026 against the production build. All 12 images above were inspected for
overlap, clipping, horizontal overflow, misleading status, and unreachable controls. No visual
defects remained after review.

- `npm test`: 63 passed.
- `SCOPE_CAPTURE_T14_EVIDENCE=1 npx playwright test --reporter=line`: 26 passed.
- `npm run typecheck`: passed.
- `npm run format:check`: passed.
- `npm run build`: passed.
- `npm audit --json`: 0 vulnerabilities across 125 dependencies.
