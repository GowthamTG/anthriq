# T18 public-demo evidence

Status: published. Live at https://anthriq-production.up.railway.app.

## Dependency and implementation

- GitHub issue #18 (T17) was confirmed closed on September 15, 2026.
- GitHub issue #19 (T18) was confirmed open with `ready-for-agent`.
- Implementation commit: `2dc0855` on `codex/t18-public-demo`.
- Deployed commit: `bb6af6d` on `codex/t18-public-demo` (merged to `main`).
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

## Published deployment

The Railway account's free trial had previously expired; the account was upgraded to the Railway
Hobby plan (paid, $5/month minimum usage) before this deployment, and that upgrade is reflected in
Railway's own billing history. With the plan active, the service was created from
`GowthamTG/anthriq` on `codex/t18-public-demo` and configured per `docs/hosting.md`: build command
`npm ci && npm run build`, start command `npm start`, health check `/healthz`, a generated public
domain, a 0.5 GB-limited persistent volume mounted at `/data`, `SCOPE_DEMO_MODE=public`,
`SCOPE_HOST=0.0.0.0`, `SCOPE_RECORDINGS_DIR=/data/recordings`, and Railway Serverless sleep-on-idle
enabled.

| Gate                                                            | Result                                                                                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL                                                             | https://anthriq-production.up.railway.app                                                                                                           |
| Region                                                          | Southeast Asia (Singapore)                                                                                                                          |
| Runtime                                                         | node@24.21.0                                                                                                                                        |
| Live 3-second, 32-channel, 4,000 Hz acquisition                 | PASS — 0 lost frames                                                                                                                                |
| Playback of saved frames                                        | PASS — 12,000/12,000 frames emitted                                                                                                                 |
| Verification                                                    | PASS — 0 missing/duplicated/incorrect, 98 ms elapsed                                                                                                |
| Peak RSS observed during capture/verification                   | ~92 MiB (well under the 0.5 GB target)                                                                                                              |
| Same recording bundle present after a full redeploy             | PASS (recording `c0211e56…` survived a container replacement on the same volume)                                                                    |
| Hosted disclosure banner and disposable-scenario denial visible | PASS                                                                                                                                                |
| Hosted response path redaction                                  | PASS — no absolute filesystem paths shown                                                                                                           |
| Wake time from a serverless sleep                               | Not independently timed this session (the service was kept warm throughout testing); the Serverless toggle is confirmed enabled in Railway settings |

GitHub Actions `smoke` and the Railway deploy check both report `SUCCESS` on the deployed commit.
`Demo.mov` and the T17 local evidence remain untouched and authoritative for the reproducible local
handoff; this hosted URL is a best-effort, shared, assessment-window addition on top of that
baseline.
