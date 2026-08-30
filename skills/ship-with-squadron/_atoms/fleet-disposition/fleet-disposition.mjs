import {
  persistedPipelinePasses,
} from '../quality-evidence/quality-evidence.mjs';

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

function publicationIsCurrent(issue, state) {
  if (!issue.changeRequest) return false;
  return state.publications.some((entry) =>
    entry.key === issue.changeRequest.publicationKey
    && entry.identifier === issue.changeRequest.identifier
    && entry.issue === issue.identity
    && entry.observations?.some((observation) =>
      observation.state === 'confirmed'
      && observation.baseSha === issue.baseSha
      && observation.headSha === issue.headSha));
}

function obligationIsCurrent(obligation, issue, reinvocation, baseSha = issue.baseSha) {
  return obligation?.owner === issue.identity
    && obligation?.changeRequest === issue.changeRequest?.identifier
    && obligation?.baseSha === baseSha
    && obligation?.headSha === issue.headSha
    && obligation?.expiresWhen === 'sibling-merge-into-base'
    && obligation?.reinvocation === reinvocation;
}

export function effectiveIssueReadiness(issue, state, manifest) {
  if (issue.terminalDisposition === 'already-complete') return true;
  if (state.reShepherdQueue.some((entry) => entry.issue === issue.identity)) return false;
  if (!persistedPipelinePasses(issue, state, manifest).passed
      || !publicationIsCurrent(issue, state)) return false;
  if (manifest.shepherdIntent === 'no') {
    return issue.shepherd === null
      && issue.shepherdDecision?.state === 'not-required'
      && issue.shepherdDecision?.manifestDigest === manifest.digest
      && obligationIsCurrent(
        issue.setObligation,
        issue,
        'rerun-quality-and-provider-observation',
      );
  }
  return issue.shepherd?.accepted === true
    && issue.shepherd?.ready === true
    && issue.shepherd?.freshness === 'fresh'
    && issue.shepherd?.receipt?.headSha === issue.headSha
    && issue.shepherd?.receipt?.baseSha === issue.shepherd?.setObligation?.baseSha
    && issue.shepherd?.receipt?.changeRequest === issue.changeRequest.identifier
    && issue.shepherd?.receipt?.provider === manifest.provider.name
    && obligationIsCurrent(
      issue.shepherd.setObligation,
      issue,
      'invoke-fresh-shepherd',
      issue.shepherd.receipt.baseSha,
    );
}

export function deriveFleetDisposition(state, manifest) {
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('fleet disposition state is not bound to the confirmed manifest');
  }
  if (state.control?.cancelled === true) return 'cancelled';
  if (state.control?.budgetExhausted === true) return 'budget-exhausted';
  const issues = Object.values(state.issues);
  const ready = issues.filter((issue) => effectiveIssueReadiness(issue, state, manifest)).length;
  if (ready === issues.length) return 'review-ready';
  if (ready > 0) return 'partially-review-ready';
  return 'blocked';
}

function checkingIssue(issue) {
  return issue.checkActivity?.state === 'active';
}

export function conciseFleetStatus(state, frontier, manifest) {
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('fleet status state is not bound to the confirmed manifest');
  }
  const issues = Object.values(state.issues);
  const frontierBlocked = frontier.blocked.map((entry) => ({
    issue: entry.issue,
    reason: entry.reason,
  }));
  const terminalBlocked = issues
    .filter((issue) => issue.terminalDisposition === 'blocked'
      && !frontierBlocked.some((entry) => entry.issue === issue.identity))
    .map((issue) => ({
      issue: issue.identity,
      reason: issue.statusReason ?? issue.nextAction ?? 'blocked',
    }));
  return {
    active: frontier.active.map((entry) => entry.issue),
    blocked: [...frontierBlocked, ...terminalBlocked],
    replacements: issues
      .filter((issue) => (issue.continuationChain?.length ?? 0) > 0 && issue.status === 'active')
      .map((issue) => issue.identity),
    checking: issues.filter((issue) => checkingIssue(issue)).map((issue) => issue.identity),
    failed: issues.filter((issue) => issue.status === 'failed').map((issue) => issue.identity),
    deferred: issues.filter((issue) => issue.status === 'deferred').map((issue) => issue.identity),
    awaitingHuman: issues
      .filter((issue) => issue.nextAction?.startsWith('await-'))
      .map((issue) => issue.identity),
    reviewReady: issues
      .filter((issue) => issue.changeRequest && effectiveIssueReadiness(issue, state, manifest))
      .map((issue) => issue.identity),
    expired: state.reShepherdQueue.map((entry) => entry.issue),
    nextCapacityReplenishment: frontier.capacity.nextReplenishment,
  };
}
