# Keep acquisition in independent local Node.js processes

The assessment requires an independently paced generator, a separate recorder, and disk persistence.
Use plain Node.js processes and local files for that core, with a Next.js/React interface receiving
bounded previews and metrics. The user accepted this direction and the recommendation to omit
services without an assessment role, so Supabase and Yjs are excluded; one-command local execution
and a demonstration video are the primary delivery, while public hosting remains a last-priority
extension.

This keeps the required process and disk behavior directly testable and avoids extra service setup.
The trade-off is that a public website alone cannot demonstrate the complete acquisition system
without a host that also supports long-running processes and persistent disk.
