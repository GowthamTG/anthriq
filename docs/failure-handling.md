# Stop and failure behavior

Stop from the browser, CLI SIGINT/SIGTERM, and application shutdown share one acquisition owner. The source stops on its monotonic timeline and sends an ordered final expected frame extent. The recorder drains accepted batches, writes loss intervals including any tail, syncs frame and loss files, closes files, and waits for the generator to exit successfully before atomically replacing final metadata. The owner reports completion only after receiving final metadata and observing recorder closure. The UI displays **Stopping** during drain; a second Start remains a conflict.

A Stop request or timed source completion starts a **ten-second drain deadline**. Repeated requests do not reset it. The recorder also has its own deadline, covering loss of its parent. If normal finalization cannot finish in time, the owner forcibly terminates owned children and reports failure. This is a normal local-process bound, not a guarantee against an unresponsive OS or filesystem. A deliberately large diagnostic write delay can exceed this limit even when no hardware has failed.

Unexpected recorder death triggers direct generator cleanup, including a suspended generator that cannot react to IPC disconnection. Generator exit, recorder IPC loss, failed writes, and failed metadata finalization never produce a successful acquisition result. The original cause remains visible in the workbench and saved inspection when failure metadata can be persisted. Closing or reloading the browser only detaches telemetry; it does not stop the acquisition. SIGINT/SIGTERM of the application does stop it.

Failure cleanup closes file handles and records physical complete-frame counts. A partial trailing record stays on disk and is excluded from the readable prefix. A final expected extent received from the source is retained even if drain later fails; when it was never received, it stays null and duration/completeness remain unknown. Recorded frame count is never substituted for expected extent. Failed captures cannot receive PASS from the existing CLI verification check.

Failure metadata is written only for the bundle owned by that recorder PID. A failed attempt to reopen an existing recording does not overwrite it. If the filesystem also prevents writing failure metadata, the workbench/CLI reports that secondary error; previously saved metadata may remain in-progress, and inspection warns that it is not finalized. No claim is made that failure metadata can be persisted on a full, read-only, missing, or unresponsive filesystem.

Clean Stop syncs frame and loss data, then uses temporary-file replacement for metadata. This does **not** promise transactional durability across power loss, directory-entry fsync, automatic crash resume, or recovery of data that never reached disk. Abrupt termination of the entire process tree can leave initial metadata and a readable physical prefix. No scan rewrites old recordings automatically on application startup.

## Reproducing the checks

Run `npm test`, then `npm run build` and `npm run test:browser`. `tests/failures.test.mjs` launches the real CLI, recorder and generator and reads the resulting files through CLI inspection. It exercises process termination, SIGINT/SIGTERM around delayed writes, partial writes, ENOSPC, finalization failure, IPC loss, and timeout with known extent. Production Chromium tests cover Stop timeout with unknown extent, stopping during drain, persistent failure display, and application shutdown.

`tests/fixtures/disk-fault.mjs` is a test-only Node preload, not a production setting. It keeps real file handles and processes while forcing 17-byte short writes, an ENOSPC after 141 frame bytes, or a denied final metadata rename. This controls OS I/O outcomes without filling the developer's disk. Production modules have no fault-injection switches. Signal tests use POSIX signals; macOS and Ubuntu are covered, Windows is not claimed.

See [T04 evidence](evidence/t04/README.md). Sustained overload and the one-hour benchmark remain separate tickets.
