# [T07] Demonstrate integrity failures using disposable recordings

Published: [GitHub issue #8](https://github.com/GowthamTG/anthriq/issues/8). Publication label:
`ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

The Verify view offers a safe demonstration that creates disposable damaged fixtures and visibly
explains which samples are missing, duplicated, or incorrect.

Scope traceability: user stories 45, 53; acceptance scenarios A21, A22, A23, A24, A28 in the parent
specification.

## Acceptance criteria

- [ ] Provide explicit clean, missing, duplicate, incorrect, and combined diagnostic scenarios using
      small generated/disposable recordings or clearly identified copies.
- [ ] Never mutate an existing user recording, its metadata, or its previously saved integrity
      result. Mark diagnostic recordings distinctly in the library and result view.
- [ ] Run each scenario through the real validator and show actual counts, first positions, and
      PASS/FAIL rather than precomputed display results.
- [ ] Demonstrate trailing loss using independent expected extent, and explain that finalized does
      not mean lossless.
- [ ] Expose scenario creation/running/error/completed states and a concise explanation suitable for
      the final walkthrough.
- [ ] Add a browser test that creates a fault fixture, verifies its known counts/positions, and
      confirms the original recording is unchanged.
- [ ] Keep this a small assessment demonstration; no general waveform editor or corruption repair
      tool.

## Blocked by

- #4: [T03] Browse self-describing recordings and inspect incomplete prefixes
- #7: [T06] Verify recordings through the CLI and workbench
