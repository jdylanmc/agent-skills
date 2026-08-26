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
 * Two properties are pinned here, and neither survives in prose:
 *
 * 1. **A handoff is an invocation, not a sentence.** Describing what shepherd
 *    should do next is indistinguishable, in the report, from having invoked
 *    it. So the only invocation this accepts is a nested one in a separate
 *    worker context that returned a terminal disposition. Anything else is
 *    `not-performed`, and the run may not report its own completion.
 * 2. **A shepherd result is bound to the snapshot it observed.** It says the
 *    change request was landable against one base commit at one moment. It is
 *    not durable permission, and once the base moves it is evidence about a
 *    state that no longer exists.
 */

/** Every disposition shepherd may end on. Anything else is not an ending. */
export const TERMINAL_SHEPHERD_DISPOSITIONS = new Set([
  'mergeable-and-green',
  'no-op-mergeable-and-green',
  'provider-unsupported',
  'provider-tool-missing',
  'provider-tool-unauthenticated',
  'needs-human',
  'blocked',
  'failing',
]);

/**
 * The only invocation shape that hands anything over. Shepherd needs `edit`
 * and `execute`, which the delivery orchestration does not hold, so the work
 * cannot happen in its context even in principle.
 */
export const NESTED_INVOCATION = 'nested-worker';

const POLICY_VALUES = new Set(['required', 'not-required', 'unobserved']);

/** Ownership fields without which nobody can tell what was handed to whom. */
const REQUIRED_TARGET_FIELDS = ['changeRequest', 'headBranch', 'headSha', 'baseBranch', 'baseSha'];

/** Receipt fields that make a disposition checkable against a later observation. */
const REQUIRED_RECEIPT_FIELDS = ['observedAt', 'baseSha', 'headSha'];

/**
 * Normalize the base branch's up-to-date requirement.
 *
 * An unrecognized or absent value becomes `unobserved` and never
 * `not-required`. They are different facts: one says the policy was read and
 * imposes nothing, the other says nobody looked. Collapsing them is how a
 * strict base branch gets handed over as though it were a relaxed one.
 *
 * @param {unknown} value
 * @returns {'required'|'not-required'|'unobserved'}
 */
export function normalizeUpToDatePolicy(value) {
  return POLICY_VALUES.has(value) ? value : 'unobserved';
}

/**
 * Build the handoff target: what is handed over, and against what observation.
 *
 * @param {object} [input]
 * @param {string} [input.changeRequest] Identifier the provider returned.
 * @param {string} [input.headBranch]
 * @param {string} [input.headSha] Head captured at publication.
 * @param {string} [input.baseBranch]
 * @param {string} [input.baseSha] Base captured at publication.
 * @param {unknown} [input.upToDatePolicy]
 * @param {{observedAt?: string, baseSha?: string, headSha?: string}} [input.receipt]
 * @returns {{target: object, missing: string[]}}
 */
export function buildHandoffTarget(input = {}) {
  const receipt = input.receipt ?? {};
  const target = {
    changeRequest: input.changeRequest ?? null,
    headBranch: input.headBranch ?? null,
    headSha: input.headSha ?? null,
    baseBranch: input.baseBranch ?? null,
    baseSha: input.baseSha ?? null,
    upToDatePolicy: normalizeUpToDatePolicy(input.upToDatePolicy),
    receipt: {
      observedAt: receipt.observedAt ?? null,
      baseSha: receipt.baseSha ?? input.baseSha ?? null,
      headSha: receipt.headSha ?? input.headSha ?? null,
    },
  };

  const missing = [
    ...REQUIRED_TARGET_FIELDS.filter((field) => !target[field]).map((field) => `target.${field}`),
    ...REQUIRED_RECEIPT_FIELDS.filter((field) => !target.receipt[field]).map((field) => `receipt.${field}`),
  ];

  return { target, missing };
}

/**
 * Compare a shepherd result against the base as it stands now.
 *
 * @param {{receipt?: object}} target
 * @param {{baseSha?: string}} [observedBase] The base observed after shepherd returned.
 * @returns {'fresh'|'stale'|'unobserved'}
 */
export function evaluateFreshness(target, observedBase) {
  const recordedBase = target?.receipt?.baseSha ?? null;
  const currentBase = observedBase?.baseSha ?? null;
  if (!recordedBase || !currentBase) {
    return 'unobserved';
  }
  return recordedBase === currentBase ? 'fresh' : 'stale';
}

/**
 * Decide what the handoff did, and whether the run may report completion.
 *
 * Every failure class returns `not-performed` with the target named and one
 * exact human action, because the failure being prevented is a report that
 * reads as though somebody has it.
 *
 * @param {object} [input]
 * @param {'yes'|'no'|unknown} [input.intent] The recorded shepherd intent.
 * @param {{outcome?: string, identifier?: string}} [input.publication]
 * @param {object} [input.target] Input for {@link buildHandoffTarget}.
 * @param {{mode?: string, status?: string, reason?: string}} [input.invocation]
 * @param {{disposition?: string, nextHumanAction?: string}} [input.result]
 * @param {{baseSha?: string}} [input.observedBase]
 * @returns {object}
 */
export function evaluateHandoff(input = {}) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('evaluateHandoff expects an object');
  }
  const { intent, publication, invocation, result, observedBase } = input;
  const built = buildHandoffTarget(input.target ?? {});
  const target = built.target;

  if (intent === 'no') {
    // The operator declined it. Conditional means conditional, and a decline
    // is a decision rather than an omission.
    return performed('not-required', 'declined-by-operator', { target: null });
  }

  if (intent !== 'yes') {
    return notPerformed('intent-unrecorded', {
      target,
      unmet: ['intent: no shepherd intent was recorded before the run started'],
      humanAction:
        'Ask whether this change request should be shepherded, record the answer, and re-run the handoff.',
    });
  }

  if (publication?.outcome !== 'published') {
    // There is nothing to hand over. Inventing a target here would turn one
    // visible failure into a second one somewhere harder to see.
    return notPerformed('no-published-target', {
      target: null,
      constrainsStatus: false,
      unmet: [`publication: outcome is ${describe(publication?.outcome)}`],
      humanAction: 'Report the publication outcome as given. No change request exists to shepherd.',
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

  if (!TERMINAL_SHEPHERD_DISPOSITIONS.has(result?.disposition)) {
    // A dispatch nobody waited on looks exactly like this. Reporting
    // completion here would be reporting somebody else's unfinished work.
    return notPerformed('no-terminal-disposition', {
      target,
      unmet: [`result: disposition is ${describe(result?.disposition)}`],
      humanAction: humanActionFor(target, 'shepherd returned no terminal disposition'),
    });
  }

  const freshness = evaluateFreshness(target, observedBase);
  if (freshness === 'stale') {
    return notPerformed('stale-disposition', {
      target,
      disposition: result.disposition,
      freshness,
      requiresReinvocation: true,
      unmet: [
        `receipt: base ${target.receipt.baseSha} was observed, and the base is now ${observedBase.baseSha}`,
      ],
      humanAction: humanActionFor(target, 'the base advanced after shepherd observed it'),
    });
  }

  return performed('completed', `shepherd-${result.disposition}`, {
    target,
    disposition: result.disposition,
    freshness,
    humanAction: result.disposition === 'mergeable-and-green' ? null : result.nextHumanAction ?? null,
  });
}

/**
 * True only when the handoff either happened or was never asked for.
 *
 * Callers ask this instead of comparing strings, because the one mistake worth
 * preventing is a run reporting itself shipped while its change request has no
 * owner.
 */
export function mayReportShipped(evaluation) {
  return evaluation?.handoff === 'completed' || evaluation?.handoff === 'not-required';
}

function performed(handoff, state, extra = {}) {
  return {
    handoff,
    state,
    shipStatus: null,
    disposition: null,
    freshness: 'unobserved',
    requiresReinvocation: false,
    unmet: [],
    humanAction: null,
    ...extra,
  };
}

function notPerformed(state, { constrainsStatus = true, ...extra } = {}) {
  return {
    handoff: 'not-performed',
    state,
    // `blocked` names this run, not the change request: the delivery is not
    // finished, because the step that finishes it did not happen.
    shipStatus: constrainsStatus ? 'blocked' : null,
    disposition: null,
    freshness: 'unobserved',
    requiresReinvocation: false,
    unmet: [],
    humanAction: null,
    ...extra,
  };
}

function humanActionFor(target, because) {
  return `${target.changeRequest} (branch ${target.headBranch}) has no owner: ${because}. Invoke shepherd on it, or take it over.`;
}

function describe(value) {
  return value === undefined || value === null ? 'absent' : String(value);
}
