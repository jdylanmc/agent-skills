import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptShepherdReturn, expireReadinessAfterSiblingMerge } from './readiness-set.mjs';

function shepherd(overrides = {}) {
  return {
    invocation: { mode: 'nested-worker', freshContext: true, status: 'returned' },
    result: {
      disposition: 'mergeable-and-green',
      receipt: {
        observedAt: '2026-08-30T00:00:00Z',
        baseSha: 'base-2',
        headSha: 'head',
        upToDatePolicy: 'required',
        provider: 'github',
        complete: true,
      },
    },
    observation: {
      observedAt: '2026-08-30T00:01:00Z',
      baseSha: 'base-2',
      headSha: 'head',
      containsCurrentBase: true,
    },
    setObligation: {
      owner: 'fleet',
      expiresWhen: 'sibling merge',
      reinvocation: 'invoke shepherd again',
    },
    ...overrides,
  };
}

test('accepts only a fresh real nested Shepherd result under strict policy', () => {
  assert.equal(acceptShepherdReturn(shepherd()).ready, true);
  assert.equal(acceptShepherdReturn(shepherd({
    observation: {
      observedAt: '2026-08-30T00:01:00Z',
      baseSha: 'base-2',
      headSha: 'head',
      containsCurrentBase: false,
    },
  })).ready, false);
  assert.equal(acceptShepherdReturn(shepherd({
    result: {
      disposition: 'provider-tool-unobserved',
      receipt: shepherd().result.receipt,
    },
  })).ready, false);
  assert.equal(acceptShepherdReturn(shepherd({ setObligation: null })).ready, false);
});

test('expires open sibling readiness and queues re-Shepherding', () => {
  const state = {
    issues: {
      a: {
        identity: 'a',
        changeRequest: { identifier: 'PR-A', baseBranch: 'main' },
        shepherd: { ready: true, receipt: { baseSha: 'base-1' } },
      },
      b: {
        identity: 'b',
        changeRequest: { identifier: 'PR-B', baseBranch: 'main' },
        shepherd: { ready: true, receipt: { baseSha: 'base-1' } },
      },
    },
    observedHumanMerges: [],
    expiredReadinessClaims: [],
    reShepherdQueue: [],
  };
  const next = expireReadinessAfterSiblingMerge(state, {
    observed: true,
    changeRequest: 'PR-A',
    baseBranch: 'main',
    mergeCommit: 'merge-a',
  }, 'base-2');
  assert.equal(next.issues.b.shepherd.ready, false);
  assert.deepEqual(next.reShepherdQueue.map((entry) => entry.issue), ['b']);
});
