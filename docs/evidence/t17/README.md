# T17 reproducible handoff

T17 is the final local-assessment handoff. It ties the original three-page assessment and all
A01-A30 scenarios to implementation, automated checks, compact evidence, and a concise narrated
demonstration. It does not include the assessment PDF, generated recordings, dependencies, raw logs,
or the video binary.

## Reviewer path

1. Follow the five-minute setup in the repository [README](../../../README.md).
2. Watch the
   [SCOPE T17 demonstration](https://github.com/GowthamTG/anthriq/releases/download/t17-submission/scope-t17-demo.m4v).
3. Inspect [`traceability.json`](traceability.json) for the complete requirement-to-evidence map.
4. Inspect [`rehearsal.json`](rehearsal.json) for the exact clean-clone install, build, launch,
   test, and browser-free CLI result.
5. Read the [submission checklist](submission-checklist.md) and
   [known limitations](known-limitations.md).

The repository is private. A reviewer must be granted access by the owner before the repository or
release asset will resolve; T17 does not grant unidentified users access.

## Reproduce the compact checks

```sh
npm ci
npm run evidence:validate-acquisition
npm run evidence:validate-long-recording
npm run evidence:validate-handoff
```

To repeat the complete clean-clone rehearsal from a clean Node.js 24 checkout:

```sh
npm run evidence:handoff -- \
  --source git@github.com:GowthamTG/anthriq.git \
  --ref <candidate-commit> \
  --output docs/evidence/t17 \
  --workload quiet
```

The command clones the exact ref into a disposable directory, runs every project gate, starts and
stops the production server, and exercises a real two-second default CLI workflow. Passing output is
reduced to command timings, byte counts, hashes, and checked domain results. The cloned
dependencies, recording, browser artifacts, and raw output are removed. The runtime-tree digest
excludes only this T17 evidence directory, so a later evidence-only commit cannot silently change
the rehearsed product.

## Video production

The locked owner-narrated script and shot instructions are in [`demo-script.md`](demo-script.md).
The reviewed artifact is H.264/AAC at 1920x1080, lasts five to seven minutes, and is published as a
private GitHub Release asset rather than committed to Git. [`video.json`](video.json) records its
identity, media properties, timestamps, and manual review assertions.

## Evidence boundary

T17 revalidates, but does not repeat, the one-hour T15 acquisition or T16 long-recording workloads.
Their committed evidence records the retained 1.9584 GB recording identity, platform, methods, and
results. A fresh reviewer can validate the compact artifacts without possessing that ignored binary.
