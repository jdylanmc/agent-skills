import assert from 'node:assert/strict';
import test from 'node:test';

import { digestJson, stableJson } from './review-tier-policy.canonical-json.mjs';
import {
  CORRECTION_REVIEW_ROUTE,
  DEEP_REVIEW_ROUTE,
  DEFAULT_CHURN_THRESHOLD_PERCENT,
  ReviewTierPolicyError,
  SEMANTIC_ASSESSMENT_CATEGORIES,
  classifyReviewTier,
  compareReviewWork,
  executeTieredReview,
  measureGitLineChurn,
  measureReviewChurn,
  newCodeReviewDefaultPolicy,
  normalizeReviewPolicy,
  reviewPolicyBindingDigest,
} from './review-tier-policy.mjs';

test('canonical JSON has independent expected bytes for objects, arrays, and scalars', () => {
  const value = { z: 3, nested: [{ b: false, a: null }, 'scalar', 7], a: 'text' };
  const reordered = { a: 'text', nested: [{ a: null, b: false }, 'scalar', 7], z: 3 };

  assert.equal(
    JSON.stringify(stableJson(value)),
    '{"a":"text","nested":[{"a":null,"b":false},"scalar",7],"z":3}',
  );
  assert.equal(digestJson(value), digestJson(reordered));
  assert.equal(JSON.stringify(stableJson(7)), '7');
  assert.equal(digestJson({ scalar: 7 }), '19ca161f7ac436cb6f7612320ebde8cedbfd2e8880a347b14735d880060acfa4');
});

const BASE = '1'.repeat(40);
const DEEP_HEAD = '2'.repeat(40);
const PREVIOUS_HEAD = '3'.repeat(40);
const CURRENT_HEAD = '4'.repeat(40);
const PACKET_DIGEST = 'a'.repeat(64);
const SCOPE_DIGEST = 'b'.repeat(64);

const assessment = (changed = [], uncertainties = []) => ({
  complete: true,
  categories: SEMANTIC_ASSESSMENT_CATEGORIES.map((category) => ({
    category,
    changed: changed.includes(category),
    evidence: `${category} assessed`,
  })),
  uncertainties,
});

const v1Policy = (evaluationMode = 'operational') => ({
  mode: 'tiered',
  policyVersion: 1,
  evaluationMode,
  deepRoute: DEEP_REVIEW_ROUTE,
  correctionRoute: CORRECTION_REVIEW_ROUTE,
  promotionDecision: evaluationMode === 'operational'
    ? {
      approved: true,
      actorType: 'human',
      actorId: 'operator-1',
      decisionId: 'promote-1',
      decidedAt: '2026-09-07T00:00:00Z',
      packetDigest: PACKET_DIGEST,
      policyBindingDigest: reviewPolicyBindingDigest({ evaluationMode }),
    }
    : null,
});

const v2Policy = (overrides = {}) => ({
  mode: 'deep-then-verify',
  policyVersion: 2,
  churnThresholdPercent: DEFAULT_CHURN_THRESHOLD_PERCENT,
  deepRoute: DEEP_REVIEW_ROUTE,
  correctionRoute: CORRECTION_REVIEW_ROUTE,
  ...overrides,
});

const identity = (headSha) => ({
  baseSha: BASE,
  headSha,
  packetDigest: PACKET_DIGEST,
  scopeDigest: SCOPE_DIGEST,
  sourceRevision: 'source',
});

const input = (overrides = {}) => ({
  policy: v2Policy(),
  current: identity(CURRENT_HEAD),
  lastDeep: identity(DEEP_HEAD),
  previousHead: PREVIOUS_HEAD,
  latestDelta: {
    baseSha: PREVIOUS_HEAD,
    headSha: CURRENT_HEAD,
    paths: ['src/a.js'],
    evidenceComplete: true,
    semanticAssessment: assessment(),
  },
  cumulativeDelta: {
    baseSha: DEEP_HEAD,
    headSha: CURRENT_HEAD,
    paths: ['src/a.js'],
    evidenceComplete: true,
    semanticAssessment: assessment(),
  },
  deltaReconciliation: { complete: true, revertedPaths: [], unexplainedPaths: [] },
  fileScopeAssessment: {
    complete: true,
    newOrOutOfScopeFiles: false,
    evidence: 'all changed files remain in the deep-reviewed scope',
  },
  churnMetrics: {
    baseline: {
      baseSha: BASE,
      headSha: DEEP_HEAD,
      status: 'complete',
      addedLines: 60,
      deletedLines: 40,
      totalLines: 100,
    },
    cumulative: {
      baseSha: DEEP_HEAD,
      headSha: CURRENT_HEAD,
      status: 'complete',
      addedLines: 10,
      deletedLines: 9,
      totalLines: 19,
    },
  },
  requirements: ['preserve behavior'],
  originalFindingIds: ['F-1'],
  affectedConsumers: ['consumer-a'],
  validation: { headSha: CURRENT_HEAD, complete: true },
  remediationAttempt: 1,
  manualDeepRequested: false,
  ...overrides,
});

test('legacy missing and v1 policies preserve their historical full and experimental behavior', () => {
  assert.deepEqual(normalizeReviewPolicy(), { mode: 'full' });
  assert.equal(classifyReviewTier({ policy: { mode: 'full' } }).outcome, 'full');
  assert.equal(normalizeReviewPolicy(v1Policy('shadow')).policyVersion, 1);
  assert.equal(classifyReviewTier({
    ...input(),
    policy: v1Policy('shadow'),
  }).outcome, 'correction-verification');
});

test('new intake explicitly pins deep-then-verify while repeated full is explicit', () => {
  assert.deepEqual(newCodeReviewDefaultPolicy(), normalizeReviewPolicy(v2Policy()));
  assert.equal(newCodeReviewDefaultPolicy().mode, 'deep-then-verify');
  assert.equal(classifyReviewTier({
    policy: v2Policy(),
    current: identity(CURRENT_HEAD),
    lastDeep: null,
  }).reason,
    'initial-deep-review-required');
  assert.equal(classifyReviewTier({
    policy: {
      mode: 'repeated-full',
      policyVersion: 2,
      deepRoute: DEEP_REVIEW_ROUTE,
    },
    current: identity(CURRENT_HEAD),
  }).reason, 'explicit-repeated-full');
});

test('manual deep request and file or semantic changes independently force deep review', () => {
  assert.equal(classifyReviewTier(input({ manualDeepRequested: true })).reason,
    'manual-deep-request');
  assert.equal(classifyReviewTier(input({
    fileScopeAssessment: {
      complete: true,
      newOrOutOfScopeFiles: true,
      evidence: 'new file outside the reviewed footprint',
    },
  })).reason, 'file-scope-change');
  assert.equal(classifyReviewTier(input({
    latestDelta: {
      ...input().latestDelta,
      semanticAssessment: assessment(['public-contract']),
    },
  })).reason, 'semantic-escalation');
  assert.equal(classifyReviewTier(input({
    latestDelta: {
      ...input().latestDelta,
      semanticAssessment: assessment([], ['impact cannot be classified']),
    },
  })).reason, 'semantic-uncertainty');
});

test('strict cumulative line churn threshold distinguishes 19, 20, and 21 percent', () => {
  const at = (totalLines) => classifyReviewTier(input({
    churnMetrics: {
      ...input().churnMetrics,
      cumulative: {
        baseSha: DEEP_HEAD,
        headSha: CURRENT_HEAD,
        status: 'complete',
        addedLines: totalLines,
        deletedLines: 0,
        totalLines,
      },
    },
  }));
  assert.equal(at(19).outcome, 'correction-verification');
  assert.equal(at(20).outcome, 'correction-verification');
  assert.equal(at(21).reason, 'cumulative-line-churn-exceeded');
  assert.equal(classifyReviewTier(input({
    policy: v2Policy({ churnThresholdPercent: 10 }),
    churnMetrics: {
      ...input().churnMetrics,
      cumulative: {
        baseSha: DEEP_HEAD,
        headSha: CURRENT_HEAD,
        status: 'complete',
        addedLines: 11,
        deletedLines: 0,
        totalLines: 11,
      },
    },
  })).outcome, 'full-review-required');
});

test('cumulative churn spans several heads and a successful new deep anchor resets it', () => {
  const acrossSeveralHeads = classifyReviewTier(input({
    previousHead: PREVIOUS_HEAD,
    latestDelta: {
      ...input().latestDelta,
      baseSha: PREVIOUS_HEAD,
      paths: ['src/third-fix.js'],
    },
    cumulativeDelta: {
      ...input().cumulativeDelta,
      paths: ['src/first-fix.js', 'src/second-fix.js', 'src/third-fix.js'],
    },
    deltaReconciliation: {
      complete: true,
      revertedPaths: [],
      unexplainedPaths: [],
    },
    churnMetrics: {
      ...input().churnMetrics,
      cumulative: {
        baseSha: DEEP_HEAD,
        headSha: CURRENT_HEAD,
        status: 'complete',
        addedLines: 21,
        deletedLines: 0,
        totalLines: 21,
      },
    },
  }));
  assert.equal(acrossSeveralHeads.outcome, 'full-review-required');

  const resetDeepHead = PREVIOUS_HEAD;
  const afterReset = classifyReviewTier(input({
    lastDeep: identity(resetDeepHead),
    latestDelta: {
      ...input().latestDelta,
      baseSha: resetDeepHead,
      paths: ['src/third-fix.js'],
    },
    cumulativeDelta: {
      ...input().cumulativeDelta,
      baseSha: resetDeepHead,
      paths: ['src/third-fix.js'],
    },
    churnMetrics: {
      baseline: {
        baseSha: BASE,
        headSha: resetDeepHead,
        status: 'complete',
        addedLines: 120,
        deletedLines: 80,
        totalLines: 200,
      },
      cumulative: {
        baseSha: resetDeepHead,
        headSha: CURRENT_HEAD,
        status: 'complete',
        addedLines: 10,
        deletedLines: 0,
        totalLines: 10,
      },
    },
  }));
  assert.equal(afterReset.outcome, 'correction-verification');
});

test('zero, binary, unavailable, or missing churn evidence conservatively requires deep review', () => {
  for (const status of ['zero', 'binary', 'unavailable']) {
    const decision = classifyReviewTier(input({
      churnMetrics: {
        ...input().churnMetrics,
        baseline: {
          baseSha: BASE,
          headSha: DEEP_HEAD,
          status,
          addedLines: 0,
          deletedLines: 0,
          totalLines: 0,
        },
      },
    }));
    assert.equal(decision.outcome, 'full-review-required');
  }
  assert.throws(() => classifyReviewTier(input({ churnMetrics: null })),
    /churnMetrics schema is not exact/);
});

test('bounded Git churn measurement pins immutable revisions and disables external diff behavior', () => {
  const calls = [];
  const measured = measureReviewChurn({
    repositoryRoot: '/repo',
    reviewBaseSha: BASE,
    lastDeepHead: DEEP_HEAD,
    currentHead: CURRENT_HEAD,
    runGit: (cwd, args) => {
      calls.push({ cwd, args });
      return calls.length === 1 ? '60\t40\tsrc/a.js\n' : '10\t9\tsrc/a.js\n';
    },
  });
  assert.equal(measured.baseline.totalLines, 100);
  assert.equal(measured.cumulative.totalLines, 19);
  assert.deepEqual(calls[0].args.slice(0, 5), [
    'diff', '--numstat', '--no-ext-diff', '--no-textconv', '--no-renames',
  ]);
  assert.equal(measureGitLineChurn({
    repositoryRoot: '/repo',
    baseSha: BASE,
    headSha: DEEP_HEAD,
    runGit: () => '-\t-\tasset.bin\n',
  }).status, 'binary');
});

test('invalid identities and incomplete semantic evidence cannot enter verification', () => {
  for (const bad of ['HEAD', 'main', 'abc1234', 'A'.repeat(40)]) {
    assert.throws(() => classifyReviewTier(input({
      current: { ...identity(CURRENT_HEAD), headSha: bad },
    })), /canonical full lowercase Git object ID/);
  }
  assert.throws(() => classifyReviewTier(input({
    current: { ...identity(CURRENT_HEAD), scopeDigest: 'scope' },
  })), /SHA-256 digest/);
  assert.throws(() => classifyReviewTier(input({
    cumulativeDelta: { ...input().cumulativeDelta, paths: ['other.js'] },
  })), /completely reconciled/);
});

test('callable seam runs correction by default, full on override, escalation, or legacy shadow', async () => {
  const calls = [];
  const callbacks = {
    correctionReview: async () => {
      calls.push('correction');
      return { status: 'complete' };
    },
    fullReview: async () => {
      calls.push('full');
      return { status: 'complete' };
    },
  };
  assert.equal((await executeTieredReview({ input: input(), ...callbacks })).authoritative,
    'correction');
  assert.deepEqual(calls, ['correction']);

  calls.length = 0;
  await executeTieredReview({ input: input({ manualDeepRequested: true }), ...callbacks });
  assert.deepEqual(calls, ['full']);

  calls.length = 0;
  await executeTieredReview({
    input: input(),
    correctionReview: async () => {
      calls.push('correction');
      return { status: 'escalate-full' };
    },
    fullReview: callbacks.fullReview,
  });
  assert.deepEqual(calls, ['correction', 'full']);

  calls.length = 0;
  await executeTieredReview({
    input: { ...input(), policy: v1Policy('shadow') },
    ...callbacks,
  });
  assert.deepEqual(calls, ['correction', 'full']);
});

test('shadow comparison is exact-head and discloses same-model profile limits', () => {
  const comparison = compareReviewWork({
    full: {
      headSha: CURRENT_HEAD,
      durationMs: 100,
      dispatchCount: 5,
      findingIds: ['F-1', 'F-2'],
      modelId: 'gpt-5.6-sol',
    },
    correction: {
      headSha: CURRENT_HEAD,
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
    full: { headSha: DEEP_HEAD, durationMs: 1, dispatchCount: 1, findingIds: [], modelId: 'gpt-5.6-sol' },
    correction: { headSha: CURRENT_HEAD, durationMs: 1, dispatchCount: 1, findingIds: [], modelId: 'gpt-5.6-sol' },
  }), /heads do not match/);
});
