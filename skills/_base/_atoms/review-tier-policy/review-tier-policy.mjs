#!/usr/bin/env node

import crypto from 'node:crypto';

export const REVIEW_TIER_POLICY_VERSION = 1;
export const REVIEW_MODES = Object.freeze(['full', 'tiered']);
export const EVALUATION_MODES = Object.freeze(['baseline', 'shadow', 'operational']);
export const SEMANTIC_ESCALATION_SIGNALS = Object.freeze([
  'scope',
  'authority',
  'permissions',
  'persistence',
  'recovery',
  'public-contract',
  'domain-meaning',
  'cumulative-assumption',
  'repeated-fix',
  'contradiction',
  'regression',
  'unexplained-impact',
]);
export const SEMANTIC_ASSESSMENT_CATEGORIES = Object.freeze(
  SEMANTIC_ESCALATION_SIGNALS.filter((entry) => entry !== 'repeated-fix'),
);

export const DEEP_REVIEW_ROUTE = Object.freeze({
  model: 'gpt-6-astra',
  fallbackModels: Object.freeze(['gpt-5.6-sol']),
  reasoningEffort: 'high',
  contextTier: 'default',
});

export const CORRECTION_REVIEW_ROUTE = Object.freeze({
  role: 'qa-reviewer',
  model: 'gpt-5.6-sol',
  fallbackModels: Object.freeze(['gpt-6-astra']),
  reasoningEffort: 'high',
  contextTier: 'default',
});

export class ReviewTierPolicyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReviewTierPolicyError';
    this.code = code;
  }
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ReviewTierPolicyError('invalid_input', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function exactKeys(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new ReviewTierPolicyError('invalid_input', `${field} schema is not exact`);
  }
}

function stringList(value, field, { nonEmptyList = false } = {}) {
  if (!Array.isArray(value) || (nonEmptyList && value.length === 0)) {
    throw new ReviewTierPolicyError('incomplete_evidence', `${field} must be ${nonEmptyList ? 'a non-empty' : 'an'} array`);
  }
  return value.map((entry, index) => nonEmpty(entry, `${field}[${index}]`));
}

function immutable(value) {
  const snapshot = structuredClone(value);
  const freeze = (entry) => {
    if (entry && typeof entry === 'object' && !Object.isFrozen(entry)) {
      Object.freeze(entry);
      for (const child of Object.values(entry)) freeze(child);
    }
    return entry;
  };
  return freeze(snapshot);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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

export function reviewPolicyBindingDigest({
  evaluationMode,
  deepRoute = DEEP_REVIEW_ROUTE,
  correctionRoute = CORRECTION_REVIEW_ROUTE,
} = {}) {
  return digest({
    mode: 'tiered',
    policyVersion: REVIEW_TIER_POLICY_VERSION,
    evaluationMode,
    deepRoute,
    correctionRoute,
  });
}

function exactDigest(value, field) {
  if (!/^[a-f0-9]{64}$/u.test(value ?? '')) {
    throw new ReviewTierPolicyError('invalid_input', `${field} must be a SHA-256 digest`);
  }
  return value;
}

function exactGitOid(value, field) {
  if (!/^[a-f0-9]{40}$/u.test(value ?? '')) {
    throw new ReviewTierPolicyError(
      'invalid_input',
      `${field} must be a canonical full lowercase Git object ID`,
    );
  }
  return value;
}

function route(value, expected, field) {
  exactKeys(value, Object.keys(expected), field);
  if (!same(value, expected)) {
    throw new ReviewTierPolicyError(
      'unconfirmed_model_route',
      `${field} must equal the human-confirmed full-strength route`,
    );
  }
  return structuredClone(expected);
}

export function normalizeReviewPolicy(value) {
  if (value === undefined || value === null) return immutable({ mode: 'full' });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReviewTierPolicyError('invalid_input', 'reviewPolicy must be an object');
  }
  if (value.mode === 'full') {
    exactKeys(value, ['mode'], 'reviewPolicy');
    return immutable({ mode: 'full' });
  }
  exactKeys(
    value,
    ['mode', 'policyVersion', 'evaluationMode', 'deepRoute', 'correctionRoute', 'promotionDecision'],
    'reviewPolicy',
  );
  if (value.mode !== 'tiered' || value.policyVersion !== REVIEW_TIER_POLICY_VERSION) {
    throw new ReviewTierPolicyError('invalid_input', 'reviewPolicy mode or version is invalid');
  }
  if (!EVALUATION_MODES.includes(value.evaluationMode)) {
    throw new ReviewTierPolicyError('invalid_input', 'reviewPolicy evaluationMode is invalid');
  }
  const deepRoute = route(value.deepRoute, DEEP_REVIEW_ROUTE, 'reviewPolicy.deepRoute');
  const correctionRoute = route(
    value.correctionRoute,
    CORRECTION_REVIEW_ROUTE,
    'reviewPolicy.correctionRoute',
  );
  const policyBindingDigest = reviewPolicyBindingDigest({
    evaluationMode: value.evaluationMode,
    deepRoute,
    correctionRoute,
  });
  let promotionDecision = null;
  if (value.evaluationMode === 'operational') {
    if (value.promotionDecision === null) {
      throw new ReviewTierPolicyError(
        'promotion_required',
        'operational tiering requires an explicit human promotion',
      );
    }
    exactKeys(value.promotionDecision, [
      'approved', 'actorType', 'actorId', 'decisionId', 'decidedAt',
      'packetDigest', 'policyBindingDigest',
    ], 'promotionDecision');
    if (value.promotionDecision.approved !== true
        || !Number.isFinite(Date.parse(value.promotionDecision.decidedAt))) {
      throw new ReviewTierPolicyError('promotion_required', 'operational tiering requires an explicit human promotion');
    }
    if (value.promotionDecision.actorType !== 'human') {
      throw new ReviewTierPolicyError('promotion_required', 'operational promotion must be human-owned');
    }
    const actorId = nonEmpty(value.promotionDecision.actorId, 'promotionDecision.actorId');
    if (['agent', 'self', 'system'].includes(actorId.toLowerCase())) {
      throw new ReviewTierPolicyError('promotion_required', 'operational promotion actor is not human-owned');
    }
    if (value.promotionDecision.policyBindingDigest !== policyBindingDigest) {
      throw new ReviewTierPolicyError('promotion_required', 'promotion policy binding does not match');
    }
    promotionDecision = {
      approved: true,
      actorType: 'human',
      actorId,
      decisionId: nonEmpty(value.promotionDecision.decisionId, 'promotionDecision.decisionId'),
      decidedAt: value.promotionDecision.decidedAt,
      packetDigest: exactDigest(value.promotionDecision.packetDigest, 'promotionDecision.packetDigest'),
      policyBindingDigest,
    };
  } else if (value.promotionDecision !== null) {
    throw new ReviewTierPolicyError('invalid_input', 'baseline and shadow policies must not carry promotion');
  }
  return immutable({
    mode: 'tiered',
    policyVersion: REVIEW_TIER_POLICY_VERSION,
    evaluationMode: value.evaluationMode,
    deepRoute,
    correctionRoute,
    promotionDecision,
  });
}

function identity(value, field) {
  exactKeys(
    value,
    ['baseSha', 'headSha', 'packetDigest', 'scopeDigest', 'sourceRevision'],
    field,
  );
  return {
    baseSha: exactGitOid(value.baseSha, `${field}.baseSha`),
    headSha: exactGitOid(value.headSha, `${field}.headSha`),
    packetDigest: exactDigest(value.packetDigest, `${field}.packetDigest`),
    scopeDigest: exactDigest(value.scopeDigest, `${field}.scopeDigest`),
    sourceRevision: nonEmpty(value.sourceRevision, `${field}.sourceRevision`),
  };
}

function semanticAssessment(value, field) {
  exactKeys(value, ['complete', 'categories', 'uncertainties'], field);
  if (value.complete !== true || !Array.isArray(value.categories)) {
    throw new ReviewTierPolicyError('incomplete_evidence', `${field} is incomplete`);
  }
  const categories = value.categories.map((entry, index) => {
    exactKeys(entry, ['category', 'changed', 'evidence'], `${field}.categories[${index}]`);
    if (!SEMANTIC_ASSESSMENT_CATEGORIES.includes(entry.category)
        || typeof entry.changed !== 'boolean') {
      throw new ReviewTierPolicyError('incomplete_evidence', `${field} category is invalid`);
    }
    return {
      category: entry.category,
      changed: entry.changed,
      evidence: nonEmpty(entry.evidence, `${field}.categories[${index}].evidence`),
    };
  });
  if (!same(
    [...new Set(categories.map((entry) => entry.category))].sort(),
    [...SEMANTIC_ASSESSMENT_CATEGORIES].sort(),
  )) {
    throw new ReviewTierPolicyError('incomplete_evidence', `${field} does not assess every semantic category`);
  }
  return {
    complete: true,
    categories,
    uncertainties: stringList(value.uncertainties, `${field}.uncertainties`),
  };
}

function delta(value, field, expectedBase, expectedHead, { pathsRequired = true } = {}) {
  exactKeys(value, [
    'baseSha', 'headSha', 'paths', 'evidenceComplete', 'semanticAssessment',
  ], field);
  const normalized = {
    baseSha: exactGitOid(value.baseSha, `${field}.baseSha`),
    headSha: exactGitOid(value.headSha, `${field}.headSha`),
    paths: stringList(value.paths, `${field}.paths`, { nonEmptyList: pathsRequired }),
    evidenceComplete: value.evidenceComplete,
    semanticAssessment: semanticAssessment(value.semanticAssessment, `${field}.semanticAssessment`),
  };
  if (normalized.evidenceComplete !== true
      || normalized.baseSha !== expectedBase || normalized.headSha !== expectedHead) {
    throw new ReviewTierPolicyError('incomplete_evidence', `${field} revision binding does not match`);
  }
  return normalized;
}

function reconcileDeltas(value, latestDelta, cumulativeDelta) {
  exactKeys(value, ['complete', 'revertedPaths', 'unexplainedPaths'], 'deltaReconciliation');
  if (value.complete !== true || !Array.isArray(value.revertedPaths)) {
    throw new ReviewTierPolicyError('incomplete_evidence', 'delta reconciliation is incomplete');
  }
  const reverted = new Map(value.revertedPaths.map((entry, index) => {
    exactKeys(entry, ['path', 'evidence'], `deltaReconciliation.revertedPaths[${index}]`);
    return [
      nonEmpty(entry.path, `deltaReconciliation.revertedPaths[${index}].path`),
      nonEmpty(entry.evidence, `deltaReconciliation.revertedPaths[${index}].evidence`),
    ];
  }));
  const unexplained = stringList(value.unexplainedPaths, 'deltaReconciliation.unexplainedPaths');
  const cumulative = new Set(cumulativeDelta.paths);
  const missing = latestDelta.paths.filter((path) => !cumulative.has(path) && !reverted.has(path));
  if (unexplained.length || missing.length) {
    throw new ReviewTierPolicyError('incomplete_evidence', 'latest and cumulative deltas are not completely reconciled');
  }
  return {
    complete: true,
    revertedPaths: [...reverted].map(([path, evidence]) => ({ path, evidence })),
    unexplainedPaths: [],
  };
}

export function classifyReviewTier(input = {}) {
  const policy = normalizeReviewPolicy(input.policy);
  if (policy.mode === 'full') {
    return immutable({ outcome: 'full', reason: 'default-full', policy });
  }
  if (!input.lastDeep) {
    return immutable({ outcome: 'full', reason: 'initial-deep-review-required', policy });
  }
  const current = identity(input.current, 'current');
  if (policy.evaluationMode === 'operational'
      && policy.promotionDecision.packetDigest !== current.packetDigest) {
    return immutable({ outcome: 'needs-human', reason: 'promotion-packet-mismatch', policy });
  }
  const lastDeep = identity(input.lastDeep, 'lastDeep');
  if (lastDeep.baseSha !== current.baseSha
      || lastDeep.packetDigest !== current.packetDigest
      || lastDeep.scopeDigest !== current.scopeDigest
      || lastDeep.sourceRevision !== current.sourceRevision) {
    return immutable({ outcome: 'full-review-required', reason: 'deep-lineage-mismatch', policy });
  }
  if (lastDeep.headSha === current.headSha) {
    return immutable({ outcome: 'full-review-required', reason: 'no-correction-head', policy });
  }
  const previousHead = exactGitOid(input.previousHead, 'previousHead');
  const latestDelta = delta(input.latestDelta, 'latestDelta', previousHead, current.headSha);
  const cumulativeDelta = delta(
    input.cumulativeDelta,
    'cumulativeDelta',
    lastDeep.headSha,
    current.headSha,
    { pathsRequired: false },
  );
  const deltaReconciliation = reconcileDeltas(
    input.deltaReconciliation,
    latestDelta,
    cumulativeDelta,
  );
  stringList(input.requirements, 'requirements', { nonEmptyList: true });
  stringList(input.originalFindingIds, 'originalFindingIds', { nonEmptyList: true });
  stringList(input.affectedConsumers, 'affectedConsumers', { nonEmptyList: true });
  exactKeys(input.validation, ['headSha', 'complete'], 'validation');
  if (input.validation.complete !== true || input.validation.headSha !== current.headSha) {
    return immutable({ outcome: 'incomplete-evidence', reason: 'current-validation-incomplete', policy });
  }
  if (!Number.isInteger(input.remediationAttempt) || input.remediationAttempt < 1) {
    throw new ReviewTierPolicyError('invalid_input', 'remediationAttempt must be a positive integer');
  }
  const signals = [...new Set([
    ...latestDelta.semanticAssessment.categories
      .filter((entry) => entry.changed)
      .map((entry) => entry.category),
    ...cumulativeDelta.semanticAssessment.categories
      .filter((entry) => entry.changed)
      .map((entry) => entry.category),
    ...(input.remediationAttempt > 1 ? ['repeated-fix'] : []),
  ])];
  const uncertainties = [
    ...latestDelta.semanticAssessment.uncertainties,
    ...cumulativeDelta.semanticAssessment.uncertainties,
  ];
  if (uncertainties.length) {
    return immutable({ outcome: 'full-review-required', reason: 'semantic-uncertainty', uncertainties, policy });
  }
  if (signals.length) {
    return immutable({ outcome: 'full-review-required', reason: 'semantic-escalation', signals, policy });
  }
  if (policy.evaluationMode === 'baseline') {
    return immutable({ outcome: 'full', reason: 'baseline-measurement', policy });
  }
  return immutable({
    outcome: 'correction-verification',
    reason: policy.evaluationMode === 'shadow' ? 'shadow-comparison' : 'promoted-fast-path',
    shadowFullReference: policy.evaluationMode === 'shadow',
    policy,
    current,
    lastDeep,
    latestDelta,
    cumulativeDelta,
    deltaReconciliation,
  });
}

export async function executeTieredReview({
  input,
  fullReview,
  correctionReview,
} = {}) {
  if (typeof fullReview !== 'function' || typeof correctionReview !== 'function') {
    throw new ReviewTierPolicyError('invalid_input', 'review callbacks are required');
  }
  const decision = classifyReviewTier(input);
  if (decision.outcome !== 'correction-verification') {
    if (['full', 'full-review-required'].includes(decision.outcome)) {
      return immutable({
        decision,
        correction: null,
        full: await fullReview(decision),
        authoritative: 'full',
      });
    }
    return immutable({ decision, correction: null, full: null, authoritative: 'none' });
  }
  const correction = await correctionReview(decision);
  if (!correction || !['complete', 'escalate-full', 'needs-human'].includes(correction.status)) {
    throw new ReviewTierPolicyError('invalid_correction_receipt', 'correction review receipt is invalid');
  }
  if (correction.status === 'needs-human') {
    return immutable({ decision, correction, full: null, authoritative: 'none' });
  }
  if (correction.status === 'escalate-full' || decision.shadowFullReference) {
    return immutable({
      decision,
      correction,
      full: await fullReview(decision),
      authoritative: 'full',
    });
  }
  return immutable({ decision, correction, full: null, authoritative: 'correction' });
}

function measurement(value, field) {
  exactKeys(value, ['headSha', 'durationMs', 'dispatchCount', 'findingIds', 'modelId'], field);
  if (!Number.isFinite(value.durationMs) || value.durationMs < 0
      || !Number.isInteger(value.dispatchCount) || value.dispatchCount < 1) {
    throw new ReviewTierPolicyError('invalid_input', `${field} timing or dispatch count is invalid`);
  }
  return {
    headSha: nonEmpty(value.headSha, `${field}.headSha`),
    durationMs: value.durationMs,
    dispatchCount: value.dispatchCount,
    findingIds: stringList(value.findingIds, `${field}.findingIds`),
    modelId: nonEmpty(value.modelId, `${field}.modelId`),
  };
}

export function compareReviewWork({ full, correction } = {}) {
  const fullResult = measurement(full, 'full');
  const correctionResult = measurement(correction, 'correction');
  if (fullResult.headSha !== correctionResult.headSha) {
    throw new ReviewTierPolicyError('stale_comparison', 'review comparison heads do not match');
  }
  const fullFindings = new Set(fullResult.findingIds);
  const correctionFindings = new Set(correctionResult.findingIds);
  return immutable({
    headSha: fullResult.headSha,
    durationDeltaMs: fullResult.durationMs - correctionResult.durationMs,
    dispatchReduction: fullResult.dispatchCount - correctionResult.dispatchCount,
    missedByCorrection: fullResult.findingIds.filter((id) => !correctionFindings.has(id)),
    correctionOnly: correctionResult.findingIds.filter((id) => !fullFindings.has(id)),
    modelProfileComparison: fullResult.modelId === correctionResult.modelId
      ? 'same-model-profile-only'
      : 'different-model-profiles-observed',
    promotion: 'human-only',
  });
}
