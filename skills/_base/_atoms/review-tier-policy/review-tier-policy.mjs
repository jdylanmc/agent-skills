#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const REVIEW_TIER_POLICY_VERSION = 2;
export const LEGACY_REVIEW_TIER_POLICY_VERSION = 1;
export const DEFAULT_CHURN_THRESHOLD_PERCENT = 20;
export const REVIEW_MODES = Object.freeze([
  'full',
  'tiered',
  'deep-then-verify',
  'repeated-full',
]);
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
  policyVersion = LEGACY_REVIEW_TIER_POLICY_VERSION,
  mode = 'tiered',
  evaluationMode,
  churnThresholdPercent = null,
  deepRoute = DEEP_REVIEW_ROUTE,
  correctionRoute = CORRECTION_REVIEW_ROUTE,
} = {}) {
  return digest(policyVersion === LEGACY_REVIEW_TIER_POLICY_VERSION
    ? {
      mode: 'tiered',
      policyVersion: LEGACY_REVIEW_TIER_POLICY_VERSION,
      evaluationMode,
      deepRoute,
      correctionRoute,
    }
    : {
      mode,
      policyVersion: REVIEW_TIER_POLICY_VERSION,
      churnThresholdPercent,
      deepRoute,
      ...(mode === 'deep-then-verify' ? { correctionRoute } : {}),
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
  if (value.policyVersion === REVIEW_TIER_POLICY_VERSION) {
    if (value.mode === 'repeated-full') {
      exactKeys(value, ['mode', 'policyVersion', 'deepRoute'], 'reviewPolicy');
      return immutable({
        mode: 'repeated-full',
        policyVersion: REVIEW_TIER_POLICY_VERSION,
        deepRoute: route(value.deepRoute, DEEP_REVIEW_ROUTE, 'reviewPolicy.deepRoute'),
      });
    }
    exactKeys(
      value,
      ['mode', 'policyVersion', 'churnThresholdPercent', 'deepRoute', 'correctionRoute'],
      'reviewPolicy',
    );
    if (value.mode !== 'deep-then-verify') {
      throw new ReviewTierPolicyError('invalid_input', 'version 2 reviewPolicy mode is invalid');
    }
    if (!Number.isFinite(value.churnThresholdPercent)
        || value.churnThresholdPercent < 0
        || value.churnThresholdPercent > 100) {
      throw new ReviewTierPolicyError(
        'invalid_input',
        'reviewPolicy churnThresholdPercent must be between 0 and 100',
      );
    }
    return immutable({
      mode: 'deep-then-verify',
      policyVersion: REVIEW_TIER_POLICY_VERSION,
      churnThresholdPercent: value.churnThresholdPercent,
      deepRoute: route(value.deepRoute, DEEP_REVIEW_ROUTE, 'reviewPolicy.deepRoute'),
      correctionRoute: route(
        value.correctionRoute,
        CORRECTION_REVIEW_ROUTE,
        'reviewPolicy.correctionRoute',
      ),
    });
  }
  exactKeys(
    value,
    ['mode', 'policyVersion', 'evaluationMode', 'deepRoute', 'correctionRoute', 'promotionDecision'],
    'reviewPolicy',
  );
  if (value.mode !== 'tiered'
      || value.policyVersion !== LEGACY_REVIEW_TIER_POLICY_VERSION) {
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
    policyVersion: LEGACY_REVIEW_TIER_POLICY_VERSION,
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
    policyVersion: LEGACY_REVIEW_TIER_POLICY_VERSION,
    evaluationMode: value.evaluationMode,
    deepRoute,
    correctionRoute,
    promotionDecision,
  });
}

export function newCodeReviewDefaultPolicy({
  churnThresholdPercent = DEFAULT_CHURN_THRESHOLD_PERCENT,
} = {}) {
  return normalizeReviewPolicy({
    mode: 'deep-then-verify',
    policyVersion: REVIEW_TIER_POLICY_VERSION,
    churnThresholdPercent,
    deepRoute: DEEP_REVIEW_ROUTE,
    correctionRoute: CORRECTION_REVIEW_ROUTE,
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

function fileScopeAssessment(value) {
  exactKeys(value, ['complete', 'newOrOutOfScopeFiles', 'evidence'], 'fileScopeAssessment');
  if (value.complete !== true || typeof value.newOrOutOfScopeFiles !== 'boolean') {
    throw new ReviewTierPolicyError('incomplete_evidence', 'fileScopeAssessment is incomplete');
  }
  return {
    complete: true,
    newOrOutOfScopeFiles: value.newOrOutOfScopeFiles,
    evidence: nonEmpty(value.evidence, 'fileScopeAssessment.evidence'),
  };
}

function churnMeasurement(value, field, expectedBase, expectedHead) {
  exactKeys(
    value,
    ['baseSha', 'headSha', 'status', 'addedLines', 'deletedLines', 'totalLines'],
    field,
  );
  const normalized = {
    baseSha: exactGitOid(value.baseSha, `${field}.baseSha`),
    headSha: exactGitOid(value.headSha, `${field}.headSha`),
    status: nonEmpty(value.status, `${field}.status`),
    addedLines: value.addedLines,
    deletedLines: value.deletedLines,
    totalLines: value.totalLines,
  };
  if (normalized.baseSha !== expectedBase || normalized.headSha !== expectedHead) {
    throw new ReviewTierPolicyError('incomplete_evidence', `${field} revision binding does not match`);
  }
  if (!['complete', 'zero', 'binary', 'unavailable'].includes(normalized.status)) {
    throw new ReviewTierPolicyError('incomplete_evidence', `${field} status is invalid`);
  }
  for (const count of ['addedLines', 'deletedLines', 'totalLines']) {
    if (!Number.isInteger(normalized[count]) || normalized[count] < 0) {
      throw new ReviewTierPolicyError('incomplete_evidence', `${field}.${count} is invalid`);
    }
  }
  if (normalized.totalLines !== normalized.addedLines + normalized.deletedLines) {
    throw new ReviewTierPolicyError('incomplete_evidence', `${field} line totals do not reconcile`);
  }
  return normalized;
}

function assessChurn(value, current, lastDeep, thresholdPercent) {
  exactKeys(value, ['baseline', 'cumulative'], 'churnMetrics');
  const baseline = churnMeasurement(
    value.baseline,
    'churnMetrics.baseline',
    current.baseSha,
    lastDeep.headSha,
  );
  const cumulative = churnMeasurement(
    value.cumulative,
    'churnMetrics.cumulative',
    lastDeep.headSha,
    current.headSha,
  );
  if (baseline.status !== 'complete'
      || cumulative.status !== 'complete'
      || baseline.totalLines === 0) {
    return {
      outcome: 'full-review-required',
      reason: `churn-metrics-${baseline.totalLines === 0 ? 'zero-baseline' : baseline.status !== 'complete' ? baseline.status : cumulative.status}`,
      baseline,
      cumulative,
    };
  }
  const ratioPercent = (cumulative.totalLines * 100) / baseline.totalLines;
  return {
    outcome: ratioPercent > thresholdPercent
      ? 'full-review-required'
      : 'correction-verification',
    reason: ratioPercent > thresholdPercent ? 'cumulative-line-churn-exceeded' : 'cumulative-line-churn-within-threshold',
    thresholdPercent,
    ratioPercent,
    baseline,
    cumulative,
  };
}

function deepReviewInput(input, current) {
  return immutable({
    current,
    manualDeepRequested: input.manualDeepRequested === true,
    requirements: Array.isArray(input.requirements) ? [...input.requirements] : [],
    affectedConsumers: Array.isArray(input.affectedConsumers)
      ? [...input.affectedConsumers]
      : [],
  });
}

export function classifyReviewTier(input = {}) {
  const policy = normalizeReviewPolicy(input.policy);
  if (policy.mode === 'full') {
    return immutable({ outcome: 'full', reason: 'default-full', policy });
  }
  const version2 = policy.policyVersion === REVIEW_TIER_POLICY_VERSION;
  const current = version2 ? identity(input.current, 'current') : null;
  const normalizedReviewInput = version2 ? deepReviewInput(input, current) : null;
  if (policy.mode === 'repeated-full') {
    return immutable({
      outcome: 'full',
      reason: 'explicit-repeated-full',
      policy,
      current,
      reviewInput: normalizedReviewInput,
    });
  }
  if (input.manualDeepRequested !== undefined
      && typeof input.manualDeepRequested !== 'boolean') {
    throw new ReviewTierPolicyError('invalid_input', 'manualDeepRequested must be boolean');
  }
  if (input.manualDeepRequested === true) {
    return immutable({
      outcome: 'full',
      reason: 'manual-deep-request',
      policy,
      current,
      reviewInput: normalizedReviewInput,
    });
  }
  if (!input.lastDeep) {
    return immutable({
      outcome: 'full',
      reason: 'initial-deep-review-required',
      policy,
      ...(version2 ? { current, reviewInput: normalizedReviewInput } : {}),
    });
  }
  const resolvedCurrent = current ?? identity(input.current, 'current');
  if (policy.policyVersion === LEGACY_REVIEW_TIER_POLICY_VERSION
      && policy.evaluationMode === 'operational'
      && policy.promotionDecision.packetDigest !== resolvedCurrent.packetDigest) {
    return immutable({ outcome: 'needs-human', reason: 'promotion-packet-mismatch', policy });
  }
  const lastDeep = identity(input.lastDeep, 'lastDeep');
  if (lastDeep.baseSha !== resolvedCurrent.baseSha
      || lastDeep.packetDigest !== resolvedCurrent.packetDigest
      || lastDeep.scopeDigest !== resolvedCurrent.scopeDigest
      || lastDeep.sourceRevision !== resolvedCurrent.sourceRevision) {
    return immutable({
      outcome: 'full-review-required',
      reason: 'deep-lineage-mismatch',
      policy,
      ...(version2 ? { current: resolvedCurrent, reviewInput: normalizedReviewInput } : {}),
    });
  }
  if (lastDeep.headSha === resolvedCurrent.headSha) {
    return immutable({
      outcome: 'full-review-required',
      reason: 'no-correction-head',
      policy,
      ...(version2 ? { current: resolvedCurrent, reviewInput: normalizedReviewInput } : {}),
    });
  }
  const previousHead = exactGitOid(input.previousHead, 'previousHead');
  const latestDelta = delta(input.latestDelta, 'latestDelta', previousHead, resolvedCurrent.headSha);
  const cumulativeDelta = delta(
    input.cumulativeDelta,
    'cumulativeDelta',
    lastDeep.headSha,
    resolvedCurrent.headSha,
    { pathsRequired: false },
  );
  const deltaReconciliation = reconcileDeltas(
    input.deltaReconciliation,
    latestDelta,
    cumulativeDelta,
  );
  const scopeAssessment = policy.policyVersion === REVIEW_TIER_POLICY_VERSION
    ? fileScopeAssessment(input.fileScopeAssessment)
    : { complete: true, newOrOutOfScopeFiles: false, evidence: 'legacy-v1-policy' };
  if (scopeAssessment.newOrOutOfScopeFiles) {
    return immutable({
      outcome: 'full-review-required',
      reason: 'file-scope-change',
      fileScopeAssessment: scopeAssessment,
      policy,
      current: resolvedCurrent,
      reviewInput: normalizedReviewInput,
    });
  }
  stringList(input.requirements, 'requirements', { nonEmptyList: true });
  stringList(input.originalFindingIds, 'originalFindingIds', { nonEmptyList: true });
  stringList(input.affectedConsumers, 'affectedConsumers', { nonEmptyList: true });
  exactKeys(input.validation, ['headSha', 'complete'], 'validation');
  if (input.validation.complete !== true || input.validation.headSha !== resolvedCurrent.headSha) {
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
    return immutable({
      outcome: 'full-review-required',
      reason: 'semantic-uncertainty',
      uncertainties,
      policy,
      ...(version2 ? { current: resolvedCurrent, reviewInput: normalizedReviewInput } : {}),
    });
  }
  if (signals.length) {
    return immutable({
      outcome: 'full-review-required',
      reason: 'semantic-escalation',
      signals,
      policy,
      ...(version2 ? { current: resolvedCurrent, reviewInput: normalizedReviewInput } : {}),
    });
  }
  if (policy.policyVersion === LEGACY_REVIEW_TIER_POLICY_VERSION
      && policy.evaluationMode === 'baseline') {
    return immutable({ outcome: 'full', reason: 'baseline-measurement', policy });
  }
  if (policy.policyVersion === REVIEW_TIER_POLICY_VERSION) {
    const churn = assessChurn(
      input.churnMetrics,
      resolvedCurrent,
      lastDeep,
      policy.churnThresholdPercent,
    );
    if (churn.outcome !== 'correction-verification') {
      return immutable({
        ...churn,
        policy,
        current: resolvedCurrent,
        reviewInput: normalizedReviewInput,
      });
    }
    return immutable({
      outcome: 'correction-verification',
      reason: churn.reason,
      shadowFullReference: false,
      policy,
      current: resolvedCurrent,
      lastDeep,
      latestDelta,
      cumulativeDelta,
      deltaReconciliation,
      fileScopeAssessment: scopeAssessment,
      churn,
    });
  }
  return immutable({
    outcome: 'correction-verification',
    reason: policy.evaluationMode === 'shadow' ? 'shadow-comparison' : 'promoted-fast-path',
    shadowFullReference: policy.evaluationMode === 'shadow',
    policy,
    current: resolvedCurrent,
    lastDeep,
    latestDelta,
    cumulativeDelta,
    deltaReconciliation,
  });
}

export function measureGitLineChurn({
  repositoryRoot,
  baseSha,
  headSha,
  runGit = null,
} = {}) {
  const base = exactGitOid(baseSha, 'baseSha');
  const head = exactGitOid(headSha, 'headSha');
  const runner = runGit ?? ((cwd, args) => execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_EXTERNAL_DIFF: '' },
  }));
  let output;
  try {
    output = runner(repositoryRoot, [
      'diff',
      '--numstat',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      base,
      head,
      '--',
    ]);
  } catch {
    return immutable({
      baseSha: base,
      headSha: head,
      status: 'unavailable',
      addedLines: 0,
      deletedLines: 0,
      totalLines: 0,
    });
  }
  let addedLines = 0;
  let deletedLines = 0;
  let binary = false;
  for (const line of String(output).trim().split('\n').filter(Boolean)) {
    const [added, deleted] = line.split('\t', 3);
    if (added === '-' || deleted === '-') {
      binary = true;
      continue;
    }
    if (!/^\d+$/u.test(added) || !/^\d+$/u.test(deleted)) {
      return immutable({
        baseSha: base,
        headSha: head,
        status: 'unavailable',
        addedLines: 0,
        deletedLines: 0,
        totalLines: 0,
      });
    }
    addedLines += Number(added);
    deletedLines += Number(deleted);
  }
  const totalLines = addedLines + deletedLines;
  return immutable({
    baseSha: base,
    headSha: head,
    status: binary ? 'binary' : totalLines === 0 ? 'zero' : 'complete',
    addedLines,
    deletedLines,
    totalLines,
  });
}

export function measureReviewChurn({
  repositoryRoot,
  reviewBaseSha,
  lastDeepHead,
  currentHead,
  runGit = null,
} = {}) {
  return immutable({
    baseline: measureGitLineChurn({
      repositoryRoot,
      baseSha: reviewBaseSha,
      headSha: lastDeepHead,
      runGit,
    }),
    cumulative: measureGitLineChurn({
      repositoryRoot,
      baseSha: lastDeepHead,
      headSha: currentHead,
      runGit,
    }),
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
