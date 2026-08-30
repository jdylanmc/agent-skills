export const ISSUE_DISPOSITIONS = Object.freeze([
  'ready-for-human-merge',
  'blocked',
  'failed',
  'timed-out-with-handoff',
  'deferred',
  'not-reached',
  'already-complete',
]);

export const FLEET_DISPOSITIONS = Object.freeze([
  'review-ready',
  'partially-review-ready',
  'blocked',
  'budget-exhausted',
  'cancelled',
]);

export function deriveFleetDisposition(state, control = {}) {
  if (control.cancelled === true) return 'cancelled';
  if (control.budgetExhausted === true) return 'budget-exhausted';
  const dispositions = Object.values(state.issues).map((issue) => issue.terminalDisposition);
  if (dispositions.every((value) => ['ready-for-human-merge', 'already-complete'].includes(value))) {
    return 'review-ready';
  }
  if (dispositions.some((value) => value === 'ready-for-human-merge')) return 'partially-review-ready';
  return 'blocked';
}

export function conciseFleetStatus(state, frontier) {
  const checking = Object.values(state.issues)
    .filter((issue) => ['run-ci', 'roast', 'blast-radius-proof'].includes(issue.pipeline?.at(-1)?.stage))
    .map((issue) => issue.identity);
  const ready = Object.values(state.issues)
    .filter((issue) => issue.terminalDisposition === 'ready-for-human-merge' && issue.shepherd?.ready)
    .map((issue) => issue.identity);
  return {
    active: frontier.active.map((entry) => entry.issue),
    blocked: frontier.blocked.map((entry) => ({ issue: entry.issue, reason: entry.reason })),
    replacements: Object.values(state.issues)
      .filter((issue) => (issue.continuationChain?.length ?? 0) > 0 && issue.status === 'active')
      .map((issue) => issue.identity),
    checking,
    reviewReady: ready,
    expired: state.expiredReadinessClaims.map((entry) => entry.issue),
    nextCapacityReplenishment: frontier.capacity.nextReplenishment,
  };
}
