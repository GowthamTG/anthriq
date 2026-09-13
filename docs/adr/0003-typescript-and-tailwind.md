# Use strict TypeScript and Tailwind for the active application

The user explicitly corrected the original JavaScript/native-CSS choice: minimizing development
dependencies should not outweigh maintainable contracts and familiar frontend tooling. Use strict
TypeScript throughout the active T01 path, shared types for settings/IPC/metadata, TSX for React,
and Tailwind for responsive layout; retain small shared instrument styles and system fonts. Node.js
24 runs erasable TypeScript directly, preserving the simple CLI and child-process launch model
without a runtime transpiler.

This amends the language/styling choice in SPEC.md implementation decision 1 and the T01 plan. The
parent specification remains unchanged as requested. ADRs 0001–0002 still apply: process boundaries,
local storage, source pacing, transport bounds, waveform, and file format are preserved. See
`docs/decision-audit.md` for the broader review and remaining draft boundaries.
