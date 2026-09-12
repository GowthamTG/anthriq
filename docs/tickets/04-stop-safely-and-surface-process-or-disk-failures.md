# [T04] Stop safely and surface process or disk failures

Published: [GitHub issue #5](https://github.com/GowthamTG/anthriq/issues/5). Publication label: `ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

Stopping, interrupting, or losing a child process produces a truthful final state, preserves readable data, and never leaves the operator waiting indefinitely.

Scope traceability: user stories 17, 18, 19, 49, 50; acceptance scenarios A08, A09, A10, A28 in the parent specification.

## Acceptance criteria

- [ ] Implement coordinated UI/CLI Stop, SIGINT, and SIGTERM: end generation, receive ordered final expected extent, drain accepted batches, account for the tail, sync data/loss information, finalize metadata, and close children.
- [ ] Keep the workbench in stopping while draining; completion is emitted only after successful finalization. Repeated stops are safe and no new start can take ownership while shutdown is in progress.
- [ ] Handle short writes serially. Return transport credits only after complete batch writes, and use atomic metadata replacement where supported.
- [ ] Detect generator exit, recorder exit, IPC disconnection, write failure, disk exhaustion, and finalization failure. Show the actionable cause and preserve an inspectable prefix without a false completed/verified result.
- [ ] Use a documented bounded timeout for unresponsive shutdown. Timeouts end in failure with completeness explicitly unknown when the final source extent cannot be obtained.
- [ ] Ensure application shutdown cleans up owned children and pending handles; browser disconnection alone does not stop acquisition.
- [ ] Test real-process interrupt before and during writes, unexpected child termination, and controlled I/O failure without filling the developer's disk. Assert bounded termination, final states, and readability rather than private queue details.
- [ ] Document clean-stop syncing, partial-write readability, and the limit that power-loss transactional durability and automatic crash resume are not promised.

## Blocked by

- #2: [T01] Launch locally, capture a nominal signal, and inspect the saved result
