# T18 public-demo evidence

Status: deployment-ready; public URL not yet published.

## Dependency and implementation

- GitHub issue #18 (T17) was confirmed closed on September 15, 2026.
- GitHub issue #19 (T18) was confirmed open with `ready-for-agent`.
- Implementation commit: `2dc0855` on `codex/t18-public-demo`.
- Pull request: [#55](https://github.com/GowthamTG/anthriq/pull/55).

The production code provides the real hosted acquisition pipeline with explicit caps, rate limits,
temporary-bundle rotation, diagnostic restrictions, path redaction, runtime disclosure, and a
readiness endpoint. Local operation remains the default and retains its prior behavior.

## Verified locally

| Gate                                              | Result           |
| ------------------------------------------------- | ---------------- |
| Node functional suite                             | PASS — 100 tests |
| Browser suite                                     | PASS — 39 tests  |
| Hosted capture → playback → physical verification | PASS             |
| Same-root process restart persistence             | PASS             |
| Hosted input restrictions and scenario denial     | PASS             |
| Hosted API throttling and `Retry-After`           | PASS             |
| Hosted path redaction                             | PASS             |
| TypeScript                                        | PASS             |
| Prettier                                          | PASS             |
| Production build                                  | PASS             |

The hosted browser workflow used a production build, an explicit public bind, a temporary recording
root, a genuine timed acquisition, and the normal verification worker. Restart persistence reused
the same recording root across two server processes.

## Remaining publication gate

Railway account login and GitHub repository access succeeded: `GowthamTG/anthriq` is visible in the
service-creation picker. Railway then reports that this account's trial has expired and requires a
plan selection before it will create or run the service. No paid plan was selected, no volume or
public URL was claimed, and the free-only publication gate therefore remains blocked.

If a Railway plan is explicitly authorized, complete the deployment and remote checks in
`docs/hosting.md`; replace this status with the verified URL, deployed commit, region,
restart-persistence result, peak memory, and observed cold-start time. Without that authorization,
the expired trial/free quota is the T18 deferral reason and the T17 local handoff remains
authoritative.
