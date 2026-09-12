# [T18] Optionally publish an easy-to-run public demo after local delivery

Published: [GitHub issue #19](https://github.com/GowthamTG/anthriq/issues/19). Publication label: `ready-for-agent`. GitHub is authoritative for current status and dependencies.

## Parent

https://github.com/GowthamTG/anthriq/issues/1

## What to build

Only after the assessment handoff is complete, evaluate a straightforward public demonstration and publish it if the hosting model can honestly support the product without jeopardizing delivery.

Priority: optional; not required for the local assessment submission.

Scope traceability: user stories 56; optional hosting follow-up in the parent specification.

## Acceptance criteria

- [ ] Treat this as optional, lowest-priority work and not a gate for local submission. Start only after the completed local handoff ticket.
- [ ] Check for a straightforward authorized host that supports long-running Node.js processes and persistent recording disk; a static site/serverless function alone must not be described as the complete acquisition system.
- [ ] If a workable host is available within existing authorization and budget, deploy and verify the actual capture, playback, and verification flow, then document host limits and persistence behavior.
- [ ] Keep local reproduction working and do not expose credentials, arbitrary local paths, or unrestricted resource consumption in a public instance.
- [ ] If hosting requires substantial redesign, unavailable credentials, or unapproved cost, document the specific reason and defer it; the already delivered local app and video remain the submission.
- [ ] Publish a public URL only when actually verified. Do not use a simulated or prerecorded interface while claiming it is live acquisition.

## Blocked by

- #18: [T17] Deliver a reproducible repository and complete demonstration video
