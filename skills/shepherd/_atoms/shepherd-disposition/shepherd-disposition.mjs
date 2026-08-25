const GREEN_LOCAL = new Set(['passed']);
const BLOCKED_LOCAL = new Set(['cancelled', 'environment-failed', 'unsupported-provider', 'incomplete']);
const COMPLETE_REMOTE = new Set(['passed', 'success']);
const PENDING_REMOTE = new Set(['pending', 'queued', 'in_progress', 'waiting', 'requested']);
const MERGEABLE_STATES = new Set(['mergeable', 'clean', 'has_hooks']);

function allRemoteChecksGreen(checks) {
  return Array.isArray(checks) && checks.length > 0 && checks.every((check) => COMPLETE_REMOTE.has(check.status));
}

export function classifyShepherdPlan(signals = {}) {
  const operatorAsked = signals.operatorRequest?.rebase === true;
  const requiredCheckExpired = signals.requiredChecks?.some((check) => check.expired === true) === true;
  const mergeability = signals.mergeability ?? {};
  const local = signals.localValidation ?? {};
  const remoteChecks = signals.remoteChecks?.checks ?? [];
  const conflicted = signals.conflicts?.some((conflict) => ['authored', 'ambiguous', 'conflicted'].includes(conflict.kind)) === true;
  const mergeable = MERGEABLE_STATES.has(mergeability.state) && mergeability.isDraft !== true;
  const green = local.status === 'passed' && local.evidenceComplete === true && allRemoteChecksGreen(remoteChecks);

  if (signals.base?.moved === true && mergeable && green && !operatorAsked && !requiredCheckExpired && !conflicted) {
    return {
      disposition: 'no-op-mergeable-and-green',
      action: 'no-op',
      shouldRebase: false,
      shouldForcePush: false,
      reason: 'base-moved-but-pr-remains-mergeable-and-green',
    };
  }

  if (operatorAsked || requiredCheckExpired || conflicted || !mergeable) {
    return {
      disposition: 'shepherd-required',
      action: 'rebase-or-revalidate',
      shouldRebase: operatorAsked || conflicted || !mergeable,
      shouldForcePush: false,
      reason: operatorAsked ? 'operator-requested' : requiredCheckExpired ? 'required-check-expired' : conflicted ? 'conflicted' : 'not-mergeable',
    };
  }

  return {
    disposition: 'watch-or-report',
    action: 'wait-for-checks-or-report-current-state',
    shouldRebase: false,
    shouldForcePush: false,
    reason: 'no-rebase-trigger',
  };
}

function providerObservationUnavailable(signals) {
  return [
    'provider-unsupported',
    'provider-tool-unsupported',
    'provider-tool-missing',
    'provider-tool-unauthenticated',
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

export function classifyTerminalDisposition(signals = {}) {
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
  if (BLOCKED_LOCAL.has(localStatus) || signals.localValidation?.evidenceComplete === false) {
    return { disposition: 'blocked', reason: `local-validation-${localStatus}`, defects };
  }
  if (!GREEN_LOCAL.has(localStatus)) {
    return { disposition: 'failing', reason: `local-validation-${localStatus}`, defects };
  }

  if (signals.push?.status !== 'pushed-with-lease') {
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
  if (mergeability.baseSha !== signals.rebase.baseSha || mergeability.headSha !== signals.push.headSha) {
    return { disposition: 'blocked', reason: 'stale-mergeability-evidence', defects };
  }
  if (mergeability.isDraft === true || !['mergeable', 'clean', 'has_hooks'].includes(mergeability.state)) {
    return { disposition: 'needs-human', reason: `pull-request-${mergeability.state ?? 'not-mergeable'}`, defects };
  }

  const checks = signals.remoteChecks?.checks;
  if (!Array.isArray(checks) || checks.length === 0) {
    return { disposition: 'blocked', reason: 'missing-remote-checks', defects };
  }
  const pending = checks.filter((check) => PENDING_REMOTE.has(check.status));
  if (pending.length > 0) {
    return { disposition: 'blocked', reason: 'remote-checks-incomplete', defects: pending.map((check) => check.name) };
  }
  const red = checks.filter((check) => !COMPLETE_REMOTE.has(check.status));
  if (red.length > 0) {
    return { disposition: 'failing', reason: 'remote-checks-failing', defects: red.map((check) => check.name) };
  }

  return { disposition: 'mergeable-and-green', reason: 'complete-green-evidence', defects: [] };
}
