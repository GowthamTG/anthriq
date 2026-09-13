# T13 — browser-independent acquisition

Each SSE client is limited to four selected channels, a two-second/256-bucket persisted envelope,
and a 64 KiB outgoing-buffer ceiling. The local service permits eight observers; a backpressured
socket retains only its latest revision and is disconnected after two seconds without draining.

Preview subscriptions belong to browser sessions and are removed when their socket closes. The
recorder computes extrema only after writes complete and does not alter source credits, queue
accounting, recorded samples, or recording metadata for preview work. Reconnection receives the
current acquisition snapshot rather than an event backlog. Coalesced preview updates are explicitly
separate from source/recorder loss.
