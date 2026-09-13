# Implementation decision audit — T01

Reviewed September 12, 2026 following the user's correction of the JavaScript/native-CSS choice.
This reviews the material choices in SPEC.md, ADRs 0001–0002, the approved T01 plan, and the
implementation. The parent specification stays unchanged; this document records the implementation
amendment explicitly.

## Corrections

| Earlier decision                                | Finding                                                                                                                                     | Concrete correction                                                                                                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plain JavaScript everywhere to minimize tooling | Dependency count was given too much weight over maintainability. Acquisition states, IPC messages, and metadata benefit from static checks. | Strict TypeScript for the frontend, local server, acquisition owner, signal, generator, recorder, storage reader, and CLI. Shared contracts describe settings, telemetry, metadata, and process messages. |
| A large native stylesheet                       | Valid technology, but an unnecessary maintenance burden for this React application and contrary to the user's preference.                   | Tailwind handles layout, spacing, theme utilities, and responsive behavior. Shared instrument typography and detail styles remain CSS. No component library.                                              |
| Treating JSX as a stack alternative             | JSX is syntax, not an alternative to TypeScript.                                                                                            | React components use TSX. Type checking is an explicit local and CI command.                                                                                                                              |
| Showing zero before telemetry arrives           | Could present an unmeasured value as a measurement.                                                                                         | Display an em dash until a count arrives. The browser check waits for a genuinely positive count.                                                                                                         |
| Server startup errors only logged               | Could incorrectly return a successful process exit.                                                                                         | Set a nonzero exit code on a server listen error.                                                                                                                                                         |
| Relying on the two-second exploratory run       | It proves only the exercised behavior, not sustained reliability.                                                                           | Preserve exact short-run evidence separately from long-run, overload, and integrity-fault validation. Later tickets remain open.                                                                          |

## Decisions retained

| Decision                                             | Reason and consequence                                                                                                                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 24 + Next.js/React, one repository           | Matches the requested frontend and assessment runtime. Node executes erasable TypeScript directly; Next builds TSX. No runtime transpiler or second backend build pipeline.                                                                    |
| Independent generator and recorder OS processes      | Required isolation and independent source pacing. Tests inspect distinct process IDs and clean shutdown.                                                                                                                                       |
| One acquisition owner outside Next page modules      | Reloads and repeated requests must not create competing recorders. CLI and server share the owner; Start reserves it synchronously.                                                                                                            |
| Persistent local custom server                       | Long-running child processes, SSE, and files need a persistent Node host. One launch command after installation/build. This is not a serverless deployment architecture.                                                                       |
| Local disk, no Supabase                              | A cloud database does not replace the required recorder or binary data path. No accounts, ORM, schema setup, or remote dependency for the reviewer.                                                                                            |
| HTTP commands + SSE, no Yjs                          | This is instrument control and telemetry, not collaborative editing. State updates are coalesced; slow subscribers are disconnected.                                                                                                           |
| Source clock continues when credit runs out          | Throttling would conceal overload. Fixed byte credits, original frame indices, and explicit lost intervals preserve evidence. Comprehensive overload proof remains T05.                                                                        |
| Indexed binary frames + JSON metadata                | Simple append, compact storage, independent interpretation, and bounded range lookup. Default records are 136 bytes, about 1.9584 GB/hour. Channel selection still reads the other channels in those frames; retain this documented trade-off. |
| Deterministic float32 waveform                       | Allows exact reproduction without storing a second expected signal. Preserve the waveform and file format during migration; check independent reference values.                                                                                |
| Bounded React telemetry; Canvas for future traces    | Avoid putting every raw sample through React state. T01 shows actual metrics; T12 adds bounded waveform rendering.                                                                                                                             |
| Graphite instrument design                           | Fits the measurement workflow. Preserve focus states, readable labels, restrained colors, narrow-screen controls, and reduced-motion behavior.                                                                                                 |
| Completed differs from verified                      | File finalization does not establish integrity. Completion explicitly says integrity has not yet been verified.                                                                                                                                |
| CLI/file tests first, small production-browser suite | Exercises real process and disk boundaries instead of mocking them away. Type checking complements behavioral tests.                                                                                                                           |
| Local handoff before hosting                         | Matches the user's deadline and stated priority. A repository and demonstration video remain required handoff work; public hosting remains optional and last.                                                                                  |
| T01 followed by individual dependent phases          | The user explicitly requested phased execution. Keep tickets for traceability without additional approval ceremonies or premature features.                                                                                                    |
| Basic validation, no enterprise infrastructure       | Generated IDs and clear input errors support correctness. Auth, organizations, billing, distributed services, and speculative security work add no assessment value.                                                                           |

## Build tooling

The production build uses Next's supported Webpack option. Turbopack failed here while binding its
PostCSS worker port; Webpack compiled the same TypeScript/Tailwind source and passed the
production-browser suite. This introduces no additional bundler dependency and makes the documented
build command reproducible in this environment.

## Limits and follow-through

Playback and verification remain JavaScript drafts, with imports updated and playback callback types
annotated for the TypeScript CLI. Their fuller implementation and typing belong to their acceptance
tickets. This migration does not establish their correctness.

TypeScript checks internal contracts at build time; it does not validate arbitrary runtime JSON.
Existing configuration validation and the T01 HTTP contract remain in place. Corruption validation
remains explicit later acceptance work.

The audit does not claim sustained losslessness, exhaustive recovery, full assessment completion, or
hosting success. The evidence report and PR checks record what actually passes. T01 is complete only
once its acceptance gates pass and its PR is merged.
