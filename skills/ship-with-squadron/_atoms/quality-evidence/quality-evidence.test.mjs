import assert from 'node:assert/strict';
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
} from './quality-evidence.mjs';

const revision = { baseSha: 'base', headSha: 'head' };
const identity = { runId: 'run', issue: '1' };

function manifest(shepherdIntent = 'yes', humanDecisions = []) {
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
    }],
    dependencies: [],
    concurrency: 1,
    budget: { cost: 10, timeMinutes: 60, retries: 2 },
    repository: { id: 'owner/repo', root: '/repo', baseBranch: 'main' },
    provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge', 'observe-change-request-revision'] },
    validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
    stopConditions: ['cancelled'],
    humanBoundaries: ['human merge'],
    shepherdIntent,
  });
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
    invocation: { skill: 'blast-radius', id: 'blast-1', runId: 'run', issue: '1' },
    contractRepository: 'jdylanmc/agent-skills',
    contractPullRequest: 157,
    contractBranch: 'origin/issue-70-blast-radius-proof',
    contractBaseRevision: '02ae9f84c782b9e57dfec20cda344fb494e57049',
    contractRevision: '4a946e4500479e028112b77bdf268c5b7a8aae1f',
    status: 'completed',
    terminal: true,
    complete: true,
    evidenceComplete: true,
    completedAt: '2026-08-30T00:12:00Z',
    ...revision,
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
      stoppingRung: 'live-reproduction',
      stoppingReason: 'all available rungs completed',
      strongestSupportedClaim: 'bad case ruled out in recorded scope',
      nextEvidenceNeeded: 'none before merge',
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
    'next-evidence-action': null,
    'next-evidence-reason': null,
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

test('requires nonempty exact Pull Request 157 ladders, classifications, proof, and stopping evidence', () => {
  assert.equal(adaptBlastRadiusEvidence(blast(), revision, identity).readiness, 'satisfied');
  assert.equal(adaptBlastRadiusEvidence(blast({ assertionLadders: [] }), revision, identity).readiness, 'invalid');
  assert.equal(adaptBlastRadiusEvidence(blast({ evidenceComplete: false }), revision, identity).readiness, 'invalid');
  assert.equal(adaptBlastRadiusEvidence(blast({
    'regression-proof-status': 'selected',
    'regression-proof': null,
  }), revision, identity).readiness, 'invalid');
  assert.equal(adaptBlastRadiusEvidence(blast({
    contractPullRequest: 156,
  }), revision, identity).readiness, 'invalid');
  assert.equal(adaptBlastRadiusEvidence(blast({
    contractRevision: 'stale-contract',
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
  const implemented = recordStage(issue, 'implementation', implementation, revision);
  assert.throws(() => recordStage(implemented, 'run-ci', ci(), revision), /expected diff-reconciliation/);
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

test('reuses deterministic hunk reconciliation without composing ship units', () => {
  assert.equal(reconcileFleetDiff({
    ledger: [{ id: 'L1', classification: 'in-scope' }],
    diff: 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-old\n+new\n',
    mapping: [{ file: 'a.txt', hunkIndex: 0, entryId: 'L1' }],
  }).verdict, 'reconciled');
});
