import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  MAX_DELIVERY_POOL_AGENTS,
  addDownstreamClaim,
  applyProposalToFleetState,
  createBenchEpoch,
  benchProposalDigest,
  assertBenchEpoch,
  validateProposal,
} from './bench-epoch.mjs';
import { createFleetState } from '../../../ship-with-squadron/_atoms/fleet-state/fleet-state.mjs';
import {
  BASELINE_POLICY,
  normalizeFleetManifest,
} from '../../../ship-with-squadron/_atoms/fleet-manifest/fleet-manifest.mjs';

function sourceReceipt(issue, revision) {
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
    observedAt: '2026-09-03T00:00:00Z',
  };
}

function fleetManifest() {
  return normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: 'bench delivery',
    acceptedScope: ['bench only'],
    issues: [{
      identity: '1',
      sourceRevision: 'r1',
      sourceReceipt: sourceReceipt('1', 'r1'),
      acceptanceCriteria: [{ id: '1-C1', description: 'criterion' }],
      scope: ['bench'],
      allowedPaths: ['src/bench/**'],
    }],
    dependencies: [],
    exclusions: [],
    concurrency: 1,
    budget: { cost: 1, timeMinutes: 1, retries: 1 },
    repository: {
      id: 'owner/repo',
      root: path.resolve('test-fixtures', 'bench-squadron-repository'),
      baseBranch: 'main',
    },
    provider: {
      name: 'github',
      allowedOperations: [
        'read-issue',
        'publish-change-request',
        'observe-merge',
        'observe-change-request-revision',
      ],
    },
    validationPolicy: [...BASELINE_POLICY],
    stopConditions: ['cancelled'],
    humanBoundaries: ['human merge only'],
    humanDecisions: [],
    shepherdIntent: 'no',
  });
}

function currentFleet() {
  const manifest = fleetManifest();
  return { manifest, fleetState: createFleetState(manifest, 'bench-epoch-test') };
}

function benchState(overrides = {}) {
  return createBenchEpoch({
    deliveryPool: ['delivery-1', 'delivery-2'],
    quorum: 2,
    orchestrator: 'orchestrator',
    slopSniper: 'slop-sniper',
    ...overrides,
  });
}

function proposal(overrides = {}) {
  const value = {
    id: 'proposal-1',
    epoch: 0,
    fleetStateRevision: 0,
    binding: { run: 'bench-epoch-test', candidate: 'candidate-1', lease: 'bench-lease', fence: 1 },
    mutatorId: 'orchestrator',
    turnId: 'orchestrator-turn',
    mutation: { action: 'publish-review-candidate' },
    signatures: [
      { agentId: 'delivery-1', epoch: 0, turnId: 'delivery-1-turn', value: 'signature-1' },
      { agentId: 'delivery-2', epoch: 0, turnId: 'delivery-2-turn', value: 'signature-2' },
    ],
    ...overrides,
  };
  value.signatures = value.signatures.map((signature) => ({
    ...signature, proposalDigest: benchProposalDigest(value),
  }));
  return value;
}

test('caps the delivery pool, keeps the two control roles separate, and bounds quorum', () => {
  assert.equal(MAX_DELIVERY_POOL_AGENTS, 5);
  assert.throws(() => createBenchEpoch({
    deliveryPool: ['a', 'b', 'c', 'd', 'e', 'f'],
    quorum: 1,
    orchestrator: 'orchestrator',
    slopSniper: 'slop-sniper',
  }), /5-agent cap/);
  assert.throws(() => benchState({ quorum: 3 }), /1 <= quorum <= deliveryPool.length/);
  assert.throws(() => benchState({ orchestrator: 'delivery-1' }), /roles must be separate/);
  assert.throws(() => benchState({ slopSniper: 'orchestrator' }), /roles must be separate/);
});

test('persists only well-formed lease authority in the Bench epoch state', () => {
  const state = benchState({
    reservation: {
      leases: [{
        lease: 'bench-lease',
        candidate: 'candidate-1',
        agent: 'delivery-1',
        fence: 1,
        expiry: '2099-01-01T00:00:00Z',
      }],
    },
  });
  assert.deepEqual(state.reservation, {
    leases: [{
      lease: 'bench-lease',
      candidate: 'candidate-1',
      agent: 'delivery-1',
      fence: 1,
      expiry: '2099-01-01T00:00:00Z',
    }],
  });
  assert.throws(() => benchState({
    reservation: {
      leases: [{
        lease: 'bench-lease',
        candidate: 'candidate-1',
        agent: 'delivery-1',
        fence: 0,
        expiry: '2099-01-01T00:00:00Z',
      }],
    },
  }), /reservation fence/);
});

test('requires distinct signatures for the exact current epoch and a quorum', () => {
  const state = benchState();
  assert.equal(validateProposal(state, proposal()).signatures.length, 2);
  assert.throws(() => validateProposal(state, proposal({ epoch: 1 })), /exact current epoch/);
  assert.throws(() => validateProposal(state, proposal({
    signatures: [
      { agentId: 'delivery-1', epoch: 0, turnId: 'one', value: 'signature-1' },
      { agentId: 'delivery-1', epoch: 0, turnId: 'two', value: 'signature-2' },
    ],
  })), /distinct delivery-pool agents/);
  assert.throws(() => validateProposal(state, proposal({
    signatures: [
      { agentId: 'delivery-1', epoch: 0, turnId: 'one', value: 'same-signature' },
      { agentId: 'delivery-2', epoch: 0, turnId: 'two', value: 'same-signature' },
    ],
  })), /signature values must be distinct/);
  assert.throws(() => validateProposal(state, proposal({ signatures: [proposal().signatures[0]] })), /configured quorum/);
});

test('rejects a mutator signature created in the mutator turn', () => {
  const state = benchState();
  assert.throws(() => validateProposal(state, proposal({
    mutatorId: 'delivery-1',
    turnId: 'delivery-1-turn',
  })), /mutator cannot sign/);
});

test('binds proposals to valid current Fleet State and invalidates claims after mutation', () => {
  const { manifest, fleetState } = currentFleet();
  const state = addDownstreamClaim(benchState(), {
    id: 'quality-evidence',
    epoch: 0,
    subject: 'candidate head',
  });
  const accepted = applyProposalToFleetState(state, fleetState, manifest, proposal());

  assert.equal(accepted.fleetStateRevision, fleetState.revision);
  assert.equal(accepted.nextBenchEpoch.epoch, 1);
  assert.deepEqual(accepted.nextBenchEpoch.signatures, []);
  assert.deepEqual(accepted.nextBenchEpoch.downstreamClaims, []);
  assert.equal(accepted.nextBenchEpoch.acceptedProposals[0].acceptedAtEpoch, 0);
  assert.throws(() => validateProposal(
    accepted.nextBenchEpoch,
    proposal({ id: 'stale-proposal' }),
  ), /exact current epoch/);
  assert.throws(() => applyProposalToFleetState(
    state,
    fleetState,
    manifest,
    proposal({ fleetStateRevision: fleetState.revision + 1 }),
  ), /does not match current Fleet State/);
});

test('refuses a proposal when its supplied Fleet State is not valid', () => {
  const { manifest } = currentFleet();
  assert.throws(() => applyProposalToFleetState(
    benchState(),
    { revision: 0 },
    manifest,
    proposal(),
  ), /fleet state/i);
});

test('receipts bind the canonical immutable body and survive accepted-history reload', () => {
  const state = benchState();
  const signed = proposal();
  assert.equal(benchProposalDigest(signed), benchProposalDigest({
    ...signed, mutation: { ...signed.mutation }, signatures: [],
  }));
  assert.equal(benchProposalDigest({ ...signed, mutation: { a: 1, b: { x: 2, y: 3 } } }),
    benchProposalDigest({ ...signed, mutation: { b: { y: 3, x: 2 }, a: 1 } }));
  for (const mutation of [{ value: undefined }, { value: NaN }, { value: new Date() }]) {
    assert.throws(() => benchProposalDigest({ ...signed, mutation }), /JSON data/);
  }
  for (const change of [
    { mutation: { action: 'different-mutation' } },
    { id: 'another-proposal' },
    { fleetStateRevision: 1 },
    { binding: { ...signed.binding, candidate: 'other-candidate' } },
  ]) {
    assert.throws(() => validateProposal(state, { ...signed, ...change }), /signature digest/);
  }
  const { manifest, fleetState } = currentFleet();
  const accepted = applyProposalToFleetState(state, fleetState, manifest, signed).nextBenchEpoch;
  const reloaded = JSON.parse(JSON.stringify(accepted));
  assertBenchEpoch(reloaded);
  assert.deepEqual(reloaded.acceptedProposals[0].signatures, signed.signatures);
  reloaded.acceptedProposals[0].signatures.pop();
  assert.throws(() => assertBenchEpoch(reloaded), /configured quorum/);
});
