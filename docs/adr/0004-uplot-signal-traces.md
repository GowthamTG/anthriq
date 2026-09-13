# Use uPlot behind one signal-trace module

Use `uplot` 1.6.32 as the Canvas renderer for bounded playback and future live-acquisition signal
traces. Keep it behind one client-only signal-trace module whose interface uses domain values:
channel identities, indexed observations, sample rate, decimation, next index, and optional
confirmed extent. Callers do not configure uPlot or depend on its data layout.

The module owns aligned-series conversion, missing-interval breaks, axes, cursor formatting, stable
channel colors, rolling-window bounds, responsive sizing, update coalescing, and lifecycle cleanup.
Server playback state and acquisition transport remain independent of the renderer. Browser state
continues to contain only bounded previews rather than full-rate samples.

uPlot fits the accepted large-Canvas waveform direction and provides time-series axes, missing-data
support, cursors, and streaming updates with a small MIT-licensed implementation. Highcharts was
rejected because production and commercial use can require a paid license. D3 was rejected for this
module because it supplies visualization primitives rather than the complete time-series chart
behavior, leaving axes, cursor interaction, resizing, and accessibility integration custom-built. No
React wrapper is used; the chart is a dynamically loaded client leaf with direct, explicit creation
and destruction.

The chart remains observational until T11. Zoom, selection, seeking, speed controls, and channel
controls are not enabled by this decision. T14 remains responsible for the complete accessible
instrument workflow; the current chart retains textual channel values, window bounds, gap count, and
decimation context alongside its Canvas output.
