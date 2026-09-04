import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyBenchAtomicFleetStateTransition,
  createBenchAtomicCurrent,
  createBenchAtomicTransition,
} from './atomic-proposal.mjs';
import { applyProposalToFleetState, createBenchEpoch } from '../bench-epoch/bench-epoch.mjs';
import { evaluateTransitionCurrentness, validateStrategyTransitionProposal } from '../../../_base/_atoms/atomic-transition/atomic-transition.mjs';
import {
  createFleetState,
  fleetStatePath,
  loadFleetState,
  persistFleetState,
} from '../../../ship-with-squadron/_atoms/fleet-state/fleet-state.mjs';
import {
  BASELINE_POLICY,
  normalizeFleetManifest,
} from '../../../ship-with-squadron/_atoms/fleet-manifest/fleet-manifest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

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

function manifest(repositoryRoot) {
  return normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: 'bench atomic transition',
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
    repository: { id: 'owner/repo', root: repositoryRoot, baseBranch: 'main' },
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

function benchState(overrides = {}) {
  return createBenchEpoch({
    deliveryPool: ['delivery-1', 'delivery-2'],
    quorum: 2,
    orchestrator: 'orchestrator',
    slopSniper: 'slop-sniper',
    reservation: {
      leases: [{
        lease: 'bench-lease',
        candidate: 'candidate-1',
        agent: 'orchestrator',
        fence: 1,
        expiry: '2099-01-01T00:00:00Z',
      }],
    },
    ...overrides,
  });
}

function proposal(overrides = {}) {
  return {
    id: 'proposal-1',
    epoch: 0,
    fleetStateRevision: 0,
    mutatorId: 'orchestrator',
    turnId: 'orchestrator-turn',
    mutation: { action: 'publish-review-candidate' },
    signatures: [
      { agentId: 'delivery-1', epoch: 0, turnId: 'delivery-1-turn', value: 'signature-1' },
      { agentId: 'delivery-2', epoch: 0, turnId: 'delivery-2-turn', value: 'signature-2' },
    ],
    ...overrides,
  };
}

function atomicBinding() {
  return { candidate: 'candidate-1', lease: 'bench-lease', fence: 1 };
}

function withBenchStrategyState(fleetState, state = benchState()) {
  return {
    ...fleetState,
    strategyState: {
      namespace: 'bench-squadron/v1',
      value: state,
    },
  };
}

function memoryFixture() {
  const repository = path.join(ROOT, '.test-sandbox', 'bench-atomic-memory');
  const currentManifest = manifest(repository);
  const currentBenchState = benchState();
  return {
    manifest: currentManifest,
    fleetState: withBenchStrategyState(
      createFleetState(currentManifest, 'bench-run'),
      currentBenchState,
    ),
    benchState: currentBenchState,
  };
}

test('adapts a validated current Bench proposal to a valid shared Atomic Transition', () => {
  const fixture = memoryFixture();
  const adapted = createBenchAtomicTransition({
    ...fixture,
    proposal: proposal(),
    binding: atomicBinding(),
  });

  const validated = validateStrategyTransitionProposal(adapted.proposal);
  assert.equal(validated.valid, true);
  assert.equal(adapted.proposal.strategy, 'bench-squadron/v1');
  assert.equal(adapted.proposal.binding.expectedStateRevision, fixture.fleetState.revision);
  assert.equal(adapted.proposal.binding.run, fixture.fleetState.runId);
  assert.deepEqual(adapted.current.leases, [{
    lease: 'bench-lease',
    candidate: 'candidate-1',
    agent: 'orchestrator',
    fence: 1,
  }]);
  assert.deepEqual(evaluateTransitionCurrentness(adapted.proposal, adapted.current), {
    current: true,
    defects: [],
  });
});

test('refuses stale Bench state and stale shared currentness projections', () => {
  const fixture = memoryFixture();
  const adapted = createBenchAtomicTransition({
    ...fixture,
    proposal: proposal(),
    binding: atomicBinding(),
  });
  const advancedBench = applyProposalToFleetState(
    fixture.benchState,
    fixture.fleetState,
    fixture.manifest,
    proposal(),
  ).nextBenchEpoch;
  const staleBenchCurrent = createBenchAtomicCurrent({
    ...fixture,
    fleetState: withBenchStrategyState(fixture.fleetState, advancedBench),
    proposal: adapted.proposal,
  });
  const staleFleetCurrent = {
    ...adapted.current,
    stateRevision: adapted.current.stateRevision + 1,
    state: {
      ...adapted.current.state,
      value: {
        ...adapted.current.state.value,
        fleetStateRevision: adapted.current.state.value.fleetStateRevision + 1,
      },
    },
  };

  assert.equal(evaluateTransitionCurrentness(adapted.proposal, staleBenchCurrent).current, false);
  assert.equal(evaluateTransitionCurrentness(adapted.proposal, staleFleetCurrent).current, false);
  assert.throws(() => createBenchAtomicTransition({
    ...fixture,
    proposal: proposal({ fleetStateRevision: fixture.fleetState.revision + 1 }),
    binding: atomicBinding(),
  }), /does not match current Fleet State/);
});

test('derives locked leases from persisted authority and rejects invented, replaced, and expired leases', () => {
  const fixture = memoryFixture();
  const adapted = createBenchAtomicTransition({
    ...fixture,
    proposal: proposal(),
    binding: atomicBinding(),
  });
  const persistedWithAdditionalLease = benchState({
    reservation: {
      leases: [
        fixture.benchState.reservation.leases[0],
        {
          lease: 'bench-lease-2',
          candidate: 'candidate-2',
          agent: 'delivery-2',
          fence: 2,
          expiry: '2099-01-01T00:00:00Z',
        },
      ],
    },
  });
  const replacementCurrent = createBenchAtomicCurrent({
    ...fixture,
    fleetState: withBenchStrategyState(fixture.fleetState, persistedWithAdditionalLease),
    proposal: adapted.proposal,
  });

  assert.deepEqual(replacementCurrent.leases, [
    { lease: 'bench-lease', candidate: 'candidate-1', agent: 'orchestrator', fence: 1 },
    { lease: 'bench-lease-2', candidate: 'candidate-2', agent: 'delivery-2', fence: 2 },
  ]);
  assert.throws(() => createBenchAtomicTransition({
    ...fixture,
    proposal: proposal(),
    binding: { ...atomicBinding(), lease: 'invented-lease' },
  }), /not reserved/);
  assert.throws(() => createBenchAtomicCurrent({
    ...fixture,
    fleetState: withBenchStrategyState(fixture.fleetState, benchState({
      reservation: {
        leases: [{
          ...fixture.benchState.reservation.leases[0],
          fence: 2,
        }],
      },
    })),
    proposal: adapted.proposal,
  }), /binding is no longer current/);
  assert.throws(() => createBenchAtomicTransition({
    ...fixture,
    fleetState: withBenchStrategyState(fixture.fleetState, benchState({
      reservation: {
        leases: [{
          ...fixture.benchState.reservation.leases[0],
          expiry: '2026-01-01T00:00:00Z',
        }],
      },
    })),
    proposal: proposal(),
    binding: atomicBinding(),
    now: '2026-01-02T00:00:00Z',
  }), /lease is expired/);
});

test('delegates a compatible Bench transition through the shared Fleet State CAS adapter', (t) => {
  const sandbox = path.join(
    ROOT,
    '.test-sandbox',
    `bench-atomic-${process.pid}-${randomUUID()}`,
  );
  const repository = path.join(sandbox, 'repository');
  fs.mkdirSync(repository, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const currentManifest = manifest(repository);
  const file = fleetStatePath(repository, 'bench-run');
  const initialFleetState = withBenchStrategyState(
    createFleetState(currentManifest, 'bench-run'),
    benchState(),
  );
  persistFleetState(file, initialFleetState, 0, currentManifest);
  const fleetState = { ...initialFleetState, revision: 1 };
  const result = applyBenchAtomicFleetStateTransition({
    file,
    manifest: currentManifest,
    fleetState,
    proposal: proposal({ fleetStateRevision: 1 }),
    binding: atomicBinding(),
    transition: (lockedFleetState, validatedBenchProposal, sharedProposal) => {
      assert.equal(lockedFleetState.revision, 1);
      assert.equal(validatedBenchProposal.id, 'proposal-1');
      assert.equal(sharedProposal.strategy, 'bench-squadron/v1');
      return lockedFleetState;
    },
  });

  assert.equal(result.fleetState.revision, 2);
  assert.equal(result.nextBenchEpoch.epoch, 1);
  const reloadedFleetState = loadFleetState(file, currentManifest);
  assert.deepEqual(
    reloadedFleetState.strategyState,
    { namespace: 'bench-squadron/v1', value: result.nextBenchEpoch },
  );
  assert.throws(() => applyBenchAtomicFleetStateTransition({
    file,
    manifest: currentManifest,
    fleetState: reloadedFleetState,
    proposal: proposal({ fleetStateRevision: 2 }),
    binding: atomicBinding(),
    transition: (lockedFleetState) => lockedFleetState,
  }), /proposal id was already accepted/);
  assert.throws(() => createBenchAtomicTransition({
    manifest: currentManifest,
    fleetState: reloadedFleetState,
    proposal: proposal({ id: 'replayed-epoch-zero', fleetStateRevision: 2 }),
    binding: atomicBinding(),
  }), /exact current epoch/);
});
