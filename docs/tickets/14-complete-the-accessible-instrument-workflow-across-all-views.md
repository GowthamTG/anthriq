# [T14] Complete the accessible instrument workflow across all views

Published: [GitHub issue #15](https://github.com/GowthamTG/anthriq/issues/15). Publication label:
`ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

A reviewer can move smoothly from acquisition through recordings, export, playback, and verification
using either mouse or keyboard, with a consistent premium instrument UI.

Scope traceability: user stories 49, 50, 52, 53; acceptance scenarios A28, A29, A30 in the parent
specification.

## Acceptance criteria

- [ ] Unify Acquire, Recordings, and Verify navigation and selected-recording playback into one
      coherent graphite design, retaining real behavior and the established simple stack.
- [ ] Complete loading, empty, busy, stopping, ended, disconnected, failed, integrity-failed,
      completed-with-loss, and verified states; completion and verification remain visually
      distinct.
- [ ] Provide visible keyboard focus, accessible names, readable contrast, text alternatives to
      color-only status, and keyboard-operable playback/channel controls.
- [ ] Ensure desktop and smaller-screen layouts keep primary controls, especially Stop, usable and
      avoid clipped traces, overlapping text, or misleading unit labels.
- [ ] Connect actual verification progress/results, downloadable reports, stale-result warnings, and
      the safe fault demonstration to the recording workflow.
- [ ] Run the small browser end-to-end suite across
      configure/capture/stop/open/range/export/playback/verify and targeted failures; tests should
      assert external behavior rather than CSS implementation.
- [ ] Perform and save representative visual-review evidence from actual populated and empty/error
      states, fixing defects rather than merely recording screenshots.
- [ ] Keep animations restrained and respect reduced-motion preferences; exclude decorative features
      that delay assessment completion.

## Blocked by

- #8: [T07] Demonstrate integrity failures using disposable recordings
- #10: [T09] Export selected observations as CSV and JSON-lines
- #12: [T11] Pause, seek, and change playback speed without losing position
- #14: [T13] Keep acquisition independent of slow or disconnected browsers
