import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BASELINE_POLICY,
  manifestDigest,
  normalizeFleetManifest,
  validateSourceRevisionReceipt,
} from './fleet-manifest.mjs';

function sourceReceipt(issue, revision, overrides = {}) {
  return {
    invocation: { id: `read-${issue}`, operation: 'read-issue' },
    provider: 'github',
    repository: 'owner/repo',
    issue,
    revision,
    issueStatus: 'pending',
    status: 'observed',
    terminal: true,
    complete: true,
    observedAt: '2026-08-30T00:00:00Z',
    ...overrides,
  };
}

function issue(identity, revision) {
  return {
    identity,
    sourceRevision: revision,
    sourceReceipt: sourceReceipt(identity, revision),
    acceptanceCriteria: [{ id: `${identity}-C1`, description: `criterion ${identity}` }],
    scope: [`scope ${identity}`],
    allowedPaths: [`src/${identity}/**`],
  };
}

function manifest(overrides = {}) {
  return {
    confirmation: 'confirmed',
    goal: 'deliver fleet',
    acceptedScope: ['only the confirmed issues'],
    issues: [issue('1', 'r1'), issue('2', 'r2'), issue('3', 'r3')],
    dependencies: [],
    exclusions: [],
    concurrency: 2,
    budget: { cost: 10, timeMinutes: 60, retries: 2 },
    repository: { id: 'owner/repo', root: '/repo', baseBranch: 'main' },
    provider: {
      name: 'GitHub',
      allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge', 'observe-change-request-revision'],
    },
    validationPolicy: [...BASELINE_POLICY],
    stopConditions: ['budget exhausted', 'cancelled'],
    humanBoundaries: ['human merge only', 'no risk acceptance'],
    humanDecisions: [],
    shepherdIntent: 'yes',
    ...overrides,
  };
}

test('normalizes a confirmed closed manifest and provider-bound source receipts', () => {
  const result = normalizeFleetManifest(manifest({
    dependencies: [{ dependency: '1', dependent: '2', satisfiedBy: 'human-merge' }],
  }));
  assert.equal(result.closedSet, true);
  assert.equal(result.provider.name, 'github');
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.match(result.providerConfigurationDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.humanDecisions, []);
  assert.deepEqual(result.exclusions, []);
  assert.equal(validateSourceRevisionReceipt(
    sourceReceipt('1', 'r1', { observedAt: '2026-08-30T00:01:00Z' }),
    result,
    '1',
  ).revision, 'r1');
});

test('seals already-complete eligibility in both manifest status and provider receipt', () => {
  const completed = issue('1', 'r1');
  completed.status = 'completed';
  completed.sourceReceipt = sourceReceipt('1', 'r1', { issueStatus: 'completed' });
  const normalized = normalizeFleetManifest(manifest({ issues: [completed] }));
  assert.equal(normalized.issues[0].status, 'completed');
  assert.equal(normalized.issues[0].sourceReceipt.issueStatus, 'completed');
  assert.throws(() => normalizeFleetManifest(manifest({
    issues: [{ ...completed, sourceReceipt: sourceReceipt('1', 'r1') }],
  })), /issueStatus does not match/);
});

test('requires explicit scope, exclusions, human decisions, and mandatory baseline policy', () => {
  const without = (field) => {
    const value = manifest();
    delete value[field];
    return value;
  };
  assert.throws(() => normalizeFleetManifest(without('acceptedScope')), /explicitly declared/);
  assert.throws(() => normalizeFleetManifest(without('exclusions')), /explicitly declared/);
  assert.throws(() => normalizeFleetManifest(without('humanDecisions')), /explicitly declared/);
  assert.throws(() => normalizeFleetManifest(manifest({
    validationPolicy: ['run-ci', 'roast'],
  })), /blast-radius-proof/);
  assert.throws(() => normalizeFleetManifest(manifest({
    issues: [{ ...issue('1', 'r1'), allowedPaths: [] }],
  })), /allowedPaths must be non-empty/);
});

test('rejects stale source receipts and malformed closed dependency graphs', () => {
  assert.throws(() => normalizeFleetManifest(manifest({
    issues: [{ ...issue('1', 'r1'), sourceReceipt: sourceReceipt('1', 'stale') }],
  })), /revision does not match/);
  assert.throws(() => normalizeFleetManifest(manifest({ confirmation: 'pending' })), /explicit confirmed/);
  assert.throws(() => normalizeFleetManifest(manifest({
    issues: [issue('1', 'a'), issue('1', 'b')],
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
      { dependency: '2', dependent: '3' },
      { dependency: '3', dependent: '1' },
    ],
  })), /cycle/);
  assert.throws(() => normalizeFleetManifest(manifest({
    provider: { name: 'github', allowedOperations: ['merge'] },
  })), /outside fleet authority/);
});

test('binds tracker-query membership provenance and rejects membership/source drift', () => {
  const members = [
    { identity: '1', sourceRevision: 'r1' },
    { identity: '2', sourceRevision: 'r2' },
    { identity: '3', sourceRevision: 'r3' },
  ];
  const digest = manifestDigest(members);
  const issueSet = {
    kind: 'tracker-query',
    queryIdentity: 'saved:ready-fleet',
    queryRevision: 'q-17',
    membershipDigest: digest,
    receipt: {
      invocation: { id: 'query-1', operation: 'read-issue-set' },
      provider: 'github',
      repository: 'owner/repo',
      queryIdentity: 'saved:ready-fleet',
      queryRevision: 'q-17',
      membershipDigest: digest,
      members,
      status: 'observed',
      terminal: true,
      complete: true,
      observedAt: '2026-08-30T00:00:00Z',
    },
  };
  const result = normalizeFleetManifest(manifest({
    issueSet,
    provider: {
      name: 'github',
      allowedOperations: ['read-issue', 'read-issue-set', 'publish-change-request', 'observe-merge'],
    },
  }));
  assert.equal(result.issueSet.kind, 'tracker-query');
  assert.equal(result.issueSet.membershipDigest, digest);
  assert.throws(() => normalizeFleetManifest(manifest({
    issueSet: {
      ...issueSet,
      receipt: {
        ...issueSet.receipt,
        members: [...members, { identity: '4', sourceRevision: 'r4' }],
      },
    },
    provider: {
      name: 'github',
      allowedOperations: ['read-issue', 'read-issue-set', 'publish-change-request', 'observe-merge'],
    },
  })), /members does not match/);
});

test('human descoping records require an actual actor and exact issue/criterion binding', () => {
  const decision = {
    id: 'HD-1',
    actor: 'human-reviewer-17',
    issue: '1',
    criterionId: '1-C1',
    sourceRevision: 'r1',
    decision: 'descoped',
    decisionText: 'Confirmed removal from this delivery.',
    decidedAt: '2026-08-30T00:00:01Z',
  };
  const result = normalizeFleetManifest(manifest({ humanDecisions: [decision] }));
  assert.equal(result.humanDecisions[0].actor, decision.actor);
  assert.equal(result.humanDecisions[0].manifestDigest, result.confirmationBindingDigest);
  assert.throws(
    () => normalizeFleetManifest(manifest({ humanDecisions: [{ ...decision, actor: '' }] })),
    /actor must be a non-empty string/,
  );
});
