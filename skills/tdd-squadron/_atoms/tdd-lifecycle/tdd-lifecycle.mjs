import {
  FORBIDDEN_AUTHORITIES,
  validateStrategyTransitionProposal,
} from '../../../_base/_atoms/atomic-transition/atomic-transition.mjs';

const DELIVERY_SEAT_COUNT = 5;
const PAIR_ROLES = ['red', 'green'];
const ROAST_ROLES = ['roastmaster', 'roaster-1', 'roaster-2', 'roaster-3'];
const OBJECTIVE_GATES = ['scope', 'ownership', 'revision', 'evidence', 'validation', 'budget'];
const CANDIDATE_PHASES = new Set(['tdd', 'frozen', 'roast', 'review-ready']);
const TDD_TRANSITION_TYPES = new Set([
  'vertical-slice',
  'freeze-ready-candidate',
  'roast-approved',
  'recommendations-to-pair',
]);
const SLOP_SNIPER_EVENTS = new Set([
  'pre-dispatch',
  'repeated-failure',
  'handoff',
  'post-review-mutation',
  'shared-root-failure',
  'pre-readiness',
  'terminal-with-active-work',
]);

function clone(value) {
  return structuredClone(value);
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function validTime(value, label) {
  nonEmpty(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp`);
  }
  return value;
}

function compareTime(left, right) {
  return Date.parse(left) - Date.parse(right);
}

function unique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must be distinct`);
  }
}

function exactKeys(value, keys) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function assertExactKeys(value, keys, label) {
  if (!exactKeys(value, keys)) {
    throw new Error(`${label} must contain exactly ${keys.join(', ')}`);
  }
}

function assertArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function assertNullableRevision(value, label) {
  if (value !== null) positiveInteger(value, label);
  return value;
}

function assertReadinessDeclarations(value, candidateRevision) {
  assertExactKeys(value, PAIR_ROLES, 'candidate readiness declarations');
  const agents = PAIR_ROLES.map((role) => {
    const declaration = value[role];
    assertExactKeys(
      declaration,
      ['agent', 'candidateRevision', 'evidence'],
      `${role} readiness declaration`,
    );
    nonEmpty(declaration.agent, `${role} readiness declaration agent`);
    if (declaration.candidateRevision !== candidateRevision) {
      throw new Error(`${role} readiness declaration is not bound to the current candidate revision`);
    }
    nonEmpty(declaration.evidence, `${role} readiness declaration evidence`);
    return declaration.agent;
  });
  unique(agents, 'readiness declaration agents');
}

function assertCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('TDD state candidate must be an object');
  }
  const required = [
    'id',
    'revision',
    'phase',
    'nextRole',
    'slices',
    'pairReservationId',
    'frozenRevision',
    'roastEvidence',
    'recommendations',
    'invalidatedRoastRevisions',
  ];
  const optional = ['readinessDeclarations', 'mutationEvidence'];
  const keys = Object.keys(candidate);
  if (
    keys.length < required.length
    || !required.every((key) => Object.hasOwn(candidate, key))
    || keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    throw new Error('TDD state candidate has invalid fields');
  }
  nonEmpty(candidate.id, 'candidate id');
  positiveInteger(candidate.revision, 'candidate revision');
  if (!CANDIDATE_PHASES.has(candidate.phase)) {
    throw new Error('candidate phase is invalid');
  }
  if (!PAIR_ROLES.includes(candidate.nextRole)) {
    throw new Error('candidate nextRole is invalid');
  }
  if (candidate.pairReservationId !== null) {
    nonEmpty(candidate.pairReservationId, 'candidate pairReservationId');
  }
  assertNullableRevision(candidate.frozenRevision, 'candidate frozenRevision');
  assertArray(candidate.slices, 'candidate slices');
  const sliceIds = new Set();
  for (const slice of candidate.slices) {
    assertExactKeys(slice, ['id', 'role', 'revision', 'evidence'], 'candidate slice');
    nonEmpty(slice.id, 'candidate slice id');
    if (sliceIds.has(slice.id)) throw new Error('candidate slice ids must be distinct');
    sliceIds.add(slice.id);
    if (!PAIR_ROLES.includes(slice.role)) throw new Error('candidate slice role is invalid');
    positiveInteger(slice.revision, 'candidate slice revision');
    if (slice.revision >= candidate.revision) {
      throw new Error('candidate slice revision must precede the current candidate revision');
    }
    nonEmpty(slice.evidence, 'candidate slice evidence');
  }
  assertArray(candidate.recommendations, 'candidate recommendations');
  if (candidate.recommendations.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new Error('candidate recommendations must be non-empty strings');
  }
  assertArray(candidate.invalidatedRoastRevisions, 'candidate invalidatedRoastRevisions');
  const invalidated = new Set();
  for (const revision of candidate.invalidatedRoastRevisions) {
    positiveInteger(revision, 'invalidated Roast revision');
    if (revision >= candidate.revision) {
      throw new Error('invalidated Roast revision must precede the current candidate revision');
    }
    if (invalidated.has(revision)) throw new Error('invalidated Roast revisions must be distinct');
    invalidated.add(revision);
  }
  if (Object.hasOwn(candidate, 'mutationEvidence')) {
    if (candidate.mutationEvidence !== undefined && candidate.mutationEvidence !== null) {
      nonEmpty(candidate.mutationEvidence, 'candidate mutationEvidence');
    }
  }

  const needsReadiness = ['frozen', 'roast', 'review-ready'].includes(candidate.phase);
  if (needsReadiness) {
    if (candidate.slices.length === 0) {
      throw new Error('frozen candidate must contain at least one vertical slice');
    }
    if (candidate.frozenRevision !== candidate.revision) {
      throw new Error('frozen candidate revision must equal the current candidate revision');
    }
    assertReadinessDeclarations(candidate.readinessDeclarations, candidate.revision);
  } else {
    if (candidate.frozenRevision !== null) {
      throw new Error('TDD candidate cannot retain a frozen revision');
    }
    if (Object.hasOwn(candidate, 'readinessDeclarations') && candidate.readinessDeclarations !== null) {
      throw new Error('TDD candidate cannot retain readiness declarations');
    }
  }

  if (candidate.phase === 'review-ready') {
    assertExactKeys(
      candidate.roastEvidence,
      ['candidateRevision', 'synthesisEvidence', 'objectiveGates', 'roles'],
      'candidate Roast evidence',
    );
    if (candidate.roastEvidence.candidateRevision !== candidate.revision) {
      throw new Error('candidate Roast evidence is not bound to the current candidate revision');
    }
    nonEmpty(candidate.roastEvidence.synthesisEvidence, 'candidate Roast synthesis evidence');
    assertExactKeys(candidate.roastEvidence.objectiveGates, OBJECTIVE_GATES, 'candidate objective gates');
    if (!objectiveGatesPassed(candidate.roastEvidence.objectiveGates)) {
      throw new Error('candidate Roast evidence must pass every objective gate');
    }
    if (JSON.stringify(candidate.roastEvidence.roles) !== JSON.stringify(ROAST_ROLES)) {
      throw new Error('candidate Roast evidence roles are invalid');
    }
  } else if (candidate.roastEvidence !== null) {
    throw new Error('only a review-ready candidate can retain Roast evidence');
  }
}

/**
 * Reject malformed strategy state before it crosses a durable Fleet State
 * boundary. This validates the candidate lifecycle and both directions of
 * every reservation-to-lease relationship.
 */
export function assertTddState(state) {
  assertExactKeys(
    state,
    ['schemaVersion', 'strategy', 'runId', 'controlRevision', 'publication', 'seats', 'reservations', 'candidate'],
    'TDD state',
  );
  if (state.schemaVersion !== 1) throw new Error('unsupported TDD state schemaVersion');
  if (state.strategy !== TDD_STRATEGY) throw new Error('TDD state strategy is invalid');
  nonEmpty(state.runId, 'TDD state runId');
  positiveInteger(state.controlRevision, 'TDD state controlRevision');
  assertExactKeys(state.publication, ['agent'], 'TDD state publication');
  nonEmpty(state.publication.agent, 'TDD state publication agent');
  assertCandidate(state.candidate);

  assertArray(state.seats, 'TDD state seats');
  if (state.seats.length !== DELIVERY_SEAT_COUNT) {
    throw new Error(`TDD state must contain exactly ${DELIVERY_SEAT_COUNT} delivery seats`);
  }
  const leases = [];
  for (const [index, seat] of state.seats.entries()) {
    assertExactKeys(seat, ['id', 'fence', 'lease'], 'TDD delivery seat');
    if (seat.id !== `delivery-${index + 1}`) throw new Error('TDD delivery seat ids are invalid');
    if (!Number.isSafeInteger(seat.fence) || seat.fence < 0) {
      throw new Error('TDD delivery seat fence is invalid');
    }
    if (seat.lease === null) continue;
    assertExactKeys(
      seat.lease,
      [
        'id',
        'seat',
        'role',
        'reservationId',
        'owner',
        'agent',
        'generation',
        'fence',
        'expiresAt',
        'runId',
        'candidateId',
        'candidateRevision',
      ],
      'TDD delivery lease',
    );
    const lease = seat.lease;
    nonEmpty(lease.id, 'TDD delivery lease id');
    if (lease.seat !== seat.id || lease.fence !== seat.fence || lease.fence < 1) {
      throw new Error('TDD delivery lease seat or fence is inconsistent');
    }
    if (!PAIR_ROLES.includes(lease.role) && !ROAST_ROLES.includes(lease.role)) {
      throw new Error('TDD delivery lease role is invalid');
    }
    nonEmpty(lease.reservationId, 'TDD delivery lease reservationId');
    nonEmpty(lease.owner, 'TDD delivery lease owner');
    nonEmpty(lease.agent, 'TDD delivery lease agent');
    positiveInteger(lease.generation, 'TDD delivery lease generation');
    validTime(lease.expiresAt, 'TDD delivery lease expiresAt');
    if (lease.runId !== state.runId
        || lease.candidateId !== state.candidate.id
        || lease.candidateRevision !== state.candidate.revision
        || lease.id !== `${lease.reservationId}:${lease.role}:${lease.fence}`) {
      throw new Error('TDD delivery lease binding is inconsistent');
    }
    leases.push(lease);
  }
  unique(leases.map((lease) => lease.id), 'TDD delivery lease ids');

  if (!state.reservations || typeof state.reservations !== 'object' || Array.isArray(state.reservations)) {
    throw new Error('TDD state reservations must be an object');
  }
  const reservations = Object.entries(state.reservations);
  for (const [reservationId, active] of reservations) {
    assertExactKeys(active, ['id', 'kind', 'roles', 'leaseIds', 'expiresAt'], 'TDD reservation');
    if (active.id !== reservationId) throw new Error('TDD reservation key does not match its id');
    nonEmpty(active.id, 'TDD reservation id');
    const roles = active.kind === 'pair' ? PAIR_ROLES : active.kind === 'roast' ? ROAST_ROLES : null;
    if (!roles) throw new Error('TDD reservation kind is invalid');
    if (JSON.stringify(active.roles) !== JSON.stringify(roles)) {
      throw new Error('TDD reservation roles are invalid');
    }
    assertArray(active.leaseIds, 'TDD reservation leaseIds');
    if (active.leaseIds.length !== roles.length) throw new Error('TDD reservation lease count is invalid');
    unique(active.leaseIds, 'TDD reservation lease ids');
    if (active.leaseIds.some((leaseId) => typeof leaseId !== 'string' || leaseId.trim() === '')) {
      throw new Error('TDD reservation lease ids must be non-empty strings');
    }
    validTime(active.expiresAt, 'TDD reservation expiresAt');
    const reservationLeases = leases.filter((lease) => lease.reservationId === reservationId);
    if (reservationLeases.length !== roles.length
        || JSON.stringify(reservationLeases.map((lease) => lease.role).sort()) !== JSON.stringify([...roles].sort())
        || JSON.stringify(reservationLeases.map((lease) => lease.id).sort()) !== JSON.stringify([...active.leaseIds].sort())
        || reservationLeases.some((lease) => lease.expiresAt !== active.expiresAt)) {
      throw new Error('TDD reservation leases are inconsistent');
    }
  }
  if (leases.some((lease) => !Object.hasOwn(state.reservations, lease.reservationId))) {
    throw new Error('TDD delivery lease refers to a missing reservation');
  }

  const pairReservation = state.candidate.pairReservationId === null
    ? null
    : state.reservations[state.candidate.pairReservationId];
  if (state.candidate.phase === 'tdd') {
    if (reservations.length > 1
        || (pairReservation !== null && pairReservation?.kind !== 'pair')
        || reservations.some(([, active]) => active.kind !== 'pair')) {
      throw new Error('TDD candidate has invalid active reservations');
    }
  } else if (state.candidate.pairReservationId !== null) {
    throw new Error('only a TDD candidate can retain a pair reservation');
  }
  if (state.candidate.phase === 'roast') {
    if (reservations.length !== 1 || reservations[0][1].kind !== 'roast') {
      throw new Error('Roast candidate requires exactly one active Roast reservation');
    }
  } else if (state.candidate.phase !== 'tdd' && reservations.length !== 0) {
    throw new Error('candidate phase cannot retain active reservations');
  }
  if ((state.candidate.pairReservationId === null && leases.some((lease) => lease.role === 'red' || lease.role === 'green'))
      || (state.candidate.pairReservationId !== null
        && leases.some((lease) => lease.reservationId !== state.candidate.pairReservationId))) {
    throw new Error('candidate pair reservation is inconsistent with active leases');
  }
  return state;
}

function nextControlRevision(state) {
  state.controlRevision += 1;
  return state;
}

function assertRoleAssignment(assignment, role) {
  if (!assignment || typeof assignment !== 'object') {
    throw new Error(`${role} assignment is required`);
  }
  return {
    owner: nonEmpty(assignment.owner, `${role}.owner`),
    agent: nonEmpty(assignment.agent, `${role}.agent`),
    generation: positiveInteger(assignment.generation, `${role}.generation`),
  };
}

function freeSeats(state) {
  return state.seats.filter((seat) => seat.lease === null);
}

function releaseReservation(state, reservationId, { advanceFence = false } = {}) {
  for (const seat of state.seats) {
    if (seat.lease?.reservationId === reservationId) {
      if (advanceFence) seat.fence += 1;
      seat.lease = null;
    }
  }
  delete state.reservations[reservationId];
}

function reservation(state, id, kind) {
  const value = state.reservations[id];
  if (!value || value.kind !== kind) {
    throw new Error(`active ${kind} reservation is required`);
  }
  return value;
}

function assertLease(state, lease, expectedRole, reservationKind, now) {
  validTime(now, 'now');
  if (!lease || typeof lease !== 'object') {
    throw new Error(`${expectedRole} lease is required`);
  }
  const current = state.seats.find((seat) => seat.id === lease.seat)?.lease;
  if (!current
      || current.id !== lease.id
      || current.role !== expectedRole
      || current.agent !== lease.agent
      || current.owner !== lease.owner
      || current.generation !== lease.generation
      || current.fence !== lease.fence
      || current.candidateRevision !== state.candidate.revision) {
    throw new Error(`${expectedRole} lease is stale, expired, or replaced`);
  }
  if (compareTime(current.expiresAt, now) <= 0) {
    throw new Error(`${expectedRole} lease is stale, expired, or replaced`);
  }
  reservation(state, current.reservationId, reservationKind);
  return current;
}

function assertLeaseSet(state, leases, roles, kind, now) {
  if (!leases || typeof leases !== 'object') {
    throw new Error(`${kind} lease set is required`);
  }
  const validated = roles.map((role) => assertLease(state, leases[role], role, kind, now));
  const reservationIds = validated.map((lease) => lease.reservationId);
  if (new Set(reservationIds).size !== 1) {
    throw new Error(`${kind} leases must belong to one reservation`);
  }
  return validated;
}

function bumpPairLeaseRevisions(state) {
  for (const seat of state.seats) {
    if (seat.lease?.reservationId === state.candidate.pairReservationId) {
      seat.lease.candidateRevision = state.candidate.revision;
    }
  }
}

function objectiveGatesPassed(gates) {
  return gates
    && typeof gates === 'object'
    && OBJECTIVE_GATES.every((gate) => gates[gate] === true);
}

function readinessDeclarations(declarations, pair, candidateRevision) {
  if (!exactKeys(declarations, PAIR_ROLES)) {
    throw new Error('readiness declarations must contain independent red and green declarations');
  }
  return Object.fromEntries(PAIR_ROLES.map((role) => {
    const declaration = declarations[role];
    const lease = pair.find((entry) => entry.role === role);
    if (!exactKeys(declaration, ['agent', 'candidateRevision', 'evidence'])
        || declaration.agent !== lease.agent
        || declaration.candidateRevision !== candidateRevision) {
      throw new Error(`${role} readiness declaration is not bound to the current lease and revision`);
    }
    return [role, {
      agent: declaration.agent,
      candidateRevision: declaration.candidateRevision,
      evidence: nonEmpty(declaration.evidence, `${role} readiness evidence`),
    }];
  }));
}

function tddTransitionState(state) {
  return {
    controlRevision: state.controlRevision,
    candidate: clone(state.candidate),
  };
}

function sharedLeaseBinding(lease) {
  return {
    lease: `tdd-${lease.seat}-${lease.fence}`,
    candidate: lease.candidateId,
    agent: lease.agent,
    fence: lease.fence,
  };
}

function proposalDetails(proposal) {
  const details = proposal?.payload?.value;
  if (!exactKeys(details, ['type', 'evidence', 'leases', 'payload'])
      || !TDD_TRANSITION_TYPES.has(details.type)
      || typeof details.evidence !== 'string'
      || details.evidence.trim() === ''
      || !details.leases
      || typeof details.leases !== 'object'
      || !details.payload
      || typeof details.payload !== 'object'
      || Array.isArray(details.payload)) {
    throw new Error('proposal does not contain valid TDD transition details');
  }
  return details;
}

export const TDD_STRATEGY = 'tdd-squadron';
export {
  DELIVERY_SEAT_COUNT,
  OBJECTIVE_GATES,
  PAIR_ROLES,
  ROAST_ROLES,
  SLOP_SNIPER_EVENTS,
  TDD_TRANSITION_TYPES,
};

export function createTddState({
  runId,
  candidateId,
  publicationAgent,
  controlRevision = 1,
} = {}) {
  nonEmpty(runId, 'runId');
  nonEmpty(candidateId, 'candidateId');
  nonEmpty(publicationAgent, 'publicationAgent');
  positiveInteger(controlRevision, 'controlRevision');
  return {
    schemaVersion: 1,
    strategy: TDD_STRATEGY,
    runId,
    controlRevision,
    publication: {
      agent: publicationAgent,
    },
    seats: Array.from({ length: DELIVERY_SEAT_COUNT }, (_, index) => ({
      id: `delivery-${index + 1}`,
      fence: 0,
      lease: null,
    })),
    reservations: {},
    candidate: {
      id: candidateId,
      revision: 1,
      phase: 'tdd',
      nextRole: 'red',
      slices: [],
      pairReservationId: null,
      frozenRevision: null,
      roastEvidence: null,
      recommendations: [],
      invalidatedRoastRevisions: [],
    },
  };
}

export function reserveTddPair(state, {
  reservationId,
  red,
  green,
  expiresAt,
  now,
} = {}) {
  const next = clone(state);
  if (next.candidate.phase !== 'tdd' || next.candidate.pairReservationId) {
    throw new Error('a TDD pair can be reserved only for an unreserved TDD candidate');
  }
  nonEmpty(reservationId, 'reservationId');
  validTime(expiresAt, 'expiresAt');
  validTime(now, 'now');
  if (compareTime(expiresAt, now) <= 0) {
    throw new Error('TDD pair reservation expiry must be after trusted now');
  }
  const assignments = {
    red: assertRoleAssignment(red, 'red'),
    green: assertRoleAssignment(green, 'green'),
  };
  unique(
    PAIR_ROLES.flatMap((role) => [assignments[role].owner, assignments[role].agent]),
    'pair owners and agents',
  );
  if (next.reservations[reservationId] || freeSeats(next).length < PAIR_ROLES.length) {
    throw new Error('TDD pair reservation cannot be allocated atomically');
  }
  const seats = freeSeats(next).slice(0, PAIR_ROLES.length);
  const leases = {};
  for (const [index, role] of PAIR_ROLES.entries()) {
    const seat = seats[index];
    const assignment = assignments[role];
    seat.fence += 1;
    const lease = {
      id: `${reservationId}:${role}:${seat.fence}`,
      seat: seat.id,
      role,
      reservationId,
      owner: assignment.owner,
      agent: assignment.agent,
      generation: assignment.generation,
      fence: seat.fence,
      expiresAt,
      runId: next.runId,
      candidateId: next.candidate.id,
      candidateRevision: next.candidate.revision,
    };
    seat.lease = lease;
    leases[role] = clone(lease);
  }
  next.reservations[reservationId] = {
    id: reservationId,
    kind: 'pair',
    roles: [...PAIR_ROLES],
    leaseIds: Object.values(leases).map((lease) => lease.id),
    expiresAt,
  };
  next.candidate.pairReservationId = reservationId;
  return { state: nextControlRevision(next), leases };
}

export function recordVerticalSlice(state, {
  lease,
  sliceId,
  evidence,
  now,
} = {}) {
  const next = clone(state);
  if (next.candidate.phase !== 'tdd') {
    throw new Error('vertical slices require the TDD phase');
  }
  nonEmpty(sliceId, 'sliceId');
  nonEmpty(evidence, 'evidence');
  const role = next.candidate.nextRole;
  assertLease(next, lease, role, 'pair', now);
  next.candidate.slices.push({
    id: sliceId,
    role,
    revision: next.candidate.revision,
    evidence,
  });
  next.candidate.revision += 1;
  next.candidate.nextRole = role === 'red' ? 'green' : 'red';
  bumpPairLeaseRevisions(next);
  return nextControlRevision(next);
}

export function freezeReadyCandidate(state, {
  leases,
  readinessDeclarations: declarations,
  now,
} = {}) {
  const next = clone(state);
  if (next.candidate.phase !== 'tdd' || next.candidate.slices.length === 0) {
    throw new Error('only a sliced TDD candidate can be frozen');
  }
  const pair = assertLeaseSet(next, leases, PAIR_ROLES, 'pair', now);
  const ready = readinessDeclarations(declarations, pair, next.candidate.revision);
  if (pair.some((lease) => lease.reservationId !== next.candidate.pairReservationId)) {
    throw new Error('both leases must belong to the active TDD pair');
  }
  const releasedReservationId = next.candidate.pairReservationId;
  next.candidate.phase = 'frozen';
  next.candidate.frozenRevision = next.candidate.revision;
  next.candidate.pairReservationId = null;
  next.candidate.readinessDeclarations = ready;
  releaseReservation(next, releasedReservationId);
  return nextControlRevision(next);
}

export function reserveRoastTeam(state, {
  reservationId,
  roles,
  expiresAt,
  now,
} = {}) {
  const next = clone(state);
  if (next.candidate.phase !== 'frozen' || next.candidate.pairReservationId !== null) {
    throw new Error('Roast requires a frozen candidate after pair release');
  }
  nonEmpty(reservationId, 'reservationId');
  validTime(expiresAt, 'expiresAt');
  validTime(now, 'now');
  if (compareTime(expiresAt, now) <= 0) {
    throw new Error('Roast reservation expiry must be after trusted now');
  }
  if (!roles || typeof roles !== 'object') {
    throw new Error('Roast role assignments are required');
  }
  const assignments = Object.fromEntries(
    ROAST_ROLES.map((role) => [role, assertRoleAssignment(roles[role], role)]),
  );
  unique(
    ROAST_ROLES.flatMap((role) => [assignments[role].owner, assignments[role].agent]),
    'Roast owners and agents',
  );
  if (next.reservations[reservationId] || freeSeats(next).length < ROAST_ROLES.length) {
    throw new Error('Roast reservation cannot be allocated atomically');
  }
  const seats = freeSeats(next).slice(0, ROAST_ROLES.length);
  const leases = {};
  for (const [index, role] of ROAST_ROLES.entries()) {
    const seat = seats[index];
    const assignment = assignments[role];
    seat.fence += 1;
    const lease = {
      id: `${reservationId}:${role}:${seat.fence}`,
      seat: seat.id,
      role,
      reservationId,
      owner: assignment.owner,
      agent: assignment.agent,
      generation: assignment.generation,
      fence: seat.fence,
      expiresAt,
      runId: next.runId,
      candidateId: next.candidate.id,
      candidateRevision: next.candidate.revision,
    };
    seat.lease = lease;
    leases[role] = clone(lease);
  }
  next.reservations[reservationId] = {
    id: reservationId,
    kind: 'roast',
    roles: [...ROAST_ROLES],
    leaseIds: Object.values(leases).map((lease) => lease.id),
    expiresAt,
  };
  next.candidate.phase = 'roast';
  return { state: nextControlRevision(next), leases };
}

export function recordRoastApproval(state, {
  leases,
  synthesisEvidence,
  objectiveGates,
  now,
} = {}) {
  const next = clone(state);
  if (next.candidate.phase !== 'roast') {
    throw new Error('Roast approval requires the Roast phase');
  }
  nonEmpty(synthesisEvidence, 'synthesisEvidence');
  if (!objectiveGatesPassed(objectiveGates)) {
    throw new Error('review readiness requires every objective gate');
  }
  const current = assertLeaseSet(next, leases, ROAST_ROLES, 'roast', now);
  const reservationId = current[0].reservationId;
  next.candidate.roastEvidence = {
    candidateRevision: next.candidate.revision,
    synthesisEvidence,
    objectiveGates: clone(objectiveGates),
    roles: [...ROAST_ROLES],
  };
  next.candidate.phase = 'review-ready';
  releaseReservation(next, reservationId);
  return nextControlRevision(next);
}

export function returnRecommendationsToPair(state, {
  leases,
  recommendations,
  now,
} = {}) {
  const next = clone(state);
  if (next.candidate.phase !== 'roast') {
    throw new Error('recommendations can return only from an active Roast');
  }
  if (!Array.isArray(recommendations) || recommendations.length === 0
      || recommendations.some((recommendation) => typeof recommendation !== 'string' || !recommendation.trim())) {
    throw new Error('Roast recommendations must be a non-empty string list');
  }
  const current = assertLeaseSet(next, leases, ROAST_ROLES, 'roast', now);
  releaseReservation(next, current[0].reservationId);
  next.candidate.phase = 'tdd';
  next.candidate.nextRole = 'red';
  next.candidate.frozenRevision = null;
  next.candidate.readinessDeclarations = null;
  next.candidate.recommendations = clone(recommendations);
  return nextControlRevision(next);
}

export function mutateCandidate(state, { expectedRevision, mutationEvidence } = {}) {
  const next = clone(state);
  positiveInteger(expectedRevision, 'expectedRevision');
  nonEmpty(mutationEvidence, 'mutationEvidence');
  if (next.candidate.phase !== 'review-ready' || expectedRevision !== next.candidate.revision) {
    throw new Error('only the current review-ready candidate can be mutated');
  }
  next.candidate.invalidatedRoastRevisions.push(next.candidate.roastEvidence.candidateRevision);
  next.candidate.roastEvidence = null;
  next.candidate.frozenRevision = null;
  next.candidate.readinessDeclarations = null;
  next.candidate.phase = 'tdd';
  next.candidate.nextRole = 'red';
  next.candidate.revision += 1;
  next.candidate.mutationEvidence = mutationEvidence;
  return nextControlRevision(next);
}

export function reclaimExpiredReservations(state, { now } = {}) {
  const next = clone(state);
  validTime(now, 'now');
  const expired = Object.values(next.reservations)
    .filter((active) => compareTime(active.expiresAt, now) <= 0)
    .map((active) => active.id);
  for (const id of expired) {
    const active = next.reservations[id];
    if (active.kind === 'pair') {
      next.candidate.pairReservationId = null;
      next.candidate.phase = 'tdd';
    } else if (active.kind === 'roast') {
      next.candidate.phase = 'tdd';
      next.candidate.nextRole = 'red';
      next.candidate.frozenRevision = null;
      next.candidate.readinessDeclarations = null;
    }
    releaseReservation(next, id, { advanceFence: true });
  }
  return expired.length ? nextControlRevision(next) : next;
}

export function publicationAuthorization(state, { actor } = {}) {
  const publicationAgent = state?.publication?.agent;
  if (typeof publicationAgent !== 'string' || publicationAgent.trim() === '') {
    return { authorized: false, reason: 'publication-agent-not-configured' };
  }
  if (!actor || actor.id !== publicationAgent) {
    return { authorized: false, reason: 'only-publication-agent' };
  }
  const evidence = state.candidate.roastEvidence;
  if (state.candidate.phase !== 'review-ready'
      || !evidence
      || evidence.candidateRevision !== state.candidate.revision
      || !objectiveGatesPassed(evidence.objectiveGates)) {
    return { authorized: false, reason: 'candidate-not-review-ready' };
  }
  return {
    authorized: true,
    candidateId: state.candidate.id,
    candidateRevision: state.candidate.revision,
  };
}

export function requestSlopSniperAudit(state, { event, snapshotId } = {}) {
  if (!SLOP_SNIPER_EVENTS.has(event)) {
    throw new Error('event is not a declared Slop Sniper checkpoint');
  }
  nonEmpty(snapshotId, 'snapshotId');
  return {
    strategy: TDD_STRATEGY,
    advisory: true,
    event,
    snapshotId,
    runId: state.runId,
    controlRevision: state.controlRevision,
    candidateId: state.candidate.id,
    candidateRevision: state.candidate.revision,
  };
}

export function canConsumeSlopSniperAdvice(state, audit) {
  const current = audit
    && audit.strategy === TDD_STRATEGY
    && audit.advisory === true
    && audit.runId === state.runId
    && audit.controlRevision === state.controlRevision
    && audit.candidateId === state.candidate.id
    && audit.candidateRevision === state.candidate.revision;
  return current
    ? { consumable: true, reason: 'current-advisory-at-safe-transition' }
    : { consumable: false, reason: 'stale-or-invalid-snapshot' };
}

export function createTddTransitionProposal(state, {
  type,
  actor,
  leases = {},
  evidence,
  payload = {},
  now,
} = {}) {
  if (!TDD_TRANSITION_TYPES.has(type)) {
    throw new Error('proposal type is not a TDD transition');
  }
  nonEmpty(actor, 'actor');
  nonEmpty(evidence, 'evidence');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('proposal payload must be an object');
  }
  validTime(now, 'now');
  const expectedRoles = type === 'vertical-slice'
    ? [state.candidate.nextRole]
    : type === 'freeze-ready-candidate'
      ? PAIR_ROLES
      : ROAST_ROLES;
  const kind = ['vertical-slice', 'freeze-ready-candidate'].includes(type) ? 'pair' : 'roast';
  const current = expectedRoles.map((role) => assertLease(state, leases[role], role, kind, now));
  const actorLease = current.find((lease) => lease.agent === actor);
  if (!actorLease) {
    throw new Error('proposal actor does not hold a bound lease');
  }
  const primary = sharedLeaseBinding(actorLease);
  const proposal = {
    schemaVersion: 1,
    strategy: TDD_STRATEGY,
    binding: {
      expectedStateRevision: state.controlRevision,
      run: state.runId,
      candidate: state.candidate.id,
      lease: primary.lease,
      agent: actor,
      fence: primary.fence,
    },
    reservation: {
      leases: [primary],
    },
    transition: {
      from: { namespace: TDD_STRATEGY, value: tddTransitionState(state) },
      to: { namespace: TDD_STRATEGY, value: { type } },
    },
    payload: {
      namespace: TDD_STRATEGY,
      value: {
        type,
        evidence,
        leases: clone(leases),
        payload: clone(payload),
      },
    },
    forbiddenAuthorities: [...FORBIDDEN_AUTHORITIES],
  };
  validateTddTransitionProposal(state, proposal, { now });
  return proposal;
}

export function validateTddTransitionProposal(state, proposal, { now } = {}) {
  validTime(now, 'now');
  const shared = validateStrategyTransitionProposal(proposal);
  if (!shared.valid || shared.proposal.strategy !== TDD_STRATEGY) {
    throw new Error(`proposal violates the shared atomic transition contract: ${shared.defects.join('; ')}`);
  }
  const normalized = shared.proposal;
  if (normalized.binding.expectedStateRevision !== state.controlRevision) {
    throw new Error('proposal control revision is stale');
  }
  const details = proposalDetails(normalized);
  const binding = normalized.binding;
  if (binding.run !== state.runId || binding.candidate !== state.candidate.id) {
    throw new Error('proposal binding does not match current fleet state');
  }
  if (JSON.stringify(normalized.transition.from.value) !== JSON.stringify(tddTransitionState(state))) {
    throw new Error('proposal transition source does not match current TDD state');
  }
  const expectedRoles = details.type === 'vertical-slice'
    ? [state.candidate.nextRole]
    : details.type === 'freeze-ready-candidate'
      ? PAIR_ROLES
      : ROAST_ROLES;
  const kind = ['vertical-slice', 'freeze-ready-candidate'].includes(details.type) ? 'pair' : 'roast';
  const current = expectedRoles.map((role) => assertLease(
    state,
    details.leases[role],
    role,
    kind,
    now,
  ));
  const actorLease = current.find((lease) => lease.agent === binding.agent);
  if (!actorLease) {
    throw new Error('proposal actor does not hold a bound lease');
  }
  const primary = sharedLeaseBinding(actorLease);
  if (JSON.stringify(binding) !== JSON.stringify({
    expectedStateRevision: state.controlRevision,
    run: state.runId,
    candidate: state.candidate.id,
    lease: primary.lease,
    agent: actorLease.agent,
    fence: primary.fence,
  }) || JSON.stringify(normalized.reservation.leases) !== JSON.stringify([primary])) {
    throw new Error('proposal shared lease binding does not match its TDD actor lease');
  }
  return clone(normalized);
}
