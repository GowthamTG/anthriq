# Known limitations and next work

- **No hard real-time guarantee.** Source and playback pacing are measured with monotonic clocks on
  a general-purpose operating system. A real-time host and hardware clock would be required for hard
  scheduling deadlines.
- **Frame-major subset cost.** A channel-subset query reads unselected channel payload for matching
  frames. The format favors simple append, recovery, and indexed seeks; a versioned channel-blocked
  format is the next option for channel-heavy analysis.
- **Local single-owner operation.** One host owns one acquisition and one playback session.
  Accounts, remote storage, collaboration, and distributed acquisition were intentionally excluded
  because the assessment does not require them.
- **Clean-stop durability, not power-loss transactions.** Normal shutdown drains and syncs accepted
  data. Sudden power loss and arbitrary corruption are detected, not repaired. Checksummed segments
  and a recovery journal would be the next storage-hardening step.
- **Measured platform boundary.** Sustained evidence was recorded on macOS with Apple M5 Pro and 24
  GiB memory. Ubuntu CI proves functional portability, not identical sustained performance.
- **Forward-only playback.** Variable rate means positive multiples below and above native speed.
  Reverse chronological playback was not explicitly required and would need a reverse indexed
  reader.
- **Public handoff, not private.** The repository is public and the `t17-submission` release asset
  is therefore publicly downloadable by anyone with the link; there is no repository-level access
  restriction. `video.json` records `release.visibility: "public"` to reflect this truthfully, which
  deviates from `video.schema.json`'s `private-repository-access` constant.
- **Demo video does not meet the target spec.** `Demo.mov` (835.7 s, 2902x1732, screen-recorded via
  ReplayKit at Retina scale) exceeds the intended 5-7 minute, 1920x1080 target in
  `docs/evidence/t17/demo-script.md`. `video.json` records the true measured values rather than the
  schema's required duration range and pixel dimensions, so `npm run evidence:validate-handoff`
  fails on `durationSeconds`, `width`, `height`, and `filename` (the asset is `Demo.mov`, not the
  schema's required `scope-t17-demo.m4v`). Re-recording to spec is the follow-up if a strictly
  compliant artifact is required.
- **Shot timestamps are estimated, not frame-verified.** The owner confirmed all eight script
  sections are present in the final recording but could not supply exact timestamps. `video.json`'s
  `shots[].timestamp` values are proportionally estimated from the script's target section
  boundaries and explicitly labeled `(estimated, not frame-verified)`; they were not confirmed
  against the actual video frames (no video-inspection tooling was installed for this pass).
