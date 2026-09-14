# Public demonstration hosting

The public demonstration is an optional, best-effort assessment aid. It runs the same independent
generator, recorder, binary persistence, playback, and verification workers as the local app. It is
not a static simulation and does not replace the reproducible local handoff.

## Selected assessment host: Railway Free

Railway Free provides one service, up to 0.5 GB RAM, and one 0.5 GB persistent volume. The monthly
allowance is small and free deployments can be delayed during regional peak hours, so the URL must
be described as assessment-window and best-effort. A paid Render web service with a persistent disk
is the recommended longer-lived alternative, but Render persistent disks are not available on free
compute.

Create one Railway service from this repository's `main` branch and configure:

| Setting                | Value                         |
| ---------------------- | ----------------------------- |
| Build command          | `npm ci && npm run build`     |
| Start command          | `npm start`                   |
| Health check           | `/healthz`                    |
| Replicas               | `1`                           |
| Public networking      | Generated Railway HTTP domain |
| Volume                 | One volume mounted at `/data` |
| `SCOPE_HOST`           | `0.0.0.0`                     |
| `SCOPE_RECORDINGS_DIR` | `/data/recordings`            |
| `SCOPE_DEMO_MODE`      | `public`                      |

Enable Railway Serverless sleeping to conserve the free allowance. Requests are queued while the
service wakes. An attached volume prevents overlapping deployments, so a deploy or maintenance
restart can briefly interrupt the demo. Node 24 is selected by this repository's `engines` range and
`.nvmrc`.

No token, password, Railway identifier, or GitHub credential belongs in the repository. Railway
account and repository authorization remain owner-managed dashboard state.

## Hosted safety policy

- Captures last 1–5 seconds and are limited to 32 channels, 4,000 frames/second, and a 4 MiB
  recorder buffer. Continuous captures and recorder fault diagnostics are rejected.
- Six acquisition starts and twelve physical verification starts are allowed per rolling hour per
  running service. Existing SSE limits continue to protect live observers.
- At most twelve recording bundles are retained. Before accepting another capture, the oldest
  finalized bundle that is not active in acquisition, verification, or playback is removed.
- Disposable integrity scenarios are disabled. Verification of genuine acquisitions remains
  available.
- Public inspection responses identify persistent hosted storage without exposing its absolute
  filesystem path.
- The service is intentionally single-owner and shared. Visitors can observe or affect the same
  acquisition, playback, and verification state; this is disclosed in the interface.

Local mode is the default. Without `SCOPE_DEMO_MODE=public`, the original configuration range,
diagnostic scenarios, local paths, and continuous acquisition behavior remain available.

## Publication gate

Publish a URL only after a clean browser completes a three-second, 32-channel, 4,000 Hz acquisition,
plays the saved frames, receives verification `PASS`, and sees the same bundle after a service
restart or redeploy. Also confirm hosted rejections, path redaction, memory below 0.5 GB, and a
successful wake from sleep. Record the commit, region, observed wake time, and verification result
under `docs/evidence/t18/` without secrets.

If the Railway account cannot deploy publicly, the free allowance cannot sustain the assessment
window, or the 0.5 GB runtime limit is exceeded, do not publish an unverified URL. Record that exact
constraint and retain the local repository and T17 video as the submission.

## Operations and decommissioning

Use Railway metrics to watch memory, CPU, volume usage, and remaining monthly allowance. A `429`
response includes `Retry-After`; a `507` means every removable slot is temporarily protected or the
volume needs owner attention. Check deploy logs when `/healthz` does not become ready.

After the assessment window, remove public networking or suspend the service. Delete the Railway
project and volume only when its temporary recordings are no longer needed; volume deletion is the
irreversible decommissioning step.
