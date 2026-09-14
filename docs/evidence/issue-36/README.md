# Issue #36 — adversarial browser-isolation evidence

The harness runs six otherwise identical five-second acquisitions at 32 channels and 4,000 frames
per second: no observer, one normal browser, a stalled SSE reader, same-session reconnect churn,
eight observers, and a browser that blocks its main thread for 200 ms every 400 ms.

`SCOPE_EVIDENCE_MODE=1` enables a localhost-only diagnostics response containing observer counts,
socket writable lengths, disconnect accounting, and server RSS. The route returns 404 in normal
operation. Acquisition samples and diagnostics are streamed to `measurements.jsonl`; Chromium is
launched with precise memory information so browser heap measurements are not the default rounded
placeholder.

Run the evidence with a production build and installed Playwright Chromium:

```sh
npm run build
npm run evidence:browser-stress -- --output-directory docs/evidence/issue-36
npm run evidence:validate -- docs/evidence/issue-36/summary.json docs/evidence/issue-36/summary.schema.json
```

[`summary.json`](summary.json) records a PASS for all six cases, with zero recorded loss and exact
source/persistence extents. Its timing tolerances are explicitly project evidence thresholds, not
requirements quoted from the assessment. [`measurements.jsonl`](measurements.jsonl) retains the
bounded-frequency raw observations.

The first stalled-reader run found that a write could transiently exceed the documented 64 KiB
ceiling before the next tick disconnected it. That 87,562-byte failure is retained in
`failed-buffer-bound-summary.json` and its raw measurements. Issue #43 changed the server to check
the pending bytes plus the next event before writing; the replacement matrix stays below the bound.
