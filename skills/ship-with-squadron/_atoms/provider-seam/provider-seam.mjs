import crypto from 'node:crypto';

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

const DEGRADED_PUBLICATION_STATUSES = new Set([
  'provider-tool-unobserved',
  'provider-tool-missing',
  'provider-tool-unauthenticated',
  'provider-tool-unsupported',
  'provider-unsupported',
  'transient-failure',
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validTimestamp(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function authorizeProviderOperation(state, manifest, operation) {
  if (FORBIDDEN_PROVIDER_OPERATIONS.includes(operation)) {
    return { authorized: false, reason: `forbidden-operation:${operation}` };
  }
  if (!PROVIDER_OPERATIONS.includes(operation)) {
    return { authorized: false, reason: `unknown-operation:${operation}` };
  }
  if (!state || !manifest
      || state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    return { authorized: false, reason: 'persisted-manifest-authority-mismatch' };
  }
  const allowed = new Set(manifest.provider?.allowedOperations ?? []);
  return allowed.has(operation)
    ? { authorized: true, reason: 'persisted-manifest-allow-list' }
    : { authorized: false, reason: `operation-not-allow-listed:${operation}` };
}

export function publicationKey({
  manifestDigest,
  providerConfigurationDigest,
  provider,
  repository,
  issue,
  sourceRevision,
  headBranch,
  baseBranch,
}) {
  return digest({
    manifestDigest,
    providerConfigurationDigest,
    provider,
    repository,
    issue,
    sourceRevision,
    headBranch,
    baseBranch,
  });
}

function normalizedPublicationIdentity(state, manifest, request) {
  const authorization = authorizeProviderOperation(state, manifest, 'publish-change-request');
  if (!authorization.authorized) throw new Error(authorization.reason);
  const issue = state.issues?.[request.issue];
  const manifestIssue = manifest.issues.find((entry) => entry.identity === request.issue);
  if (!issue || !manifestIssue) throw new Error(`unknown issue: ${request.issue}`);
  const expected = {
    provider: manifest.provider.name,
    repository: manifest.repository.id,
    baseBranch: manifest.repository.baseBranch,
    headBranch: issue.branch,
    headSha: issue.headSha,
  };
  for (const field of ['provider', 'repository', 'baseBranch', 'headBranch', 'headSha']) {
    if (!nonEmpty(request[field]) || request[field] !== expected[field]) {
      throw new Error(`publication ${field} is not bound to persisted fleet state`);
    }
  }
  if (!nonEmpty(issue.headSha) || !nonEmpty(issue.baseSha)) {
    throw new Error('publication requires exact current base and head revisions');
  }
  if (issue.pipeline?.at(-1)?.stage !== 'criterion-verdict') {
    throw new Error('publication requires the complete pre-publication quality pipeline');
  }
  return {
    manifestDigest: manifest.digest,
    providerConfigurationDigest: manifest.providerConfigurationDigest,
    provider: expected.provider,
    repository: expected.repository,
    issue: request.issue,
    sourceRevision: manifestIssue.sourceRevision,
    headBranch: expected.headBranch,
    baseBranch: expected.baseBranch,
    baseSha: issue.baseSha,
    headSha: issue.headSha,
  };
}

export function beginPublication(state, manifest, request, now = new Date().toISOString()) {
  if (!validTimestamp(now)) throw new Error('publication intent time is invalid');
  const identity = normalizedPublicationIdentity(state, manifest, request);
  const key = publicationKey(identity);
  const existing = state.publications.find((entry) => entry.key === key);
  if (existing) {
    return {
      state,
      key,
      action: existing.state === 'confirmed' ? 'already-confirmed' : 'reconcile-before-retry',
    };
  }
  if (state.publications.some((entry) => entry.issue === request.issue)) {
    throw new Error(`issue already has a different publication intent: ${request.issue}`);
  }
  const next = structuredClone(state);
  next.publications.push({
    ...identity,
    key,
    state: 'intent-recorded',
    attempts: [],
    identifier: null,
    intentAt: now,
    confirmedAt: null,
  });
  next.events.push({ type: 'publication-intent', issue: request.issue, key });
  return { state: next, key, action: 'call-provider-with-stable-key' };
}

function validatePublicationResult(entry, result) {
  const defects = [];
  const invocation = result?.invocation;
  if (!invocation || typeof invocation !== 'object') {
    defects.push('publication invocation identity is absent');
  } else {
    if (!nonEmpty(invocation.id)) defects.push('publication invocation id is absent');
    if (invocation.operation !== 'publish-change-request') defects.push('publication invocation operation is invalid');
    if (invocation.providerKey !== entry.key) defects.push('publication invocation provider key does not match');
  }
  if (result?.terminal !== true || result?.complete !== true) {
    defects.push('publication result is not complete and terminal');
  }
  if (!validTimestamp(result?.observedAt)) defects.push('publication observation time is invalid');
  if (result?.provider !== entry.provider
      || result?.repository !== entry.repository
      || result?.issue !== entry.issue
      || result?.baseBranch !== entry.baseBranch
      || result?.headBranch !== entry.headBranch
      || result?.headSha !== entry.headSha) {
    defects.push('publication result identity does not match the persisted intent');
  }
  return defects;
}

export function reconcilePublication(state, manifest, key, result) {
  const authorization = authorizeProviderOperation(state, manifest, 'publish-change-request');
  if (!authorization.authorized) throw new Error(authorization.reason);
  const index = state.publications.findIndex((entry) => entry.key === key);
  if (index < 0) throw new Error('publication result has no persisted intent');
  const entry = state.publications[index];
  if (entry.state === 'confirmed') {
    if (result?.identifier && result.identifier !== entry.identifier) {
      throw new Error('confirmed publication cannot be rebound to another identifier');
    }
    return state;
  }
  const defects = validatePublicationResult(entry, result);
  if (defects.length) throw new Error(`invalid publication result: ${defects.join('; ')}`);
  const next = structuredClone(state);
  const target = next.publications[index];
  const attempt = {
    invocationId: result.invocation.id,
    status: result.status,
    observedAt: result.observedAt,
  };
  if (result.status === 'published' || result.status === 'found-existing') {
    if (!nonEmpty(result.identifier)) throw new Error('confirmed publication requires provider identifier');
    target.state = 'confirmed';
    target.identifier = result.identifier.trim();
    target.confirmedAt = result.observedAt;
    target.attempts.push(attempt);
    next.issues[target.issue].changeRequest = {
      identifier: target.identifier,
      provider: target.provider,
      repository: target.repository,
      baseBranch: target.baseBranch,
      headBranch: target.headBranch,
      headSha: target.headSha,
      publicationKey: target.key,
    };
    next.events.push({ type: 'publication-confirmed', issue: target.issue, key, identifier: target.identifier });
    return next;
  }
  if (!DEGRADED_PUBLICATION_STATUSES.has(result.status)) {
    throw new Error(`publication result status is invalid: ${result.status}`);
  }
  target.state = 'retryable-degraded';
  target.attempts.push(attempt);
  next.events.push({ type: 'publication-degraded', issue: target.issue, key, status: result.status });
  return next;
}

export function recordPublication(state, manifest, key, result) {
  return reconcilePublication(state, manifest, key, result);
}

export function publicationRecoveryAction(state, key) {
  const entry = state.publications.find((candidate) => candidate.key === key);
  if (!entry) return { action: 'record-intent-first' };
  if (entry.state === 'confirmed') {
    return { action: 'use-confirmed-publication', identifier: entry.identifier };
  }
  return {
    action: 'reconcile-by-stable-provider-key-before-retry',
    providerKey: entry.key,
    previousAttempts: entry.attempts.length,
  };
}

export function observeHumanMerge(state, manifest, observation) {
  const authorization = authorizeProviderOperation(state, manifest, 'observe-merge');
  if (!authorization.authorized) return { observed: false, reason: authorization.reason };
  const publication = state.publications.find((entry) =>
    entry.state === 'confirmed'
    && entry.issue === observation?.issue
    && entry.identifier === observation?.changeRequest);
  if (!publication) return { observed: false, reason: 'merge-observation-has-no-recorded-publication' };
  const invocation = observation?.invocation;
  if (!invocation
      || !nonEmpty(invocation.id)
      || invocation.operation !== 'observe-merge'
      || invocation.providerKey !== publication.key) {
    return { observed: false, reason: 'merge-observation-invocation-identity-invalid' };
  }
  if (observation.status !== 'observed'
      || observation.terminal !== true
      || observation.complete !== true
      || observation.merged !== true) {
    return { observed: false, reason: 'human-merge-not-proven' };
  }
  if (observation.provider !== publication.provider
      || observation.repository !== publication.repository
      || observation.issue !== publication.issue
      || observation.changeRequest !== publication.identifier
      || observation.baseBranch !== publication.baseBranch
      || observation.headBranch !== publication.headBranch
      || observation.headSha !== publication.headSha
      || !nonEmpty(observation.mergeCommit)
      || !validTimestamp(observation.observedAt)
      || Date.parse(observation.observedAt) < Date.parse(publication.confirmedAt)) {
    return { observed: false, reason: 'merge-observation-identity-or-time-mismatch' };
  }
  return {
    observed: true,
    provider: publication.provider,
    repository: publication.repository,
    issue: publication.issue,
    changeRequest: publication.identifier,
    publicationKey: publication.key,
    baseBranch: publication.baseBranch,
    headBranch: publication.headBranch,
    headSha: publication.headSha,
    mergeCommit: observation.mergeCommit,
    observedAt: observation.observedAt,
  };
}
