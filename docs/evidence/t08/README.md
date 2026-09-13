# T08 — range inspection evidence

Scope: [issue #9](https://github.com/GowthamTG/anthriq/issues/9). The recording format and retrieval
contract are documented in [recording format](../../recording-format.md).

## Checks

- Strict TypeScript checking and the production build pass.
- Reader/CLI fixtures cover half-open index and fractional-time ranges, empty/end ranges, ordered
  noncontiguous channels, invalid/conflicting input, gaps, duplicates, and explicit
  incomplete-prefix retrieval.
- Chromium coverage verifies the JSON-lines API and the recording-detail bounded range window.

## Limits

The detail view intentionally materializes at most 200 observations; the CLI and retrieval API
stream the full raw result. Range seeking assumes searchable nondecreasing stored indices, as
specified by the format; full verification remains the separate operation that establishes
stream-wide ordering and integrity.
