/**
 * Deterministic handoff contract between a finished delivery run and the
 * skill that keeps the published change request landable.
 *
 * This exists because of a specific failure, not a hypothetical one. A change
 * request was opened green and mergeable, the run reported it as ready, and
 * nothing owned it afterwards. A sibling change request merged into the same
 * base about ninety minutes later, the base branch requires a change request
 * to contain the current base before it may merge, and the pull request that
 * had been reported ready silently stopped being mergeable. A person noticed,
 * not a workflow.
 *
 * Three properties are pinned here, and none survives in prose:
 *
 * 1. **A handoff is accepted ownership, not a sentence.** Describing what shepherd
 *    should do next is indistinguishable, in the report, from having invoked
 *    it. A new watch requires a separate worker and terminal disposition;
 *    an explicit nested transfer requires the identified owner's acceptance.
 *    Anything else is
 *    `not-performed`, and the run may not report its own completion.
 * 2. **Two snapshots, and they are not interchangeable.** The publication
 *    receipt records what was handed over and when — ownership evidence, fixed
 *    forever. The shepherd receipt records what shepherd actually observed,
 *    which is a *later* and usually different pair of commits, because a
 *    successful rebase moves both. Freshness compares the shepherd receipt,
 *    never the publication one, against a reading taken after shepherd
 *    returned. Comparing the immutable one would make every successful rebase
 *    permanently stale.
 * 3. **An unread base is not a fresh one.** When the base requires the branch
 *    to contain it, failing to re-read after shepherd returns leaves the one
 *    fact that decides landability unknown, and unknown is not evidence.
 * 4. **The expiry leaves the run.** Handing over one change request settles
 *    who owns *it*; it settles nothing about the set it belongs to. So every
 *    evaluation that names a published change request returns the obligation
 *    the caller inherits — the change request, the base its readiness was
 *    observed against, the condition that expires that readiness, and the
 *    exact re-invocation — because a duty stated only in prose is inherited by
 *    nobody. Emitting it is not watching: this returns and holds nothing.
 */

import {
  UP_TO_DATE_POLICIES,
  compareObservation,
  isTerminalDisposition,
  nonEmptyString,
  normalizeUpToDatePolicy,
  validateFreshnessReceipt,
} from '../../../_base/_atoms/landability/landability.mjs';
import { createWatchState } from '../../../shepherd/_atoms/watch-state/watch-state.mjs';
import { deliveryEffectAllowed } from '../change-request/change-request.mjs';

/**
 * Adapt confirmed Ship delivery evidence to Shepherd's existing bootstrap.
 * The observation is provider evidence, including proven branch ownership.
 * Missing continuation is refused, never repaired with invented confirmation.
 */
export function buildShepherdBootstrap(input = {}) {
  const { publication, continuation, observation, observedAt } = input;
  const built = buildHandoffTarget(input.target);
  const refuse = (reason) => ({ accepted: false, reason, target: built.target });
  if (!deliveryEffectAllowed(input, 'handoff')) return refuse('authority-withheld');
  if (!publicationSucceeded(publication)) return refuse('no-published-target');
  if (built.missing.length) return refuse('target-incomplete');
  const target = built.target;
  if (![target.headSha, target.baseSha].every((sha) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))
    || target.receipt.headSha !== target.headSha
    || target.receipt.baseSha !== target.baseSha
    || !Number.isFinite(Date.parse(target.receipt.observedAt))
    || Date.parse(observedAt) < Date.parse(target.receipt.observedAt)) {
    return refuse('publication-snapshot-mismatched');
  }
  if (!continuation) return refuse('missing-ship-continuation-context');
  const identity = observation?.identity;
  if (built.target.changeRequest !== publication.identifier
    || identity?.changeRequest !== publication.identifier
    || identity?.branch !== built.target.headBranch
    || observation?.pullRequest?.baseBranch !== built.target.baseBranch
    || observation?.pullRequest?.headSha !== built.target.headSha) {
    return refuse('target-publication-mismatch');
  }
  const bootstrap = { mode: 'handoff-bootstrap', continuation, observation, observedAt };
  try {
    const state = createWatchState(bootstrap);
    return {
      accepted: true,
      target: built.target,
      bootstrap,
      expectedWatch: { identity: state.targetIdentity, stateDigest: state.integrityDigest },
    };
  } catch {
    return refuse('continuation-or-observation-mismatched');
  }
}

/**
 * Return to the watcher that dispatched this continuation. Its existing
 * recordShipResult/persistence path validates the result after this task ends;
 * there is no new owner and no pre-return acknowledgment to wait for.
 */
export function buildShepherdContinuationResult(input = {}) {
  const mode = 'existing-change-request';
  const refuse = (reason, status = 'blocked') => ({
    status, mode, reason, identity: input.observation?.identity ?? null,
  });
  if (input.mode !== mode || input.caller?.skill !== 'shepherd'
    || !nonEmptyString(input.caller.agentId)) return refuse('owner-unidentified');
  if (input.outcome === 'cancelled' || input.authority?.status === 'withdrawn') {
    return refuse('authority-withheld', 'cancelled');
  }
  if (input.outcome !== 'verified') return refuse('continuation-not-verified');
  const built = buildShepherdBootstrap(input);
  if (!built.accepted) return refuse(built.reason);
  return {
    status: 'shipped-to-review',
    mode,
    resultingHead: built.target.headSha,
    identity: built.expectedWatch.identity,
    continuation: structuredClone(built.bootstrap.continuation),
  };
}

/** One bounded dispatch for new ownership, never a return to an existing owner. */
export async function dispatchHandoff(input, { readState, invoke, transfer }) {
  const current = { ...input, ...readState() };
  if (current.mode === 'existing-change-request' && current.caller?.skill === 'shepherd') {
    return { accepted: false, reason: 'return-to-existing-owner',
      invocation: { mode: 'caller-return', status: 'not-invoked' } };
  }
  const route = handoffRoute(current);
  const { owner } = route;
  if (route.mode === 'owner-transfer') {
    const built = buildHandoffTarget(current.target);
    const refuse = (reason) => ({ ...built, accepted: false, reason,
      invocation: { mode: 'owner-transfer', status: 'not-invoked' } });
    if (!deliveryEffectAllowed(current, 'handoff')) return refuse('authority-withheld');
    if (!owner) return refuse('owner-unidentified');
    if (!publicationSucceeded(current.publication)) return refuse('no-published-target');
    if (built.missing.length) return refuse('target-incomplete');
    if (built.target.changeRequest !== current.publication.identifier) return refuse('target-publication-mismatch');
    if (!deliveryEffectAllowed(readState(), 'handoff')) return refuse('authority-withheld');
    try {
      const returned = await transfer({ owner, target: built.target });
      return { target: built.target, accepted: true,
        invocation: { mode: 'owner-transfer', status: returned?.status }, result: returned?.result };
    } catch {
      return { target: built.target, accepted: false,
        invocation: { mode: 'owner-transfer', status: 'failed' } };
    }
  }
  const built = buildShepherdBootstrap(current);
  if (!built.accepted) return { ...built, invocation: { mode: NESTED_INVOCATION, status: 'not-invoked' } };
  if (!deliveryEffectAllowed(readState(), 'handoff')) {
    return { ...built, accepted: false, reason: 'authority-withheld', invocation: { mode: NESTED_INVOCATION, status: 'not-invoked' } };
  }

  try {
    const returned = await invoke(built.bootstrap);
    return { ...built, invocation: { mode: NESTED_INVOCATION, status: returned?.status }, result: returned?.result };
  } catch {
    return { ...built, invocation: { mode: NESTED_INVOCATION, status: 'failed' } };
  }
}

function handoffRoute(input) {
  const owner = nonEmptyString(input.caller?.agentId) && nonEmptyString(input.handoffOwner);
  return owner ? { mode: 'owner-transfer', owner } : { mode: NESTED_INVOCATION };
}

/**
 * The invocation shape for a new watch. Shepherd needs `edit`
 * inside a worktree it owns, which the delivery orchestration does not hold,
 * so the work cannot happen in its context even in principle.
 */
export const NESTED_INVOCATION = 'nested-worker';

/** Ownership fields without which nobody can tell what was handed to whom. */
const REQUIRED_TARGET_FIELDS = ['changeRequest', 'headBranch', 'headSha', 'baseBranch', 'baseSha'];

/**
 * Who the expiry is addressed to. Naming the actor is the whole point: an
 * obligation with no actor reads as a note, and a note addressed to this run
 * would be an instruction to watch, which is the daemon this atom refuses to
 * become.
 */
export const SET_OWNER = 'the caller that owns the set of open change requests';

/** Publication-time observations that make the handoff auditable afterwards. */
const REQUIRED_RECEIPT_FIELDS = ['observedAt', 'baseSha', 'headSha'];

/**
 * Build the handoff target: what is handed over, and what was true at
 * publication.
 *
 * The receipt here is **pre-invocation ownership evidence**. It is never
 * compared against a later observation, because shepherd is expected to move
 * the branch and, under a required up-to-date policy, is expected to move it
 * onto a base that has advanced.
 *
 * @param {object} [input]
 * @returns {{target: object, missing: string[]}}
 */
export function buildHandoffTarget(input = {}) {
  const receipt = input.receipt ?? {};
  const target = {
    changeRequest: nonEmptyString(input.changeRequest),
    headBranch: nonEmptyString(input.headBranch),
    headSha: nonEmptyString(input.headSha),
    baseBranch: nonEmptyString(input.baseBranch),
    baseSha: nonEmptyString(input.baseSha),
    upToDatePolicy: normalizeUpToDatePolicy(input.upToDatePolicy),
    receipt: {
      observedAt: nonEmptyString(receipt.observedAt),
      baseSha: nonEmptyString(receipt.baseSha) ?? nonEmptyString(input.baseSha),
      headSha: nonEmptyString(receipt.headSha) ?? nonEmptyString(input.headSha),
    },
  };

  const missing = [
    ...REQUIRED_TARGET_FIELDS.filter((field) => !target[field]).map((field) => `target.${field}`),
    ...(input.upToDatePolicy === true
      || input.upToDatePolicy === false
      || UP_TO_DATE_POLICIES.includes(input.upToDatePolicy)
      ? []
      : ['target.upToDatePolicy']),
    ...REQUIRED_RECEIPT_FIELDS.filter((field) => !target.receipt[field]).map((field) => `receipt.${field}`),
  ];

  return { target, missing };
}

export function publicationSucceeded(publication) {
  return publication?.outcome === 'published' && nonEmptyString(publication.identifier) !== null;
}

/**
 * Decide what the handoff did, and whether the run may report completion.
 *
 * Every failure class returns `not-performed` with the target named and one
 * exact human action, because the failure being prevented is a report that
 * reads as though somebody has it.
 *
 * @param {object} [input]
 * @param {{outcome?: string, identifier?: string}} [input.publication]
 * @param {object} [input.caller] Actual invoking agent identity, absent at top level.
 * @param {string} [input.handoffOwner] Explicit nested responsibility transfer.
 * @param {object} [input.target] Input for {@link buildHandoffTarget}.
 * @param {{mode?: string, status?: string, reason?: string}} [input.invocation]
 * @param {{disposition?: string, receipt?: object, nextHumanAction?: string}} [input.result]
 * @param {{baseSha?: string, headSha?: string, observedAt?: string}} [input.observedBase]
 *   The base and head re-read after shepherd returned.
 * @returns {object}
 */
export function evaluateHandoff(input = {}) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('evaluateHandoff expects an object');
  }
  const evaluation = decideHandoff(input);
  // The obligation is attached once, here, rather than at each return. Every
  // branch below already decides ownership of *this* change request; the
  // expiry it inherits is the same fact whichever branch decided it, and
  // threading it through fourteen returns is how one of them comes to omit it.
  return { ...evaluation, setObligation: buildSetObligation(input, evaluation) };
}

/** Decide the handoff itself. The set obligation is attached by the caller. */
function decideHandoff(input) {
  const { publication, invocation, result } = input;
  const built = buildHandoffTarget(input.target ?? {});
  const target = built.target;

  if (input.outcome === 'cancelled' || input.authority?.status === 'withdrawn') {
    return notPerformed('authority-withheld', {
      target, humanAction: 'Do not hand off or mutate further without a new explicit operator request.',
      unmet: ['delivery authority was cancelled or withdrawn'],
    });
  }
  // No publication means no request to hand over.
  if (!publicationSucceeded(publication)) {
    return satisfied('not-required', 'no-published-target', {
      target: null,
      unmet: [`publication: outcome is ${describe(publication?.outcome)}`],
      humanAction: 'Report the publication outcome as given. No change request exists to shepherd.',
    });
  }

  const publishedChangeRequest = nonEmptyString(publication.identifier);
  if (
    target.changeRequest !== null
    && publishedChangeRequest !== null
    && target.changeRequest !== publishedChangeRequest
  ) {
    return notPerformed('target-publication-mismatch', {
      target,
      unmet: [
        `target.changeRequest is ${target.changeRequest}, but publication.identifier is ${publishedChangeRequest}`,
      ],
      humanAction:
        `Rebuild the handoff target for ${publishedChangeRequest} from that publication receipt before invoking shepherd.`,
    });
  }

  if (built.missing.length > 0) {
    return notPerformed('target-incomplete', {
      target,
      unmet: built.missing.map((field) => `${field} is absent`),
      humanAction:
        'Capture the change request, branch, head SHA, base branch, base SHA, and observation time, then hand over.',
    });
  }

  const route = handoffRoute(input);
  const { owner } = route;
  if (route.mode === 'owner-transfer') {
    if (!owner) {
      return notPerformed('owner-unidentified', {
        target, humanAction: 'Recover the invoking Shepherd watcher identity before returning responsibility; do not start another watcher.',
      });
    }
    const receipt = result?.transfer;
    if (invocation?.mode !== 'owner-transfer' || invocation.status !== 'returned'
      || receipt?.status !== 'accepted' || receipt.owner !== owner
      || receipt.responsibility !== 'shepherd'
      || receipt.changeRequest !== target.changeRequest
      || receipt.headSha !== target.headSha || receipt.baseSha !== target.baseSha
      || ![target.headSha, target.baseSha].every((sha) => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha))
      || target.receipt.headSha !== target.headSha || target.receipt.baseSha !== target.baseSha
      || !Number.isFinite(Date.parse(target.receipt.observedAt))
      || !Number.isFinite(Date.parse(receipt.observedAt))
      || Date.parse(receipt.observedAt) < Date.parse(target.receipt.observedAt)) {
      return notPerformed('owner-acceptance-unproven', {
        target, owner, humanAction: `Obtain ${owner}'s actual acceptance of Shepherd responsibility for ${target.changeRequest}; do not leave it unattended.`,
      });
    }
    const { freshness } = compareObservation(receipt, input.observedBase);
    if (freshness !== 'fresh') {
      return notPerformed('owner-acceptance-not-current', {
        target, owner, freshness,
        humanAction: `Re-read the base and head and obtain ${owner}'s acceptance for the current change request.`,
      });
    }
    return satisfied('completed', 'transferred-to-owner', { target, owner, freshness });
  }

  if (invocation?.mode !== NESTED_INVOCATION) {
    return notPerformed('not-invoked', {
      target,
      unmet: [`invocation: mode is ${describe(invocation?.mode)}, not ${NESTED_INVOCATION}`],
      humanAction: humanActionFor(target, 'nobody invoked shepherd'),
    });
  }

  if (invocation.status === 'unavailable') {
    return notPerformed('shepherd-unavailable', {
      target,
      unmet: [`invocation: shepherd is unavailable (${describe(invocation.reason)})`],
      humanAction: humanActionFor(target, 'shepherd was unavailable'),
    });
  }

  if (invocation.status === 'failed') {
    return notPerformed('invocation-failed', {
      target,
      unmet: [`invocation: dispatch failed (${describe(invocation.reason)})`],
      humanAction: humanActionFor(target, 'the shepherd dispatch failed'),
    });
  }

  if (invocation.status !== 'returned') {
    return notPerformed('invocation-not-returned', {
      target,
      unmet: [`invocation: status is ${describe(invocation?.status)}, not returned`],
      humanAction: humanActionFor(target, 'the shepherd invocation did not return'),
    });
  }

  if (!isTerminalDisposition(result?.disposition)) {
    // A dispatch nobody waited on looks exactly like this. Reporting
    // completion here would be reporting somebody else's unfinished work.
    return notPerformed('no-terminal-disposition', {
      target,
      unmet: [`result: disposition is ${describe(result?.disposition)}`],
      humanAction: humanActionFor(target, 'shepherd returned no terminal disposition'),
    });
  }

  const expected = input.expectedWatch;
  const watch = result?.watch;
  const sameIdentity = expected?.identity && watch?.identity
    && Object.keys(expected.identity).length === Object.keys(watch.identity).length
    && Object.entries(expected.identity).every(([key, value]) => watch.identity[key] === value);
  if (watch?.status !== 'watch-accepted'
    || watch?.authority?.mode !== 'ship-continuation'
    || watch?.authority?.provenance !== 'validated-ship-context'
    || !sameIdentity
    || !/^[a-f0-9]{64}$/.test(expected?.stateDigest ?? '')
    || watch.stateDigest !== expected.stateDigest) {
    return notPerformed('watch-acceptance-unproven', {
      target,
      unmet: ['Shepherd did not accept the confirmed continuation identity and bootstrap state'],
      humanAction: humanActionFor(target, 'maintenance ownership was not accepted'),
    });
  }

  const receipt = validateFreshnessReceipt(result.receipt);
  if (!receipt.valid) {
    // A disposition with no usable receipt cannot be checked against anything
    // later, so it is an unverifiable claim rather than evidence.
    return notPerformed('result-receipt-incomplete', {
      target,
      disposition: result.disposition,
      unmet: receipt.defects,
      humanAction: humanActionFor(target, 'shepherd returned no usable freshness receipt'),
    });
  }

  const { freshness, drifted } = compareObservation(result.receipt, input.observedBase);
  const policy = effectivePolicy(result.receipt, target);

  if (freshness === 'stale') {
    return notPerformed('stale-disposition', {
      target,
      disposition: result.disposition,
      freshness,
      policy,
      requiresReinvocation: true,
      unmet: drifted.map((entry) => `observation: ${entry} since shepherd observed it`),
      humanAction: humanActionFor(target, 'the change request moved after shepherd observed it'),
    });
  }

  if (freshness === 'unobserved') {
    return notPerformed('freshness-unobserved', {
      target,
      disposition: result.disposition,
      freshness,
      policy,
      requiresReinvocation: true,
      unmet: ['observation: the base and head were not re-read after shepherd returned'],
      humanAction: `${target.changeRequest} (branch ${target.headBranch}) has no verified post-shepherd observation: re-read the base and head, then re-check or invoke shepherd again.`,
    });
  }

  if (
    !['mergeable-and-green', 'no-op-mergeable-and-green'].includes(result.disposition)
    && !nonEmptyString(result.nextHumanAction)
  ) {
    return notPerformed('result-action-incomplete', {
      target,
      disposition: result.disposition,
      freshness,
      policy,
      unmet: [`result.nextHumanAction is absent for ${result.disposition}`],
      humanAction: humanActionFor(target, `shepherd returned ${result.disposition} without a next human action`),
    });
  }

  return satisfied('completed', `shepherd-${result.disposition}`, {
    target,
    disposition: result.disposition,
    freshness,
    policy,
    humanAction: ['mergeable-and-green', 'no-op-mergeable-and-green'].includes(result.disposition)
      ? null
      : result.nextHumanAction,
  });
}

/**
 * True when the handoff imposes no bar on the run's reported status: it either
 * completed, or it was never required.
 *
 * This is deliberately not called permission to report `shipped-to-review`. A
 * run that published nothing satisfies the handoff and still has no change
 * request to report; publication carries that contract, and one function
 * answering both questions is how a failed publication would slip through as a
 * delivery.
 */
export function handoffSatisfied(evaluation) {
  return evaluation?.handoff === 'completed' || evaluation?.handoff === 'not-required';
}

/**
 * Build the obligation the caller inherits for the set this change request
 * belongs to, or `null` when no change request was published.
 *
 * The base it binds to is the one the **readiness was observed against**, so
 * the shepherd receipt wins over the publication snapshot exactly as freshness
 * does. Binding to the publication base would date the claim to before the
 * rebase that made it true, which is the same confusion of the two snapshots
 * that freshness already refuses.
 *
 * **Provenance is read from the decision above, never re-derived here.** A
 * second copy of "did shepherd genuinely observe this" is a second answer
 * waiting to disagree with the first, and the way it disagrees is the worst one
 * available: a narrated handoff carries a well-formed result, so a copy that
 * forgot to check the invocation would stamp the obligation with a base no
 * shepherd ever saw, on exactly the states this unit exists to disbelieve. A
 * recorded disposition is that verdict, and only that one: it proves the
 * decision got past target, invocation mode, invocation status, and
 * terminality.
 *
 * It does not prove the receipt can bind anything, because
 * `result-receipt-incomplete` deliberately keeps the terminal disposition while
 * refusing the receipt — the one fact shepherd did establish is worth
 * reporting, and an unusable receipt is still unusable. So usability is checked
 * here, for the narrower question of which base to bind. Without a usable
 * receipt the captured base is the honest binding, because no later observation
 * was ever established.
 *
 * A change request with no owner still gets an obligation. The failure this
 * atom exists for is a change request nobody was watching; a run that hands
 * back `blocked` has told somebody it needs an owner, and telling them it also
 * expires costs nothing and is the same sentence they will need next.
 *
 * Nothing published is nothing to own, and that is decided by
 * {@link publicationSucceeded} rather than by an identifier being present. A
 * failed publication can still carry the identifier the provider echoed back,
 * and an obligation built from it would name a change request that does not
 * exist — a duty addressed to a caller about nothing.
 */
export function buildSetObligation(input = {}, evaluation = {}) {
  if (!publicationSucceeded(input?.publication)) {
    return null;
  }

  const changeRequest = nonEmptyString(input.publication.identifier);
  // Target provenance belongs to the published request only when its identity
  // was positively established as the same one. A missing identity is not a
  // weaker match: it is no match, and may not donate another request's base.
  const target = nonEmptyString(evaluation?.target?.changeRequest) === changeRequest
    ? evaluation.target
    : null;
  const observed = nonEmptyString(evaluation?.disposition) !== null
    && validateFreshnessReceipt(input?.result?.receipt).valid;
  const baseBranch = nonEmptyString(target?.baseBranch);
  const baseSha = (observed ? nonEmptyString(input.result.receipt.baseSha) : null)
    ?? nonEmptyString(target?.baseSha);
  const into = baseBranch === null ? 'its base branch' : baseBranch;

  return {
    changeRequest,
    baseBranch,
    baseSha,
    owner: SET_OWNER,
    expiresWhen: `anything else merges into ${into}`,
    reinvocation: `Invoke shepherd on ${changeRequest} again, then re-read its base and head, `
      + 'before it is presented as ready.',
    // An obligation whose base was never captured cannot be checked against
    // anything later. It is still emitted, because the change request is still
    // real and still somebody's, and the missing facts are named rather than
    // left for a reader to notice their absence.
    unresolved: [
      ...(baseBranch === null ? ['baseBranch'] : []),
      ...(baseSha === null ? ['baseSha'] : []),
    ],
  };
}

/** The shepherd receipt states the policy it observed; the target only records what was known earlier. */
function effectivePolicy(receipt, target) {
  const observed = normalizeUpToDatePolicy(receipt?.upToDatePolicy);
  return observed === 'unobserved' ? normalizeUpToDatePolicy(target?.upToDatePolicy) : observed;
}

function satisfied(handoff, state, extra = {}) {
  return { ...base(), handoff, state, ...extra };
}

function notPerformed(state, extra = {}) {
  return {
    ...base(),
    handoff: 'not-performed',
    state,
    // `blocked` names this run, not the change request: the delivery is not
    // finished, because the step that finishes it did not happen.
    shipStatus: 'blocked',
    ...extra,
  };
}

function base() {
  return {
    handoff: 'not-required',
    state: null,
    shipStatus: null,
    disposition: null,
    freshness: 'unobserved',
    policy: 'unobserved',
    requiresReinvocation: false,
    setObligation: null,
    unmet: [],
    humanAction: null,
  };
}

function humanActionFor(target, because) {
  return `${target.changeRequest} (branch ${target.headBranch}) has no owner: ${because}. Invoke shepherd on it, or take it over.`;
}

function describe(value) {
  return value === undefined || value === null ? 'absent' : String(value);
}
