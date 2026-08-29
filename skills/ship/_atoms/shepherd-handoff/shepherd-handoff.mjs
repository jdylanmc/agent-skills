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
 * 1. **A handoff is an invocation, not a sentence.** Describing what shepherd
 *    should do next is indistinguishable, in the report, from having invoked
 *    it. So the only invocation this accepts is a nested one in a separate
 *    worker context that returned a terminal disposition. Anything else is
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

/**
 * The only invocation shape that hands anything over. Shepherd needs `edit`
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
 * @param {'yes'|'no'|unknown} [input.intent] The recorded shepherd intent.
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
  const { intent, publication, invocation, result } = input;
  const built = buildHandoffTarget(input.target ?? {});
  const target = built.target;

  // Publication is decided once, before intent, so both intent paths agree
  // about a run that published nothing.
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

  if (intent === 'no') {
    // The operator declined it. Conditional means conditional, and a decline
    // is a decision rather than an omission.
    return satisfied('not-required', 'declined-by-operator', { target });
  }

  if (intent !== 'yes') {
    return notPerformed('intent-unrecorded', {
      target,
      unmet: ['intent: no shepherd intent was recorded before the run started'],
      humanAction:
        'Ask whether this change request should be shepherded, record the answer, and re-run the handoff.',
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

  if (!isTerminalDisposition(result?.disposition)) {
    // A dispatch nobody waited on looks exactly like this. Reporting
    // completion here would be reporting somebody else's unfinished work.
    return notPerformed('no-terminal-disposition', {
      target,
      unmet: [`result: disposition is ${describe(result?.disposition)}`],
      humanAction: humanActionFor(target, 'shepherd returned no terminal disposition'),
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
 * decision got past intent, target, invocation mode, invocation status, and
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
