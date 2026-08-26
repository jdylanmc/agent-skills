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

test('missing decisions, sibling conflicts, and approval need a human decision', () => {
  assert.equal(resolveSpecOutcome(evidence({ openDecisions: 1 })).status, 'needs-decision');
  assert.equal(resolveSpecOutcome(evidence({ siblingConflicts: 1 })).status, 'needs-decision');
  assert.equal(resolveSpecOutcome(evidence({ approval: 'pending' })).status, 'needs-decision');
});

test('an unavailable or incomplete Roast is blocked, never clean', () => {
  assert.equal(resolveSpecOutcome(evidence({ roastStatus: 'unavailable' })).status, 'blocked');
  assert.equal(resolveSpecOutcome(evidence({ roastStatus: 'incomplete' })).status, 'blocked');
  assert.equal(
    resolveSpecOutcome(evidence({ roastStatus: 'unavailable', approval: 'pending' })).status,
    'blocked',
    'approval is not offered until the independent review exists',
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
