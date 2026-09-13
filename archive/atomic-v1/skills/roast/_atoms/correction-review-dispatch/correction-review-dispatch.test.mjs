import assert from 'node:assert/strict';
import test from 'node:test';

import {
  correctionReviewContract,
  dispatchCorrectionReview,
  resolveTieredDeepReviewRouting,
  runNewCodeReviewFromGit,
  runTieredCodeReview,
  runTieredCodeReviewFromGit,
  validateCorrectionReview,
} from './correction-review-dispatch.mjs';
import {
  CORRECTION_REVIEW_ROUTE,
  DEEP_REVIEW_ROUTE,
  newCodeReviewDefaultPolicy,
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
const BASE = '1'.repeat(40);
const DEEP_HEAD = '2'.repeat(40);
const CURRENT_HEAD = '3'.repeat(40);

const input = {
  current: { headSha: CURRENT_HEAD },
  lastDeep: { headSha: DEEP_HEAD },
  requirements: ['preserve behavior'],
  originalFindingIds: ['F-1'],
  latestDelta: { paths: ['src/a.js'] },
  cumulativeDelta: { paths: ['src/a.js'] },
  affectedConsumers: ['consumer-a'],
  validation: { complete: true, headSha: CURRENT_HEAD },
};

const response = (overrides = {}) => JSON.stringify({
  schemaVersion: 1,
  status: 'complete',
  headSha: CURRENT_HEAD,
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

test('a transport can construct a valid response from the launch contract alone', async () => {
  function fromSchema(schema) {
    if (Object.hasOwn(schema, 'const')) return schema.const;
    if (schema.enum) return schema.enum[0];
    if (schema.type === 'string') return 'Observed evidence';
    if (schema.type === 'array') return Array.from({ length: schema.minItems }, () => fromSchema(schema.items));
    return Object.fromEntries(schema.required.map((key) => [key, fromSchema(schema.properties[key])]));
  }
  const result = await dispatchCorrectionReview({
    reviewInput: input,
    runtimeAvailableModels: ['gpt-5.6-sol'],
    transport: async ({ prompt }) => {
      const contract = JSON.parse(prompt);
      const reply = fromSchema(contract.outputSchema);
      for (const [field, { key, values }] of Object.entries(contract.coverage)) {
        reply[field] = values.map((value) => ({
          ...fromSchema(contract.outputSchema.properties[field].items), [key]: value,
        }));
      }
      for (const field of contract.completeWhen.emptyArrays) reply[field] = [];
      for (const [field, rule] of Object.entries(contract.completeWhen.recordValues)) {
        for (const entry of reply[field]) entry[rule.field] = rule.allowed[0];
      }
      return JSON.stringify(reply);
    },
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.review.headSha, CURRENT_HEAD);
  assert.deepEqual(result.review.requirementChecks[0].negativeCases, ['Observed evidence']);
  assert.equal(result.review.findingDispositions[0].findingId, 'F-1');
  assert.equal(result.review.affectedConsumersReviewed[0].consumer, 'consumer-a');
});

test('returned contract data cannot mutate canonical validation or caller inputs', () => {
  const original = correctionReviewContract(input);
  const modified = correctionReviewContract(input);
  modified.outputSchema.properties.status.enum.push('approved');
  modified.coverage.findingDispositions.values.push('F-extra');
  modified.completeWhen.emptyArrays.length = 0;
  assert.deepEqual(correctionReviewContract(input), original);
  assert.deepEqual(input.originalFindingIds, ['F-1']);
  assert.throws(() => validateCorrectionReview(JSON.parse(response({ status: 'approved' })), input), /invalid/);
});

test('malformed response data requests full review without accepting a correction receipt', async () => {
  const missingNested = JSON.parse(response());
  delete missingNested.requirementChecks[0].negativeCases;
  for (const [raw, reason] of [
    ['not JSON', 'invalid-response-json'],
    ['null', 'invalid-response-contract'],
    [JSON.stringify(missingNested), 'invalid-response-contract'],
    [response({ uncertainties: ['behavior not established'] }), 'invalid-response-contract'],
  ]) {
    const result = await dispatchCorrectionReview({
      reviewInput: input,
      runtimeAvailableModels: ['gpt-5.6-sol'],
      transport: async () => raw,
    });
    assert.equal(result.status, 'escalate-full', raw);
    assert.equal(result.reason, reason);
    assert.equal(result.review, null);
    assert.equal(result.diagnostics.phase, 'response');
    assert.ok(result.diagnostics.message);
  }
});

test('a stale response requires caller intervention rather than automatic escalation', async () => {
  const result = await dispatchCorrectionReview({
    reviewInput: input,
    runtimeAvailableModels: ['gpt-5.6-sol'],
    transport: async () => response({ headSha: DEEP_HEAD }),
  });
  assert.equal(result.status, 'needs-human');
  assert.equal(result.reason, 'stale-response');
  assert.equal(result.review, null);
});

test('explicit stale identity takes precedence over other response contract defects', async () => {
  const missing = JSON.parse(response({ headSha: DEEP_HEAD }));
  delete missing.uncertainties;
  const extra = JSON.parse(response({ headSha: DEEP_HEAD, extra: true }));
  for (const receipt of [missing, extra]) {
    const dispatched = await dispatchCorrectionReview({
      reviewInput: input,
      runtimeAvailableModels: ['gpt-5.6-sol'],
      transport: async () => JSON.stringify(receipt),
    });
    assert.equal(dispatched.status, 'needs-human');
    assert.equal(dispatched.reason, 'stale-response');
    assert.equal(dispatched.review, null);
    for (const version of [1, 2]) {
      let fullCalls = 0;
      const result = await runTieredCodeReview({
        input: eligibleReviewInput(version),
        runtimeAvailableModels: ['gpt-5.6-sol', 'gpt-6-astra'],
        correctionTransport: async () => JSON.stringify(receipt),
        fullReview: async () => { fullCalls += 1; return { status: 'complete' }; },
      });
      assert.equal(result.authoritative, 'none');
      assert.equal(result.correction.reason, 'stale-response');
      assert.equal(result.correction.receipt.review, null);
      assert.equal(fullCalls, 0);
    }
  }
});

test('transport rejections preserve diagnostic classification and never authorize a retry', async () => {
  for (const code of ['denied', 'ECONNRESET', 'ABORT_ERR']) {
    const result = await dispatchCorrectionReview({
      reviewInput: input,
      runtimeAvailableModels: ['gpt-5.6-sol'],
      transport: async () => { throw Object.assign(new Error('Transport stopped'), { code, privatePayload: 'not-for-diagnostics' }); },
    });
    assert.equal(result.status, 'needs-human');
    assert.equal(result.reason, 'transport-failed');
    assert.equal(result.dispatch, null);
    assert.equal(result.review, null);
    assert.equal(result.diagnostics.code, code);
    assert.equal(result.diagnostics.errorType, 'Error');
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /privatePayload|not-for-diagnostics/);
  }
});

test('invalid transport envelopes are classified separately from model JSON', async () => {
  for (const envelope of [42, { response: response(), actualModel: 42 }]) {
    const result = await dispatchCorrectionReview({
      reviewInput: input,
      runtimeAvailableModels: ['gpt-5.6-sol'],
      transport: async () => envelope,
    });
    assert.equal(result.status, 'needs-human');
    assert.equal(result.reason, 'invalid-transport-result');
    assert.equal(result.review, null);
  }
});

test('the response remains bound to the contract actually sent to the worker', async () => {
  const mutable = structuredClone(input);
  const result = await dispatchCorrectionReview({
    reviewInput: mutable,
    runtimeAvailableModels: ['gpt-5.6-sol'],
    transport: async () => {
      mutable.current.headSha = DEEP_HEAD;
      mutable.originalFindingIds.push('F-other');
      return response();
    },
  });
  assert.equal(result.status, 'complete');
  assert.equal(result.review.headSha, CURRENT_HEAD);
});

test('unfulfillable coverage and invalid transport configuration fail before dispatch', async () => {
  let calls = 0;
  for (const change of [
    { requirements: [] },
    { affectedConsumers: [] },
    { originalFindingIds: ['F-1', 'F-1'] },
  ]) {
    await assert.rejects(() => dispatchCorrectionReview({
      reviewInput: { ...input, ...change },
      runtimeAvailableModels: ['gpt-5.6-sol'],
      transport: async () => { calls += 1; return response(); },
    }), /distinct non-empty strings/);
  }
  await assert.rejects(() => dispatchCorrectionReview({
    reviewInput: input, runtimeAvailableModels: ['gpt-5.6-sol'],
  }), /transport must be a function/);
  assert.equal(calls, 0);
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
    headSha: DEEP_HEAD,
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

function eligibleReviewInput(version = 1) {
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
      baseSha: BASE,
      headSha: CURRENT_HEAD,
      packetDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      sourceRevision: 'source',
    },
    lastDeep: {
      baseSha: BASE,
      headSha: DEEP_HEAD,
      packetDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      sourceRevision: 'source',
    },
    previousHead: DEEP_HEAD,
    latestDelta: {
      baseSha: DEEP_HEAD,
      headSha: CURRENT_HEAD,
      paths: ['src/a.js'],
      evidenceComplete: true,
      semanticAssessment: assessment,
    },
    cumulativeDelta: {
      baseSha: DEEP_HEAD,
      headSha: CURRENT_HEAD,
      paths: ['src/a.js'],
      evidenceComplete: true,
      semanticAssessment: assessment,
    },
    deltaReconciliation: { complete: true, revertedPaths: [], unexplainedPaths: [] },
    remediationAttempt: 1,
  };
  if (version === 2) {
    reviewInput.policy = newCodeReviewDefaultPolicy();
    reviewInput.fileScopeAssessment = {
      complete: true, newOrOutOfScopeFiles: false, evidence: 'same reviewed file',
    };
    reviewInput.churnMetrics = {
      baseline: {
        baseSha: BASE, headSha: DEEP_HEAD, status: 'complete',
        addedLines: 10, deletedLines: 0, totalLines: 10,
      },
      cumulative: {
        baseSha: DEEP_HEAD, headSha: CURRENT_HEAD, status: 'complete',
        addedLines: 1, deletedLines: 0, totalLines: 1,
      },
    };
  }
  return reviewInput;
}

test('tiered code review consumes correction transport and falls back to full on escalation', async () => {
  const calls = [];
  const result = await runTieredCodeReview({
    input: eligibleReviewInput(),
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

test('response format failures reach the existing full-review callback once', async () => {
  const missing = JSON.parse(response());
  delete missing.findingDispositions[0].reasoning;
  for (const raw of ['invalid JSON', JSON.stringify(missing)]) {
    const calls = [];
    const result = await runTieredCodeReview({
      input: eligibleReviewInput(),
      runtimeAvailableModels: ['gpt-5.6-sol', 'gpt-6-astra'],
      correctionTransport: async () => { calls.push('correction'); return raw; },
      fullReview: async () => { calls.push('full'); return { status: 'complete' }; },
    });
    assert.deepEqual(calls, ['correction', 'full']);
    assert.equal(result.authoritative, 'full');
    assert.equal(result.correction.receipt.review, null);
    assert.match(result.correction.reason, /invalid-response/);
  }
});

test('denials, cancellation and stale identity never invoke full review as a workaround', async () => {
  for (const transport of [
    async () => { throw Object.assign(new Error('Denied'), { code: 'denied' }); },
    async () => { throw Object.assign(new Error('Cancelled'), { code: 'ABORT_ERR' }); },
    async () => response({ headSha: DEEP_HEAD }),
  ]) {
    let fullCalls = 0;
    const result = await runTieredCodeReview({
      input: eligibleReviewInput(),
      runtimeAvailableModels: ['gpt-5.6-sol', 'gpt-6-astra'],
      correctionTransport: transport,
      fullReview: async () => { fullCalls += 1; return { status: 'complete' }; },
    });

    assert.equal(result.authoritative, 'none');
    assert.equal(result.correction.status, 'needs-human');
    assert.equal(result.correction.receipt.review, null);
    assert.equal(fullCalls, 0);
  }
});

test('the default version-two policy handles response and transport failure without false authority', async () => {
  for (const denied of [false, true]) {
    let fullCalls = 0;
    const result = await runTieredCodeReview({
      input: eligibleReviewInput(2),
      runtimeAvailableModels: ['gpt-5.6-sol', 'gpt-6-astra'],
      correctionTransport: async () => {
        if (denied) throw Object.assign(new Error('Permission denied'), { code: 'denied' });
        return 'invalid JSON';
      },
      fullReview: async () => { fullCalls += 1; return { status: 'complete' }; },
    });
    assert.equal(result.decision.outcome, 'correction-verification');
    assert.equal(result.authoritative, denied ? 'none' : 'full');
    assert.equal(fullCalls, denied ? 0 : 1);
    assert.equal(result.correction.receipt.review, null);
  }
});

test('deep routing refuses unless every council and Roastmaster seat resolves', () => {
  assert.throws(() => resolveTieredDeepReviewRouting({
    runtimeAvailableModels: [],
  }), /deep review route is unavailable/);
});

test('manual deep request reaches the real deep dispatch without churn measurement', async () => {
  const calls = [];
  const result = await runTieredCodeReviewFromGit({
    input: {
      ...input,
      policy: newCodeReviewDefaultPolicy(),
      current: {
        baseSha: BASE,
        headSha: CURRENT_HEAD,
        packetDigest: 'a'.repeat(64),
        scopeDigest: 'b'.repeat(64),
        sourceRevision: 'source',
      },
      lastDeep: {
        baseSha: BASE,
        headSha: DEEP_HEAD,
        packetDigest: 'a'.repeat(64),
        scopeDigest: 'b'.repeat(64),
        sourceRevision: 'source',
      },
      manualDeepRequested: true,
    },
    runtimeAvailableModels: ['gpt-6-astra', 'gpt-5.6-sol'],
    correctionTransport: async () => {
      calls.push('correction');
      return response();
    },
    fullReview: async (_decision, routing) => {
      calls.push('full');
      assert.deepEqual(routing.roster.roster.map((entry) => entry.route.model), [
        'gpt-6-astra', 'gpt-6-astra', 'gpt-6-astra',
      ]);
      return { status: 'complete' };
    },
    runGit: () => {
      throw new Error('manual deep must not measure churn first');
    },
  });
  assert.deepEqual(calls, ['full']);
  assert.equal(result.authoritative, 'full');
});

test('new callable defaults omitted policy and binds initial, manual, and repeated deep callbacks', async () => {
    const current = {
      baseSha: BASE,
      headSha: CURRENT_HEAD,
      packetDigest: 'a'.repeat(64),
      scopeDigest: 'b'.repeat(64),
      sourceRevision: 'source',
    };
    const baseInput = {
      current,
      requirements: ['preserve behavior'],
      affectedConsumers: ['consumer-a'],
    };
    for (const scenario of [
      { name: 'initial', input: baseInput, reviewMode: undefined, reason: 'initial-deep-review-required' },
      {
        name: 'manual',
        input: { ...baseInput, lastDeep: { ...current, headSha: DEEP_HEAD }, manualDeepRequested: true },
        reviewMode: undefined,
        reason: 'manual-deep-request',
      },
      {
        name: 'repeated',
        input: baseInput,
        reviewMode: 'repeated-full',
        reason: 'explicit-repeated-full',
      },
    ]) {
      let correctionCalls = 0;
      const result = await runNewCodeReviewFromGit({
        input: scenario.input,
        ...(scenario.reviewMode ? { reviewMode: scenario.reviewMode } : {}),
        runtimeAvailableModels: ['gpt-6-astra', 'gpt-5.6-sol'],
        correctionTransport: async () => {
          correctionCalls += 1;
          return response();
        },
        fullReview: async (decision) => {
          assert.equal(decision.reason, scenario.reason, scenario.name);
          assert.deepEqual(decision.current, current, scenario.name);
          assert.deepEqual(decision.reviewInput.current, current, scenario.name);
          return { status: 'complete' };
        },
        runGit: () => {
          throw new Error(`${scenario.name} deep dispatch must not measure churn`);
        },
      });
      assert.equal(result.authoritative, 'full');
      assert.equal(correctionCalls, 0);
    }
});

test('all new v2 deep triggers reject movable or malformed current identity before dispatch', async () => {
    for (const scenario of [
      {
        input: {
          current: {
            baseSha: BASE,
            headSha: 'HEAD',
            packetDigest: 'a'.repeat(64),
            scopeDigest: 'b'.repeat(64),
            sourceRevision: 'source',
          },
        },
      },
      {
        input: {
          current: {
            baseSha: BASE,
            headSha: CURRENT_HEAD,
            packetDigest: 'not-a-digest',
            scopeDigest: 'b'.repeat(64),
            sourceRevision: 'source',
          },
          manualDeepRequested: true,
        },
      },
      {
        input: {
          current: {
            baseSha: BASE,
            headSha: CURRENT_HEAD,
            packetDigest: 'a'.repeat(64),
            scopeDigest: 'scope',
            sourceRevision: 'source',
          },
        },
        reviewMode: 'repeated-full',
      },
    ]) {
      let fullCalls = 0;
      await assert.rejects(() => runNewCodeReviewFromGit({
        input: scenario.input,
        ...(scenario.reviewMode ? { reviewMode: scenario.reviewMode } : {}),
        runtimeAvailableModels: ['gpt-6-astra', 'gpt-5.6-sol'],
        correctionTransport: async () => response(),
        fullReview: async () => {
          fullCalls += 1;
          return { status: 'complete' };
        },
      }), /canonical full lowercase Git object ID|SHA-256 digest/);
      assert.equal(fullCalls, 0);
    }
});
