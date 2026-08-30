import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import { computeFrontier } from './dependency-frontier.mjs';

function source(issue) {
  return {
    invocation: { id: `read-${issue}`, operation: 'read-issue' },
    provider: 'github', repository: 'owner/repo', issue, revision: `r-${issue}`,
    status: 'observed', terminal: true, complete: true, observedAt: '2026-08-30T00:00:00Z',
  };
}

const manifest = normalizeFleetManifest({
  confirmation: 'confirmed',
  goal: 'deliver',
  acceptedScope: [],
  exclusions: [],
  humanDecisions: [],
  issues: ['a', 'b', 'c', 'd'].map((identity) => ({
    identity,
    sourceRevision: `r-${identity}`,
    sourceReceipt: source(identity),
    acceptanceCriteria: ['done'],
    scope: [],
    allowedPaths: [`${identity}/**`],
  })),
  dependencies: [
    { dependency: 'a', dependent: 'b', satisfiedBy: 'human-merge' },
    { dependency: 'b', dependent: 'c', satisfiedBy: 'completed' },
  ],
  concurrency: 2,
  budget: { cost: 10, timeMinutes: 60, retries: 2 },
  repository: { id: 'owner/repo', root: '/repo', baseBranch: 'main' },
  provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge'] },
  validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
  stopConditions: ['cancelled'],
  humanBoundaries: ['human merge'],
  shepherdIntent: 'yes',
});

function state(statuses = {}, merges = [], control = {}) {
  return {
    manifestDigest: manifest.digest,
    providerConfigurationDigest: manifest.providerConfigurationDigest,
    issues: Object.fromEntries(manifest.issues.map((issue) => [issue.identity, {
      status: statuses[issue.identity] ?? 'pending',
      assignment: statuses[issue.identity] === 'active' ? { active: true } : null,
      terminalDisposition: null,
      sourceObservation: {
        ...issue.sourceReceipt,
        manifestDigest: manifest.digest,
        reobservedAt: '2026-08-30T00:01:00Z',
      },
    }])),
    observedHumanMerges: merges.map((issue) => ({ issue })),
    control: { cancelled: false, budgetExhausted: false, ...control },
  };
}

test('preserves chain blockers and fills parallel capacity from ready work', () => {
  const result = computeFrontier(manifest, state());
  assert.deepEqual(result.ready.map((entry) => entry.issue), ['a', 'd']);
  assert.deepEqual(result.capacity.dispatch.map((entry) => entry.issue), ['a', 'd']);
  assert.equal(result.blocked.find((entry) => entry.issue === 'b').reason, 'awaiting-observed-human-merge:a');
  assert.equal(result.blocked.find((entry) => entry.issue === 'c').reason, 'awaiting-completion:b');
});

test('blocks dispatch until source revision is reobserved', () => {
  const current = state();
  current.issues.a.sourceObservation = null;
  const result = computeFrontier(manifest, current);
  assert.equal(result.blocked.find((entry) => entry.issue === 'a').reason, 'awaiting-source-reobservation:a');
  assert.deepEqual(result.capacity.dispatch.map((entry) => entry.issue), ['d']);
});

test('dispatches zero after cancellation or at-ceiling budget exhaustion while retaining active work', () => {
  const cancelled = computeFrontier(manifest, state({ a: 'active' }, [], { cancelled: true }));
  assert.deepEqual(cancelled.capacity.dispatch, []);
  assert.equal(cancelled.capacity.dispatchBlockedBy, 'fleet-cancelled');
  assert.deepEqual(cancelled.active.map((entry) => entry.issue), ['a']);

  const exhausted = computeFrontier(manifest, state({ a: 'active' }, [], { budgetExhausted: true }));
  assert.deepEqual(exhausted.capacity.dispatch, []);
  assert.equal(exhausted.capacity.dispatchBlockedBy, 'budget-exhausted');
  assert.deepEqual(exhausted.active.map((entry) => entry.issue), ['a']);
});

test('rejects any issue outside the confirmed closed set', () => {
  const current = state();
  current.issues.extra = { status: 'pending' };
  assert.throws(() => computeFrontier(manifest, current), /closed manifest/);
});
