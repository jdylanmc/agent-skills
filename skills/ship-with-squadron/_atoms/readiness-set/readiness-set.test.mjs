import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  acceptShepherdReturn,
  consumeNoShepherdRevalidation,
  consumeReShepherdQueue,
  expireReadinessAfterSiblingMerge,
  recordShepherdNotRequired,
} from './readiness-set.mjs';

function manifest(shepherdIntent = 'yes') {
  return normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: 'deliver',
    acceptedScope: [],
    exclusions: [],
    humanDecisions: [],
    issues: ['a', 'b', 'c'].map((identity) => ({
      identity,
      sourceRevision: `r-${identity}`,
      sourceReceipt: {
        invocation: { id: `read-${identity}`, operation: 'read-issue' },
        provider: 'github', repository: 'owner/repo', issue: identity, revision: `r-${identity}`,
        status: 'observed', terminal: true, complete: true, observedAt: '2026-08-30T00:00:00Z',
      },
      acceptanceCriteria: ['done'], scope: [], allowedPaths: [`${identity}/**`],
    })),
    dependencies: [],
    concurrency: 2,
    budget: { cost: 10, timeMinutes: 60, retries: 2 },
    repository: { id: 'owner/repo', root: '/repo', baseBranch: 'main' },
    provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge'] },
    validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
    stopConditions: ['cancelled'],
    humanBoundaries: ['human merge'],
    shepherdIntent,
  });
}

function expected(issue = 'b', generation = 1, baseSha = 'base-1') {
  return {
    runId: 'run',
    issue,
    provider: 'github',
    repository: 'owner/repo',
    changeRequest: `PR-${issue.toUpperCase()}`,
    baseBranch: 'main',
    baseSha,
    headSha: `head-${issue}`,
    obligationGeneration: generation,
  };
}

function shepherd(expectation = expected(), overrides = {}) {
  return {
    invocation: {
      skill: 'shepherd',
      id: `shepherd-${expectation.issue}-${expectation.obligationGeneration}`,
      runId: expectation.runId,
      issue: expectation.issue,
      changeRequest: expectation.changeRequest,
      mode: 'nested-worker',
      freshContext: true,
      status: 'returned',
    },
    result: {
      disposition: 'mergeable-and-green',
      terminal: true,
      complete: true,
      receipt: {
        observedAt: '2026-08-30T00:00:00Z',
        provider: expectation.provider,
        repository: expectation.repository,
        changeRequest: expectation.changeRequest,
        baseBranch: expectation.baseBranch,
        baseSha: expectation.baseSha,
        headSha: expectation.headSha,
        upToDatePolicy: 'required',
        complete: true,
      },
    },
    observation: {
      observedAt: '2026-08-30T00:01:00Z',
      provider: expectation.provider,
      repository: expectation.repository,
      changeRequest: expectation.changeRequest,
      baseBranch: expectation.baseBranch,
      baseSha: expectation.baseSha,
      headSha: expectation.headSha,
      containsCurrentBase: true,
    },
    setObligation: {
      owner: expectation.issue,
      changeRequest: expectation.changeRequest,
      baseBranch: expectation.baseBranch,
      baseSha: expectation.baseSha,
      headSha: expectation.headSha,
      expiresWhen: 'sibling-merge-into-base',
      reinvocation: 'invoke-fresh-shepherd',
      generation: expectation.obligationGeneration,
      createdAt: '2026-08-30T00:01:01Z',
    },
    ...overrides,
  };
}

function accepted(issue = 'b') {
  const expectation = expected(issue);
  return acceptShepherdReturn(shepherd(expectation), expectation);
}

function state() {
  const shepherdA = accepted('a');
  const shepherdB = accepted('b');
  return {
    manifestDigest: manifest().digest,
    providerConfigurationDigest: manifest().providerConfigurationDigest,
    revision: 5,
    issues: {
      a: {
        identity: 'a', baseSha: 'base-1', headSha: 'head-a',
        changeRequest: {
          identifier: 'PR-A', publicationKey: 'pub-a', baseBranch: 'main',
          provider: 'github', repository: 'owner/repo', headSha: 'head-a',
        },
        pipeline: [{ stage: 'publication' }, { stage: 'shepherd' }],
        shepherd: shepherdA,
        shepherdDecision: null,
        setObligation: shepherdA.setObligation,
        terminalDisposition: 'ready-for-human-merge',
      },
      b: {
        identity: 'b', baseSha: 'base-1', headSha: 'head-b',
        changeRequest: {
          identifier: 'PR-B', publicationKey: 'pub-b', baseBranch: 'main',
          provider: 'github', repository: 'owner/repo', headSha: 'head-b',
        },
        pipeline: [{ stage: 'publication' }, { stage: 'shepherd' }],
        shepherd: shepherdB,
        shepherdDecision: null,
        setObligation: shepherdB.setObligation,
        terminalDisposition: 'ready-for-human-merge',
      },
      c: {
        identity: 'c', baseSha: 'base-1', headSha: 'head-c',
        changeRequest: {
          identifier: 'PR-C', publicationKey: 'pub-c', baseBranch: 'main',
          provider: 'github', repository: 'owner/repo', headSha: 'head-c',
        },
        pipeline: [{ stage: 'publication' }],
        shepherd: null,
        shepherdDecision: null,
        setObligation: null,
        terminalDisposition: 'blocked',
      },
    },
    publications: [
      {
        state: 'confirmed', key: 'pub-a', provider: 'github', repository: 'owner/repo',
        issue: 'a', identifier: 'PR-A', baseBranch: 'main', headBranch: 'issue-a', headSha: 'head-a',
      },
      {
        state: 'confirmed', key: 'pub-b', provider: 'github', repository: 'owner/repo',
        issue: 'b', identifier: 'PR-B', baseBranch: 'main', headBranch: 'issue-b', headSha: 'head-b',
      },
      {
        state: 'confirmed', key: 'pub-c', provider: 'github', repository: 'owner/repo',
        issue: 'c', identifier: 'PR-C', baseBranch: 'main', headBranch: 'issue-c', headSha: 'head-c',
      },
    ],
    observedHumanMerges: [],
    expiredReadinessClaims: [],
    reShepherdQueue: [],
    fleetDisposition: 'review-ready',
    events: [],
  };
}

const mergeA = {
  observed: true,
  provider: 'github',
  repository: 'owner/repo',
  issue: 'a',
  changeRequest: 'PR-A',
  publicationKey: 'pub-a',
  baseBranch: 'main',
  headBranch: 'issue-a',
  headSha: 'head-a',
  mergeCommit: 'merge-a',
  observedAt: '2026-08-30T00:02:00Z',
};
const mergeC = {
  ...mergeA,
  issue: 'c',
  changeRequest: 'PR-C',
  publicationKey: 'pub-c',
  headBranch: 'issue-c',
  headSha: 'head-c',
  mergeCommit: 'merge-c',
  observedAt: '2026-08-30T00:03:00Z',
};

test('accepts only exact provider/CR/revision/owner-bound real nested Shepherd returns', () => {
  const expectation = expected();
  assert.equal(acceptShepherdReturn(shepherd(expectation), expectation).ready, true);
  assert.equal(acceptShepherdReturn(shepherd(expectation, {
    observation: { ...shepherd(expectation).observation, containsCurrentBase: false },
  }), expectation).ready, false);
  assert.equal(acceptShepherdReturn(shepherd(expectation, {
    result: {
      ...shepherd(expectation).result,
      receipt: { ...shepherd(expectation).result.receipt, provider: '' },
    },
  }), expectation).ready, false);
  assert.equal(acceptShepherdReturn(shepherd(expectation, { setObligation: null }), expectation).ready, false);
});

test('expires readiness immediately and queues generation/revision-specific re-Shepherd work', () => {
  const current = expireReadinessAfterSiblingMerge(
    state(),
    manifest(),
    mergeA,
    { b: { baseSha: 'base-2', headSha: 'head-b', observedAt: '2026-08-30T00:02:01Z' } },
    '2026-08-30T00:02:02Z',
  );
  assert.equal(current.issues.b.shepherd.ready, false);
  assert.equal(current.issues.b.terminalDisposition, 'blocked');
  assert.equal(current.fleetDisposition, 'blocked');
  assert.equal(current.reShepherdQueue[0].generation, 2);
  assert.equal(current.reShepherdQueue[0].baseSha, 'base-2');
  assert.equal(current.issues.b.pipeline.at(-1).stage, 'publication');

  const repeat = expireReadinessAfterSiblingMerge(
    current,
    manifest(),
    mergeC,
    { b: { baseSha: 'base-3', headSha: 'head-b', observedAt: '2026-08-30T00:03:01Z' } },
    '2026-08-30T00:03:02Z',
  );
  assert.equal(repeat.reShepherdQueue.length, 1);
  assert.equal(repeat.reShepherdQueue[0].generation, 3);
  assert.equal(repeat.reShepherdQueue[0].baseSha, 'base-3');
});

test('consumes queued work only with a fresh accepted receipt bound to the queued generation', () => {
  const expired = expireReadinessAfterSiblingMerge(
    state(),
    manifest(),
    mergeA,
    { b: { baseSha: 'base-2', headSha: 'head-b', observedAt: '2026-08-30T00:02:01Z' } },
  );
  const expectation = expected('b', 2, 'base-2');
  const fresh = acceptShepherdReturn(shepherd(expectation), expectation);
  assert.throws(() => consumeReShepherdQueue(expired, 'b', accepted('b')), /queued generation/);
  const consumed = consumeReShepherdQueue(expired, 'b', fresh);
  assert.equal(consumed.reShepherdQueue.length, 0);
  assert.equal(consumed.issues.b.terminalDisposition, 'ready-for-human-merge');
  assert.equal(consumed.issues.b.pipeline.at(-1).stage, 'shepherd');
});

test('manifest Shepherd intent no records a real not-required state and obligation without dispatch', () => {
  const noManifest = manifest('no');
  const current = {
    manifestDigest: noManifest.digest,
    providerConfigurationDigest: noManifest.providerConfigurationDigest,
    issues: {
      a: {
        identity: 'a',
        baseSha: 'base-1',
        headSha: 'head-a',
        changeRequest: { identifier: 'PR-A' },
        shepherd: null,
        shepherdDecision: null,
        setObligation: null,
      },
    },
    events: [],
  };
  const next = recordShepherdNotRequired(current, noManifest, 'a', {
    owner: 'a',
    changeRequest: 'PR-A',
    baseBranch: 'main',
    baseSha: 'base-1',
    headSha: 'head-a',
    expiresWhen: 'sibling-merge-into-base',
    reinvocation: 'rerun-quality-and-provider-observation',
    generation: 1,
    createdAt: '2026-08-30T00:01:01Z',
  });
  assert.equal(next.issues.a.shepherd, null);
  assert.equal(next.issues.a.shepherdDecision.state, 'not-required');
  assert.equal(next.events[0].type, 'shepherd-not-required');
});

test('no-Shepherd expiry is consumed by fresh quality/provider revalidation, never a fabricated Shepherd', () => {
  const noManifest = manifest('no');
  const current = {
    manifestDigest: noManifest.digest,
    providerConfigurationDigest: noManifest.providerConfigurationDigest,
    issues: {
      b: {
        identity: 'b', baseSha: 'base-1', headSha: 'head-b',
        changeRequest: { identifier: 'PR-B' },
        shepherd: null,
        shepherdDecision: { state: 'not-required', manifestDigest: noManifest.digest },
        setObligation: null,
        terminalDisposition: 'blocked',
      },
    },
    reShepherdQueue: [{
      issue: 'b', changeRequest: 'PR-B', generation: 2,
      baseSha: 'base-2', headSha: 'head-b',
      action: 'rerun-quality-and-provider-observation',
    }],
    events: [],
  };
  const pipeline = [
    'implementation', 'diff-reconciliation', 'run-ci', 'roast',
    'blast-radius-proof', 'bounded-remediation', 'criterion-verdict', 'publication',
  ].map((stage) => ({ stage, evidence: { baseSha: 'base-2', headSha: 'head-b' } }));
  const obligation = {
    owner: 'b', changeRequest: 'PR-B', baseBranch: 'main',
    baseSha: 'base-2', headSha: 'head-b',
    expiresWhen: 'sibling-merge-into-base',
    reinvocation: 'rerun-quality-and-provider-observation',
    generation: 2,
    createdAt: '2026-08-30T00:04:00Z',
  };
  assert.throws(() => consumeNoShepherdRevalidation(current, noManifest, 'b', {
    status: 'completed', terminal: true, complete: true,
    issue: 'b', changeRequest: 'PR-B', baseSha: 'stale', headSha: 'head-b', pipeline,
  }, obligation), /incomplete or stale/);
  const consumed = consumeNoShepherdRevalidation(current, noManifest, 'b', {
    status: 'completed', terminal: true, complete: true,
    issue: 'b', changeRequest: 'PR-B', baseSha: 'base-2', headSha: 'head-b', pipeline,
  }, obligation);
  assert.equal(consumed.reShepherdQueue.length, 0);
  assert.equal(consumed.issues.b.shepherd, null);
  assert.equal(consumed.issues.b.shepherdDecision.state, 'not-required');
  assert.equal(consumed.issues.b.terminalDisposition, 'ready-for-human-merge');
});
