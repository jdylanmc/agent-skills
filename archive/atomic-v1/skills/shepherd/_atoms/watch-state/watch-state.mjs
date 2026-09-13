import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  interpretReviewThreads,
  latestReviewsCommand,
  reviewThreadsCommand,
  threadCommentsCommand,
} from '../../../ship/_atoms/provider-review/provider-review.mjs';
import { digestConfirmedLedger } from '../../../ship/_atoms/continuation-remediation/continuation-remediation.mjs';
import { isTerminalDisposition } from '../../../_base/_atoms/landability/landability.mjs';
import { normalizeGitHubRepository } from '../../../_base/_atoms/provider-detect/provider-detect.mjs';
import {
  authoritativeChecks,
  currentRequiredChecksStatus,
  liveBaseCommand,
  liveBaseIsCurrent,
  validatedBranchRef,
} from '../provider-state/provider-state.mjs';
import { pushReceiptIsValid } from '../shepherd-disposition/shepherd-disposition.mjs';

export const WATCH_SCHEMA = 1;
export const MAX_GAPS = 20;

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');
}

function instant(value, label) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be an ISO-8601 timestamp`);
  }
  return parsed;
}

function objectId(value, label) {
  const normalized = String(value ?? '');
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(normalized)) {
    throw new Error(`${label} must be a full lowercase Git object ID`);
  }
  return normalized;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

export function pollingDelayMs(startedAt, observedAt) {
  const elapsed = Math.max(0, instant(observedAt, 'observedAt') - instant(startedAt, 'startedAt'));
  if (elapsed < 60 * 60_000) return 2 * 60_000;
  if (elapsed < 2 * 60 * 60_000) return 5 * 60_000;
  if (elapsed < 3 * 60 * 60_000) return 10 * 60_000;
  if (elapsed < 4 * 60 * 60_000) return 15 * 60_000;
  if (elapsed < 5 * 60 * 60_000) return 30 * 60_000;
  return 60 * 60_000;
}

export function probeReviewChange(detection, payload, context) {
  const review = interpretReviewThreads(detection, payload, context);
  if (review.observed !== true || review.complete !== true || review.identityBound !== true) {
    return {
      observed: review.observed === true,
      complete: review.complete === true,
      identityBound: review.identityBound === true,
      reason: review.reason ?? 'review-evidence-incomplete',
    };
  }
  return {
    observed: true,
    complete: true,
    identityBound: true,
    repository: review.repository,
    changeRequest: review.changeRequest,
    reviewDecision: review.reviewDecision,
    observationDigest: review.observationDigest,
    threadCount: review.threads.length,
    unresolvedThreadCount: review.threads.filter((thread) => thread.isResolved === false).length,
    verdictCount: review.verdicts.length,
  };
}

function normalizedChecks(checks = []) {
  return checks.map((check) => ({
    name: check.name === undefined || check.name === null ? null : String(check.name),
    nativeId: check.nativeId === undefined || check.nativeId === null ? null : String(check.nativeId),
    runId: check.runId === undefined || check.runId === null ? null : String(check.runId),
    workflowId: check.workflowId === undefined || check.workflowId === null ? null : String(check.workflowId),
    runNumber: Number.isInteger(check.runNumber) && check.runNumber > 0 ? check.runNumber : null,
    attempt: Number.isInteger(check.attempt) && check.attempt > 0 ? check.attempt : null,
    headSha: check.headSha === undefined || check.headSha === null ? null : String(check.headSha),
    required: typeof check.required === 'boolean' ? check.required : null,
    appId: check.appId ?? null,
    status: String(check.status),
    url: check.url === undefined || check.url === null ? null : String(check.url),
    untrusted: true,
  })).sort((a, b) => digest(a).localeCompare(digest(b)));
}

export function reviewProbeCommand(detection, target) {
  return reviewThreadsCommand(detection, target);
}

export function projectWatchIdentity(resolved, { detection, repository, changeRequest, issue = null } = {}) {
  if (detection?.provider !== 'github' || resolved?.observed !== true) {
    throw new Error('watch identity projection requires an observed GitHub target');
  }
  return {
    provider: 'github',
    repository: normalizeGitHubRepository(repository, detection),
    changeRequest: nonEmpty(String(changeRequest ?? ''), 'change-request id'),
    issue: issue === null ? null : nonEmpty(String(issue), 'issue id'),
    branch: validatedBranchRef(resolved.branch),
    baseBranch: validatedBranchRef(resolved.base),
    headRepository: normalizeGitHubRepository(
      nonEmpty(resolved.headRepository?.nameWithOwner, 'resolved head repository'),
      detection,
    ),
  };
}

export function watchBaseCommand(detection, observation) {
  return liveBaseCommand(detection, {
    repository: { slug: observation.identity.repository.split('/').slice(-2).join('/') },
    baseBranch: observation.pullRequest.baseBranch,
  });
}

export function reviewProbeLatestPageCommand(detection, target, page) {
  return latestReviewsCommand(detection, target, page);
}

export function reviewProbeThreadPageCommand(detection, target, page) {
  return threadCommentsCommand(detection, target, page);
}

export function normalizeObservation(observation = {}) {
  const liveBase = liveBaseIsCurrent(observation.liveBase, {
    repository: observation.identity?.repository,
    baseBranch: observation.pullRequest?.baseBranch,
  }) ? observation.liveBase : null;
  const evidenceChecks = normalizedChecks(observation.checkEvidence?.checks ?? []);
  const suppliedChecks = normalizedChecks(observation.checks ?? observation.checkEvidence?.checks ?? []);
  const checkListsMatch = digest(evidenceChecks) === digest(suppliedChecks);
  return canonical({
    identity: {
      provider: observation.identity?.provider ?? null,
      repository: observation.identity?.repository ?? null,
      changeRequest: observation.identity?.changeRequest ?? null,
      issue: observation.identity?.issue ?? null,
      branch: observation.identity?.branch ?? null,
      headRepository: observation.identity?.headRepository ?? null,
      baseBranch: observation.pullRequest?.baseBranch ?? null,
    },
    pullRequest: {
      state: observation.pullRequest?.state ?? null,
      baseBranch: observation.pullRequest?.baseBranch ?? null,
      baseSha: liveBase?.sha ?? null,
      headSha: observation.pullRequest?.headSha ?? null,
      mergeState: observation.pullRequest?.mergeState ?? null,
      mergeStateStatus: observation.pullRequest?.mergeStateStatus ?? null,
      blocked: observation.pullRequest?.blocked ?? null,
      behind: observation.pullRequest?.behind ?? null,
      isDraft: observation.pullRequest?.isDraft ?? null,
      upToDatePolicy: observation.pullRequest?.upToDatePolicy ?? 'unobserved',
      reviewDecision: observation.pullRequest?.reviewDecision ?? null,
    },
    liveBase: liveBase ? {
      observed: true, identityBound: true, repository: liveBase.repository,
      ref: liveBase.ref, sha: liveBase.sha, observedAt: liveBase.observedAt,
    } : null,
    checkEvidence: {
      observed: observation.checkEvidence?.observed === true,
      complete: observation.checkEvidence?.complete === true && checkListsMatch,
      headSha: observation.checkEvidence?.headSha ?? null,
      requiredChecks: observation.checkEvidence?.requiredChecks ?? null,
      checks: evidenceChecks,
    },
    review: {
      observed: observation.review?.observed === true,
      complete: observation.review?.complete === true,
      identityBound: observation.review?.identityBound === true,
      observationDigest: observation.review?.observationDigest ?? null,
    },
    checks: suppliedChecks,
    ownership: {
      branchOwned: observation.ownership?.branchOwned === true,
      providerAvailable: observation.ownership?.providerAvailable === true,
      evidenceComplete: observation.ownership?.evidenceComplete === true,
    },
  });
}

function validateObservation(observation, { initial = false, observationOnly = false } = {}) {
  for (const [field, value] of Object.entries(observation.identity)) {
    if (observationOnly && field === 'issue' && value === null) continue;
    nonEmpty(value, `identity.${field}`);
  }
  validatedBranchRef(observation.identity.branch);
  validatedBranchRef(observation.identity.baseBranch);
  if (!['open', 'merged', 'closed'].includes(observation.pullRequest.state)) {
    throw new Error('pull request state must be open, merged, or closed');
  }
  if (observation.pullRequest.baseSha !== null) objectId(observation.pullRequest.baseSha, 'base head');
  objectId(observation.pullRequest.headSha, 'observed head');
  nonEmpty(observation.pullRequest.baseBranch, 'base branch');
  nonEmpty(observation.pullRequest.mergeState, 'merge state');
  nonEmpty(observation.pullRequest.mergeStateStatus, 'merge-state status');
  nonEmpty(observation.pullRequest.reviewDecision, 'review decision');
  if (![true, false, null].includes(observation.pullRequest.blocked)
    || ![true, false, null].includes(observation.pullRequest.behind)) {
    throw new Error('blocked and behind must be observed booleans or null');
  }
  if (typeof observation.pullRequest.isDraft !== 'boolean') {
    throw new Error('draft state must be observed');
  }
  if (!['required', 'not-required', 'unobserved'].includes(observation.pullRequest.upToDatePolicy)) {
    throw new Error('up-to-date policy must use normalized vocabulary');
  }
  if (initial && !observationOnly && (!observation.review.observed
    || !observation.review.complete
    || !observation.review.identityBound
    || !/^[0-9a-f]{64}$/.test(observation.review.observationDigest ?? ''))) {
    throw new Error('review observation must be complete, identity-bound, and digest-bound');
  }
  if (!initial && observation.review.complete
    && !/^[0-9a-f]{64}$/.test(observation.review.observationDigest ?? '')) {
    throw new Error('a complete review observation must be digest-bound');
  }
  if (initial && (!observation.ownership.providerAvailable
    || (!observationOnly && (!observation.ownership.branchOwned || !observation.ownership.evidenceComplete)))) {
    throw new Error('provider, ownership, and evidence must be available');
  }
  if (!observationOnly && (observation.checkEvidence.observed !== true
    || observation.checkEvidence.complete !== true
    || observation.checkEvidence.headSha !== observation.pullRequest.headSha
    || digest(observation.checkEvidence.checks) !== digest(observation.checks))) {
    throw new Error('check evidence must be complete, atomic, and bound to the observed head');
  }
  for (const check of observation.checks) {
    nonEmpty(check.name, 'check name');
    nonEmpty(check.status, 'check status');
    if (!observationOnly && typeof check.required !== 'boolean') {
      throw new Error('check requiredness must be observed');
    }
    if (!observationOnly && check.headSha !== observation.pullRequest.headSha) {
      throw new Error('every check must be bound to the observed head');
    }
    if (!observationOnly && check.required && check.status === 'failure'
      && (!check.runId || !check.nativeId || !check.attempt)) {
      throw new Error('a failed required check needs provider-native run, check, and attempt identity');
    }
  }
  if (initial && observation.pullRequest.state !== 'open') {
    throw new Error('a watch can start only for an open change request');
  }
  return observation;
}

export function observationDigest(observation) {
  const normalized = normalizeObservation(observation);
  if (normalized.liveBase) delete normalized.liveBase.observedAt;
  return digest(normalized);
}

function stateIntegrity(state) {
  const { integrityDigest: ignored, ...content } = state;
  return digest(content);
}

function withIntegrity(state) {
  return { ...state, integrityDigest: stateIntegrity(state) };
}

function normalizeContinuation(value = {}, expectedHead) {
  const changeRequest = value.changeRequest ?? {};
  const computedLedgerDigest = digestConfirmedLedger(value.ledger);
  if (!value.originalIssue
    || changeRequest.issue !== value.originalIssue
    || !changeRequest.id
    || !changeRequest.branch
    || !changeRequest.provider
    || !changeRequest.repository
    || value.ledger?.alignment !== 'confirmed'
    || !computedLedgerDigest
    || value.ledger.digest !== computedLedgerDigest
    || !value.priorDeliveryEvidence) {
    throw new Error('continuation context does not satisfy Ship identity and confirmed-ledger intake');
  }
  const prior = value.priorDeliveryEvidence;
  if (prior.complete !== true
    || prior.issue !== value.originalIssue
    || prior.changeRequest !== changeRequest.id
    || prior.branch !== changeRequest.branch
    || prior.provider !== changeRequest.provider
    || prior.repository !== changeRequest.repository
    || objectId(prior.head, 'prior delivery head') !== objectId(expectedHead, 'expected head')
    || prior.ledgerDigest !== computedLedgerDigest
    || typeof prior.reviewObservationDigest !== 'string'
    || !/^[0-9a-f]{64}$/.test(prior.reviewObservationDigest)
    || !Array.isArray(prior.reviewEvidenceIds)
    || !Array.isArray(prior.ciFailureIds)) {
    throw new Error('prior delivery evidence does not satisfy Ship continuation intake');
  }
  return canonical({
    originalIssue: nonEmpty(value.originalIssue, 'original issue'),
    changeRequest: {
      ...changeRequest,
      id: nonEmpty(changeRequest.id, 'change-request id'),
      issue: nonEmpty(changeRequest.issue, 'change-request issue'),
      branch: nonEmpty(changeRequest.branch, 'change-request branch'),
      provider: nonEmpty(changeRequest.provider, 'change-request provider'),
      repository: nonEmpty(changeRequest.repository, 'change-request repository'),
      headRepository: nonEmpty(changeRequest.headRepository, 'head repository'),
      baseBranch: nonEmpty(changeRequest.baseBranch, 'base branch'),
    },
    ledger: value.ledger,
    priorDeliveryEvidence: prior,
  });
}

function identityFromContinuation(continuation) {
  return canonical({
    provider: continuation.changeRequest.provider,
    repository: continuation.changeRequest.repository,
    changeRequest: continuation.changeRequest.id,
    issue: continuation.originalIssue,
    branch: continuation.changeRequest.branch,
    headRepository: continuation.changeRequest.headRepository,
    baseBranch: continuation.changeRequest.baseBranch,
  });
}

function handledFromPrior(prior) {
  return [
    `review-packet:${prior.reviewObservationDigest}`,
    ...prior.ciFailureIds.map((id) => `ci:${id}`),
  ];
}

function changedFields(previous, current) {
  const fields = [];
  for (const key of ['identity', 'pullRequest', 'liveBase', 'checkEvidence', 'review', 'checks', 'ownership']) {
    const comparable = (value) => key === 'liveBase' && value
      ? { ...value, observedAt: null } : value ?? null;
    if (digest(comparable(previous?.[key])) !== digest(comparable(current?.[key]))) {
      fields.push(key);
    }
  }
  return fields;
}

function nextPoll(startedAt, observedAt) {
  const delayMs = pollingDelayMs(startedAt, observedAt);
  return {
    delayMs,
    nextPollAt: new Date(instant(observedAt, 'observedAt') + delayMs).toISOString(),
  };
}

export function createWatchState({ observation, observedAt, continuation, readAuthority }) {
  const observationOnly = continuation === undefined || continuation === null;
  const normalized = validateObservation(normalizeObservation(observation), { initial: true, observationOnly });
  const expectedHead = objectId(normalized.pullRequest.headSha, 'observed head');
  const normalizedContinuation = observationOnly ? null : normalizeContinuation(continuation, expectedHead);
  if (observationOnly && (readAuthority?.source !== 'operator-explicit-target'
    || !readAuthority.owningParent
    || digest(readAuthority.targetIdentity) !== digest(normalized.identity))) {
    throw new Error('observation-only watch requires explicit operator target read authority and owning parent');
  }
  if (!observationOnly && digest(normalized.identity) !== digest(identityFromContinuation(normalizedContinuation))) {
    throw new Error('observation identity does not match Ship continuation identity');
  }
  const { delayMs, nextPollAt } = nextPoll(observedAt, observedAt);
  return withIntegrity({
    schema: WATCH_SCHEMA,
    status: 'running',
    stopReason: null,
    startedAt: observedAt,
    lastObservedAt: observedAt,
    nextPollAt,
    delayMs,
    observation: normalized,
    observationDigest: observationDigest(normalized),
    targetIdentity: normalized.identity,
    expectedHead,
    authority: observationOnly
      ? { mode: 'observation-only', provenance: 'operator-explicit-target', owningParent: readAuthority.owningParent }
      : { mode: 'ship-continuation', provenance: 'validated-ship-context' },
    continuation: normalizedContinuation,
    handledEvidenceKeys: [...new Set([
      ...(observationOnly ? [] : handledFromPrior(normalizedContinuation.priorDeliveryEvidence)),
      ...(continuation?.handledEvidenceKeys ?? []),
    ])],
    shipReceipts: [],
    inFlightShip: null,
    lastChange: {
      meaningful: true,
      fields: ['review', 'checks'],
      observedAt,
    },
    observationCount: 1,
    unchangedCount: 0,
    gaps: [],
    droppedGapCount: 0,
  });
}

export function resumeWatch(state, { resumedAt }) {
  if (state.status === 'stopped') {
    throw new Error('a stopped watch cannot resume without a new operator decision');
  }
  if (instant(resumedAt, 'resumedAt') < instant(state.lastObservedAt, 'lastObservedAt')) {
    throw new Error('resume time precedes the last durable observation');
  }
  const allGaps = [...state.gaps, { from: state.lastObservedAt, to: resumedAt }];
  const dropped = Math.max(0, allGaps.length - MAX_GAPS);
  return withIntegrity({
    ...state,
    status: 'running',
    resumedAt,
    nextPollAt: resumedAt,
    delayMs: 0,
    gaps: allGaps.slice(-MAX_GAPS),
    droppedGapCount: state.droppedGapCount + dropped,
  });
}

export function recordObservation(state, { observation, observedAt }) {
  if (state.status !== 'running') {
    throw new Error('only a running watch accepts observations');
  }
  if (!['observation-only', 'ship-continuation'].includes(state.authority?.mode)) {
    return stopWatch(state, { reason: 'ownership-failure', stoppedAt: observedAt });
  }
  if (instant(observedAt, 'observedAt') < instant(state.lastObservedAt, 'lastObservedAt')) {
    throw new Error('observation time must not move backward');
  }
  const normalized = validateObservation(normalizeObservation(observation), {
    observationOnly: state.authority?.mode === 'observation-only',
  });
  if (digest(normalized.identity) !== digest(state.targetIdentity)) {
    return stopWatch(state, { reason: 'ownership-failure', stoppedAt: observedAt });
  }
  const observationOnly = state.authority?.mode === 'observation-only';
  if (!observationOnly && normalized.pullRequest.headSha !== state.expectedHead) {
    return stopWatch(state, { reason: 'ownership-failure', stoppedAt: observedAt });
  }
  const nextDigest = observationDigest(normalized);
  const fields = changedFields(state.observation, normalized);
  const meaningful = nextDigest !== state.observationDigest;
  const { delayMs, nextPollAt } = nextPoll(state.startedAt, observedAt);
  const terminal = ['merged', 'closed'].includes(normalized.pullRequest.state);
  return withIntegrity({
    ...state,
    status: terminal ? 'stopped' : 'running',
    stopReason: terminal ? `change-request-${normalized.pullRequest.state}` : null,
    lastObservedAt: observedAt,
    nextPollAt: terminal ? null : nextPollAt,
    delayMs: terminal ? null : delayMs,
    observation: normalized,
    expectedHead: observationOnly ? normalized.pullRequest.headSha : state.expectedHead,
    observationDigest: nextDigest,
    lastChange: { meaningful, fields, observedAt },
    observationCount: state.observationCount + 1,
    unchangedCount: meaningful ? state.unchangedCount : state.unchangedCount + 1,
  });
}

export function stopWatch(state, { reason, stoppedAt }) {
  const allowed = new Set([
    'operator-stop',
    'semantic-conflict',
    'ship-needs-human',
    'ship-blocked',
    'provider-failure',
    'ownership-failure',
    'evidence-failure',
  ]);
  if (!allowed.has(reason)) {
    throw new Error(`unsupported stop reason: ${reason}`);
  }
  return withIntegrity({
    ...state,
    status: 'stopped',
    stopReason: reason,
    stoppedAt,
    nextPollAt: null,
    delayMs: null,
  });
}

function evidenceKeys(state) {
  const keys = [];
  const reviewDigest = state.observation.review.observationDigest;
  if (reviewDigest && state.lastChange.fields.includes('review')) {
    keys.push(`review-packet:${reviewDigest}`);
  }
  if (state.lastChange.fields.includes('checks')) {
    for (const check of authoritativeChecks(state.observation.checks).filter((item) => item.required && ['failure', 'cancelled'].includes(item.status))) {
      if (!check.runId || !check.nativeId || !check.attempt || !check.headSha) {
        keys.push('checks:incomplete');
      } else {
        keys.push(`ci:${check.runId}/${check.nativeId}/${check.attempt}`);
      }
    }
  }
  return keys;
}

export function recordShipResult(state, {
  evidence,
  shipResult,
  recordedAt,
}) {
  if (state.authority?.mode !== 'ship-continuation') {
    return stopWatch(state, { reason: 'ship-blocked', stoppedAt: recordedAt });
  }
  if (!state.inFlightShip
    || digest(state.inFlightShip.evidence) !== digest(evidence)) {
    return stopWatch(state, { reason: 'ship-blocked', stoppedAt: recordedAt });
  }
  if (shipResult?.mode !== 'existing-change-request'
    || digest(shipResult.identity) !== digest(state.targetIdentity)) {
    return stopWatch(state, { reason: 'ship-blocked', stoppedAt: recordedAt });
  }
  if (['handed-back', 'needs-alignment', 'underspecified', 'out-of-scope'].includes(shipResult.status)) {
    return stopWatch(state, { reason: 'ship-needs-human', stoppedAt: recordedAt });
  }
  if (shipResult.status !== 'shipped-to-review'
    || !shipResult.resultingHead
    || evidence.includes('checks:incomplete')) {
    return stopWatch(state, { reason: 'ship-blocked', stoppedAt: recordedAt });
  }
  const nextHead = objectId(shipResult.resultingHead, 'Ship resulting head');
  let nextContinuation;
  try {
    nextContinuation = normalizeContinuation(shipResult.continuation, nextHead);
  } catch {
    return stopWatch(state, { reason: 'ship-blocked', stoppedAt: recordedAt });
  }
  if (nextContinuation.ledger.id !== state.continuation.ledger.id
    || nextContinuation.ledger.digest !== state.continuation.ledger.digest
    || digest(nextContinuation.changeRequest) !== digest(state.continuation.changeRequest)
    || nextContinuation.originalIssue !== state.continuation.originalIssue
    || nextContinuation.priorDeliveryEvidence.reviewObservationDigest
      !== state.observation.review.observationDigest
    || !evidence.every((key) => (
      key.startsWith('review-packet:')
        ? key === `review-packet:${nextContinuation.priorDeliveryEvidence.reviewObservationDigest}`
        : nextContinuation.priorDeliveryEvidence.ciFailureIds.includes(key.slice('ci:'.length))
    ))) {
    return stopWatch(state, { reason: 'ship-blocked', stoppedAt: recordedAt });
  }
  return withIntegrity({
    ...state,
    expectedHead: nextHead,
    continuation: nextContinuation,
    handledEvidenceKeys: [...new Set([
      ...state.handledEvidenceKeys,
      ...handledFromPrior(nextContinuation.priorDeliveryEvidence),
    ])],
    inFlightShip: null,
    shipReceipts: [...state.shipReceipts, {
      evidence: [...evidence],
      resultingHead: nextHead,
      continuationDigest: digest(nextContinuation),
      recordedAt,
    }].slice(-20),
  });
}

export function recordMaintainedHead(state, {
  previousHead,
  resultingHead,
  pushReceipt,
  continuation,
  recordedAt,
}) {
  if (state.authority?.mode !== 'ship-continuation') {
    return stopWatch(state, { reason: 'ownership-failure', stoppedAt: recordedAt });
  }
  if (previousHead !== state.expectedHead || !pushReceiptIsValid(pushReceipt, {
    headTarget: { repository: state.targetIdentity.headRepository,
      ref: `refs/heads/${validatedBranchRef(state.targetIdentity.branch)}` },
    previousHead, resultingHead, strategy: pushReceipt?.strategy,
  })) {
    return stopWatch(state, { reason: 'ownership-failure', stoppedAt: recordedAt });
  }
  const nextHead = objectId(resultingHead, 'maintained head');
  let nextContinuation;
  try {
    nextContinuation = normalizeContinuation(continuation, nextHead);
  } catch {
    return stopWatch(state, { reason: 'evidence-failure', stoppedAt: recordedAt });
  }
  if (nextContinuation.ledger.id !== state.continuation.ledger.id
    || nextContinuation.ledger.digest !== state.continuation.ledger.digest
    || digest(nextContinuation.changeRequest) !== digest(state.continuation.changeRequest)
    || nextContinuation.originalIssue !== state.continuation.originalIssue
    || nextContinuation.priorDeliveryEvidence.reviewObservationDigest
      !== state.observation.review.observationDigest
    || !evidenceKeys(state)
      .filter((key) => key.startsWith('ci:'))
      .every((key) => nextContinuation.priorDeliveryEvidence.ciFailureIds.includes(key.slice('ci:'.length)))) {
    return stopWatch(state, { reason: 'evidence-failure', stoppedAt: recordedAt });
  }
  return withIntegrity({
    ...state,
    expectedHead: nextHead,
    continuation: nextContinuation,
    maintenanceReceipt: {
      previousHead,
      resultingHead: nextHead,
      pushReceipt: canonical(pushReceipt),
      continuationDigest: digest(nextContinuation),
      recordedAt,
    },
  });
}

export function watchAction(state) {
  if (state.status === 'stopped') {
    return { action: 'stop', reason: state.stopReason };
  }
  const { ownership, review } = state.observation;
  if (state.inFlightShip) {
    return { action: 'stop', reason: 'ship-blocked' };
  }
  if (!ownership.providerAvailable) return { action: 'stop', reason: 'provider-failure' };
  if (state.authority?.mode === 'observation-only') {
    return state.lastChange.meaningful
      ? { action: 'notify-parent', reason: 'observation-only-change', owningParent: state.authority.owningParent, nextPollAt: state.nextPollAt }
      : { action: 'wait', reason: 'unchanged-observation-only', nextPollAt: state.nextPollAt };
  }
  if (state.authority?.mode !== 'ship-continuation') return { action: 'stop', reason: 'ownership-failure' };
  if (!ownership.branchOwned) return { action: 'stop', reason: 'ownership-failure' };
  if (!state.observation.liveBase || !ownership.evidenceComplete || !review.observed || !review.complete || !review.identityBound
    || state.observation.checkEvidence.observed !== true || state.observation.checkEvidence.complete !== true
    || state.observation.checkEvidence.headSha !== state.expectedHead
    || digest(state.observation.checkEvidence.checks) !== digest(state.observation.checks)) {
    return { action: 'stop', reason: 'evidence-failure' };
  }
  const checks = currentRequiredChecksStatus(state.observation.checkEvidence, state.expectedHead);
  if (checks.status === 'incomplete' && checks.reason !== 'remote-checks-incomplete') {
    return { action: 'stop', reason: 'evidence-failure' };
  }
  if (!state.lastChange.meaningful) {
    return { action: 'wait', reason: 'unchanged', nextPollAt: state.nextPollAt };
  }
  const pr = state.observation.pullRequest;
  if (['conflicted', 'dirty', 'unmergeable'].includes(pr.mergeState)
    || (pr.upToDatePolicy === 'required' && pr.behind === true)) {
    return { action: 'run-shepherd-cycle', reason: 'maintenance-required-before-functional-work' };
  }
  const pendingEvidence = evidenceKeys(state).filter((key) => !state.handledEvidenceKeys.includes(key));
  if (pendingEvidence.includes('checks:incomplete')) {
    return { action: 'stop', reason: 'evidence-failure' };
  }
  if (pendingEvidence.length > 0) {
    return { action: 'invoke-ship', reason: 'new-review-or-check-evidence', evidence: pendingEvidence };
  }
  if (state.observationCount === 1) {
    return { action: 'wait', reason: 'initial-baseline', nextPollAt: state.nextPollAt };
  }
  if (state.lastChange.meaningful) {
    return { action: 'run-shepherd-cycle', reason: state.lastChange.fields.join(',') };
  }
  return { action: 'wait', reason: 'handled-change', nextPollAt: state.nextPollAt };
}

export function beginShipDispatch(state, { evidence, startedAt }) {
  if (state.authority?.mode !== 'ship-continuation') {
    return stopWatch(state, { reason: 'ship-blocked', stoppedAt: startedAt });
  }
  if (watchAction(state).action !== 'invoke-ship'
    || state.inFlightShip || !Array.isArray(evidence) || evidence.length === 0) {
    return stopWatch(state, { reason: 'ship-blocked', stoppedAt: startedAt });
  }
  const pending = evidenceKeys(state).filter((key) => !state.handledEvidenceKeys.includes(key));
  if (digest(pending) !== digest(evidence)) {
    return stopWatch(state, { reason: 'ship-blocked', stoppedAt: startedAt });
  }
  return withIntegrity({
    ...state,
    inFlightShip: {
      evidence: [...evidence],
      head: state.expectedHead,
      startedAt,
    },
  });
}

export function bootstrapAcceptance(state, {
  workerStatus,
  acceptedIdentity,
  acceptedStateDigest,
  disposition,
  receipt,
  nextHumanAction,
} = {}) {
  const workerAccepted = workerStatus === 'running'
    && digest(acceptedIdentity) === digest(state.targetIdentity)
    && acceptedStateDigest === state.integrityDigest
    && state.status === 'running';
  if (workerAccepted && state.authority?.mode === 'observation-only') {
    return {
      status: 'observation-only',
      result: {
        disposition: 'blocked', reason: 'missing-ship-continuation-context',
        authority: state.authority,
        receipt: {
          observedAt: state.lastObservedAt, baseSha: state.observation.pullRequest.baseSha,
          headSha: state.expectedHead, upToDatePolicy: state.observation.pullRequest.upToDatePolicy,
          complete: false,
        },
        watch: { status: 'watch-accepted', identity: state.targetIdentity, stateDigest: state.integrityDigest },
      },
    };
  }
  const green = ['mergeable-and-green', 'no-op-mergeable-and-green'].includes(disposition);
  const pr = state.observation.pullRequest;
  const greenSupported = !green || (
    state.authority?.mode === 'ship-continuation'
    &&
    state.observation.ownership.evidenceComplete
    && state.observation.ownership.branchOwned
    && state.observation.ownership.providerAvailable
    && state.observation.review.observed && state.observation.review.complete
    && state.observation.review.identityBound
    && receipt?.provider === 'supported-provider'
    && pr.blocked === false && pr.isDraft === false
    && ['mergeable', 'clean', 'has_hooks'].includes(pr.mergeState)
    && !['review-required', 'changes-requested', 'REVIEW_REQUIRED', 'CHANGES_REQUESTED'].includes(pr.reviewDecision)
    && (pr.upToDatePolicy !== 'required' || pr.behind === false)
    && currentRequiredChecksStatus({
      ...state.observation.checkEvidence, checks: state.observation.checks,
    }, pr.headSha).status === 'success'
  );
  const accepted = workerAccepted && state.authority?.mode === 'ship-continuation' && greenSupported
    && isTerminalDisposition(disposition)
    && liveBaseIsCurrent(state.observation.liveBase, {
      repository: state.targetIdentity.repository, baseBranch: pr.baseBranch,
    })
    && receipt?.complete === true
    && receipt.baseSha === state.observation.pullRequest.baseSha
    && receipt.headSha === state.observation.pullRequest.headSha
    && receipt.upToDatePolicy === state.observation.pullRequest.upToDatePolicy
    && Number.isFinite(Date.parse(receipt.observedAt))
    && Date.parse(receipt.observedAt) >= Date.parse(state.lastObservedAt);
  return accepted
    ? {
      status: 'returned',
      result: {
        disposition,
        receipt,
        ...(nextHumanAction === undefined ? {} : { nextHumanAction }),
        watch: {
          status: 'watch-accepted',
          authority: state.authority,
          identity: state.targetIdentity,
          stateDigest: state.integrityDigest,
        },
      },
    }
    : {
      status: 'failed',
      result: null,
      reason: 'watch-worker-acceptance-unproven',
    };
}

export function persistWatchState(statePath, state, { fileSystem = fs, expectedDigest = null } = {}) {
  const resolved = path.resolve(statePath);
  if (fileSystem.existsSync(resolved) && fileSystem.lstatSync(resolved).isSymbolicLink()) {
    throw new Error('watch state target must not be a symbolic link');
  }
  const directory = path.dirname(resolved);
  fileSystem.mkdirSync(directory, { recursive: true });
  if (state.integrityDigest !== stateIntegrity(state)) {
    throw new Error('watch state integrity digest is stale');
  }
  const lock = `${resolved}.lock`;
  let locked = false;
  try {
    try {
      fileSystem.writeFileSync(lock, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const owner = Number.parseInt(fileSystem.readFileSync(lock, 'utf8').trim(), 10);
      let ownerAlive = Number.isInteger(owner) && owner > 0;
      if (ownerAlive) {
        try {
          process.kill(owner, 0);
        } catch (probeError) {
          if (probeError.code === 'ESRCH') ownerAlive = false;
          else throw probeError;
        }
      }
      if (ownerAlive) {
        throw new Error(`watch state is locked by active process ${owner}`);
      }
      fileSystem.unlinkSync(lock);
      fileSystem.writeFileSync(lock, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    }
    locked = true;
    if (fileSystem.existsSync(resolved)) {
      const current = fileSystem.readFileSync(resolved, 'utf8');
      const currentDigest = crypto.createHash('sha256').update(current, 'utf8').digest('hex');
      if (expectedDigest === null || currentDigest !== expectedDigest) {
        throw new Error('watch state changed since the caller read it');
      }
    }
    const temporary = path.join(directory, `.${path.basename(resolved)}.${process.pid}.tmp`);
    const bytes = `${JSON.stringify(state, null, 2)}\n`;
    fileSystem.writeFileSync(temporary, bytes, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fileSystem.renameSync(temporary, resolved);
    const reread = fileSystem.readFileSync(resolved, 'utf8');
    if (reread !== bytes) {
      throw new Error('watch state reread did not match the bytes written');
    }
    return { path: resolved, digest: crypto.createHash('sha256').update(reread, 'utf8').digest('hex') };
  } finally {
    if (locked) {
      fileSystem.unlinkSync(lock);
    }
  }
}

export function loadWatchState(statePath, { fileSystem = fs } = {}) {
  const resolved = path.resolve(statePath);
  if (fileSystem.lstatSync(resolved).isSymbolicLink()) {
    throw new Error('watch state target must not be a symbolic link');
  }
  const state = JSON.parse(fileSystem.readFileSync(resolved, 'utf8'));
  if (state.schema !== WATCH_SCHEMA) {
    throw new Error(`unsupported watch state schema: ${state.schema}`);
  }
  if (state.integrityDigest !== stateIntegrity(state)) {
    throw new Error('watch state integrity digest does not match its content');
  }
  if (digest(state.observation?.identity) !== digest(state.targetIdentity)) {
    throw new Error('watch state observation identity does not match its immutable target');
  }
  const observationOnly = state.authority?.mode === 'observation-only';
  if (observationOnly) {
    if (state.authority.provenance !== 'operator-explicit-target' || !state.authority.owningParent
      || state.continuation !== null || state.inFlightShip || state.shipReceipts.length) {
      throw new Error('invalid observation-only authority or remediation state');
    }
  } else if (state.authority?.mode === 'ship-continuation') {
    normalizeContinuation(state.continuation, state.expectedHead);
    if (digest(identityFromContinuation(state.continuation)) !== digest(state.targetIdentity)) {
      throw new Error('watch state continuation identity does not match its immutable target');
    }
  } else {
    throw new Error('watch authority must be explicitly observation-only or ship-continuation');
  }
  validateObservation(state.observation, { observationOnly });
  if (state.observation.liveBase
    && (!liveBaseIsCurrent(state.observation.liveBase, {
      repository: state.targetIdentity.repository,
      baseBranch: state.observation.pullRequest.baseBranch,
    }) || state.observation.liveBase.sha !== state.observation.pullRequest.baseSha)) {
    throw new Error('watch state live base does not match its observed target');
  }
  return state;
}
