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
  freezeReadyCandidate,
  reserveRoastTeam,
  publicationAuthorization,
  OBJECTIVE_GATES,
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

function observePairWorkers({ agents }) {
  return Object.fromEntries(Object.entries(agents).map(([role, agent]) => [role, {
    agent, mode: 'background', followUpAccepted: true, quiescent: true,
    evidence: `${role} runtime receipt: acknowledged follow-up and waiting for work`,
  }]));
}

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
    coordinatorAgent: 'coordinator-agent',
  }), {
    reservationId: 'pair-1',
    expiresAt,
    now: NOW,
    red: { owner: 'red-owner', agent: 'red-agent', generation: 1 },
    green: { owner: 'green-owner', agent: 'green-agent', generation: 1 },
  });
}

test('coordinator reserves initial pair, freezes a completed cycle, acquires Roast, and recovers expiry durably', (t) => {
  const sandbox = path.join(ROOT, '.test-sandbox', `tdd-control-${process.pid}-${randomUUID()}`);
  const repository = path.join(sandbox, 'repository');
  fs.mkdirSync(repository, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const currentManifest = manifest(repository);
  const file = fleetStatePath(repository, 'tdd-run');
  persistFleetState(file, {
    ...createFleetState(currentManifest, 'tdd-run'),
    strategyState: { namespace: TDD_STRATEGY, value: createTddState({
      runId: 'tdd-run', candidateId: 'candidate-1',
      publicationAgent: 'publisher-agent', coordinatorAgent: 'coordinator-agent',
    }) },
  }, 0, currentManifest);
  const apply = (type, payload = {}, now = NOW, actor = 'coordinator-agent', leases = {}) => {
    const fleetState = loadFleetState(file, currentManifest);
    const currentProposal = createTddTransitionProposal(fleetState.strategyState.value, {
      type, actor, leases, payload, evidence: `${type} evidence`, now,
    });
    return applyTddAtomicFleetStateTransition({
      file, manifest: currentManifest, fleetState, proposal: currentProposal,
      coordinatorAgent: 'coordinator-agent', clock: () => now,
      observePairWorkers,
    });
  };
  const pairPayload = {
    reservationId: 'pair-1', expiresAt: EXPIRY,
    red: { owner: 'red-owner', agent: 'red-agent', generation: 1 },
    green: { owner: 'green-owner', agent: 'green-agent', generation: 1 },
  };
  const initial = loadFleetState(file, currentManifest);
  const reservation = createTddTransitionProposal(initial.strategyState.value, {
    type: 'reserve-pair', actor: 'coordinator-agent', payload: pairPayload, evidence: 'reserve', now: NOW,
  });
  assert.throws(() => applyTddAtomicFleetStateTransition({
    file, manifest: currentManifest, fleetState: initial, proposal: reservation, clock: () => NOW,
  }), /trusted runtime coordinator/);
  assert.throws(() => createTddTransitionProposal(initial.strategyState.value, {
    type: 'reserve-pair', actor: 'red-agent', payload: pairPayload, evidence: 'forged', now: NOW,
  }), /trusted coordinator/);
  let result = apply('reserve-pair', pairPayload);
  assert.throws(() => applyTddAtomicFleetStateTransition({
    file, manifest: currentManifest, fleetState: initial, proposal: reservation,
    coordinatorAgent: 'coordinator-agent', clock: () => NOW,
  }), /revision conflict/);
  const leases = () => Object.fromEntries(result.tddState.seats.filter((seat) => seat.lease).map((seat) => [seat.lease.role, seat.lease]));
  const oldRed = leases().red;
  result = apply('vertical-slice', { sliceId: 'red' }, NOW, 'red-agent', { red: leases().red });
  assert.throws(() => apply('freeze-ready-candidate', {
    readinessDeclarations: Object.fromEntries(['red', 'green'].map((role) => [role, {
      agent: leases()[role].agent, candidateRevision: result.tddState.candidate.revision, evidence: 'premature ready',
    }])),
  }, NOW, 'red-agent', leases()), /completed RED\/GREEN cycle/);
  assert.equal(loadFleetState(file, currentManifest).revision, result.fleetState.revision);
  result = apply('vertical-slice', { sliceId: 'green' }, NOW, 'green-agent', { green: leases().green });
  result = apply('freeze-ready-candidate', {
    readinessDeclarations: Object.fromEntries(['red', 'green'].map((role) => [role, {
      agent: leases()[role].agent, candidateRevision: result.tddState.candidate.revision, evidence: `${role} ready`,
    }])),
  }, NOW, 'red-agent', leases());
  assert.equal(result.tddState.seats.filter((seat) => seat.lease).length, 0);
  const roles = Object.fromEntries(['roastmaster', 'roaster-1', 'roaster-2', 'roaster-3'].map((role) => [role, {
    owner: `${role}-owner`, agent: `${role}-agent`, generation: 1,
  }]));
  result = apply('reserve-roast', { reservationId: 'roast-1', roles, expiresAt: EXPIRY });
  assert.equal(result.tddState.candidate.phase, 'roast');
  assert.equal(result.tddState.seats.filter((seat) => seat.lease).length, 4);
  result = apply('reclaim-expired', {}, EXPIRED_NOW);
  assert.equal(result.tddState.candidate.phase, 'tdd');
  assert.equal(result.tddState.seats.filter((seat) => seat.lease).length, 0);
  result = apply('reserve-pair', { ...pairPayload, reservationId: 'pair-2', expiresAt: '2026-09-04T04:00:00Z' }, EXPIRED_NOW);
  assert.ok(leases().red.fence > oldRed.fence);
  assert.throws(() => createTddTransitionProposal(result.tddState, {
    type: 'vertical-slice', actor: 'red-agent', leases: { red: oldRed },
    evidence: 'late result', payload: { sliceId: 'late' }, now: EXPIRED_NOW,
  }), /stale, expired, or replaced/);
  result = apply('reclaim-expired', {}, '2026-09-04T05:00:00Z');
  assert.equal(result.tddState.seats.filter((seat) => seat.lease).length, 0);
  assert.deepEqual(loadFleetState(file, currentManifest).strategyState.value, result.tddState);
});

test('pair startup and early recovery require runtime evidence and preserve a resumable candidate', (t) => {
  const sandbox = path.join(ROOT, '.test-sandbox', `tdd-recovery-${process.pid}-${randomUUID()}`);
  const repository = path.join(sandbox, 'repository');
  fs.mkdirSync(repository, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const currentManifest = manifest(repository);
  const file = fleetStatePath(repository, 'tdd-run');
  persistFleetState(file, {
    ...createFleetState(currentManifest, 'tdd-run'),
    strategyState: { namespace: TDD_STRATEGY, value: createTddState({
      runId: 'tdd-run', candidateId: 'candidate-1',
      publicationAgent: 'publisher-agent', coordinatorAgent: 'coordinator-agent',
    }) },
  }, 0, currentManifest);
  const prepare = (type, payload, actor = 'coordinator-agent', leases = {}) => {
    const fleetState = loadFleetState(file, currentManifest);
    return {
      file, manifest: currentManifest, fleetState,
      proposal: createTddTransitionProposal(fleetState.strategyState.value, {
        type, payload, actor, leases, evidence: `${type} runtime evidence`, now: NOW,
      }),
      coordinatorAgent: 'coordinator-agent', clock: () => NOW, observePairWorkers,
    };
  };
  const pairPayload = {
    reservationId: 'pair-1', expiresAt: EXPIRY,
    red: { owner: 'red-owner', agent: 'red-agent', generation: 1 },
    green: { owner: 'green-owner', agent: 'green-agent', generation: 1 },
  };
  const unchangedOnFailure = (input, pattern) => {
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => applyTddAtomicFleetStateTransition(input), pattern);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  };
  const reserve = prepare('reserve-pair', pairPayload);
  unchangedOnFailure({ ...reserve, observePairWorkers: undefined }, /trusted runtime pair observer/);
  for (const defect of [
    { mode: 'sync' }, { followUpAccepted: false }, { quiescent: false },
    { agent: 'wrong-agent' }, { evidence: '' },
  ]) {
    unchangedOnFailure({
      ...reserve,
      observePairWorkers: (request) => {
        const observed = observePairWorkers(request);
        Object.assign(observed.green, defect);
        return observed;
      },
    }, /background launch|runtime evidence/);
  }
  // A success-shaped payload cannot replace the trusted runtime observation.
  unchangedOnFailure({
    ...prepare('reserve-pair', { ...pairPayload, workers: observePairWorkers({
      agents: { red: 'red-agent', green: 'green-agent' },
    }) }),
    observePairWorkers: undefined,
  }, /trusted runtime pair observer/);

  let result = applyTddAtomicFleetStateTransition(reserve);
  const leases = () => Object.fromEntries(result.tddState.seats
    .filter((seat) => seat.lease).map((seat) => [seat.lease.role, seat.lease]));
  result = applyTddAtomicFleetStateTransition(prepare(
    'vertical-slice', { sliceId: 'red' }, 'red-agent', { red: leases().red },
  ));
  result = applyTddAtomicFleetStateTransition(prepare(
    'vertical-slice', { sliceId: 'green' }, 'green-agent', { green: leases().green },
  ));
  const oldLeases = leases();
  const candidate = structuredClone(result.tddState.candidate);
  const recoveryPayload = {
    reservationId: 'pair-1', expectedLeaseIds: Object.values(oldLeases).map((lease) => lease.id),
  };
  const recovery = prepare('recover-pair', recoveryPayload);
  unchangedOnFailure({ ...recovery, coordinatorAgent: 'red-agent' }, /trusted runtime coordinator/);
  unchangedOnFailure({ ...recovery, observePairWorkers: undefined }, /trusted runtime pair observer/);
  unchangedOnFailure({
    ...recovery,
    observePairWorkers: (request) => ({
      ...observePairWorkers(request),
      green: { agent: 'green-agent', quiescent: false, evidence: 'still running' },
    }),
  }, /quiescence/);
  unchangedOnFailure(prepare('recover-pair', {
    ...recoveryPayload, expectedLeaseIds: [oldLeases.red.id],
  }), /both current pair lease ids/);
  unchangedOnFailure(prepare('recover-pair', {
    ...recoveryPayload, reservationId: 'other-pair',
  }), /active pair reservation/);

  // Legacy sync workers may be recovered once both are proven unable to write.
  result = applyTddAtomicFleetStateTransition({
    ...recovery,
    observePairWorkers: (request) => Object.fromEntries(Object.entries(request.agents)
      .map(([role, agent]) => [role, { agent, quiescent: true, evidence: 'sync task completed' }])),
    transition: () => { throw new Error('control operation must not call this override'); },
  });
  assert.equal(result.tddState.candidate.revision, 3);
  assert.deepEqual(result.tddState.candidate.slices, candidate.slices);
  assert.equal(result.tddState.candidate.nextRole, 'red');
  assert.equal(result.tddState.candidate.pairReservationId, null);
  assert.equal(result.tddState.candidate.readinessDeclarations, null);
  assert.equal(result.tddState.seats.filter((seat) => seat.lease).length, 0);
  assert.ok(result.tddState.seats[0].fence > oldLeases.red.fence);
  assert.ok(result.tddState.seats[1].fence > oldLeases.green.fence);
  unchangedOnFailure(recovery, /revision conflict/);

  result = applyTddAtomicFleetStateTransition(prepare('reserve-pair', {
    ...pairPayload, reservationId: 'pair-2',
    red: { owner: 'new-red-owner', agent: 'new-red', generation: 2 },
    green: { owner: 'new-green-owner', agent: 'new-green', generation: 2 },
  }));
  assert.throws(() => prepare('vertical-slice', { sliceId: 'late' }, 'red-agent', {
    red: oldLeases.red,
  }), /stale, expired, or replaced/);
  const declarations = (agents) => Object.fromEntries(Object.entries(agents).map(([role, agent]) => [
    role, { agent, candidateRevision: 3, evidence: `${role} independently reinspected preserved revision 3` },
  ]));
  unchangedOnFailure(prepare('freeze-ready-candidate', {
    readinessDeclarations: declarations({ red: 'red-agent', green: 'green-agent' }),
  }, 'new-red', leases()), /current lease and revision/);
  result = applyTddAtomicFleetStateTransition(prepare('freeze-ready-candidate', {
    readinessDeclarations: declarations({ red: 'new-red', green: 'new-green' }),
  }, 'new-red', leases()));
  assert.equal(result.tddState.candidate.frozenRevision, 3);
  assert.equal(result.tddState.candidate.phase, 'frozen');
  assert.equal(result.tddState.seats.filter((seat) => seat.lease).length, 0);
  assert.deepEqual(loadFleetState(file, currentManifest).strategyState.value, result.tddState);
});

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

test('atomic Roast approval requires complete independent reports and persists them for publication', (t) => {
  const sandbox = path.join(ROOT, '.test-sandbox', `tdd-reports-${process.pid}-${randomUUID()}`);
  const repository = path.join(sandbox, 'repository');
  fs.mkdirSync(repository, { recursive: true });
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const currentManifest = manifest(repository);
  const file = fleetStatePath(repository, 'tdd-run');
  let current = reservePair().state;
  const leasesFor = (state) => Object.fromEntries(state.seats
    .filter((seat) => seat.lease).map((seat) => [seat.lease.role, seat.lease]));
  for (const role of ['red', 'green']) {
    current = recordVerticalSlice(current, {
      lease: leasesFor(current)[role], sliceId: role, evidence: `${role} evidence`, now: NOW,
    });
  }
  const pairLeases = leasesFor(current);
  current = freezeReadyCandidate(current, {
    leases: pairLeases, now: NOW,
    readinessDeclarations: Object.fromEntries(['red', 'green'].map((role) => [role, {
      agent: pairLeases[role].agent, candidateRevision: current.candidate.revision, evidence: 'ready',
    }])),
  });
  const roles = Object.fromEntries(['roastmaster', 'roaster-1', 'roaster-2', 'roaster-3'].map((role) => [role, {
    owner: `${role}-owner`, agent: `${role}-agent`, generation: 1,
  }]));
  const roast = reserveRoastTeam(current, { reservationId: 'roast-1', roles, expiresAt: EXPIRY, now: NOW });
  persistFleetState(file, {
    ...createFleetState(currentManifest, 'tdd-run'),
    strategyState: { namespace: TDD_STRATEGY, value: roast.state },
  }, 0, currentManifest);
  const report = (role) => ({
    invocation: {
      id: `report-${role}`, skill: 'roast', runId: 'tdd-run',
      issue: current.candidate.id, agent: roles[role].agent,
    },
    candidateId: current.candidate.id, candidateRevision: current.candidate.revision,
    leaseId: roast.leases[role].id, fence: roast.leases[role].fence,
    status: 'completed', terminal: true, complete: true, evidenceComplete: true,
    completedAt: NOW, findings: [],
    evidence: `${role} report artifact`,
  });
  const reports = ['roaster-1', 'roaster-2', 'roaster-3'].map(report);
  const payload = {
    reports,
    synthesis: {
      ...report('roastmaster'), reportIds: reports.map((entry) => entry.invocation.id),
      evidence: 'three independent reports synthesized',
    },
    dispositions: [], objectiveGates: Object.fromEntries(OBJECTIVE_GATES.map((gate) => [gate, true])),
  };
  const apply = (evidence) => {
    const fleetState = loadFleetState(file, currentManifest);
    return applyTddAtomicFleetStateTransition({
      file, manifest: currentManifest, fleetState, clock: () => NOW,
      proposal: createTddTransitionProposal(fleetState.strategyState.value, {
        type: 'roast-approved', actor: roles.roastmaster.agent, leases: roast.leases,
        evidence: 'Roast result', payload: evidence, now: NOW,
      }),
    });
  };
  for (const corrupt of [
    (e) => { delete e.reports; },
    (e) => { e.reports[1] = e.reports[0]; },
    (e) => { e.reports[0].candidateRevision -= 1; },
    (e) => { e.reports[0].findings = [{ id: 'must-fix', Priority: 'Must fix', status: 'open' }]; },
    (e) => { delete e.synthesis; },
  ]) {
    const invalid = structuredClone(payload);
    corrupt(invalid);
    assert.throws(() => apply(invalid), /Roast/);
    assert.equal(loadFleetState(file, currentManifest).revision, 1);
    assert.equal(loadFleetState(file, currentManifest).strategyState.value.candidate.phase, 'roast');
  }
  const applied = apply(payload);
  const reloaded = loadFleetState(file, currentManifest).strategyState.value;
  assert.equal(applied.fleetState.revision, 2);
  assert.deepEqual(reloaded.candidate.roastEvidence.reports, reports);
  assert.deepEqual(reloaded.candidate.roastEvidence.synthesis, payload.synthesis);
  assert.equal(publicationAuthorization(reloaded, { actor: { id: 'publisher-agent' } }).authorized, true);
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
