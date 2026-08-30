import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  FORBIDDEN_PROVIDER_OPERATIONS,
  authorizeProviderOperation,
  beginPublication,
  observeHumanMerge,
  publicationRecoveryAction,
  reconcilePublication,
} from './provider-seam.mjs';

const manifest = normalizeFleetManifest({
  confirmation: 'confirmed',
  goal: 'deliver',
  acceptedScope: [],
  exclusions: [],
  humanDecisions: [],
  issues: [{
    identity: '1', sourceRevision: 'r1',
    sourceReceipt: {
      invocation: { id: 'read-1', operation: 'read-issue' },
      provider: 'github', repository: 'owner/repo', issue: '1', revision: 'r1',
      status: 'observed', terminal: true, complete: true, observedAt: '2026-08-30T00:00:00Z',
    },
    acceptanceCriteria: ['done'], scope: [], allowedPaths: ['src/**'],
  }],
  dependencies: [],
  concurrency: 1,
  budget: { cost: 10, timeMinutes: 60, retries: 2 },
  repository: { id: 'owner/repo', root: '/repo', baseBranch: 'main' },
  provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge'] },
  validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
  stopConditions: ['cancelled'],
  humanBoundaries: ['human merge'],
  shepherdIntent: 'yes',
});

function state() {
  const common = {
    baseSha: 'base',
    headSha: 'head',
    complete: true,
    terminal: true,
    completedAt: '2026-08-30T00:04:00Z',
  };
  const blast = {
    ...common,
    evidenceComplete: true,
    invocation: { skill: 'blast-radius', id: 'blast-1', runId: 'run', issue: '1' },
    contractPullRequest: 157,
    status: 'completed',
    assertionLadders: [{
      id: 'A1', assertion: 'safe', affectedBoundary: 'adapter', badCase: 'breakage',
      safetyCriticalReason: 'unsafe delivery',
      rungs: [
        'assertion', 'exact-source-citation', 'ruled-out-bad-case',
        'executable-proof', 'live-reproduction',
      ].map((name) => ({
        name, progression: 'completed', 'evidence-outcome': 'supports-assertion',
        evidence: `${name} proof`, scope: 'current revision',
      })),
      stoppingRung: 'live-reproduction', stoppingReason: 'complete',
      strongestSupportedClaim: 'safe in scope', nextEvidenceNeeded: 'none',
    }],
    classifications: {
      'confirmed-risk': [],
      'cleared-risk': [{ assertionId: 'A1', evidence: 'proof', scope: 'current revision' }],
      'unproven-assertion': [],
    },
    'regression-proof-status': 'selected',
    'regression-proof': {
      id: 'P1', assertionId: 'A1', badCase: 'breakage', verificationLevel: 'integration',
      environment: 'test', setup: 'setup', action: 'run', observableResult: 'pass',
      prerequisites: [], authorization: 'read-only', cheaperProofInsufficientReason: 'boundary',
      outsideCoverage: 'provider',
    },
    'next-evidence-action': null,
    'next-evidence-reason': null,
  };
  return {
    runId: 'run',
    manifestDigest: manifest.digest,
    providerConfigurationDigest: manifest.providerConfigurationDigest,
    issues: {
      1: {
        identity: '1',
        sourceRevision: 'r1',
        baseSha: 'base',
        headSha: 'head',
        branch: 'issue-1',
        worktree: '/work/1',
        assignment: { branch: 'issue-1' },
        acceptanceCriteria: manifest.issues[0].acceptanceCriteria,
        pipeline: [
          ['implementation', { ...common, status: 'completed' }],
          ['diff-reconciliation', { ...common, verdict: 'reconciled' }],
          ['run-ci', {
            ...common,
            invocation: { skill: 'run-ci', id: 'ci-1', runId: 'run', issue: '1' },
            status: 'passed', evidenceComplete: true,
            steps: [{ name: 'tests', status: 'passed' }],
          }],
          ['roast', {
            ...common,
            invocation: { skill: 'roast', id: 'roast-1', runId: 'run', issue: '1' },
            status: 'completed', findings: [],
            evidenceComplete: true,
          }],
          ['blast-radius-proof', blast],
          ['bounded-remediation', { ...common, status: 'completed', unresolvedDefects: [] }],
          ['criterion-verdict', {
            ...common,
            verdicts: [{
              id: 'C1', verdict: 'satisfied',
              evidence: { complete: true, summary: 'proven', baseSha: 'base', headSha: 'head' },
            }],
          }],
        ].map(([stage, evidence]) => ({ stage, evidence })),
        changeRequest: null,
      },
    },
    publications: [],
    events: [],
  };
}

const request = {
  provider: 'github',
  repository: 'owner/repo',
  issue: '1',
  headBranch: 'issue-1',
  baseBranch: 'main',
  headSha: 'head',
};

function result(key, overrides = {}) {
  return {
    invocation: { id: 'publish-1', operation: 'publish-change-request', providerKey: key },
    terminal: true,
    complete: true,
    status: 'published',
    observedAt: '2026-08-30T00:10:00Z',
    provider: 'github',
    repository: 'owner/repo',
    issue: '1',
    baseBranch: 'main',
    headBranch: 'issue-1',
    baseSha: 'base',
    headSha: 'head',
    identifier: 'PR-1',
    ...overrides,
  };
}

test('authorizes only the persisted manifest allow-list, never caller configuration', () => {
  assert.equal(authorizeProviderOperation(state(), manifest, 'read-issue').authorized, true);
  assert.equal(authorizeProviderOperation({
    ...state(),
    providerConfigurationDigest: 'forged',
  }, manifest, 'read-issue').authorized, false);
  for (const operation of FORBIDDEN_PROVIDER_OPERATIONS) {
    assert.equal(authorizeProviderOperation(state(), manifest, operation).authorized, false);
  }
});

test('records publication intent before call and reconciles crash recovery idempotently', () => {
  const begun = beginPublication(state(), manifest, request, '2026-08-30T00:05:00Z');
  assert.equal(begun.action, 'call-provider-with-stable-key');
  assert.equal(begun.state.publications[0].observations[0].state, 'intent-recorded');
  assert.equal(publicationRecoveryAction(begun.state, manifest, begun.key).action, 'reconcile-by-stable-provider-key-before-retry');

  const recovered = beginPublication(begun.state, manifest, request);
  assert.equal(recovered.key, begun.key);
  assert.equal(recovered.action, 'reconcile-before-retry');
  assert.equal(recovered.state.publications.length, 1);
  const drifted = structuredClone(begun.state);
  drifted.issues['1'].assignment.branch = 'issue-1-other';
  drifted.issues['1'].branch = 'issue-1-other';
  assert.throws(() => beginPublication(drifted, manifest, {
    ...request,
    headBranch: 'issue-1-other',
  }), /different publication intent/);

  const published = reconcilePublication(begun.state, manifest, begun.key, result(begun.key));
  assert.equal(published.publications[0].observations[0].state, 'confirmed');
  assert.deepEqual(published.publications[0].observations[0].attempts[0], {
    invocation: {
      id: 'publish-1',
      operation: 'publish-change-request',
      providerKey: begun.key,
    },
    status: 'published',
    observedAt: '2026-08-30T00:10:00Z',
    terminal: true,
    complete: true,
    provider: 'github',
    repository: 'owner/repo',
    issue: '1',
    baseBranch: 'main',
    headBranch: 'issue-1',
    baseSha: 'base',
    headSha: 'head',
    identifier: 'PR-1',
  });
  assert.equal(published.issues['1'].changeRequest.identifier, 'PR-1');
  assert.equal(beginPublication(published, manifest, request).action, 'already-confirmed-current-revision');
  assert.equal(reconcilePublication(published, manifest, begun.key, result(begun.key)).publications.length, 1);
});

test('preserves retryable degradation and refuses malformed caller-shaped publication success', () => {
  const begun = beginPublication(state(), manifest, request);
  const degraded = reconcilePublication(begun.state, manifest, begun.key, result(begun.key, {
    status: 'provider-tool-unobserved',
    identifier: null,
  }));
  assert.equal(degraded.publications[0].observations[0].state, 'retryable-degraded');
  assert.equal(publicationRecoveryAction(degraded, manifest, begun.key).previousAttempts, 1);
  const exhausted = reconcilePublication(degraded, manifest, begun.key, result(begun.key, {
    invocation: { id: 'publish-2', operation: 'publish-change-request', providerKey: begun.key },
    status: 'transient-failure',
    observedAt: '2026-08-30T00:11:00Z',
    identifier: null,
  }));
  assert.equal(
    publicationRecoveryAction(exhausted, manifest, begun.key).action,
    'stop-recovery-retry-budget-exhausted',
  );
  assert.throws(() => reconcilePublication(begun.state, manifest, begun.key, {
    status: 'published',
    identifier: 'PR-1',
  }), /invocation identity/);
});

test('observes a human merge only when every field reconciles to confirmed publication', () => {
  const begun = beginPublication(state(), manifest, request, '2026-08-30T00:05:00Z');
  const published = reconcilePublication(begun.state, manifest, begun.key, result(begun.key));
  const observation = {
    invocation: { id: 'observe-1', operation: 'observe-merge', providerKey: begun.key },
    observed: true,
    status: 'observed',
    terminal: true,
    complete: true,
    merged: true,
    provider: 'github',
    repository: 'owner/repo',
    issue: '1',
    changeRequest: 'PR-1',
    publicationKey: begun.key,
    baseBranch: 'main',
    baseSha: 'base',
    headBranch: 'issue-1',
    headSha: 'head',
    mergeCommit: 'merge-1',
    observedAt: '2026-08-30T00:11:00Z',
  };
  assert.equal(observeHumanMerge(published, manifest, observation).observed, true);
  assert.equal(observeHumanMerge(published, manifest, {
    ...observation,
    headSha: 'stale',
  }).observed, false);
  assert.equal(observeHumanMerge(published, manifest, {
    ...observation,
    changeRequest: 'PR-forged',
  }).observed, false);
  assert.equal(observeHumanMerge(published, manifest, {
    ...observation,
    callerClaim: true,
  }).reason, 'merge-observation-schema-is-not-exact');
});

test('reuses one logical publication while requiring revision-specific confirmation', () => {
  const begun = beginPublication(state(), manifest, request, '2026-08-30T00:05:00Z');
  const published = reconcilePublication(begun.state, manifest, begun.key, result(begun.key));
  const revised = structuredClone(published);
  revised.issues['1'].baseSha = 'base-2';
  revised.issues['1'].headSha = 'head-2';
  revised.issues['1'].pipeline = revised.issues['1'].pipeline.map((entry) => ({
    ...entry,
    evidence: {
      ...entry.evidence,
      baseSha: 'base-2',
      headSha: 'head-2',
      ...(entry.stage === 'criterion-verdict'
        ? { verdicts: [{
          id: 'C1', verdict: 'satisfied',
          evidence: { complete: true, summary: 'reproven', baseSha: 'base-2', headSha: 'head-2' },
        }] }
        : {}),
    },
  }));
  revised.issues['1'].changeRequest = null;
  const nextRequest = { ...request, baseSha: 'base-2', headSha: 'head-2' };
  const next = beginPublication(revised, manifest, nextRequest, '2026-08-30T00:20:00Z');
  assert.equal(next.state.publications.length, 1);
  assert.equal(next.action, 'reobserve-existing-publication');
  assert.equal(publicationRecoveryAction(next.state, manifest, next.key).action, 'reconcile-by-stable-provider-key-before-retry');
  const confirmed = reconcilePublication(next.state, manifest, next.key, result(next.key, {
    invocation: { id: 'publish-2', operation: 'publish-change-request', providerKey: next.key },
    status: 'found-existing',
    baseSha: 'base-2',
    headSha: 'head-2',
    observedAt: '2026-08-30T00:21:00Z',
  }));
  assert.equal(confirmed.publications[0].identifier, 'PR-1');
  assert.equal(confirmed.publications[0].observations.length, 2);
  assert.equal(confirmed.issues['1'].changeRequest.headSha, 'head-2');
  assert.throws(() => reconcilePublication(confirmed, manifest, next.key, result(next.key, {
    baseSha: 'base',
    headSha: 'head',
  })), /identity does not match/);
});
