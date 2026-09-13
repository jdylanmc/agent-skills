import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateRepository } from '../../../../scripts/validate-skill-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MOLECULE = '_base/_molecules/roast-coordinate-review/roast-coordinate-review.md';

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, 'skills', relativePath), 'utf8');
}

/**
 * This molecule is shared, so it is tested without reference to any consumer.
 * A consumer proves it composes this shape in its own conformance suite. If
 * this file asserted who its callers are, the shared unit would fail every
 * time a caller was renamed, which is the coupling `_base` exists to avoid.
 */

test('the molecule composes exactly the two atoms it orchestrates', () => {
  const result = validateRepository(ROOT);
  assert.deepEqual(result.graph.get(MOLECULE), [
    '_base/_atoms/agent-spawn/agent-spawn.md',
    '_base/_atoms/review-validate-report/review-validate-report.md',
  ]);
});

test('the molecule preserves the strict coordinate and synthesize contract', () => {
  const molecule = read(MOLECULE);
  const normalized = molecule.replace(/\s+/g, ' ').toLowerCase();
  for (const required of [
    'response exactly as returned',
    'Retry exactly once',
    'new Agent spawn carrying no failed-run context',
    'Status: Unsynthesized',
    'Do not run synthesis on an invalid envelope',
    'valid envelope unchanged',
    'Schema version: 1',
    'empty findings section is not evidence of quality',
    'first-line rule',
    'section cardinality',
    'cross-section relationship',
    'nested report contract',
    'forbidden-content rule',
    'unevaluable rule',
  ]) {
    assert.ok(
      normalized.includes(required.toLowerCase()),
      `missing shared requirement: ${required}`,
    );
  }
});

test('the molecule decides nothing its caller owns', () => {
  const molecule = read(MOLECULE).replace(/\s+/g, ' ');
  for (const boundary of [
    'does not resolve or verify the coordinator',
    'does not stage evidence',
    'choose a recovery action',
    'may not infer, broaden, normalize, repair, or replace them',
  ]) {
    assert.ok(molecule.includes(boundary), `missing boundary: ${boundary}`);
  }
});

test('the validator can represent the complete envelope checklist', () => {
  const validator = read('_base/_atoms/review-validate-report/review-validate-report.md');
  for (const input of [
    'required-first-line',
    'required-values',
    'section-constraints',
    'cross-section-constraints',
    'nested-report-contracts',
    'forbidden-content',
  ]) {
    assert.match(validator, new RegExp(`\`${input}\``), `missing validator input ${input}`);
  }

  for (const defect of [
    'First-line mismatch',
    'Value mismatch',
    'Cardinality violation',
    'Cross-section mismatch',
    'Mutual-exclusion violation',
    'Invalid nested report',
    'Forbidden content',
    'Unevaluable requirement',
  ]) {
    assert.match(validator, new RegExp(defect), `missing validator defect ${defect}`);
  }
});
