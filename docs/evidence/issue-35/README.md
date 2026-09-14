# Issue #35 — persisted live-preview provenance

The evidence harness starts real generator and recorder processes, subscribes two noncontiguous
channels, and captures the recording, stopping, completed, completed-with-loss, and readable
failed-prefix lifecycle states. It reads `frames.bin` directly with `Buffer` and does not call the
production storage reader, waveform function, or preview decimator.

For every displayed bucket, the harness independently finds the physical records in its half-open
original-frame interval, recomputes each channel's float32 minimum and maximum, and asserts exact
equality. It also checks that every member belongs to the snapshot-confirmed persisted prefix and
reports physical and visible gaps separately. The overload scenario contains both physical and
visible loss.

Run the repeatable check with:

```sh
npm run evidence:preview -- --output docs/evidence/issue-35/result.json
npm run evidence:validate -- docs/evidence/issue-35/result.json docs/evidence/issue-35/result.schema.json
node --test tests/preview-evidence.test.mjs
```

Generated recording bundles stay beneath ignored `recordings/`. The committed
[`result.json`](result.json) is a `SCOPE-PREVIEW-EVIDENCE/1` report from the local evidence run. Its
committed structure is declared by [`result.schema.json`](result.schema.json); the focused test also
asserts the required five-state shape while the harness fails before writing any false PASS.

A final disk write can complete after the last coalesced status message. Such persisted frames are
not invented as current preview values: `unavailablePersistedFrameRange` records their half-open
range and reason, while `null` means the displayed preview reached the snapshot's persisted extent.
