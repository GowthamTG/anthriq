import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYBACK_LIMITS } from '../core/playback.ts';
import { RANGE_READ_CHUNK_BYTES } from '../core/storage.ts';
import { validateJsonSchema } from './validate-json-schema.mjs';

const schemaDirectory = resolve('docs/evidence/t16');

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function validateFile(directory, name, schemaName) {
  const [document, schema] = await Promise.all([
    json(join(directory, name)),
    json(join(schemaDirectory, schemaName)),
  ]);
  validateJsonSchema(document, schema);
  return document;
}

export async function validateLongRecordingEvidence(directory = 'docs/evidence/t16') {
  const output = resolve(directory);
  const [summary, verification, text, measurementSchema] = await Promise.all([
    validateFile(output, 'summary.json', 'summary.schema.json'),
    validateFile(output, 'verification.json', 'verification.schema.json'),
    readFile(join(output, 'measurements.jsonl'), 'utf8'),
    json(join(schemaDirectory, 'measurement.schema.json')),
  ]);
  let measurements = 0;
  for (const [index, line] of text.split('\n').entries()) {
    if (!line) continue;
    validateJsonSchema(JSON.parse(line), measurementSchema, `measurements.jsonl:${index + 1}`);
    measurements++;
  }
  assert.ok(measurements > 0, 'measurements.jsonl must contain observations');
  assert.equal(summary.result, 'PASS');
  assert.equal(verification.result, 'PASS');
  assert.equal(summary.recording.id, verification.recordingId);
  assert.deepEqual(summary.recording.checkedFiles, verification.checkedFiles);
  assert.equal(summary.verification.recordsScanned, summary.recording.expectedFrames);
  assert.equal(summary.verification.formatErrors, 0);
  assert.equal(summary.verification.discrepancySamples, 0);
  assert.equal(summary.bounds.rangeReadBytes, RANGE_READ_CHUNK_BYTES);
  if (summary.workloadConfiguration.profile === 'full') {
    assert.equal(summary.t15Reference.identityMatched, true);
    assert.equal(summary.t15Reference.platformContext.matched, true);
  }
  assert.deepEqual(summary.bounds.playback, PLAYBACK_LIMITS);
  assert.ok(summary.retrieval.every((item) => item.measured.length === 5));
  assert.ok(
    summary.retrieval.every(
      (item) => item.frameMajorChannelReadAmplification === summary.expectedAmplification.value,
    ),
  );
  assert.equal(
    summary.export.frameMajorChannelReadAmplification,
    summary.expectedAmplification.value,
  );
  assert.ok(summary.export.memoryWindows.every((window) => window.measurements > 0));
  assert.ok(summary.playback.cases.every((item) => item.withinEngineeringTolerance));
  assert.equal(summary.playback.transitions.noStaleOutputAfterSeek, true);
  assert.equal(summary.playback.slowSink.noDroppedOrDuplicatedOutput, true);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ?? 'docs/evidence/t16';
  await validateLongRecordingEvidence(directory);
  process.stdout.write(`${directory} matches the T16 evidence schemas and invariants\n`);
}
