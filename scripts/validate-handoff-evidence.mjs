import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HANDOFF_SCHEMA_VERSION, runtimeTreeDigest } from './handoff-evidence.mjs';
import { validateJsonSchema } from './validate-json-schema.mjs';

async function json(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function validateFile(directory, name) {
  const [document, schema] = await Promise.all([
    json(join(directory, `${name}.json`)),
    json(join(directory, `${name}.schema.json`)),
  ]);
  validateJsonSchema(document, schema);
  return document;
}

function exactIds(entries, expected, label) {
  const actual = entries.map((entry) => entry.id);
  assert.equal(new Set(actual).size, actual.length, `${label} IDs must be unique`);
  assert.deepEqual(actual.toSorted(), expected.toSorted(), `${label} coverage must be exact`);
}

function localEvidencePaths(entry) {
  return [...entry.implementation, ...entry.tests, ...entry.evidence].filter(
    (path) => !path.startsWith('http://') && !path.startsWith('https://'),
  );
}

async function requirePaths(entries, root) {
  for (const entry of entries)
    for (const reference of localEvidencePaths(entry)) {
      const path = reference.split('#')[0];
      assert.ok(path, `${entry.id}: empty evidence path`);
      await readFile(resolve(root, path));
    }
}

export async function validateHandoffEvidence({
  checkRuntimeTree = true,
  directory = resolve('docs/evidence/t17'),
  root = resolve('.'),
} = {}) {
  const [traceability, rehearsal, video] = await Promise.all([
    validateFile(directory, 'traceability'),
    validateFile(directory, 'rehearsal'),
    validateFile(directory, 'video'),
  ]);
  exactIds(
    traceability.acceptanceScenarios,
    Array.from({ length: 30 }, (_, index) => `A${String(index + 1).padStart(2, '0')}`),
    'acceptance scenario',
  );
  exactIds(
    traceability.pdfRequirements,
    Array.from({ length: 41 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`),
    'PDF requirement',
  );
  const entries = [...traceability.pdfRequirements, ...traceability.acceptanceScenarios];
  assert.ok(entries.every((entry) => ['verified', 'documented-limitation'].includes(entry.status)));
  assert.ok(entries.every((entry) => entry.reproductionCommand.length > 0));
  await requirePaths(entries, root);
  assert.equal(rehearsal.schemaVersion, HANDOFF_SCHEMA_VERSION);
  assert.equal(rehearsal.result, 'PASS');
  assert.equal(rehearsal.cli.verification.result, 'PASS');
  assert.equal(rehearsal.cli.recording.droppedFrames, 0);
  assert.equal(video.status, 'reviewed');
  assert.match(
    video.release.url,
    /github\.com\/GowthamTG\/anthriq\/releases\/tag\/t17-submission$/,
  );
  assert.match(video.asset.sha256, /^[a-f0-9]{64}$/);
  assert.ok(video.durationSeconds >= 300 && video.durationSeconds <= 420);
  assert.equal(video.width, 1920);
  assert.equal(video.height, 1080);
  assert.equal(video.audioPresent, true);
  assert.ok(video.shots.every((shot) => shot.reviewed));
  if (checkRuntimeTree) {
    const current = await runtimeTreeDigest(root);
    assert.deepEqual(current, rehearsal.source.runtimeTree, 'runtime tree differs from rehearsal');
    assert.equal(video.runtimeTreeSha256, current.sha256);
  }
  return { traceability, rehearsal, video };
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await validateHandoffEvidence();
  process.stdout.write('T17 evidence schemas, traceability, video, and runtime tree are valid\n');
}
