import assert from 'node:assert/strict';
import test from 'node:test';

import { ExecutionConstraintError, reconcileExecutionConstraints } from './execution-constraints.mjs';

function producer(overrides = {}) {
  return {
    id: 'refund-through-the-app',
    kind: 'system-procedure',
    requirementIds: ['R1'],
    traceabilityIds: ['T1'],
    environment: 'staging',
    accounts: [],
    data: [],
    mutableResources: [],
    isolation: 'shared',
    expectedDurationMinutes: 6,
    concurrencySafe: true,
    runAfter: [],
    ...overrides,
  };
}

function codes(report) {
  return report.findings.map((entry) => entry.code).sort();
}

test('independent producers that disturb nothing are parallel safe', () => {
  const report = reconcileExecutionConstraints({
    producers: [producer({ id: 'A' }), producer({ id: 'B', environment: 'preview' })],
  });

  assert.equal(report.status, 'parallel-safe');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.mustNotRunConcurrently, []);
  assert.deepEqual(report.exclusiveAccess, []);
});

test('producers sharing a mutable resource may never run at the same time', () => {
  const report = reconcileExecutionConstraints({
    producers: [
      producer({ id: 'A', mutableResources: ['the shared basket'], concurrencySafe: false }),
      producer({ id: 'B', mutableResources: ['the shared basket'], concurrencySafe: false }),
    ],
  });

  assert.equal(report.status, 'constrained');
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.mustNotRunConcurrently, [
    { producers: ['A', 'B'], reasons: ['shared-mutable-resource:the shared basket'] },
  ]);
});

test('a shared account and a shared fixture are each a conflict', () => {
  const report = reconcileExecutionConstraints({
    producers: [
      producer({ id: 'A', accounts: ['refund-tester'], data: ['delivered-order'], concurrencySafe: false }),
      producer({ id: 'B', accounts: ['refund-tester'], data: ['delivered-order'], concurrencySafe: false }),
    ],
  });

  assert.deepEqual(report.mustNotRunConcurrently, [
    { producers: ['A', 'B'], reasons: ['shared-account:refund-tester', 'shared-data:delivered-order'] },
  ]);
});

test('claiming concurrency safety while sharing state is reported as a conflict nobody declared', () => {
  const report = reconcileExecutionConstraints({
    producers: [
      producer({ id: 'A', mutableResources: ['the shared basket'] }),
      producer({ id: 'B', mutableResources: ['the shared basket'] }),
    ],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['undeclared-conflict']);
  assert.match(report.findings[0].detail, /share state: shared-mutable-resource:the shared basket/);
});

test('a producer holding its environment exclusively conflicts with everything sharing it', () => {
  const report = reconcileExecutionConstraints({
    producers: [
      producer({ id: 'A' }),
      producer({ id: 'B' }),
      producer({ id: 'C', isolation: 'exclusive', concurrencySafe: false }),
      producer({ id: 'D', environment: 'preview' }),
    ],
  });

  assert.deepEqual(report.exclusiveAccess, ['C']);
  assert.deepEqual(report.mustNotRunConcurrently, [
    { producers: ['A', 'C'], reasons: ['exclusive-environment:C'] },
    { producers: ['B', 'C'], reasons: ['exclusive-environment:C'] },
  ]);
});

test('a producer cannot need exclusive access and claim concurrency safety', () => {
  const report = reconcileExecutionConstraints({
    producers: [producer({ id: 'A', isolation: 'exclusive', concurrencySafe: true })],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['exclusive-declared-concurrency-safe']);
});

test('declared ordering is carried and impossible ordering is reported', () => {
  const ordered = reconcileExecutionConstraints({
    producers: [producer({ id: 'A' }), producer({ id: 'B', environment: 'preview', runAfter: ['A'] })],
  });
  const cyclic = reconcileExecutionConstraints({
    producers: [
      producer({ id: 'A', runAfter: ['B'] }),
      producer({ id: 'B', environment: 'preview', runAfter: ['A'] }),
    ],
  });
  const unknown = reconcileExecutionConstraints({
    producers: [producer({ id: 'A', runAfter: ['nobody'] })],
  });

  assert.equal(ordered.status, 'constrained');
  assert.deepEqual(ordered.orderingEdges, [{ producer: 'B', runsAfter: 'A' }]);
  assert.equal(cyclic.status, 'invalid');
  assert.deepEqual(codes(cyclic), ['ordering-cycle']);
  assert.equal(unknown.status, 'invalid');
  assert.deepEqual(codes(unknown), ['unknown-ordering-dependency']);
});

test('a producer that runs after itself is reported', () => {
  const report = reconcileExecutionConstraints({ producers: [producer({ id: 'A', runAfter: ['A'] })] });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['self-ordering-dependency']);
});

test('an omitted declaration is an omission rather than an empty declaration', () => {
  const withoutResources = producer({ id: 'A' });
  delete withoutResources.mutableResources;

  const report = reconcileExecutionConstraints({ producers: [withoutResources] });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['incomplete-declaration']);
  assert.match(report.findings[0].detail, /mutableResources/);
});

test('a producer must declare the report identities its later result will carry', () => {
  const report = reconcileExecutionConstraints({
    producers: [producer({ id: 'A', requirementIds: [], traceabilityIds: [] })],
  });

  assert.equal(report.status, 'invalid');
  assert.deepEqual(codes(report), ['missing-report-identity', 'missing-report-identity']);
});

test('unusable durations, unknown kinds, unknown isolation, and repeated identities are reported', () => {
  const duration = reconcileExecutionConstraints({ producers: [producer({ id: 'A', expectedDurationMinutes: 0 })] });
  const kind = reconcileExecutionConstraints({ producers: [producer({ id: 'A', kind: 'vibe-check' })] });
  const isolation = reconcileExecutionConstraints({ producers: [producer({ id: 'A', isolation: 'mostly' })] });
  const repeated = reconcileExecutionConstraints({ producers: [producer({ id: 'A' }), producer({ id: 'A' })] });

  assert.deepEqual(codes(duration), ['incomplete-declaration']);
  assert.deepEqual(codes(kind), ['unknown-producer-kind']);
  assert.deepEqual(codes(isolation), ['unknown-isolation-mode']);
  assert.deepEqual(codes(repeated), ['duplicate-producer-id']);
});

test('the reconciliation returns constraints and never a schedule', () => {
  const report = reconcileExecutionConstraints({
    producers: [
      producer({ id: 'A', mutableResources: ['the shared basket'], concurrencySafe: false }),
      producer({ id: 'B', mutableResources: ['the shared basket'], concurrencySafe: false }),
    ],
  });

  assert.equal(report.scheduling.schedule, null);
  assert.match(report.scheduling.statement, /does not schedule, parallelize, or run anything/);
});

test('a missing or empty producer set is refused rather than reconciled', () => {
  assert.throws(() => reconcileExecutionConstraints({}), (error) => {
    assert.ok(error instanceof ExecutionConstraintError);
    assert.equal(error.code, 'invalid_input');
    return true;
  });
  assert.throws(() => reconcileExecutionConstraints({ producers: [] }), (error) => {
    assert.equal(error.code, 'invalid_input');
    return true;
  });
});
