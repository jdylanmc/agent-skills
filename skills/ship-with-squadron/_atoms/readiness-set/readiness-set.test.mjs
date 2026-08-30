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
  const receiptTime = expectation.obligationGeneration === 1
    ? '2026-08-30T00:01:00Z'
    : '2026-08-30T00:04:00Z';
  const observationTime = expectation.obligationGeneration === 1
    ? '2026-08-30T00:01:01Z'
    : '2026-08-30T00:04:01Z';
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
        observedAt: receiptTime,
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
      observedAt: observationTime,
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
        acceptanceCriteria: manifest().issues.find((issue) => issue.identity === 'a').acceptanceCriteria,
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
        acceptanceCriteria: manifest().issues.find((issue) => issue.identity === 'b').acceptanceCriteria,
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
        acceptanceCriteria: manifest().issues.find((issue) => issue.identity === 'c').acceptanceCriteria,
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
        key: 'pub-a', provider: 'github', repository: 'owner/repo',
        issue: 'a', identifier: 'PR-A', baseBranch: 'main', headBranch: 'issue-a', headSha: 'head-a',
        observations: [{
          state: 'confirmed', baseSha: 'base-1', headSha: 'head-a',
          confirmedAt: '2026-08-30T00:00:30Z',
        }],
      },
      {
        key: 'pub-b', provider: 'github', repository: 'owner/repo',
        issue: 'b', identifier: 'PR-B', baseBranch: 'main', headBranch: 'issue-b', headSha: 'head-b',
        observations: [{
          state: 'confirmed', baseSha: 'base-1', headSha: 'head-b',
          confirmedAt: '2026-08-30T00:00:30Z',
        }],
      },
      {
        key: 'pub-c', provider: 'github', repository: 'owner/repo',
        issue: 'c', identifier: 'PR-C', baseBranch: 'main', headBranch: 'issue-c', headSha: 'head-c',
        observations: [{
          state: 'confirmed', baseSha: 'base-1', headSha: 'head-c',
          confirmedAt: '2026-08-30T00:00:30Z',
        }],
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
  invocation: { id: 'merge-a-observe', operation: 'observe-merge', providerKey: 'pub-a' },
  observed: true,
  status: 'observed',
  terminal: true,
  complete: true,
  merged: true,
  provider: 'github',
  repository: 'owner/repo',
  issue: 'a',
  changeRequest: 'PR-A',
  publicationKey: 'pub-a',
  baseBranch: 'main',
  baseSha: 'base-1',
  headBranch: 'issue-a',
  headSha: 'head-a',
  mergeCommit: 'merge-a',
  observedAt: '2026-08-30T00:02:00Z',
};
const mergeC = {
  ...mergeA,
  invocation: { id: 'merge-c-observe', operation: 'observe-merge', providerKey: 'pub-c' },
  issue: 'c',
  changeRequest: 'PR-C',
  publicationKey: 'pub-c',
  headBranch: 'issue-c',
  headSha: 'head-c',
  mergeCommit: 'merge-c',
  observedAt: '2026-08-30T00:03:00Z',
};

function revision(issue, baseSha, observedAt) {
  return {
    invocation: {
      id: `revision-${issue}-${baseSha}`,
      operation: 'observe-change-request-revision',
      providerKey: `pub-${issue}`,
    },
    status: 'observed',
    terminal: true,
    complete: true,
    provider: 'github',
    repository: 'owner/repo',
    issue,
    changeRequest: `PR-${issue.toUpperCase()}`,
    baseBranch: 'main',
    baseSha,
    headSha: `head-${issue}`,
    observedAt,
  };
}

function validNoShepherdPipeline(baseSha, headSha) {
  const common = {
    baseSha, headSha, complete: true, terminal: true,
    completedAt: '2026-08-30T00:05:00Z',
  };
  const blast = {
    ...common,
    evidenceComplete: true,
    invocation: { skill: 'blast-radius', id: 'blast-b', runId: 'run', issue: 'b' },
    contractPullRequest: 157, status: 'completed',
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
    'next-evidence-action': null, 'next-evidence-reason': null,
  };
  return [
    ['implementation', { ...common, status: 'completed' }],
    ['diff-reconciliation', { ...common, verdict: 'reconciled' }],
    ['run-ci', {
      ...common,
      invocation: { skill: 'run-ci', id: 'ci-b', runId: 'run', issue: 'b' },
      status: 'passed', evidenceComplete: true, steps: [{ name: 'tests', status: 'passed' }],
    }],
    ['roast', {
      ...common,
      invocation: { skill: 'roast', id: 'roast-b', runId: 'run', issue: 'b' },
      status: 'completed', findings: [],
      evidenceComplete: true,
    }],
    ['blast-radius-proof', blast],
    ['bounded-remediation', { ...common, status: 'completed', unresolvedDefects: [] }],
    ['criterion-verdict', {
      ...common,
      verdicts: [{
        id: 'C1', verdict: 'satisfied',
        evidence: { complete: true, summary: 'proven', baseSha, headSha },
      }],
    }],
    ['publication', {
      baseSha, headSha, status: 'confirmed', terminal: true, complete: true,
      observedAt: '2026-08-30T00:05:30Z', provider: 'github', repository: 'owner/repo',
      issue: 'b', changeRequest: 'PR-B', publicationKey: 'pub-b',
    }],
  ].map(([stage, evidence]) => ({ stage, evidence }));
}

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
  assert.throws(() => expireReadinessAfterSiblingMerge(
    state(),
    manifest(),
    mergeA,
    { b: revision('b', 'base-2', '2026-08-30T00:01:59Z') },
  ), /current revision observation is incomplete/);
  const current = expireReadinessAfterSiblingMerge(
    state(),
    manifest(),
    mergeA,
    { b: revision('b', 'base-2', '2026-08-30T00:02:01Z') },
    '2026-08-30T00:02:02Z',
  );
  assert.equal(current.issues.b.shepherd.ready, false);
  assert.equal(current.issues.b.terminalDisposition, 'blocked');
  assert.equal(current.fleetDisposition, 'blocked');
  assert.equal(current.reShepherdQueue[0].generation, 2);
  assert.equal(current.reShepherdQueue[0].baseSha, 'base-2');
  assert.equal(current.issues.b.pipeline.length, 0);
  assert.equal(current.issues.b.changeRequest, null);
  const duplicate = expireReadinessAfterSiblingMerge(
    current,
    manifest(),
    mergeA,
    {},
    '2026-08-30T00:02:03Z',
  );
  assert.equal(duplicate.reShepherdQueue[0].generation, 2);
  assert.equal(duplicate.expiredReadinessClaims.length, current.expiredReadinessClaims.length);

  const repeat = expireReadinessAfterSiblingMerge(
    current,
    manifest(),
    mergeC,
    { b: revision('b', 'base-3', '2026-08-30T00:03:01Z') },
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
    { b: revision('b', 'base-2', '2026-08-30T00:02:01Z') },
  );
  const expectation = expected('b', 2, 'base-2');
  const fresh = acceptShepherdReturn(shepherd(expectation), expectation);
  assert.throws(
    () => consumeReShepherdQueue(expired, manifest(), 'b', accepted('b'), null),
    /queued generation/,
  );
  expired.publications.find((entry) => entry.key === 'pub-b').observations.push({
    state: 'confirmed', baseSha: 'base-2', headSha: 'head-b',
    confirmedAt: '2026-08-30T00:05:30Z',
  });
  expired.issues.b.changeRequest = {
    identifier: 'PR-B', publicationKey: 'pub-b', baseBranch: 'main',
    provider: 'github', repository: 'owner/repo', baseSha: 'base-2', headSha: 'head-b',
  };
  const consumed = consumeReShepherdQueue(expired, manifest(), 'b', fresh, {
    status: 'completed',
    terminal: true,
    complete: true,
    completedAt: '2026-08-30T00:05:45Z',
    pipeline: validNoShepherdPipeline('base-2', 'head-b'),
  });
  assert.equal(consumed.reShepherdQueue.length, 0);
  assert.equal(consumed.issues.b.terminalDisposition, 'ready-for-human-merge');
  assert.equal(consumed.issues.b.pipeline.at(-1).stage, 'shepherd');
});

test('manifest Shepherd intent no records a real not-required state and obligation without dispatch', () => {
  const noManifest = manifest('no');
  const current = {
    runId: 'run',
    manifestDigest: noManifest.digest,
    providerConfigurationDigest: noManifest.providerConfigurationDigest,
    issues: {
      a: {
        identity: 'a',
        baseSha: 'base-1',
        headSha: 'head-a',
        acceptanceCriteria: noManifest.issues.find((issue) => issue.identity === 'a').acceptanceCriteria,
        pipeline: validNoShepherdPipeline('base-1', 'head-a').map((entry) => {
          const evidence = structuredClone(entry.evidence);
          if (evidence.invocation) {
            evidence.invocation.issue = 'a';
            evidence.invocation.id = evidence.invocation.id.replace('-b', '-a');
          }
          if (entry.stage === 'criterion-verdict') {
            evidence.verdicts[0].evidence.summary = 'proven for a';
          }
          if (entry.stage === 'publication') {
            evidence.issue = 'a';
            evidence.changeRequest = 'PR-A';
            evidence.publicationKey = 'pub-a';
          }
          return { stage: entry.stage, evidence };
        }),
        changeRequest: {
          identifier: 'PR-A', publicationKey: 'pub-a', baseSha: 'base-1', headSha: 'head-a',
        },
        shepherd: null,
        shepherdDecision: null,
        setObligation: null,
      },
    },
    publications: [{
      key: 'pub-a', identifier: 'PR-A',
      observations: [{
        state: 'confirmed', baseSha: 'base-1', headSha: 'head-a',
        confirmedAt: '2026-08-30T00:05:30Z',
      }],
    }],
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
    runId: 'run',
    manifestDigest: noManifest.digest,
    providerConfigurationDigest: noManifest.providerConfigurationDigest,
    issues: {
      b: {
        identity: 'b', baseSha: 'base-1', headSha: 'head-b',
        acceptanceCriteria: noManifest.issues.find((issue) => issue.identity === 'b').acceptanceCriteria,
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
      revisionObservation: revision('b', 'base-2', '2026-08-30T00:03:01Z'),
    }],
    publications: [{
      key: 'pub-b', identifier: 'PR-B',
      observations: [{
        state: 'confirmed', baseSha: 'base-2', headSha: 'head-b',
        confirmedAt: '2026-08-30T00:05:30Z',
      }],
    }],
    events: [],
  };
  const pipeline = validNoShepherdPipeline('base-2', 'head-b');
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
    completedAt: '2026-08-30T00:06:00Z',
    issue: 'b', changeRequest: 'PR-B', baseSha: 'stale', headSha: 'head-b', pipeline,
  }, obligation), /incomplete or stale/);
  const consumed = consumeNoShepherdRevalidation(current, noManifest, 'b', {
    status: 'completed', terminal: true, complete: true,
    completedAt: '2026-08-30T00:06:00Z',
    issue: 'b', changeRequest: 'PR-B', baseSha: 'base-2', headSha: 'head-b', pipeline,
  }, obligation);
  assert.equal(consumed.reShepherdQueue.length, 0);
  assert.equal(consumed.issues.b.shepherd, null);
  assert.equal(consumed.issues.b.shepherdDecision.state, 'not-required');
  assert.equal(consumed.issues.b.terminalDisposition, 'ready-for-human-merge');
});
