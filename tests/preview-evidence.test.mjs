import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreviewEvidence } from '../scripts/preview-evidence.mjs';

test(
  'live preview extrema independently match persisted lifecycle prefixes',
  { timeout: 20000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'scope-preview-evidence-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const result = await runPreviewEvidence({ recordingsRoot: root });

    assert.equal(result.result, 'PASS');
    assert.deepEqual(
      result.states.map((state) => state.label),
      ['recording', 'stopping', 'completed', 'completed-with-loss', 'readable-failed-prefix'],
    );
    assert.ok(result.states.every((state) => state.availability === 'available'));
    assert.ok(result.states.every((state) => state.buckets.length > 0));
  },
);
