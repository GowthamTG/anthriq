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

| Gate                                          | Result           |
| --------------------------------------------- | ---------------- |
| Node functional suite                         | PASS — 100 tests |
| Browser suite                                 | PASS — 38 tests  |
| Hosted capture → physical verification        | PASS             |
| Same-root process restart persistence         | PASS             |
| Hosted input restrictions and scenario denial | PASS             |
| Hosted path redaction                         | PASS             |
| TypeScript                                    | PASS             |
| Prettier                                      | PASS             |
| Production build                              | PASS             |

The hosted browser workflow used a production build, an explicit public bind, a temporary recording
root, a genuine timed acquisition, and the normal verification worker. Restart persistence reused
the same recording root across two server processes.

## Remaining publication gate

Railway account login succeeded, but service creation requires configuring the Railway GitHub App to
read `GowthamTG/anthriq`. That repository-access permission awaits explicit owner approval. No
Railway project, volume, or public URL has been claimed or created yet.

After authorization, complete the deployment and remote checks in `docs/hosting.md`; replace this
status with the verified URL, deployed commit, region, restart-persistence result, peak memory, and
observed cold-start time. If authorization or the free quota remains unavailable, this precise
constraint is the T18 deferral reason and the T17 local handoff remains authoritative.
