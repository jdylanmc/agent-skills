import crypto from 'node:crypto';
import { persistedPrePublicationPasses } from '../quality-evidence/quality-evidence.mjs';

export const PROVIDER_OPERATIONS = Object.freeze([
  'read-issue',
  'read-issue-set',
  'publish-change-request',
  'observe-merge',
  'observe-change-request-revision',
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

function exactKeys(value, expected) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
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
  const quality = persistedPrePublicationPasses(issue, state, manifest);
  if (!quality.passed) {
    throw new Error(`publication requires passing pre-publication quality: ${quality.defects.join('; ')}`);
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
    const current = existing.observations.find((observation) =>
      observation.baseSha === identity.baseSha && observation.headSha === identity.headSha);
    if (current) {
      return {
        state,
        key,
        action: current.state === 'confirmed'
          ? 'already-confirmed-current-revision'
          : 'reconcile-before-retry',
      };
    }
    const next = structuredClone(state);
    const target = next.publications.find((entry) => entry.key === key);
    target.observations.push({
      baseSha: identity.baseSha,
      headSha: identity.headSha,
      state: 'intent-recorded',
      attempts: [],
      intentAt: now,
      confirmedAt: null,
    });
    next.issues[request.issue].changeRequest = null;
    next.events.push({
      type: 'publication-revision-intent',
      issue: request.issue,
      key,
      baseSha: identity.baseSha,
      headSha: identity.headSha,
    });
    return {
      state: next,
      key,
      action: existing.identifier
        ? 'reobserve-existing-publication'
        : 'reconcile-before-retry',
    };
  }
  if (state.publications.some((entry) => entry.issue === request.issue)) {
    throw new Error(`issue already has a different publication intent: ${request.issue}`);
  }
  const next = structuredClone(state);
  next.publications.push({
    manifestDigest: identity.manifestDigest,
    providerConfigurationDigest: identity.providerConfigurationDigest,
    provider: identity.provider,
    repository: identity.repository,
    issue: identity.issue,
    sourceRevision: identity.sourceRevision,
    headBranch: identity.headBranch,
    baseBranch: identity.baseBranch,
    key,
    identifier: null,
    observations: [{
      baseSha: identity.baseSha,
      headSha: identity.headSha,
      state: 'intent-recorded',
      attempts: [],
      intentAt: now,
      confirmedAt: null,
    }],
  });
  next.events.push({ type: 'publication-intent', issue: request.issue, key });
  return { state: next, key, action: 'call-provider-with-stable-key' };
}

function currentPublicationObservation(entry, state) {
  const issue = state.issues[entry.issue];
  return entry.observations.find((observation) =>
    observation.baseSha === issue.baseSha && observation.headSha === issue.headSha);
}

function validatePublicationResult(entry, observation, result) {
  const defects = [];
  const invocation = result?.invocation;
  if (!exactKeys(result, [
    'invocation', 'terminal', 'complete', 'status', 'observedAt',
    'provider', 'repository', 'issue', 'baseBranch', 'headBranch',
    'baseSha', 'headSha', 'identifier',
  ])) {
    defects.push('publication result schema is not exact');
  }
  if (!exactKeys(invocation, ['id', 'operation', 'providerKey'])) {
    defects.push('publication invocation identity is absent');
  } else {
    if (!nonEmpty(invocation.id)) defects.push('publication invocation id is absent');
    if (invocation.operation !== 'publish-change-request') defects.push('publication invocation operation is invalid');
    if (invocation.providerKey !== entry.key) defects.push('publication invocation provider key does not match');
  }
  if (result?.terminal !== true || result?.complete !== true) {
    defects.push('publication result is not complete and terminal');
  }
  if (!['published', 'found-existing'].includes(result?.status)
      && !DEGRADED_PUBLICATION_STATUSES.has(result?.status)) {
    defects.push('publication result status is invalid');
  }
  if (!validTimestamp(result?.observedAt)) defects.push('publication observation time is invalid');
  if (DEGRADED_PUBLICATION_STATUSES.has(result?.status) && result?.identifier !== null) {
    defects.push('degraded publication result must not claim an identifier');
  }
  if (result?.provider !== entry.provider
      || result?.repository !== entry.repository
      || result?.issue !== entry.issue
      || result?.baseBranch !== entry.baseBranch
      || result?.headBranch !== entry.headBranch
      || result?.baseSha !== observation.baseSha
      || result?.headSha !== observation.headSha) {
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
  const observation = currentPublicationObservation(entry, state);
  if (!observation) throw new Error('publication result has no current revision intent');
  const defects = validatePublicationResult(entry, observation, result);
  if (defects.length) throw new Error(`invalid publication result: ${defects.join('; ')}`);
  if (observation.state === 'confirmed') {
    if (result?.identifier !== entry.identifier) {
      throw new Error('confirmed publication cannot be rebound to another identifier');
    }
    return state;
  }
  const next = structuredClone(state);
  const target = next.publications[index];
  const targetObservation = currentPublicationObservation(target, next);
  if (target.observations.some((candidate) =>
    candidate.attempts.some((attempt) => attempt.invocation.id === result.invocation.id))) {
    throw new Error('publication invocation identity was already consumed');
  }
  const attempt = {
    invocation: {
      id: result.invocation.id,
      operation: result.invocation.operation,
      providerKey: result.invocation.providerKey,
    },
    status: result.status,
    observedAt: result.observedAt,
    terminal: result.terminal,
    complete: result.complete,
    provider: result.provider,
    repository: result.repository,
    issue: result.issue,
    baseBranch: result.baseBranch,
    headBranch: result.headBranch,
    baseSha: result.baseSha,
    headSha: result.headSha,
    identifier: result.identifier,
  };
  if (result.status === 'published' || result.status === 'found-existing') {
    if (!nonEmpty(result.identifier)) throw new Error('confirmed publication requires provider identifier');
    const identifier = result.identifier.trim();
    if (target.identifier !== null && target.identifier !== identifier) {
      throw new Error('provider result does not converge to the stable publication identifier');
    }
    target.identifier = identifier;
    targetObservation.state = 'confirmed';
    targetObservation.confirmedAt = result.observedAt;
    targetObservation.attempts.push(attempt);
    next.issues[target.issue].changeRequest = {
      identifier: target.identifier,
      provider: target.provider,
      repository: target.repository,
      baseBranch: target.baseBranch,
      headBranch: target.headBranch,
      baseSha: targetObservation.baseSha,
      headSha: targetObservation.headSha,
      publicationKey: target.key,
    };
    next.events.push({ type: 'publication-confirmed', issue: target.issue, key, identifier: target.identifier });
    return next;
  }
  if (!DEGRADED_PUBLICATION_STATUSES.has(result.status)) {
    throw new Error(`publication result status is invalid: ${result.status}`);
  }
  targetObservation.state = 'retryable-degraded';
  targetObservation.attempts.push(attempt);
  next.events.push({ type: 'publication-degraded', issue: target.issue, key, status: result.status });
  return next;
}

export function recordPublication(state, manifest, key, result) {
  return reconcilePublication(state, manifest, key, result);
}

export function publicationRecoveryAction(state, manifest, key) {
  if (!manifest
      || state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    return { action: 'stop-recovery-manifest-mismatch' };
  }
  const entry = state.publications.find((candidate) => candidate.key === key);
  if (!entry) return { action: 'record-intent-first' };
  const observation = currentPublicationObservation(entry, state);
  if (!observation) return { action: 'record-current-revision-intent', providerKey: entry.key };
  if (observation.state === 'confirmed') {
    return { action: 'use-confirmed-current-publication', identifier: entry.identifier };
  }
  if (observation.attempts.length >= manifest.budget.retries) {
    return {
      action: 'stop-recovery-retry-budget-exhausted',
      providerKey: entry.key,
      previousAttempts: observation.attempts.length,
    };
  }
  return {
    action: 'reconcile-by-stable-provider-key-before-retry',
    providerKey: entry.key,
    previousAttempts: observation.attempts.length,
  };
}

export function normalizeMergeObservation(state, manifest, observation) {
  if (!exactKeys(observation, [
    'invocation', 'observed', 'status', 'terminal', 'complete', 'merged',
    'provider', 'repository', 'issue', 'changeRequest', 'publicationKey',
    'baseBranch', 'baseSha', 'headBranch', 'headSha', 'mergeCommit', 'observedAt',
  ])) {
    throw new Error('merge-observation-schema-is-not-exact');
  }

  const authorization = authorizeProviderOperation(state, manifest, 'observe-merge');
  if (!authorization.authorized) throw new Error(authorization.reason);
  const publication = state.publications.find((entry) =>
    entry.issue === observation?.issue
    && entry.identifier === observation?.changeRequest);
  if (!publication) throw new Error('merge-observation-has-no-recorded-publication');
  const revision = publication.observations.find((entry) =>
    entry.state === 'confirmed'
    && entry.baseSha === observation?.baseSha
    && entry.headSha === observation?.headSha
    && validTimestamp(entry.confirmedAt));
  if (!revision) throw new Error('merge-observation-has-no-confirmed-publication-revision');
  const invocation = observation?.invocation;
  if (!exactKeys(invocation, ['id', 'operation', 'providerKey'])
      || !nonEmpty(invocation.id)
      || invocation.operation !== 'observe-merge'
      || invocation.providerKey !== publication.key) {
    throw new Error('merge-observation-invocation-identity-invalid');
  }
  if (observation.status !== 'observed'
      || observation.terminal !== true
      || observation.complete !== true
      || observation.merged !== true) {
    throw new Error('human-merge-not-proven');
  }
  if (observation.provider !== publication.provider
      || observation.repository !== publication.repository
      || observation.issue !== publication.issue
      || observation.changeRequest !== publication.identifier
      || observation.publicationKey !== publication.key
      || observation.baseBranch !== publication.baseBranch
      || observation.headBranch !== publication.headBranch
      || observation.baseSha !== revision.baseSha
      || observation.headSha !== revision.headSha
      || !nonEmpty(observation.mergeCommit)
      || !validTimestamp(observation.observedAt)
      || Date.parse(observation.observedAt) <= Date.parse(revision.confirmedAt)) {
    throw new Error('merge-observation-identity-or-time-mismatch');
  }
  return {
    invocation: {
      id: invocation.id,
      operation: 'observe-merge',
      providerKey: publication.key,
    },
    observed: true,
    status: 'observed',
    terminal: true,
    complete: true,
    merged: true,
    provider: publication.provider,
    repository: publication.repository,
    issue: publication.issue,
    changeRequest: publication.identifier,
    publicationKey: publication.key,
    baseBranch: publication.baseBranch,
    baseSha: revision.baseSha,
    headBranch: publication.headBranch,
    headSha: revision.headSha,
    mergeCommit: observation.mergeCommit,
    observedAt: observation.observedAt,
  };
}

export function normalizeChangeRequestRevisionObservation(state, manifest, observation) {
  if (!exactKeys(observation, [
    'invocation', 'observed', 'status', 'terminal', 'complete',
    'provider', 'repository', 'issue', 'changeRequest', 'publicationKey',
    'baseBranch', 'baseSha', 'headBranch', 'headSha', 'observedAt',
  ])) {
    throw new Error('change-request-revision-schema-is-not-exact');
  }
  const authorization = authorizeProviderOperation(
    state,
    manifest,
    'observe-change-request-revision',
  );
  if (!authorization.authorized) throw new Error(authorization.reason);
  const publication = state.publications.find((entry) =>
    entry.key === observation?.publicationKey
    && entry.issue === observation?.issue
    && entry.identifier === observation?.changeRequest);
  if (!publication) {
    throw new Error('change-request-revision-has-no-recorded-publication');
  }
  const invocation = observation?.invocation;
  if (!exactKeys(invocation, ['id', 'operation', 'providerKey'])
      || !nonEmpty(invocation.id)
      || invocation.operation !== 'observe-change-request-revision'
      || invocation.providerKey !== publication.key) {
    throw new Error('change-request-revision-invocation-identity-invalid');
  }
  if (observation.observed !== true
      || observation.status !== 'observed'
      || observation.terminal !== true
      || observation.complete !== true) {
    throw new Error('change-request-revision-not-proven');
  }
  if (observation.provider !== publication.provider
      || observation.repository !== publication.repository
      || observation.issue !== publication.issue
      || observation.changeRequest !== publication.identifier
      || observation.publicationKey !== publication.key
      || observation.baseBranch !== publication.baseBranch
      || observation.headBranch !== publication.headBranch
      || !nonEmpty(observation.baseSha)
      || !nonEmpty(observation.headSha)
      || !validTimestamp(observation.observedAt)) {
    throw new Error('change-request-revision-identity-or-time-mismatch');
  }
  return {
    invocation: {
      id: invocation.id,
      operation: 'observe-change-request-revision',
      providerKey: publication.key,
    },
    observed: true,
    status: 'observed',
    terminal: true,
    complete: true,
    provider: publication.provider,
    repository: publication.repository,
    issue: publication.issue,
    changeRequest: publication.identifier,
    publicationKey: publication.key,
    baseBranch: publication.baseBranch,
    baseSha: observation.baseSha,
    headBranch: publication.headBranch,
    headSha: observation.headSha,
    observedAt: observation.observedAt,
  };
}

export function observeHumanMerge(state, manifest, observation) {
  try {
    return normalizeMergeObservation(state, manifest, observation);
  } catch (error) {
    return { observed: false, reason: error.message };
  }
}
