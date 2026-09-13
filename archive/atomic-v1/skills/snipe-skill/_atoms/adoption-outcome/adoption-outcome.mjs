/**
 * How an adoption run ends, and what it is allowed to claim when it does.
 *
 * The temptation at the end of a long workflow is the success-shaped report. A
 * package exists, files were written, the run has been going for a while, so it
 * says `adopted` and stops.
 *
 * This module refuses that in the only way that survives a tired reviewer: the
 * evidence is a **precondition of the status**, not a section of the report.
 *
 * ## Shape, not truth
 *
 * Everything here is deterministic and offline, so it checks that the evidence
 * is *the right shape and internally consistent* — that validation names the
 * commands it ran, that the review names its disposition and the head it read,
 * that a change request exists, and that all three describe the **same final
 * head**. It cannot open a network connection to confirm a change request, or
 * re-run the destination's validation.
 *
 * An earlier version took `validation: true` and `review: 'clean'` — two labels
 * a caller could type. Labels cannot express the relationship that actually
 * matters, which is that the review read the head the change request contains.
 * A structured record can, and a stale review is precisely the defect that
 * otherwise slips through a run that "passed everything".
 *
 * Truthful evidence remains the caller's obligation. The change request is what
 * puts all of it in front of a person who can check.
 *
 * ## Every confirmed job is accounted for
 *
 * The other way a long run reports success is by quietly dropping something. A
 * synthesis carrying three jobs, one of which stopped for the operator, can be
 * reported as two adopted skills and a silence.
 *
 * So an outcome is resolved against the **decision ledger** the routing step
 * produced, not against whatever destinations happen to be in hand. Every
 * confirmed job appears exactly once; every `create` maps to exactly one created
 * destination; every `route-existing` maps to its named route; and a single
 * unresolved `stop` makes the run `awaiting-human` no matter how well the rest
 * of it went.
 */

export const RUN_STATUSES = ['adopted', 'routed-existing', 'awaiting-human', 'refused', 'blocked'];
export const REVIEW_DISPOSITIONS = ['clean', 'unresolved', 'awaiting-operator', 'halted', 'absent'];

export const OUTCOME_FAILURES = {
  usage: 'usage',
  authorityExceeded: 'authority_exceeded',
  noWayForward: 'no_way_forward',
};

export class OutcomeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OutcomeError';
    this.code = code;
  }
}

export const JOB_DECISIONS = ['create', 'route-existing', 'stop'];

const DESTINATION_FIELDS = [
  'skill',
  'job',
  'head',
  'validation',
  'review',
  'changeRequest',
  'merged',
  'approved',
];

function requireExactFields(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OutcomeError(OUTCOME_FAILURES.usage, `${label} must be an object`);
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...fields].sort())) {
    throw new OutcomeError(
      OUTCOME_FAILURES.usage,
      `${label} requires exactly ${fields.join(', ')}`,
    );
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OutcomeError(OUTCOME_FAILURES.usage, `${label} must be a non-empty string`);
  }
  return value.trim();
}

function validateDestination(destination, index) {
  const label = `destination ${index}`;
  requireExactFields(destination, DESTINATION_FIELDS, label);
  requireText(destination.skill, `${label} skill`);
  requireText(destination.job, `${label} job`);
  requireText(destination.head, `${label} head`);

  const validation = requireExactFields(
    destination.validation,
    ['passed', 'commands', 'summary', 'head'],
    `${label} validation`,
  );
  if (typeof validation.passed !== 'boolean') {
    throw new OutcomeError(OUTCOME_FAILURES.usage, `${label} validation.passed must be a boolean`);
  }
  if (!Array.isArray(validation.commands) || validation.commands.length === 0) {
    throw new OutcomeError(
      OUTCOME_FAILURES.usage,
      `${label} validation.commands must name at least one command that was run`,
    );
  }
  validation.commands.forEach((command, position) =>
    requireText(command, `${label} validation.commands[${position}]`),
  );
  requireText(validation.summary, `${label} validation.summary`);
  requireText(validation.head, `${label} validation.head`);

  const review = requireExactFields(
    destination.review,
    ['disposition', 'account', 'head'],
    `${label} review`,
  );
  if (!REVIEW_DISPOSITIONS.includes(review.disposition)) {
    throw new OutcomeError(
      OUTCOME_FAILURES.usage,
      `${label} review.disposition must be one of ${REVIEW_DISPOSITIONS.join(', ')}`,
    );
  }
  requireText(review.account, `${label} review.account`);
  requireText(review.head, `${label} review.head`);

  if (destination.changeRequest !== null) {
    const changeRequest = requireExactFields(
      destination.changeRequest,
      ['locator', 'head'],
      `${label} changeRequest`,
    );
    requireText(changeRequest.locator, `${label} changeRequest.locator`);
    requireText(changeRequest.head, `${label} changeRequest.head`);
  }

  // Merging and approving are refused wherever they are claimed, including on a
  // destination that is otherwise complete. This is the boundary that must not
  // erode as the rest of the workflow gets better at its job.
  if (destination.merged === true || destination.approved === true) {
    throw new OutcomeError(
      OUTCOME_FAILURES.authorityExceeded,
      `${destination.skill}: this run opens a change request and stops; it never merges or approves`,
    );
  }
  if (typeof destination.merged !== 'boolean' || typeof destination.approved !== 'boolean') {
    throw new OutcomeError(
      OUTCOME_FAILURES.usage,
      `${label} requires boolean merged and approved flags`,
    );
  }
  return destination;
}

function shortfallsFor(destination) {
  const shortfalls = [];
  const head = destination.head.trim();

  if (destination.validation.passed !== true) shortfalls.push('validation did not pass');
  if (destination.validation.head.trim() !== head) {
    shortfalls.push('validation describes a different head than the package');
  }

  if (destination.review.disposition !== 'clean') {
    shortfalls.push(
      destination.review.disposition === 'absent'
        ? 'no review ran on the final head'
        : `review is ${destination.review.disposition}`,
    );
  }
  if (destination.review.head.trim() !== head) {
    // The stale review. A run that corrects a package after review and reports
    // the earlier verdict is the exact failure this relationship exists to see.
    shortfalls.push('the review describes a different head than the package');
  }

  if (destination.changeRequest === null) {
    shortfalls.push('no change request was opened');
  } else if (destination.changeRequest.head.trim() !== head) {
    shortfalls.push('the change request describes a different head than the package');
  }

  return shortfalls;
}

/**
 * Validate the decision ledger the routing step produced.
 *
 * This is the list every other input is reconciled against, so it is checked
 * first and on its own terms: one entry per confirmed job, a decision from the
 * closed set, and no job named twice.
 */
function validateDecisions(decisions) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    throw new OutcomeError(
      OUTCOME_FAILURES.usage,
      'an outcome is resolved against the decision ledger for every confirmed job',
    );
  }
  const byJob = new Map();
  for (const [index, entry] of decisions.entries()) {
    const label = `decision ${index}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new OutcomeError(OUTCOME_FAILURES.usage, `${label} must be an object`);
    }
    const job = requireText(entry.job, `${label} job`);
    if (!JOB_DECISIONS.includes(entry.decision)) {
      throw new OutcomeError(
        OUTCOME_FAILURES.usage,
        `${label} decision must be one of ${JOB_DECISIONS.join(', ')}`,
      );
    }
    if (byJob.has(job)) {
      throw new OutcomeError(OUTCOME_FAILURES.usage, `duplicate job in the decision ledger: ${job}`);
    }
    // A routing decision named the skill it routed to. Carrying the decision
    // without the target would let the run report that a job is already done
    // somewhere the routing step never assessed.
    const existing =
      entry.decision === 'route-existing'
        ? requireText(entry.existing, `${label} existing`)
        : null;
    byJob.set(job, { decision: entry.decision, existing });
  }
  return byJob;
}

/**
 * Reconcile one class of result against the jobs the ledger says should have
 * produced it. Missing, extra, duplicated, and misattributed are all refusals:
 * every one of them is a way for a job to disappear from the report.
 */
function reconcile(entries, byJob, expected, label, identityOf, identities) {
  const claimed = new Set();
  for (const [index, entry] of entries.entries()) {
    const job = entry.job;
    if (!byJob.has(job)) {
      throw new OutcomeError(
        OUTCOME_FAILURES.usage,
        `${label} ${index} names job ${job}, which the decision ledger does not carry`,
      );
    }
    const decided = byJob.get(job);
    if (decided.decision !== expected) {
      throw new OutcomeError(
        OUTCOME_FAILURES.usage,
        `${label} ${index} claims job ${job}, which was decided ${decided.decision}`,
      );
    }
    if (claimed.has(job)) {
      throw new OutcomeError(OUTCOME_FAILURES.usage, `${label} claims job ${job} more than once`);
    }
    // One skill discharges one job, across both result collections. Keeping a
    // set per collection was not enough: the same skill could be reported as
    // newly created for one job and as an already-existing route for another,
    // which claims a package was simultaneously built and already there.
    const identity = identityOf(entry);
    if (identities.has(identity)) {
      throw new OutcomeError(
        OUTCOME_FAILURES.usage,
        `${identity} is claimed for more than one job; each job needs its own result`,
      );
    }
    if (decided.existing !== null && identity !== decided.existing) {
      throw new OutcomeError(
        OUTCOME_FAILURES.usage,
        `${label} ${index} routed job ${job} to ${identity}, but the routing decision named ${decided.existing}`,
      );
    }
    identities.add(identity);
    claimed.add(job);
  }
  const unaccounted = [...byJob.entries()]
    .filter(([job, decided]) => decided.decision === expected && !claimed.has(job))
    .map(([job]) => job);
  if (unaccounted.length) {
    throw new OutcomeError(
      OUTCOME_FAILURES.usage,
      `every ${expected} job needs its own result; unaccounted: ${unaccounted.join(', ')}`,
    );
  }
}

/**
 * Resolve the run's single status from the decision ledger and the evidence each
 * destination carries.
 */
export function resolveOutcome({ decisions, destinations, routed } = {}) {
  if (destinations !== undefined && !Array.isArray(destinations)) {
    throw new OutcomeError(OUTCOME_FAILURES.usage, 'destinations must be an array when supplied');
  }
  if (routed !== undefined && !Array.isArray(routed)) {
    throw new OutcomeError(OUTCOME_FAILURES.usage, 'routed must be an array when supplied');
  }
  const byJob = validateDecisions(decisions);
  const created = destinations ?? [];
  const routedExisting = routed ?? [];
  created.forEach(validateDestination);

  // A `routed-existing` result tells the operator his job is already done
  // somewhere. Naming nothing while claiming that is worse than an error.
  const seenRoutes = new Set();
  for (const [index, route] of routedExisting.entries()) {
    requireExactFields(route, ['job', 'skill'], `routed ${index}`);
    requireText(route.job, `routed ${index} job`);
    const skill = requireText(route.skill, `routed ${index} skill`);
    seenRoutes.add(skill);
  }

  // One shared set, so a skill cannot be created for one job and routed for
  // another in the same run.
  const identities = new Set();
  reconcile(created, byJob, 'create', 'destination', (entry) => entry.skill.trim(), identities);
  reconcile(
    routedExisting,
    byJob,
    'route-existing',
    'routed',
    (entry) => entry.skill.trim(),
    identities,
  );

  // A change request is evidence for one package. Two packages pointing at one
  // request is the same failure as two jobs sharing one package.
  const requests = new Set();
  for (const destination of created) {
    const locator = destination.changeRequest?.locator?.trim();
    if (!locator) continue;
    if (requests.has(locator)) {
      throw new OutcomeError(
        OUTCOME_FAILURES.usage,
        `change request ${locator} is claimed by more than one created skill`,
      );
    }
    requests.add(locator);
  }

  const stopped = [...byJob.entries()]
    .filter(([, decided]) => decided.decision === 'stop')
    .map(([job]) => job);

  const shortfalls = created
    .map((destination) => ({ skill: destination.skill, shortfalls: shortfallsFor(destination) }))
    .filter((entry) => entry.shortfalls.length > 0);

  const account = {
    created: created.map((destination) => destination.skill),
    routed: [...seenRoutes],
    unresolved: stopped,
    shortfalls,
    merged: false,
    approved: false,
  };

  // An unresolved job outranks everything that went well. A run that adopted two
  // skills and quietly dropped a third is the report this ordering prevents.
  if (stopped.length) {
    return { status: 'awaiting-human', reason: 'undecided-jobs', ...account };
  }
  if (shortfalls.length) {
    return { status: 'blocked', reason: 'incomplete-destination-evidence', ...account };
  }
  if (created.length === 0) {
    return { status: 'routed-existing', ...account };
  }
  return {
    status: 'adopted',
    ...account,
    changeRequests: created.map((destination) => destination.changeRequest.locator.trim()),
    validation: created.map((destination) => ({
      skill: destination.skill,
      commands: destination.validation.commands,
      summary: destination.validation.summary,
    })),
  };
}

/**
 * End a run on an unresolved decision, which is a real outcome and not a
 * failure to have one. It requires the decision in the operator's terms and at
 * least one bounded way forward.
 */
export function stopWith({ status, decision, waysForward, evidence } = {}) {
  if (!['awaiting-human', 'refused', 'blocked'].includes(status)) {
    throw new OutcomeError(OUTCOME_FAILURES.usage, 'a stop is awaiting-human, refused, or blocked');
  }
  if (typeof decision !== 'string' || decision.trim() === '') {
    throw new OutcomeError(OUTCOME_FAILURES.usage, 'a stop names the unresolved decision');
  }
  if (!Array.isArray(waysForward) || waysForward.length === 0) {
    throw new OutcomeError(
      OUTCOME_FAILURES.noWayForward,
      `${decision.trim()}: a stop carries at least one bounded way forward`,
    );
  }
  if (waysForward.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new OutcomeError(OUTCOME_FAILURES.noWayForward, 'every way forward is a non-empty string');
  }
  return {
    status,
    decision: decision.trim(),
    waysForward: waysForward.map((entry) => entry.trim()),
    evidence: Array.isArray(evidence) ? evidence : [],
    created: [],
    merged: false,
    approved: false,
  };
}

/**
 * A parent outside the destination's trust boundary gets the coarse truth: what
 * happened, how many destinations, and that nothing was merged or approved.
 *
 * It reduces a resolved outcome; it does not re-derive one. Handing it something
 * this atom did not produce yields a summary of that something, which is why the
 * caller resolves first and summarizes second.
 */
export function publicOutcome(outcome) {
  if (!outcome || !RUN_STATUSES.includes(outcome.status)) {
    throw new OutcomeError(OUTCOME_FAILURES.usage, 'outcome must come from this atom');
  }
  return {
    status: outcome.status,
    createdCount: Array.isArray(outcome.created) ? outcome.created.length : 0,
    routedCount: Array.isArray(outcome.routed) ? outcome.routed.length : 0,
    merged: false,
    approved: false,
  };
}
