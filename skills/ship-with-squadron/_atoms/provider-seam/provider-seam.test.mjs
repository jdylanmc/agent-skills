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
  return {
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
        pipeline: [{ stage: 'criterion-verdict', evidence: { baseSha: 'base', headSha: 'head' } }],
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
  assert.equal(begun.state.publications[0].state, 'intent-recorded');
  assert.equal(publicationRecoveryAction(begun.state, begun.key).action, 'reconcile-by-stable-provider-key-before-retry');

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
  assert.equal(published.publications[0].state, 'confirmed');
  assert.equal(published.issues['1'].changeRequest.identifier, 'PR-1');
  assert.equal(beginPublication(published, manifest, request).action, 'already-confirmed');
  assert.equal(reconcilePublication(published, manifest, begun.key, result(begun.key)).publications.length, 1);
});

test('preserves retryable degradation and refuses malformed caller-shaped publication success', () => {
  const begun = beginPublication(state(), manifest, request);
  const degraded = reconcilePublication(begun.state, manifest, begun.key, result(begun.key, {
    status: 'provider-tool-unobserved',
    identifier: null,
  }));
  assert.equal(degraded.publications[0].state, 'retryable-degraded');
  assert.equal(publicationRecoveryAction(degraded, begun.key).previousAttempts, 1);
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
    status: 'observed',
    terminal: true,
    complete: true,
    merged: true,
    provider: 'github',
    repository: 'owner/repo',
    issue: '1',
    changeRequest: 'PR-1',
    baseBranch: 'main',
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
});
