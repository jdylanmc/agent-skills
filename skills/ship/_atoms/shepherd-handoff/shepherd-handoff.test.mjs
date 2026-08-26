/**
 * Adversarial tests for the ship-to-shepherd handoff.
 *
 * These hunt the failure the atom exists for: a run reporting a change request
 * as delivered while nothing owns it. Each is written so it fails if the
 * handoff were implemented the obvious, wrong way — accepting a described
 * handoff, accepting a fired-and-forgotten dispatch, believing a disposition
 * with no receipt, or comparing the wrong snapshot and calling a successful
 * rebase stale.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { TERMINAL_DISPOSITIONS } from '../../../_base/_atoms/landability/landability.mjs';
import {
  NESTED_INVOCATION,
  buildHandoffTarget,
  evaluateHandoff,
  handoffSatisfied,
  normalizeObservation,
} from './shepherd-handoff.mjs';

/** What publication recorded: fixed forever, and never the freshness subject. */
const PUBLISHED_BASE = 'eb0ce00';
const PUBLISHED_HEAD = '57d9d26';

/** What shepherd observed after it rebased: a later, different pair. */
const REBASED_BASE = 'fdd15de';
const REBASED_HEAD = '3f78428';

function publicationTarget(overrides = {}) {
  return {
    changeRequest: '#111',
    headBranch: 'issue-26-ship-review-fixes',
    headSha: PUBLISHED_HEAD,
    baseBranch: 'main',
    baseSha: PUBLISHED_BASE,
    upToDatePolicy: 'unobserved',
    receipt: { observedAt: '2026-08-25T20:35:56Z', baseSha: PUBLISHED_BASE, headSha: PUBLISHED_HEAD },
    ...overrides,
  };
}

/** A complete, honest handoff after a rebase shepherd actually performed. */
function completeHandoff(overrides = {}) {
  return {
    intent: 'yes',
    publication: { outcome: 'published', identifier: '#111' },
    target: publicationTarget(),
    invocation: { mode: NESTED_INVOCATION, status: 'returned' },
    result: {
      disposition: 'mergeable-and-green',
      receipt: {
        observedAt: '2026-08-25T22:05:00Z',
        baseSha: REBASED_BASE,
        headSha: REBASED_HEAD,
        upToDatePolicy: 'required',
        provider: 'supported-provider',
        complete: true,
      },
    },
    observedBase: { observedAt: '2026-08-25T22:06:00Z', baseSha: REBASED_BASE, headSha: REBASED_HEAD },
    ...overrides,
  };
}

test('a rebase shepherd performed is fresh, because freshness follows the shepherd receipt', () => {
  // THE regression this ordering exists for. A successful rebase moves both
  // the base and the head away from what publication recorded. Comparing the
  // publication receipt would make every rebase permanently stale, which reads
  // as "shepherd worked, therefore nothing shepherd did counts".
  const result = evaluateHandoff(completeHandoff());

  assert.equal(result.handoff, 'completed');
  assert.equal(result.state, 'shepherd-mergeable-and-green');
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.policy, 'required');
  assert.equal(result.shipStatus, null);
  assert.ok(handoffSatisfied(result));

  // The publication snapshot is retained as ownership evidence and is not the
  // thing compared.
  assert.equal(result.target.receipt.baseSha, PUBLISHED_BASE);
  assert.equal(result.target.receipt.headSha, PUBLISHED_HEAD);
  assert.notEqual(result.target.receipt.baseSha, REBASED_BASE, 'the two snapshots are genuinely different');
});

test('a described handoff is not a handoff', () => {
  // A narrated packet and a real invocation read identically in a report; only
  // one leaves the change request with an owner.
  for (const mode of [undefined, null, 'narrated', 'inline', 'planned', 'same-context', true]) {
    const result = evaluateHandoff(completeHandoff({ invocation: { mode, status: 'returned' } }));

    assert.equal(result.handoff, 'not-performed', `mode ${String(mode)} must not hand anything over`);
    assert.equal(result.state, 'not-invoked');
    assert.equal(result.shipStatus, 'blocked');
    assert.ok(!handoffSatisfied(result));
    assert.match(result.humanAction, /#111 \(branch issue-26-ship-review-fixes\)/);
  }
});

test('a dispatch nobody waited on is not a terminal disposition', () => {
  for (const dispatched of [
    { invocation: { mode: NESTED_INVOCATION, status: 'dispatched' }, result: undefined },
    { result: { disposition: 'in-progress' } },
    { result: { disposition: 'shepherd-required' } },
    { result: { disposition: 'watch-or-report' } },
    { result: {} },
    { result: null },
  ]) {
    const result = evaluateHandoff(completeHandoff(dispatched));

    assert.equal(result.handoff, 'not-performed');
    assert.equal(result.state, 'no-terminal-disposition');
    assert.equal(result.shipStatus, 'blocked');
    assert.ok(!handoffSatisfied(result));
  }
});

test('every terminal disposition completes the handoff, including the unhappy ones', () => {
  // `completed` is a claim about ownership, not about green. Refusing to hand
  // over a red change request would leave the one most needing an owner
  // without one. The list is the shared one, so a disposition the producer can
  // return cannot go missing from the consumer's set.
  for (const disposition of TERMINAL_DISPOSITIONS) {
    const result = evaluateHandoff(completeHandoff({
      result: {
        ...completeHandoff().result,
        disposition,
        nextHumanAction: 'resolve the conflict',
      },
    }));

    assert.equal(result.handoff, 'completed', `${disposition} must complete the handoff`);
    assert.equal(result.disposition, disposition);
    assert.ok(handoffSatisfied(result));
  }

  assert.ok(TERMINAL_DISPOSITIONS.includes('provider-tool-unsupported'));

  const handedBack = evaluateHandoff(completeHandoff({
    result: { ...completeHandoff().result, disposition: 'needs-human', nextHumanAction: 'resolve the conflict' },
  }));
  assert.equal(handedBack.humanAction, 'resolve the conflict');
});

test('a terminal disposition with no usable receipt is an unverifiable claim', () => {
  for (const receipt of [
    undefined,
    null,
    {},
    { observedAt: '2026-08-25T22:05:00Z' },
    { observedAt: '2026-08-25T22:05:00Z', baseSha: REBASED_BASE },
    { observedAt: '2026-08-25T22:05:00Z', baseSha: '', headSha: REBASED_HEAD },
    { observedAt: 1, baseSha: REBASED_BASE, headSha: REBASED_HEAD },
    { baseSha: REBASED_BASE, headSha: REBASED_HEAD, complete: true },
    { observedAt: '2026-08-25T22:05:00Z', baseSha: REBASED_BASE, headSha: REBASED_HEAD, complete: false },
  ]) {
    const result = evaluateHandoff(completeHandoff({
      result: { disposition: 'mergeable-and-green', receipt },
    }));

    assert.equal(result.state, 'result-receipt-incomplete', `${JSON.stringify(receipt)} must not be believed`);
    assert.equal(result.shipStatus, 'blocked');
    assert.ok(!handoffSatisfied(result));
    assert.ok(result.unmet.length > 0, 'refusing must say why');

    // The disposition is still reported, because hiding it would lose the one
    // fact shepherd did establish.
    assert.equal(result.disposition, 'mergeable-and-green');
  }
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
    assert.ok(!handoffSatisfied(result));
  }
});

test('a declined handoff stays declined, and an unasked question is not a decline', () => {
  const declined = evaluateHandoff(completeHandoff({ intent: 'no', invocation: undefined, result: undefined }));
  assert.equal(declined.handoff, 'not-required');
  assert.equal(declined.state, 'declined-by-operator');
  assert.equal(declined.shipStatus, null);
  assert.ok(handoffSatisfied(declined));

  for (const intent of [undefined, null, '', 'maybe', true, 'Yes']) {
    const unrecorded = evaluateHandoff(completeHandoff({ intent }));
    assert.equal(unrecorded.handoff, 'not-performed', `intent ${String(intent)} must not proceed`);
    assert.equal(unrecorded.state, 'intent-unrecorded');
    assert.equal(unrecorded.shipStatus, 'blocked');
  }
});

test('publication is decided once, so both intent paths agree about an unpublished run', () => {
  for (const outcome of [
    undefined,
    'withheld-by-outcome',
    'provider-unsupported',
    'provider-tool-missing',
    'provider-tool-unauthenticated',
    'publication-failed',
    'provider-tool-unobserved',
  ]) {
    const asked = evaluateHandoff(completeHandoff({ publication: { outcome } }));
    const declined = evaluateHandoff(completeHandoff({ intent: 'no', publication: { outcome } }));

    for (const [label, result] of [['intent yes', asked], ['intent no', declined]]) {
      assert.equal(result.state, 'no-published-target', `${label} must reach the same state`);
      assert.equal(result.handoff, 'not-required');
      assert.equal(result.target, null, 'no identifier means no target');

      // The status is unconstrained and the helper agrees with it: publication
      // carries this failure, and reporting it twice under a worse name would
      // send somebody looking for a handoff problem.
      assert.equal(result.shipStatus, null);
      assert.ok(handoffSatisfied(result));
      assert.ok(result.unmet.some((entry) => entry.startsWith('publication:')));
    }
  }
});

test('an incomplete target is a refused handoff, not a handoff with gaps', () => {
  for (const field of ['changeRequest', 'headBranch', 'headSha', 'baseBranch', 'baseSha']) {
    for (const spoiled of [undefined, '', '   ', 42]) {
      const result = evaluateHandoff(completeHandoff({
        target: publicationTarget({ [field]: spoiled }),
      }));

      assert.equal(result.state, 'target-incomplete', `${field}=${String(spoiled)} must be refused`);
      assert.equal(result.shipStatus, 'blocked');
      assert.ok(result.unmet.some((entry) => entry.startsWith(`target.${field}`)));
    }
  }

  const noTime = evaluateHandoff(completeHandoff({
    target: publicationTarget({ receipt: { baseSha: PUBLISHED_BASE, headSha: PUBLISHED_HEAD } }),
  }));
  assert.equal(noTime.state, 'target-incomplete');
  assert.ok(noTime.unmet.some((entry) => entry.startsWith('receipt.observedAt')));
});

test('a change request that moved after shepherd observed it is stale', () => {
  // The incident, reduced: a sibling merged into the same base after shepherd
  // observed it, so the disposition describes a state that no longer exists.
  const movedBase = evaluateHandoff(completeHandoff({
    observedBase: {
      observedAt: '2026-08-25T22:06:00Z',
      baseSha: '9d5e4f7',
      headSha: REBASED_HEAD,
    },
  }));
  assert.equal(movedBase.state, 'stale-disposition');
  assert.equal(movedBase.freshness, 'stale');
  assert.equal(movedBase.requiresReinvocation, true);
  assert.equal(movedBase.shipStatus, 'blocked');
  assert.equal(movedBase.disposition, 'mergeable-and-green', 'the observed disposition is still reported');
  assert.ok(!handoffSatisfied(movedBase));
  assert.ok(movedBase.unmet.some((entry) => entry.includes('9d5e4f7')));

  // A head that moved is the same problem about different code.
  const movedHead = evaluateHandoff(completeHandoff({
    observedBase: {
      observedAt: '2026-08-25T22:06:00Z',
      baseSha: REBASED_BASE,
      headSha: 'abc1234',
    },
  }));
  assert.equal(movedHead.state, 'stale-disposition');
  assert.ok(movedHead.unmet.some((entry) => entry.includes('abc1234')));
});

test('an unread post-shepherd snapshot always blocks', () => {
  const required = completeHandoff().result.receipt;

  for (const observedBase of [undefined, null, {}, 'main', { baseSha: REBASED_BASE }, { baseSha: '', headSha: '' }]) {
    const result = evaluateHandoff(completeHandoff({ observedBase }));

    assert.equal(result.state, 'freshness-unobserved', `${JSON.stringify(observedBase)} is not an observation`);
    assert.equal(result.freshness, 'unobserved');
    assert.equal(result.shipStatus, 'blocked');
    assert.equal(result.requiresReinvocation, true);
    assert.ok(!handoffSatisfied(result));
    assert.match(result.humanAction, /re-read the base and head/);
  }

  for (const upToDatePolicy of ['not-required', 'unobserved']) {
    const result = evaluateHandoff(completeHandoff({
      result: { ...completeHandoff().result, receipt: { ...required, upToDatePolicy } },
      observedBase: undefined,
    }));

    assert.equal(result.handoff, 'not-performed');
    assert.equal(result.freshness, 'unobserved');
    assert.equal(result.shipStatus, 'blocked');
    assert.ok(!handoffSatisfied(result));
  }

  // The policy shepherd observed wins over what was known at publication, and
  // the publication value is the fallback when shepherd could not read it.
  const fromTarget = evaluateHandoff(completeHandoff({
    target: publicationTarget({ upToDatePolicy: 'required' }),
    result: { ...completeHandoff().result, receipt: { ...required, upToDatePolicy: 'unobserved' } },
    observedBase: undefined,
  }));
  assert.equal(fromTarget.state, 'freshness-unobserved');
  assert.equal(fromTarget.policy, 'required');
});

test('an observation needs a valid timestamp and both commits', () => {
  assert.deepEqual(normalizeObservation({
    baseSha: 'a',
    headSha: 'b',
    observedAt: '2026-08-25T22:06:00Z',
  }), {
    observedAt: '2026-08-25T22:06:00Z',
    baseSha: 'a',
    headSha: 'b',
    complete: true,
  });

  for (const input of [
    undefined,
    null,
    'a',
    7,
    {},
    { baseSha: 'a' },
    { headSha: 'b' },
    { baseSha: 'a', headSha: 3 },
    { observedAt: 'now', baseSha: 'a', headSha: 'b' },
  ]) {
    assert.equal(normalizeObservation(input).complete, false, `${JSON.stringify(input)} is not an observation`);
  }
});

test('the publication receipt falls back to the captured target commits but never to nothing', () => {
  const { target, missing } = buildHandoffTarget({
    changeRequest: '#111',
    headBranch: 'branch',
    headSha: PUBLISHED_HEAD,
    baseBranch: 'main',
    baseSha: PUBLISHED_BASE,
    receipt: { observedAt: '2026-08-25T20:35:56Z' },
  });

  assert.equal(target.receipt.baseSha, PUBLISHED_BASE);
  assert.equal(target.receipt.headSha, PUBLISHED_HEAD);
  assert.equal(target.upToDatePolicy, 'unobserved');
  assert.deepEqual(missing, ['target.upToDatePolicy']);

  const explicit = buildHandoffTarget({
    changeRequest: '#111',
    headBranch: 'branch',
    headSha: PUBLISHED_HEAD,
    baseBranch: 'main',
    baseSha: PUBLISHED_BASE,
    upToDatePolicy: 'unobserved',
    receipt: { observedAt: '2026-08-25T20:35:56Z' },
  });
  assert.deepEqual(explicit.missing, []);

  assert.deepEqual(buildHandoffTarget().missing, [
    'target.changeRequest',
    'target.headBranch',
    'target.headSha',
    'target.baseBranch',
    'target.baseSha',
    'target.upToDatePolicy',
    'receipt.observedAt',
    'receipt.baseSha',
    'receipt.headSha',
  ]);
});

test('a non-green disposition must name the next human action', () => {
  const missingAction = evaluateHandoff(completeHandoff({
    result: {
      ...completeHandoff().result,
      disposition: 'failing',
      nextHumanAction: undefined,
    },
  }));

  assert.equal(missingAction.state, 'result-action-incomplete');
  assert.equal(missingAction.shipStatus, 'blocked');
  assert.ok(!handoffSatisfied(missingAction));
  assert.ok(missingAction.unmet.some((entry) => entry.includes('nextHumanAction')));
});

test('a non-object input is a defect rather than a silently empty handoff', () => {
  assert.throws(() => evaluateHandoff(null), TypeError);
  assert.throws(() => evaluateHandoff('published'), TypeError);

  // No input at all published nothing, so it reaches the publication stop
  // rather than claiming a handoff happened.
  const empty = evaluateHandoff();
  assert.equal(empty.state, 'no-published-target');
  assert.equal(empty.shipStatus, null);
});
