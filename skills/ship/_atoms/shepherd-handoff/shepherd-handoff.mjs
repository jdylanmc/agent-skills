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
 */

import {
  compareObservation,
  isTerminalDisposition,
  normalizeUpToDatePolicy,
  requiresUpToDateBranch,
  validateFreshnessReceipt,
} from '../../../_base/_atoms/landability/landability.mjs';

export { isTerminalDisposition, normalizeUpToDatePolicy };

/**
 * The only invocation shape that hands anything over. Shepherd needs `edit`
 * and `execute` inside a worktree it owns, which the delivery orchestration
 * does not hold, so the work cannot happen in its context even in principle.
 */
export const NESTED_INVOCATION = 'nested-worker';

/** Ownership fields without which nobody can tell what was handed to whom. */
const REQUIRED_TARGET_FIELDS = ['changeRequest', 'headBranch', 'headSha', 'baseBranch', 'baseSha'];

/** Publication-time observations that make the handoff auditable afterwards. */
const REQUIRED_RECEIPT_FIELDS = ['observedAt', 'baseSha', 'headSha'];

function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

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
    changeRequest: text(input.changeRequest),
    headBranch: text(input.headBranch),
    headSha: text(input.headSha),
    baseBranch: text(input.baseBranch),
    baseSha: text(input.baseSha),
    upToDatePolicy: normalizeUpToDatePolicy(input.upToDatePolicy),
    receipt: {
      observedAt: text(receipt.observedAt),
      baseSha: text(receipt.baseSha) ?? text(input.baseSha),
      headSha: text(receipt.headSha) ?? text(input.headSha),
    },
  };

  const missing = [
    ...REQUIRED_TARGET_FIELDS.filter((field) => !target[field]).map((field) => `target.${field}`),
    ...REQUIRED_RECEIPT_FIELDS.filter((field) => !target.receipt[field]).map((field) => `receipt.${field}`),
  ];

  return { target, missing };
}

/**
 * Normalize the reading taken **after** shepherd returned.
 *
 * A partial or wrongly typed reading is no reading. Accepting one would let a
 * caller satisfy the freshness check by passing an object shaped like an
 * observation.
 *
 * @param {unknown} input
 * @returns {{observedAt: string|null, baseSha: string|null, headSha: string|null, complete: boolean}}
 */
export function normalizeObservation(input) {
  if (input === null || typeof input !== 'object') {
    return { observedAt: null, baseSha: null, headSha: null, complete: false };
  }
  const observedAt = text(input.observedAt);
  const baseSha = text(input.baseSha);
  const headSha = text(input.headSha);
  return { observedAt, baseSha, headSha, complete: Boolean(baseSha && headSha) };
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
  const { intent, publication, invocation, result } = input;
  const built = buildHandoffTarget(input.target ?? {});
  const target = built.target;

  // Publication is decided once, before intent, so both intent paths agree
  // about a run that published nothing.
  if (publication?.outcome !== 'published') {
    return satisfied('not-required', 'no-published-target', {
      target: null,
      unmet: [`publication: outcome is ${describe(publication?.outcome)}`],
      humanAction: 'Report the publication outcome as given. No change request exists to shepherd.',
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

  const observation = normalizeObservation(input.observedBase);
  const { freshness, drifted } = compareObservation(result.receipt, observation);
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

  if (freshness === 'unobserved' && requiresUpToDateBranch(policy)) {
    // The base decides landability here, and nobody read it. Under any other
    // policy an unread base is a gap in the report; under this one it is the
    // whole question.
    return notPerformed('freshness-unobserved', {
      target,
      disposition: result.disposition,
      freshness,
      policy,
      requiresReinvocation: true,
      unmet: ['observation: the base and head were not re-read after shepherd returned'],
      humanAction: `${target.changeRequest} (branch ${target.headBranch}) sits on a base that requires containing it: re-read the base and head, then re-check or invoke shepherd again.`,
    });
  }

  return satisfied('completed', `shepherd-${result.disposition}`, {
    target,
    disposition: result.disposition,
    freshness,
    policy,
    humanAction: result.disposition === 'mergeable-and-green' ? null : result.nextHumanAction ?? null,
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
