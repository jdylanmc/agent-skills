import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  adaptBlastRadiusEvidence,
  adaptCiEvidence,
  adaptRoastEvidence,
  deliveryStagesForManifest,
  evaluateQualityGate,
  invalidateRevisionEvidence,
  reconcileFleetDiff,
  recordStage,
  remediationDecision,
  reviewPacketBindingDigest,
  reviewPolicyDigest,
  reviewScopeBindingDigest,
  runSquadronTieredReview,
  validateReviewLineage,
} from './quality-evidence.mjs';
import {
  CORRECTION_REVIEW_ROUTE,
  DEEP_REVIEW_ROUTE,
  newCodeReviewDefaultPolicy,
  SEMANTIC_ASSESSMENT_CATEGORIES,
} from '../../../_base/_atoms/review-tier-policy/review-tier-policy.mjs';

const revision = { baseSha: 'base', headSha: 'head' };
const POLICY_BASE = '1'.repeat(40);
const POLICY_DEEP_HEAD = '2'.repeat(40);
const POLICY_CURRENT_HEAD = '3'.repeat(40);
const identity = { runId: 'run', issue: '1' };
const REPOSITORY_ROOT = path.resolve('test-fixtures', 'quality-evidence-repository');

function manifest(
  shepherdIntent = 'yes',
  humanDecisions = [],
  reviewPolicy = null,
  reviewPolicyContractVersion = null,
) {
  return normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: 'deliver',
    acceptedScope: [],
    exclusions: [],
    humanDecisions,
    issues: [{
      identity: '1',
      sourceRevision: 'r1',
      sourceReceipt: {
        invocation: { id: 'read-1', operation: 'read-issue' },
        provider: 'github', repository: 'owner/repo', issue: '1', revision: 'r1',
        issueStatus: 'pending', status: 'observed', terminal: true, complete: true, observedAt: '2026-08-30T00:00:00Z',
      },
      acceptanceCriteria: [{ id: 'C1', description: 'done' }],
      scope: [],
      allowedPaths: ['src/**'],
      ...(reviewPolicy ? { reviewPolicy } : {}),
    }],
    dependencies: [],
    concurrency: 1,
    budget: { cost: 10, timeMinutes: 60, retries: 2 },
    repository: { id: 'owner/repo', root: REPOSITORY_ROOT, baseBranch: 'main' },
    provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge', 'observe-change-request-revision'] },
    validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
    stopConditions: ['cancelled'],
    humanBoundaries: ['human merge'],
    shepherdIntent,
    ...(reviewPolicyContractVersion === 2 ? { reviewPolicyContractVersion: 2 } : {}),
  });
}

function tieredManifest() {
  return manifest('yes', [], newCodeReviewDefaultPolicy(), 2);
}

function routing(kind) {
  const seats = kind === 'full'
    ? ['architecture-candidate', 'qa-reviewer', 'security-reviewer',
      'roastmaster-coordinate', 'roastmaster-synthesize']
    : ['qa-reviewer'];
  const model = kind === 'full' ? 'gpt-6-astra' : 'gpt-5.6-sol';
  return seats.map((seat) => ({
    seat,
    role: seat,
    requestedModel: model,
    selectedModel: model,
    actualModel: model,
    actualModelStatus: 'matched-selection',
    reasoningEffort: 'high',
    contextTier: 'default',
  }));
}

function packetFor(currentManifest) {
  const issue = currentManifest.issues[0];
  return {
    schemaVersion: 1,
    manifestDigest: currentManifest.digest,
    issue: issue.identity,
    sourceRevision: issue.sourceRevision,
    acceptanceCriteria: issue.acceptanceCriteria,
    scope: issue.scope,
    exclusions: currentManifest.exclusions,
    allowedPaths: issue.allowedPaths,
    verification: currentManifest.validationPolicy,
    reportContract: { summary: 'review', requiredEvidence: currentManifest.validationPolicy },
    forbiddenAuthorities: ['merge'],
    taskContract: { goal: currentManifest.goal },
    branch: 'issue-1',
    worktree: '/tmp/issue-1',
    baseSha: 'base',
    headSha: 'head',
    reviewPolicy: issue.reviewPolicy,
  };
}

function reviewTier(kind, packet, issue, overrides = {}) {
  return {
    kind,
    policyDigest: reviewPolicyDigest(issue.reviewPolicy),
    packetDigest: reviewPacketBindingDigest(packet),
    scopeDigest: reviewScopeBindingDigest(issue),
    sourceRevision: 'r1',
    assignmentGeneration: 1,
    modelRouting: routing(kind),
    ...(kind === 'correction' ? {
      lastDeepHead: 'head',
      latestDeltaDigest: 'd'.repeat(64),
      cumulativeDeltaDigest: 'e'.repeat(64),
      affectedConsumers: ['consumer-a'],
      escalation: 'none',
    } : {}),
    ...overrides,
  };
}

function ci(overrides = {}) {
  return {
    invocation: { skill: 'run-ci', id: 'ci-1', runId: 'run', issue: '1' },
    status: 'passed',
    terminal: true,
    complete: true,
    evidenceComplete: true,
    completedAt: '2026-08-30T00:10:00Z',
    steps: [{ name: 'tests', status: 'passed' }],
    ...revision,
    ...overrides,
  };
}

function roast(overrides = {}) {
  return {
    invocation: { skill: 'roast', id: 'roast-1', runId: 'run', issue: '1' },
    status: 'completed',
    terminal: true,
    complete: true,
    evidenceComplete: true,
    completedAt: '2026-08-30T00:11:00Z',
    findings: [],
    ...revision,
    ...overrides,
  };
}

function blast(overrides = {}) {
  return {
    subjectChange: 'current candidate diff',
    suppliedBaseline: 'confirmed fleet base',
    includedScope: ['current issue'],
    exclusions: [],
    repositories: ['owner/repo'],
    revisions: { ...revision },
    environments: ['isolated test runner'],
    directCallers: ['adapter consumer'],
    crossBoundaryConsumers: ['provider publication boundary'],
    assertionLadders: [{
      id: 'A1',
      assertion: 'consumer remains compatible',
      affectedBoundary: 'public adapter',
      badCase: 'consumer rejects output',
      safetyCriticalReason: 'publication would be unsafe',
      rungs: [
        ['assertion', 'supports-assertion'],
        ['exact-source-citation', 'supports-assertion'],
        ['ruled-out-bad-case', 'supports-assertion'],
        ['executable-proof', 'supports-assertion'],
        ['live-reproduction', 'supports-assertion'],
      ].map(([name, outcome]) => ({
        name,
        progression: 'completed',
        'evidence-outcome': outcome,
        evidence: `${name} evidence`,
        scope: 'current revision',
      })),
      strongestSupportedClaim: 'bad case ruled out in recorded scope',
    }],
    classifications: {
      'confirmed-risk': [],
      'cleared-risk': [{ assertionId: 'A1', assertion: 'consumer remains compatible', evidence: 'ruled-out-bad-case evidence', scope: 'current revision' }],
      'unproven-assertion': [],
    },
    analysisBoundaries: ['current revision and traced consumers'],
    crossBoundaryGaps: [],
    'regression-proof-status': 'selected',
    'regression-proof': {
      id: 'P1',
      assertionId: 'A1',
      badCase: 'consumer rejects output',
      verificationLevel: 'integration',
      environment: 'isolated test runner',
      setup: 'install declared dependencies',
      action: 'run existing integration check',
      observableResult: 'consumer accepts output',
      prerequisites: [],
      authorization: 'read-only execution',
      cheaperProofInsufficientReason: 'unit check does not cross adapter boundary',
      outsideCoverage: 'live provider behavior',
    },
    ...overrides,
  };
}

function gate(overrides = {}) {
  return {
    manifest: manifest(),
    identity,
    revision,
    reconciliation: { verdict: 'reconciled', ...revision },
    ciReceipt: ci(),
    roastReceipt: roast(),
    blastRadiusReceipt: blast(),
    criteria: [{
      id: 'C1',
      verdict: 'satisfied',
      evidence: { complete: true, summary: 'test proves criterion', ...revision },
    }],
    ...overrides,
  };
}

test('requires invocation identity, complete terminal CI, and current revision binding', () => {
  assert.equal(adaptCiEvidence(ci(), revision, identity).passed, true);
  assert.equal(adaptCiEvidence({ status: 'passed', evidenceComplete: true }, revision, identity).valid, false);
  assert.equal(adaptCiEvidence(ci({ headSha: 'stale' }), revision, identity).passed, false);
  assert.equal(adaptCiEvidence(ci({ terminal: false }), revision, identity).passed, false);
});

test('interprets canonical Roast Priority: Must fix and rejects caller-shaped severity booleans', () => {
  assert.equal(adaptRoastEvidence(roast(), revision, identity).complete, true);
  const blocked = adaptRoastEvidence(roast({
    findings: [{ id: 'R1', Priority: 'Must fix', status: 'open' }],
  }), revision, identity);
  assert.deepEqual(blocked.openMustFix, ['R1']);
  assert.equal(blocked.complete, false);
  assert.equal(adaptRoastEvidence(roast({
    findings: [{ id: 'R1', severity: 'blocker', status: 'open' }],
  }), revision, identity).valid, false);
  assert.equal(adaptRoastEvidence(roast({ evidenceComplete: false }), revision, identity).complete, false);
});

test('consumes the checked-in local blast-radius report unchanged and validates its semantics', () => {
  const report = blast();
  const adapted = adaptBlastRadiusEvidence(report, revision, identity);
  assert.equal(adapted.readiness, 'satisfied');
  assert.equal(adapted.receipt, report);
  const syntheticCompleteStop = blast();
  Object.assign(syntheticCompleteStop.assertionLadders[0], {
    stoppingRung: 'live-reproduction',
    stoppingReason: 'synthetic completion',
    nextEvidenceNeeded: 'none',
  });
  assert.equal(
    adaptBlastRadiusEvidence(syntheticCompleteStop, revision, identity).readiness,
    'invalid',
  );
  assert.equal(adaptBlastRadiusEvidence(blast({ assertionLadders: [] }), revision, identity).readiness, 'invalid');
  assert.equal(adaptBlastRadiusEvidence(blast({ revisions: { baseSha: 'base', headSha: 'stale' } }), revision, identity).readiness, 'invalid');
  assert.equal(adaptBlastRadiusEvidence(blast({
    'regression-proof-status': 'selected',
    'regression-proof': null,
  }), revision, identity).readiness, 'invalid');
  assert.equal(adaptBlastRadiusEvidence(blast({
    invocation: { skill: 'blast-radius', id: 'synthetic-wrapper' },
  }), revision, identity).readiness, 'invalid');
  const allNotAttempted = blast();
  allNotAttempted.assertionLadders[0].rungs = allNotAttempted.assertionLadders[0].rungs.map(
    (rung) => ({
      ...rung,
      progression: 'not-attempted',
      'evidence-outcome': 'inconclusive',
      evidence: '',
    }),
  );
  assert.equal(
    adaptBlastRadiusEvidence(allNotAttempted, revision, identity).readiness,
    'invalid',
  );
  const inconsistentStop = blast();
  inconsistentStop.assertionLadders[0].rungs[3] = {
    name: 'executable-proof',
    progression: 'unavailable',
    'evidence-outcome': 'inconclusive',
    evidence: '',
    scope: 'current revision',
  };
  inconsistentStop.assertionLadders[0].rungs[4] = {
    name: 'live-reproduction',
    progression: 'not-attempted',
    'evidence-outcome': 'inconclusive',
    evidence: '',
    scope: 'current revision',
  };
  assert.equal(adaptBlastRadiusEvidence(inconsistentStop, revision, identity).readiness, 'invalid');
  const unproven = blast({
    classifications: {
      'confirmed-risk': [],
      'cleared-risk': [],
      'unproven-assertion': [{
        assertionId: 'A1',
        assertion: 'consumer remains compatible',
        evidence: 'stopped',
        scope: 'current revision',
        stoppingRung: 'ruled-out-bad-case',
        reason: 'environment unavailable',
        nextEvidence: 'provision runner',
      }],
    },
  });
  unproven.assertionLadders[0].rungs[2] = {
    name: 'ruled-out-bad-case',
    progression: 'unavailable',
    'evidence-outcome': 'inconclusive',
    evidence: '',
    scope: 'current revision',
  };
  unproven.assertionLadders[0].rungs[3] = {
    name: 'executable-proof',
    progression: 'not-attempted',
    'evidence-outcome': 'inconclusive',
    evidence: '',
    scope: 'current revision',
  };
  unproven.assertionLadders[0].rungs[4] = {
    name: 'live-reproduction',
    progression: 'not-attempted',
    'evidence-outcome': 'inconclusive',
    evidence: '',
    scope: 'current revision',
  };
  unproven.assertionLadders[0].stoppingRung = 'ruled-out-bad-case';
  unproven.assertionLadders[0].stoppingReason = 'environment unavailable';
  unproven.assertionLadders[0].nextEvidenceNeeded = 'provision runner';
  assert.equal(adaptBlastRadiusEvidence(unproven, revision, identity).readiness, 'unproven-assertion');
  assert.equal(adaptBlastRadiusEvidence(blast({
    'regression-proof-status': 'unavailable',
    'regression-proof': null,
    'next-evidence-action': 'obtain read-only proof',
    'next-evidence-reason': 'environment absent',
  }), revision, identity).readiness, 'unavailable');
  assert.equal(adaptBlastRadiusEvidence(blast({
    syntheticCompletion: true,
  }), revision, identity).readiness, 'invalid');
});

test('quality gate validates raw receipts and human descoping receipts instead of booleans', () => {
  assert.equal(evaluateQualityGate(gate()).readyForPublication, true);
  assert.equal(evaluateQualityGate(gate({
    ciReceipt: { status: 'passed', evidenceComplete: true },
  })).readyForPublication, false);
  assert.match(evaluateQualityGate(gate({
    roastReceipt: roast({ findings: [{ id: 'R1', Priority: 'Must fix', status: 'open' }] }),
  })).defects.join(' '), /Must fix/);
  assert.match(evaluateQualityGate(gate({
    criteria: [{ id: 'C1', verdict: 'descoped-by-human' }],
  })).defects.join(' '), /human-decision-receipt/);

  const currentManifest = manifest('yes', [{
    id: 'HD-1',
    actor: 'human-reviewer-17',
    issue: '1',
    criterionId: 'C1',
    sourceRevision: 'r1',
    decision: 'descoped',
    decisionText: 'Criterion intentionally removed from this confirmed delivery.',
    decidedAt: '2026-08-30T00:13:00Z',
  }]);
  const decision = currentManifest.humanDecisions[0];
  const descoped = gate({
    manifest: currentManifest,
    criteria: [{
      id: 'C1',
      verdict: 'descoped-by-human',
      decisionReceipt: {
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
      },
    }],
  });
  assert.equal(evaluateQualityGate(descoped).readyForPublication, true);
  const mutatedManifest = structuredClone(descoped.manifest);
  mutatedManifest.goal = 'mutated authority';
  const rejected = evaluateQualityGate({ ...descoped, manifest: mutatedManifest });
  assert.equal(rejected.readyForPublication, false);
  assert.match(rejected.defects.join('\n'), /manifest digest does not match authority fields/);
});

test('enforces workflow order, conditional Shepherd intent, invalidation, and bounded remediation', () => {
  const issue = { pipeline: [] };
  const implementation = {
    ...revision,
    status: 'completed',
    complete: true,
    terminal: true,
    completedAt: '2026-08-30T00:05:00Z',
  };
  const yesManifest = manifest('yes');
  const implemented = recordStage(issue, 'implementation', implementation, revision, yesManifest);
  assert.throws(
    () => recordStage(implemented, 'run-ci', ci(), revision, yesManifest),
    /expected diff-reconciliation/,
  );
  assert.deepEqual(deliveryStagesForManifest(manifest('no')).at(-1), 'publication');
  assert.throws(
    () => recordStage({ pipeline: deliveryStagesForManifest(manifest('no')).map((stage) => ({
      stage, evidence: revision,
    })) }, 'shepherd', revision, revision, manifest('no')),
    /not required/,
  );
  const invalidated = invalidateRevisionEvidence({
    baseSha: 'base', headSha: 'old',
    pipeline: [{ stage: 'run-ci', evidence: { baseSha: 'base', headSha: 'old' } }],
    qualityEvidence: { ci: 'passed' },
    changeRequest: { identifier: 'PR-1' },
    shepherd: { ready: true },
    setObligation: {},
    terminalDisposition: 'ready-for-human-merge',
  }, revision);
  assert.deepEqual(invalidated.pipeline, []);
  assert.equal(invalidated.changeRequest, null);
  assert.equal(invalidated.terminalDisposition, null);
  assert.equal(remediationDecision({ attempt: 0, limit: 1, defects: ['failed-check'] }).action, 'dispatch-fresh-remediation-worker');
  assert.equal(remediationDecision({ attempt: 1, limit: 1, defects: ['roast-blocker'] }).action, 'hand-back');
});

test('stable packet identity excludes mutable cursors and policy while policy binds separately', () => {
  const currentManifest = tieredManifest();
  const packet = packetFor(currentManifest);
  const moved = {
    ...packet,
    baseSha: 'different-base',
    headSha: 'different-head',
    reviewPolicy: {
      ...packet.reviewPolicy,
      churnThresholdPercent: 35,
    },
  };
  assert.equal(reviewPacketBindingDigest(packet), reviewPacketBindingDigest(moved));
  assert.notEqual(
    reviewPolicyDigest(packet.reviewPolicy),
    reviewPolicyDigest(moved.reviewPolicy),
  );
});

test('tiered review lineage survives head invalidation and validates after replay', () => {
  const currentManifest = tieredManifest();
  const issueDefinition = currentManifest.issues[0];
  let record = {
    identity: '1',
    assignment: { generation: 1, packet: packetFor(currentManifest) },
    continuationChain: [],
    baseSha: 'base',
    headSha: 'head',
    qualityEvidence: {},
    pipeline: [
      { stage: 'implementation', evidence: { ...revision } },
      { stage: 'diff-reconciliation', evidence: { ...revision } },
      { stage: 'run-ci', evidence: ci() },
    ],
  };
  const full = roast({
    reviewTier: reviewTier(
      'full',
      record.assignment.packet,
      issueDefinition,
    ),
  });
  record = recordStage(record, 'roast', full, revision, currentManifest);
  assert.equal(record.qualityEvidence.reviewLineage.lastDeep.headSha, 'head');
  const baseChanged = invalidateRevisionEvidence(record, {
    baseSha: 'base-2',
    headSha: 'head-2',
  });
  assert.equal(Object.hasOwn(baseChanged.qualityEvidence, 'reviewLineage'), false);
  assert.equal(baseChanged.nextAction, 'run-full-review-for-new-authority');

  const nextRevision = { baseSha: 'base', headSha: 'head-2' };
  record = invalidateRevisionEvidence(record, nextRevision);
  assert.equal(record.qualityEvidence.reviewLineage.lastDeep.headSha, 'head');
  assert.equal(record.qualityEvidence.reviewLineage.latestCorrection, null);
  record.pipeline = [
    { stage: 'implementation', evidence: { ...nextRevision } },
    { stage: 'diff-reconciliation', evidence: { ...nextRevision } },
    { stage: 'run-ci', evidence: ci(nextRevision) },
  ];
  const correction = roast({
    ...nextRevision,
    reviewTier: reviewTier(
      'correction',
      record.assignment.packet,
      issueDefinition,
    ),
  });

  record = recordStage(record, 'roast', correction, nextRevision, currentManifest);
  const replayed = JSON.parse(JSON.stringify(record));
  assert.equal(
    validateReviewLineage(replayed.qualityEvidence.reviewLineage, replayed, issueDefinition, currentManifest),
    true,
  );
  assert.equal(replayed.qualityEvidence.reviewLineage.latestCorrection.headSha, 'head-2');

  const thirdRevision = { baseSha: 'base', headSha: 'head-3' };
  let deepReset = invalidateRevisionEvidence(replayed, thirdRevision);
  deepReset.pipeline = [
    { stage: 'implementation', evidence: { ...thirdRevision } },
    { stage: 'diff-reconciliation', evidence: { ...thirdRevision } },
    { stage: 'run-ci', evidence: ci(thirdRevision) },
  ];
  assert.throws(() => recordStage(deepReset, 'roast', roast({
    ...thirdRevision,
    status: 'failed',
    reviewTier: reviewTier('full', deepReset.assignment.packet, issueDefinition),
  }), thirdRevision, currentManifest), /Roast evidence does not pass/);
  assert.equal(deepReset.qualityEvidence.reviewLineage.lastDeep.headSha, 'head');
  deepReset = recordStage(deepReset, 'roast', roast({
    ...thirdRevision,
    reviewTier: reviewTier('full', deepReset.assignment.packet, issueDefinition),
  }), thirdRevision, currentManifest);
  assert.equal(deepReset.qualityEvidence.reviewLineage.lastDeep.headSha, 'head-3');
  assert.equal(deepReset.qualityEvidence.reviewLineage.cumulativeDiffBase, 'head-3');
  assert.equal(deepReset.qualityEvidence.reviewLineage.latestCorrection, null);

  const staleGeneration = structuredClone(replayed);
  staleGeneration.assignment.generation = 2;
  assert.throws(() => validateReviewLineage(
    staleGeneration.qualityEvidence.reviewLineage,
    staleGeneration,
    issueDefinition,
    currentManifest,
  ), /authority binding/);
  const staleHead = structuredClone(replayed);
  staleHead.headSha = 'head-3';
  assert.throws(() => validateReviewLineage(
    staleHead.qualityEvidence.reviewLineage,
    staleHead,
    issueDefinition,
    currentManifest,
  ), /correction revision is stale/);
});

test('Squadron callable path consumes correction transport without a second full review', async () => {
  const currentManifest = tieredManifest();
  const current = {
    baseSha: POLICY_BASE,
    headSha: POLICY_CURRENT_HEAD,
    packetDigest: 'a'.repeat(64),
    scopeDigest: 'b'.repeat(64),
    sourceRevision: 'r1',
  };
  const calls = [];
  const result = await runSquadronTieredReview({
    input: {
      policy: newCodeReviewDefaultPolicy(),
      current,
      lastDeep: { ...current, headSha: POLICY_DEEP_HEAD },
      previousHead: POLICY_DEEP_HEAD,
      latestDelta: {
        baseSha: POLICY_DEEP_HEAD,
        headSha: POLICY_CURRENT_HEAD,
        paths: ['src/a.js'],
        evidenceComplete: true,
        semanticAssessment: {
          complete: true,
          categories: SEMANTIC_ASSESSMENT_CATEGORIES.map((category) => ({
            category, changed: false, evidence: `${category} assessed`,
          })),
          uncertainties: [],
        },
      },
      cumulativeDelta: {
        baseSha: POLICY_DEEP_HEAD,
        headSha: POLICY_CURRENT_HEAD,
        paths: ['src/a.js'],
        evidenceComplete: true,
        semanticAssessment: {
          complete: true,
          categories: SEMANTIC_ASSESSMENT_CATEGORIES.map((category) => ({
            category, changed: false, evidence: `${category} assessed`,
          })),
          uncertainties: [],
        },
      },
      deltaReconciliation: { complete: true, revertedPaths: [], unexplainedPaths: [] },
      fileScopeAssessment: {
        complete: true,
        newOrOutOfScopeFiles: false,
        evidence: 'scope is unchanged',
      },
      requirements: ['done'],
      originalFindingIds: ['F-1'],
      affectedConsumers: ['consumer-a'],
      validation: { headSha: POLICY_CURRENT_HEAD, complete: true },
      remediationAttempt: 1,
    },
    repositoryRoot: '/repo',
    reviewBaseSha: POLICY_BASE,
    lastDeepHead: POLICY_DEEP_HEAD,
    currentHead: POLICY_CURRENT_HEAD,
    runGit: (_root, args) =>
      args.includes(POLICY_BASE) ? '60\t40\tsrc/base.js\n' : '10\t0\tsrc/a.js\n',
    runtimeAvailableModels: ['gpt-5.6-sol', 'gpt-6-astra'],
    correctionTransport: async () => {
      calls.push('correction');
      return JSON.stringify({
        schemaVersion: 1,
        status: 'complete',
        headSha: POLICY_CURRENT_HEAD,
        findingDispositions: [{
          findingId: 'F-1',
          disposition: 'addressed',
          evidence: 'current evidence',
          reasoning: 'requirement satisfied',
        }],
        requirementChecks: [{
          requirement: 'done',
          status: 'satisfied',
          evidence: 'criterion is satisfied',
          negativeCases: ['failure path remains rejected'],
        }],
        affectedConsumersReviewed: [{
          consumer: 'consumer-a',
          status: 'satisfied',
          evidence: 'consumer remains compatible',
        }],
        regressions: [],
        newFindings: [],
        uncertainties: [],
      });
    },
    fullReview: async () => {
      calls.push('full');
      return { status: 'complete' };
    },
  });
  assert.deepEqual(calls, ['correction']);
  assert.equal(result.authoritative, 'correction');
});

test('reuses deterministic hunk reconciliation without composing ship units', () => {
  assert.equal(reconcileFleetDiff({
    ledger: [{ id: 'L1', classification: 'in-scope' }],
    diff: 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-old\n+new\n',
    mapping: [{ file: 'a.txt', hunkIndex: 0, entryId: 'L1' }],
  }).verdict, 'reconciled');
});
