import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertSlopSnapshot,
  EVIDENCE_ASSERTIONS,
  normalizeSlopSnapshot,
  SNAPSHOT_COVERAGE_AREAS,
  snapshotDigest,
  WORK_STATES,
} from './snapshot-contract.mjs';
import { rawSnapshot } from './snapshot-contract.fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('normalizes and seals one complete revision-bound snapshot', () => {
  const result = normalizeSlopSnapshot(rawSnapshot());
  assert.equal(result.observation.completeness, 'complete');
  assert.deepEqual(result.coverage.map((entry) => entry.area), SNAPSHOT_COVERAGE_AREAS);
  assert.match(result.bindingDigest, /^[a-f0-9]{64}$/);
  assert.equal(snapshotDigest({ ...result, bindingDigest: undefined }), result.bindingDigest);
  assert.equal(assertSlopSnapshot(result), result);
});

test('records partial coverage without manufacturing unavailable evidence', () => {
  const result = normalizeSlopSnapshot(rawSnapshot({ partial: true }));
  assert.equal(result.observation.completeness, 'partial');
  assert.equal(
    result.coverage.find((entry) => entry.area === 'budgets-and-elapsed-time').status,
    'partial',
  );
});

test('binds additional observations into the sealed digest and declared coverage', () => {
  const result = normalizeSlopSnapshot(rawSnapshot({
    extraObservations: [{
      area: 'failure-fingerprints',
      id: 'failure-a',
      kind: 'failure',
      sourceKind: 'runtime',
      observedAt: '2026-09-02T20:30:00Z',
      completeness: 'complete',
      subject: 'check-a',
      workIds: ['work-a'],
      revision: 'head-a',
      fingerprint: 'test-x|stack-y|linux',
      statement: 'The check failed with the normalized fingerprint.',
      locator: 'ci://check-a',
      sensitivity: 'public',
    }],
  }));
  assert.ok(
    result.coverage.find((entry) => entry.area === 'failure-fingerprints')
      .sourceIds.includes('failure-a'),
  );
  assert.notEqual(result.bindingDigest, normalizeSlopSnapshot(rawSnapshot()).bindingDigest);
});

test('accepts an explicitly empty approved-work set as a closed manifest', () => {
  const result = normalizeSlopSnapshot(rawSnapshot({ approvedWork: [] }));
  assert.deepEqual(result.manifest.approvedWork, []);
});

test('normalizes omitted optional values to null', () => {
  const input = rawSnapshot();
  delete input.observation.priorSnapshotId;
  delete input.manifest.approvedWork[0].owner;
  delete input.observations[0].revision;
  delete input.observations[0].baseRevision;
  delete input.observations[0].fingerprint;
  delete input.observations[0].state;
  delete input.observations[0].assertion;
  delete input.observations[0].activeFrom;
  delete input.observations[0].activeUntil;
  delete input.observations[0].hypothesis;
  delete input.observations[0].scope;
  delete input.observations[0].validationPurpose;
  const result = normalizeSlopSnapshot(input);
  assert.equal(result.observation.priorSnapshotId, null);
  assert.equal(result.manifest.approvedWork[0].owner, null);
  assert.equal(result.observations[0].revision, null);
  assert.equal(result.observations[0].baseRevision, null);
  assert.equal(result.observations[0].fingerprint, null);
  assert.equal(result.observations[0].state, null);
  assert.equal(result.observations[0].assertion, null);
  assert.equal(result.observations[0].activeFrom, null);
  assert.equal(result.observations[0].activeUntil, null);
  assert.equal(result.observations[0].hypothesis, null);
  assert.equal(result.observations[0].scope, null);
  assert.equal(result.observations[0].validationPurpose, null);
});

test('mechanically validates the documented minimal capture recipe', () => {
  const example = JSON.parse(fs.readFileSync(
    path.join(HERE, 'snapshot-contract.example.json'),
    'utf8',
  ));
  const result = normalizeSlopSnapshot(example);
  assert.equal(result.observation.completeness, 'partial');
  assert.ok(result.coverage.every((entry) => entry.status === 'unavailable'));
  assert.deepEqual(result.observations, []);
  assert.match(result.bindingDigest, /^[a-f0-9]{64}$/);
});

test('uses one closed work-state vocabulary at snapshot intake', () => {
  assert.deepEqual(WORK_STATES, ['active', 'queued', 'blocked', 'terminal', 'unverified']);
  const invalid = rawSnapshot();
  invalid.observations[0].state = 'running';
  assert.throws(() => normalizeSlopSnapshot(invalid), /unsupported value: running/);
});

test('uses one closed evidence-assertion vocabulary for category proof', () => {
  assert.ok(EVIDENCE_ASSERTIONS.includes('independent-branch'));
  assert.ok(EVIDENCE_ASSERTIONS.includes('execution-bound-missing'));
  assert.ok(EVIDENCE_ASSERTIONS.includes('worker-active'));
  assert.ok(EVIDENCE_ASSERTIONS.includes('schedule-terminal'));
  const invalid = rawSnapshot();
  invalid.observations[0].assertion = 'model-invented-proof';
  assert.throws(() => normalizeSlopSnapshot(invalid), /unsupported value/);
});

test('accepts resource-specific issue and worker evidence with bounded activity', () => {
  const result = normalizeSlopSnapshot(rawSnapshot({
    extraObservations: [
      {
        area: 'dependency-frontier',
        id: 'issue-outside-manifest',
        kind: 'issue',
        sourceKind: 'provider',
        observedAt: '2026-09-02T20:30:00Z',
        completeness: 'complete',
        subject: 'issue-c',
        workIds: ['work-c'],
        assertion: 'observed-work',
        statement: 'Observed an issue.',
        locator: 'provider://issue-c',
        sensitivity: 'public',
      },
      {
        area: 'worker-generations-and-handoffs',
        id: 'worker-a-active',
        kind: 'worker',
        sourceKind: 'runtime',
        observedAt: '2026-09-02T20:31:00Z',
        completeness: 'complete',
        subject: 'worker-a',
        workIds: ['work-a'],
        state: 'active',
        assertion: 'worker-active',
        activeFrom: '2026-09-02T20:00:00Z',
        statement: 'Observed an active worker.',
        locator: 'runtime://worker-a',
        sensitivity: 'public',
      },
    ],
  }));
  assert.equal(result.observations.find((entry) => entry.id === 'issue-outside-manifest').kind, 'issue');
  assert.equal(
    result.observations.find((entry) => entry.id === 'worker-a-active').activeFrom,
    '2026-09-02T20:00:00Z',
  );
});
