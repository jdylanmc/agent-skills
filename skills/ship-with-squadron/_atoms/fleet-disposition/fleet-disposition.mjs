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
  if (issue.status === 'completed' && issue.terminalDisposition === 'already-complete') return true;
  if (issue.status !== 'completed' || issue.terminalDisposition !== 'ready-for-human-merge') return false;
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
  const checking = new Set(issues
    .filter((issue) => checkingIssue(issue))
    .map((issue) => issue.identity));
  const failed = new Set(issues
    .filter((issue) => issue.status === 'failed' && !checking.has(issue.identity))
    .map((issue) => issue.identity));
  const deferred = new Set(issues
    .filter((issue) => ['deferred', 'timed-out'].includes(issue.status)
      && !checking.has(issue.identity))
    .map((issue) => issue.identity));
  const awaitingHuman = new Set(issues
    .filter((issue) => issue.nextAction?.startsWith('await-')
      && !checking.has(issue.identity)
      && !failed.has(issue.identity)
      && !deferred.has(issue.identity))
    .map((issue) => issue.identity));
  const reviewReady = new Set(issues
    .filter((issue) => issue.changeRequest
      && effectiveIssueReadiness(issue, state, manifest)
      && !checking.has(issue.identity)
      && !failed.has(issue.identity)
      && !deferred.has(issue.identity)
      && !awaitingHuman.has(issue.identity))
    .map((issue) => issue.identity));
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
  const blocked = [...frontierBlocked, ...terminalBlocked]
    .filter((entry) => !checking.has(entry.issue)
      && !failed.has(entry.issue)
      && !deferred.has(entry.issue)
      && !awaitingHuman.has(entry.issue)
      && !reviewReady.has(entry.issue));
  const blockedIdentities = new Set(blocked.map((entry) => entry.issue));
  return {
    active: frontier.active
      .map((entry) => entry.issue)
      .filter((issue) => !checking.has(issue)
        && !failed.has(issue)
        && !deferred.has(issue)
        && !awaitingHuman.has(issue)
        && !reviewReady.has(issue)
        && !blockedIdentities.has(issue)),
    blocked,
    replacements: issues
      .filter((issue) => (issue.continuationChain?.length ?? 0) > 0 && issue.status === 'active')
      .map((issue) => issue.identity),
    checking: [...checking],
    failed: [...failed],
    deferred: [...deferred],
    awaitingHuman: [...awaitingHuman],
    reviewReady: [...reviewReady],
    expired: state.reShepherdQueue.map((entry) => entry.issue),
    nextCapacityReplenishment: frontier.capacity.nextReplenishment,
  };
}
