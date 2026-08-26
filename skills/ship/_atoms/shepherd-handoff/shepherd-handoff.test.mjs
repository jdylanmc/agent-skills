/**
 * Adversarial tests for the ship-to-shepherd handoff.
 *
 * These hunt the failure the atom exists for: a run reporting a change request
 * as delivered while nothing owns it. Each test is written so it fails if the
 * handoff were implemented the obvious, wrong way — accepting a described
 * handoff, accepting a fired-and-forgotten dispatch, or treating an old
 * disposition as still true.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NESTED_INVOCATION,
  buildHandoffTarget,
  evaluateFreshness,
  evaluateHandoff,
  mayReportShipped,
  normalizeUpToDatePolicy,
} from './shepherd-handoff.mjs';

const BASE_SHA = 'eb0ce00';
const HEAD_SHA = '57d9d26';

/** A complete, honest handoff. Individual tests spoil exactly one part. */
function completeHandoff(overrides = {}) {
  return {
    intent: 'yes',
    publication: { outcome: 'published', identifier: '#111' },
    target: {
      changeRequest: '#111',
      headBranch: 'issue-26-ship-review-fixes',
      headSha: HEAD_SHA,
      baseBranch: 'main',
      baseSha: BASE_SHA,
      upToDatePolicy: 'required',
      receipt: { observedAt: '2026-08-25T20:35:56Z', baseSha: BASE_SHA, headSha: HEAD_SHA },
    },
    invocation: { mode: NESTED_INVOCATION, status: 'returned' },
    result: { disposition: 'mergeable-and-green' },
    observedBase: { baseSha: BASE_SHA },
    ...overrides,
  };
}

test('a completed nested invocation with a terminal disposition is the only way to report shipped', () => {
  const result = evaluateHandoff(completeHandoff());

  assert.equal(result.handoff, 'completed');
  assert.equal(result.state, 'shepherd-mergeable-and-green');
  assert.equal(result.disposition, 'mergeable-and-green');
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.shipStatus, null);
  assert.ok(mayReportShipped(result));
});

test('a described handoff is not a handoff', () => {
  // THE central property. A narrated packet and a real invocation read
  // identically in a report; only one leaves the change request with an owner.
  for (const mode of [undefined, null, 'narrated', 'inline', 'planned', 'same-context', true]) {
    const result = evaluateHandoff(completeHandoff({ invocation: { mode, status: 'returned' } }));

    assert.equal(result.handoff, 'not-performed', `mode ${String(mode)} must not hand anything over`);
    assert.equal(result.state, 'not-invoked');
    assert.equal(result.shipStatus, 'blocked');
    assert.ok(!mayReportShipped(result));
    assert.match(result.humanAction, /#111 \(branch issue-26-ship-review-fixes\)/);
  }
});

test('a dispatch nobody waited on is not a terminal disposition', () => {
  for (const dispatched of [
    { invocation: { mode: NESTED_INVOCATION, status: 'dispatched' }, result: undefined },
    { result: { disposition: 'in-progress' } },
    { result: { disposition: 'shepherd-required' } },
    { result: {} },
    { result: null },
  ]) {
    const result = evaluateHandoff(completeHandoff(dispatched));

    assert.equal(result.handoff, 'not-performed');
    assert.equal(result.state, 'no-terminal-disposition');
    assert.equal(result.shipStatus, 'blocked');
    assert.ok(!mayReportShipped(result));
  }
});

test('every terminal disposition completes the handoff, including the unhappy ones', () => {
  // `completed` is a claim about ownership, not about green. Refusing to hand
  // over a red change request would leave the one most needing an owner
  // without one.
  for (const disposition of [
    'mergeable-and-green',
    'no-op-mergeable-and-green',
    'provider-unsupported',
    'provider-tool-missing',
    'provider-tool-unauthenticated',
    'needs-human',
    'blocked',
    'failing',
  ]) {
    const result = evaluateHandoff(completeHandoff({
      result: { disposition, nextHumanAction: 'resolve the conflict' },
    }));

    assert.equal(result.handoff, 'completed', `${disposition} must complete the handoff`);
    assert.equal(result.disposition, disposition);
    assert.ok(mayReportShipped(result));
  }

  const handedBack = evaluateHandoff(completeHandoff({
    result: { disposition: 'needs-human', nextHumanAction: 'resolve the conflict' },
  }));
  assert.equal(handedBack.humanAction, 'resolve the conflict');
});

test('shepherd being unavailable or failing returns blocked with the target and one action', () => {
  for (const [invocation, state] of [
    [{ mode: NESTED_INVOCATION, status: 'unavailable', reason: 'skill not installed' }, 'shepherd-unavailable'],
    [{ mode: NESTED_INVOCATION, status: 'failed', reason: 'worker exited' }, 'invocation-failed'],
  ]) {
    const result = evaluateHandoff(completeHandoff({ invocation }));

    assert.equal(result.handoff, 'not-performed');
    assert.equal(result.state, state);
    assert.equal(result.shipStatus, 'blocked');
    assert.equal(result.target.changeRequest, '#111');
    assert.match(result.humanAction, /Invoke shepherd on it, or take it over\./);
    assert.ok(!mayReportShipped(result));
  }
});

test('a declined handoff stays declined, and an unasked question is not a decline', () => {
  const declined = evaluateHandoff(completeHandoff({ intent: 'no', invocation: undefined, result: undefined }));
  assert.equal(declined.handoff, 'not-required');
  assert.equal(declined.state, 'declined-by-operator');
  assert.equal(declined.shipStatus, null);
  assert.ok(mayReportShipped(declined));

  for (const intent of [undefined, null, '', 'maybe', true, 'Yes']) {
    const unrecorded = evaluateHandoff(completeHandoff({ intent }));
    assert.equal(unrecorded.handoff, 'not-performed', `intent ${String(intent)} must not proceed`);
    assert.equal(unrecorded.state, 'intent-unrecorded');
    assert.equal(unrecorded.shipStatus, 'blocked');
  }
});

test('an unpublished run has nothing to hand over and never invents a target', () => {
  for (const outcome of [
    undefined,
    'withheld-by-outcome',
    'provider-unsupported',
    'provider-tool-missing',
    'provider-tool-unauthenticated',
    'publication-failed',
    'provider-tool-unobserved',
  ]) {
    const result = evaluateHandoff(completeHandoff({ publication: { outcome } }));

    assert.equal(result.handoff, 'not-performed');
    assert.equal(result.state, 'no-published-target');
    assert.equal(result.target, null, 'no identifier means no target');
    assert.ok(!mayReportShipped(result));
    assert.equal(result.shipStatus, null);
  }
});

test('an incomplete target is a refused handoff, not a handoff with gaps', () => {
  const fields = {
    changeRequest: 'target.changeRequest',
    headBranch: 'target.headBranch',
    headSha: 'target.headSha',
    baseBranch: 'target.baseBranch',
    baseSha: 'target.baseSha',
  };

  for (const [field, label] of Object.entries(fields)) {
    const target = { ...completeHandoff().target, [field]: undefined };
    const result = evaluateHandoff(completeHandoff({ target }));

    assert.equal(result.state, 'target-incomplete', `${field} must be required`);
    assert.equal(result.shipStatus, 'blocked');
    assert.ok(result.unmet.some((entry) => entry.startsWith(label)), `${label} must be named as unmet`);
  }

  const noTime = evaluateHandoff(completeHandoff({
    target: { ...completeHandoff().target, receipt: { baseSha: BASE_SHA, headSha: HEAD_SHA } },
  }));
  assert.equal(noTime.state, 'target-incomplete');
  assert.ok(noTime.unmet.some((entry) => entry.startsWith('receipt.observedAt')));
});

test('a disposition bound to a base that has since moved is stale, not current', () => {
  // This is the incident, reduced: the disposition was true, and then a
  // sibling merged into the same base.
  const result = evaluateHandoff(completeHandoff({ observedBase: { baseSha: 'fdd15de' } }));

  assert.equal(result.handoff, 'not-performed');
  assert.equal(result.state, 'stale-disposition');
  assert.equal(result.freshness, 'stale');
  assert.equal(result.requiresReinvocation, true);
  assert.equal(result.shipStatus, 'blocked');
  assert.equal(result.disposition, 'mergeable-and-green', 'the observed disposition is still reported');
  assert.ok(!mayReportShipped(result), 'a stale disposition is not readiness');
  assert.ok(result.unmet.some((entry) => entry.includes('fdd15de')));
});

test('freshness distinguishes fresh, stale, and never looked', () => {
  const { target } = buildHandoffTarget(completeHandoff().target);

  assert.equal(evaluateFreshness(target, { baseSha: BASE_SHA }), 'fresh');
  assert.equal(evaluateFreshness(target, { baseSha: 'fdd15de' }), 'stale');
  assert.equal(evaluateFreshness(target, undefined), 'unobserved');
  assert.equal(evaluateFreshness(target, {}), 'unobserved');

  // Unobserved is not stale: a run that could not read the base must not
  // manufacture a drift it did not see.
  const unobserved = evaluateHandoff(completeHandoff({ observedBase: undefined }));
  assert.equal(unobserved.handoff, 'completed');
  assert.equal(unobserved.freshness, 'unobserved');
});

test('an unobserved up-to-date policy is never reported as not-required', () => {
  for (const value of [undefined, null, '', 'strict', true, 'Required']) {
    assert.equal(normalizeUpToDatePolicy(value), 'unobserved', `${String(value)} must not resolve a policy`);
  }

  assert.equal(normalizeUpToDatePolicy('required'), 'required');
  assert.equal(normalizeUpToDatePolicy('not-required'), 'not-required');
  assert.equal(normalizeUpToDatePolicy('unobserved'), 'unobserved');

  const { target } = buildHandoffTarget({ changeRequest: '#111' });
  assert.equal(target.upToDatePolicy, 'unobserved');
});

test('the receipt falls back to the captured target SHAs but never to nothing', () => {
  const { target, missing } = buildHandoffTarget({
    changeRequest: '#111',
    headBranch: 'branch',
    headSha: HEAD_SHA,
    baseBranch: 'main',
    baseSha: BASE_SHA,
    receipt: { observedAt: '2026-08-25T20:35:56Z' },
  });

  assert.equal(target.receipt.baseSha, BASE_SHA);
  assert.equal(target.receipt.headSha, HEAD_SHA);
  assert.deepEqual(missing, []);

  assert.deepEqual(buildHandoffTarget().missing, [
    'target.changeRequest',
    'target.headBranch',
    'target.headSha',
    'target.baseBranch',
    'target.baseSha',
    'receipt.observedAt',
    'receipt.baseSha',
    'receipt.headSha',
  ]);
});

test('a non-object input is a defect rather than a silently empty handoff', () => {
  assert.throws(() => evaluateHandoff(null), TypeError);
  assert.throws(() => evaluateHandoff('published'), TypeError);

  const empty = evaluateHandoff();
  assert.equal(empty.state, 'intent-unrecorded');
  assert.ok(!mayReportShipped(empty));
});
