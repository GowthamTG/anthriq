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
- **Private handoff.** The repository and release asset require GitHub access. The owner must add
  the named reviewer; public hosting remains the optional T18 follow-up.
