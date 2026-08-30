import {
  compareObservation,
  isTerminalDisposition,
  normalizeUpToDatePolicy,
  validateFreshnessReceipt,
} from '../../../_base/_atoms/landability/landability.mjs';
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

function expectedFields(expected) {
  return [
    ['provider', normalizeProvider(expected?.provider)],
    ['changeRequest', expected?.changeRequest],
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
  if (input?.result?.terminal !== true || input?.result?.complete !== true) {
    defects.push('Shepherd result is not complete and terminal');
  }
  const receipt = validateFreshnessReceipt(input?.result?.receipt);
  defects.push(...receipt.defects);
  const normalizedReceiptProvider = normalizeProvider(input?.result?.receipt?.provider);
  for (const [field, value] of expectedFields(expected)) {
    const actual = field === 'provider' ? normalizedReceiptProvider : input?.result?.receipt?.[field];
    if (!value || actual !== value) defects.push(`Shepherd receipt ${field} does not match`);
  }
  if (input?.result?.receipt?.repository !== expected.repository
      || input?.result?.receipt?.baseBranch !== expected.baseBranch) {
    defects.push('Shepherd receipt repository/base branch does not match');
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
  if (normalizedReceiptProvider === null || normalizedReceiptProvider.includes('unobserved')
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
    terminal: input?.result?.terminal === true,
    complete: input?.result?.complete === true,
  };
}

export function recordShepherdNotRequired(state, manifest, issueIdentity, obligation) {
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
  next.events.push({ type: 'shepherd-not-required', issue: issueIdentity });
  next.fleetDisposition = deriveFleetDisposition(next, manifest);
  return next;
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

export function expireReadinessAfterSiblingMerge(
  state,
  manifest,
  mergeObservation,
  revisions,
  now = new Date().toISOString(),
) {
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
    if (record.shepherd) {
      record.shepherd.ready = false;
      record.shepherd.freshness = 'stale';
      record.shepherd.accepted = false;
    }
    record.status = 'blocked';
    record.dependencyState = 'blocked';
    record.pipeline = [];
    record.shepherdDecision = null;
    record.setObligation = null;
    record.checkActivity = null;
    record.readinessGeneration = generation;
    record.readinessWatermark = {
      generation,
      observedAt: mergeObservation.observedAt,
      triggeringPublicationKey: mergeObservation.publicationKey,
      triggeringMergeCommit: mergeObservation.mergeCommit,
    };
    record.terminalDisposition = 'blocked';
    record.nextAction = 'acquire-current-change-request-revision';
    const expiry = {
      issue: record.identity,
      changeRequest,
      publicationKey,
      reason: `sibling-merge:${mergeObservation.changeRequest}`,
      oldBaseSha: record.shepherd?.receipt?.baseSha ?? record.setObligation?.baseSha ?? null,
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
      record.baseSha = revision.baseSha;
      record.headSha = revision.headSha;
      record.changeRequest = null;
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
  return next;
}

export function recordReadinessRevisionObservation(
  state,
  manifest,
  issueIdentity,
  observation,
) {
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
  Object.assign(target, {
    baseSha: revision.baseSha,
    headSha: revision.headSha,
    revisionObservation: structuredClone(revision),
    blocker: null,
    action: manifest.shepherdIntent === 'yes'
      ? 'invoke-fresh-shepherd'
      : 'rerun-quality-and-provider-observation',
  });
  const record = next.issues[issueIdentity];
  record.baseSha = revision.baseSha;
  record.headSha = revision.headSha;
  record.changeRequest = null;
  record.nextAction = manifest.shepherdIntent === 'yes'
    ? 'consume-fresh-re-shepherd-receipt'
    : 'rerun-quality-and-provider-observation';
  const expiry = [...next.expiredReadinessClaims].reverse().find((entry) =>
    entry.issue === issueIdentity && entry.generation === target.generation);
  if (expiry) {
    expiry.currentBaseSha = revision.baseSha;
    expiry.currentHeadSha = revision.headSha;
    expiry.revisionObservation = structuredClone(revision);
  }
  next.events.push({
    type: 'readiness-revision-observed',
    issue: issueIdentity,
    generation: target.generation,
  });
  return next;
}

export function consumeReShepherdQueue(state, manifest, issueIdentity, accepted, revalidation) {
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('re-Shepherd state is not bound to the confirmed manifest');
  }
  const queue = state.reShepherdQueue.find((entry) => entry.issue === issueIdentity);
  if (!queue) throw new Error(`no re-Shepherd obligation for ${issueIdentity}`);
  if (queue.blocker !== null || queue.revisionObservation === null) {
    throw new Error('re-Shepherd remains blocked on current revision evidence');
  }
  if (!accepted?.accepted || !accepted.ready
      || accepted.receipt?.baseSha !== queue.baseSha
      || accepted.receipt?.headSha !== queue.headSha
      || accepted.receipt?.changeRequest !== queue.changeRequest
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
  next.reShepherdQueue = next.reShepherdQueue.filter((entry) => entry.issue !== issueIdentity);
  next.events.push({
    type: 're-shepherd-receipt-consumed',
    issue: issueIdentity,
    generation: queue.generation,
  });
  next.fleetDisposition = deriveFleetDisposition(next, manifest);
  return next;
}

export function consumeNoShepherdRevalidation(state, manifest, issueIdentity, revalidation, obligation) {
  if (manifest.shepherdIntent !== 'no') throw new Error('no-Shepherd revalidation requires manifest intent no');
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('no-Shepherd state is not bound to the confirmed manifest');
  }
  const queue = state.reShepherdQueue.find((entry) => entry.issue === issueIdentity);
  if (!queue || queue.action !== 'rerun-quality-and-provider-observation') {
    throw new Error(`no no-Shepherd revalidation obligation for ${issueIdentity}`);
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
      || revalidation.pipeline.some((entry) =>
        entry.evidence?.baseSha !== queue.baseSha || entry.evidence?.headSha !== queue.headSha)) {
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
  next.reShepherdQueue = next.reShepherdQueue.filter((entry) => entry.issue !== issueIdentity);
  next.events.push({
    type: 'no-shepherd-revalidation-consumed',
    issue: issueIdentity,
    generation: queue.generation,
  });
  next.fleetDisposition = deriveFleetDisposition(next, manifest);
  return next;
}
