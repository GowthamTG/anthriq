# T09 — streamed export evidence

Scope: [issue #10](https://github.com/GowthamTG/anthriq/issues/10). CSV uses the same selection and physical reader as [range retrieval](../../recording-format.md#range-retrieval).

## Checks

- Core fixtures verify CSV headers, time units, selected-channel ordering, empty ranges, and preservation of gaps and duplicates.
- Browser coverage verifies the validated recording-detail download and attachment name.
- The service streams rows with output backpressure; disconnecting a download ends the iterator and closes its frame reader.

## Limits

The browser’s range preview remains limited to 200 observations. CSV downloads and JSON-lines retrieval are streamed and can represent the full selected raw range. CSV is an export view, not a repair or verification result.
