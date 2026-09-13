/**
 * Seam tests for split-proposal.
 *
 * The property worth holding: below budget no split is required; over budget a
 * valid split must partition the inventory DERIVED from the validated ledger —
 * pairwise disjoint and jointly exhaustive — every proposal field must carry
 * substantive text, and every failure of that partition is a named refusal. The
 * inventory is derived, so a caller can no longer omit a unit and partition an
 * incomplete set perfectly.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { REFUSAL_CODES, SplitProposalError, evaluateSplit } from './split-proposal.mjs';
import { ledgerDigest as computeLedgerDigest } from '../disclosure-ledger/disclosure-ledger.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOCUMENT = fs.readFileSync(path.join(UNIT_ROOT, 'split-proposal.md'), 'utf8');

const PROFILE = 'spec-nano';

// A ledger whose non-omittable entries are the four inventory units. The two
// context entries are omittable and never enter the inventory.
function ledgerEntries() {
  return [
    { id: 'ctx-1', kind: 'context' },
    { id: 'intention', kind: 'intention' },
    { id: 'AC-001', kind: 'criterion' },
    { id: 'AC-002', kind: 'criterion' },
    { id: 'non-goal-1', kind: 'non-goal' },
  ];
}

const INVENTORY = ['intention', 'AC-001', 'AC-002', 'non-goal-1'];

function proposal(overrides = {}) {
  return {
    slug: overrides.slug ?? 'first-piece',
    title: overrides.title ?? 'First cohesive piece',
    boundary: overrides.boundary ?? 'Everything about customer eligibility.',
    units: overrides.units ?? ['intention', 'AC-001'],
    rationale: overrides.rationale ?? 'Eligibility is one cohesive concern.',
  };
}

function secondPiece(overrides = {}) {
  return proposal({
    slug: 'second-piece',
    title: 'Second cohesive piece',
    boundary: 'Everything about method display.',
    units: ['AC-002', 'non-goal-1'],
    rationale: 'Display is a separate concern.',
    ...overrides,
  });
}

function validPair() {
  return [proposal(), secondPiece()];
}

function args(overrides = {}) {
  const entries = overrides.ledgerEntries ?? ledgerEntries();
  return {
    budgetStatus: overrides.budgetStatus ?? 'over',
    proposals: overrides.proposals ?? validPair(),
    ledgerEntries: entries,
    profileId: overrides.profileId ?? PROFILE,
    ledgerDigest: 'ledgerDigest' in overrides ? overrides.ledgerDigest : computeLedgerDigest(entries),
  };
}

function code(run) {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
}

test('below budget, no split is required and a proposal is reported not refused', () => {
  assert.deepEqual(
    evaluateSplit(args({ budgetStatus: 'within', proposals: [] })),
    { status: 'not-required', proposals: [], ledgerDigest: computeLedgerDigest(ledgerEntries()), profileId: PROFILE },
  );
  const reported = evaluateSplit(args({ budgetStatus: 'at-limit' }));
  assert.equal(reported.status, 'not-required');
  assert.equal(reported.proposals.length, 2);
});

test('over budget with a valid partition returns needs-split and echoes the ledger digest and profile', () => {
  const result = evaluateSplit(args());
  assert.equal(result.status, 'needs-split');
  assert.equal(result.proposals.length, 2);
  assert.equal(result.ledgerDigest, computeLedgerDigest(ledgerEntries()));
  assert.equal(result.profileId, PROFILE);
});

test('over budget, a missing or non-matching ledger digest is ledger-digest-mismatch', () => {
  // The exact hole: a split with no provenance tying it to its ledger.
  assert.equal(code(() => evaluateSplit(args({ ledgerDigest: undefined }))), 'ledger-digest-mismatch');
  assert.equal(code(() => evaluateSplit(args({ ledgerDigest: 'a'.repeat(64) }))), 'ledger-digest-mismatch');
});

test('the inventory is derived from the ledger, not asserted: a unit absent from every proposal is uncovered', () => {
  // The exact round-2 hole: an incomplete split used to partition perfectly
  // because the caller controlled the inventory. Now a non-omittable ledger
  // entry that no proposal covers is uncovered-criterion, never needs-split.
  const proposals = [
    proposal({ units: ['intention', 'AC-001'] }),
    secondPiece({ units: ['AC-002'] }), // non-goal-1 is dropped
  ];
  const result = code(() => evaluateSplit(args({ proposals })));
  assert.equal(result, 'uncovered-criterion');
  assert.notEqual(result, 'needs-split');
});

test('a single-piece split is insufficient-split', () => {
  assert.equal(
    code(() => evaluateSplit(args({ proposals: [proposal({ units: INVENTORY })] }))),
    'insufficient-split',
  );
});

test('an unknown profile is unknown-profile', () => {
  assert.equal(code(() => evaluateSplit(args({ profileId: 'spec-mini' }))), 'unknown-profile');
});

test('malformed ledger entries or budget status are invalid-input', () => {
  assert.equal(code(() => evaluateSplit(args({ budgetStatus: 'sideways' }))), 'invalid-input');
  assert.equal(code(() => evaluateSplit(args({ ledgerEntries: 'not-an-array' }))), 'invalid-input');
  assert.equal(code(() => evaluateSplit(args({ ledgerEntries: [{ id: 'x' }] }))), 'invalid-input');
});

test('a proposal missing a boundary, rationale, or units is incohesive-boundary', () => {
  const noBoundary = validPair();
  noBoundary[0] = proposal({ boundary: '' });
  assert.equal(code(() => evaluateSplit(args({ proposals: noBoundary }))), 'incohesive-boundary');

  const noRationale = validPair();
  noRationale[1] = secondPiece({ rationale: '  ' });
  assert.equal(code(() => evaluateSplit(args({ proposals: noRationale }))), 'incohesive-boundary');

  const noUnits = validPair();
  noUnits[0] = proposal({ units: [] });
  assert.equal(code(() => evaluateSplit(args({ proposals: noUnits }))), 'incohesive-boundary');
});

test('a degenerate title, boundary, or rationale is incohesive-boundary', () => {
  const shortTitle = validPair();
  shortTitle[0] = proposal({ title: 'One' });
  assert.equal(code(() => evaluateSplit(args({ proposals: shortTitle }))), 'incohesive-boundary');

  const shortBoundary = validPair();
  shortBoundary[0] = proposal({ boundary: 'Eligibility bits' });
  assert.equal(code(() => evaluateSplit(args({ proposals: shortBoundary }))), 'incohesive-boundary');

  const shortRationale = validPair();
  shortRationale[1] = secondPiece({ rationale: 'Because reasons' });
  assert.equal(code(() => evaluateSplit(args({ proposals: shortRationale }))), 'incohesive-boundary');
});

test('the partition must be pairwise disjoint', () => {
  const proposals = [
    proposal({ units: ['intention', 'AC-001'] }),
    secondPiece({ units: ['AC-001', 'AC-002', 'non-goal-1'] }),
  ];
  assert.equal(code(() => evaluateSplit(args({ proposals }))), 'overlapping-boundary');
});

test('the partition must be jointly exhaustive', () => {
  const proposals = [
    proposal({ units: ['intention'] }),
    secondPiece({ units: ['AC-001'] }),
  ];
  assert.equal(code(() => evaluateSplit(args({ proposals }))), 'uncovered-criterion');
});

test('a proposal citing a unit the ledger never declared is unknown-criterion', () => {
  const proposals = validPair();
  proposals[1] = secondPiece({ units: ['AC-002', 'non-goal-1', 'AC-999'] });
  assert.equal(code(() => evaluateSplit(args({ proposals }))), 'unknown-criterion');
});

test('the inventory spans every non-omittable kind, not only criteria', () => {
  const entries = [
    { id: 'intention', kind: 'intention' },
    { id: 'AC-001', kind: 'criterion' },
    { id: 'non-goal-1', kind: 'non-goal' },
    { id: 'constraint-1', kind: 'constraint' },
    { id: 'contradiction-1', kind: 'contradiction' },
  ];
  const proposals = [
    proposal({ units: ['intention', 'AC-001'] }),
    secondPiece({ units: ['non-goal-1', 'constraint-1', 'contradiction-1'] }),
  ];
  const result = evaluateSplit(args({ proposals, ledgerEntries: entries }));
  assert.equal(result.status, 'needs-split');
});

test('an invalid or duplicate slug is invalid-slug', () => {
  const bad = validPair();
  bad[0] = proposal({ slug: 'First_Piece' });
  assert.equal(code(() => evaluateSplit(args({ proposals: bad }))), 'invalid-slug');

  const dup = validPair();
  dup[1] = secondPiece({ slug: 'first-piece' });
  assert.equal(code(() => evaluateSplit(args({ proposals: dup }))), 'invalid-slug');
});

test('evaluateSplit throws a typed error', () => {
  assert.throws(
    () => evaluateSplit(args({ proposals: [proposal({ units: INVENTORY })] })),
    (error) => error instanceof SplitProposalError && error.code === 'insufficient-split',
  );
});

test('the documented refusal table matches REFUSAL_CODES in both directions', () => {
  const section = DOCUMENT.split(/^## Refusals\s*$/m)[1];
  assert.ok(section, 'split-proposal.md no longer carries the refusal table');
  const table = section.split(/^#{1,6} /m)[0];
  const documented = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(documented.sort(), [...REFUSAL_CODES].sort());
});
