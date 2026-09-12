# SCOPE

A local signal-acquisition workbench for a Node.js and React technical assessment: capture deterministic multi-channel signals, persist indexed binary recordings, retrieve selected ranges, replay them, and verify their integrity.

## Specification and status

The complete [implementation specification](SPEC.md) contains the agreed architecture, 56 user stories, operation contracts, storage format, 30 acceptance scenarios, and delivery phases. It is published as [implementation issue #1](https://github.com/GowthamTG/anthriq/issues/1), labeled `ready-for-agent`.

The project currently contains specification and setup documents plus initial **untested core drafts**. The Next.js/React interface, executable test suite, dependency manifest, performance evidence, and final run instructions are not complete. This commit is a starting point for implementation, not a submission-ready application.

## Agreed direction

- Separate Node.js generator and recorder processes with clock-paced generation and a bounded byte budget.
- Original frame indices, float32 channel values, JSON metadata, and explicit overload-loss accounting.
- Streaming retrieval and verification, with precise playback controls.
- A graphite instrument interface with real waveforms and measured health metrics.
- One-command local execution and a short demonstration video as the primary delivery; public hosting is last priority.

See the [domain glossary](CONTEXT.md), [architecture decisions](docs/adr/), and [acceptance scenarios](docs/acceptance-scenarios.md).

## Engineering skills

Repository configuration is linked from [AGENTS.md](AGENTS.md). Issues live in GitHub, triage uses the five canonical labels, and domain documents use one root context. The configuration documents in `docs/agents/` can be edited directly if conventions change.
