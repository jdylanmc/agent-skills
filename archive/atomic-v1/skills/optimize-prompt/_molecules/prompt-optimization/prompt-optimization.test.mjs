/**
 * Tests for deterministic diff and ledger reconciliation.
 *
 * These are the behavioural tests the prose cannot provide. The package's
 * whole safety argument is that an undisclosed change cannot survive
 * reconciliation, and that argument is only as good as this file.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OptimizationError,
  diffPrompts,
  reconcile,
  renderDiff,
  verifyGrounding,
  verifyRedaction,
} from './prompt-optimization.mjs';

const ORIGINAL = [
  'You are a release assistant.',
  'Summarise the changes for the release notes.',
  'Never include unreleased work.',
  'Cite the pull request number for every claim.',
].join('\n');

function entry(overrides) {
  return {
    id: 'C1',
    location: 'line 2',
    problem: 'vague instruction',
    grounding: 'optimizer-judgement',
    before: 'Summarise the changes for the release notes.',
    after: 'Summarise merged changes for the release notes, grouped by component.',
    classification: 'safe',
    rationale: 'names the grouping the reader expects',
    ...overrides,
  };
}

test('an identical prompt produces no changes and reconciles', () => {
  const diff = diffPrompts(ORIGINAL, ORIGINAL);
  assert.deepEqual(diff.hunks, []);

  const result = reconcile(diff, []);
  assert.equal(result.status, 'reconciled');
  assert.equal(result.materialChanges, 0);
});

test('a disclosed replacement reconciles', () => {
  const improved = ORIGINAL.replace(
    'Summarise the changes for the release notes.',
    'Summarise merged changes for the release notes, grouped by component.',
  );

  const diff = diffPrompts(ORIGINAL, improved);
  assert.equal(diff.hunks.length, 1);

  const result = reconcile(diff, [entry()]);
  assert.equal(result.status, 'reconciled');
  assert.equal(result.materialChanges, 1);
  assert.deepEqual(result.undisclosed, []);
  assert.deepEqual(result.fabricated, []);
});

test('a silently dropped constraint is caught as undisclosed', () => {
  // The failure that matters: concision quietly removes a safety line, and the
  // ledger only mentions the harmless rewording.
  const improved = [
    'You are a release assistant.',
    'Summarise merged changes for the release notes, grouped by component.',
    'Cite the pull request number for every claim.',
  ].join('\n');

  const diff = diffPrompts(ORIGINAL, improved);
  const result = reconcile(diff, [entry()]);

  assert.equal(result.status, 'ledger-incomplete');
  assert.ok(
    result.undisclosed.some((change) => change.removed.some((line) => line.includes('unreleased work'))),
    'the removed constraint must be reported as undisclosed',
  );
});

test('a weakened constraint is caught even when the line survives', () => {
  // "Never" becoming "Avoid where practical" keeps the line, keeps the topic,
  // and changes the rule. It must not pass as cosmetic.
  const improved = ORIGINAL.replace(
    'Never include unreleased work.',
    'Avoid including unreleased work where practical.',
  );

  const diff = diffPrompts(ORIGINAL, improved);
  assert.equal(diff.hunks.length, 1);
  assert.equal(diff.hunks[0].cosmetic, false);

  const result = reconcile(diff, [entry()]);
  assert.equal(result.status, 'ledger-incomplete');
  assert.equal(result.undisclosed.length, 1);
});

test('a fabricated ledger entry is caught', () => {
  const result = reconcile(diffPrompts(ORIGINAL, ORIGINAL), [entry()]);

  assert.equal(result.status, 'ledger-incomplete');
  assert.deepEqual(result.fabricated.map((item) => item.id), ['C1']);
});

test('whitespace-only differences are cosmetic and need no entry', () => {
  const improved = ORIGINAL.replace(
    'Never include unreleased work.',
    'Never   include unreleased work.',
  );

  const diff = diffPrompts(ORIGINAL, improved);
  assert.equal(diff.hunks.length, 1);
  assert.equal(diff.hunks[0].cosmetic, true);

  const result = reconcile(diff, []);
  assert.equal(result.status, 'reconciled');
  assert.equal(result.cosmeticChanges, 1);
  assert.equal(result.materialChanges, 0);
});

test('a pure addition is disclosed with an absent before', () => {
  const improved = `${ORIGINAL}\nReturn at most ten bullet points.`;

  const diff = diffPrompts(ORIGINAL, improved);
  const result = reconcile(diff, [
    entry({
      id: 'C2',
      before: 'absent',
      after: 'Return at most ten bullet points.',
      classification: 'strengthens',
    }),
  ]);

  assert.equal(result.status, 'reconciled');
});

test('a pure deletion is disclosed with a removed after', () => {
  const improved = ORIGINAL.split('\n').slice(0, 3).join('\n');

  const diff = diffPrompts(ORIGINAL, improved);
  const result = reconcile(diff, [
    entry({
      id: 'C3',
      before: 'Cite the pull request number for every claim.',
      after: 'removed',
      classification: 'refused',
    }),
  ]);

  assert.equal(result.status, 'reconciled');
});

test('the rendered diff shows both sides of every hunk', () => {
  const improved = ORIGINAL.replace('Never include unreleased work.', 'Never include unreleased or draft work.');
  const rendered = renderDiff(diffPrompts(ORIGINAL, improved));

  assert.match(rendered, /^@@ H1 /m);
  assert.match(rendered, /^-Never include unreleased work\.$/m);
  assert.match(rendered, /^\+Never include unreleased or draft work\.$/m);
});

test('a malformed ledger entry fails closed rather than passing', () => {
  const diff = diffPrompts(ORIGINAL, ORIGINAL);

  assert.throws(() => reconcile(diff, [{ id: 'C1' }]), OptimizationError);
  assert.throws(() => reconcile(diff, 'not-an-array'), OptimizationError);
  assert.throws(() => reconcile(diff, [null]), OptimizationError);
});

test('review grounding must name a finding that exists', () => {
  const grounded = verifyGrounding(
    [entry({ grounding: 'review-finding', 'review-finding-id': 'F-2' })],
    ['F-1', 'F-2'],
  );
  assert.equal(grounded.status, 'grounded');

  const unmapped = verifyGrounding([entry({ grounding: 'review-finding' })], ['F-1']);
  assert.equal(unmapped.status, 'grounding-unverified');
  assert.deepEqual(unmapped.unmapped, ['C1']);

  const invented = verifyGrounding(
    [entry({ grounding: 'review-finding', 'review-finding-id': 'F-9' })],
    ['F-1'],
  );
  assert.equal(invented.status, 'grounding-unverified');
  assert.deepEqual(invented.unknown, [{ entry: 'C1', reviewFindingId: 'F-9' }]);
});

test('optimizer judgement needs no finding identifier', () => {
  const result = verifyGrounding([entry()], []);
  assert.equal(result.status, 'grounded');
});

test('a sensitive literal reproduced in the improved prompt is caught', () => {
  const leaked = verifyRedaction('Use token ghp_examplevalue when calling.', ['ghp_examplevalue']);
  assert.equal(leaked.status, 'sensitive-leak');
  assert.deepEqual(leaked.leaked, ['ghp_examplevalue']);

  const clean = verifyRedaction('Use the token from the environment.', ['ghp_examplevalue']);
  assert.equal(clean.status, 'clean');
});

test('oversized input is rejected rather than truncated', () => {
  const huge = 'x'.repeat(262145);
  assert.throws(() => diffPrompts(huge, 'small'), OptimizationError);
  assert.throws(() => diffPrompts('small', huge), OptimizationError);
});

test('non-string input is rejected', () => {
  assert.throws(() => diffPrompts(null, 'a'), OptimizationError);
  assert.throws(() => diffPrompts('a', 42), OptimizationError);
});

test('reordering a constraint is a material change, not a cosmetic one', () => {
  // Moving a rule can change what it scopes over, so it must be disclosed.
  const improved = [
    'You are a release assistant.',
    'Never include unreleased work.',
    'Summarise the changes for the release notes.',
    'Cite the pull request number for every claim.',
  ].join('\n');

  const diff = diffPrompts(ORIGINAL, improved);
  const material = diff.hunks.filter((hunk) => !hunk.cosmetic);
  assert.ok(material.length > 0, 'a reordering must surface as a material change');

  assert.equal(reconcile(diff, []).status, 'ledger-incomplete');
});
