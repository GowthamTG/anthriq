# Preserve source timing with bounded transport and indexed binary frames

The user accepted a fixed recording buffer with explicitly accounted overload loss rather than
allowing the recorder to throttle the source. Use byte credits returned after disk-write completion,
and retain the original frame index in every record so gaps, duplicates, and the acquisition
timeline remain observable. The generator supplies an independent final expected extent so trailing
loss cannot masquerade as a complete recording.

Use fixed-width frame-major binary records containing a little-endian uint64 index followed by
float32 channel values, with JSON metadata. This makes append, truncation handling, and
binary-search seeking straightforward. The accepted trade-off is reading unselected channel bytes
within the requested time window; a channel-blocked format would reduce those reads but complicate
the implementation. This layout costs about 1.9584 GB for one hour at the default configuration,
including frame indices.
