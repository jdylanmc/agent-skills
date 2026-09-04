import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ATOMIC_TRANSITION_SCHEMA_VERSION,
  FORBIDDEN_AUTHORITIES,
  applyFleetStateTransition,
  evaluateTransitionCurrentness,
  supersedeCandidateEvidence,
  validateAtomicLeaseReservation,
  validateStrategyTransitionProposal,
} from './atomic-transition.mjs';
import { normalizeFleetManifest } from '../../../ship-with-squadron/_atoms/fleet-manifest/fleet-manifest.mjs';
import {
  createFleetState,
  fleetStatePath,
  persistFleetState,
} from '../../../ship-with-squadron/_atoms/fleet-state/fleet-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function proposal(overrides = {}) {
  const base = {
    schemaVersion: ATOMIC_TRANSITION_SCHEMA_VERSION,
    strategy: 'bench/v1',
    binding: {
      expectedStateRevision: 7,
      run: 'run-1',
      candidate: 'candidate-a',
      lease: 'lease-primary',
      agent: 'agent-1',
      fence: 11,
    },
    reservation: {
      leases: [
        { lease: 'lease-primary', candidate: 'candidate-a', agent: 'agent-1', fence: 11 },
        { lease: 'lease-secondary', candidate: 'candidate-a', agent: 'agent-1', fence: 12 },
      ],
    },
    transition: {
      from: { namespace: 'bench/v1', value: { phase: 'ready' } },
      to: { namespace: 'bench/v1', value: { phase: 'running' } },
    },
    payload: { namespace: 'bench/v1', value: { opaque: ['strategy', 'data'] } },
    forbiddenAuthorities: [...FORBIDDEN_AUTHORITIES],
  };
  return {
    ...base,
    ...overrides,
    binding: { ...base.binding, ...overrides.binding },
    reservation: overrides.reservation ?? base.reservation,
    transition: overrides.transition ?? base.transition,
    payload: overrides.payload ?? base.payload,
    forbiddenAuthorities: overrides.forbiddenAuthorities ?? base.forbiddenAuthorities,
  };
}

function current(overrides = {}) {
  const base = {
    stateRevision: 7,
    run: 'run-1',
    candidate: 'candidate-a',
    agent: 'agent-1',
    fence: 11,
    leases: proposal().reservation.leases,
    state: { namespace: 'bench/v1', value: { phase: 'ready' } },
  };
  return { ...base, ...overrides };
}

function evidence(candidate, candidateRevision, status = 'current') {
  return {
    candidate,
    candidateRevision,
    namespace: 'bench/v1',
    payload: { opaque: candidate },
    status,
    supersededBy: status === 'invalidated' ? 'candidate-a' : null,
    invalidatedAtRevision: status === 'invalidated' ? 6 : null,
    invalidationReason: status === 'invalidated' ? 'candidate-superseded' : null,
  };
}

test('validates a typed, namespaced strategy proposal without inspecting opaque values', () => {
  const result = validateStrategyTransitionProposal(proposal());

  assert.equal(result.valid, true);
  assert.deepEqual(result.defects, []);
  assert.deepEqual(result.proposal.transition.from, {
    namespace: 'bench/v1',
    value: { phase: 'ready' },
  });
  assert.notEqual(result.proposal.payload.value, proposal().payload.value);

  const wrongNamespace = validateStrategyTransitionProposal(proposal({
    payload: { namespace: 'tdd/v1', value: { opaque: true } },
  }));
  assert.equal(wrongNamespace.valid, false);
  assert.ok(wrongNamespace.defects.includes('payload.namespace must equal strategy'));

  const unknownField = validateStrategyTransitionProposal({ ...proposal(), injected: true });
  assert.equal(unknownField.valid, false);
  assert.equal(unknownField.proposal, null);
});

test('requires every revision, run, candidate, lease, agent, and fence binding', () => {
  for (const field of ['expectedStateRevision', 'run', 'candidate', 'lease', 'agent', 'fence']) {
    const invalid = proposal();
    delete invalid.binding[field];
    const result = validateStrategyTransitionProposal(invalid);
    assert.equal(result.valid, false, field);
    assert.ok(result.defects.some((defect) => defect.startsWith('binding must contain exactly')), field);
  }

  const zeroFence = validateStrategyTransitionProposal(proposal({ binding: { fence: 0 } }));
  assert.equal(zeroFence.valid, false);
  assert.ok(zeroFence.defects.includes('binding.fence is invalid'));
});

test('requires the exact generic forbidden-authority contract', () => {
  assert.throws(() => FORBIDDEN_AUTHORITIES.push('invent-authority'), TypeError);

  for (const forbiddenAuthorities of [
    FORBIDDEN_AUTHORITIES.slice(1),
    [...FORBIDDEN_AUTHORITIES, 'invent-authority'],
    [...FORBIDDEN_AUTHORITIES].reverse(),
  ]) {
    const result = validateStrategyTransitionProposal(proposal({ forbiddenAuthorities }));
    assert.equal(result.valid, false);
    assert.ok(result.defects.includes('forbiddenAuthorities must exactly match the shared forbidden authorities'));
  }
});

test('validates multi-lease reservations all-or-none', () => {
  const requested = proposal().reservation.leases;
  const complete = validateAtomicLeaseReservation(requested, requested);
  assert.deepEqual(complete, { valid: true, defects: [] });

  const missing = validateAtomicLeaseReservation(requested, [requested[0]]);
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.defects, ['lease lease-secondary is not reserved']);

  const stale = validateAtomicLeaseReservation(requested, [
    requested[0],
    { ...requested[1], fence: 13 },
  ]);
  assert.equal(stale.valid, false);
  assert.deepEqual(stale.defects, ['lease lease-secondary binding is no longer current']);

  const ambiguous = validateAtomicLeaseReservation([requested[0]], [
    requested[0],
    requested[0],
  ]);
  assert.equal(ambiguous.valid, false);
  assert.ok(ambiguous.defects.includes('authoritative leases must be unique'));
});

test('rejects a transition proposal that is no longer current', () => {
  assert.deepEqual(evaluateTransitionCurrentness(proposal(), current()), {
    current: true,
    defects: [],
  });

  for (const [name, changed] of [
    ['state revision', current({ stateRevision: 8 })],
    ['candidate', current({ candidate: 'candidate-b' })],
    ['opaque state', current({ state: { namespace: 'bench/v1', value: { phase: 'changed' } } })],
    ['lease', current({ leases: [proposal().reservation.leases[0]] })],
  ]) {
    const result = evaluateTransitionCurrentness(proposal(), changed);
    assert.equal(result.current, false, name);
    assert.ok(result.defects.length > 0, name);
  }
});

test('invalidates superseded candidate evidence without rewriting prior invalidations', () => {
  const existingInvalidation = evidence('candidate-c', 1, 'invalidated');
  const result = supersedeCandidateEvidence([
    evidence('candidate-a', 2),
    evidence('candidate-b', 3),
    existingInvalidation,
  ], 'candidate-a', 7);

  assert.equal(result.valid, true);
  assert.equal(result.evidence[0].status, 'current');
  assert.deepEqual(result.evidence[1], {
    ...evidence('candidate-b', 3),
    status: 'invalidated',
    supersededBy: 'candidate-a',
    invalidatedAtRevision: 7,
    invalidationReason: 'candidate-superseded',
  });
  assert.deepEqual(result.evidence[2], existingInvalidation);

  const duplicate = supersedeCandidateEvidence([
    evidence('candidate-a', 2),
    evidence('candidate-a', 2),
  ], 'candidate-a', 7);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.defects.includes('evidence contains duplicate candidate revisions'));
});

test('delegates the final compare-and-swap to the Squadron fleet-state ledger', (t) => {
  const sandbox = path.join(
    ROOT,
    '.test-sandbox',
    `atomic-transition-${process.pid}-${randomUUID()}`,
  );
  const repository = path.join(sandbox, 'repository');
  fs.mkdirSync(repository, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const manifest = normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: 'test shared transition adapter',
    acceptedScope: [],
    exclusions: [],
    humanDecisions: [],
    issues: [{
      identity: '1',
      sourceRevision: 'r1',
      sourceReceipt: {
        invocation: { id: 'read-1', operation: 'read-issue' },
        provider: 'github',
        repository: 'owner/repo',
        issue: '1',
        revision: 'r1',
        issueStatus: 'pending',
        status: 'observed',
        terminal: true,
        complete: true,
        observedAt: '2026-09-03T00:00:00Z',
      },
      acceptanceCriteria: ['complete'],
      scope: [],
      allowedPaths: ['src/**'],
    }],
    dependencies: [],
    concurrency: 1,
    budget: { cost: 1, timeMinutes: 10, retries: 1 },
    repository: { id: 'owner/repo', root: repository, baseBranch: 'main' },
    provider: {
      name: 'github',
      allowedOperations: [
        'read-issue',
        'publish-change-request',
        'observe-merge',
        'observe-change-request-revision',
      ],
    },
    validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
    stopConditions: ['cancelled'],
    humanBoundaries: ['human merge'],
    shepherdIntent: 'no',
  });
  const file = fleetStatePath(repository, 'run-1');
  persistFleetState(
    file,
    createFleetState(manifest, 'run-1', '2026-09-03T00:00:00Z'),
    0,
    manifest,
  );

  const applied = applyFleetStateTransition({
    file,
    manifest,
    proposal: proposal({ binding: { expectedStateRevision: 1 } }),
    readCurrent: (state) => current({
      stateRevision: state.revision,
      run: state.runId,
    }),
    transition: (state) => state,
  });

  assert.equal(applied.revision, 2);
});
