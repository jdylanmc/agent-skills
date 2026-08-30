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
  rungs: ['assertion', 'exact-source-citation', 'ruled-out-bad-case', 'executable-proof', 'live-reproduction'],
  classifications: ['confirmed-risk', 'cleared-risk', 'unproven-assertion'],
  progression: ['completed', 'unavailable', 'not-applicable', 'not-attempted'],
  outcomes: ['supports-assertion', 'supports-bad-case', 'inconclusive', 'conflicting'],
  regressionProofStatus: ['selected', 'unavailable'],
});

const CI_STATUSES = new Set([
  'passed', 'failed', 'intermittent', 'environment-failed',
  'cancelled', 'incomplete', 'unsupported-provider',
]);
const ROAST_PRIORITIES = new Set(['Must fix', 'Should fix', 'Consider']);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validTimestamp(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function revisionMatches(evidence, revision) {
  return evidence?.baseSha === revision?.baseSha && evidence?.headSha === revision?.headSha;
}

function invocationDefects(receipt, skill, identity) {
  const defects = [];
  const invocation = receipt?.invocation;
  if (!invocation || typeof invocation !== 'object') {
    return [`${skill} invocation identity is absent`];
  }
  if (invocation.skill !== skill) defects.push(`${skill} invocation skill is invalid`);
  if (!nonEmpty(invocation.id)) defects.push(`${skill} invocation id is absent`);
  if (identity?.runId && invocation.runId !== identity.runId) defects.push(`${skill} invocation run identity does not match`);
  if (identity?.issue && invocation.issue !== identity.issue) defects.push(`${skill} invocation issue identity does not match`);
  return defects;
}

export function adaptCiEvidence(receipt, revision, identity = {}) {
  const defects = invocationDefects(receipt, 'run-ci', identity);
  if (!revisionMatches(receipt, revision)) defects.push('run-ci evidence is not bound to current base and head');
  if (!CI_STATUSES.has(receipt?.status)) defects.push('run-ci status is absent or invalid');
  if (receipt?.terminal !== true) defects.push('run-ci receipt is not terminal');
  if (receipt?.complete !== true || receipt?.evidenceComplete !== true) {
    defects.push('run-ci receipt is incomplete');
  }
  if (!validTimestamp(receipt?.completedAt)) defects.push('run-ci completion time is absent or invalid');
  if (!Array.isArray(receipt?.steps) || receipt.steps.length === 0) {
    defects.push('run-ci steps are absent');
  } else {
    for (const [index, step] of receipt.steps.entries()) {
      if (!nonEmpty(step?.name) || !nonEmpty(step?.status)) {
        defects.push(`run-ci step ${index} is incomplete`);
      }
    }
  }
  return {
    kind: 'run-ci',
    valid: defects.length === 0,
    passed: defects.length === 0
      && receipt.status === 'passed'
      && receipt.steps.every((step) => step.status === 'passed'),
    status: receipt?.status ?? 'missing',
    defects,
    receipt: receipt ?? null,
    baseSha: receipt?.baseSha ?? null,
    headSha: receipt?.headSha ?? null,
  };
}

export function adaptRoastEvidence(receipt, revision, identity = {}) {
  const defects = invocationDefects(receipt, 'roast', identity);
  if (!revisionMatches(receipt, revision)) defects.push('Roast evidence is not bound to current base and head');
  if (receipt?.status !== 'completed') defects.push('Roast status must be completed');
  if (receipt?.terminal !== true) defects.push('Roast receipt is not terminal');
  if (receipt?.complete !== true) defects.push('Roast receipt is incomplete');
  if (!validTimestamp(receipt?.completedAt)) defects.push('Roast completion time is absent or invalid');
  if (!Array.isArray(receipt?.findings)) {
    defects.push('Roast findings must be an array');
  }
  const openMustFix = [];
  for (const [index, finding] of (receipt?.findings ?? []).entries()) {
    if (!nonEmpty(finding?.id)) defects.push(`Roast finding ${index} has no identity`);
    if (!ROAST_PRIORITIES.has(finding?.Priority)) {
      defects.push(`Roast finding ${finding?.id ?? index} has invalid Priority`);
      continue;
    }
    if (!['open', 'resolved'].includes(finding.status)) {
      defects.push(`Roast finding ${finding?.id ?? index} has invalid status`);
    }
    if (finding.Priority === 'Must fix' && finding.status !== 'resolved') {
      openMustFix.push(finding.id ?? `finding-${index}`);
    }
  }
  return {
    kind: 'roast',
    valid: defects.length === 0,
    complete: defects.length === 0 && openMustFix.length === 0,
    openMustFix,
    defects,
    receipt: receipt ?? null,
    baseSha: receipt?.baseSha ?? null,
    headSha: receipt?.headSha ?? null,
  };
}

export function reconcileFleetDiff(input) {
  return reconcile(input);
}

function validateLadder(ladder, index, defects) {
  const prefix = `assertionLadders[${index}]`;
  for (const field of ['id', 'assertion', 'affectedBoundary', 'badCase', 'safetyCriticalReason']) {
    if (!nonEmpty(ladder?.[field])) defects.push(`${prefix}.${field} is absent`);
  }
  if (!Array.isArray(ladder?.rungs) || ladder.rungs.length !== BLAST_RADIUS_VOCABULARY.rungs.length) {
    defects.push(`${prefix}.rungs must contain all five ordered rungs`);
    return;
  }
  let stopped = false;
  let firstStoppingRung = null;
  for (const [rungIndex, rung] of ladder.rungs.entries()) {
    const expectedName = BLAST_RADIUS_VOCABULARY.rungs[rungIndex];
    if (rung?.name !== expectedName) defects.push(`${prefix}.rungs[${rungIndex}].name must be ${expectedName}`);
    if (!BLAST_RADIUS_VOCABULARY.progression.includes(rung?.progression)) {
      defects.push(`invalid progression: ${rung?.progression}`);
    }
    if (!BLAST_RADIUS_VOCABULARY.outcomes.includes(rung?.['evidence-outcome'])) {
      defects.push(`invalid evidence-outcome: ${rung?.['evidence-outcome']}`);
    }
    if (!nonEmpty(rung?.scope)) defects.push(`${prefix}.rungs[${rungIndex}].scope is absent`);
    if (rung?.progression === 'completed' && !nonEmpty(rung?.evidence)) {
      defects.push(`${prefix}.rungs[${rungIndex}] completed without evidence`);
    }
    if (['unavailable', 'not-applicable', 'not-attempted'].includes(rung?.progression)
        && rung?.['evidence-outcome'] !== 'inconclusive') {
      defects.push(`${prefix}.rungs[${rungIndex}] has evidence outcome without acquired evidence`);
    }
    if (stopped && rung?.progression !== 'not-attempted') {
      defects.push(`${prefix}.rungs[${rungIndex}] must be not-attempted after the stopping rung`);
    }
    if (!stopped && (
      rung?.progression === 'unavailable'
      || rung?.progression === 'not-applicable'
      || (rung?.progression === 'completed' && ['inconclusive', 'conflicting'].includes(rung?.['evidence-outcome']))
    )) {
      stopped = true;
      firstStoppingRung = rung?.name;
    }
    if (rung?.progression === 'not-applicable' && rung?.name !== 'live-reproduction') {
      defects.push(`${prefix}.rungs[${rungIndex}] uses not-applicable before live reproduction`);
    }
  }
  const expectedStoppingRung = firstStoppingRung ?? BLAST_RADIUS_VOCABULARY.rungs.at(-1);
  const names = ladder.rungs.map((rung) => rung.name);
  if (!BLAST_RADIUS_VOCABULARY.rungs.includes(ladder?.stoppingRung)
      || !names.includes(ladder.stoppingRung)
      || ladder.stoppingRung !== expectedStoppingRung
      || !nonEmpty(ladder?.stoppingReason)
      || !nonEmpty(ladder?.strongestSupportedClaim)
      || !nonEmpty(ladder?.nextEvidenceNeeded)) {
    defects.push(`${prefix} stopping evidence is incomplete`);
  }
}

function validateRegressionProof(report, ladderIds, defects) {
  const status = report?.['regression-proof-status'];
  const proof = report?.['regression-proof'];
  if (!BLAST_RADIUS_VOCABULARY.regressionProofStatus.includes(status)) {
    defects.push('regression-proof-status must be selected or unavailable');
    return;
  }
  if (status === 'selected') {
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
      defects.push('selected regression proof is absent');
      return;
    }
    const fields = [
      'id', 'assertionId', 'badCase', 'verificationLevel', 'environment',
      'setup', 'action', 'observableResult', 'authorization',
      'cheaperProofInsufficientReason', 'outsideCoverage',
    ];
    for (const field of fields) {
      if (!nonEmpty(proof[field])) defects.push(`regression-proof.${field} is absent`);
    }
    if (!Array.isArray(proof.prerequisites)) defects.push('regression-proof.prerequisites must be an array');
    if (!ladderIds.has(proof.assertionId)) defects.push('regression proof does not identify a selected assertion');
    if (report?.['next-evidence-action'] || report?.['next-evidence-reason']) {
      defects.push('selected regression proof must not carry unavailable next-evidence fields');
    }
  } else {
    if (proof !== null) defects.push('unavailable regression proof must leave proof details empty');
    if (!nonEmpty(report?.['next-evidence-action']) || !nonEmpty(report?.['next-evidence-reason'])) {
      defects.push('unavailable regression proof requires next-evidence-action and next-evidence-reason');
    }
  }
}

export function adaptBlastRadiusEvidence(report, revision, identity = {}) {
  const defects = invocationDefects(report, 'blast-radius', identity);
  if (report?.contractPullRequest !== 157) defects.push('blast-radius contract must identify Pull Request 157');
  if (report?.status !== 'completed' || report?.terminal !== true || report?.complete !== true) {
    defects.push('blast-radius evidence must be complete and terminal');
  }
  if (!validTimestamp(report?.completedAt)) defects.push('blast-radius completion time is absent or invalid');
  if (!revisionMatches(report, revision)) defects.push('blast-radius evidence is not bound to current base and head');
  if (!Array.isArray(report?.assertionLadders) || report.assertionLadders.length === 0) {
    defects.push('assertionLadders must be a non-empty array');
  }
  const ladderIds = new Set();
  for (const [index, ladder] of (report?.assertionLadders ?? []).entries()) {
    validateLadder(ladder, index, defects);
    if (nonEmpty(ladder?.id)) {
      if (ladderIds.has(ladder.id)) defects.push(`duplicate assertion ladder identity: ${ladder.id}`);
      ladderIds.add(ladder.id);
    }
  }

  const classifications = report?.classifications ?? {};
  const classified = [];
  for (const key of BLAST_RADIUS_VOCABULARY.classifications) {
    if (!Array.isArray(classifications[key])) {
      defects.push(`${key} must be an array`);
      continue;
    }
    for (const [index, entry] of classifications[key].entries()) {
      if (!nonEmpty(entry?.assertionId) || !ladderIds.has(entry.assertionId)) {
        defects.push(`${key}[${index}] does not identify an assertion ladder`);
      }
      if (!nonEmpty(entry?.evidence) || !nonEmpty(entry?.scope)) {
        defects.push(`${key}[${index}] lacks exact evidence or scope`);
      }
      if (key === 'confirmed-risk' && (!nonEmpty(entry.badCase) || !nonEmpty(entry.occurrenceOrNecessaryProduction))) {
        defects.push(`${key}[${index}] lacks bad-case proof`);
      }
      if (key === 'unproven-assertion'
          && (!nonEmpty(entry.stoppingRung) || !nonEmpty(entry.reason) || !nonEmpty(entry.nextEvidence))) {
        defects.push(`${key}[${index}] lacks stopping evidence`);
      }
      classified.push(entry?.assertionId);
    }
  }
  if (classified.length !== ladderIds.size
      || new Set(classified).size !== classified.length
      || classified.some((id) => !ladderIds.has(id))) {
    defects.push('every assertion must be classified exactly once');
  }
  validateRegressionProof(report, ladderIds, defects);

  const confirmed = classifications['confirmed-risk']?.length ?? 0;
  const unproven = classifications['unproven-assertion']?.length ?? 0;
  let readiness = 'satisfied';
  if (defects.length) readiness = 'invalid';
  else if (report['regression-proof-status'] === 'unavailable') readiness = 'unavailable';
  else if (confirmed > 0) readiness = 'confirmed-risk';
  else if (unproven > 0) readiness = 'unproven-assertion';
  return {
    kind: 'blast-radius',
    valid: defects.length === 0,
    defects,
    readiness,
    classifications,
    assertionLadders: report?.assertionLadders ?? [],
    'regression-proof-status': report?.['regression-proof-status'] ?? null,
    'regression-proof': report?.['regression-proof'] ?? null,
    'next-evidence-action': report?.['next-evidence-action'] ?? null,
    'next-evidence-reason': report?.['next-evidence-reason'] ?? null,
    baseSha: report?.baseSha ?? null,
    headSha: report?.headSha ?? null,
    receipt: report ?? null,
  };
}

export function deliveryStagesForManifest(manifest) {
  if (manifest?.shepherdIntent === 'no') return DELIVERY_STAGES.slice(0, -1);
  return [...DELIVERY_STAGES];
}

export function recordStage(issueRecord, stage, evidence, revision, manifest = { shepherdIntent: 'yes' }) {
  const stages = deliveryStagesForManifest(manifest);
  const index = stages.indexOf(stage);
  if (index < 0) throw new Error(`delivery stage is not required by manifest: ${stage}`);
  if (!revisionMatches(evidence, revision)) throw new Error(`${stage} evidence is stale for current revision`);
  const completed = issueRecord.pipeline ?? [];
  const expected = stages[completed.length];
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
  next.changeRequest = null;
  next.shepherd = null;
  next.shepherdDecision = null;
  next.setObligation = null;
  next.terminalDisposition = null;
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

function evaluateCriteria(criteria, issue, manifest, revision, defects) {
  if (!Array.isArray(criteria) || criteria.length === 0) {
    defects.push('criteria:missing');
    return;
  }
  const expected = new Map(issue.acceptanceCriteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set();
  for (const criterion of criteria) {
    if (!expected.has(criterion?.id) || seen.has(criterion?.id)) {
      defects.push(`criterion:${criterion?.id ?? 'missing'}:identity-mismatch`);
      continue;
    }
    seen.add(criterion.id);
    if (criterion.verdict === 'satisfied') {
      if (!criterion.evidence
          || criterion.evidence.complete !== true
          || !revisionMatches(criterion.evidence, revision)
          || !nonEmpty(criterion.evidence.summary)) {
        defects.push(`criterion:${criterion.id}:unproven`);
      }
    } else if (criterion.verdict === 'descoped-by-human') {
      const receipt = criterion.decisionReceipt;
      if (!receipt
          || receipt.criterionId !== criterion.id
          || receipt.manifestDigest !== manifest.digest
          || receipt.sourceRevision !== issue.sourceRevision
          || receipt.decision !== 'descoped'
          || receipt.actorType !== 'human'
          || !nonEmpty(receipt.decisionId)
          || !validTimestamp(receipt.decidedAt)) {
        defects.push(`criterion:${criterion.id}:invalid-human-decision-receipt`);
      }
    } else {
      defects.push(`criterion:${criterion.id}:${criterion.verdict ?? 'missing'}`);
    }
  }
  if (seen.size !== expected.size) defects.push('criteria:incomplete-set');
}

export function evaluateQualityGate(input = {}) {
  const defects = [];
  const manifest = input.manifest;
  const revision = input.revision;
  const issue = manifest?.issues?.find((entry) => entry.identity === input.identity?.issue);
  if (!manifest || !revision || !issue) {
    return { readyForPublication: false, defects: ['quality-gate:missing-manifest-revision-or-issue'] };
  }
  if (input.reconciliation?.verdict !== 'reconciled' || !revisionMatches(input.reconciliation, revision)) {
    defects.push(`reconciliation:${input.reconciliation?.verdict ?? 'missing-or-stale'}`);
  }
  const ci = adaptCiEvidence(input.ciReceipt, revision, input.identity);
  if (!ci.passed) defects.push(`run-ci:${ci.defects.join('|') || ci.status}`);
  const roast = adaptRoastEvidence(input.roastReceipt, revision, input.identity);
  if (!roast.complete) {
    defects.push(`roast:${roast.openMustFix.length ? `Must fix:${roast.openMustFix.length}` : roast.defects.join('|')}`);
  }
  const blastRadius = adaptBlastRadiusEvidence(input.blastRadiusReceipt, revision, input.identity);
  if (blastRadius.readiness !== 'satisfied') {
    defects.push(`blast-radius:${blastRadius.readiness}`);
  }
  evaluateCriteria(input.criteria, issue, manifest, revision, defects);
  return {
    readyForPublication: defects.length === 0,
    defects,
    evidence: { ci, roast, blastRadius },
  };
}
