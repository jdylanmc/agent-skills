import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSpecOutcome } from './spec-outcome.mjs';

function evidence(overrides = {}) {
  return {
    sourceStatus: 'ready',
    pairStatus: 'valid',
    discoveryGaps: 0,
    openDecisions: 0,
    siblingConflicts: 0,
    roastStatus: 'complete',
    openMustFix: 0,
    approval: 'approved',
    contradiction: 'none',
    ...overrides,
  };
}

test('complete requires every independent proof', () => {
  assert.deepEqual(resolveSpecOutcome(evidence()), { status: 'complete', reasons: [] });
});

test('missing source material returns to Discovery', () => {
  assert.equal(resolveSpecOutcome(evidence({ sourceStatus: 'incomplete' })).status, 'needs-discovery');
  assert.equal(resolveSpecOutcome(evidence({ discoveryGaps: 1 })).status, 'needs-discovery');
});

test('missing decisions, sibling conflicts, and unapproved draft need a human decision', () => {
  assert.equal(resolveSpecOutcome(evidence({ openDecisions: 1 })).status, 'needs-decision');
  assert.equal(resolveSpecOutcome(evidence({ siblingConflicts: 1 })).status, 'needs-decision');
  assert.equal(resolveSpecOutcome(evidence({ approval: 'draft' })).status, 'needs-decision');
});

test('an unavailable or incomplete Roast is blocked, never clean', () => {
  assert.equal(resolveSpecOutcome(evidence({ roastStatus: 'unavailable' })).status, 'blocked');
  assert.equal(resolveSpecOutcome(evidence({ roastStatus: 'incomplete' })).status, 'blocked');
  assert.equal(
    resolveSpecOutcome(evidence({ roastStatus: 'unavailable', approval: 'draft' })).status,
    'blocked',
    'approval is not offered until the independent review exists',
  );
  assert.equal(
    resolveSpecOutcome(evidence({ openDecisions: 1, roastStatus: 'unavailable' })).status,
    'blocked',
  );
  assert.equal(
    resolveSpecOutcome(evidence({ discoveryGaps: 1, openMustFix: 1 })).status,
    'blocked',
  );
  assert.equal(
    resolveSpecOutcome(evidence({ siblingConflicts: 1, pairStatus: 'invalid' })).status,
    'blocked',
  );
});

test('unresolved Must fix findings make complete impossible', () => {
  const result = resolveSpecOutcome(evidence({ openMustFix: 1 }));
  assert.equal(result.status, 'blocked');
  assert.match(result.reasons.join(' '), /Must fix/);
});

test('a stale source or invalid pair is blocked', () => {
  assert.equal(resolveSpecOutcome(evidence({ sourceStatus: 'stale' })).status, 'blocked');
  assert.equal(resolveSpecOutcome(evidence({ pairStatus: 'invalid' })).status, 'blocked');
});

test('malformed evidence fails closed', () => {
  assert.throws(
    () => resolveSpecOutcome({ ...evidence(), openMustFix: -1 }),
    (error) => error.code === 'invalid-input',
  );
  assert.throws(
    () => resolveSpecOutcome({ ...evidence(), optimistic: true }),
    (error) => error.code === 'invalid-input',
  );
});

// --- Held status tests ---

test('held + none resolves held with exactly an empty reasons array', () => {
  const result = resolveSpecOutcome(evidence({
    sourceStatus: 'held',
    approval: 'approved',
    contradiction: 'none',
  }));
  assert.equal(result.status, 'held');
  assert.deepEqual(result.reasons, []);
});

test('held + not-checked resolves held (fails toward silence)', () => {
  const result = resolveSpecOutcome(evidence({
    sourceStatus: 'held',
    approval: 'approved',
    contradiction: 'not-checked',
  }));
  assert.equal(result.status, 'held');
  assert.deepEqual(result.reasons, []);
});

test('held + escalated resolves needs-decision', () => {
  const result = resolveSpecOutcome(evidence({
    sourceStatus: 'held',
    approval: 'approved',
    contradiction: 'escalated',
  }));
  assert.equal(result.status, 'needs-decision');
  assert.match(result.reasons.join(' '), /contradicts/);
});

test('held + approval draft is refused as invalid-input', () => {
  assert.throws(
    () => resolveSpecOutcome(evidence({
      sourceStatus: 'held',
      approval: 'draft',
      contradiction: 'none',
    })),
    (error) => error.code === 'invalid-input',
  );
});

test('a narrated approval value is refused as invalid-input', () => {
  assert.throws(
    () => resolveSpecOutcome(evidence({ approval: 'pending' })),
    (error) => error.code === 'invalid-input',
  );
  assert.throws(
    () => resolveSpecOutcome(evidence({ approval: 'yes' })),
    (error) => error.code === 'invalid-input',
  );
});

test('a bad contradiction value is refused as invalid-input', () => {
  assert.throws(
    () => resolveSpecOutcome(evidence({ contradiction: 'maybe' })),
    (error) => error.code === 'invalid-input',
  );
});

// F7: an escalated contradiction on non-held paths produces needs-decision.

test('ready + escalated returns needs-decision, not complete', () => {
  const result = resolveSpecOutcome(evidence({
    sourceStatus: 'ready',
    approval: 'approved',
    contradiction: 'escalated',
  }));
  assert.equal(result.status, 'needs-decision');
  assert.match(result.reasons.join(' '), /contradicts/);
});

test('ready + escalated + draft returns needs-decision for contradiction (not just approval)', () => {
  const result = resolveSpecOutcome(evidence({
    sourceStatus: 'ready',
    approval: 'draft',
    contradiction: 'escalated',
  }));
  assert.equal(result.status, 'needs-decision');
  assert.match(result.reasons.join(' '), /contradicts/);
});

test('blocked + escalated still resolves blocked (blockers take precedence)', () => {
  const result = resolveSpecOutcome(evidence({
    sourceStatus: 'ready',
    pairStatus: 'invalid',
    approval: 'approved',
    contradiction: 'escalated',
  }));
  assert.equal(result.status, 'blocked');
});

test('needs-discovery + escalated still resolves needs-discovery (discovery takes precedence)', () => {
  const result = resolveSpecOutcome(evidence({
    sourceStatus: 'incomplete',
    approval: 'approved',
    contradiction: 'escalated',
  }));
  assert.equal(result.status, 'needs-discovery');
});

test('a held source with a broken pair or unavailable Roast still resolves held', () => {
  // These counts describe a derivation that did not happen, so they are ignored.
  const result = resolveSpecOutcome(evidence({
    sourceStatus: 'held',
    approval: 'approved',
    contradiction: 'none',
    pairStatus: 'invalid',
    roastStatus: 'unavailable',
    openMustFix: 5,
    discoveryGaps: 3,
  }));
  assert.equal(result.status, 'held');
  assert.deepEqual(result.reasons, []);
});
