import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FLEET_DISPOSITIONS,
  ISSUE_DISPOSITIONS,
  conciseFleetStatus,
  deriveFleetDisposition,
} from './fleet-disposition.mjs';

test('covers every terminal vocabulary and budget/cancellation precedence', () => {
  assert.deepEqual(ISSUE_DISPOSITIONS, [
    'ready-for-human-merge', 'blocked', 'failed', 'timed-out-with-handoff',
    'deferred', 'not-reached', 'already-complete',
  ]);
  assert.deepEqual(FLEET_DISPOSITIONS, [
    'review-ready', 'partially-review-ready', 'blocked', 'budget-exhausted', 'cancelled',
  ]);
  const state = { issues: { a: { terminalDisposition: 'not-reached' } } };
  assert.equal(deriveFleetDisposition(state, { budgetExhausted: true }), 'budget-exhausted');
  assert.equal(deriveFleetDisposition(state, { cancelled: true, budgetExhausted: true }), 'cancelled');
});

test('renders distinct active, blocked, checking, expired, and review-ready status', () => {
  const state = {
    issues: {
      a: { identity: 'a', terminalDisposition: null, pipeline: [{ stage: 'run-ci' }], continuationChain: [] },
      b: { identity: 'b', terminalDisposition: 'ready-for-human-merge', shepherd: { ready: true }, continuationChain: [] },
    },
    expiredReadinessClaims: [{ issue: 'c' }],
  };
  const status = conciseFleetStatus(state, {
    active: [{ issue: 'a' }],
    blocked: [{ issue: 'c', reason: 'awaiting-observed-human-merge:b' }],
    capacity: { nextReplenishment: 'worker-terminal-transition' },
  });
  assert.deepEqual(status.active, ['a']);
  assert.deepEqual(status.checking, ['a']);
  assert.deepEqual(status.reviewReady, ['b']);
  assert.deepEqual(status.expired, ['c']);
});
