import crypto from 'node:crypto';

import { assertCurrentFleetState } from '../fleet-state/fleet-state.mjs';

export const BENCH_EPOCH_SCHEMA_VERSION = 2;
export const MAX_DELIVERY_POOL_AGENTS = 5;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validIdentifier(value, label) {
  if (!nonEmptyString(value) || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    throw new Error(`${label} must be a non-empty identifier`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function expiry(value, label) {
  if (!nonEmptyString(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function assertDistinctIdentifiers(values, label) {
  if (!Array.isArray(values) || !values.length || !values.every(nonEmptyString)) {
    throw new Error(`${label} must contain one or more identifiers`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must contain distinct identifiers`);
  }
}

function normalizeConfiguration(input) {
  if (!isRecord(input)) throw new Error('bench configuration must be an object');
  const deliveryPool = input.deliveryPool;
  assertDistinctIdentifiers(deliveryPool, 'deliveryPool');
  if (deliveryPool.length > MAX_DELIVERY_POOL_AGENTS) {
    throw new Error(`deliveryPool exceeds the ${MAX_DELIVERY_POOL_AGENTS}-agent cap`);
  }
  deliveryPool.forEach((agent) => validIdentifier(agent, 'deliveryPool agent'));

  if (!Number.isInteger(input.quorum) || input.quorum < 1 || input.quorum > deliveryPool.length) {
    throw new Error('quorum must satisfy 1 <= quorum <= deliveryPool.length');
  }

  const orchestrator = validIdentifier(input.orchestrator, 'orchestrator');
  const slopSniper = validIdentifier(input.slopSniper, 'slopSniper');
  if (orchestrator === slopSniper
      || deliveryPool.includes(orchestrator)
      || deliveryPool.includes(slopSniper)) {
    throw new Error('orchestrator, slopSniper, and deliveryPool roles must be separate');
  }
  return {
    deliveryPool: [...deliveryPool],
    quorum: input.quorum,
    orchestrator,
    slopSniper,
  };
}

function normalizeReservation(input) {
  if (input === undefined) return { leases: [] };
  if (!isRecord(input) || !Array.isArray(input.leases)) {
    throw new Error('bench reservation must contain a leases array');
  }
  const leases = input.leases.map((lease, index) => {
    if (!isRecord(lease)
        || Object.keys(lease).length !== 5
        || !['lease', 'candidate', 'agent', 'fence', 'expiry'].every(
          (key) => Object.hasOwn(lease, key),
        )) {
      throw new Error(`bench reservation lease ${index} has an invalid envelope`);
    }
    return {
      lease: validIdentifier(lease.lease, 'bench reservation lease'),
      candidate: validIdentifier(lease.candidate, 'bench reservation candidate'),
      agent: validIdentifier(lease.agent, 'bench reservation agent'),
      fence: positiveSafeInteger(lease.fence, 'bench reservation fence'),
      expiry: expiry(lease.expiry, 'bench reservation expiry'),
    };
  });
  if (new Set(leases.map((lease) => lease.lease)).size !== leases.length) {
    throw new Error('bench reservation leases must be unique');
  }
  return { leases };
}

export function createBenchEpoch(configuration) {
  const normalized = normalizeConfiguration(configuration);
  return {
    schemaVersion: BENCH_EPOCH_SCHEMA_VERSION,
    epoch: 0,
    ...normalized,
    reservation: normalizeReservation(configuration.reservation),
    signatures: [],
    downstreamClaims: [],
    acceptedProposals: [],
  };
}

export function assertBenchEpoch(state) {
  if (!isRecord(state) || state.schemaVersion !== BENCH_EPOCH_SCHEMA_VERSION) {
    throw new Error('bench epoch schema version is invalid');
  }
  nonNegativeInteger(state.epoch, 'epoch');
  const configuration = normalizeConfiguration(state);
  const reservation = normalizeReservation(state.reservation);
  if (!Array.isArray(state.signatures) || state.signatures.length) {
    throw new Error('persisted signatures must be empty between proposals');
  }
  if (!Array.isArray(state.downstreamClaims) || !Array.isArray(state.acceptedProposals)) {
    throw new Error('bench epoch collections are invalid');
  }
  const claimIds = new Set();
  for (const claim of state.downstreamClaims) {
    if (!isRecord(claim)
        || validIdentifier(claim.id, 'downstream claim id') !== claim.id
        || claim.epoch !== state.epoch
        || !nonEmptyString(claim.subject)
        || claimIds.has(claim.id)) {
      throw new Error('downstream claims must be unique and bound to the current epoch');
    }
    claimIds.add(claim.id);
  }
  const proposalIds = new Set();
  for (const proposal of state.acceptedProposals) {
    if (!isRecord(proposal)
        || validIdentifier(proposal.id, 'accepted proposal id') !== proposal.id
        || !Number.isInteger(proposal.acceptedAtEpoch)
        || proposal.acceptedAtEpoch < 0
        || proposal.acceptedAtEpoch >= state.epoch
        || proposalIds.has(proposal.id)) {
      throw new Error('accepted proposals must be unique historical epoch records');
    }
    proposalIds.add(proposal.id);
  }
  return { ...configuration, reservation };
}

function normalizeSignature(signature, state, proposal) {
  if (!isRecord(signature)) throw new Error('proposal signature must be an object');
  const agentId = validIdentifier(signature.agentId, 'signature agentId');
  if (!state.deliveryPool.includes(agentId)) {
    throw new Error('proposal signature agent is not in deliveryPool');
  }
  if (signature.epoch !== state.epoch) {
    throw new Error('proposal signatures must bind the exact current epoch');
  }
  const turnId = validIdentifier(signature.turnId, 'signature turnId');
  const value = validIdentifier(signature.value, 'signature value');
  if (agentId === proposal.mutatorId && turnId === proposal.turnId) {
    throw new Error('a mutator cannot sign a proposal in the same turn');
  }
  return { agentId, epoch: signature.epoch, turnId, value };
}

export function validateProposal(state, proposal) {
  assertBenchEpoch(state);
  if (!isRecord(proposal)) throw new Error('proposal must be an object');
  const id = validIdentifier(proposal.id, 'proposal id');
  if (state.acceptedProposals.some((entry) => entry.id === id)) {
    throw new Error('proposal id was already accepted');
  }
  if (proposal.epoch !== state.epoch) {
    throw new Error('proposal must bind the exact current epoch');
  }
  const mutatorId = validIdentifier(proposal.mutatorId, 'proposal mutatorId');
  if (![state.orchestrator, ...state.deliveryPool].includes(mutatorId)
      || mutatorId === state.slopSniper) {
    throw new Error('proposal mutator must be the orchestrator or a delivery-pool agent');
  }
  const turnId = validIdentifier(proposal.turnId, 'proposal turnId');
  nonNegativeInteger(proposal.fleetStateRevision, 'proposal fleetStateRevision');
  if (!isRecord(proposal.mutation) || !Object.keys(proposal.mutation).length) {
    throw new Error('proposal mutation must be a non-empty object');
  }
  if (!Array.isArray(proposal.signatures) || proposal.signatures.length < state.quorum) {
    throw new Error('proposal lacks the configured quorum');
  }
  const signatures = proposal.signatures.map((signature) => normalizeSignature(
    signature,
    state,
    { mutatorId, turnId },
  ));
  if (new Set(signatures.map((signature) => signature.agentId)).size !== signatures.length) {
    throw new Error('proposal signatures must be from distinct delivery-pool agents');
  }
  if (new Set(signatures.map((signature) => signature.value)).size !== signatures.length) {
    throw new Error('proposal signature values must be distinct');
  }
  return {
    id,
    epoch: state.epoch,
    fleetStateRevision: proposal.fleetStateRevision,
    mutatorId,
    turnId,
    mutation: structuredClone(proposal.mutation),
    signatures,
    digest: digest({
      id,
      epoch: state.epoch,
      fleetStateRevision: proposal.fleetStateRevision,
      mutatorId,
      turnId,
      mutation: proposal.mutation,
      signatures,
    }),
  };
}

export function validateProposalForFleetState(state, fleetState, manifest, proposal) {
  assertCurrentFleetState(fleetState, manifest);
  const validated = validateProposal(state, proposal);
  if (validated.fleetStateRevision !== fleetState.revision) {
    throw new Error('proposal fleetStateRevision does not match current Fleet State');
  }
  return validated;
}

export function addDownstreamClaim(state, claim) {
  assertBenchEpoch(state);
  if (!isRecord(claim)) throw new Error('downstream claim must be an object');
  const id = validIdentifier(claim.id, 'downstream claim id');
  if (claim.epoch !== state.epoch) {
    throw new Error('downstream claim must bind the exact current epoch');
  }
  if (!nonEmptyString(claim.subject)) throw new Error('downstream claim subject must be non-empty');
  if (state.downstreamClaims.some((entry) => entry.id === id)) {
    throw new Error('downstream claim id already exists');
  }
  return {
    ...structuredClone(state),
    downstreamClaims: [
      ...structuredClone(state.downstreamClaims),
      { id, epoch: state.epoch, subject: claim.subject },
    ],
  };
}

export function applyValidatedProposal(state, validatedProposal) {
  assertBenchEpoch(state);
  if (!isRecord(validatedProposal)) throw new Error('validated proposal must be an object');
  if (validatedProposal.epoch !== state.epoch) {
    throw new Error('validated proposal is stale for the current epoch');
  }
  const revalidated = validateProposal(state, validatedProposal);
  const next = structuredClone(state);
  next.epoch += 1;
  next.signatures = [];
  next.downstreamClaims = [];
  next.acceptedProposals.push({
    id: revalidated.id,
    digest: revalidated.digest,
    fleetStateRevision: revalidated.fleetStateRevision,
    acceptedAtEpoch: state.epoch,
  });
  assertBenchEpoch(next);
  return next;
}

export function applyProposalToFleetState(state, fleetState, manifest, proposal) {
  const validatedProposal = validateProposalForFleetState(state, fleetState, manifest, proposal);
  return {
    fleetStateRevision: fleetState.revision,
    validatedProposal,
    nextBenchEpoch: applyValidatedProposal(state, validatedProposal),
  };
}
