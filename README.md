# SCOPE

A local signal-acquisition workbench for a Node.js and React technical assessment: capture deterministic multi-channel signals, persist indexed binary recordings, retrieve selected ranges, replay them, and verify their integrity.

## Specification and status

The complete [implementation specification](SPEC.md) contains the agreed architecture, 56 user stories, operation contracts, storage format, 30 acceptance scenarios, and delivery phases. It is published as [implementation issue #1](https://github.com/GowthamTG/anthriq/issues/1), labeled `ready-for-agent`.

The approved [implementation ticket index](docs/ticket-plan.md) links all 18 published tickets and their dependencies: 17 local-delivery tickets plus one optional hosting follow-up. T01 ([issue #2](https://github.com/GowthamTG/anthriq/issues/2)) through T05 are merged. T06 adds independent recording verification through the CLI and workbench.

**T01–T06 are implemented:** local launch, configurable continuous/timed acquisition, real telemetry, graceful Stop, a paginated recordings library, validated metadata/prefix inspection, bounded failure cleanup, overload/recovery diagnostics, independent streaming verification, and CLI/browser checks. The remaining assessment tickets are still open; this is not the complete assessment submission.

## Stack and decision review

Next.js/React with strict TypeScript and Tailwind CSS. The local Node server, acquisition owner, generator, recorder, storage reader, verifier, verification worker/owner, and CLI are TypeScript too. Node.js 24 runs their erasable types directly; no runtime transpiler or backend build is needed. Production builds use Next's supported Webpack option; Turbopack's PostCSS worker-port binding was blocked in the local build environment. Shared contracts live in `core/contracts.ts`. Playback remains a JavaScript draft for its later phase.

The [decision audit](docs/decision-audit.md) reviews earlier choices and records corrections. [ADR 0003](docs/adr/0003-typescript-and-tailwind.md) amends the initial JavaScript/native-CSS choice while preserving the parent specification.

## Run locally

Use **Node.js 24** and its bundled npm. With nvm, run `nvm use` first.

```sh
npm ci
npm run build
npm start
```

Open [SCOPE at localhost](http://127.0.0.1:3000). After the initial install/build, `npm start` is the one-command launch. For development with live reload, use `npm run dev` instead.

Press **Start acquisition**, watch the real counts, then **Stop acquisition**. Completion appears only after accepted samples are written, metadata is finalized, and the recording processes exit successfully. **Inspect recording** opens its metadata and actual file size. Completed means finalized, not independently verified.

The initial configuration is 32 channels, 4,000 frames/second (128,000 scalar values/second), seed 42, and continuous acquisition until Stop. Edit channel count, sample rate, seed, duration, and optional recording name before Start. Settings lock during acquisition. Zero duration means until stopped; positive duration stops automatically. Invalid submissions preserve entered values and show field errors. Browser reloads reconnect to the active acquisition; closing the tab does not stop it. Stop the application with Ctrl+C to request graceful shutdown.

The server binds only to `127.0.0.1`. `PORT` overrides port 3000, and `SCOPE_RECORDINGS_DIR` overrides the default `recordings` directory. Use a new writable location; recordings are never overwritten. These environment variables work for both development and production launch.

## Recordings library

Open **Recordings** in the header to browse saved bundles, including recordings from earlier application sessions. Select one to inspect its configuration, lifecycle, physical complete frames, readable prefix, and warnings. The default page has ten entries in lexical ID order; use Next page and First page to navigate. Refresh re-reads disk metadata. A malformed bundle remains visible with its error.

Partial trailing bytes are excluded from the readable prefix. Unconfirmed final extent means unknown duration/completeness. Declared metadata counts and physical counts are shown separately. Finalized does not mean verified. See the [complete bundle and inspection contract](docs/recording-format.md).

```sh
npm run cli -- list
npm run cli -- list recordings --limit 5
# Pass nextCursor from the preceding JSON response to fetch the next page.
npm run cli -- list recordings --limit 5 --cursor <recording-id>
```

## Browser-free commands

```sh
# A new directory is required for each recording.
npm run cli -- record recordings/example --seconds 2
npm run cli -- inspect recordings/example

# Continuous capture; Ctrl+C drains and finalizes the recording.
npm run cli -- record recordings/continuous

# Existing CLI settings remain available.
npm run cli -- record recordings/custom --channels 8 --sample-rate 1000 --seed 7 --seconds 2 --display-name "Bench 8"
```

Record options:

| Option | Accepted values / default |
| --- | --- |
| `--channels` | Integer 1–256; default 32 |
| `--sample-rate` | Integer 1–100,000 frames/s (samples/s/channel); default 4,000 |
| `--seed` | Integer 0–2,147,483,647; default 42 |
| `--seconds` | Finite nonnegative duration; default 0 means until stopped |
| `--display-name` | Optional text, up to 120 characters; whitespace trimmed; never used as the directory path |
| `--buffer-bytes` | Integer 4,096–67,108,864; default 4,194,304 |
| `--stall-after-seconds` | Diagnostic stall onset, 0–86,400 seconds after source start; default 0 |
| `--stall-for-ms` | One recorder stall, integer 0–5,000 milliseconds; default 0 disables it |
| `--write-delay-ms` | Diagnostic recorder delay from 0–5,000 ms; default 0, per-batch delay; use the temporary stall below for recovery |

Unknown record options, repeated options, missing values, invalid numbers, and unsafe timed extents are rejected before creating a recording or spawning children. Zero duration has no arbitrary time limit. Finite disk capacity and the exact integer range remain practical limits: frame extent, scalar count, and byte offset must each fit `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991). Continuous generation also checks that bound before encoding data. Requested timed extent is `floor(seconds × sampleRate)`.

**Input bounds are not throughput guarantees.** The high end of valid channel/rate settings may overload a machine; the source retains its clock and accounts for loss through the bounded-credit policy. Short default and nondefault tests are not sustained-performance evidence.

`retrieve` and `playback` remain development drafts. Verification is implemented as the independent streaming workflow below.

## Verify a recording

```sh
npm run cli -- verify recordings/example
```

Verification physically scans every complete record in reusable chunks of approximately 64 KiB. It compares stored values with the deterministic final float32 expectation, retains bounded counters and first positions rather than an anomaly list, and uses the independently confirmed final source extent to find beginning, interior, and trailing loss.

The command prints one `SCOPE-VERIFICATION/1` JSON report and atomically saves the same report as `verification.json` in the recording bundle. Exit `0` means PASS; exit `1` means a completed integrity or format FAIL report; exit `2` means invocation, I/O, concurrent-change, or report-persistence failure prevented a trustworthy report. Missing, adjacent duplicated, and incorrect scalar observations are separate and may overlap: a wrong duplicate increments both duplicated and incorrect counts. A malformed frame identity/order makes affected discrepancy totals unknown rather than fabricated.

Open **Verify** in the workbench to select a completed recording and run the same verifier in a separate child process. Only one UI verification runs at a time; acquisition remains independently owned and responsive. Progress is coalesced, the result can be downloaded, and its file identity includes device, inode, byte size, and nanosecond modification time for metadata and frame data. Inspection marks a previous report stale when those files change. Finalized, completed-with-loss, verified, integrity-failed, and stale are distinct states.

## Demonstrate overload and recovery

Expand **Overload diagnostics** in the setup panel. Choose 32 channels, 4,000 Hz, an 8,192-byte buffer, a stall after 0.5 seconds lasting 2,000 ms, and a five-second duration. Start and watch the stall, loss detection, resumed writes, and **Completed with loss**. It means the accepted data finalized; it never means verified PASS.

The same diagnostic works from the CLI:

```sh
npm run cli -- record recordings/overload --seconds 5 --buffer-bytes 8192 --stall-after-seconds 0.5 --stall-for-ms 2000
npm run cli -- inspect recordings/overload
```

Use a new directory each time. Diagnostics are off by default; set Temporary stall back to 0 for nominal capture. Settings persist in the workbench until changed. See [overload accounting and telemetry](docs/overload.md) for exact counter meanings, loss intervals, memory bounds, and timing limitations.

## Architecture and recording format

The local application and CLI use the same acquisition owner. It starts one recorder process, which starts a separate generator process. The generator uses a monotonic clock and byte credits; the recorder returns credits only after complete writes. Browser state arrives through a coalesced event stream, independently of recorder acknowledgements.

Each recording directory contains:

- `frames.bin`: repeated records of an eight-byte little-endian unsigned original frame index followed by 32 little-endian float32 values at default settings. Width is `8 + 4 × channels` bytes.
- `metadata.json`: configuration, format, timestamps, expected source extent, recorded frame/scalar counts, final status, and actual generator/recorder PIDs.
- `losses.jsonl`: any accounted lost intervals.
- `metrics.jsonl`: periodic bounded-frequency measurements streamed to disk.

At defaults, two seconds contains 8,000 frames, 256,000 values, and 1,088,000 frame-data bytes. Frame indices retain the original timeline; final expected extent is supplied by the generator rather than inferred from saved record count. The [waveform and binary reference](docs/waveform.md) supplies the exact formula, rounding rules, and independently calculated values. Unknown waveform identifiers are rejected. The [specification](SPEC.md) defines the complete planned contracts.

Start reserves ownership immediately; a concurrent start returns conflict. Stop is idempotent, including during startup. Errors are shown rather than reported as completion. Accepted data is drained and synced on normal stop. Browser Stop, CLI/application shutdown, and timed-capture drain have a ten-second limit before forced cleanup and failure. Repeated requests do not extend that deadline. A failed recording retains its readable complete-frame prefix and an actionable cause where metadata can be written. A confirmed source extent is retained; otherwise duration and completeness remain unknown. See [shutdown and failure behavior](docs/failure-handling.md) for the tested cases and durability limits.

## Tests

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

On Linux, use `npx playwright install --with-deps chromium` when system browser dependencies are absent. Browser tests start their own production servers on ports 3100, 3101, 3102, and 3104 and use isolated temporary recording locations. Core tests launch real processes and inspect real files, including an independently calculated float32 reference value. Test artifacts and recordings are excluded from Git.

The CI workflow runs a clean install, strict type checking, core tests, production build, and Chromium smoke tests on Ubuntu with Node.js 24. [T01 evidence](docs/evidence/t01/README.md) , [T02 configuration evidence](docs/evidence/t02/README.md), [T03 library evidence](docs/evidence/t03/README.md), [T04 failure evidence](docs/evidence/t04/README.md), and [T05 overload evidence](docs/evidence/t05/README.md) distinguish completed local checks from the later sustained-performance work.

## Phase boundary

The implemented phases include configurable acquisition, inspection, overload recovery, and independent verification of saved results. Live traces, disposable corruption demonstrations, CSV export, playback controls, extended stress experiments, the one-hour benchmark, final video, and hosting remain in subsequent tickets. No waveform or integrity PASS is fabricated in the interface.

## Agreed direction

- Separate Node.js generator and recorder processes with clock-paced generation and a bounded byte budget.
- Original frame indices, float32 channel values, JSON metadata, and explicit overload-loss accounting.
- Streaming retrieval and verification, with precise playback controls in later phases.
- A graphite instrument interface with real recording metrics; live waveforms are scheduled for T12.
- One-command local execution and a short demonstration video as the primary delivery; public hosting is last priority.

See the [domain glossary](CONTEXT.md), [architecture decisions](docs/adr/), and [acceptance scenarios](docs/acceptance-scenarios.md).

## Engineering skills

Repository configuration is linked from [AGENTS.md](AGENTS.md). Issues live in GitHub, triage uses the five canonical labels, and domain documents use one root context. The configuration documents in `docs/agents/` can be edited directly if conventions change.
