import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canConsumeSlopSniperAdvice,
  assertTddState,
  createTddTransitionProposal,
  createTddState,
  freezeReadyCandidate,
  mutateCandidate,
  publicationAuthorization,
  reclaimExpiredReservations,
  recoverTddPair,
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
    coordinatorAgent: 'coordinator-agent',
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

function roastEvidence(roast) {
  const receipt = (role) => ({
    invocation: {
      id: `report-${role}`, skill: 'roast', runId: roast.state.runId,
      issue: roast.state.candidate.id, agent: roast.leases[role].agent,
    },
    candidateId: roast.state.candidate.id,
    candidateRevision: roast.state.candidate.revision,
    leaseId: roast.leases[role].id, fence: roast.leases[role].fence,
    status: 'completed', terminal: true, complete: true, evidenceComplete: true,
    completedAt: NOW, findings: [],
    evidence: `${role} report artifact`,
  });
  const reports = ['roaster-1', 'roaster-2', 'roaster-3'].map(receipt);
  return {
    reports,
    synthesis: {
      ...receipt('roastmaster'), reportIds: reports.map((report) => report.invocation.id),
      evidence: 'independent reports synthesized',
    },
    dispositions: [],
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

test('early pair recovery preserves a pending Green turn and cannot manufacture a complete cycle', () => {
  const reserved = pair(state());
  const afterRed = recordVerticalSlice(reserved.state, {
    lease: reserved.leases.red, sliceId: 'red-only', evidence: 'failing test', now: NOW,
  });
  const recovered = recoverTddPair(afterRed, {
    reservationId: 'pair-1',
    expectedLeaseIds: Object.values(reserved.leases).map((lease) => lease.id),
  });
  assert.equal(recovered.candidate.nextRole, 'green');
  assert.equal(recovered.candidate.revision, 2);
  assert.equal(publicationAuthorization(recovered, { actor: { id: 'publisher-agent' } }).authorized, false);
  const replacement = pair(recovered);
  assert.throws(() => freezeReadyCandidate(replacement.state, {
    leases: replacement.leases,
    readinessDeclarations: readinessDeclarations(replacement.leases, 2),
    now: NOW,
  }), /completed RED\/GREEN cycle/);
  assert.throws(() => recordVerticalSlice(replacement.state, {
    lease: reserved.leases.green, sliceId: 'old-green', evidence: 'late', now: NOW,
  }), /stale, expired, or replaced/);
  assertTddState(recovered);
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
    ...roastEvidence(roast),
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
  const replacement = pair(mutated);
  assert.throws(() => freezeReadyCandidate(replacement.state, {
    leases: replacement.leases,
    readinessDeclarations: readinessDeclarations(replacement.leases, mutated.candidate.revision),
    now: NOW,
  }), /completed RED\/GREEN cycle/);
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
      ...roastEvidence(roast),
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

test('RED alone cannot freeze even with both declarations, and ownership remains unchanged', () => {
  const reserved = pair(state());
  const afterRed = recordVerticalSlice(reserved.state, {
    lease: reserved.leases.red, sliceId: 'red-only', evidence: 'failing test', now: NOW,
  });
  const before = structuredClone(afterRed);
  const leases = Object.fromEntries(afterRed.seats.filter((seat) => seat.lease).map((seat) => [seat.lease.role, seat.lease]));
  assert.throws(() => freezeReadyCandidate(afterRed, {
    leases, readinessDeclarations: readinessDeclarations(leases, afterRed.candidate.revision), now: NOW,
  }), /completed RED\/GREEN cycle/);
  assert.deepEqual(afterRed, before);
});

test('Roast persists independent reports and synthesis and rejects missing, duplicate, stale, or unresolved evidence', () => {
  const roast = reserveRoastTeam(readyForRoast(), {
    reservationId: 'roast-1', roles: roastRoles(), expiresAt: EXPIRY, now: NOW,
  });
  for (const corrupt of [
    (e) => { e.reports.pop(); },
    (e) => { e.reports[1] = e.reports[0]; },
    (e) => { e.reports[0].candidateRevision -= 1; },
    (e) => { delete e.reports[0].evidence; },
    (e) => { e.reports[0].findings = [{ id: 'bug', Priority: 'Must fix', status: 'open' }]; },
    (e) => { e.synthesis = null; },
    (e) => { e.synthesis.reportIds.pop(); },
    (e) => { e.reports[0].findings = [{ id: 'follow-up', Priority: 'Should fix', status: 'open' }]; },
  ]) {
    const evidence = roastEvidence(roast);
    evidence.reports.reverse();
    corrupt(evidence);
    assert.throws(() => recordRoastApproval(roast.state, {
      leases: roast.leases, ...evidence, objectiveGates: GATES, now: NOW,
    }), /Roast/);
    assert.equal(roast.state.candidate.phase, 'roast');
    assert.equal(roast.state.seats.filter((seat) => seat.lease).length, 4);
  }
  const evidence = roastEvidence(roast);
  const ready = recordRoastApproval(roast.state, {
    leases: roast.leases, ...evidence, objectiveGates: GATES, now: NOW,
  });
  const reloaded = JSON.parse(JSON.stringify(ready));
  assertTddState(reloaded);
  assert.deepEqual(reloaded.candidate.roastEvidence.reports, evidence.reports);
  reloaded.candidate.roastEvidence.reports[0].candidateRevision -= 1;
  assert.throws(() => publicationAuthorization(reloaded, { actor: { id: 'publisher-agent' } }), /Roast/);
});
