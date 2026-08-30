import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORBIDDEN_PROVIDER_OPERATIONS,
  authorizeProviderOperation,
  observeHumanMerge,
  recordPublication,
} from './provider-seam.mjs';

const configuration = {
  allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge'],
};
const request = {
  configuration,
  provider: 'github',
  repository: 'owner/repo',
  issue: '1',
  headBranch: 'issue-1',
  baseBranch: 'main',
};

test('allows only provider-neutral read, publication, and observation operations', () => {
  assert.equal(authorizeProviderOperation(configuration, 'read-issue').authorized, true);
  for (const operation of FORBIDDEN_PROVIDER_OPERATIONS) {
    assert.equal(authorizeProviderOperation(configuration, operation).authorized, false);
  }
});

test('preserves provider degradation and defends duplicate publication', () => {
  const state = recordPublication({ publications: [] }, request, {
    status: 'provider-tool-unobserved',
  });
  assert.equal(state.publications[0].outcome, 'provider-tool-unobserved');
  assert.equal(state.publications[0].identifier, null);
  assert.throws(() => recordPublication(state, request, {
    status: 'published', identifier: 'PR-1',
  }), /duplicate publication/);
  const published = recordPublication({ publications: [] }, request, {
    status: 'published', identifier: 'PR-1',
  });
  assert.throws(() => recordPublication(published, {
    ...request,
    headBranch: 'issue-1-mutated',
  }, {
    status: 'published', identifier: 'PR-2',
  }), /duplicate publication/);
});

test('observes, but never performs, a human merge', () => {
  assert.equal(observeHumanMerge({
    configuration,
    providerStatus: 'unobserved',
  }).observed, false);
  const observed = observeHumanMerge({
    configuration,
    providerStatus: 'observed',
    merged: true,
    issue: '1',
    changeRequest: 'PR-1',
    baseBranch: 'main',
    mergeCommit: 'abc',
    observedAt: '2026-08-30T00:00:00Z',
  });
  assert.equal(observed.observed, true);
  assert.equal(observed.mergeCommit, 'abc');
});
