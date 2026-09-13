# Acceptance scenarios

These scenarios translate the assessment into observable checks. They are planned checks, not test
results.

| Scenario                           | Required observation                                                                                                                              |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default acquisition                | 32 channels at 4,000 frames/second; zero missing, duplicate, and incorrect values in nominal conditions                                           |
| Different configuration            | At least two nondefault channel/rate combinations work without source edits                                                                       |
| Sustained acquisition              | Report elapsed monotonic time, emitted frames, recorded values, timing deviation, buffer high-water mark, and generator/recorder memory over time |
| Slow recorder                      | Source timeline keeps advancing at the configured rate; memory stays within documented buffer limits; every lost range is accounted for           |
| Recorder recovers                  | New data can be recorded after the stall; original sequence positions expose the intervening gap                                                  |
| Normal stop                        | Generator establishes final expected extent; recorder drains accepted data and finalizes readable files                                           |
| Interrupt                          | Ctrl+C triggers coordinated shutdown; completed samples remain retrievable and verifiable                                                         |
| Truncated file                     | Reader identifies the incomplete tail and preserves access to complete preceding records; validator does not silently pass                        |
| Known fixture                      | Reader returns exact independently calculated channel values at known indices                                                                     |
| Time/index retrieval               | Requested interval follows documented endpoint and rounding rules                                                                                 |
| Channel subset                     | Arbitrary valid channel selection returns the documented order; invalid selections produce useful errors                                          |
| Retrieval on a recording with gaps | Missing intervals are reported explicitly; later samples keep their original time positions                                                       |
| Native playback                    | Emitted position versus active elapsed time is measured at 1×                                                                                     |
| Variable playback                  | A slower and a faster rate advance at the requested multiple                                                                                      |
| Pause/resume                       | Position does not advance while paused; resuming emits the next expected position                                                                 |
| Seek                               | Beginning, middle, and near-end seeks return the requested position without reading the full recording                                            |
| Missing data fixture               | Verifier reports missing count and first original sample/channel position                                                                         |
| Duplicate data fixture             | Verifier reports duplicated count and first original sample/channel position                                                                      |
| Incorrect value fixture            | Verifier reports incorrect count and first original sample/channel position                                                                       |
| Trailing loss fixture              | Verifier detects missing final samples using expected extent rather than trusting saved record count                                              |
| Combined corruption                | All three discrepancy classes remain distinguishable in the same fixture                                                                          |
| Machine-checkable verification     | Clean input exits successfully; discrepant or malformed input does not                                                                            |
| Slow/disconnected browser          | Acquisition proceeds independently; preview buffers remain bounded                                                                                |
| Full-rate visualization            | Live and playback traces stay responsive using a bounded window or decimation                                                                     |

## Measurement reporting

Capture the actual platform, Node.js version, configuration, run duration, and measurement method
with results. Measure memory repeatedly through the run, distinguishing startup/warmup from steady
state. Do not present a short run as proof of unlimited duration or claim strict real-time
scheduling on a general-purpose operating system.

Separate transport acceptance, disk write completion, and storage durability in documentation; a
successful write callback alone is not a power-loss durability guarantee. Disk exhaustion and fatal
I/O failures should end with an explicit failure and preserve whatever data can still be read.
