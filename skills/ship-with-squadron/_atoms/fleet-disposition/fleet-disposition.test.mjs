import assert from 'node:assert/strict';
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
  shepherdIntent: 'yes',
});

function readyIssue(identity) {
  const baseSha = 'base';
  const headSha = `head-${identity}`;
  const changeRequest = {
    identifier: `PR-${identity.toUpperCase()}`,
    publicationKey: `pub-${identity}`,
  };
  const obligation = {
    owner: identity,
    changeRequest: changeRequest.identifier,
    baseSha: 'current-base',
    headSha,
    expiresWhen: 'sibling-merge-into-base',
    reinvocation: 'invoke-fresh-shepherd',
  };
  return {
    identity,
    baseSha,
    headSha,
    continuationChain: [],
    changeRequest,
    pipeline: deliveryStagesForManifest(manifest).map((stage) => ({
      stage,
      evidence: {
        baseSha: stage === 'shepherd' ? 'current-base' : baseSha,
        headSha,
      },
    })),
    shepherd: {
      accepted: true,
      ready: true,
      freshness: 'fresh',
      receipt: {
        provider: 'github',
        changeRequest: changeRequest.identifier,
        baseSha: 'current-base',
        headSha,
      },
      setObligation: obligation,
    },
    terminalDisposition: 'ready-for-human-merge',
  };
}

function state() {
  const a = {
    identity: 'a',
    baseSha: 'base',
    headSha: 'head-a',
    pipeline: [{ stage: 'run-ci', evidence: { baseSha: 'base', headSha: 'head-a' } }],
    changeRequest: null,
    shepherd: null,
    terminalDisposition: null,
    continuationChain: [],
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
      { state: 'confirmed', key: 'pub-b', identifier: 'PR-B', issue: 'b', baseSha: 'base', headSha: 'head-b' },
      { state: 'confirmed', key: 'pub-c', identifier: 'PR-C', issue: 'c', baseSha: 'base', headSha: 'head-c' },
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
  current.issues.b.shepherd.receipt.headSha = 'stale';
  assert.equal(effectiveIssueReadiness(current.issues.b, current, manifest), false);
  assert.equal(deriveFleetDisposition(current, manifest), 'blocked');
  const complete = {
    manifestDigest: manifest.digest,
    providerConfigurationDigest: manifest.providerConfigurationDigest,
    control: { cancelled: false, budgetExhausted: false },
    issues: { a: { identity: 'a', terminalDisposition: 'already-complete' } },
    publications: [],
    reShepherdQueue: [],
  };
  assert.equal(deriveFleetDisposition(complete, manifest), 'review-ready');
});

test('renders distinct active, blocked, checking, expired, and review-ready status', () => {
  const current = state();
  const status = conciseFleetStatus(current, {
    active: [{ issue: 'a' }],
    blocked: [{ issue: 'c', reason: 'awaiting-re-shepherd' }],
    capacity: { nextReplenishment: 'worker-terminal-transition' },
  }, manifest);
  assert.deepEqual(status.active, ['a']);
  assert.deepEqual(status.checking, ['a']);
  assert.deepEqual(status.reviewReady, ['b']);
  assert.deepEqual(status.expired, ['c']);
});
