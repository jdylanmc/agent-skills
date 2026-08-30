import {
  compareObservation,
  isTerminalDisposition,
  normalizeUpToDatePolicy,
  validateFreshnessReceipt,
} from '../../../_base/_atoms/landability/landability.mjs';

const GREEN = new Set(['mergeable-and-green', 'no-op-mergeable-and-green']);

export function acceptShepherdReturn(input) {
  const defects = [];
  if (input?.invocation?.mode !== 'nested-worker') defects.push('shepherd was not invoked in a nested worker');
  if (input?.invocation?.freshContext !== true) defects.push('shepherd worker context was not fresh');
  if (input?.invocation?.status !== 'returned') defects.push('shepherd invocation did not return');
  if (!isTerminalDisposition(input?.result?.disposition)) defects.push('shepherd returned no terminal disposition');
  const receipt = validateFreshnessReceipt(input?.result?.receipt);
  defects.push(...receipt.defects);
  const freshness = receipt.valid
    ? compareObservation(input.result.receipt, input.observation)
    : { freshness: 'unobserved', drifted: [] };
  if (freshness.freshness !== 'fresh') defects.push(`shepherd freshness is ${freshness.freshness}`);
  const policy = normalizeUpToDatePolicy(input?.result?.receipt?.upToDatePolicy);
  if (policy === 'required' && input?.observation?.containsCurrentBase !== true) {
    defects.push('strict up-to-date policy is not proven satisfied');
  }
  if (String(input?.result?.receipt?.provider ?? '').includes('unobserved')
      || String(input?.result?.disposition ?? '').includes('provider-tool')) {
    defects.push('provider state is degraded or unobserved');
  }
  if (!input?.setObligation
      || typeof input.setObligation.owner !== 'string'
      || typeof input.setObligation.expiresWhen !== 'string'
      || typeof input.setObligation.reinvocation !== 'string') {
    defects.push('set obligation is incomplete');
  }
  const ready = defects.length === 0 && GREEN.has(input.result.disposition);
  return {
    ready,
    disposition: input?.result?.disposition ?? 'blocked',
    receipt: input?.result?.receipt ?? null,
    freshness: freshness.freshness,
    defects,
    setObligation: input?.setObligation ?? null,
  };
}

export function expireReadinessAfterSiblingMerge(state, mergeObservation, currentBaseSha) {
  if (mergeObservation?.observed !== true) throw new Error('readiness expiry requires an observed human merge');
  const next = structuredClone(state);
  if (!next.observedHumanMerges.some((entry) => entry.mergeCommit === mergeObservation.mergeCommit)) {
    next.observedHumanMerges.push(mergeObservation);
  }
  for (const record of Object.values(next.issues)) {
    if (!record.changeRequest || record.changeRequest.identifier === mergeObservation.changeRequest) continue;
    if (record.changeRequest.baseBranch !== mergeObservation.baseBranch) continue;
    if (!record.shepherd?.ready) continue;
    if (record.shepherd.receipt?.baseSha === currentBaseSha) continue;
    record.shepherd.ready = false;
    record.shepherd.freshness = 'stale';
    const expiry = {
      issue: record.identity,
      changeRequest: record.changeRequest.identifier,
      reason: `sibling-merge:${mergeObservation.changeRequest}`,
      oldBaseSha: record.shepherd.receipt?.baseSha ?? null,
      currentBaseSha,
    };
    next.expiredReadinessClaims.push(expiry);
    if (!next.reShepherdQueue.some((entry) => entry.issue === record.identity)) {
      next.reShepherdQueue.push({
        issue: record.identity,
        changeRequest: record.changeRequest.identifier,
        reason: expiry.reason,
      });
    }
  }
  return next;
}
