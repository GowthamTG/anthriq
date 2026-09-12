# [T12] Watch live channel traces with measured acquisition health

Published: [GitHub issue #13](https://github.com/GowthamTG/anthriq/issues/13). Publication label: `ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

During acquisition the operator sees real selected-channel waveforms and precise source, recorder, buffer, and timing metrics in a polished instrument view.

Scope traceability: user stories 46, 47, 48; acceptance scenarios A05, A27, A28 in the parent specification.

## Acceptance criteria

- [ ] Build the main graphite instrument composition with a large Canvas waveform area, stable restrained channel colors, readable typography, compact configuration/controls, and monospaced numeric telemetry.
- [ ] Send bounded, decimated previews of actual acquired data separately from recording transport. Never put every raw sample through React state or recreate the signal to fake a live trace.
- [ ] Maintain a fixed rolling window and output point budget tied to display width and selected channels. Prefer a min/max envelope for dense samples; label the view as decimated.
- [ ] Make every configured channel selectable while showing a manageable initial subset. Label channels, original time/index context, and normalized amplitude without inventing volts.
- [ ] Show measured source elapsed time, scheduled/emitted/persisted/lost counts, buffer use/high-water, process memory, and pacing metrics with explicit units and truthful unknown/error states.
- [ ] Coalesce preview/status messages with bounded control traffic. A slow paint or backgrounded browser never makes the recorder wait.
- [ ] Test full default-rate capture with the visualizer active, channel changes, empty/starting/stopping states, bounded retained points, and real-data correspondence.
- [ ] Visually inspect desktop and narrower views and add keyboard-accessible channel controls. Leave reconnect stress and whole-product polish to their dependent tickets.

## Blocked by

- #3: [T02] Configure acquisitions and reproduce exact signal values
