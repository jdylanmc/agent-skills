import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import { deliveryStagesForManifest } from '../quality-evidence/quality-evidence.mjs';
import {
  FLEET_DISPOSITIONS,
  ISSUE_DISPOSITIONS,
  conciseFleetStatus,
  deriveFleetDisposition,
  effectiveIssueReadiness,
} from './fleet-disposition.mjs';

const manifest = normalizeFleetManifest({
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
      issueStatus: 'pending', status: 'observed', terminal: true, complete: true, observedAt: '2026-08-30T00:00:00Z',
    },
    acceptanceCriteria: ['done'], scope: [], allowedPaths: [`${identity}/**`],
  })),
  dependencies: [],
  concurrency: 2,
  budget: { cost: 10, timeMinutes: 60, retries: 2 },
  repository: { id: 'owner/repo', root: path.resolve('test-fixtures', 'fleet-disposition-repository'), baseBranch: 'main' },
  provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge', 'observe-change-request-revision'] },
  validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
  stopConditions: ['cancelled'],
  humanBoundaries: ['human merge'],
  shepherdIntent: 'yes',
});

function readyIssue(identity) {
  const baseSha = 'base';
  const headSha = `head-${identity}`;
  const changeRequest = {
    identifier: `PR-${identity.toUpperCase()}`,
    publicationKey: `pub-${identity}`,
    provider: 'github',
    repository: 'owner/repo',
    baseBranch: 'main',
    headBranch: `issue-${identity}`,
    baseSha,
    headSha,
  };
  const obligation = {
    owner: identity,
    provider: 'github',
    repository: 'owner/repo',
    changeRequest: changeRequest.identifier,
    publicationKey: changeRequest.publicationKey,
    baseBranch: 'main',
    baseSha,
    headSha,
    expiresWhen: 'sibling-merge-into-base',
    reinvocation: 'invoke-fresh-shepherd',
    generation: 1,
    createdAt: '2026-08-30T00:09:01Z',
  };
  const common = {
    baseSha, headSha, complete: true, terminal: true,
    completedAt: '2026-08-30T00:05:00Z',
  };
  const blast = {
    subjectChange: 'current candidate diff',
    suppliedBaseline: 'confirmed fleet base',
    includedScope: ['current issue'],
    exclusions: [],
    repositories: ['owner/repo'],
    revisions: { baseSha, headSha },
    environments: ['isolated test runner'],
    directCallers: ['adapter consumer'],
    crossBoundaryConsumers: ['provider publication boundary'],
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
      'cleared-risk': [{ assertionId: 'A1', assertion: 'safe', evidence: 'ruled-out-bad-case proof', scope: 'current revision' }],
      'unproven-assertion': [],
    },
    analysisBoundaries: ['current revision and traced consumers'],
    crossBoundaryGaps: [],
    'regression-proof-status': 'selected',
    'regression-proof': {
      id: 'P1', assertionId: 'A1', badCase: 'breakage', verificationLevel: 'integration',
      environment: 'test', setup: 'setup', action: 'run', observableResult: 'pass',
      prerequisites: [], authorization: 'read-only', cheaperProofInsufficientReason: 'boundary',
      outsideCoverage: 'provider',
    },
  };
  const receipt = {
    provider: 'supported-provider',
    baseSha, headSha, observedAt: '2026-08-30T00:09:00Z',
    upToDatePolicy: 'required', complete: true,
  };
  const observation = {
    provider: 'github', repository: 'owner/repo',
    changeRequest: changeRequest.identifier, baseBranch: 'main',
    baseSha, headSha, observedAt: '2026-08-30T00:09:01Z',
    containsCurrentBase: true,
  };
  const pipeline = [
    ['implementation', { ...common, status: 'completed' }],
    ['diff-reconciliation', { ...common, verdict: 'reconciled' }],
    ['run-ci', {
      ...common,
      invocation: { skill: 'run-ci', id: `ci-${identity}`, issue: identity },
      status: 'passed', evidenceComplete: true, steps: [{ name: 'tests', status: 'passed' }],
    }],
    ['roast', {
      ...common,
      invocation: { skill: 'roast', id: `roast-${identity}`, issue: identity },
      status: 'completed', findings: [], evidenceComplete: true,
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
      observedAt: '2026-08-30T00:08:00Z', provider: 'github', repository: 'owner/repo',
      issue: identity, changeRequest: changeRequest.identifier,
      publicationKey: changeRequest.publicationKey,
    }],
    ['shepherd', receipt],
  ].map(([stage, evidence]) => ({ stage, evidence }));
  return {
    identity,
    status: 'completed',
    baseSha,
    headSha,
    acceptanceCriteria: [{ id: 'C1', description: 'done' }],
    continuationChain: [],
    changeRequest,
    pipeline,
    shepherd: {
      accepted: true,
      ready: true,
      freshness: 'fresh',
      disposition: 'mergeable-and-green',
      terminal: true,
      complete: true,
      defects: [],
      invocationId: `shepherd-${identity}`,
      invocation: {
        skill: 'shepherd', id: `shepherd-${identity}`, runId: undefined,
        issue: identity, changeRequest: changeRequest.identifier,
        mode: 'nested-worker', freshContext: true, status: 'returned',
      },
      receipt,
      observation,
      setObligation: obligation,
    },
    readinessGeneration: 1,
    readinessWatermark: null,
    terminalDisposition: 'ready-for-human-merge',
  };
}

function state() {
  const a = {
    identity: 'a',
    status: 'active',
    baseSha: 'base',
    headSha: 'head-a',
    pipeline: [{ stage: 'run-ci', evidence: { baseSha: 'base', headSha: 'head-a' } }],
    changeRequest: null,
    shepherd: null,
    terminalDisposition: null,
    continuationChain: [],
    checkActivity: { kind: 'quality-check', state: 'active', startedAt: '2026-08-30T00:00:00Z' },
  };
  const b = readyIssue('b');
  const c = {
    ...readyIssue('c'),
    shepherd: { ...readyIssue('c').shepherd, accepted: false, ready: false, freshness: 'stale' },
  };
  return {
    manifestDigest: manifest.digest,
    providerConfigurationDigest: manifest.providerConfigurationDigest,
    control: { cancelled: false, budgetExhausted: false },
    issues: { a, b, c },
    publications: [
      {
        key: 'pub-b', identifier: 'PR-B', issue: 'b',
        observations: [{
          state: 'confirmed', baseSha: 'base', headSha: 'head-b',
          confirmedAt: '2026-08-30T00:08:00Z',
        }],
      },
      {
        key: 'pub-c', identifier: 'PR-C', issue: 'c',
        observations: [{
          state: 'confirmed', baseSha: 'base', headSha: 'head-c',
          confirmedAt: '2026-08-30T00:08:00Z',
        }],
      },
    ],
    reShepherdQueue: [{
      issue: 'c', changeRequest: 'PR-C', generation: 2, baseSha: 'current-base', headSha: 'head-c',
    }],
    expiredReadinessClaims: [{ issue: 'c' }],
  };
}

test('covers terminal vocabulary and cancellation/budget precedence from current control state', () => {
  assert.deepEqual(ISSUE_DISPOSITIONS, [
    'ready-for-human-merge', 'blocked', 'failed', 'timed-out-with-handoff',
    'deferred', 'not-reached', 'already-complete',
  ]);
  assert.deepEqual(FLEET_DISPOSITIONS, [
    'review-ready', 'partially-review-ready', 'blocked', 'budget-exhausted', 'cancelled',
  ]);
  const current = state();
  current.control.budgetExhausted = true;
  assert.equal(deriveFleetDisposition(current, manifest), 'budget-exhausted');
  current.control.cancelled = true;
  assert.equal(deriveFleetDisposition(current, manifest), 'cancelled');
});

test('derives effective readiness rather than trusting stale terminal strings', () => {
  const current = state();
  assert.equal(effectiveIssueReadiness(current.issues.b, current, manifest), true);
  assert.equal(effectiveIssueReadiness(current.issues.c, current, manifest), false);
  assert.equal(deriveFleetDisposition(current, manifest), 'partially-review-ready');
  current.issues.b.terminalDisposition = 'ready-for-human-merge';
  current.issues.b.pipeline.find((entry) => entry.stage === 'run-ci').evidence = {
    invocation: { skill: 'run-ci', id: 'ci-b', runId: undefined, issue: 'b' },
    status: 'failed', terminal: true, complete: true, evidenceComplete: true,
    completedAt: '2026-08-30T00:01:00Z',
    steps: [{ name: 'tests', status: 'failed' }],
    baseSha: 'base', headSha: 'head-b',
  };
  assert.equal(effectiveIssueReadiness(current.issues.b, current, manifest), false);
  assert.equal(deriveFleetDisposition(current, manifest), 'blocked');
  const forgedComplete = {
    manifestDigest: manifest.digest,
    providerConfigurationDigest: manifest.providerConfigurationDigest,
    control: { cancelled: false, budgetExhausted: false },
    issues: { a: { identity: 'a', status: 'completed', terminalDisposition: 'already-complete' } },
    publications: [],
    reShepherdQueue: [],
  };
  assert.equal(deriveFleetDisposition(forgedComplete, manifest), 'blocked');
});

test('renders distinct active, blocked, checking, expired, and review-ready status', () => {
  const current = state();
  const status = conciseFleetStatus(current, {
    active: [{ issue: 'a' }],
    blocked: [{ issue: 'c', reason: 'awaiting-re-shepherd' }],
    capacity: { nextReplenishment: 'worker-terminal-transition' },
  }, manifest);
  assert.deepEqual(status.active, []);
  assert.deepEqual(status.checking, ['a']);
  assert.deepEqual(status.reviewReady, ['b']);
  assert.deepEqual(status.expired, ['c']);
  current.issues.a.checkActivity = null;
  assert.deepEqual(conciseFleetStatus(current, {
    active: [{ issue: 'a' }],
    blocked: [],
    capacity: { nextReplenishment: 'worker-terminal-transition' },
  }, manifest).checking, []);
  current.issues.a.status = 'timed-out';
  current.issues.a.terminalDisposition = 'timed-out-with-handoff';
  current.issues.a.checkActivity = {
    kind: 'quality-check',
    state: 'active',
    startedAt: '2026-08-30T00:00:00Z',
  };
  const timedOut = conciseFleetStatus(current, {
    active: [],
    blocked: [],
    capacity: { nextReplenishment: 'none' },
  }, manifest);
  assert.deepEqual(timedOut.checking, []);
  assert.deepEqual(timedOut.deferred, ['a']);
});
