#!/usr/bin/env node

import {
  dispatchModelRoleAgent,
} from '../../../_base/_atoms/agent-spawn/agent-spawn.mjs';
import {
  CORRECTION_REVIEW_ROUTE,
  DEEP_REVIEW_ROUTE,
  executeTieredReview,
} from '../../../_base/_atoms/review-tier-policy/review-tier-policy.mjs';
import {
  resolveBundledRoastRoster,
  resolveBundledRoastmasterRoute,
} from '../code-reviewer-panel/code-reviewer-panel.mjs';

const STATUSES = new Set(['complete', 'escalate-full', 'needs-human']);
const DISPOSITIONS = new Set([
  'addressed',
  'not-addressed',
  'original-finding-unsupported',
  'uncertain',
]);

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${field} is required`);
  return value.trim();
}

function exactKeys(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${field} schema is not exact`);
  }
}

function requireRuntimeInventory(value) {
  if (!Array.isArray(value) && !(value instanceof Set)) {
    throw new Error('runtimeAvailableModels must be an observed inventory');
  }
  return value;
}

function exactCoverage(actual, expected, field) {
  if (!sameSet(actual, expected)) throw new Error(`correction review ${field} coverage does not match`);
}

function sameSet(left, right) {
  return left.length === right.length
    && new Set(left).size === left.length
    && new Set(right).size === right.length
    && left.every((entry) => new Set(right).has(entry));
}

export function validateCorrectionReview(receipt, reviewInput) {
  const expectedHead = nonEmpty(reviewInput?.current?.headSha, 'reviewInput.current.headSha');
  const expectedFindings = reviewInput.originalFindingIds ?? [];
  const expectedRequirements = reviewInput.requirements ?? [];
  const expectedConsumers = reviewInput.affectedConsumers ?? [];
  exactKeys(receipt, [
    'schemaVersion', 'status', 'headSha', 'findingDispositions',
    'requirementChecks', 'affectedConsumersReviewed', 'regressions',
    'newFindings', 'uncertainties',
  ], 'correction review');
  if (receipt.schemaVersion !== 1 || !STATUSES.has(receipt.status)) {
    throw new Error('correction review status or schema version is invalid');
  }
  if (receipt.headSha !== expectedHead) throw new Error('correction review head is stale');
  for (const field of [
    'findingDispositions', 'requirementChecks', 'affectedConsumersReviewed',
    'regressions', 'newFindings', 'uncertainties',
  ]) {
    if (!Array.isArray(receipt[field])) throw new Error(`correction review ${field} must be an array`);
  }
  if (receipt.requirementChecks.length === 0 || receipt.affectedConsumersReviewed.length === 0) {
    throw new Error('correction review omitted requirements or affected consumers');
  }
  for (const [index, disposition] of receipt.findingDispositions.entries()) {
    exactKeys(disposition, ['findingId', 'disposition', 'evidence', 'reasoning'], `findingDispositions[${index}]`);
    nonEmpty(disposition.findingId, `findingDispositions[${index}].findingId`);
    if (!DISPOSITIONS.has(disposition.disposition)) throw new Error('correction disposition is invalid');
    nonEmpty(disposition.evidence, `findingDispositions[${index}].evidence`);
    nonEmpty(disposition.reasoning, `findingDispositions[${index}].reasoning`);
  }
  exactCoverage(
    receipt.findingDispositions.map((entry) => entry.findingId),
    expectedFindings,
    'finding',
  );
  for (const [index, check] of receipt.requirementChecks.entries()) {
    exactKeys(check, ['requirement', 'status', 'evidence', 'negativeCases'], `requirementChecks[${index}]`);
    nonEmpty(check.requirement, `requirementChecks[${index}].requirement`);
    if (!['satisfied', 'not-satisfied', 'uncertain'].includes(check.status)) {
      throw new Error('correction requirement status is invalid');
    }
    nonEmpty(check.evidence, `requirementChecks[${index}].evidence`);
    if (!Array.isArray(check.negativeCases) || check.negativeCases.length === 0
        || check.negativeCases.some((entry) => !nonEmpty(entry))) {
      throw new Error('correction requirement negative cases are incomplete');
    }
  }
  exactCoverage(
    receipt.requirementChecks.map((entry) => entry.requirement),
    expectedRequirements,
    'requirement',
  );
  for (const [index, consumer] of receipt.affectedConsumersReviewed.entries()) {
    exactKeys(consumer, ['consumer', 'status', 'evidence'], `affectedConsumersReviewed[${index}]`);
    nonEmpty(consumer.consumer, `affectedConsumersReviewed[${index}].consumer`);
    if (!['satisfied', 'regressed', 'uncertain'].includes(consumer.status)) {
      throw new Error('correction consumer status is invalid');
    }
    nonEmpty(consumer.evidence, `affectedConsumersReviewed[${index}].evidence`);
  }
  exactCoverage(
    receipt.affectedConsumersReviewed.map((entry) => entry.consumer),
    expectedConsumers,
    'consumer',
  );
  for (const [index, regression] of receipt.regressions.entries()) {
    exactKeys(regression, ['id', 'evidence', 'impact'], `regressions[${index}]`);
    nonEmpty(regression.id, `regressions[${index}].id`);
    nonEmpty(regression.evidence, `regressions[${index}].evidence`);
    nonEmpty(regression.impact, `regressions[${index}].impact`);
  }
  for (const [index, finding] of receipt.newFindings.entries()) {
    exactKeys(finding, ['id', 'evidence', 'priority'], `newFindings[${index}]`);
    nonEmpty(finding.id, `newFindings[${index}].id`);
    nonEmpty(finding.evidence, `newFindings[${index}].evidence`);
    nonEmpty(finding.priority, `newFindings[${index}].priority`);
  }
  if (receipt.uncertainties.some((entry) => !nonEmpty(entry))) {
    throw new Error('correction review uncertainty is invalid');
  }
  if (receipt.status === 'complete'
      && (receipt.regressions.length || receipt.uncertainties.length
        || receipt.newFindings.length
        || receipt.findingDispositions.some((entry) =>
          ['not-addressed', 'uncertain'].includes(entry.disposition))
        || receipt.requirementChecks.some((entry) => entry.status !== 'satisfied')
        || receipt.affectedConsumersReviewed.some((entry) => entry.status !== 'satisfied'))) {
    throw new Error('complete correction review contains unresolved evidence');
  }
  return structuredClone(receipt);
}

export async function dispatchCorrectionReview({
  reviewInput,
  runtimeAvailableModels,
  transport,
} = {}) {
  if (!reviewInput || typeof reviewInput !== 'object' || Array.isArray(reviewInput)) {
    throw new Error('reviewInput is required');
  }
  const headSha = nonEmpty(reviewInput.current?.headSha, 'reviewInput.current.headSha');
  requireRuntimeInventory(runtimeAvailableModels);
  const prompt = JSON.stringify({
    mode: 'correction-verification',
    instruction: 'Verify the underlying requirements, fix correctness, negative cases, affected consumers, and regressions. The original finding may be wrong. Escalate uncertainty.',
    evidence: reviewInput,
    outputSchema: {
      schemaVersion: 1,
      status: ['complete', 'escalate-full', 'needs-human'],
      headSha,
      findingDispositions: [],
      requirementChecks: [],
      affectedConsumersReviewed: [],
      regressions: [],
      newFindings: [],
      uncertainties: [],
    },
  });
  const dispatched = await dispatchModelRoleAgent({
    role: 'qa-reviewer',
    inlineDefault: {
      model: CORRECTION_REVIEW_ROUTE.model,
      fallbackModels: CORRECTION_REVIEW_ROUTE.fallbackModels,
      reasoningEffort: CORRECTION_REVIEW_ROUTE.reasoningEffort,
      contextTier: CORRECTION_REVIEW_ROUTE.contextTier,
    },
    userModelRoles: {
      'qa-reviewer': {
        model: CORRECTION_REVIEW_ROUTE.model,
        fallbackModels: CORRECTION_REVIEW_ROUTE.fallbackModels,
        reasoningEffort: CORRECTION_REVIEW_ROUTE.reasoningEffort,
        contextTier: CORRECTION_REVIEW_ROUTE.contextTier,
      },
    },
    runtimeAvailableModels,
    prompt,
    persona: null,
    tools: ['read', 'search'],
    transport,
  });
  if (dispatched.status !== 'Complete') {
    return {
      status: dispatched.status === 'No model available'
        ? 'tiered-review-unavailable'
        : 'needs-human',
      dispatch: dispatched,
      review: null,
    };
  }
  let parsed;
  try {
    parsed = JSON.parse(dispatched.response);
  } catch {
    throw new Error('correction review response is not JSON');
  }
  return {
    status: 'complete',
    dispatch: dispatched,
    review: validateCorrectionReview(parsed, reviewInput),
  };
}

export async function runTieredCodeReview({
  input,
  runtimeAvailableModels,
  correctionTransport,
  fullReview,
  root,
} = {}) {
  return executeTieredReview({
    input,
    fullReview: async (decision) => fullReview(
      decision,
      resolveTieredDeepReviewRouting({ root, runtimeAvailableModels }),
    ),
    correctionReview: async () => {
      const result = await dispatchCorrectionReview({
        reviewInput: input,
        runtimeAvailableModels,
        transport: correctionTransport,
      });
      if (result.status !== 'complete') {
        return { status: 'needs-human', reason: result.status, receipt: result };
      }
      return {
        status: result.review.status,
        receipt: result,
      };
    },
  });
}

export function resolveTieredDeepReviewRouting({
  root,
  runtimeAvailableModels,
} = {}) {
  requireRuntimeInventory(runtimeAvailableModels);
  const roster = resolveBundledRoastRoster({
    ...(root ? { root } : {}),
    runtimeAvailableModels,
    deepRoute: DEEP_REVIEW_ROUTE,
  });
  const roastmaster = resolveBundledRoastmasterRoute({
    ...(root ? { root } : {}),
    runtimeAvailableModels,
    deepRoute: DEEP_REVIEW_ROUTE,
  });
  if (roster.blockedSeats.length
      || roster.roster.length !== 3
      || roastmaster.coordinate.route === null
      || roastmaster.synthesize.route === null) {
    throw new Error('confirmed deep review route is unavailable');
  }
  return Object.freeze({ roster, roastmaster });
}
