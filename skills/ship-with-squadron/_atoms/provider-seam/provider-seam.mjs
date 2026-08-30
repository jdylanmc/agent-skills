export const PROVIDER_OPERATIONS = Object.freeze([
  'read-issue',
  'publish-change-request',
  'observe-merge',
]);
export const FORBIDDEN_PROVIDER_OPERATIONS = Object.freeze([
  'merge',
  'approve',
  'enable-auto-merge',
  'accept-risk',
  'close-issue',
  'close-change-request',
  'force-push',
]);

export function authorizeProviderOperation(configuration, operation) {
  if (FORBIDDEN_PROVIDER_OPERATIONS.includes(operation)) {
    return { authorized: false, reason: `forbidden-operation:${operation}` };
  }
  if (!PROVIDER_OPERATIONS.includes(operation)) {
    return { authorized: false, reason: `unknown-operation:${operation}` };
  }
  const allowed = new Set(configuration?.allowedOperations ?? []);
  return allowed.has(operation)
    ? { authorized: true, reason: 'allow-listed-operation' }
    : { authorized: false, reason: `operation-not-allow-listed:${operation}` };
}

export function publicationKey({ provider, repository, issue, headBranch, baseBranch }) {
  return [provider, repository, issue, headBranch, baseBranch].join('\0');
}

export function recordPublication(state, request, result) {
  const authorization = authorizeProviderOperation(request.configuration, 'publish-change-request');
  if (!authorization.authorized) throw new Error(authorization.reason);
  const key = publicationKey(request);
  if (state.publications.some((entry) => entry.key === key || (
    entry.issue === request.issue && entry.outcome === 'published'
  ))) {
    throw new Error(`duplicate publication refused: ${request.issue}`);
  }
  const outcome = result?.status === 'published' && typeof result.identifier === 'string' && result.identifier !== ''
    ? 'published'
    : result?.status ?? 'publication-failed';
  const next = structuredClone(state);
  next.publications.push({
    key,
    issue: request.issue,
    provider: request.provider,
    repository: request.repository,
    headBranch: request.headBranch,
    baseBranch: request.baseBranch,
    outcome,
    identifier: outcome === 'published' ? result.identifier : null,
  });
  return next;
}

export function observeHumanMerge(observation) {
  const authorization = authorizeProviderOperation(observation.configuration, 'observe-merge');
  if (!authorization.authorized) return { observed: false, reason: authorization.reason };
  if (observation.providerStatus !== 'observed') {
    return { observed: false, reason: observation.providerStatus ?? 'provider-state-unobserved' };
  }
  if (observation.merged !== true || !observation.mergeCommit || !observation.observedAt) {
    return { observed: false, reason: 'human-merge-not-proven' };
  }
  return {
    observed: true,
    issue: observation.issue,
    changeRequest: observation.changeRequest,
    baseBranch: observation.baseBranch,
    mergeCommit: observation.mergeCommit,
    observedAt: observation.observedAt,
  };
}
