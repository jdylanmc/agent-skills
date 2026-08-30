import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptBlastRadiusEvidence,
  evaluateQualityGate,
  invalidateRevisionEvidence,
  reconcileFleetDiff,
  recordStage,
  remediationDecision,
} from './quality-evidence.mjs';

const revision = { baseSha: 'base', headSha: 'head' };

function blast(overrides = {}) {
  return {
    ...revision,
    assertionLadders: [{
      rungs: [{ progression: 'completed', 'evidence-outcome': 'supports-assertion' }],
    }],
    classifications: {
      'confirmed-risk': [],
      'cleared-risk': [{ assertion: 'safe' }],
      'unproven-assertion': [],
    },
    'regression-proof-status': 'selected',
    ...overrides,
  };
}

test('enforces workflow order and exact revision freshness', () => {
  const issue = { pipeline: [] };
  const implemented = recordStage(issue, 'implementation', revision, revision);
  assert.throws(() => recordStage(implemented, 'run-ci', revision, revision), /expected diff-reconciliation/);
  assert.throws(() => recordStage(implemented, 'diff-reconciliation', {
    baseSha: 'base', headSha: 'mutated',
  }, revision), /stale/);
});

test('reuses deterministic hunk reconciliation without composing ship units', () => {
  const result = reconcileFleetDiff({
    ledger: [{ id: 'L1', classification: 'in-scope' }],
    diff: 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-old\n+new\n',
    mapping: [{ file: 'a.txt', hunkIndex: 0, entryId: 'L1' }],
  });
  assert.equal(result.verdict, 'reconciled');
  assert.equal(reconcileFleetDiff({
    ledger: [{ id: 'L1', classification: 'in-scope' }],
    diff: 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@\n-old\n+new\n',
    mapping: [],
  }).verdict, 'undisclosed-change');
});

test('preserves blast-radius vocabulary and refuses gaps as success', () => {
  assert.equal(adaptBlastRadiusEvidence(blast(), revision).readiness, 'satisfied');
  assert.equal(adaptBlastRadiusEvidence(blast({
    classifications: {
      'confirmed-risk': [],
      'cleared-risk': [],
      'unproven-assertion': [{ stoppingRung: 'executable-proof' }],
    },
  }), revision).readiness, 'unproven-assertion');
  assert.equal(adaptBlastRadiusEvidence(blast({
    'regression-proof-status': 'unavailable',
    'next-evidence-action': 'obtain read-only proof',
    'next-evidence-reason': 'environment absent',
  }), revision).readiness, 'unavailable');
});

test('invalidates downstream evidence after head mutation and bounds remediation', () => {
  const issue = {
    baseSha: 'base',
    headSha: 'old',
    pipeline: [{ stage: 'run-ci', evidence: { baseSha: 'base', headSha: 'old' } }],
    qualityEvidence: { ci: 'passed' },
    shepherd: { ready: true },
  };
  const invalidated = invalidateRevisionEvidence(issue, revision);
  assert.deepEqual(invalidated.pipeline, []);
  assert.deepEqual(invalidated.qualityEvidence, {});
  assert.equal(invalidated.shepherd, null);
  assert.equal(remediationDecision({ attempt: 0, limit: 1, defects: ['failed-check'] }).action, 'dispatch-fresh-remediation-worker');
  assert.equal(remediationDecision({ attempt: 1, limit: 1, defects: ['roast-blocker'] }).action, 'hand-back');
});

test('blocks failed checks, Roast blockers, blast gaps, and unmet criteria', () => {
  const clearBlast = adaptBlastRadiusEvidence(blast(), revision);
  const base = {
    reconciliation: { verdict: 'reconciled' },
    ci: { status: 'passed', evidenceComplete: true },
    roast: { findings: [] },
    blastRadius: clearBlast,
    criteria: [{ id: 'C1', verdict: 'satisfied' }],
  };
  assert.equal(evaluateQualityGate(base).readyForPublication, true);
  assert.match(evaluateQualityGate({ ...base, ci: { status: 'failed', evidenceComplete: true } }).defects[0], /run-ci/);
  assert.match(evaluateQualityGate({
    ...base,
    roast: { findings: [{ severity: 'blocker' }] },
  }).defects[0], /roast/);
  assert.match(evaluateQualityGate({
    ...base,
    blastRadius: { readiness: 'unproven-assertion' },
  }).defects[0], /blast-radius/);
  assert.match(evaluateQualityGate({
    ...base,
    criteria: [{ id: 'C1', verdict: 'not-satisfied' }],
  }).defects[0], /criterion/);
});
