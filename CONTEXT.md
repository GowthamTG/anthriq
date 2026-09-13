# Signal Acquisition

A system for recording continuous multi-channel signals and retrieving, replaying, and checking
those recordings.

## Language

**Channel**: One independently identifiable signal in an acquisition.

**Sample**: One numeric value from one channel at a particular sample index. Aggregate sample counts
include all channels. _Avoid_: Frame

**Frame**: The values for all configured channels at the same sample index. At the default settings,
each frame contains 32 samples and 4,000 frames are produced each second. _Avoid_: Sample

**Sample index**: The zero-based position of a frame on the signal's original acquisition timeline,
independent of whether its samples were successfully recorded.

**Acquisition**: A run in which a signal is generated at its configured real-world rate and
recorded.

**Recording**: The retained signal data and the associated information needed to interpret it
independently.

**Diagnostic recording**: A disposable recording created separately from an acquisition to
demonstrate a known integrity condition. It may reuse an acquisition's signal definition but never
changes that source recording.

**Playback**: The timed emission of previously recorded samples, with a current position and a
configurable speed relative to the original sample rate.

**Missing sample**: An expected channel value that is absent from a recording.

**Duplicated sample**: An additional recorded occurrence of a channel value at an already
represented sample index, regardless of whether its numeric value is correct.

**Incorrect value**: A recorded value that differs from the deterministic expected value for its
channel and original sample index.
