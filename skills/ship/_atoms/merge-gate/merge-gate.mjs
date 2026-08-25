/**
 * Deterministic merge gate for the ship delivery cycle.
 *
 * Issue #26 states the requirement as "whether it may merge at all is a
 * deliberate grant, not a default". That is a property about what happens when
 * nobody says anything, and prose cannot hold it: a run reporting green
 * validation, cleared review, and satisfied criteria produces a lot of good
 * news at once, and good news is read as permission.
 *
 * So the disposition starts at `withheld` and only two things move it: every
 * mechanical precondition being met, and a person supplying an explicit grant
 * token. They are conjunctive. A grant does not override an unmet
 * precondition, because overriding one is accepting a risk, and accepting risk
 * is a person's decision taken with the criterion table in front of them.
 *
 * Nothing here merges and nothing here approves. The grant records that
 * somebody authorized the merge; performing it stays with them.
 */

/** The only value that grants. Deliberately not `true`. */
export const MERGE_GRANT_TOKEN = 'operator-granted';

const COMPLETE_CRITERION_VERDICTS = new Set(['satisfied', 'descoped']);
const CONTINUABLE_RECONCILIATION = new Set(['reconciled', 'unfulfilled-entry']);

/**
 * Evaluate the merge disposition for a finished delivery run.
 *
 * Every input is optional at the type level and unmet by default, so a caller
 * that omits evidence gets `withheld` rather than silence read as consent.
 *
 * @param {object} [input]
 * @param {Array<{id: string, verdict: string}>} [input.criteria]
 * @param {{verdict: string}} [input.reconciliation]
 * @param {{status: string}} [input.validation] A `run-ci` evidence envelope.
 * @param {{blockers?: Array<object>}} [input.review] `roast` findings.
 * @param {{state: string, consent?: boolean}} [input.isolation]
 * @param {unknown} [input.grant] Must equal MERGE_GRANT_TOKEN to grant.
 * @returns {{disposition: string, unmet: string[], granted: boolean}}
 */
export function evaluateMergeGate(input = {}) {
  if (input === null || typeof input !== 'object') {
    throw new TypeError('evaluateMergeGate expects an object');
  }

  const { criteria, reconciliation, validation, review, isolation, grant } = input;
  const unmet = [];

  if (!Array.isArray(criteria) || criteria.length === 0) {
    // Vacuous truth is the friendliest way to pass a gate without meeting it.
    unmet.push('criteria: no numbered acceptance criteria were reported');
  } else {
    const outstanding = criteria
      .filter((criterion) => !COMPLETE_CRITERION_VERDICTS.has(criterion?.verdict))
      .map((criterion) => `${criterion?.id ?? '(unidentified)'}=${criterion?.verdict ?? '(none)'}`);
    if (outstanding.length > 0) {
      unmet.push(`criteria: not satisfied or descoped: ${outstanding.join(', ')}`);
    }
  }

  if (!CONTINUABLE_RECONCILIATION.has(reconciliation?.verdict)) {
    unmet.push(`reconciliation: verdict is ${describe(reconciliation?.verdict)}`);
  }

  // `intermittent` is a failure with a second data point, not a pass.
  if (validation?.status !== 'passed') {
    unmet.push(`validation: run-ci status is ${describe(validation?.status)}`);
  }

  const blockers = review?.blockers;
  if (!Array.isArray(blockers)) {
    unmet.push('review: no adversarial review findings were reported');
  } else if (blockers.length > 0) {
    unmet.push(`review: ${blockers.length} unresolved blocker(s)`);
  }

  if (isolation?.state === 'worktree') {
    // Met.
  } else if (isolation?.state === 'none' && isolation?.consent === true) {
    // Met, and the consent is the reason it is met.
  } else {
    unmet.push(`isolation: state is ${describe(isolation?.state)} without recorded consent`);
  }

  // Strict equality, never truthiness. A boolean default, a config flag, or an
  // optimistic caller supplies a truthy value by accident; none supplies this.
  const granted = grant === MERGE_GRANT_TOKEN;

  let disposition = 'withheld';
  if (unmet.length === 0) {
    disposition = granted ? 'granted' : 'eligible';
  }

  return { disposition, unmet, granted };
}

function describe(value) {
  return value === undefined || value === null ? 'absent' : String(value);
}

/**
 * True only for `granted`. `eligible` is the state most likely to be mistaken
 * for permission, so it is named here and refused rather than left to a caller
 * comparing strings.
 */
export function mayMerge(result) {
  return result?.disposition === 'granted';
}
