# Read persisted all-channel overviews outside SSE

Show every recorded channel through a separate, bounded persisted-overview read rather than widening
the recorder's four-channel preview or its SSE events. Limit each overview to 2,048 scalar values
and 64 uniformly sampled frames so 32 channels remain useful while recorder work, reconnect
behavior, and the event-buffer ceiling stay unchanged; the trade-off is that this overview shows
sampled shapes, not the detailed min/max envelope or full-rate stream.
