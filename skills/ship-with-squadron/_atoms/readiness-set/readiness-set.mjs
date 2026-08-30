import {
  compareObservation,
  isTerminalDisposition,
  normalizeUpToDatePolicy,
  validateFreshnessReceipt,
} from '../../../_base/_atoms/landability/landability.mjs';
import { assertFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  persistedPipelinePasses,
  persistedPublicationPipelinePasses,
  persistedShepherdPasses,
  validateReadinessObligation,
} from '../quality-evidence/quality-evidence.mjs';
import {
  normalizeChangeRequestRevisionObservation,
  normalizeMergeObservation,
} from '../provider-seam/provider-seam.mjs';
import { deriveFleetDisposition } from '../fleet-disposition/fleet-disposition.mjs';
import { computeFrontier } from '../dependency-frontier/dependency-frontier.mjs';
import {
  reconcileFrontier,
  verifyActiveAssignmentIdentities,
  verifyPersistedAssignmentRevisions,
  verifyPersistedGitWorktreeIdentity,
} from '../fleet-state/fleet-state.mjs';

const GREEN = new Set(['mergeable-and-green', 'no-op-mergeable-and-green']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validTimestamp(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function normalizeProvider(value) {
  return nonEmpty(value) ? value.trim().toLowerCase() : null;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function archiveSuccessfulAssignment(record, completion, manifest) {
  if (record.assignment === null || record.assignment === undefined) {
    if (record.status === 'active') {
      throw new Error('completed readiness cannot leave an active issue without assignment identity');
    }
    return;
  }
  verifyPersistedGitWorktreeIdentity(
    record.assignment.worktreeIdentity,
    manifest.repository.root,
    record.assignment.branch,
  );
  verifyPersistedAssignmentRevisions(
    manifest.repository.root,
    record.assignment.worktree,
    manifest.repository.baseBranch,
    record.assignment.baseSha,
    record.assignment.headSha,
  );
  const expectedKeys = ['generation', 'workerContext', 'baseSha', 'headSha', 'completedAt', 'resultDigest'];
  if (!completion
      || !same(Object.keys(completion).sort(), expectedKeys.sort())
      || completion.generation !== record.assignment.generation
      || completion.workerContext !== record.assignment.workerContext
      || completion.baseSha !== record.assignment.baseSha
      || completion.headSha !== record.assignment.headSha
      || !validTimestamp(completion.completedAt)
      || !/^[a-f0-9]{64}$/.test(completion.resultDigest)) {
    throw new Error('completed readiness requires exact validated assignment success identity');
  }
  record.continuationChain.push({
    ...record.assignment,
    active: false,
    endReason: 'completed',
    endedAt: completion.completedAt,
  });
  record.assignment = null;
}

function expectedFields(expected) {
  return [
    ['baseSha', expected?.baseSha],
    ['headSha', expected?.headSha],
  ];
}

export function acceptShepherdReturn(input, expected = {}) {
  const defects = [];
  const invocation = input?.invocation;
  if (!invocation || typeof invocation !== 'object') {
    defects.push('Shepherd invocation identity is absent');
  } else {
    if (invocation.skill !== 'shepherd') defects.push('Shepherd invocation skill is invalid');
    if (!nonEmpty(invocation.id)) defects.push('Shepherd invocation id is absent');
    if (invocation.runId !== expected.runId) defects.push('Shepherd invocation run identity does not match');
    if (invocation.issue !== expected.issue) defects.push('Shepherd invocation issue does not match');
    if (invocation.changeRequest !== expected.changeRequest) defects.push('Shepherd invocation change request does not match');
    if (invocation.mode !== 'nested-worker') defects.push('Shepherd was not invoked in a nested worker');
    if (invocation.freshContext !== true) defects.push('Shepherd worker context was not fresh');
    if (invocation.status !== 'returned') defects.push('Shepherd invocation did not return');
  }
  if (!isTerminalDisposition(input?.result?.disposition)) defects.push('Shepherd returned no terminal disposition');
  if (!input?.result || typeof input.result !== 'object'
      || !['disposition', 'reason', 'defects', 'receipt'].every((field) =>
        Object.hasOwn(input.result, field))
      || !Array.isArray(input.result.defects)) {
    defects.push('Shepherd result does not match the canonical report shape');
  } else if (input.result.defects.length > 0) {
    defects.push('Shepherd result reports unresolved defects');
  }
  const receipt = validateFreshnessReceipt(input?.result?.receipt);
  defects.push(...receipt.defects);
  if (!input?.result?.receipt
      || !Object.hasOwn(input.result.receipt, 'observedAt')
      || JSON.stringify(Object.keys(input.result.receipt).sort())
        !== JSON.stringify([
          'baseSha', 'complete', 'headSha', 'observedAt', 'provider', 'upToDatePolicy',
        ])) {
    defects.push('Shepherd freshness receipt is not the canonical landability receipt');
  }
  const normalizedReceiptProvider = normalizeProvider(input?.result?.receipt?.provider);
  for (const [field, value] of expectedFields(expected)) {
    const actual = input?.result?.receipt?.[field];
    if (!value || actual !== value) defects.push(`Shepherd receipt ${field} does not match`);
  }
  const freshness = receipt.valid
    ? compareObservation(input.result.receipt, input.observation)
    : { freshness: 'unobserved', drifted: [] };
  if (freshness.freshness !== 'fresh') defects.push(`Shepherd freshness is ${freshness.freshness}`);
  if (normalizeProvider(input?.observation?.provider) !== normalizeProvider(expected.provider)
      || input?.observation?.repository !== expected.repository
      || input?.observation?.changeRequest !== expected.changeRequest
      || input?.observation?.baseBranch !== expected.baseBranch
      || input?.observation?.baseSha !== expected.baseSha
      || input?.observation?.headSha !== expected.headSha) {
    defects.push('post-Shepherd observation identity does not match');
  }
  const policy = normalizeUpToDatePolicy(input?.result?.receipt?.upToDatePolicy);
  if (policy === 'unobserved') defects.push('up-to-date policy is unobserved');
  if (policy === 'required' && input?.observation?.containsCurrentBase !== true) {
    defects.push('strict up-to-date policy is not proven satisfied');
  }
  if (normalizedReceiptProvider !== 'supported-provider'
      || String(input?.result?.disposition ?? '').includes('provider-tool')) {
    defects.push('provider state is degraded or unobserved');
  }
  const generation = expected.obligationGeneration ?? 1;
  defects.push(...validateReadinessObligation(
    input?.setObligation,
    expected,
    generation,
    'invoke-fresh-shepherd',
    input?.observation?.observedAt,
  ));
  if (validTimestamp(expected.minimumObservedAt)
      && (Date.parse(input?.result?.receipt?.observedAt ?? '') <= Date.parse(expected.minimumObservedAt)
        || Date.parse(input?.observation?.observedAt ?? '') <= Date.parse(expected.minimumObservedAt))) {
    defects.push('Shepherd result predates the latest relevant merge watermark');
  }
  const ready = defects.length === 0 && GREEN.has(input.result.disposition);
  return {
    accepted: defects.length === 0,
    ready,
    disposition: input?.result?.disposition ?? 'blocked',
    receipt: input?.result?.receipt ?? null,
    freshness: freshness.freshness,
    defects,
    setObligation: input?.setObligation ?? null,
    invocationId: invocation?.id ?? null,
    invocation: invocation ? structuredClone(invocation) : null,
    observation: input?.observation ? structuredClone(input.observation) : null,
    terminal: isTerminalDisposition(input?.result?.disposition),
    complete: receipt.valid && input?.result?.defects?.length === 0,
  };
}

export function recordShepherdNotRequired(
  state,
  manifest,
  issueIdentity,
  obligation,
  assignmentCompletion = null,
) {
  assertFleetManifest(manifest);
  verifyActiveAssignmentIdentities(state, manifest);
  if (manifest.shepherdIntent !== 'no') throw new Error('Shepherd-not-required requires manifest intent no');
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('Shepherd-not-required state is not bound to the confirmed manifest');
  }
  const record = state.issues?.[issueIdentity];
  if (!record?.changeRequest) throw new Error('Shepherd-not-required requires confirmed publication');
  const semantic = persistedPublicationPipelinePasses(record, state, manifest);
  if (!semantic.passed) {
    throw new Error(`Shepherd-not-required requires passing current evidence: ${semantic.defects.join('; ')}`);
  }
  const expected = {
    issue: issueIdentity,
    provider: manifest.provider.name,
    repository: manifest.repository.id,
    changeRequest: record.changeRequest.identifier,
    publicationKey: record.changeRequest.publicationKey,
    baseBranch: manifest.repository.baseBranch,
    baseSha: record.baseSha,
    headSha: record.headSha,
  };
  const publication = state.publications.find((entry) =>
    entry.key === record.changeRequest.publicationKey
    && entry.identifier === record.changeRequest.identifier);
  const publicationObservation = publication?.observations?.find((entry) =>
    entry.state === 'confirmed'
    && entry.baseSha === record.baseSha
    && entry.headSha === record.headSha);
  const generation = record.readinessGeneration + 1;
  const defects = validateReadinessObligation(
    obligation,
    expected,
    generation,
    'rerun-quality-and-provider-observation',
    publicationObservation?.confirmedAt ?? null,
  );
  if (defects.length) throw new Error(`invalid Shepherd-not-required obligation: ${defects.join('; ')}`);
  const next = structuredClone(state);
  archiveSuccessfulAssignment(next.issues[issueIdentity], assignmentCompletion, manifest);
  next.issues[issueIdentity].shepherd = null;
  next.issues[issueIdentity].shepherdDecision = {
    state: 'not-required',
    reason: 'manifest-shepherd-intent-no',
    manifestDigest: manifest.digest,
    recordedAt: obligation.createdAt,
  };
  next.issues[issueIdentity].setObligation = structuredClone(obligation);
  next.issues[issueIdentity].readinessGeneration = generation;
  next.issues[issueIdentity].status = 'completed';
  next.issues[issueIdentity].dependencyState = 'unclassified';
  next.issues[issueIdentity].terminalDisposition = 'ready-for-human-merge';
  next.issues[issueIdentity].nextAction = 'await-human-merge';
  next.issues[issueIdentity].checkActivity = null;
  next.events.push({ type: 'shepherd-not-required', issue: issueIdentity });
  next.fleetDisposition = deriveFleetDisposition(next, manifest);
  return reconcileFrontier(next, manifest, computeFrontier(manifest, next));
}

function currentRevision(state, manifest, revisions, issue, mergeObservation) {
  const revision = normalizeChangeRequestRevisionObservation(
    state,
    manifest,
    revisions?.[issue],
  );
  if (Date.parse(revision.observedAt) <= Date.parse(mergeObservation.observedAt)) {
    throw new Error(`current revision observation predates the triggering merge for ${issue}`);
  }
  return revision;
}

function clearMatchingShepherdActivity(record, generation, states) {
  if (record.checkActivity === null) return;
  if (record.checkActivity.kind !== 'shepherd-check'
      || record.checkActivity.generation !== generation
      || !states.includes(record.checkActivity.state)) {
    throw new Error('Shepherd check activity does not match the affected readiness generation');
  }
  record.checkActivity = null;
}

function bindRevisionToSafeRecord(record, queue, revision, manifest) {
  if (record.status === 'active' || record.assignment?.active === true) {
    Object.assign(queue, {
      baseSha: revision.baseSha,
      headSha: revision.headSha,
      revisionObservation: structuredClone(revision),
      blocker: 'active-assignment-revision-transition-required',
      action: 'await-safe-ownership-transition',
    });
    record.nextAction = 'complete-or-handoff-active-assignment-before-readiness-rebind';
    return false;
  }
  record.baseSha = revision.baseSha;
  record.headSha = revision.headSha;
  record.changeRequest = null;
  clearMatchingShepherdActivity(record, queue.generation, ['blocked']);
  record.nextAction = manifest.shepherdIntent === 'yes'
    ? 'consume-fresh-re-shepherd-receipt'
    : 'rerun-quality-and-provider-observation';
  Object.assign(queue, {
    baseSha: revision.baseSha,
    headSha: revision.headSha,
    revisionObservation: structuredClone(revision),
    blocker: null,
    action: manifest.shepherdIntent === 'yes'
      ? 'invoke-fresh-shepherd'
      : 'rerun-quality-and-provider-observation',
  });
  return true;
}

export function expireReadinessAfterSiblingMerge(
  state,
  manifest,
  mergeObservation,
  revisions,
  now = new Date().toISOString(),
) {
  assertFleetManifest(manifest);
  verifyActiveAssignmentIdentities(state, manifest);
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('readiness expiry state is not bound to the confirmed manifest');
  }
  if (!validTimestamp(now)) throw new Error('readiness expiry time is invalid');
  mergeObservation = normalizeMergeObservation(state, manifest, mergeObservation);
  if (mergeObservation?.observed !== true
      || mergeObservation.provider !== manifest.provider.name
      || mergeObservation.repository !== manifest.repository.id
      || mergeObservation.baseBranch !== manifest.repository.baseBranch
      || !nonEmpty(mergeObservation.publicationKey)
      || !nonEmpty(mergeObservation.mergeCommit)
      || !validTimestamp(mergeObservation.observedAt)
      || Date.parse(now) < Date.parse(mergeObservation.observedAt)) {
    throw new Error('readiness expiry requires an exact reconciled human merge observation');
  }
  const publication = state.publications?.find((entry) =>
    entry.key === mergeObservation.publicationKey
    && entry.provider === mergeObservation.provider
    && entry.repository === mergeObservation.repository
    && entry.issue === mergeObservation.issue
    && entry.identifier === mergeObservation.changeRequest
    && entry.baseBranch === mergeObservation.baseBranch
    && entry.headBranch === mergeObservation.headBranch
    && entry.observations?.some((observation) =>
      observation.state === 'confirmed'
      && observation.baseSha === mergeObservation.baseSha
      && observation.headSha === mergeObservation.headSha));
  if (!publication) {
    throw new Error('readiness expiry merge is not reconciled to recorded publication');
  }
  const duplicate = state.observedHumanMerges.some((entry) =>
    entry.publicationKey === mergeObservation.publicationKey
    && entry.mergeCommit === mergeObservation.mergeCommit);
  if (duplicate) return structuredClone(state);
  const next = structuredClone(state);
  next.observedHumanMerges.push(structuredClone(mergeObservation));
  next.reShepherdQueue = next.reShepherdQueue.filter(
    (entry) => entry.issue !== mergeObservation.issue,
  );
  const mergedRecord = next.issues[mergeObservation.issue];
  if (mergedRecord) {
    mergedRecord.status = 'completed';
    mergedRecord.dependencyState = 'unclassified';
    mergedRecord.terminalDisposition = 'ready-for-human-merge';
    mergedRecord.nextAction = null;
    mergedRecord.checkActivity = null;
  }
  const affected = [];
  for (const record of Object.values(next.issues)) {
    const existingQueue = next.reShepherdQueue.find((entry) => entry.issue === record.identity);
    const recordedPublication = next.publications.find((entry) =>
      entry.issue === record.identity && entry.identifier !== null);
    const recordChangeRequest = record.changeRequest?.identifier
      ?? existingQueue?.changeRequest
      ?? recordedPublication?.identifier;
    const recordPublicationKey = record.changeRequest?.publicationKey
      ?? existingQueue?.publicationKey
      ?? recordedPublication?.key;
    if (!recordChangeRequest || recordChangeRequest === mergeObservation.changeRequest) continue;
    const recordPublication = next.publications.find((entry) =>
      entry.key === recordPublicationKey && entry.identifier === recordChangeRequest);
    if (!recordPublication || recordPublication.baseBranch !== mergeObservation.baseBranch) continue;
    if (next.observedHumanMerges.some((entry) =>
      entry.issue === record.identity
      && entry.changeRequest === recordChangeRequest)) continue;
    const siblingPublication = next.publications.find((entry) =>
      entry.key === recordPublicationKey
      && entry.identifier === recordChangeRequest);
    if (!siblingPublication) throw new Error(`published sibling ${record.identity} has no stable publication`);
    const priorGeneration = existingQueue?.generation
      ?? record.shepherd?.setObligation?.generation
      ?? record.setObligation?.generation
      ?? record.checkActivity?.generation
      ?? record.readinessGeneration
      ?? 0;
    const generation = priorGeneration + 1;
    const changeRequest = recordChangeRequest;
    const publicationKey = recordPublicationKey;
    const priorReadiness = record.shepherd?.accepted === true
      ? record.shepherd
      : record.setObligation
        ? { setObligation: record.setObligation }
        : null;
    if (record.shepherd?.accepted === true) {
      record.shepherd = {
        accepted: false,
        ready: false,
        freshness: 'expired',
        expiredAt: now,
        reason: `sibling-merge:${mergeObservation.changeRequest}`,
        generation,
      };
    } else {
      record.shepherd = null;
    }
    const preservesActiveOwnership = record.status === 'active' && record.assignment?.active === true;
    record.status = preservesActiveOwnership ? 'active' : 'blocked';
    record.dependencyState = preservesActiveOwnership ? 'active' : 'blocked';
    record.pipeline = [];
    record.shepherdDecision = null;
    record.setObligation = null;
    record.checkActivity = preservesActiveOwnership
      ? {
        kind: 'shepherd-check',
        state: 'blocked',
        startedAt: record.checkActivity?.startedAt ?? now,
        generation,
        blocker: 'sibling-merge-watermark',
      }
      : null;
    record.readinessGeneration = generation;
    record.readinessWatermark = {
      generation,
      observedAt: mergeObservation.observedAt,
      triggeringPublicationKey: mergeObservation.publicationKey,
      triggeringMergeCommit: mergeObservation.mergeCommit,
    };
    record.terminalDisposition = preservesActiveOwnership ? null : 'blocked';
    record.nextAction = 'acquire-current-change-request-revision';
    const expiry = {
      issue: record.identity,
      changeRequest,
      publicationKey,
      reason: `sibling-merge:${mergeObservation.changeRequest}`,
      oldBaseSha: priorReadiness?.receipt?.baseSha
        ?? priorReadiness?.setObligation?.baseSha
        ?? null,
      currentBaseSha: null,
      currentHeadSha: null,
      generation,
      expiredAt: now,
      sourceStateRevision: state.revision,
      triggeringPublicationKey: mergeObservation.publicationKey,
      triggeringMergeCommit: mergeObservation.mergeCommit,
      revisionObservation: null,
    };
    next.expiredReadinessClaims.push(expiry);
    next.reShepherdQueue = next.reShepherdQueue.filter((entry) => entry.issue !== record.identity);
    next.reShepherdQueue.push({
      issue: record.identity,
      changeRequest,
      publicationKey,
      reason: expiry.reason,
      generation,
      baseSha: null,
      headSha: null,
      sourceStateRevision: state.revision,
      triggeringPublicationKey: mergeObservation.publicationKey,
      triggeringMergeCommit: mergeObservation.mergeCommit,
      mergeObservedAt: mergeObservation.observedAt,
      revisionObservation: null,
      blocker: 'change-request-revision-evidence-unavailable',
      queuedAt: now,
      action: 'acquire-current-change-request-revision',
    });
    affected.push({
      issue: record.identity,
      publication: siblingPublication,
      expiryIndex: next.expiredReadinessClaims.length - 1,
      generation,
    });
  }
  for (const target of affected) {
    const record = next.issues[target.issue];
    const queue = next.reShepherdQueue.find((entry) => entry.issue === target.issue);
    try {
      const revision = currentRevision(
        next,
        manifest,
        revisions,
        target.issue,
        mergeObservation,
      );
      bindRevisionToSafeRecord(record, queue, revision, manifest);
      Object.assign(next.expiredReadinessClaims[target.expiryIndex], {
        currentBaseSha: revision.baseSha,
        currentHeadSha: revision.headSha,
        revisionObservation: structuredClone(revision),
      });
    } catch (error) {
      queue.blocker = `change-request-revision-evidence-unavailable:${error.message}`;
      next.events.push({
        type: 'readiness-revision-blocked',
        issue: target.issue,
        generation: queue.generation,
        reason: error.message,
      });
    }
  }
  next.fleetDisposition = deriveFleetDisposition(next, manifest);
  return reconcileFrontier(next, manifest, computeFrontier(manifest, next));
}

export function recordReadinessRevisionObservation(
  state,
  manifest,
  issueIdentity,
  observation,
) {
  assertFleetManifest(manifest);
  verifyActiveAssignmentIdentities(state, manifest);
  const queue = state.reShepherdQueue.find((entry) => entry.issue === issueIdentity);
  if (!queue || queue.action !== 'acquire-current-change-request-revision') {
    throw new Error(`no blocked revision acquisition for ${issueIdentity}`);
  }
  const revision = normalizeChangeRequestRevisionObservation(state, manifest, observation);
  if (revision.changeRequest !== queue.changeRequest
      || revision.publicationKey !== queue.publicationKey
      || Date.parse(revision.observedAt) <= Date.parse(queue.mergeObservedAt)) {
    throw new Error('revision observation does not satisfy the queued merge watermark');
  }
  const next = structuredClone(state);
  const target = next.reShepherdQueue.find((entry) => entry.issue === issueIdentity);
  const record = next.issues[issueIdentity];
  const applied = bindRevisionToSafeRecord(record, target, revision, manifest);
  const expiry = [...next.expiredReadinessClaims].reverse().find((entry) =>
    entry.issue === issueIdentity && entry.generation === target.generation);
  if (expiry) {
    expiry.currentBaseSha = revision.baseSha;
    expiry.currentHeadSha = revision.headSha;
    expiry.revisionObservation = structuredClone(revision);
  }
  next.events.push({
    type: applied ? 'readiness-revision-observed' : 'readiness-revision-queued',
    issue: issueIdentity,
    generation: target.generation,
  });
  return reconcileFrontier(next, manifest, computeFrontier(manifest, next));
}

export function activateQueuedReadinessRevision(
  state,
  manifest,
  issueIdentity,
) {
  assertFleetManifest(manifest);
  verifyActiveAssignmentIdentities(state, manifest);
  const queue = state.reShepherdQueue.find((entry) => entry.issue === issueIdentity);
  const record = state.issues?.[issueIdentity];
  if (!queue
      || queue.action !== 'await-safe-ownership-transition'
      || queue.blocker !== 'active-assignment-revision-transition-required'
      || queue.revisionObservation === null) {
    throw new Error(`no queued ownership-safe revision transition for ${issueIdentity}`);
  }
  if (record?.status === 'active' || record?.assignment !== null) {
    throw new Error('queued readiness revision cannot activate while mutable ownership remains');
  }
  const next = structuredClone(state);
  const target = next.reShepherdQueue.find((entry) => entry.issue === issueIdentity);
  const targetRecord = next.issues[issueIdentity];
  bindRevisionToSafeRecord(targetRecord, target, target.revisionObservation, manifest);
  next.events.push({
    type: 'readiness-revision-activated',
    issue: issueIdentity,
    generation: target.generation,
  });
  return reconcileFrontier(next, manifest, computeFrontier(manifest, next));
}

export function consumeReShepherdQueue(
  state,
  manifest,
  issueIdentity,
  accepted,
  revalidation,
  assignmentCompletion = null,
) {
  assertFleetManifest(manifest);
  verifyActiveAssignmentIdentities(state, manifest);
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('re-Shepherd state is not bound to the confirmed manifest');
  }
  const queue = state.reShepherdQueue.find((entry) => entry.issue === issueIdentity);
  if (!queue) throw new Error(`no re-Shepherd obligation for ${issueIdentity}`);
  if (['failed', 'timed-out', 'deferred'].includes(state.issues[issueIdentity]?.status)) {
    throw new Error('terminal issue cannot consume a re-Shepherd obligation');
  }
  if (queue.blocker !== null || queue.revisionObservation === null) {
    throw new Error('re-Shepherd remains blocked on current revision evidence');
  }
  if (!accepted?.accepted || !accepted.ready
      || accepted.receipt?.baseSha !== queue.baseSha
      || accepted.receipt?.headSha !== queue.headSha
      || accepted.setObligation?.generation !== queue.generation
      || !validTimestamp(accepted.receipt?.observedAt)
      || Date.parse(accepted.receipt.observedAt) <= Date.parse(queue.revisionObservation.observedAt)
      || Date.parse(accepted.observation?.observedAt ?? '')
        <= Date.parse(state.issues[issueIdentity].readinessWatermark?.observedAt ?? '')) {
    throw new Error('fresh accepted Shepherd receipt does not satisfy queued generation and revisions');
  }
  const publication = state.publications.find((entry) =>
    entry.key === queue.publicationKey
    && entry.identifier === queue.changeRequest
    && entry.observations?.some((observation) =>
      observation.state === 'confirmed'
      && observation.baseSha === queue.baseSha
      && observation.headSha === queue.headSha));
  if (!publication || state.issues[issueIdentity].changeRequest?.identifier !== queue.changeRequest) {
    throw new Error('fresh Shepherd receipt requires current revision publication reconciliation');
  }
  const shepherdSemantic = persistedShepherdPasses({
    ...state.issues[issueIdentity],
    shepherd: accepted,
    setObligation: accepted.setObligation,
  }, state, manifest);
  if (!shepherdSemantic.passed) {
    throw new Error(`fresh Shepherd persisted evidence is incomplete: ${shepherdSemantic.defects.join('; ')}`);
  }
  const candidate = {
    ...state.issues[issueIdentity],
    pipeline: revalidation?.pipeline ?? [],
  };
  const semantic = persistedPublicationPipelinePasses(candidate, state, manifest);
  if (!semantic.passed
      || revalidation?.status !== 'completed'
      || revalidation?.terminal !== true
      || revalidation?.complete !== true
      || !validTimestamp(revalidation?.completedAt)
      || Date.parse(revalidation.completedAt) <= Date.parse(queue.revisionObservation.observedAt)) {
    throw new Error(`fresh Shepherd prerequisite revalidation is incomplete: ${semantic.defects.join('; ')}`);
  }
  const next = structuredClone(state);
  archiveSuccessfulAssignment(next.issues[issueIdentity], assignmentCompletion, manifest);
  next.issues[issueIdentity].pipeline = structuredClone(revalidation.pipeline);
  next.issues[issueIdentity].shepherd = structuredClone(accepted);
  next.issues[issueIdentity].setObligation = structuredClone(accepted.setObligation);
  next.issues[issueIdentity].pipeline.push({
    stage: 'shepherd',
    evidence: structuredClone(accepted.receipt),
  });
  next.issues[issueIdentity].terminalDisposition = 'ready-for-human-merge';
  next.issues[issueIdentity].status = 'completed';
  next.issues[issueIdentity].dependencyState = 'unclassified';
  next.issues[issueIdentity].nextAction = 'await-human-merge';
  clearMatchingShepherdActivity(next.issues[issueIdentity], queue.generation, ['active']);
  next.reShepherdQueue = next.reShepherdQueue.filter((entry) => entry.issue !== issueIdentity);
  next.events.push({
    type: 're-shepherd-receipt-consumed',
    issue: issueIdentity,
    generation: queue.generation,
  });
  next.fleetDisposition = deriveFleetDisposition(next, manifest);
  return reconcileFrontier(next, manifest, computeFrontier(manifest, next));
}

export function consumeNoShepherdRevalidation(
  state,
  manifest,
  issueIdentity,
  revalidation,
  obligation,
  assignmentCompletion = null,
) {
  assertFleetManifest(manifest);
  verifyActiveAssignmentIdentities(state, manifest);
  if (manifest.shepherdIntent !== 'no') throw new Error('no-Shepherd revalidation requires manifest intent no');
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('no-Shepherd state is not bound to the confirmed manifest');
  }
  const queue = state.reShepherdQueue.find((entry) => entry.issue === issueIdentity);
  if (!queue || queue.action !== 'rerun-quality-and-provider-observation') {
    throw new Error(`no no-Shepherd revalidation obligation for ${issueIdentity}`);
  }
  if (['failed', 'timed-out', 'deferred'].includes(state.issues[issueIdentity]?.status)) {
    throw new Error('terminal issue cannot consume a no-Shepherd revalidation obligation');
  }
  if (revalidation?.status !== 'completed'
      || revalidation?.terminal !== true
      || revalidation?.complete !== true
      || revalidation?.issue !== issueIdentity
      || revalidation?.changeRequest !== queue.changeRequest
      || revalidation?.baseSha !== queue.baseSha
      || revalidation?.headSha !== queue.headSha
      || !Array.isArray(revalidation?.pipeline)
      || revalidation.pipeline.length === 0
      || revalidation.pipeline.at(-1)?.stage !== 'publication'
      || !validTimestamp(revalidation?.completedAt)
      || Date.parse(revalidation.completedAt) <= Date.parse(queue.revisionObservation.observedAt)
      || revalidation.pipeline.some((entry) => {
        const evidenceRevision = entry.stage === 'blast-radius-proof'
          ? entry.evidence?.revisions
          : entry.evidence;
        return evidenceRevision?.baseSha !== queue.baseSha
          || evidenceRevision?.headSha !== queue.headSha;
      })) {
    throw new Error('no-Shepherd revalidation evidence is incomplete or stale');
  }
  const expected = {
    issue: issueIdentity,
    provider: manifest.provider.name,
    repository: manifest.repository.id,
    changeRequest: queue.changeRequest,
    publicationKey: queue.publicationKey,
    baseBranch: manifest.repository.baseBranch,
    baseSha: queue.baseSha,
    headSha: queue.headSha,
  };
  const defects = validateReadinessObligation(
    obligation,
    expected,
    queue.generation,
    'rerun-quality-and-provider-observation',
    revalidation.completedAt,
  );
  if (defects.length) throw new Error(`invalid no-Shepherd set obligation: ${defects.join('; ')}`);
  const candidateRecord = {
    ...state.issues[issueIdentity],
    baseSha: queue.baseSha,
    headSha: queue.headSha,
    pipeline: revalidation.pipeline,
  };
  const semantic = persistedPipelinePasses(candidateRecord, state, manifest);
  if (!semantic.passed) {
    throw new Error(`no-Shepherd revalidation does not semantically pass: ${semantic.defects.join('; ')}`);
  }
  const next = structuredClone(state);
  const record = next.issues[issueIdentity];
  archiveSuccessfulAssignment(record, assignmentCompletion, manifest);
  record.baseSha = queue.baseSha;
  record.headSha = queue.headSha;
  record.pipeline = structuredClone(revalidation.pipeline);
  record.shepherd = null;
  record.shepherdDecision = {
    state: 'not-required',
    reason: 'manifest-shepherd-intent-no',
    manifestDigest: manifest.digest,
    recordedAt: obligation.createdAt,
  };
  record.setObligation = structuredClone(obligation);
  record.terminalDisposition = 'ready-for-human-merge';
  record.status = 'completed';
  record.dependencyState = 'unclassified';
  record.nextAction = 'await-human-merge';
  record.checkActivity = null;
  next.reShepherdQueue = next.reShepherdQueue.filter((entry) => entry.issue !== issueIdentity);
  next.events.push({
    type: 'no-shepherd-revalidation-consumed',
    issue: issueIdentity,
    generation: queue.generation,
  });
  next.fleetDisposition = deriveFleetDisposition(next, manifest);
  return reconcileFrontier(next, manifest, computeFrontier(manifest, next));
}
