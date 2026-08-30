import { reconcile } from '../../../ship/_atoms/diff-reconciliation/diff-reconciliation.mjs';
import { assertFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';

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
export const READINESS_OBLIGATION_FIELDS = Object.freeze([
  'owner', 'provider', 'repository', 'changeRequest', 'publicationKey',
  'baseBranch', 'baseSha', 'headSha', 'expiresWhen', 'reinvocation',
  'generation', 'createdAt',
]);

const CI_STATUSES = new Set([
  'passed', 'failed', 'intermittent', 'environment-failed',
  'cancelled', 'incomplete', 'unsupported-provider',
]);
const ROAST_PRIORITIES = new Set(['Must fix', 'Should fix', 'Consider']);
const SHEPHERD_READY_DISPOSITIONS = new Set([
  'mergeable-and-green', 'no-op-mergeable-and-green',
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validTimestamp(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function normalizedProvider(value) {
  return nonEmpty(value) ? value.trim().toLowerCase() : null;
}

function exactObjectKeys(value, expected) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function validateReadinessObligation(
  obligation,
  expected,
  generation,
  reinvocation = 'invoke-fresh-shepherd',
  minimumCreatedAt = null,
) {
  const defects = [];
  if (!exactObjectKeys(obligation, READINESS_OBLIGATION_FIELDS)) {
    return ['set obligation schema is not exact'];
  }
  const fields = {
    owner: expected.issue,
    provider: normalizedProvider(expected.provider),
    repository: expected.repository,
    changeRequest: expected.changeRequest,
    publicationKey: expected.publicationKey,
    baseBranch: expected.baseBranch,
    baseSha: expected.baseSha,
    headSha: expected.headSha,
  };
  for (const [field, expectedValue] of Object.entries(fields)) {
    const actual = field === 'provider'
      ? normalizedProvider(obligation[field])
      : obligation[field];
    if (!expectedValue || actual !== expectedValue) {
      defects.push(`set obligation ${field} does not match`);
    }
  }
  if (obligation.expiresWhen !== 'sibling-merge-into-base') {
    defects.push('set obligation expiry is invalid');
  }
  if (obligation.reinvocation !== reinvocation) {
    defects.push('set obligation reinvocation is invalid');
  }
  if (!Number.isInteger(generation) || generation < 1 || obligation.generation !== generation) {
    defects.push('set obligation generation does not match');
  }
  if (!validTimestamp(obligation.createdAt)) {
    defects.push('set obligation creation time is invalid');
  } else if (validTimestamp(minimumCreatedAt)
      && Date.parse(obligation.createdAt) < Date.parse(minimumCreatedAt)) {
    defects.push('set obligation predates current readiness evidence');
  }
  return defects;
}

export function persistedShepherdPasses(issueRecord, state, manifest) {
  assertFleetManifest(manifest);
  const defects = [];
  const shepherd = issueRecord?.shepherd;
  const receipt = shepherd?.receipt;
  const invocation = shepherd?.invocation;
  const observation = shepherd?.observation;
  const obligation = shepherd?.setObligation;
  if (!shepherd || shepherd.accepted !== true || shepherd.ready !== true
      || shepherd.freshness !== 'fresh' || !SHEPHERD_READY_DISPOSITIONS.has(shepherd.disposition)
      || shepherd.terminal !== true || shepherd.complete !== true
      || !Array.isArray(shepherd.defects) || shepherd.defects.length !== 0) {
    defects.push('Shepherd accepted readiness state is incomplete');
  }
  if (!invocation || invocation.skill !== 'shepherd' || !nonEmpty(invocation.id)
      || invocation.id !== shepherd?.invocationId
      || invocation.runId !== state?.runId
      || invocation.issue !== issueRecord?.identity
      || invocation.changeRequest !== issueRecord?.changeRequest?.identifier
      || invocation.mode !== 'nested-worker'
      || invocation.freshContext !== true
      || invocation.status !== 'returned') {
    defects.push('Shepherd persisted invocation identity is invalid');
  }
  if (!receipt
      || !exactObjectKeys(receipt, [
        'observedAt', 'baseSha', 'headSha', 'upToDatePolicy', 'provider', 'complete',
      ])
      || receipt.baseSha !== issueRecord?.baseSha
      || receipt.headSha !== issueRecord?.headSha
      || !validTimestamp(receipt.observedAt)
      || receipt.complete !== true
      || !['required', 'not-required'].includes(receipt.upToDatePolicy)
      || normalizedProvider(receipt.provider) !== 'supported-provider') {
    defects.push('Shepherd persisted freshness receipt is invalid');
  }
  if (!observation
      || normalizedProvider(observation.provider) !== normalizedProvider(manifest?.provider?.name)
      || observation.repository !== manifest?.repository?.id
      || observation.changeRequest !== issueRecord?.changeRequest?.identifier
      || observation.baseBranch !== manifest?.repository?.baseBranch
      || observation.baseSha !== issueRecord?.baseSha
      || observation.headSha !== issueRecord?.headSha
      || !validTimestamp(observation.observedAt)
      || Date.parse(observation.observedAt) <= Date.parse(receipt?.observedAt ?? '')
      || (receipt?.upToDatePolicy === 'required' && observation.containsCurrentBase !== true)) {
    defects.push('Shepherd persisted post-return observation is invalid');
  }
  const obligationDefects = validateReadinessObligation(obligation, {
    issue: issueRecord?.identity,
    provider: manifest?.provider?.name,
    repository: manifest?.repository?.id,
    changeRequest: issueRecord?.changeRequest?.identifier,
    publicationKey: issueRecord?.changeRequest?.publicationKey,
    baseBranch: manifest?.repository?.baseBranch,
    baseSha: issueRecord?.baseSha,
    headSha: issueRecord?.headSha,
  }, issueRecord?.readinessGeneration, 'invoke-fresh-shepherd', observation?.observedAt);
  if (obligationDefects.length) {
    defects.push('Shepherd persisted set obligation is invalid');
  }
  const watermarkAt = issueRecord?.readinessWatermark?.observedAt;
  if (issueRecord?.readinessWatermark
      && (!validTimestamp(watermarkAt)
        || Date.parse(receipt?.observedAt ?? '') <= Date.parse(watermarkAt)
        || Date.parse(observation?.observedAt ?? '') <= Date.parse(watermarkAt)
        || obligation?.generation !== issueRecord.readinessWatermark.generation)) {
    defects.push('Shepherd evidence predates the latest relevant merge watermark');
  }
  return { passed: defects.length === 0, defects };
}

function revisionMatches(evidence, revision) {
  return evidence?.baseSha === revision?.baseSha && evidence?.headSha === revision?.headSha;
}

function simpleStagePasses(stage, evidence) {
  if (evidence?.complete !== true
      || evidence?.terminal !== true
      || !validTimestamp(evidence?.completedAt)) return false;
  if (stage === 'implementation') return evidence.status === 'completed';
  if (stage === 'diff-reconciliation') return evidence.verdict === 'reconciled';
  if (stage === 'bounded-remediation') {
    return evidence.status === 'completed'
      && Array.isArray(evidence.unresolvedDefects)
      && evidence.unresolvedDefects.length === 0;
  }
  return true;
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
  if (receipt?.complete !== true || receipt?.evidenceComplete !== true) {
    defects.push('Roast receipt is incomplete or truncated');
  }
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
  if (!exactObjectKeys(ladder, [
    'id', 'assertion', 'affectedBoundary', 'badCase', 'safetyCriticalReason',
    'rungs', 'stoppingRung', 'stoppingReason', 'strongestSupportedClaim',
    'nextEvidenceNeeded',
  ])) {
    defects.push(`${prefix} schema is not exact`);
  }
  for (const field of ['id', 'assertion', 'affectedBoundary', 'badCase', 'safetyCriticalReason']) {
    if (!nonEmpty(ladder?.[field])) defects.push(`${prefix}.${field} is absent`);
  }
  if (!Array.isArray(ladder?.rungs) || ladder.rungs.length !== BLAST_RADIUS_VOCABULARY.rungs.length) {
    defects.push(`${prefix}.rungs must contain all five ordered rungs`);
    return;
  }
  let stopped = false;
  let firstStoppingRung = null;
  let decisiveBadCase = false;
  let decisiveClear = false;
  let conflicting = false;
  const badCaseEvidence = [];
  const clearedEvidence = [];
  for (const [rungIndex, rung] of ladder.rungs.entries()) {
    const expectedName = BLAST_RADIUS_VOCABULARY.rungs[rungIndex];
    if (!exactObjectKeys(rung, ['name', 'progression', 'evidence-outcome', 'evidence', 'scope'])) {
      defects.push(`${prefix}.rungs[${rungIndex}] schema is not exact`);
    }
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
    if (!stopped && rung?.progression === 'not-attempted') {
      defects.push(`${prefix}.rungs[${rungIndex}] is not-attempted before a stopping rung`);
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
    if (rung?.progression === 'completed') {
      if (rung?.['evidence-outcome'] === 'conflicting') conflicting = true;
      if (rungIndex >= 1 && rung?.['evidence-outcome'] === 'supports-bad-case') {
        decisiveBadCase = true;
        badCaseEvidence.push({ evidence: rung.evidence, scope: rung.scope });
      }
      if (rungIndex >= 2 && rung?.['evidence-outcome'] === 'supports-assertion') {
        decisiveClear = true;
        clearedEvidence.push({ evidence: rung.evidence, scope: rung.scope });
      }
    }
  }
  if (ladder.rungs[0]?.progression !== 'completed') {
    defects.push(`${prefix}.rungs[0] assertion must be completed`);
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
  const permittedClassification = conflicting || (decisiveBadCase && decisiveClear)
    ? 'unproven-assertion'
    : decisiveBadCase
      ? 'confirmed-risk'
      : decisiveClear
        ? 'cleared-risk'
        : 'unproven-assertion';
  return { permittedClassification, badCaseEvidence, clearedEvidence };
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
    if (!exactObjectKeys(proof, [
      'id', 'assertionId', 'badCase', 'verificationLevel', 'environment',
      'setup', 'action', 'observableResult', 'prerequisites', 'authorization',
      'cheaperProofInsufficientReason', 'outsideCoverage',
    ])) defects.push('regression-proof schema is not exact');
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

export function adaptBlastRadiusEvidence(report, revision) {
  const defects = [];
  const commonFields = [
    'subjectChange', 'suppliedBaseline', 'includedScope', 'exclusions',
    'repositories', 'revisions', 'environments', 'directCallers',
    'crossBoundaryConsumers', 'assertionLadders', 'classifications',
    'analysisBoundaries', 'crossBoundaryGaps', 'regression-proof-status',
    'regression-proof',
  ];
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return {
      kind: 'blast-radius',
      valid: false,
      defects: ['blast-radius report is absent'],
      readiness: 'invalid',
      classifications: {},
      assertionLadders: [],
      'regression-proof-status': null,
      'regression-proof': null,
      'next-evidence-action': null,
      'next-evidence-reason': null,
      baseSha: null,
      headSha: null,
      receipt: report ?? null,
    };
  }
  const exactTopLevelFields = report['regression-proof-status'] === 'unavailable'
    ? [...commonFields, 'next-evidence-action', 'next-evidence-reason']
    : commonFields;
  if (!exactObjectKeys(report, exactTopLevelFields)) {
    defects.push('blast-radius report top-level schema is not exact');
  }
  for (const field of commonFields) {
    if (!Object.hasOwn(report, field)) defects.push(`blast-radius report.${field} is absent`);
  }
  for (const field of ['subjectChange', 'suppliedBaseline']) {
    if (!nonEmpty(report?.[field])) defects.push(`blast-radius report.${field} is absent`);
  }
  for (const field of [
    'includedScope', 'exclusions', 'repositories', 'environments',
    'directCallers', 'crossBoundaryConsumers',
  ]) {
    if (!Array.isArray(report?.[field])
        || report[field].some((entry) => !nonEmpty(entry))) {
      defects.push(`blast-radius report.${field} must be a string array`);
    }
  }
  if (!exactObjectKeys(report?.revisions, ['baseSha', 'headSha'])
      || !nonEmpty(report?.revisions?.baseSha)
      || !nonEmpty(report?.revisions?.headSha)
      || report.revisions.baseSha !== revision?.baseSha
      || report.revisions.headSha !== revision?.headSha) {
    defects.push('blast-radius report revisions are not bound to current base and head');
  }
  if (!Array.isArray(report?.assertionLadders) || report.assertionLadders.length === 0) {
    defects.push('assertionLadders must be a non-empty array');
  }
  if (!Array.isArray(report?.analysisBoundaries) || report.analysisBoundaries.length === 0
      || report.analysisBoundaries.some((entry) => !nonEmpty(entry))) {
    defects.push('analysisBoundaries must be a non-empty string array');
  }
  if (!Array.isArray(report?.crossBoundaryGaps)
      || report.crossBoundaryGaps.some((entry) => !nonEmpty(entry))) {
    defects.push('crossBoundaryGaps must be a string array');
  }
  const ladderIds = new Set();
  const ladderSemantics = new Map();
  for (const [index, ladder] of (report?.assertionLadders ?? []).entries()) {
    const semantic = validateLadder(ladder, index, defects);
    if (nonEmpty(ladder?.id)) {
      if (ladderIds.has(ladder.id)) defects.push(`duplicate assertion ladder identity: ${ladder.id}`);
      ladderIds.add(ladder.id);
      ladderSemantics.set(ladder.id, semantic);
    }
  }

  const classifications = report?.classifications ?? {};
  if (!exactObjectKeys(classifications, BLAST_RADIUS_VOCABULARY.classifications)) {
    defects.push('classification vocabulary is not exact');
  }
  const classified = [];
  for (const key of BLAST_RADIUS_VOCABULARY.classifications) {
    if (!Array.isArray(classifications[key])) {
      defects.push(`${key} must be an array`);
      continue;
    }
    for (const [index, entry] of classifications[key].entries()) {
      const expectedFields = key === 'confirmed-risk'
        ? ['assertionId', 'assertion', 'badCase', 'evidence', 'scope', 'occurrenceOrNecessaryProduction']
        : key === 'cleared-risk'
          ? ['assertionId', 'assertion', 'evidence', 'scope']
          : ['assertionId', 'assertion', 'evidence', 'scope', 'stoppingRung', 'reason', 'nextEvidence'];
      if (!exactObjectKeys(entry, expectedFields)) {
        defects.push(`${key}[${index}] schema is not exact`);
      }
      if (!nonEmpty(entry?.assertionId) || !ladderIds.has(entry.assertionId)) {
        defects.push(`${key}[${index}] does not identify an assertion ladder`);
      }
      const ladder = report.assertionLadders.find((candidate) => candidate.id === entry?.assertionId);
      if (!nonEmpty(entry?.assertion) || entry.assertion !== ladder?.assertion) {
        defects.push(`${key}[${index}] assertion text does not match its ladder`);
      }
      if (!nonEmpty(entry?.evidence) || !nonEmpty(entry?.scope)) {
        defects.push(`${key}[${index}] lacks exact evidence or scope`);
      }
      if (key === 'confirmed-risk' && (
        !nonEmpty(entry.badCase)
        || entry.badCase !== ladder?.badCase
        || !nonEmpty(entry.occurrenceOrNecessaryProduction)
      )) {
        defects.push(`${key}[${index}] lacks bad-case proof`);
      }
      if (key === 'unproven-assertion'
          && (!nonEmpty(entry.stoppingRung) || !nonEmpty(entry.reason) || !nonEmpty(entry.nextEvidence))) {
        defects.push(`${key}[${index}] lacks stopping evidence`);
      }
      if (ladderSemantics.get(entry?.assertionId)?.permittedClassification !== key) {
        defects.push(`${key}[${index}] contradicts ladder progression and outcomes`);
      }
      const semantic = ladderSemantics.get(entry?.assertionId);
      const evidenceSet = key === 'confirmed-risk'
        ? semantic?.badCaseEvidence
        : key === 'cleared-risk'
          ? semantic?.clearedEvidence
          : null;
      if (evidenceSet && !evidenceSet.some((candidate) =>
        candidate.evidence === entry.evidence && candidate.scope === entry.scope)) {
        defects.push(`${key}[${index}] evidence does not identify a decisive completed rung`);
      }
      if (key === 'unproven-assertion'
          && (entry.stoppingRung !== ladder?.stoppingRung
            || entry.reason !== ladder?.stoppingReason
            || entry.nextEvidence !== ladder?.nextEvidenceNeeded)) {
        defects.push(`${key}[${index}] stopping fields do not match its ladder`);
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
  if (report['regression-proof-status'] === 'selected') {
    if (Object.hasOwn(report, 'next-evidence-action')
        || Object.hasOwn(report, 'next-evidence-reason')) {
      defects.push('selected blast-radius report must not manufacture unavailable fields');
    }
  } else if (!Object.hasOwn(report, 'next-evidence-action')
      || !Object.hasOwn(report, 'next-evidence-reason')) {
    defects.push('unavailable blast-radius report must include its documented next-evidence fields');
  }

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
    baseSha: report?.revisions?.baseSha ?? null,
    headSha: report?.revisions?.headSha ?? null,
    receipt: report ?? null,
  };
}

export function deliveryStagesForManifest(manifest) {
  assertFleetManifest(manifest);
  if (manifest?.shepherdIntent === 'no') return DELIVERY_STAGES.slice(0, -1);
  return [...DELIVERY_STAGES];
}

export function recordStage(issueRecord, stage, evidence, revision, manifest) {
  assertFleetManifest(manifest);
  const stages = deliveryStagesForManifest(manifest);
  const index = stages.indexOf(stage);
  if (index < 0) throw new Error(`delivery stage is not required by manifest: ${stage}`);
  if (stage !== 'blast-radius-proof' && !revisionMatches(evidence, revision)) {
    throw new Error(`${stage} evidence is stale for current revision`);
  }
  if (stage === 'run-ci' && !adaptCiEvidence(evidence, revision).passed) {
    throw new Error('run-ci evidence does not pass');
  }
  if (stage === 'roast' && !adaptRoastEvidence(evidence, revision).complete) {
    throw new Error('Roast evidence does not pass');
  }
  if (stage === 'blast-radius-proof'
      && adaptBlastRadiusEvidence(evidence, revision).readiness !== 'satisfied') {
    throw new Error('blast-radius evidence does not satisfy readiness');
  }
  if (['implementation', 'diff-reconciliation', 'bounded-remediation'].includes(stage)
      && !simpleStagePasses(stage, evidence)) {
    throw new Error(`${stage} evidence does not semantically pass`);
  }
  if (stage === 'publication'
      && (evidence.status !== 'confirmed'
        || evidence.complete !== true
        || evidence.terminal !== true
        || !validTimestamp(evidence.observedAt))) {
    throw new Error('publication evidence is not confirmed');
  }
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

function humanDecisionFor(manifest, issue, criterion, receipt) {
  const decision = manifest.humanDecisions?.find((entry) => entry.id === receipt?.decisionId);
  if (!decision) return null;
  const expected = {
    decisionId: decision.id,
    actor: decision.actor,
    actorType: 'human',
    issue: decision.issue,
    criterionId: decision.criterionId,
    manifestDigest: decision.manifestDigest,
    sourceRevision: decision.sourceRevision,
    decision: decision.decision,
    decisionText: decision.decisionText,
    decidedAt: decision.decidedAt,
  };
  return JSON.stringify(receipt) === JSON.stringify(expected)
    && decision.issue === issue.identity
    && decision.criterionId === criterion.id
    ? decision
    : null;
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
      if (!humanDecisionFor(manifest, issue, criterion, receipt)) {
        defects.push(`criterion:${criterion.id}:invalid-human-decision-receipt`);
      }
    } else {
      defects.push(`criterion:${criterion.id}:${criterion.verdict ?? 'missing'}`);
    }
  }
  if (seen.size !== expected.size) defects.push('criteria:incomplete-set');
}

function evaluatePersistedStage(stage, entry, issueRecord, state, manifest, defects) {
  const revision = stage === 'shepherd' ? issueRecord.shepherd?.receipt : issueRecord;
  if (!entry?.evidence
      || (stage !== 'blast-radius-proof' && !revisionMatches(entry.evidence, revision))) {
    defects.push(`${stage}:stale-or-missing`);
    return;
  }
  if (stage === 'run-ci') {
    const adapted = adaptCiEvidence(entry.evidence, issueRecord, {
      runId: state.runId,
      issue: issueRecord.identity,
    });
    if (!adapted.passed) defects.push(`run-ci:${adapted.defects.join('|') || adapted.status}`);
  } else if (stage === 'roast') {
    const adapted = adaptRoastEvidence(entry.evidence, issueRecord, {
      runId: state.runId,
      issue: issueRecord.identity,
    });
    if (!adapted.complete) defects.push(`roast:${adapted.openMustFix.join(',') || adapted.defects.join('|')}`);
  } else if (stage === 'blast-radius-proof') {
    const adapted = adaptBlastRadiusEvidence(entry.evidence, issueRecord, {
      runId: state.runId,
      issue: issueRecord.identity,
    });
    if (adapted.readiness !== 'satisfied') defects.push(`blast-radius:${adapted.readiness}`);
  } else if (stage === 'criterion-verdict') {
    evaluateCriteria(entry.evidence.verdicts, issueRecord, manifest, issueRecord, defects);
  } else if (stage === 'publication') {
    const publication = state.publications?.find((candidate) =>
      candidate.key === entry.evidence.publicationKey
      && candidate.identifier === entry.evidence.changeRequest);
    const observation = publication?.observations?.find((candidate) =>
      candidate.baseSha === issueRecord.baseSha
      && candidate.headSha === issueRecord.headSha
      && candidate.state === 'confirmed');
    if (!publication
        || !observation
        || entry.evidence.status !== 'confirmed'
        || entry.evidence.terminal !== true
        || entry.evidence.complete !== true
        || entry.evidence.provider !== manifest.provider.name
        || entry.evidence.repository !== manifest.repository.id
        || entry.evidence.issue !== issueRecord.identity
        || entry.evidence.observedAt !== observation.confirmedAt
        || !validTimestamp(entry.evidence.observedAt)) {
      defects.push('publication:not-confirmed-for-current-revision');
    }
  } else if (stage === 'shepherd') {
    const semantic = persistedShepherdPasses(issueRecord, state, manifest);
    if (!semantic.passed) defects.push(`shepherd:${semantic.defects.join('|')}`);
  } else if (!simpleStagePasses(stage, entry.evidence)) {
    defects.push(`${stage}:incomplete-or-failed`);
  }
}

function evaluatePersistedStages(issueRecord, state, manifest, required) {
  const defects = [];
  const pipeline = issueRecord?.pipeline ?? [];
  if (pipeline.length !== required.length) defects.push('pipeline:incomplete');
  for (const [index, stage] of required.entries()) {
    const entry = pipeline[index];
    if (entry?.stage !== stage) {
      defects.push(`${stage}:missing-or-out-of-order`);
      continue;
    }
    evaluatePersistedStage(stage, entry, issueRecord, state, manifest, defects);
  }
  return { passed: defects.length === 0, defects };
}

export function persistedPipelinePasses(issueRecord, state, manifest) {
  assertFleetManifest(manifest);
  return evaluatePersistedStages(
    issueRecord,
    state,
    manifest,
    deliveryStagesForManifest(manifest),
  );
}

export function persistedPrePublicationPasses(issueRecord, state, manifest) {
  assertFleetManifest(manifest);
  const required = deliveryStagesForManifest(manifest);
  const publicationIndex = required.indexOf('publication');
  return evaluatePersistedStages(
    { ...issueRecord, pipeline: issueRecord.pipeline.slice(0, publicationIndex) },
    state,
    manifest,
    required.slice(0, publicationIndex),
  );
}

export function persistedPublicationPipelinePasses(issueRecord, state, manifest) {
  assertFleetManifest(manifest);
  const required = deliveryStagesForManifest(manifest);
  const shepherdIndex = required.indexOf('shepherd');
  const throughPublication = shepherdIndex < 0 ? required : required.slice(0, shepherdIndex);
  return evaluatePersistedStages(
    { ...issueRecord, pipeline: issueRecord.pipeline.slice(0, throughPublication.length) },
    state,
    manifest,
    throughPublication,
  );
}

export function evaluateQualityGate(input = {}) {
  const defects = [];
  const manifest = input.manifest;
  const revision = input.revision;
  const issue = manifest?.issues?.find((entry) => entry.identity === input.identity?.issue);
  if (!manifest || !revision || !issue) {
    return { readyForPublication: false, defects: ['quality-gate:missing-manifest-revision-or-issue'] };
  }
  try {
    assertFleetManifest(manifest);
  } catch (error) {
    return { readyForPublication: false, defects: [`quality-gate:${error.message}`] };
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
