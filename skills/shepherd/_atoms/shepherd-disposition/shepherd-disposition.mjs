import {
  buildFreshnessReceipt,
  isTerminalDisposition,
  normalizeUpToDatePolicy,
  requiresUpToDateBranch,
} from '../../../_base/_atoms/landability/landability.mjs';
import { ProviderCommandError, currentRequiredChecksStatus, liveBaseIsCurrent, validatedBranchRef } from '../provider-state/provider-state.mjs';

export { isTerminalDisposition };

const GREEN_LOCAL = new Set(['passed']);
const BLOCKED_LOCAL = new Set(['cancelled', 'environment-failed', 'unsupported-provider', 'incomplete']);
const MERGEABLE_STATES = new Set(['mergeable', 'clean', 'has_hooks']);

export function pushReceiptIsValid(receipt, { headTarget, previousHead, resultingHead, strategy } = {}) {
  if (!headTarget?.repository || typeof headTarget.ref !== 'string'
    || !headTarget.ref.startsWith('refs/heads/')) return false;
  try {
    validatedBranchRef(headTarget.ref.slice('refs/heads/'.length));
  } catch (error) {
    if (error instanceof ProviderCommandError) return false;
    throw error;
  }
  const objectId = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
  if (!objectId.test(previousHead ?? '') || !objectId.test(resultingHead ?? '')
    || receipt?.repository !== headTarget.repository || receipt.ref !== headTarget.ref
    || receipt.previousHead !== previousHead || receipt.headSha !== resultingHead
    || receipt.capturedHeadVerified !== true || receipt.strategy !== strategy) return false;
  if (strategy === 'merge-base-into-head') return receipt.status === 'pushed';
  return strategy === 'rebase' && receipt.status === 'pushed-with-lease'
    && receipt.leaseVerified === true
    && receipt.lease?.ref === headTarget.ref && receipt.lease.expectedHead === previousHead;
}

function currentBase(signals) {
  return liveBaseIsCurrent(signals.liveBase, signals.target)
    && signals.mergeability?.baseSha === signals.liveBase.sha;
}

export function branchUpdateStrategy(signals = {}) {
  const policy = signals.branchPolicy;
  const basePolicy = signals.baseBranchPolicy;
  const boundPolicy = (value, repository, ref) => value?.observed === true
    && value.trusted === true && Number.isFinite(Date.parse(value.observedAt))
    && repository && ref && value.repository === repository && value.ref === ref
    && typeof value.allowForcePushes === 'boolean'
    && typeof value.requireLinearHistory === 'boolean';
  if (!boundPolicy(policy, signals.headTarget?.repository, signals.headTarget?.ref)
    || !boundPolicy(basePolicy, signals.target?.repository, `refs/heads/${signals.target?.baseBranch}`)
    || basePolicy.sha !== signals.liveBase?.sha
    || typeof basePolicy.squashMergeAllowed !== 'boolean'
    || typeof policy.directUpdatesAllowed !== 'boolean') {
    return { strategy: 'blocked', reason: 'branch-update-policy-unobserved' };
  }
  if (!policy.directUpdatesAllowed) {
    return { strategy: 'blocked', reason: 'head-policy-forbids-direct-update' };
  }
  const linear = policy.requireLinearHistory
    || (basePolicy.requireLinearHistory && !basePolicy.squashMergeAllowed);
  if (!linear) return { strategy: 'merge-base-into-head', reason: 'merge-commits-permitted' };
  if (policy.allowForcePushes) return { strategy: 'rebase', reason: 'linear-history-with-leased-rewrite' };
  return { strategy: 'blocked', reason: 'linear-history-forbids-merge-and-force-push' };
}

/**
 * Whether the base's own policy makes a behind branch unlandable.
 *
 * Base drift alone is not a trigger, because a branch rebased on every base
 * movement never lands. That reasoning holds only while the base will still
 * accept a behind branch. When the provider states that a change request must
 * contain the current base before it may merge, a base that advanced has
 * already made the branch unmergeable — mergeable content and green checks and
 * all — and waiting changes nothing.
 *
 * `behind: false` is authoritative and settles it: a branch that already
 * contains the base satisfies the policy however much the base moved.
 * An unobserved policy is not a requirement, so a repository without one is
 * unaffected.
 */
function behindUnderRequiredPolicy(signals) {
  if (!requiresUpToDateBranch(signals.basePolicy?.upToDate)) {
    return false;
  }
  const behind = branchBehindBase(signals);
  if (behind === false) {
    return false;
  }
  return signals.base?.moved === true || behind === true;
}

function branchBehindBase(signals) {
  const providerBehind = signals.mergeability?.behind;
  const gitBehind = signals.base?.behind;
  if (providerBehind === true || gitBehind === true) return true;
  if (typeof providerBehind === 'boolean') {
    return providerBehind;
  }
  return typeof gitBehind === 'boolean' ? gitBehind : null;
}

export function classifyShepherdPlan(signals = {}) {
  const operatorAsked = signals.operatorRequest?.rebase === true;
  const requiredCheckExpired = signals.requiredChecks?.some((check) => check.expired === true) === true;
  const mergeability = signals.mergeability ?? {};
  const local = signals.localValidation ?? {};
  const conflicted = signals.conflicts?.some((conflict) => ['authored', 'ambiguous', 'conflicted'].includes(conflict.kind)) === true;
  const mergeable = MERGEABLE_STATES.has(mergeability.state) && mergeability.isDraft === false;
  const unmergeable = ['conflicted', 'dirty', 'unmergeable'].includes(mergeability.state);
  const green = local.status === 'passed' && local.evidenceComplete === true
    && currentRequiredChecksStatus(signals.remoteChecks, mergeability.headSha).status === 'success'
    && signals.provider?.status === 'supported-provider';
  const upToDatePolicy = normalizeUpToDatePolicy(signals.basePolicy?.upToDate);
  const behindStrictBase = behindUnderRequiredPolicy(signals);
  const receipt = freshnessReceipt(signals);

  const blockedOrReviewGated = mergeability.blocked !== false
    || mergeability.reviewDecision === 'review-required'
    || mergeability.reviewDecision === 'changes-requested';

  if (signals.authority?.mode !== 'ship-continuation') {
    return { disposition: 'blocked', action: 'observe-state', shouldRebase: false, shouldForcePush: false,
      reason: signals.authority?.mode === 'observation-only' ? 'observation-only-authority' : 'authority-unobserved', receipt };
  }
  if (!currentBase(signals)) {
    return { disposition: 'blocked', action: 'observe-state', shouldRebase: false, shouldForcePush: false, reason: 'live-base-unobserved-or-mismatched', receipt };
  }

  if (
    signals.base?.moved === true
    && mergeable
    && green
    && !operatorAsked
    && !requiredCheckExpired
    && !conflicted
    && !behindStrictBase
    && !blockedOrReviewGated
  ) {
    if (!receipt.complete) {
      return {
        disposition: 'blocked',
        action: 'observe-state',
        shouldRebase: false,
        shouldForcePush: false,
        reason: 'incomplete-freshness-receipt',
        upToDatePolicy,
        receipt,
      };
    }
    return {
      disposition: 'no-op-mergeable-and-green',
      action: 'no-op',
      shouldRebase: false,
      shouldForcePush: false,
      reason: 'base-moved-but-pr-remains-mergeable-and-green',
      upToDatePolicy,
      receipt,
    };
  }

  if (operatorAsked || requiredCheckExpired || conflicted || unmergeable || behindStrictBase) {
    const update = operatorAsked || conflicted || unmergeable || behindStrictBase;
    const selected = update ? branchUpdateStrategy(signals) : { strategy: 'revalidate' };
    if (selected.strategy === 'blocked') {
      return { disposition: 'blocked', action: 'observe-policy', shouldRebase: false, shouldForcePush: false, reason: selected.reason, upToDatePolicy };
    }
    return {
      disposition: 'shepherd-required',
      action: selected.strategy,
      shouldRebase: selected.strategy === 'rebase',
      shouldForcePush: false,
      reason: operatorAsked
        ? 'operator-requested'
        : requiredCheckExpired
          ? 'required-check-expired'
          : conflicted
            ? 'conflicted'
            : unmergeable
              ? 'not-mergeable'
              : 'base-advanced-under-required-up-to-date-policy',
      upToDatePolicy,
    };
  }

  return {
    disposition: 'watch-or-report',
    action: 'wait-for-checks-or-report-current-state',
    shouldRebase: false,
    shouldForcePush: false,
    reason: 'no-rebase-trigger',
    upToDatePolicy,
  };
}

function providerObservationUnavailable(signals) {
  return [
    'provider-unsupported',
    'provider-tool-unsupported',
    'provider-tool-missing',
    'provider-tool-unauthenticated',
    'provider-tool-unobserved',
  ].includes(signals.provider?.status);
}

function missingRequired(signals) {
  const missing = [];
  const required = ['preflight', 'rebase', 'regeneration', 'localValidation', 'push'];
  if (!providerObservationUnavailable(signals)) {
    required.push('remoteChecks', 'mergeability');
  }
  for (const field of required) {
    if (!signals[field]) {
      missing.push(field);
    }
  }
  return missing;
}

/**
 * The snapshot a terminal disposition is bound to.
 *
 * A disposition says the change request was landable against one base commit
 * at one moment. Without the moment and the commits, a caller holding the
 * disposition later cannot tell whether it still describes anything, so every
 * result carries them and says whether they are complete. The shape is the
 * shared one, because the caller consuming it is a different skill.
 */
export function freshnessReceipt(signals = {}) {
  return buildFreshnessReceipt({
    observedAt: signals.observedAt,
    baseSha: currentBase(signals) ? signals.liveBase.sha : null,
    headSha: signals.mergeability?.headSha,
    upToDatePolicy: signals.basePolicy?.upToDate,
    provider: signals.provider?.status,
  });
}

export function classifyTerminalDisposition(signals = {}) {
  const receipt = freshnessReceipt(signals);
  const outcome = classifyOutcome(signals, receipt);
  return {
    ...outcome,
    receipt,
    ...(['mergeable-and-green', 'no-op-mergeable-and-green'].includes(outcome.disposition)
      ? {}
      : { nextHumanAction: nextHumanActionFor(outcome) }),
  };
}

function nextHumanActionFor(outcome) {
  const detail = outcome.defects?.length > 0 ? ` (${outcome.defects.join(', ')})` : '';
  switch (outcome.disposition) {
    case 'provider-unsupported':
      return 'Use a supported provider adapter or inspect the hosted change request manually.';
    case 'provider-tool-unsupported':
      return 'Add an official-tool adapter for this provider or inspect the hosted change request manually.';
    case 'provider-tool-missing':
      return `Install the provider's official CLI, then invoke shepherd again${detail}.`;
    case 'provider-tool-unauthenticated':
      return `Authenticate the provider's official CLI, then invoke shepherd again${detail}.`;
    case 'provider-tool-unobserved':
      return `Probe the provider's official CLI readiness, then invoke shepherd again${detail}.`;
    case 'needs-human':
      return `Resolve ${outcome.reason}, then invoke shepherd again${detail}.`;
    case 'failing':
      return `Fix ${outcome.reason}, rerun validation, then invoke shepherd again${detail}.`;
    default:
      return `Clear ${outcome.reason}, gather complete evidence, then invoke shepherd again${detail}.`;
  }
}

function classifyOutcome(signals, receipt) {
  if (signals.authority?.mode !== 'ship-continuation') {
    return { disposition: 'blocked',
      reason: signals.authority?.mode === 'observation-only' ? 'observation-only-authority' : 'authority-unobserved', defects: [] };
  }
  const defects = missingRequired(signals);
  if (defects.length > 0) {
    return { disposition: 'blocked', reason: 'missing-required-evidence', defects };
  }

  if (signals.preflight.status !== 'ok') {
    defects.push(`preflight:${signals.preflight.status}`);
  }
  if (signals.conflicts?.some((conflict) => ['authored', 'ambiguous'].includes(conflict.kind))) {
    return { disposition: 'needs-human', reason: 'semantic-or-ambiguous-conflict', defects };
  }
  if (signals.policy?.status === 'needs-human') {
    return { disposition: 'needs-human', reason: 'policy-requires-human', defects };
  }
  if (defects.length > 0) {
    return { disposition: 'needs-human', reason: 'unsafe-preflight', defects };
  }

  if (signals.rebase.status !== 'completed' || !signals.rebase.baseSha) {
    return { disposition: 'blocked', reason: `rebase-${signals.rebase.status ?? 'missing-base'}`, defects };
  }

  if (!['completed', 'not-applicable'].includes(signals.regeneration.status)) {
    return { disposition: 'blocked', reason: `regeneration-${signals.regeneration.status}`, defects };
  }

  const localStatus = signals.localValidation.status;
  if (BLOCKED_LOCAL.has(localStatus) || signals.localValidation?.evidenceComplete !== true) {
    return { disposition: 'blocked', reason: `local-validation-${localStatus}`, defects };
  }
  if (!GREEN_LOCAL.has(localStatus)) {
    return { disposition: 'failing', reason: `local-validation-${localStatus}`, defects };
  }

  const strategy = branchUpdateStrategy(signals).strategy;
  if (signals.rebase.strategy !== strategy || !pushReceiptIsValid(signals.push, {
    headTarget: signals.headTarget,
    previousHead: signals.preflight.capturedRemoteHead,
    resultingHead: signals.mergeability?.headSha ?? signals.push?.headSha,
    strategy,
  })) {
    return { disposition: 'blocked', reason: 'push-not-confirmed-with-lease', defects };
  }

  if (providerObservationUnavailable(signals)) {
    return {
      disposition: signals.provider.status,
      reason: 'git-core-complete-host-state-unobserved',
      defects: signals.provider.tool ? [signals.provider.tool] : [],
    };
  }

  const mergeability = signals.mergeability;
  if (signals.provider?.status !== 'supported-provider') {
    return { disposition: 'blocked', reason: 'provider-state-unobserved', defects };
  }
  if (!currentBase(signals)) {
    return { disposition: 'blocked', reason: 'live-base-unobserved-or-mismatched', defects };
  }
  if (mergeability.baseSha !== signals.rebase.baseSha || mergeability.headSha !== signals.push.headSha) {
    return { disposition: 'blocked', reason: 'stale-mergeability-evidence', defects };
  }
  if (mergeability.isDraft !== false || !['mergeable', 'clean', 'has_hooks'].includes(mergeability.state)) {
    return { disposition: 'needs-human', reason: `pull-request-${mergeability.state ?? 'not-mergeable'}`, defects };
  }

  if (mergeability.blocked === true) {
    return { disposition: 'needs-human', reason: 'pull-request-blocked', defects };
  }
  if (mergeability.reviewDecision === 'review-required' || mergeability.reviewDecision === 'changes-requested') {
    return { disposition: 'needs-human', reason: `review-${mergeability.reviewDecision}`, defects };
  }

  if (mergeability.blocked !== false) {
    return { disposition: 'blocked', reason: 'merge-block-state-unobserved', defects };
  }

  // Mergeable content and green checks are not landability when the base
  // refuses a behind branch. Under that policy the question has to be settled
  // rather than assumed: `behind === false` is the only answer that clears it,
  // and an unread one is its own outcome rather than the reassuring one.
  const behind = branchBehindBase(signals);
  if (requiresUpToDateBranch(signals.basePolicy?.upToDate) && behind !== false) {
    return {
      disposition: 'blocked',
      reason: behind === true
        ? 'base-advanced-under-required-up-to-date-policy'
        : 'up-to-date-state-unobserved-under-required-policy',
      defects,
    };
  }

  const checks = currentRequiredChecksStatus(signals.remoteChecks, mergeability.headSha);
  if (checks.status !== 'success') {
    return { disposition: checks.status === 'failure' ? 'failing' : 'blocked', reason: checks.reason, defects };
  }

  // A green result nobody can date or place is a claim rather than evidence:
  // the caller holding it later cannot tell whether it still describes the
  // change request it names.
  if (receipt.complete !== true) {
    return { disposition: 'blocked', reason: 'incomplete-freshness-receipt', defects };
  }

  return { disposition: 'mergeable-and-green', reason: 'complete-green-evidence', defects: [] };
}
