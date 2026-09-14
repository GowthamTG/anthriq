import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { format } from 'prettier';

const execute = promisify(execFile);
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};

const recordingRootOption = option('--recording-root');
assert.ok(recordingRootOption, 'Provide --recording-root for the retained issue #36 bundles');
const summaryPath = resolve(option('--summary', 'docs/evidence/issue-36/summary.json'));
const recordingRoot = resolve(recordingRootOption);
const output = resolve(option('--output', 'docs/evidence/t15/browser-verification.json'));

const source = JSON.parse(await readFile(summaryPath, 'utf8'));
assert.equal(source.result, 'PASS');
const cases = [];
for (const item of source.cases) {
  const { stdout } = await execute(
    process.execPath,
    ['core/cli.ts', 'verify', join(recordingRoot, item.recordingId)],
    { maxBuffer: 1024 * 1024 },
  );
  const verification = JSON.parse(stdout);
  assert.equal(verification.result, 'PASS', item.name);
  assert.equal(verification.recordingId, item.recordingId, item.name);
  assert.equal(verification.counts.expectedFrames, item.expectedFrames, item.name);
  assert.equal(verification.counts.recordedFrames, item.persistedFrames, item.name);
  assert.deepEqual(verification.discrepancies, {
    missing: { samples: 0, first: null },
    duplicated: { samples: 0, first: null },
    incorrect: { samples: 0, first: null },
  });
  assert.equal(verification.formatErrors.count, 0, item.name);
  cases.push({ name: item.name, verification });
}

const report = {
  format: 'SCOPE-T15-BROWSER-VERIFICATION/1',
  createdAt: new Date().toISOString(),
  sourceEvidence: 'docs/evidence/issue-36/summary.json',
  cases,
  result: 'PASS',
};
await writeFile(output, await format(JSON.stringify(report), { parser: 'json' }));
process.stdout.write(`${output} verifies ${cases.length} retained browser-comparison recordings\n`);
