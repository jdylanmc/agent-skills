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
  SET_OWNER,
  buildHandoffTarget,
  evaluateHandoff,
  handoffSatisfied,
  publicationSucceeded,
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

test('publication success requires both the outcome and the provider identifier', () => {
  assert.equal(publicationSucceeded({ outcome: 'published', identifier: '#111' }), true);
  for (const publication of [
    undefined,
    {},
    { outcome: 'published' },
    { outcome: 'published', identifier: '' },
    { outcome: 'published', identifier: 111 },
    { outcome: 'publication-failed', identifier: '#111' },
  ]) {
    assert.equal(publicationSucceeded(publication), false);
  }
});

test('a publication and target mismatch cannot cross-wire readiness provenance', () => {
  const mismatched = evaluateHandoff(completeHandoff({
    publication: { outcome: 'published', identifier: '#222' },
  }));

  assert.equal(mismatched.state, 'target-publication-mismatch');
  assert.equal(mismatched.handoff, 'not-performed');
  assert.equal(mismatched.shipStatus, 'blocked');
  assert.ok(mismatched.unmet.some((entry) => entry.includes('#111') && entry.includes('#222')));
  assert.match(mismatched.humanAction, /#222/);

  assert.equal(mismatched.setObligation.changeRequest, '#222');
  assert.equal(mismatched.setObligation.baseBranch, null);
  assert.equal(mismatched.setObligation.baseSha, null);
  assert.deepEqual(mismatched.setObligation.unresolved, ['baseBranch', 'baseSha']);
});

test('a missing target identity cannot donate base provenance to the published request', () => {
  for (const intent of ['yes', 'no']) {
    for (const changeRequest of [undefined, null, '', '   ']) {
      const result = evaluateHandoff(completeHandoff({
        intent,
        target: publicationTarget({ changeRequest }),
      }));

      assert.equal(result.setObligation.changeRequest, '#111');
      assert.equal(result.setObligation.baseBranch, null);
      assert.equal(result.setObligation.baseSha, null);
      assert.deepEqual(result.setObligation.unresolved, ['baseBranch', 'baseSha']);
    }
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

test('the set obligation binds to the base the readiness was observed against', () => {
  // The regression that would make the obligation worse than useless: dating
  // the expiry to the publication base rather than the one shepherd rebased
  // onto tells the set owner a claim expired against a commit the change
  // request no longer sits on. It is the same two-snapshot confusion freshness
  // already refuses, and it must be refused here too.
  const result = evaluateHandoff(completeHandoff());

  assert.equal(result.setObligation.changeRequest, '#111');
  assert.equal(result.setObligation.baseBranch, 'main');
  assert.equal(result.setObligation.baseSha, REBASED_BASE);
  assert.notEqual(result.setObligation.baseSha, PUBLISHED_BASE);
  assert.match(result.setObligation.expiresWhen, /anything else merges into main/);
  assert.match(result.setObligation.reinvocation, /Invoke shepherd on #111 again/);
});

test('the obligation is addressed to the caller, and never to this run', () => {
  // An obligation with no actor reads as a note, and one addressed to this run
  // would be an instruction to watch — the daemon the handoff refuses to be.
  const result = evaluateHandoff(completeHandoff());

  assert.equal(result.setObligation.owner, SET_OWNER);
  assert.match(result.setObligation.owner, /caller/);

  const words = JSON.stringify(result.setObligation);
  for (const daemon of [/\bwatch/i, /\bpoll/i, /\bwait for\b/i, /\bmonitor/i]) {
    assert.doesNotMatch(words, daemon, `the obligation must not promise to ${String(daemon)}`);
  }
});

test('declining shepherd declines an owner, not the expiry', () => {
  // The operator saying no settles who drives this change request. It settles
  // nothing about the base, which moves whether or not anyone was asked.
  const declined = evaluateHandoff(completeHandoff({ intent: 'no' }));

  assert.equal(declined.handoff, 'not-required');
  assert.equal(declined.state, 'declined-by-operator');
  assert.ok(handoffSatisfied(declined));
  assert.equal(declined.setObligation.changeRequest, '#111');
  assert.equal(declined.setObligation.baseSha, PUBLISHED_BASE, 'no shepherd receipt, so the captured base');
});

test('every published change request leaves the run with an obligation', () => {
  // The states below are the ones that end `blocked`, which is exactly when a
  // change request is least likely to be watched by anybody. An obligation
  // that appeared only on the happy path would be missing from every case that
  // needs it.
  const blocked = [
    ['intent-unrecorded', { intent: undefined }],
    ['not-invoked', { invocation: { mode: 'narrated', status: 'returned' } }],
    ['shepherd-unavailable', { invocation: { mode: NESTED_INVOCATION, status: 'unavailable' } }],
    ['no-terminal-disposition', { result: { disposition: 'in-progress' } }],
    ['stale-disposition', { observedBase: { observedAt: '2026-08-25T22:06:00Z', baseSha: 'aaaaaaa', headSha: REBASED_HEAD } }],
    ['freshness-unobserved', { observedBase: undefined }],
  ];

  for (const [state, overrides] of blocked) {
    const result = evaluateHandoff(completeHandoff(overrides));

    assert.equal(result.state, state);
    assert.equal(result.shipStatus, 'blocked');
    assert.equal(result.setObligation.changeRequest, '#111', `${state} lost the obligation`);
    assert.equal(result.setObligation.owner, SET_OWNER);
  }
});

test('a handoff nobody performed cannot supply the base the obligation binds to', () => {
  // The sharpest version of the failure this unit exists for. A narrated
  // handoff, an unavailable shepherd, and a failed dispatch all arrive with a
  // well-formed result attached, because the thing in doubt is the invocation
  // and not the sentence describing it. An obligation that read the base out
  // of that result would inherit from a narration the very fact the decision
  // just refused to believe — and would report `unresolved: []`, meaning
  // checkable, about a base no shepherd ever saw.
  const narrated = [
    ['not-invoked', { invocation: { mode: 'narrated', status: 'returned' } }],
    ['shepherd-unavailable', { invocation: { mode: NESTED_INVOCATION, status: 'unavailable' } }],
    ['invocation-failed', { invocation: { mode: NESTED_INVOCATION, status: 'failed' } }],
    ['intent-unrecorded', { intent: undefined }],
  ];

  for (const [state, overrides] of narrated) {
    const result = evaluateHandoff(completeHandoff(overrides));

    assert.equal(result.state, state);
    assert.equal(result.setObligation.baseSha, PUBLISHED_BASE, `${state} trusted a refused receipt`);
    assert.notEqual(result.setObligation.baseSha, REBASED_BASE);
  }

  // The states that did get past the invocation gates keep the base shepherd
  // actually observed, so the rule above is a refusal rather than a blanket
  // preference for the publication snapshot.
  for (const [state, overrides] of [
    ['shepherd-mergeable-and-green', {}],
    ['stale-disposition', { observedBase: { observedAt: '2026-08-25T22:06:00Z', baseSha: 'aaaaaaa', headSha: REBASED_HEAD } }],
    ['freshness-unobserved', { observedBase: undefined }],
  ]) {
    const result = evaluateHandoff(completeHandoff(overrides));

    assert.equal(result.state, state);
    assert.equal(result.setObligation.baseSha, REBASED_BASE, `${state} lost the observed base`);
  }

  // A disposition whose receipt never validated is not an observation either,
  // however terminal the disposition reads.
  const unusable = evaluateHandoff(completeHandoff({
    result: { disposition: 'mergeable-and-green', receipt: { baseSha: REBASED_BASE } },
  }));

  assert.equal(unusable.state, 'result-receipt-incomplete');
  assert.equal(unusable.setObligation.baseSha, PUBLISHED_BASE);
});

test('an obligation follows publication succeeding, not an identifier appearing', () => {
  // The trap: a failed publication can still carry the identifier a provider
  // echoed back. Building an obligation from a bare identifier addresses the
  // set owner about a change request that does not exist, which is worse than
  // saying nothing — it is a duty with no subject.
  assert.equal(evaluateHandoff().setObligation, null);

  for (const outcome of [
    'withheld-by-outcome',
    'publication-failed',
    'provider-unsupported',
    'provider-tool-missing',
    undefined,
  ]) {
    const unpublished = evaluateHandoff(completeHandoff({
      publication: { outcome, identifier: '#ghost' },
    }));

    assert.equal(unpublished.state, 'no-published-target');
    assert.equal(unpublished.setObligation, null, `outcome ${String(outcome)} owns nothing`);
  }

  // A target that omitted the identifier is a refused handoff, but publication
  // did succeed, and the identifier the provider returned is the change
  // request somebody now owns.
  const incomplete = evaluateHandoff(completeHandoff({
    target: publicationTarget({ changeRequest: undefined }),
  }));

  assert.equal(incomplete.state, 'target-incomplete');
  assert.equal(incomplete.setObligation.changeRequest, '#111');
});

test('an obligation with no captured base says so rather than reading as checkable', () => {
  // An expiry nobody can compare against a later base is unverifiable. It is
  // still emitted, because the change request is still real, but the missing
  // facts are named instead of leaving a confident-looking obligation bound to
  // nothing.
  const baseless = evaluateHandoff(completeHandoff({
    intent: undefined,
    target: publicationTarget({ baseBranch: undefined, baseSha: undefined, receipt: {} }),
  }));

  assert.equal(baseless.setObligation.changeRequest, '#111');
  assert.equal(baseless.setObligation.baseBranch, null);
  assert.equal(baseless.setObligation.baseSha, null);
  assert.deepEqual(baseless.setObligation.unresolved, ['baseBranch', 'baseSha']);
  assert.match(baseless.setObligation.expiresWhen, /its base branch/);

  // A complete one carries nothing unresolved, so the field distinguishes the
  // two rather than always being present and always ignored.
  assert.deepEqual(evaluateHandoff(completeHandoff()).setObligation.unresolved, []);
});
