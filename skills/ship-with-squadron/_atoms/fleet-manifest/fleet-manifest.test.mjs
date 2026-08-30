import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFleetManifest } from './fleet-manifest.mjs';

function manifest(overrides = {}) {
  return {
    confirmation: 'confirmed',
    goal: 'deliver fleet',
    issues: [
      { identity: '1', sourceRevision: 'r1', acceptanceCriteria: ['one'] },
      { identity: '2', sourceRevision: 'r2', acceptanceCriteria: ['two'] },
      { identity: '3', sourceRevision: 'r3', acceptanceCriteria: ['three'] },
    ],
    dependencies: [],
    concurrency: 2,
    budget: { cost: 10, timeMinutes: 60, retries: 2 },
    repository: { id: 'owner/repo', root: '/repo', baseBranch: 'main' },
    provider: {
      name: 'github',
      allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge'],
    },
    validationPolicy: ['run-ci', 'roast', 'blast-radius'],
    stopConditions: ['budget exhausted', 'cancelled'],
    humanBoundaries: ['human merge only', 'no risk acceptance'],
    shepherdIntent: 'yes',
    ...overrides,
  };
}

test('normalizes a confirmed closed manifest deterministically', () => {
  const result = normalizeFleetManifest(manifest({
    dependencies: [{ dependency: '1', dependent: '2', satisfiedBy: 'human-merge' }],
  }));
  assert.equal(result.closedSet, true);
  assert.equal(result.confirmation, 'confirmed');
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.provider.allowedOperations, [
    'observe-merge', 'publish-change-request', 'read-issue',
  ]);
  assert.deepEqual(result.dependencies, [{ dependency: '1', dependent: '2', satisfiedBy: 'human-merge' }]);
});

test('rejects unconfirmed, duplicate, malformed, missing, and cyclic graphs', () => {
  assert.throws(() => normalizeFleetManifest(manifest({ confirmation: 'pending' })), /explicit confirmed/);
  assert.throws(() => normalizeFleetManifest(manifest({
    issues: [
      { identity: '1', sourceRevision: 'a', acceptanceCriteria: ['x'] },
      { identity: '1', sourceRevision: 'b', acceptanceCriteria: ['y'] },
    ],
  })), /duplicate issue identity/);
  assert.throws(() => normalizeFleetManifest(manifest({
    dependencies: [{ from: '1', to: '2' }],
  })), /ambiguous direction/);
  assert.throws(() => normalizeFleetManifest(manifest({
    dependencies: [{ dependency: 'missing', dependent: '2' }],
  })), /missing dependency endpoint/);
  assert.throws(() => normalizeFleetManifest(manifest({
    dependencies: [
      { dependency: '1', dependent: '2' },
      { dependency: '1', dependent: '2' },
    ],
  })), /duplicate dependency edge/);
  assert.throws(() => normalizeFleetManifest(manifest({
    dependencies: [
      { dependency: '1', dependent: '2' },
      { dependency: '2', dependent: '3' },
      { dependency: '3', dependent: '1' },
    ],
  })), /cycle/);
  assert.throws(() => normalizeFleetManifest(manifest({
    provider: { name: 'github', allowedOperations: ['merge'] },
  })), /outside fleet authority/);
});
