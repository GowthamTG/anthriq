# T17 demonstration script and shot list

Target: 6-7 minutes, 1920x1080, owner narration, visible pointer, clean microphone audio.

## Before recording

- Close every other SCOPE tab. The local service intentionally supports at most eight simultaneous
  live observers, and unrelated tabs can make a new tab show **Reconnecting**.
- Hide notifications, bookmarks, account pages, private messages, tokens, and unrelated terminal
  history.
- Use a clean production build and an isolated recording directory:

  ```sh
  npm ci
  npm run build
  PORT=3000 SCOPE_RECORDINGS_DIR=./recordings/t17-demo npm start
  ```

- Open one browser tab at `http://127.0.0.1:3000`, set it to 100% zoom, and confirm the header
  status badge reads **Local connection**.
- Use a 15-second acquisition so the live charts and scrolling behavior are easy to see.
- Rehearse the range values and CLI recording ID once before the real take.
- Do not claim that a chart proves recording completeness. Only finalized counts and independent
  verification support that claim.

## 00:00-00:35 - Purpose and real configuration

**Screen:** Start on **Acquire**. Point to the Channels, Sample rate, Seed, and Duration fields, and
expand **Overload diagnostics** to show the Buffer budget field. Set 32 channels, 4,000
frames/second, seed 42, and 15 seconds duration.

**Narration:**

> This is SCOPE, a local signal-acquisition workbench built with Node.js and React. I'm configuring
> 32 channels at 4,000 frames per second: 128,000 scalar values each second. A frame contains one
> value for every channel. The deterministic seed is 42, and this demonstration will record for 15
> seconds. These are runtime settings, not hard-coded display values.

## 00:35-01:45 - Capture, live continuity, and all-channel visibility

**Screen:** Click **Start acquisition**. Let data run. Point, in this order, to status, source and
persisted frame counts, queue/high-water metrics, dropped frames, the "Last two seconds" chart, the
"Whole acquisition view history" chart, and the "All-channel persisted overview" stacked-lane panel.
Drag the whole-acquisition scrollbar left so **Jump to latest** appears in its top-left corner, then
click it. Let the acquisition run to completion (or stop after at least 12 seconds).

**Narration:**

> The generator and recorder are separate operating-system processes. Generation follows a monotonic
> source clock, while the recorder returns bounded byte credits only after writes complete. The
> detailed trace always covers the latest two seconds and shows four selected channels for readable
> inspection. The scrollable history keeps bounded whole-acquisition context and follows the newest
> data until I deliberately inspect earlier history. "Jump to latest" resumes that follow mode.
>
> The stacked overview shows all 32 channels at once using uniformly sampled persisted observations.
> It is bounded and decimated; it is not the full-rate sample stream. All configured channels are
> still recorded whether or not they are among the four detailed traces.
>
> Browser previews are deliberately outside the recording critical path. If the browser disconnects,
> an interval can be marked as a preview gap. That means the browser missed preview evidence; it
> does not mean samples were lost from the recording. Here the persisted count follows the source,
> buffer use remains bounded, and the declared dropped-frame count is zero.
>
> Stop first stops the source, then drains accepted writes, syncs the files, finalizes metadata, and
> exits both child processes. Completed means finalized; independent verification is still a
> separate step.

## 01:45-02:45 - Recording inspection, exact retrieval, and CSV

**Screen:** Open **Recordings**, select the completed acquisition, and point to Signal
configuration, Expected frames, Metadata frame count, Physical complete frames, Readable scalar
values, and File size. Scroll to **Exact range inspection**. Retrieve a small middle interval
(Start/End original-index fields) with channels `31,2,17,0`, then click **Download CSV**. Scroll to
the bottom of the page to show the all-channel stacked overview again.

**Narration:**

> This recording bundle is independently interpretable. Each fixed-width record begins with a
> little-endian unsigned 64-bit original frame index, followed by little-endian float32 channel
> values. The metadata distinguishes frames from scalar samples and declares the independent final
> extent.
>
> Range boundaries are half-open, and selected channels retain the requested order — here, channel
> 31 first, then 2, 17, and 0. Retrieval uses lower-bound index probes rather than scanning the
> complete file. CSV is streamed from the same stored observations and is not accumulated in browser
> state. Frame-major storage still reads the unselected channel bytes inside matching records —
> roughly an eight-times value-byte amplification here, at 32 channels — and that measured trade-off
> is disclosed rather than hidden.
>
> The final stacked panel again represents every recorded channel independently of the four-channel
> detail selection and playback output selection.

## 02:45-03:50 - Controlled playback

**Screen:** On the same recording-detail page, scroll to **Playback channels**. Uncheck all but four
channels so playback emission matches the four-channel chart, then use **Play**. Let it run, click
**Pause**, drag the timeline slider to the midpoint while paused, set playback speed to 2x, re-check
a different set of four channels, click **Play** again, then use the exact-seek field to seek near
the end and let playback finish.

**Narration:**

> Playback emits actual stored observations against a monotonic clock. All checked channels are
> emitted; the chart displays four at a time. Pause acknowledges at an accepted-output boundary, so
> the next position does not skip or repeat. Seeking invalidates pending output; changing speed
> starts a new timing segment; and changing the selected channels recreates the bounded reader at
> the same next position.
>
> Paused time is excluded from pacing. The project measures slower and faster positive multiples;
> its plus-or-minus ten-percent playback tolerance is an engineering evidence threshold, not a
> quoted assessment requirement.

## 03:50-04:55 - Clean verification and isolated corruption detection

**Screen:** Open **Verify**, select the acquisition, click **Start verification**, and show the
**Integrity verified** badge with zero Missing, Duplicated, Incorrect, and Format errors counts.
Then click **Create combined scenario**, select the resulting diagnostic bundle, and run
verification on it to show the non-zero discrepancy classes. Keep the source recording ID visible
throughout.

**Narration:**

> Verification streams every complete physical record and independently calculates the expected
> float32 value from the documented waveform formula. It reports missing frames, adjacent duplicate
> indices, incorrect scalar values, and format errors separately, including first observed
> positions.
>
> This completed acquisition verifies clean, with zero discrepancies. The Combined scenario creates
> a separate eight-frame diagnostic bundle containing deliberate missing, duplicate, and incorrect
> observations. The same verifier detects each class. The source recording is never opened for
> writing, and a failing diagnostic fixture makes no claim that the source recording itself is
> corrupt.

## 04:55-05:30 - Browser-free verification

**Screen:** Switch to a clean terminal. Run:

```sh
npm run cli -- verify ./recordings/t17-demo/<recording-id>
```

Show the JSON result ending in `"result": "PASS"` and `echo $?` returning 0.

**Narration:**

> The same acquisition, storage, retrieval, playback, and verification core also works without a
> browser. Verification exit zero means a trustworthy PASS. Exit one means a completed integrity or
> format FAIL, and exit two means an operational problem prevented a trustworthy result.

## 05:30-06:25 - Sustained evidence, limitations, and handoff

**Screen:** Show the README measured-results section, T15 one-hour evidence, T16 long-recording
evidence, the T17 checklist, and known limitations. Keep filenames and key figures readable.

**Narration:**

> This 15-second capture demonstrates the workflow; it is not the sustained-performance result. The
> separate one-hour run persisted and verified 14.4 million frames, 460.8 million scalar samples,
> and a 1.9584-gigabyte frame file with zero recorded loss. T16 reused that retained file to measure
> beginning, middle, and end seeks, streamed export, playback presets, bounded backpressure, and
> complete verification.
>
> The repository records the method, platform, units, schemas, trade-offs, and limitations. It
> claims measured behavior, not hard real-time scheduling, power-loss transactions, or unmeasured
> cross-platform performance. The clean-clone rehearsal, requirement matrix, evidence index, and
> this demonstration complete the local handoff. Thank you for reviewing SCOPE.

## Capture and review procedure

1. Build, then run `PORT=3000 SCOPE_RECORDINGS_DIR=./recordings/t17-demo npm start`.
2. Record screen plus default microphone; capture only the 1920x1080 application/terminal region.
3. Export with
   `avconvert --source <capture.mov> --preset PresetAppleM4V1080pHD --output scope-t17-demo.m4v`.
4. Review the complete file for legibility, truthful values, clean audio, all eight shots, and
   absence of credentials. Record actual timestamps rather than retaining these target timestamps.
5. Compute `shasum -a 256 scope-t17-demo.m4v` and populate `video.json` before final validation.
