import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  applyTddAtomicFleetStateTransition,
} from './atomic-proposal.mjs';
import {
  createTddState,
  createTddTransitionProposal,
  recordVerticalSlice,
  reserveTddPair,
  TDD_STRATEGY,
} from '../tdd-lifecycle/tdd-lifecycle.mjs';
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
const NOW = '2026-09-04T01:00:00.000Z';
const EXPIRY = '2026-09-04T02:00:00.000Z';
const LOCKED_NOW = '2026-09-04T01:30:00.000Z';
const EXPIRED_NOW = '2026-09-04T03:00:00.000Z';

function receipt() {
  return {
    invocation: { id: 'read-1', operation: 'read-issue' },
    provider: 'github',
    repository: 'owner/repo',
    issue: '1',
    revision: 'r1',
    issueStatus: 'pending',
    status: 'observed',
    terminal: true,
    complete: true,
    observedAt: NOW,
  };
}

function manifest(repositoryRoot) {
  return normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: 'persist tdd atomic transition',
    acceptedScope: ['tdd only'],
    issues: [{
      identity: '1',
      sourceRevision: 'r1',
      sourceReceipt: receipt(),
      acceptanceCriteria: [{ id: '1-C1', description: 'criterion' }],
      scope: ['tdd'],
      allowedPaths: ['src/tdd/**'],
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

function reservePair(expiresAt = EXPIRY) {
  return reserveTddPair(createTddState({
    runId: 'tdd-run',
    candidateId: 'candidate-1',
    publicationAgent: 'publisher-agent',
  }), {
    reservationId: 'pair-1',
    expiresAt,
    now: NOW,
    red: { owner: 'red-owner', agent: 'red-agent', generation: 1 },
    green: { owner: 'green-owner', agent: 'green-agent', generation: 1 },
  });
}

function proposal(tddState, redLease) {
  return createTddTransitionProposal(tddState, {
    type: 'vertical-slice',
    actor: 'red-agent',
    leases: { red: redLease },
    evidence: 'red slice evidence',
    payload: { sliceId: 'slice-red' },
    now: NOW,
  });
}

function applySlice(lockedTddState, validatedProposal, _sharedProposal, now) {
  const details = validatedProposal.payload.value;
  return recordVerticalSlice(lockedTddState, {
    lease: details.leases.red,
    sliceId: details.payload.sliceId,
    evidence: details.evidence,
    now,
  });
}

test('persists a TDD transition through Fleet State CAS and rejects a stale expected state', (t) => {
  const sandbox = path.join(
    ROOT,
    '.test-sandbox',
    `tdd-atomic-${process.pid}-${randomUUID()}`,
  );
  const repository = path.join(sandbox, 'repository');
  fs.mkdirSync(repository, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const currentManifest = manifest(repository);
  const reserved = reservePair();
  const file = fleetStatePath(repository, 'tdd-run');
  persistFleetState(file, {
    ...createFleetState(currentManifest, 'tdd-run'),
    strategyState: {
      namespace: TDD_STRATEGY,
      value: reserved.state,
    },
  }, 0, currentManifest);
  const initialFleetState = loadFleetState(file, currentManifest);
  const currentProposal = proposal(reserved.state, reserved.leases.red);

  const applied = applyTddAtomicFleetStateTransition({
    file,
    manifest: currentManifest,
    fleetState: initialFleetState,
    proposal: currentProposal,
    now: NOW,
    clock: () => NOW,
    transition: applySlice,
  });

  assert.equal(applied.fleetState.revision, 2);
  assert.equal(applied.tddState.controlRevision, reserved.state.controlRevision + 1);
  assert.equal(applied.tddState.candidate.nextRole, 'green');
  assert.deepEqual(loadFleetState(file, currentManifest).strategyState, {
    namespace: TDD_STRATEGY,
    value: applied.tddState,
  });
  assert.throws(() => applyTddAtomicFleetStateTransition({
    file,
    manifest: currentManifest,
    fleetState: initialFleetState,
    proposal: currentProposal,
    now: NOW,
    clock: () => NOW,
    transition: applySlice,
  }), /state revision conflict: disk is 2, expected 1/);
});

test('rejects a queued proposal that expires before locked validation', (t) => {
  const sandbox = path.join(
    ROOT,
    '.test-sandbox',
    `tdd-atomic-expired-${process.pid}-${randomUUID()}`,
  );
  const repository = path.join(sandbox, 'repository');
  fs.mkdirSync(repository, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const currentManifest = manifest(repository);
  const reserved = reservePair('2026-09-04T02:00:00.000Z');
  const file = fleetStatePath(repository, 'tdd-run');
  persistFleetState(file, {
    ...createFleetState(currentManifest, 'tdd-run'),
    strategyState: {
      namespace: TDD_STRATEGY,
      value: reserved.state,
    },
  }, 0, currentManifest);
  const initialFleetState = loadFleetState(file, currentManifest);
  const currentProposal = proposal(reserved.state, reserved.leases.red);
  let clockCalls = 0;

  assert.throws(() => applyTddAtomicFleetStateTransition({
    file,
    manifest: currentManifest,
    fleetState: initialFleetState,
    proposal: currentProposal,
    now: EXPIRED_NOW,
    clock: () => {
      clockCalls += 1;
      return clockCalls === 1 ? NOW : EXPIRED_NOW;
    },
    transition: () => assert.fail('expired proposal must not invoke the lifecycle callback'),
  }), /red lease is stale, expired, or replaced/);
  assert.equal(loadFleetState(file, currentManifest).revision, 1);
});

test('supplies the lock-scoped trusted time to the lifecycle callback', (t) => {
  const sandbox = path.join(
    ROOT,
    '.test-sandbox',
    `tdd-atomic-clock-${process.pid}-${randomUUID()}`,
  );
  const repository = path.join(sandbox, 'repository');
  fs.mkdirSync(repository, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const currentManifest = manifest(repository);
  const reserved = reservePair();
  const file = fleetStatePath(repository, 'tdd-run');
  persistFleetState(file, {
    ...createFleetState(currentManifest, 'tdd-run'),
    strategyState: {
      namespace: TDD_STRATEGY,
      value: reserved.state,
    },
  }, 0, currentManifest);
  const initialFleetState = loadFleetState(file, currentManifest);
  const currentProposal = proposal(reserved.state, reserved.leases.red);
  let callbackNow = null;

  applyTddAtomicFleetStateTransition({
    file,
    manifest: currentManifest,
    fleetState: initialFleetState,
    proposal: currentProposal,
    now: NOW,
    clock: () => LOCKED_NOW,
    transition: (lockedTddState, validatedProposal, _sharedProposal, now) => {
      callbackNow = now;
      const details = validatedProposal.payload.value;
      return recordVerticalSlice(lockedTddState, {
        lease: details.leases.red,
        sliceId: details.payload.sliceId,
        evidence: details.evidence,
        now,
      });
    },
  });
  assert.equal(callbackNow, LOCKED_NOW);
});

test('rejects a callback successor that corrupts TDD strategy state', (t) => {
  const sandbox = path.join(
    ROOT,
    '.test-sandbox',
    `tdd-atomic-corrupt-${process.pid}-${randomUUID()}`,
  );
  const repository = path.join(sandbox, 'repository');
  fs.mkdirSync(repository, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const currentManifest = manifest(repository);
  const reserved = reservePair();
  const file = fleetStatePath(repository, 'tdd-run');
  persistFleetState(file, {
    ...createFleetState(currentManifest, 'tdd-run'),
    strategyState: {
      namespace: TDD_STRATEGY,
      value: reserved.state,
    },
  }, 0, currentManifest);
  const initialFleetState = loadFleetState(file, currentManifest);
  const currentProposal = proposal(reserved.state, reserved.leases.red);

  assert.throws(() => applyTddAtomicFleetStateTransition({
    file,
    manifest: currentManifest,
    fleetState: initialFleetState,
    proposal: currentProposal,
    now: NOW,
    clock: () => NOW,
    transition: (lockedTddState) => ({
      ...lockedTddState,
      candidate: {
        ...lockedTddState.candidate,
        phase: 'corrupt',
      },
    }),
  }), /candidate phase is invalid/);
  assert.equal(loadFleetState(file, currentManifest).revision, 1);
});
