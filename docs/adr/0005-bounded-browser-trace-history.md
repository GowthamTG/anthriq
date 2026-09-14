# Keep whole-acquisition trace history bounded in the browser

Keep the recorder and SSE payload unchanged while each connected browser derives a 256-bucket
adaptive overview from its bounded persisted-frame previews. Preserve that browser-local history
across transient reconnects, reconnect with the same channel selection, and mark intervals without
preview observations as preview gaps. This retains whole-timeline context without adding work to the
recording path, retaining disconnected server sessions, backfilling from disk, or implying that a
preview gap is a missing sample; a reload can show the confirmed extent but must leave its
unavailable prefix blank. Gap ranges are also bounded: under extreme reconnect churn, nearby ranges
are conservatively coalesced at the overview's current frame resolution so no known unobserved
interval is silently forgotten.

Render the overview on a horizontally scrollable, time-scaled canvas so longer acquisitions retain
useful visual spacing. Keep adaptive bucket compaction and cap the canvas width: continuous captures
must not create unbounded browser memory or rendering work. The rolling detail's domain is always
exactly two seconds (once two seconds have elapsed), independent of transport bucket compaction.
