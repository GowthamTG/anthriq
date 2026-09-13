# [T11] Pause, seek, and change playback speed without losing position

Published: [GitHub issue #12](https://github.com/GowthamTG/anthriq/issues/12). Publication label:
`ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

The operator can pause/resume, seek precisely, and change speed or channels while preserving a
correct sample sequence and a responsive playback view.

Scope traceability: user stories 31, 32, 33, 34, 35, 37; acceptance scenarios A17, A18, A19, A20,
A28 in the parent specification.

## Acceptance criteria

- [ ] Expose Pause/Resume, exact time/index seek, a timeline control, speed presets, and channel
      selection in the UI backed by the public playback control contract.
- [ ] Support speed 0.1×–8× with presets including 0.25×, 0.5×, 1×, 2×, and 4×. Playback remains
      forward-only.
- [ ] Commit already emitted frame positions before any asynchronous read can be interrupted. After
      pause acknowledges no more frames emit; resume starts at the next un-emitted original
      position.
- [ ] Seek invalidates stale reads/outputs, preserves paused/playing intent, and resets the clock
      anchor. Reject offsets outside the known timeline; seeking exactly to end is valid and ends
      playback.
- [ ] Changing speed or channels preserves current next position and cancels old output without
      skipped/repeated frames. Invalid controls leave the previous valid state intact.
- [ ] Reset/segment timing comparisons across seeks/speed changes and exclude paused duration.
      Report actual pacing at slower and faster rates.
- [ ] Test commands arriving during pending reads and batch boundaries, repeated pause/resume, seek
      while paused/playing, end-of-file controls, and channel changes using only public
      output/control behavior.
- [ ] Extend browser coverage to exercise each control and visible state, and document O(log N) seek
      plus bounded window-read cost.

## Blocked by

- #11: [T10] Play a recording at its native rate
