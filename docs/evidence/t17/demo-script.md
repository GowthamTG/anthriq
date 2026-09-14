# T17 demonstration script and shot list

Target: 5-7 minutes, 1920x1080, owner narration, visible pointer, clean microphone audio. Use the
production build with an isolated `SCOPE_RECORDINGS_DIR`. Hide notifications and unrelated windows;
never show tokens, account settings, or private messages.

## 00:00-00:35 - Purpose and real configuration

Show the Acquire view and configuration fields.

> This is SCOPE, a local Node.js and React signal-acquisition workbench. The default workload is 32
> channels at 4,000 frames per second, or 128,000 scalar samples each second, with deterministic
> seed 42. A frame contains one value for every channel. The settings are runtime configurable; this
> short demonstration uses the assessment defaults.

## 00:35-01:35 - Capture, live evidence, and stop

Start acquisition. Let it run for at least 12 seconds. Point to the trace, source/persisted counts,
buffer high-water, timing, loss, and process identifiers. Press Stop and wait for completion.

> The generator and recorder are separate operating-system processes. Generation follows a monotonic
> clock and the recorder returns bounded byte credits only after writes complete. The trace is a
> bounded recorder-side preview. A skipped or coalesced screen update is display loss, not a missing
> recorded sample. The source timeline does not wait for the browser or a stalled recorder. Here the
> persisted count follows the source, buffer use remains bounded, and recorded loss is zero. Stop
> first stops the source, then drains accepted writes, syncs the files, finalizes metadata, and
> exits both children. Completed means finalized; it does not yet mean independently verified PASS.

## 01:35-02:45 - Inspect, retrieve, and export

Open the completed recording. Show channels, rate, seed, duration, expected/physical frames, scalar
samples, file bytes, start time, process IDs, and verification state. Retrieve a small middle range
with channels `31,2,17,0`, then download CSV.

> The bundle is independently interpretable: each fixed-width record begins with a little-endian
> uint64 original frame index followed by little-endian float32 channel values. Metadata
> distinguishes physical frames from scalar samples and declares the independent final extent.
> Ranges are half-open, and selected channels retain requested order. Seeking uses lower-bound index
> probes instead of a full scan. CSV is streamed from the same raw observations and is never
> accumulated in browser state. Frame-major storage still reads unselected channel bytes inside
> matching records; that measured trade-off is disclosed rather than hidden.

## 02:45-03:55 - Playback controls

Play at 1x, pause for a visible two seconds, resume, seek to the midpoint while paused, set 2x,
change channels, resume, then seek near the end and let playback end.

> Playback emits actual stored observations against a monotonic clock. Pause acknowledges at an
> accepted-output boundary, so position does not skip or repeat. Seek invalidates pending output,
> changing speed resets the timing segment, and changing channels recreates the bounded reader at
> the same next position. Paused time is excluded from pacing. The project measures slower and
> faster positive multiples; its plus-or-minus ten-percent playback tolerance is an engineering
> evidence threshold, not a requirement invented from the assessment.

## 03:55-04:55 - Clean and corrupted verification

Open Verify, select the acquisition, run verification, and show PASS with all zero counts. Create
and run the Combined integrity scenario and show all three discrepancy classes.

> The verifier streams every complete physical record and calculates expected float32 values from
> the documented formula. It reports missing, adjacent duplicated, and incorrect scalar samples
> separately, including first positions. This completed acquisition passes with zero discrepancies
> and zero format errors. The Combined scenario now creates a separate eight-frame diagnostic
> bundle. It proves the same verifier detects missing, duplicated, and incorrect values. The source
> recording is never opened for writing, and a diagnostic failure says nothing false about its
> integrity.

## 04:55-05:25 - Browser-free result

Show a terminal containing the completed `npm run cli -- verify <demo-recording>` result and exit
status 0. Keep the recording path and output readable but do not expose unrelated paths.

> The same acquisition, storage, retrieval, playback, and verification core works without a browser.
> Verification exit zero means a trustworthy PASS; exit one is a completed integrity or format FAIL,
> and exit two means an operational failure prevented a trustworthy report.

## 05:25-06:15 - Sustained evidence, limitations, and handoff

Show the README measured-results table, T17 evidence index, and known-limitations section.

> This short capture is a workflow demonstration, not sustained-performance evidence. The separate
> one-hour run persisted and verified 14.4 million frames, 460.8 million scalar samples, and 1.9584
> gigabytes with zero loss. T16 reused that retained file to measure beginning, middle, and end
> seeks, full streamed export, all playback presets, backpressure, and complete verification. The
> repository records methods, platform, units, schemas, trade-offs, and limitations. It claims
> measured behavior, not hard real-time scheduling, power-loss transactions, or unmeasured
> cross-platform performance. The clean-clone rehearsal and complete requirement matrix are under
> T17 evidence. Thank you for reviewing SCOPE.

## Capture and review procedure

1. Build, then run `PORT=3000 SCOPE_RECORDINGS_DIR=./recordings/t17-demo npm start`.
2. Record screen plus default microphone; capture only the 1920x1080 application/terminal region.
3. Export with
   `avconvert --source <capture.mov> --preset PresetAppleM4V1080pHD --output scope-t17-demo.m4v`.
4. Review the complete file for legibility, truthful values, clean audio, all eight shots, and
   absence of credentials. Record actual timestamps rather than retaining these target timestamps.
5. Compute `shasum -a 256 scope-t17-demo.m4v` and populate `video.json` before final validation.
