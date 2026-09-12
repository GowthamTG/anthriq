# SCOPE

A local signal-acquisition workbench for a Node.js and React technical assessment: capture deterministic multi-channel signals, persist indexed binary recordings, retrieve selected ranges, replay them, and verify their integrity.

## Specification and status

The complete [implementation specification](SPEC.md) contains the agreed architecture, 56 user stories, operation contracts, storage format, 30 acceptance scenarios, and delivery phases. It is published as [implementation issue #1](https://github.com/GowthamTG/anthriq/issues/1), labeled `ready-for-agent`.

The approved [implementation ticket index](docs/ticket-plan.md) links all 18 published tickets and their dependencies: 17 local-delivery tickets plus one optional hosting follow-up. Start with [issue #2: local capture](https://github.com/GowthamTG/anthriq/issues/2).

**T01 is implemented:** local launch, a default-rate Acquire screen, real recording telemetry, graceful Stop, saved metadata inspection, and CLI/browser smoke tests. The remaining assessment tickets are still open; this is not the complete assessment submission.

## Stack and decision review

Next.js/React with strict TypeScript and Tailwind CSS. The local Node server, acquisition owner, generator, recorder, storage reader, and CLI are TypeScript too. Node.js 24 runs their erasable types directly; no runtime transpiler or backend build is needed. Production builds use Next's supported Webpack option; Turbopack's PostCSS worker-port binding was blocked in the local build environment. Shared contracts live in `core/contracts.ts`. Playback and verification remain JavaScript drafts for later phases.

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

Browser acquisitions use 32 channels, 4,000 frames/second (128,000 scalar values/second), seed 42, and continuous acquisition until Stop. Editable browser configuration belongs to T02. Browser reloads reconnect to the active acquisition; closing the tab does not stop it. Stop the application with Ctrl+C to request graceful shutdown.

The server binds only to `127.0.0.1`. `PORT` overrides port 3000, and `SCOPE_RECORDINGS_DIR` overrides the default `recordings` directory. Use a new writable location; recordings are never overwritten. These environment variables work for both development and production launch.

## Browser-free commands

```sh
# A new directory is required for each recording.
npm run cli -- record recordings/example --seconds 2
npm run cli -- inspect recordings/example

# Continuous capture; Ctrl+C drains and finalizes the recording.
npm run cli -- record recordings/continuous

# Existing CLI settings remain available.
npm run cli -- record recordings/custom --channels 8 --sample-rate 1000 --seed 7 --seconds 2
```

The CLI's existing `verify`, `retrieve`, and `playback` commands remain development drafts. The nominal `verify` path is exercised as a smoke check, but exhaustive corruption validation and playback acceptance are assigned to later tickets.

## Architecture and recording format

The local application and CLI use the same acquisition owner. It starts one recorder process, which starts a separate generator process. The generator uses a monotonic clock and byte credits; the recorder returns credits only after complete writes. Browser state arrives through a coalesced event stream, independently of recorder acknowledgements.

Each recording directory contains:

- `frames.bin`: repeated records of an eight-byte little-endian unsigned original frame index followed by 32 little-endian float32 values at default settings. Width is `8 + 4 × channels` bytes.
- `metadata.json`: configuration, format, timestamps, expected source extent, recorded frame/scalar counts, final status, and actual generator/recorder PIDs.
- `losses.jsonl`: any accounted lost intervals.
- `metrics.jsonl`: periodic bounded-frequency measurements streamed to disk.

At defaults, two seconds contains 8,000 frames, 256,000 values, and 1,088,000 frame-data bytes. Frame indices retain the original timeline; final expected extent is supplied by the generator rather than inferred from saved record count. The [specification](SPEC.md) defines the waveform, layout, and planned contracts in full.

Start reserves ownership immediately; a concurrent start returns conflict. Stop is idempotent, including during startup. Errors are shown rather than reported as completion. Accepted data is drained and synced on normal stop. Application/CLI shutdown has a ten-second limit before forced cleanup and failure; comprehensive stall, crash, disk-exhaustion, and recovery testing belongs to T04/T05. Clean-stop syncing is not a power-loss durability guarantee.

## Tests

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

On Linux, use `npx playwright install --with-deps chromium` when system browser dependencies are absent. Browser tests start their own production servers on ports 3100 and 3101 and use isolated temporary recording locations. Core tests launch real processes and inspect real files, including an independently calculated float32 reference value. Test artifacts and recordings are excluded from Git.

The CI workflow runs a clean install, strict type checking, core tests, production build, and Chromium smoke tests on Ubuntu with Node.js 24. [T01 evidence and screenshots](docs/evidence/t01/README.md) distinguish completed local checks from the later sustained-performance work.

## Phase boundary

This phase includes a usable Acquire screen and inspection of its saved result. The recordings library, editable browser settings, live traces, verification UI, CSV export, playback controls, comprehensive overload/fault experiments, one-hour benchmark, final video, and hosting remain in subsequent tickets. No waveform or integrity PASS is fabricated in the interface.

## Agreed direction

- Separate Node.js generator and recorder processes with clock-paced generation and a bounded byte budget.
- Original frame indices, float32 channel values, JSON metadata, and explicit overload-loss accounting.
- Streaming retrieval and verification, with precise playback controls in later phases.
- A graphite instrument interface with real recording metrics; live waveforms are scheduled for T12.
- One-command local execution and a short demonstration video as the primary delivery; public hosting is last priority.

See the [domain glossary](CONTEXT.md), [architecture decisions](docs/adr/), and [acceptance scenarios](docs/acceptance-scenarios.md).

## Engineering skills

Repository configuration is linked from [AGENTS.md](AGENTS.md). Issues live in GitHub, triage uses the five canonical labels, and domain documents use one root context. The configuration documents in `docs/agents/` can be edited directly if conventions change.
