import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CORRECTION_REVIEW_ROUTE,
  DEEP_REVIEW_ROUTE,
  ReviewTierPolicyError,
  classifyReviewTier,
  compareReviewWork,
  executeTieredReview,
  normalizeReviewPolicy,
} from './review-tier-policy.mjs';

const policy = (evaluationMode = 'operational') => ({
  mode: 'tiered',
  policyVersion: 1,
  evaluationMode,
  deepRoute: DEEP_REVIEW_ROUTE,
  correctionRoute: CORRECTION_REVIEW_ROUTE,
  promotionDecision: evaluationMode === 'operational'
    ? { approved: true, actor: 'human', decisionId: 'promote-1', decidedAt: '2026-09-07T00:00:00Z' }
    : null,
});

const identity = (headSha) => ({
  baseSha: 'base',
  headSha,
  packetDigest: 'packet',
  scopeDigest: 'scope',
  sourceRevision: 'source',
});

const eligible = (overrides = {}) => ({
  policy: policy(),
  current: identity('head-2'),
  lastDeep: identity('head-1'),
  previousHead: 'head-1',
  latestDelta: { baseSha: 'head-1', headSha: 'head-2', paths: ['src/a.js'], semanticSignals: [] },
  cumulativeDelta: { baseSha: 'head-1', headSha: 'head-2', paths: ['src/a.js'], semanticSignals: [] },
  requirements: ['preserve behavior'],
  originalFindingIds: ['F-1'],
  affectedConsumers: ['consumer-a'],
  validation: { headSha: 'head-2', complete: true },
  remediationAttempt: 1,
  ...overrides,
});

test('full review is the default and the first tiered review is deep', () => {
  assert.deepEqual(normalizeReviewPolicy(), { mode: 'full' });
  assert.equal(classifyReviewTier({ policy: { mode: 'full' } }).outcome, 'full');
  assert.equal(classifyReviewTier({ policy: policy(), lastDeep: null }).outcome, 'full');
});

test('eligible correction is exact-head and cumulative-delta bound', () => {
  const decision = classifyReviewTier(eligible());
  assert.equal(decision.outcome, 'correction-verification');
  assert.equal(decision.current.headSha, 'head-2');
  assert.equal(decision.cumulativeDelta.baseSha, 'head-1');
});

test('semantic, repeated, stale, and incomplete inputs cannot enter the fast path', () => {
  assert.equal(classifyReviewTier(eligible({
    latestDelta: { baseSha: 'head-1', headSha: 'head-2', paths: ['src/a.js'], semanticSignals: ['authority'] },
  })).outcome, 'full-review-required');
  assert.equal(classifyReviewTier(eligible({ remediationAttempt: 2 })).outcome, 'full-review-required');
  assert.equal(classifyReviewTier(eligible({
    current: { ...identity('head-2'), packetDigest: 'changed' },
  })).outcome, 'full-review-required');
  assert.equal(classifyReviewTier(eligible({
    validation: { headSha: 'head-1', complete: true },
  })).outcome, 'incomplete-evidence');
  assert.throws(
    () => classifyReviewTier(eligible({ cumulativeDelta: null })),
    (error) => error instanceof ReviewTierPolicyError,
  );
});

test('unconfirmed routes and operational use without human promotion are refused', () => {
  assert.throws(() => normalizeReviewPolicy({
    ...policy(),
    correctionRoute: { ...CORRECTION_REVIEW_ROUTE, model: 'gpt-5-mini' },
  }), /human-confirmed full-strength route/);
  assert.throws(() => normalizeReviewPolicy({
    ...policy(),
    promotionDecision: null,
  }), /explicit human promotion/);
});

test('callable seam reduces review work and escalates or shadows to full', async () => {
  const calls = [];
  const operational = await executeTieredReview({
    input: eligible(),
    correctionReview: async () => {
      calls.push('correction');
      return { status: 'complete' };
    },
    fullReview: async () => {
      calls.push('full');
      return { status: 'complete' };
    },
  });

  test('shadow comparison is exact-head and discloses same-model profile limits', () => {
    const comparison = compareReviewWork({
      full: {
        headSha: 'head',
        durationMs: 100,
        dispatchCount: 5,
        findingIds: ['F-1', 'F-2'],
        modelId: 'gpt-5.6-sol',
      },
      correction: {
        headSha: 'head',
        durationMs: 30,
        dispatchCount: 1,
        findingIds: ['F-1'],
        modelId: 'gpt-5.6-sol',
      },
    });
    assert.equal(comparison.dispatchReduction, 4);
    assert.deepEqual(comparison.missedByCorrection, ['F-2']);
    assert.equal(comparison.modelProfileComparison, 'same-model-profile-only');
    assert.equal(comparison.promotion, 'human-only');
    assert.throws(() => compareReviewWork({
      full: { headSha: 'a', durationMs: 1, dispatchCount: 1, findingIds: [], modelId: 'gpt-5.6-sol' },
      correction: { headSha: 'b', durationMs: 1, dispatchCount: 1, findingIds: [], modelId: 'gpt-5.6-sol' },
    }), /heads do not match/);
  });
  assert.deepEqual(calls, ['correction']);
  assert.equal(operational.authoritative, 'correction');

  calls.length = 0;
  const escalated = await executeTieredReview({
    input: eligible(),
    correctionReview: async () => {
      calls.push('correction');
      return { status: 'escalate-full' };
    },
    fullReview: async () => {
      calls.push('full');
      return { status: 'complete' };
    },
  });
  assert.deepEqual(calls, ['correction', 'full']);
  assert.equal(escalated.authoritative, 'full');

  calls.length = 0;
  const shadow = await executeTieredReview({
    input: eligible({ policy: policy('shadow') }),
    correctionReview: async () => {
      calls.push('correction');
      return { status: 'complete' };
    },
    fullReview: async () => {
      calls.push('full');
      return { status: 'complete' };
    },
  });
  assert.deepEqual(calls, ['correction', 'full']);
  assert.equal(shadow.authoritative, 'full');
});
