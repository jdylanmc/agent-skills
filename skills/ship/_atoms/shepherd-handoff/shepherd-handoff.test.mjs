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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TERMINAL_DISPOSITIONS } from '../../../_base/_atoms/landability/landability.mjs';
import {
  createWatchState, bootstrapAcceptance, recordObservation, watchAction,
  beginShipDispatch, recordShipResult, persistWatchState, loadWatchState, resumeWatch,
} from '../../../shepherd/_atoms/watch-state/watch-state.mjs';
import { digestConfirmedLedger } from '../continuation-remediation/continuation-remediation.mjs';
import { publishChangeRequest } from '../change-request/change-request.mjs';
import {
  NESTED_INVOCATION,
  SET_OWNER,
  buildHandoffTarget,
  evaluateHandoff,
  handoffSatisfied,
  publicationSucceeded,
  buildShepherdBootstrap,
  dispatchHandoff,
  buildShepherdContinuationResult,
} from './shepherd-handoff.mjs';

/** What publication recorded: fixed forever, and never the freshness subject. */
const PUBLISHED_BASE = 'eb0ce00';
const PUBLISHED_HEAD = '57d9d26';

/** What shepherd observed after it rebased: a later, different pair. */
const REBASED_BASE = 'fdd15de';
const REBASED_HEAD = '3f78428';
const EXPECTED_WATCH = {
  identity: { changeRequest: '#111', branch: 'issue-26-ship-review-fixes' },
  stateDigest: '1'.repeat(64),
};
const ACCEPTED_WATCH = {
  ...EXPECTED_WATCH, status: 'watch-accepted',
  authority: { mode: 'ship-continuation', provenance: 'validated-ship-context' },
};

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
    expectedWatch: EXPECTED_WATCH,
    result: {
      watch: ACCEPTED_WATCH,
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

function deliveryToBootstrap() {
  const head = 'a'.repeat(40);
  const base = 'b'.repeat(40);
  const observedAt = '2026-09-11T12:00:00.000Z';
  const identity = {
    provider: 'github', repository: 'example/repo', changeRequest: '17',
    issue: '102', branch: 'issue-102', headRepository: 'example/repo', baseBranch: 'main',
  };
  const ledger = { id: 'ledger-102', alignment: 'confirmed', entries: [{ id: 'L1', classification: 'in-scope' }] };
  ledger.digest = digestConfirmedLedger(ledger);
  const checks = [{ name: 'validate', status: 'success', required: true, headSha: head }];
  return {
    outcome: 'verified',
    authority: { status: 'active', publish: true, handoff: true },
    intent: 'yes',
    target: { changeRequest: '17', headBranch: identity.branch, headSha: head, baseBranch: 'main', baseSha: base,
      upToDatePolicy: 'not-required', receipt: { observedAt, headSha: head, baseSha: base } },
    publication: { outcome: 'published', identifier: '17' },
    continuation: {
      originalIssue: identity.issue,
      ledger,
      changeRequest: { id: identity.changeRequest, issue: identity.issue, branch: identity.branch,
        provider: identity.provider, repository: identity.repository, headRepository: identity.headRepository, baseBranch: 'main' },
      priorDeliveryEvidence: {
        complete: true, issue: identity.issue, changeRequest: identity.changeRequest, branch: identity.branch,
        provider: identity.provider, repository: identity.repository, head, ledgerDigest: ledger.digest,
        reviewObservationDigest: '1'.repeat(64), reviewEvidenceIds: [], ciFailureIds: [],
      },
    },
    observedAt,
    observation: {
      identity,
      pullRequest: { state: 'open', baseBranch: 'main', headSha: head, mergeState: 'mergeable',
        mergeStateStatus: 'clean', blocked: false, behind: false, isDraft: false,
        upToDatePolicy: 'not-required', reviewDecision: 'APPROVED' },
      liveBase: { observed: true, identityBound: true, repository: identity.repository,
        ref: 'refs/heads/main', sha: base, observedAt },
      review: { observed: true, complete: true, identityBound: true, observationDigest: '1'.repeat(64) },
      checks, checkEvidence: { observed: true, complete: true, headSha: head,
        requiredChecks: [{ name: 'validate', appId: null }], checks },
      ownership: { branchOwned: true, providerAvailable: true, evidenceComplete: true },
    },
  };
}

test('Ship publication reaches current Shepherd bootstrap and accepted ownership without a merge question', async () => {
  const input = deliveryToBootstrap();
  const effects = [];
  input.publication = await publishChangeRequest({
    readState: () => input,
    push: async () => { effects.push('push'); return { status: 'pushed' }; },
    create: async () => { effects.push('create'); return input.publication; },
  });
  const handoff = await dispatchHandoff(input, {
    readState: () => input,
    invoke: async (bootstrap) => {
      effects.push('shepherd');
      assert.equal(bootstrap.mode, 'handoff-bootstrap');
      const state = createWatchState(bootstrap);
      return bootstrapAcceptance(state, {
        workerStatus: 'running', acceptedIdentity: state.targetIdentity, acceptedStateDigest: state.integrityDigest,
        disposition: 'mergeable-and-green',
        receipt: { ...input.target.receipt, upToDatePolicy: 'not-required', provider: 'supported-provider', complete: true },
      });
    },
  });
  assert.deepEqual(effects, ['push', 'create', 'shepherd']);
  assert.equal(handoff.invocation.status, 'returned');
  const result = evaluateHandoff({ ...input, ...handoff,
    observedBase: { ...input.target.receipt, observedAt: '2026-09-11T12:00:01.000Z' } });
  assert.equal(result.handoff, 'completed');
  assert.equal(result.freshness, 'fresh');
  assert.ok(result.setObligation);
  for (const watch of [undefined, { ...handoff.result.watch, authority: { mode: 'observation-only' } },
    { ...handoff.result.watch, stateDigest: '2'.repeat(64) },
    { ...handoff.result.watch, identity: { ...handoff.result.watch.identity, issue: 'other' } }]) {
    assert.equal(evaluateHandoff({ ...input, ...handoff, result: { ...handoff.result, watch } }).state, 'watch-acceptance-unproven');
  }
});

test('missing or mismatched confirmed delivery context never dispatches Shepherd', async () => {
  const mutations = [
    (input) => { delete input.continuation; },
    (input) => { input.continuation.ledger.alignment = 'proposed'; },
    (input) => { input.continuation.originalIssue = 'other'; },
    (input) => { input.continuation.priorDeliveryEvidence.head = 'c'.repeat(40); },
    (input) => { input.continuation.priorDeliveryEvidence.complete = false; },
    (input) => { input.continuation.changeRequest.id = '18'; },
    (input) => { input.observation.identity.repository = 'other/repo'; },
    (input) => { input.observation.ownership.branchOwned = false; },
    (input) => { input.observation.review.complete = false; },
    (input) => { input.observation.pullRequest.headSha = 'c'.repeat(40); },
    (input) => { input.target.baseSha = 'main'; },
    (input) => { input.target.receipt.headSha = 'c'.repeat(40); },
    (input) => { input.target.receipt.baseSha = 'c'.repeat(40); },
    (input) => { input.target.receipt.observedAt = 'unknown'; },
    (input) => { input.observedAt = '2026-09-11T11:59:00.000Z'; },
  ];
  for (const mutate of mutations) {
    const input = deliveryToBootstrap();
    mutate(input);
    assert.equal(buildShepherdBootstrap(input).accepted, false);
    const result = await dispatchHandoff(input, { readState: () => input, invoke: async () => assert.fail('must not dispatch') });
    assert.equal(result.accepted, false);
  }
});

test('non-green bootstrap preserves the producer action through dispatch and evaluation', async () => {
  for (const disposition of ['blocked', 'failing', 'needs-human']) {
    const input = deliveryToBootstrap();
    const nextHumanAction = `Inspect the actual ${disposition} action-cycle evidence.`;
    const handoff = await dispatchHandoff(input, {
      readState: () => input,
      invoke: async (bootstrap) => {
        const state = createWatchState(bootstrap);
        return bootstrapAcceptance(state, {
          workerStatus: 'running', acceptedIdentity: state.targetIdentity, acceptedStateDigest: state.integrityDigest,
          disposition, nextHumanAction,
          receipt: { ...input.target.receipt, upToDatePolicy: 'not-required', provider: 'supported-provider', complete: true },
        });
      },
    });
    const result = evaluateHandoff({ ...input, ...handoff,
      observedBase: { ...input.target.receipt, observedAt: '2026-09-11T12:00:01.000Z' } });
    assert.equal(result.handoff, 'completed', disposition);
    assert.equal(result.humanAction, nextHumanAction);
    assert.equal(result.disposition, disposition);
  }
});

test('top-level delivery and continuation always invoke Shepherd despite legacy no or absent intent', async () => {
  for (const intent of ['no', undefined]) {
    for (const mode of ['new-delivery', 'existing-change-request']) {
      const input = { ...deliveryToBootstrap(), intent, mode, handoffOwner: 'not-a-caller' };
      let calls = 0;
      const handoff = await dispatchHandoff(input, {
        readState: () => input,
        invoke: async () => { calls += 1; return { status: 'failed' }; },
        transfer: async () => assert.fail('top-level cannot transfer'),
      });
      assert.equal(calls, 1);
      assert.equal(handoff.invocation.mode, NESTED_INVOCATION);
      assert.equal(evaluateHandoff({ ...input, ...handoff }).handoff, 'not-performed');
    }
  }
});

test('nested transfer requires a real matching owner acceptance', async () => {
  for (const caller of [{ agentId: 'orchestrator-1', skill: 'other' }]) {
    const input = { ...deliveryToBootstrap(), caller, mode: 'existing-change-request',
      ...(caller.skill === 'shepherd' ? {} : { handoffOwner: 'maintainer-1' }) };
    const owner = input.handoffOwner ?? caller.agentId;
    let calls = 0;
    const handoff = await dispatchHandoff(input, {
      readState: () => input,
      invoke: async () => assert.fail('must not spawn a new watcher'),
      transfer: async (request) => {
        calls += 1;
        assert.equal(request.owner, owner);
        assert.deepEqual(request.target, input.target);
        return { status: 'returned', result: { transfer: {
          ...input.target.receipt, status: 'accepted', owner, responsibility: 'shepherd', changeRequest: '17',
        } } };
      },
    });
    assert.equal(calls, 1);
    const evaluation = { ...input, ...handoff,
      observedBase: { ...input.target.receipt, observedAt: '2026-09-11T12:00:01.000Z' } };
    assert.equal(evaluateHandoff(evaluation).handoff, 'completed');
    assert.equal(evaluateHandoff(evaluation).owner, owner);
    assert.equal(evaluateHandoff(evaluation).disposition, null, 'ownership is not a readiness claim');
    for (const mutation of [
      { status: 'planned' }, { owner: 'someone-else' }, { responsibility: 'observe-only' },
      { changeRequest: '18' }, { headSha: 'c'.repeat(40) }, { baseSha: 'd'.repeat(40) },
      { observedAt: '2026-09-11T11:59:59.000Z' }, { observedAt: 'invalid' },
    ]) {
      assert.equal(evaluateHandoff({ ...evaluation,
        result: { transfer: { ...handoff.result.transfer, ...mutation } } }).handoff, 'not-performed');
    }
    assert.equal(evaluateHandoff({ ...evaluation, observedBase: undefined }).handoff, 'not-performed');
    assert.equal(evaluateHandoff({ ...evaluation, invocation: { mode: 'planned', status: 'returned' } }).handoff, 'not-performed');
    const missing = await dispatchHandoff(input, { readState: () => input,
      invoke: async () => assert.fail('no fallback recursion') });
    assert.equal(evaluateHandoff({ ...input, ...missing }).handoff, 'not-performed');
    input.authority.status = 'withdrawn';
    assert.equal((await dispatchHandoff(input, { readState: () => input,
      transfer: async () => assert.fail('withdrawn transfer'), invoke: async () => assert.fail('withdrawn invocation') })).accepted, false);
  }
});

test('Shepherd consumes and persists Ship continuation without a pre-return acknowledgment', () => {
  const input = deliveryToBootstrap();
  const started = createWatchState(buildShepherdBootstrap(input).bootstrap);
  const changedObservation = structuredClone(input.observation);
  changedObservation.review.observationDigest = '2'.repeat(64);
  const changed = recordObservation(started, {
    observation: changedObservation, observedAt: '2026-09-11T12:02:00.000Z',
  });
  const { evidence } = watchAction(changed);
  const inFlight = beginShipDispatch(changed, {
    evidence, startedAt: '2026-09-11T12:02:30.000Z',
  });
  assert.ok(inFlight.inFlightShip);

  const completed = structuredClone(input);
  completed.mode = 'existing-change-request';
  completed.caller = { agentId: 'watcher-1', skill: 'shepherd' };
  const head = 'c'.repeat(40);
  const observedAt = '2026-09-11T12:03:00.000Z';
  completed.target.headSha = head;
  completed.target.receipt = { ...completed.target.receipt, headSha: head, observedAt };
  completed.continuation.priorDeliveryEvidence.head = head;
  completed.continuation.priorDeliveryEvidence.reviewObservationDigest = '2'.repeat(64);
  completed.observation = structuredClone(changedObservation);
  completed.observation.pullRequest.headSha = head;
  completed.observation.checks[0].headSha = head;
  completed.observation.checkEvidence.headSha = head;
  completed.observation.checkEvidence.checks[0].headSha = head;
  completed.observedAt = observedAt;

  const shipResult = buildShepherdContinuationResult(completed);
  assert.equal(shipResult.status, 'shipped-to-review');
  assert.equal(shipResult.resultingHead, head);
  const accepted = recordShipResult(inFlight, { evidence, shipResult, recordedAt: observedAt });
  assert.equal(accepted.status, 'running');
  assert.equal(accepted.inFlightShip, null);
  assert.equal(accepted.expectedHead, head);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-owner-return-'));
  try {
    const statePath = path.join(directory, 'watch.json');
    persistWatchState(statePath, accepted);
    const resumed = resumeWatch(loadWatchState(statePath), { resumedAt: '2026-09-11T12:04:00.000Z' });
    const observed = recordObservation(resumed, {
      observation: completed.observation, observedAt: '2026-09-11T12:05:00.000Z',
    });
    assert.equal(observed.status, 'running');
    assert.notEqual(watchAction(observed).action, 'invoke-ship');
    assert.equal(observed.expectedHead, head);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  for (const mutation of [
    { outcome: 'cancelled' },
    { authority: { status: 'withdrawn', handoff: true } },
    { outcome: 'incomplete' },
    { caller: { skill: 'shepherd' } },
    { continuation: undefined },
  ]) {
    const refused = buildShepherdContinuationResult({ ...completed, ...mutation });
    assert.notEqual(refused.status, 'shipped-to-review');
    assert.equal(recordShipResult(inFlight, { evidence, shipResult: refused, recordedAt: observedAt }).status, 'stopped');
  }
  const mismatched = { ...shipResult, identity: { ...shipResult.identity, issue: 'other' } };
  assert.equal(recordShipResult(inFlight, { evidence, shipResult: mismatched, recordedAt: observedAt }).status, 'stopped');
});

test('nested orchestration can invoke Shepherd rather than transfer', async () => {
  const input = { ...deliveryToBootstrap(), caller: { agentId: 'caller', skill: 'other' } };
  let called = false;
  await dispatchHandoff(input, { readState: () => input,
    invoke: async () => { called = true; return { status: 'failed' }; } });
  assert.equal(called, true);
});

test('a Shepherd continuation missing its watcher identity never recurses', async () => {
  const input = { ...deliveryToBootstrap(), mode: 'existing-change-request', caller: { skill: 'shepherd' } };
  const handoff = await dispatchHandoff(input, { readState: () => input,
    invoke: async () => assert.fail('missing owner is not top-level delivery'),
    transfer: async () => assert.fail('no identified owner') });
  assert.equal(handoff.accepted, false);
  assert.equal(evaluateHandoff({ ...input, ...handoff }).handoff, 'not-performed');
});

test('nested transfer rechecks live authority immediately before contacting the owner', async () => {
  for (const stop of [{ outcome: 'cancelled' }, { authority: { status: 'withdrawn', handoff: true } }]) {
    const input = { ...deliveryToBootstrap(), caller: { agentId: 'caller', skill: 'other' }, handoffOwner: 'owner' };
    let reads = 0;
    let calls = 0;
    const handoff = await dispatchHandoff(input, {
      readState: () => (++reads === 1 ? input : { ...input, ...stop }),
      transfer: async () => { calls += 1; return { status: 'returned' }; },
      invoke: async () => { calls += 1; return { status: 'returned' }; },
    });
    assert.equal(calls, 0);
    assert.equal(handoff.accepted, false);
    assert.equal(handoff.reason, 'authority-withheld');
  }
});

test('cancellation and withdrawal suppress push, creation and handoff, but exhausted authorized work publishes', async () => {
  for (const outcome of ['cancelled', 'undisclosed-change', 'ambiguous-mapping', 'isolation-refused', 'unknown']) {
    const state = { ...deliveryToBootstrap(), outcome };
    const forbidden = async () => assert.fail('external effect after stop');
    assert.equal((await publishChangeRequest({ readState: () => state, push: forbidden, create: forbidden })).outcome, 'withheld-by-outcome');
    assert.equal((await dispatchHandoff(state, { readState: () => state, invoke: forbidden })).accepted, false);
  }
  const state = deliveryToBootstrap();
  state.authority.status = 'withdrawn';
  const forbidden = async () => assert.fail('effect after withdrawal');
  assert.equal((await publishChangeRequest({ readState: () => state, push: forbidden, create: forbidden })).pushed, false);
  assert.equal((await dispatchHandoff(state, { readState: () => state, invoke: forbidden })).accepted, false);
  state.authority.status = 'active';
  assert.deepEqual(await publishChangeRequest({ readState: () => state,
    push: async () => { state.outcome = 'cancelled'; return { status: 'pushed' }; },
    create: forbidden }), { outcome: 'withheld-by-outcome', pushed: true });
  state.outcome = 'verified';
  let reads = 0;
  const stoppedHandoff = await dispatchHandoff(state, {
    readState: () => (++reads === 1 ? state : { ...state, outcome: 'cancelled' }),
    invoke: forbidden,
  });
  assert.equal(stoppedHandoff.accepted, false);
  assert.equal(stoppedHandoff.reason, 'authority-withheld');
  const alreadyPublished = await publishChangeRequest({
    readState: () => state, push: async () => ({ status: 'pushed' }),
    create: async () => { state.outcome = 'cancelled'; return state.publication; },
  });
  assert.equal(alreadyPublished.outcome, 'published');
  assert.equal((await dispatchHandoff(state, { readState: () => state, invoke: forbidden })).accepted, false);
  for (const outcome of ['incomplete', 'handed-back']) {
    state.outcome = outcome;
    const published = await publishChangeRequest({ readState: () => state,
      push: async () => ({ status: 'pushed' }), create: async () => state.publication });
    assert.equal(published.outcome, 'published');
  }
});

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
  for (const status of [undefined, null, '', 'dispatched', 'running', 'complete']) {
    const result = evaluateHandoff(completeHandoff({
      invocation: { mode: NESTED_INVOCATION, status },
    }));

    assert.equal(result.handoff, 'not-performed');
    assert.equal(result.state, 'invocation-not-returned');
    assert.equal(result.shipStatus, 'blocked');
    assert.ok(!handoffSatisfied(result));
  }

  for (const dispatched of [
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
      result: { disposition: 'mergeable-and-green', watch: ACCEPTED_WATCH, receipt },
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

test('legacy intent cannot exempt a top-level published request from accepted ownership', () => {
  for (const intent of ['no', undefined, null, '', 'maybe', true, 'Yes']) {
    const absent = evaluateHandoff(completeHandoff({ intent, invocation: undefined, result: undefined }));
    assert.equal(absent.handoff, 'not-performed');
    assert.equal(absent.state, 'not-invoked');
    assert.equal(absent.shipStatus, 'blocked');
    assert.equal(evaluateHandoff(completeHandoff({ intent })).handoff, 'completed');
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

test('legacy no without an owner still leaves the expiry obligation', () => {
  const result = evaluateHandoff(completeHandoff({ intent: 'no', invocation: undefined }));
  assert.equal(result.handoff, 'not-performed');
  assert.equal(result.state, 'not-invoked');
  assert.equal(handoffSatisfied(result), false);
  assert.equal(result.setObligation.changeRequest, '#111');
  assert.equal(result.setObligation.baseSha, PUBLISHED_BASE);
});

test('every published change request leaves the run with an obligation', () => {
  // The states below are the ones that end `blocked`, which is exactly when a
  // change request is least likely to be watched by anybody. An obligation
  // that appeared only on the happy path would be missing from every case that
  // needs it.
  const blocked = [
    ['not-invoked', { intent: undefined, invocation: undefined }],
    ['not-invoked', { invocation: { mode: 'narrated', status: 'returned' } }],
    ['shepherd-unavailable', { invocation: { mode: NESTED_INVOCATION, status: 'unavailable' } }],
    ['invocation-not-returned', { invocation: { mode: NESTED_INVOCATION, status: 'dispatched' } }],
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
    ['not-invoked', { intent: undefined, invocation: undefined }],
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
    result: { disposition: 'mergeable-and-green', watch: ACCEPTED_WATCH, receipt: { baseSha: REBASED_BASE } },
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
