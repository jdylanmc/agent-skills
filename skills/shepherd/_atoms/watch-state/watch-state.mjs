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
    attempt: Number.isInteger(check.attempt) && check.attempt > 0 ? check.attempt : null,
    headSha: check.headSha === undefined || check.headSha === null ? null : String(check.headSha),
    required: check.required === true,
    status: String(check.status),
    url: check.url === undefined || check.url === null ? null : String(check.url),
  })).sort((a, b) => digest(a).localeCompare(digest(b)));
}

export function reviewProbeCommand(detection, target) {
  return reviewThreadsCommand(detection, target);
}

export function reviewProbeLatestPageCommand(detection, target, page) {
  return latestReviewsCommand(detection, target, page);
}

export function reviewProbeThreadPageCommand(detection, target, page) {
  return threadCommentsCommand(detection, target, page);
}

export function normalizeObservation(observation = {}) {
  return canonical({
    identity: {
      provider: observation.identity?.provider ?? null,
      repository: observation.identity?.repository ?? null,
      changeRequest: observation.identity?.changeRequest ?? null,
      issue: observation.identity?.issue ?? null,
      branch: observation.identity?.branch ?? null,
    },
    pullRequest: {
      state: observation.pullRequest?.state ?? null,
      baseBranch: observation.pullRequest?.baseBranch ?? null,
      baseSha: observation.pullRequest?.baseSha ?? null,
      headSha: observation.pullRequest?.headSha ?? null,
      mergeState: observation.pullRequest?.mergeState ?? null,
      mergeStateStatus: observation.pullRequest?.mergeStateStatus ?? null,
      blocked: observation.pullRequest?.blocked ?? null,
      behind: observation.pullRequest?.behind ?? null,
      isDraft: observation.pullRequest?.isDraft ?? null,
      upToDatePolicy: observation.pullRequest?.upToDatePolicy ?? 'unobserved',
      reviewDecision: observation.pullRequest?.reviewDecision ?? null,
    },
    review: {
      observed: observation.review?.observed === true,
      complete: observation.review?.complete === true,
      identityBound: observation.review?.identityBound === true,
      observationDigest: observation.review?.observationDigest ?? null,
    },
    checks: normalizedChecks(observation.checks),
    ownership: {
      branchOwned: observation.ownership?.branchOwned === true,
      providerAvailable: observation.ownership?.providerAvailable === true,
      evidenceComplete: observation.ownership?.evidenceComplete === true,
    },
  });
}

function validateObservation(observation, { initial = false } = {}) {
  for (const [field, value] of Object.entries(observation.identity)) {
    nonEmpty(value, `identity.${field}`);
  }
  if (!['open', 'merged', 'closed'].includes(observation.pullRequest.state)) {
    throw new Error('pull request state must be open, merged, or closed');
  }
  objectId(observation.pullRequest.baseSha, 'base head');
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
  if (initial && (!observation.review.observed
    || !observation.review.complete
    || !observation.review.identityBound
    || !/^[0-9a-f]{64}$/.test(observation.review.observationDigest ?? ''))) {
    throw new Error('review observation must be complete, identity-bound, and digest-bound');
  }
  if (!initial && observation.review.complete
    && !/^[0-9a-f]{64}$/.test(observation.review.observationDigest ?? '')) {
    throw new Error('a complete review observation must be digest-bound');
  }
  if (initial && (!observation.ownership.branchOwned
    || !observation.ownership.providerAvailable
    || !observation.ownership.evidenceComplete)) {
    throw new Error('provider, ownership, and evidence must be available');
  }
  for (const check of observation.checks) {
    nonEmpty(check.name, 'check name');
    nonEmpty(check.status, 'check status');
    if (check.headSha !== observation.pullRequest.headSha) {
      throw new Error('every check must be bound to the observed head');
    }
    if (check.required && check.status === 'failure'
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
  return digest(normalizeObservation(observation));
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
  for (const key of ['identity', 'pullRequest', 'review', 'checks', 'ownership']) {
    if (digest(previous?.[key] ?? null) !== digest(current?.[key] ?? null)) {
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

export function createWatchState({ observation, observedAt, continuation }) {
  const normalized = validateObservation(normalizeObservation(observation), { initial: true });
  const expectedHead = objectId(normalized.pullRequest.headSha, 'observed head');
  const normalizedContinuation = normalizeContinuation(continuation, expectedHead);
  if (digest(normalized.identity) !== digest(identityFromContinuation(normalizedContinuation))) {
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
    observationDigest: digest(normalized),
    targetIdentity: normalized.identity,
    expectedHead,
    continuation: normalizedContinuation,
    handledEvidenceKeys: [...new Set([
      ...handledFromPrior(normalizedContinuation.priorDeliveryEvidence),
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
  if (instant(observedAt, 'observedAt') < instant(state.lastObservedAt, 'lastObservedAt')) {
    throw new Error('observation time must not move backward');
  }
  const normalized = validateObservation(normalizeObservation(observation));
  if (digest(normalized.identity) !== digest(state.targetIdentity)) {
    return stopWatch(state, { reason: 'ownership-failure', stoppedAt: observedAt });
  }
  if (normalized.pullRequest.headSha !== state.expectedHead) {
    return stopWatch(state, { reason: 'ownership-failure', stoppedAt: observedAt });
  }
  const nextDigest = digest(normalized);
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
    for (const check of state.observation.checks.filter((item) => item.required && item.status === 'failure')) {
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
  leaseVerified,
  continuation,
  recordedAt,
}) {
  if (previousHead !== state.expectedHead || !resultingHead || leaseVerified !== true) {
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
      leaseVerified: true,
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
  if (!ownership.branchOwned) return { action: 'stop', reason: 'ownership-failure' };
  if (!ownership.evidenceComplete || !review.observed || !review.complete || !review.identityBound) {
    return { action: 'stop', reason: 'evidence-failure' };
  }
  if (!state.lastChange.meaningful) {
    return { action: 'wait', reason: 'unchanged', nextPollAt: state.nextPollAt };
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
  if (state.inFlightShip || !Array.isArray(evidence) || evidence.length === 0) {
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
} = {}) {
  const accepted = workerStatus === 'running'
    && digest(acceptedIdentity) === digest(state.targetIdentity)
    && acceptedStateDigest === state.integrityDigest
    && isTerminalDisposition(disposition)
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
        watch: {
          status: 'watch-accepted',
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
  normalizeContinuation(state.continuation, state.expectedHead);
  if (digest(identityFromContinuation(state.continuation)) !== digest(state.targetIdentity)) {
    throw new Error('watch state continuation identity does not match its immutable target');
  }
  validateObservation(state.observation);
  return state;
}
