import { reconcile } from '../../../ship/_atoms/diff-reconciliation/diff-reconciliation.mjs';

export const DELIVERY_STAGES = Object.freeze([
  'implementation',
  'diff-reconciliation',
  'run-ci',
  'roast',
  'blast-radius-proof',
  'bounded-remediation',
  'criterion-verdict',
  'publication',
  'shepherd',
]);

export const BLAST_RADIUS_VOCABULARY = Object.freeze({
  classifications: ['confirmed-risk', 'cleared-risk', 'unproven-assertion'],
  progression: ['completed', 'unavailable', 'not-applicable', 'not-attempted'],
  outcomes: ['supports-assertion', 'supports-bad-case', 'inconclusive', 'conflicting'],
  regressionProofStatus: ['selected', 'unavailable'],
});

function revisionMatches(evidence, revision) {
  return evidence?.baseSha === revision.baseSha && evidence?.headSha === revision.headSha;
}

export function reconcileFleetDiff(input) {
  return reconcile(input);
}

export function adaptBlastRadiusEvidence(report, revision) {
  const defects = [];
  if (!revisionMatches(report, revision)) defects.push('blast-radius evidence is not bound to current base and head');
  if (!Array.isArray(report?.assertionLadders)) defects.push('assertionLadders must be an array');
  for (const ladder of report?.assertionLadders ?? []) {
    for (const rung of ladder.rungs ?? []) {
      if (!BLAST_RADIUS_VOCABULARY.progression.includes(rung.progression)) defects.push(`invalid progression: ${rung.progression}`);
      if (!BLAST_RADIUS_VOCABULARY.outcomes.includes(rung['evidence-outcome'])) defects.push(`invalid evidence-outcome: ${rung['evidence-outcome']}`);
    }
  }
  const classifications = report?.classifications ?? {};
  for (const key of BLAST_RADIUS_VOCABULARY.classifications) {
    if (!Array.isArray(classifications[key])) defects.push(`${key} must be an array`);
  }
  const regressionProofStatus = report?.['regression-proof-status'];
  if (!BLAST_RADIUS_VOCABULARY.regressionProofStatus.includes(regressionProofStatus)) {
    defects.push('regression-proof-status must be selected or unavailable');
  }
  if (regressionProofStatus === 'unavailable'
      && (!report?.['next-evidence-action'] || !report?.['next-evidence-reason'])) {
    defects.push('unavailable regression proof requires next-evidence-action and next-evidence-reason');
  }

  const confirmed = classifications['confirmed-risk']?.length ?? 0;
  const unproven = classifications['unproven-assertion']?.length ?? 0;
  let readiness = 'satisfied';
  if (defects.length) readiness = 'invalid';
  else if (regressionProofStatus === 'unavailable') readiness = 'unavailable';
  else if (confirmed > 0) readiness = 'confirmed-risk';
  else if (unproven > 0) readiness = 'unproven-assertion';
  return {
    valid: defects.length === 0,
    defects,
    readiness,
    classifications,
    assertionLadders: report?.assertionLadders ?? [],
    'regression-proof-status': regressionProofStatus ?? null,
    'next-evidence-action': report?.['next-evidence-action'] ?? null,
    'next-evidence-reason': report?.['next-evidence-reason'] ?? null,
    baseSha: report?.baseSha ?? null,
    headSha: report?.headSha ?? null,
  };
}

export function recordStage(issueRecord, stage, evidence, revision) {
  const index = DELIVERY_STAGES.indexOf(stage);
  if (index < 0) throw new Error(`unknown delivery stage: ${stage}`);
  if (!revisionMatches(evidence, revision)) throw new Error(`${stage} evidence is stale for current revision`);
  const completed = issueRecord.pipeline ?? [];
  const expected = DELIVERY_STAGES[completed.length];
  if (stage !== expected) throw new Error(`workflow order violation: expected ${expected}, received ${stage}`);
  const next = structuredClone(issueRecord);
  next.pipeline = [...completed, { stage, evidence }];
  return next;
}

export function invalidateRevisionEvidence(issueRecord, revision) {
  const next = structuredClone(issueRecord);
  next.baseSha = revision.baseSha;
  next.headSha = revision.headSha;
  next.pipeline = (next.pipeline ?? []).filter((entry) =>
    entry.stage === 'implementation' && revisionMatches(entry.evidence, revision));
  next.qualityEvidence = {};
  next.shepherd = null;
  return next;
}

export function remediationDecision({ attempt, limit, defects }) {
  if (!Number.isInteger(limit) || limit < 0) throw new Error('remediation limit must be a non-negative integer');
  if (!Number.isInteger(attempt) || attempt < 0) throw new Error('remediation attempt must be a non-negative integer');
  return defects.length === 0
    ? { action: 'continue', reason: 'no-remediation-defects' }
    : attempt < limit
      ? { action: 'dispatch-fresh-remediation-worker', reason: 'bounded-remediation-available' }
      : { action: 'hand-back', reason: 'remediation-budget-exhausted' };
}

export function evaluateQualityGate(input = {}) {
  const defects = [];
  if (input.reconciliation?.verdict !== 'reconciled') {
    defects.push(`reconciliation:${input.reconciliation?.verdict ?? 'missing'}`);
  }
  if (input.ci?.status !== 'passed' || input.ci?.evidenceComplete !== true) {
    defects.push(`run-ci:${input.ci?.status ?? 'missing-or-incomplete'}`);
  }
  const roastBlockers = (input.roast?.findings ?? [])
    .filter((finding) => finding.severity === 'blocker');
  if (roastBlockers.length) defects.push(`roast:blockers:${roastBlockers.length}`);
  if (input.blastRadius?.readiness !== 'satisfied') {
    defects.push(`blast-radius:${input.blastRadius?.readiness ?? 'missing'}`);
  }
  const criteria = input.criteria ?? [];
  if (criteria.length === 0) defects.push('criteria:missing');
  for (const criterion of criteria) {
    if (!['satisfied', 'descoped-by-human'].includes(criterion.verdict)) {
      defects.push(`criterion:${criterion.id}:${criterion.verdict ?? 'missing'}`);
    }
  }
  return {
    readyForPublication: defects.length === 0,
    defects,
  };
}
