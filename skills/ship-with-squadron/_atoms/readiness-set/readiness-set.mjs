import {
  compareObservation,
  isTerminalDisposition,
  normalizeUpToDatePolicy,
  validateFreshnessReceipt,
} from '../../../_base/_atoms/landability/landability.mjs';

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

function validateSetObligation(obligation, expected, generation, reinvocation = 'invoke-fresh-shepherd') {
  const defects = [];
  if (!obligation || typeof obligation !== 'object') return ['set obligation is absent'];
  if (obligation.owner !== expected.issue) defects.push('set obligation owner does not match issue');
  if (obligation.changeRequest !== expected.changeRequest) defects.push('set obligation change request does not match');
  if (obligation.baseBranch !== expected.baseBranch) defects.push('set obligation base branch does not match');
  if (obligation.baseSha !== expected.baseSha) defects.push('set obligation base revision does not match');
  if (obligation.headSha !== expected.headSha) defects.push('set obligation head revision does not match');
  if (obligation.expiresWhen !== 'sibling-merge-into-base') defects.push('set obligation expiry is invalid');
  if (obligation.reinvocation !== reinvocation) defects.push('set obligation reinvocation is invalid');
  if (obligation.generation !== generation) defects.push('set obligation generation does not match');
  if (!validTimestamp(obligation.createdAt)) defects.push('set obligation creation time is invalid');
  return defects;
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
      || input?.observation?.baseBranch !== expected.baseBranch) {
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
  defects.push(...validateSetObligation(input?.setObligation, expected, generation));
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
  const expected = {
    issue: issueIdentity,
    changeRequest: record.changeRequest.identifier,
    baseBranch: manifest.repository.baseBranch,
    baseSha: record.baseSha,
    headSha: record.headSha,
  };
  const defects = validateSetObligation(
    obligation,
    expected,
    obligation?.generation,
    'rerun-quality-and-provider-observation',
  );
  if (!Number.isInteger(obligation?.generation) || obligation.generation < 1) {
    defects.push('set obligation generation is invalid');
  }
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
  next.events.push({ type: 'shepherd-not-required', issue: issueIdentity });
  return next;
}

function currentRevision(revisions, issue) {
  const revision = revisions?.[issue];
  if (!revision
      || !nonEmpty(revision.baseSha)
      || !nonEmpty(revision.headSha)
      || !validTimestamp(revision.observedAt)) {
    throw new Error(`current revision observation is incomplete for ${issue}`);
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
  if (mergeObservation?.observed !== true
      || mergeObservation.provider !== manifest.provider.name
      || mergeObservation.repository !== manifest.repository.id
      || mergeObservation.baseBranch !== manifest.repository.baseBranch
      || !nonEmpty(mergeObservation.publicationKey)
      || !nonEmpty(mergeObservation.mergeCommit)
      || !validTimestamp(mergeObservation.observedAt)) {
    throw new Error('readiness expiry requires an exact reconciled human merge observation');
  }
  const publication = state.publications?.find((entry) =>
    entry.state === 'confirmed'
    && entry.key === mergeObservation.publicationKey
    && entry.provider === mergeObservation.provider
    && entry.repository === mergeObservation.repository
    && entry.issue === mergeObservation.issue
    && entry.identifier === mergeObservation.changeRequest
    && entry.baseBranch === mergeObservation.baseBranch
    && entry.headBranch === mergeObservation.headBranch
    && entry.headSha === mergeObservation.headSha);
  if (!publication) {
    throw new Error('readiness expiry merge is not reconciled to recorded publication');
  }
  const next = structuredClone(state);
  if (!next.observedHumanMerges.some((entry) =>
    entry.publicationKey === mergeObservation.publicationKey
    && entry.mergeCommit === mergeObservation.mergeCommit)) {
    next.observedHumanMerges.push(mergeObservation);
  }
  for (const record of Object.values(next.issues)) {
    if (!record.changeRequest || record.changeRequest.identifier === mergeObservation.changeRequest) continue;
    if (record.changeRequest.baseBranch !== mergeObservation.baseBranch) continue;
    if (next.observedHumanMerges.some((entry) =>
      entry.issue === record.identity
      && entry.changeRequest === record.changeRequest.identifier)) continue;
    const existingQueue = next.reShepherdQueue.find((entry) => entry.issue === record.identity);
    const wasReady = record.shepherd?.ready === true
      || record.shepherdDecision?.state === 'not-required'
      || Boolean(existingQueue);
    if (!wasReady) continue;
    const revision = currentRevision(revisions, record.identity);
    if (record.baseSha === revision.baseSha
        && record.headSha === revision.headSha
        && record.shepherd?.receipt?.baseSha === revision.baseSha) continue;
    const priorGeneration = existingQueue?.generation
      ?? record.shepherd?.setObligation?.generation
      ?? record.setObligation?.generation
      ?? 0;
    const generation = priorGeneration + 1;
    if (record.shepherd) {
      record.shepherd.ready = false;
      record.shepherd.freshness = 'stale';
      record.shepherd.accepted = false;
    }
    record.terminalDisposition = 'blocked';
    record.nextAction = manifest.shepherdIntent === 'yes'
      ? 'consume-fresh-re-shepherd-receipt'
      : 'rerun-quality-and-provider-observation';
    if (manifest.shepherdIntent === 'yes' && record.pipeline.at(-1)?.stage === 'shepherd') {
      record.pipeline.pop();
    }
    const expiry = {
      issue: record.identity,
      changeRequest: record.changeRequest.identifier,
      publicationKey: record.changeRequest.publicationKey,
      reason: `sibling-merge:${mergeObservation.changeRequest}`,
      oldBaseSha: record.shepherd?.receipt?.baseSha ?? record.setObligation?.baseSha ?? null,
      currentBaseSha: revision.baseSha,
      currentHeadSha: revision.headSha,
      generation,
      expiredAt: now,
      sourceStateRevision: state.revision,
    };
    next.expiredReadinessClaims.push(expiry);
    next.reShepherdQueue = next.reShepherdQueue.filter((entry) => entry.issue !== record.identity);
    next.reShepherdQueue.push({
      issue: record.identity,
      changeRequest: record.changeRequest.identifier,
      publicationKey: record.changeRequest.publicationKey,
      reason: expiry.reason,
      generation,
      baseSha: revision.baseSha,
      headSha: revision.headSha,
      sourceStateRevision: state.revision,
      queuedAt: now,
      action: manifest.shepherdIntent === 'yes'
        ? 'invoke-fresh-shepherd'
        : 'rerun-quality-and-provider-observation',
    });
  }
  if (next.reShepherdQueue.length > 0) next.fleetDisposition = 'blocked';
  return next;
}

export function consumeReShepherdQueue(state, issueIdentity, accepted) {
  const queue = state.reShepherdQueue.find((entry) => entry.issue === issueIdentity);
  if (!queue) throw new Error(`no re-Shepherd obligation for ${issueIdentity}`);
  if (!accepted?.accepted || !accepted.ready
      || accepted.receipt?.baseSha !== queue.baseSha
      || accepted.receipt?.headSha !== queue.headSha
      || accepted.receipt?.changeRequest !== queue.changeRequest
      || accepted.setObligation?.generation !== queue.generation) {
    throw new Error('fresh accepted Shepherd receipt does not satisfy queued generation and revisions');
  }
  const next = structuredClone(state);
  next.issues[issueIdentity].shepherd = structuredClone(accepted);
  next.issues[issueIdentity].setObligation = structuredClone(accepted.setObligation);
  next.issues[issueIdentity].pipeline.push({
    stage: 'shepherd',
    evidence: structuredClone(accepted.receipt),
  });
  next.issues[issueIdentity].terminalDisposition = 'ready-for-human-merge';
  next.issues[issueIdentity].nextAction = 'await-human-merge';
  next.reShepherdQueue = next.reShepherdQueue.filter((entry) => entry.issue !== issueIdentity);
  next.events.push({
    type: 're-shepherd-receipt-consumed',
    issue: issueIdentity,
    generation: queue.generation,
  });
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
      || revalidation.pipeline.some((entry) =>
        entry.evidence?.baseSha !== queue.baseSha || entry.evidence?.headSha !== queue.headSha)) {
    throw new Error('no-Shepherd revalidation evidence is incomplete or stale');
  }
  const expected = {
    issue: issueIdentity,
    changeRequest: queue.changeRequest,
    baseBranch: manifest.repository.baseBranch,
    baseSha: queue.baseSha,
    headSha: queue.headSha,
  };
  const defects = validateSetObligation(
    obligation,
    expected,
    queue.generation,
    'rerun-quality-and-provider-observation',
  );
  if (defects.length) throw new Error(`invalid no-Shepherd set obligation: ${defects.join('; ')}`);
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
  record.nextAction = 'await-human-merge';
  next.reShepherdQueue = next.reShepherdQueue.filter((entry) => entry.issue !== issueIdentity);
  next.events.push({
    type: 'no-shepherd-revalidation-consumed',
    issue: issueIdentity,
    generation: queue.generation,
  });
  return next;
}
