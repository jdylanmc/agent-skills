import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canConsumeSlopSniperAdvice,
  createTddTransitionProposal,
  createTddState,
  freezeReadyCandidate,
  mutateCandidate,
  publicationAuthorization,
  reclaimExpiredReservations,
  recordRoastApproval,
  recordVerticalSlice,
  requestSlopSniperAudit,
  reserveRoastTeam,
  reserveTddPair,
  returnRecommendationsToPair,
  validateTddTransitionProposal,
} from './tdd-lifecycle.mjs';
import { validateStrategyTransitionProposal } from '../../../_base/_atoms/atomic-transition/atomic-transition.mjs';

const NOW = '2026-09-04T01:00:00.000Z';
const EXPIRY = '2026-09-04T02:00:00.000Z';
const EXPIRED_NOW = '2026-09-04T03:00:00.000Z';
const GATES = {
  scope: true,
  ownership: true,
  revision: true,
  evidence: true,
  validation: true,
  budget: true,
};

function pair(state) {
  return reserveTddPair(state, {
    reservationId: 'pair-1',
    expiresAt: EXPIRY,
    now: NOW,
    red: { owner: 'red-owner', agent: 'red-agent', generation: 1 },
    green: { owner: 'green-owner', agent: 'green-agent', generation: 1 },
  });
}

function state() {
  return createTddState({
    runId: 'run-1',
    candidateId: 'candidate-1',
    publicationAgent: 'publisher-agent',
  });
}

function readinessDeclarations(leases, candidateRevision) {
  return {
    red: {
      agent: leases.red.agent,
      candidateRevision,
      evidence: 'red readiness evidence',
    },
    green: {
      agent: leases.green.agent,
      candidateRevision,
      evidence: 'green readiness evidence',
    },
  };
}

function roastRoles() {
  return {
    roastmaster: { owner: 'master-owner', agent: 'master-agent', generation: 1 },
    'roaster-1': { owner: 'roaster-one', agent: 'roaster-agent-one', generation: 1 },
    'roaster-2': { owner: 'roaster-two', agent: 'roaster-agent-two', generation: 1 },
    'roaster-3': { owner: 'roaster-three', agent: 'roaster-agent-three', generation: 1 },
  };
}

function readyForRoast() {
  const reserved = pair(state());
  const afterRed = recordVerticalSlice(reserved.state, {
    lease: reserved.leases.red, sliceId: 'slice-red', evidence: 'red evidence', now: NOW,
  });
  const currentGreen = afterRed.seats.find((seat) => seat.lease?.role === 'green').lease;
  const afterGreen = recordVerticalSlice(afterRed, {
    lease: currentGreen, sliceId: 'slice-green', evidence: 'green evidence', now: NOW,
  });
  const leases = Object.fromEntries(
    afterGreen.seats.filter((seat) => seat.lease).map((seat) => [seat.lease.role, seat.lease]),
  );
  return freezeReadyCandidate(afterGreen, {
    leases,
    readinessDeclarations: readinessDeclarations(leases, afterGreen.candidate.revision),
    now: NOW,
  });
}

test('pair holds two distinct leases and alternates vertical slices', () => {
  const reserved = pair(state());
  assert.equal(reserved.leases.red.seat === reserved.leases.green.seat, false);
  assert.equal(reserved.leases.red.agent === reserved.leases.green.agent, false);
  assert.equal(reserved.state.seats.filter((seat) => seat.lease).length, 2);

  const afterRed = recordVerticalSlice(reserved.state, {
    lease: reserved.leases.red, sliceId: 'slice-red', evidence: 'red evidence', now: NOW,
  });
  assert.equal(afterRed.candidate.nextRole, 'green');
  assert.throws(
    () => recordVerticalSlice(afterRed, {
      lease: reserved.leases.red, sliceId: 'out-of-turn', evidence: 'wrong role', now: NOW,
    }),
    /green lease is stale/,
  );
});

test('freezing a ready candidate releases both pair leases before Roast reservation', () => {
  const frozen = readyForRoast();
  assert.equal(frozen.candidate.phase, 'frozen');
  assert.equal(frozen.seats.filter((seat) => seat.lease).length, 0);

  const roast = reserveRoastTeam(frozen, {
    reservationId: 'roast-1', roles: roastRoles(), expiresAt: EXPIRY, now: NOW,
  });
  assert.equal(roast.state.seats.filter((seat) => seat.lease).length, 4);
  assert.equal(roast.state.seats.filter((seat) => seat.lease === null).length, 1);
  assert.deepEqual(
    Object.keys(roast.leases).sort(),
    ['roaster-1', 'roaster-2', 'roaster-3', 'roastmaster'],
  );
});

test('multi-seat reservations are atomic and reject duplicate Roast roles', () => {
  const frozen = readyForRoast();
  const invalidRoles = roastRoles();
  invalidRoles['roaster-3'] = invalidRoles['roaster-2'];
  assert.throws(
    () => reserveRoastTeam(frozen, {
      reservationId: 'roast-1', roles: invalidRoles, expiresAt: EXPIRY, now: NOW,
    }),
    /distinct/,
  );
  assert.equal(frozen.seats.filter((seat) => seat.lease).length, 0);
});

test('recommendations release Roast and return the candidate to the pair', () => {
  const roast = reserveRoastTeam(readyForRoast(), {
    reservationId: 'roast-1', roles: roastRoles(), expiresAt: EXPIRY, now: NOW,
  });
  const returned = returnRecommendationsToPair(roast.state, {
    leases: roast.leases,
    recommendations: ['Cover the rejected boundary condition.'],
    now: NOW,
  });
  assert.equal(returned.candidate.phase, 'tdd');
  assert.equal(returned.candidate.nextRole, 'red');
  assert.equal(returned.seats.filter((seat) => seat.lease).length, 0);
});

test('mutation invalidates current Roast and publication is review-ready agent-only', () => {
  const roast = reserveRoastTeam(readyForRoast(), {
    reservationId: 'roast-1', roles: roastRoles(), expiresAt: EXPIRY, now: NOW,
  });
  const ready = recordRoastApproval(roast.state, {
    leases: roast.leases,
    synthesisEvidence: 'all three reports synthesized',
    objectiveGates: GATES,
    now: NOW,
  });
  assert.equal(publicationAuthorization(ready, { actor: { kind: 'worker' } }).authorized, false);
  assert.equal(
    publicationAuthorization(ready, { actor: { kind: 'publication-agent', id: 'publisher-agent' } }).authorized,
    true,
  );
  assert.equal(
    publicationAuthorization(ready, { actor: { kind: 'publication-agent' } }).authorized,
    false,
  );
  assert.equal(
    publicationAuthorization(ready, { actor: { id: 'another-agent' } }).authorized,
    false,
  );
  const mutated = mutateCandidate(ready, {
    expectedRevision: ready.candidate.revision,
    mutationEvidence: 'apply a new accepted change',
  });
  assert.equal(mutated.candidate.phase, 'tdd');
  assert.equal(mutated.candidate.roastEvidence, null);
  assert.equal(
    publicationAuthorization(mutated, { actor: { id: 'publisher-agent' } }).authorized,
    false,
  );
});

test('expired reservations fence the whole team and stale snapshots remain advisory', () => {
  const reserved = pair(state());
  const expired = reclaimExpiredReservations(reserved.state, { now: EXPIRED_NOW });
  assert.equal(expired.seats.filter((seat) => seat.lease).length, 0);
  assert.equal(expired.seats.filter((seat) => seat.id === reserved.leases.red.seat)[0].fence, 2);
  assert.equal(expired.seats.filter((seat) => seat.id === reserved.leases.green.seat)[0].fence, 2);
  const audit = requestSlopSniperAudit(expired, {
    event: 'pre-dispatch',
    snapshotId: 'snapshot-1',
  });
  assert.equal(canConsumeSlopSniperAdvice(expired, audit).consumable, true);
  const changed = reserveTddPair(expired, {
    reservationId: 'pair-2',
    expiresAt: '2026-09-04T04:00:00.000Z',
    now: EXPIRED_NOW,
    red: { owner: 'red-owner', agent: 'red-agent', generation: 2 },
    green: { owner: 'green-owner', agent: 'green-agent', generation: 2 },
  }).state;
  assert.equal(canConsumeSlopSniperAdvice(changed, audit).consumable, false);
});

test('typed proposals bind the current control revision and active lease fences', () => {
  const reserved = pair(state());
  const proposal = createTddTransitionProposal(reserved.state, {
    type: 'vertical-slice',
    actor: 'red-agent',
    leases: { red: reserved.leases.red },
    evidence: 'slice evidence',
    payload: { sliceId: 'slice-red' },
    now: NOW,
  });
  const shared = validateStrategyTransitionProposal(proposal);
  assert.equal(shared.valid, true);
  assert.deepEqual(validateTddTransitionProposal(reserved.state, proposal, { now: NOW }), proposal);
  assert.throws(
    () => validateTddTransitionProposal({ ...reserved.state, controlRevision: 99 }, proposal, { now: NOW }),
    /control revision is stale/,
  );
  assert.throws(
    () => validateTddTransitionProposal(reserved.state, {
      ...proposal,
      binding: { ...proposal.binding, agent: 'unbound-agent' },
    }, { now: NOW }),
    /shared atomic transition contract/,
  );
});

test('lease-consuming pair and Roast transitions reject a passed expired time', () => {
  const reserved = pair(state());
  assert.throws(
    () => recordVerticalSlice(reserved.state, {
      lease: reserved.leases.red,
      sliceId: 'too-late',
      evidence: 'late evidence',
      now: EXPIRED_NOW,
    }),
    /red lease is stale, expired, or replaced/,
  );

  const roast = reserveRoastTeam(readyForRoast(), {
    reservationId: 'roast-1', roles: roastRoles(), expiresAt: EXPIRY, now: NOW,
  });
  assert.throws(
    () => recordRoastApproval(roast.state, {
      leases: roast.leases,
      synthesisEvidence: 'too late',
      objectiveGates: GATES,
      now: EXPIRED_NOW,
    }),
    /roastmaster lease is stale, expired, or replaced/,
  );
  assert.throws(
    () => returnRecommendationsToPair(roast.state, {
      leases: roast.leases,
      recommendations: ['Too late to return this result.'],
      now: EXPIRED_NOW,
    }),
    /roastmaster lease is stale, expired, or replaced/,
  );
});

test('freezing requires revision-bound readiness declarations from Red and Green', () => {
  const reserved = pair(state());
  const afterRed = recordVerticalSlice(reserved.state, {
    lease: reserved.leases.red, sliceId: 'slice-red', evidence: 'red evidence', now: NOW,
  });
  const leases = Object.fromEntries(
    afterRed.seats.filter((seat) => seat.lease).map((seat) => [seat.lease.role, seat.lease]),
  );
  assert.throws(
    () => freezeReadyCandidate(afterRed, {
      leases,
      readinessDeclarations: {
        red: {
          agent: leases.red.agent,
          candidateRevision: afterRed.candidate.revision,
          evidence: 'red says ready',
        },
      },
      now: NOW,
    }),
    /independent red and green declarations/,
  );
});

test('reservations reject an expiry at or before trusted now', () => {
  assert.throws(
    () => reserveTddPair(state(), {
      reservationId: 'expired-pair',
      expiresAt: NOW,
      now: NOW,
      red: { owner: 'red-owner', agent: 'red-agent', generation: 1 },
      green: { owner: 'green-owner', agent: 'green-agent', generation: 1 },
    }),
    /TDD pair reservation expiry must be after trusted now/,
  );
  assert.throws(
    () => reserveRoastTeam(readyForRoast(), {
      reservationId: 'expired-roast',
      roles: roastRoles(),
      expiresAt: NOW,
      now: NOW,
    }),
    /Roast reservation expiry must be after trusted now/,
  );
});
