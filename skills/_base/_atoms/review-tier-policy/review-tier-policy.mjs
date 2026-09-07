#!/usr/bin/env node

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
  let promotionDecision = null;
  if (value.evaluationMode === 'operational') {
    if (value.promotionDecision === null) {
      throw new ReviewTierPolicyError(
        'promotion_required',
        'operational tiering requires an explicit human promotion',
      );
    }
    exactKeys(value.promotionDecision, ['approved', 'actor', 'decisionId', 'decidedAt'], 'promotionDecision');
    if (value.promotionDecision.approved !== true
        || !Number.isFinite(Date.parse(value.promotionDecision.decidedAt))) {
      throw new ReviewTierPolicyError('promotion_required', 'operational tiering requires an explicit human promotion');
    }
    promotionDecision = {
      approved: true,
      actor: nonEmpty(value.promotionDecision.actor, 'promotionDecision.actor'),
      decisionId: nonEmpty(value.promotionDecision.decisionId, 'promotionDecision.decisionId'),
      decidedAt: value.promotionDecision.decidedAt,
    };
  } else if (value.promotionDecision !== null) {
    throw new ReviewTierPolicyError('invalid_input', 'baseline and shadow policies must not carry promotion');
  }
  return immutable({
    mode: 'tiered',
    policyVersion: REVIEW_TIER_POLICY_VERSION,
    evaluationMode: value.evaluationMode,
    deepRoute: route(value.deepRoute, DEEP_REVIEW_ROUTE, 'reviewPolicy.deepRoute'),
    correctionRoute: route(
      value.correctionRoute,
      CORRECTION_REVIEW_ROUTE,
      'reviewPolicy.correctionRoute',
    ),
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
    baseSha: nonEmpty(value.baseSha, `${field}.baseSha`),
    headSha: nonEmpty(value.headSha, `${field}.headSha`),
    packetDigest: nonEmpty(value.packetDigest, `${field}.packetDigest`),
    scopeDigest: nonEmpty(value.scopeDigest, `${field}.scopeDigest`),
    sourceRevision: nonEmpty(value.sourceRevision, `${field}.sourceRevision`),
  };
}

function delta(value, field, expectedBase, expectedHead) {
  exactKeys(value, ['baseSha', 'headSha', 'paths', 'semanticSignals'], field);
  const normalized = {
    baseSha: nonEmpty(value.baseSha, `${field}.baseSha`),
    headSha: nonEmpty(value.headSha, `${field}.headSha`),
    paths: stringList(value.paths, `${field}.paths`, { nonEmptyList: true }),
    semanticSignals: stringList(value.semanticSignals, `${field}.semanticSignals`),
  };
  if (normalized.baseSha !== expectedBase || normalized.headSha !== expectedHead) {
    throw new ReviewTierPolicyError('incomplete_evidence', `${field} revision binding does not match`);
  }
  return normalized;
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
  const latestDelta = delta(input.latestDelta, 'latestDelta', input.previousHead, current.headSha);
  const cumulativeDelta = delta(
    input.cumulativeDelta,
    'cumulativeDelta',
    lastDeep.headSha,
    current.headSha,
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
    ...latestDelta.semanticSignals,
    ...cumulativeDelta.semanticSignals,
    ...(input.remediationAttempt > 1 ? ['repeated-fix'] : []),
  ])];
  const unknown = signals.filter((entry) => !SEMANTIC_ESCALATION_SIGNALS.includes(entry));
  if (unknown.length) {
    return immutable({ outcome: 'needs-human', reason: 'unclassified-semantic-signal', signals: unknown, policy });
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
