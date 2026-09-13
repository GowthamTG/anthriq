# [T02] Configure acquisitions and reproduce exact signal values

Published: [GitHub issue #3](https://github.com/GowthamTG/anthriq/issues/3). Publication label:
`ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

An operator chooses channels, sample rate, seed, and duration in the UI or CLI, records that exact
configuration, and reproduces any stored channel value independently.

Scope traceability: user stories 4, 5, 6, 7, 8, 11, 22; acceptance scenarios A02, A03, A25 in the
parent specification.

## Acceptance criteria

- [ ] Expose channel count, sample rate, seed, optional duration, and optional recording display
      name through the UI/service and documented CLI. Persist the effective configuration with the
      recording.
- [ ] Implement the spec's validation ranges: channels 1–256, sample rate 1–100,000, seed
      0–2,147,483,647, and byte budget 4 KiB–64 MiB. Zero duration means until stopped; positive
      finite duration is timed acquisition rather than a fixed limit on continuous runs.
- [ ] Reject unknown inputs, missing CLI option values, nonfinite numbers, fractional integer
      settings, unsafe index arithmetic, and invalid duration before starting children or allocating
      a recording. Invalid UI submissions preserve entered values and show the field error.
- [ ] Use the triangle-modulated waveform and exact final float32 rounding defined in the parent
      spec. Record and validate the waveform version.
- [ ] Publish the waveform definition, rounding rules, and independently checked channel/index
      reference values sufficient to reproduce values without application source.
- [ ] Distinguish scalar samples from multi-channel frames in controls, metadata, and output;
      default throughput is 128,000 scalar samples/second.
- [ ] Run actual acquisitions at the defaults and at least two nondefault channel/rate combinations.
      Verify saved metadata, timed extent, and independently expected values; test that invalid
      requests leave no running child.
- [ ] Document input bounds separately from guaranteed throughput. Runtime configuration does not
      promise lossless operation for every supported numeric combination.

## Blocked by

- #2: [T01] Launch locally, capture a nominal signal, and inspect the saved result
