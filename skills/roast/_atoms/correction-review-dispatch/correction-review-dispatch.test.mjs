import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dispatchCorrectionReview,
  resolveTieredDeepReviewRouting,
  runTieredCodeReview,
  validateCorrectionReview,
} from './correction-review-dispatch.mjs';
import {
  CORRECTION_REVIEW_ROUTE,
  DEEP_REVIEW_ROUTE,
  reviewPolicyBindingDigest,
  SEMANTIC_ASSESSMENT_CATEGORIES,
} from '../../../_base/_atoms/review-tier-policy/review-tier-policy.mjs';

const assessment = {
  complete: true,
  categories: SEMANTIC_ASSESSMENT_CATEGORIES.map((category) => ({
    category,
    changed: false,
    evidence: `${category} checked`,
  })),
  uncertainties: [],
};

const input = {
  current: { headSha: 'head-2' },
  lastDeep: { headSha: 'head-1' },
  requirements: ['preserve behavior'],
  originalFindingIds: ['F-1'],
  latestDelta: { paths: ['src/a.js'] },
  cumulativeDelta: { paths: ['src/a.js'] },
  affectedConsumers: ['consumer-a'],
  validation: { complete: true, headSha: 'head-2' },
};

const response = (overrides = {}) => JSON.stringify({
  schemaVersion: 1,
  status: 'complete',
  headSha: 'head-2',
  findingDispositions: [{
    findingId: 'F-1',
    disposition: 'addressed',
    evidence: 'observable assertion passes',
    reasoning: 'the requirement is satisfied',
  }],
  requirementChecks: [{
    requirement: 'preserve behavior',
    status: 'satisfied',
    evidence: 'observable behavior is preserved',
    negativeCases: ['bad input remains rejected'],
  }],
  affectedConsumersReviewed: [{
    consumer: 'consumer-a',
    status: 'satisfied',
    evidence: 'consumer contract remains compatible',
  }],
  regressions: [],
  newFindings: [],
  uncertainties: [],
  ...overrides,
});

test('dispatches exact GPT-5.6 Sol QA route through the real transport seam', async () => {
  const calls = [];
  const result = await dispatchCorrectionReview({
    reviewInput: input,
    runtimeAvailableModels: ['gpt-5.6-sol', 'gpt-6-astra'],
    transport: async (launch) => {
      calls.push(launch);
      return { response: response(), actualModel: 'gpt-5.6-sol' };
    },
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.review.status, 'complete');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gpt-5.6-sol');
  assert.deepEqual(calls[0].fallbackModels, []);
  assert.equal(calls[0].reasoningEffort, 'high');
  assert.equal(calls[0].contextTier, 'default');
  assert.deepEqual(calls[0].tools, ['read', 'search']);
});

test('unavailable confirmed routes never call transport', async () => {
  let calls = 0;
  const result = await dispatchCorrectionReview({
    reviewInput: input,
    runtimeAvailableModels: [],
    transport: async () => {
      calls += 1;
      return response();
    },
  });
  assert.equal(result.status, 'tiered-review-unavailable');
  assert.equal(calls, 0);
});

test('tiered dispatch refuses an unobserved runtime inventory', async () => {
  await assert.rejects(() => dispatchCorrectionReview({
    reviewInput: input,
    runtimeAvailableModels: null,
    transport: async () => response(),
  }), /observed inventory/);
});

test('original findings may be unsupported but unresolved evidence cannot report complete', () => {
  const rejected = JSON.parse(response({
    findingDispositions: [{
      findingId: 'F-1',
      disposition: 'original-finding-unsupported',
      evidence: 'the cited path cannot produce the claimed behavior',
      reasoning: 'the original premise is contradicted',
    }],
  }));
  assert.equal(validateCorrectionReview(rejected, input).findingDispositions[0].disposition,
    'original-finding-unsupported');
  assert.throws(() => validateCorrectionReview(JSON.parse(response({
    regressions: [{ id: 'R-1', evidence: 'new failure', impact: 'consumer breaks' }],
  })), input), /unresolved evidence/);
  assert.throws(() => validateCorrectionReview(JSON.parse(response({
    headSha: 'head-1',
  })), input), /stale/);
  assert.throws(() => validateCorrectionReview(JSON.parse(response({
    findingDispositions: [],
  })), input), /finding coverage/);
  assert.throws(() => validateCorrectionReview(JSON.parse(response({
    affectedConsumersReviewed: [{
      consumer: 'wrong-consumer',
      status: 'satisfied',
      evidence: 'wrong surface',
    }],
  })), input), /consumer coverage/);
  assert.throws(() => validateCorrectionReview(JSON.parse(response({
    newFindings: [{ id: 'N-1', evidence: 'new blocker', priority: 'Must fix' }],
  })), input), /unresolved evidence/);
});

test('tiered code review consumes correction transport and falls back to full on escalation', async () => {
  const policy = {
    mode: 'tiered',
    policyVersion: 1,
    evaluationMode: 'operational',
    deepRoute: DEEP_REVIEW_ROUTE,
    correctionRoute: CORRECTION_REVIEW_ROUTE,
    promotionDecision: {
      approved: true,
      actorType: 'human',
      actorId: 'operator-1',
      decisionId: 'promotion',
      decidedAt: '2026-09-07T00:00:00Z',
      packetDigest: 'a'.repeat(64),
      policyBindingDigest: reviewPolicyBindingDigest({ evaluationMode: 'operational' }),
    },
  };
  const reviewInput = {
    ...input,
    policy,
    current: {
      baseSha: 'base',
      headSha: 'head-2',
      packetDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      sourceRevision: 'source',
    },
    lastDeep: {
      baseSha: 'base',
      headSha: 'head-1',
      packetDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      sourceRevision: 'source',
    },
    previousHead: 'head-1',
    latestDelta: {
      baseSha: 'head-1',
      headSha: 'head-2',
      paths: ['src/a.js'],
      evidenceComplete: true,
      semanticAssessment: assessment,
    },
    cumulativeDelta: {
      baseSha: 'head-1',
      headSha: 'head-2',
      paths: ['src/a.js'],
      evidenceComplete: true,
      semanticAssessment: assessment,
    },
    deltaReconciliation: { complete: true, revertedPaths: [], unexplainedPaths: [] },
    remediationAttempt: 1,
  };
  const calls = [];
  const result = await runTieredCodeReview({
    input: reviewInput,
    runtimeAvailableModels: ['gpt-5.6-sol', 'gpt-6-astra'],
    correctionTransport: async () => {
      calls.push('correction');
      return response({ status: 'escalate-full', uncertainties: ['impact unclear'] });
    },
    fullReview: async (_decision, routing) => {
      calls.push('full');
      assert.deepEqual(routing.roster.roster.map((entry) => entry.route.model), [
        'gpt-6-astra', 'gpt-6-astra', 'gpt-6-astra',
      ]);
      assert.equal(routing.roastmaster.coordinate.route.model, 'gpt-6-astra');
      assert.equal(routing.roastmaster.synthesize.route.model, 'gpt-6-astra');
      return { status: 'complete' };
    },
  });
  assert.deepEqual(calls, ['correction', 'full']);
  assert.equal(result.authoritative, 'full');
});

test('deep routing refuses unless every council and Roastmaster seat resolves', () => {
  assert.throws(() => resolveTieredDeepReviewRouting({
    runtimeAvailableModels: [],
  }), /deep review route is unavailable/);
});
