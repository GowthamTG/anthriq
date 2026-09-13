# T12 — live traces and acquisition health

The Acquire view displays a bounded two-second recorder-side preview of persisted frames. Each of at
most 256 buckets carries the selected channels' observed minimum and maximum values; it is not a
regenerated waveform or a claim that every screen point is stored separately.

Recorder status remains coalesced at 100 ms and is acknowledged by the acquisition owner before
browser delivery. The preview has no effect on byte credits, queue capacity, disk persistence, or
the final recording result. T13 subsequently makes selection browser-session-specific; it preserves
the same persisted-frame provenance and bounds.
