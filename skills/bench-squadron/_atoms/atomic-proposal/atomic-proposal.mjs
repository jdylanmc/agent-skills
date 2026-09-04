import {
  ATOMIC_TRANSITION_SCHEMA_VERSION,
  FORBIDDEN_AUTHORITIES,
  applyFleetStateTransition,
  validateStrategyTransitionProposal,
} from '../../../_base/_atoms/atomic-transition/atomic-transition.mjs';

import {
  applyValidatedProposal,
  assertBenchEpoch,
  validateProposalForFleetState,
} from '../bench-epoch/bench-epoch.mjs';
import { assertCurrentFleetState } from '../fleet-state/fleet-state.mjs';

export const BENCH_ATOMIC_STRATEGY = 'bench-squadron/v1';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveFence(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('atomic fence must be a positive safe integer');
  }
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  return Date.parse(value);
}

function currentTime(value) {
  if (value === undefined) return Date.now();
  return timestamp(value, 'atomic current time');
}

function identifier(value, label) {
  if (typeof value !== 'string'
      || !/^[a-z][a-z0-9]*(?:[a-z0-9._-]*[a-z0-9])?$/u.test(value)) {
    throw new Error(`${label} must be a shared-contract identifier`);
  }
  return value;
}

function epochState(benchState, fleetState) {
  return {
    benchEpoch: benchState.epoch,
    fleetStateRevision: fleetState.revision,
  };
}

function benchEpochFromFleetState(fleetState) {
  const strategyState = fleetState.strategyState;
  if (!isRecord(strategyState)
      || strategyState.namespace !== BENCH_ATOMIC_STRATEGY) {
    throw new Error('Fleet State must carry the current Bench strategy state');
  }
  assertBenchEpoch(strategyState.value);
  return structuredClone(strategyState.value);
}

function withBenchEpoch(fleetState, benchState) {
  return {
    ...fleetState,
    strategyState: {
      namespace: BENCH_ATOMIC_STRATEGY,
      value: structuredClone(benchState),
    },
  };
}

function assertAtomicBinding(input, benchState, validatedBenchProposal, fleetState, now) {
  if (!isRecord(input)) throw new Error('atomic binding must be an object');
  const candidate = identifier(input.candidate, 'atomic candidate');
  const lease = identifier(input.lease, 'atomic lease');
  const fence = positiveFence(input.fence);
  const authoritative = benchState.reservation.leases.find((entry) => entry.lease === lease);
  if (!authoritative) {
    throw new Error('atomic lease is not reserved by the current Bench state');
  }
  if (Date.parse(authoritative.expiry) <= now) {
    throw new Error('atomic lease is expired in the current Bench state');
  }
  const agent = authoritative.agent;
  if (authoritative.candidate !== candidate
      || authoritative.agent !== validatedBenchProposal.mutatorId
      || authoritative.fence !== fence) {
    throw new Error('atomic lease binding is no longer current in the Bench state');
  }
  return {
    run: identifier(fleetState.runId, 'Fleet State run'),
    candidate: authoritative.candidate,
    lease: authoritative.lease,
    agent: authoritative.agent,
    fence: authoritative.fence,
  };
}

function lockedReservation(benchState, normalizedProposal, now) {
  const binding = normalizedProposal.binding;
  const primary = benchState.reservation.leases.find((entry) => entry.lease === binding.lease);
  if (!primary) {
    throw new Error('atomic lease is not reserved by the current Bench state');
  }
  if (Date.parse(primary.expiry) <= now) {
    throw new Error('atomic lease is expired in the current Bench state');
  }
  if (primary.candidate !== binding.candidate
      || primary.agent !== binding.agent
      || primary.fence !== binding.fence) {
    throw new Error('atomic lease binding is no longer current in the Bench state');
  }
  return benchState.reservation.leases.map(({ lease, candidate, agent, fence }) => ({
    lease,
    candidate,
    agent,
    fence,
  }));
}

function assertNormalizedAtomicProposal(value) {
  const validated = validateStrategyTransitionProposal(value);
  if (!validated.valid) {
    throw new Error(`Bench Atomic proposal is invalid: ${validated.defects.join('; ')}`);
  }
  return validated.proposal;
}

/**
 * Builds one generic Atomic Transition proposal from a Bench proposal whose
 * quorum and Fleet State revision have already been validated.
 */
export function createBenchAtomicTransition(input) {
  if (!isRecord(input)) throw new Error('Bench Atomic transition input must be an object');
  const {
    fleetState,
    manifest,
    proposal,
    binding: inputBinding,
  } = input;
  const now = currentTime(input.now);
  assertCurrentFleetState(fleetState, manifest);
  const benchState = benchEpochFromFleetState(fleetState);
  const validatedBenchProposal = validateProposalForFleetState(
    benchState,
    fleetState,
    manifest,
    proposal,
  );
  const binding = assertAtomicBinding(
    inputBinding,
    benchState,
    validatedBenchProposal,
    fleetState,
    now,
  );
  const from = {
    namespace: BENCH_ATOMIC_STRATEGY,
    value: epochState(benchState, fleetState),
  };
  const sharedProposal = assertNormalizedAtomicProposal({
    schemaVersion: ATOMIC_TRANSITION_SCHEMA_VERSION,
    strategy: BENCH_ATOMIC_STRATEGY,
    binding: {
      expectedStateRevision: fleetState.revision,
      ...binding,
    },
    reservation: {
      leases: [{
        lease: binding.lease,
        candidate: binding.candidate,
        agent: binding.agent,
        fence: binding.fence,
      }],
    },
    transition: {
      from,
      to: {
        namespace: BENCH_ATOMIC_STRATEGY,
        value: {
          benchEpoch: benchState.epoch + 1,
          fleetStateRevision: fleetState.revision + 1,
        },
      },
    },
    payload: {
      namespace: BENCH_ATOMIC_STRATEGY,
      value: {
        proposalDigest: validatedBenchProposal.digest,
        mutation: validatedBenchProposal.mutation,
      },
    },
    forbiddenAuthorities: [...FORBIDDEN_AUTHORITIES],
  });

  return {
    validatedBenchProposal,
    proposal: sharedProposal,
    current: createBenchAtomicCurrent({
      fleetState,
      manifest,
      proposal: sharedProposal,
      now: input.now,
    }),
  };
}

/**
 * Projects the current Bench and Fleet State into the shared atom's opaque
 * currentness shape. Reservation authority is read exclusively from the
 * persisted Bench state that is locked by the Fleet State transition.
 */
export function createBenchAtomicCurrent(input) {
  if (!isRecord(input)) throw new Error('Bench Atomic current input must be an object');
  const { fleetState, manifest, proposal } = input;
  const now = currentTime(input.now);
  assertCurrentFleetState(fleetState, manifest);
  const benchState = benchEpochFromFleetState(fleetState);
  const normalized = assertNormalizedAtomicProposal(proposal);
  if (normalized.strategy !== BENCH_ATOMIC_STRATEGY) {
    throw new Error('Atomic proposal does not belong to Bench Squadron');
  }
  if (normalized.binding.run !== fleetState.runId) {
    throw new Error('Atomic proposal run does not match current Fleet State');
  }
  const leases = lockedReservation(benchState, normalized, now);
  const primary = leases.find((lease) => lease.lease === normalized.binding.lease);
  return {
    stateRevision: fleetState.revision,
    run: fleetState.runId,
    candidate: primary.candidate,
    agent: primary.agent,
    fence: primary.fence,
    leases,
    state: {
      namespace: BENCH_ATOMIC_STRATEGY,
      value: epochState(benchState, fleetState),
    },
  };
}

/**
 * Delegates one accepted Bench proposal to the shared Fleet State CAS path.
 * Bench state advances only after the compatible Fleet State transition wins.
 */
export function applyBenchAtomicFleetStateTransition(input) {
  if (!isRecord(input)) throw new Error('Bench Atomic transition input must be an object');
  if (typeof input.transition !== 'function') {
    throw new Error('Bench Atomic transition requires a Fleet State transition callback');
  }
  const built = createBenchAtomicTransition(input);
  const fleetState = applyFleetStateTransition({
    file: input.file,
    manifest: input.manifest,
    proposal: built.proposal,
    readCurrent: (lockedFleetState) => createBenchAtomicCurrent({
      fleetState: lockedFleetState,
      manifest: input.manifest,
      proposal: built.proposal,
      now: input.now,
    }),
    transition: (lockedFleetState, sharedProposal) => {
      const lockedBenchState = benchEpochFromFleetState(lockedFleetState);
      const validatedBenchProposal = validateProposalForFleetState(
        lockedBenchState,
        lockedFleetState,
        input.manifest,
        input.proposal,
      );
      const nextBenchEpoch = applyValidatedProposal(lockedBenchState, validatedBenchProposal);
      const transitionedFleetState = input.transition(
        structuredClone(lockedFleetState),
        structuredClone(validatedBenchProposal),
        structuredClone(sharedProposal),
      );
      if (!isRecord(transitionedFleetState)) {
        throw new Error('Bench Atomic Fleet State transition must return an object');
      }
      return withBenchEpoch(transitionedFleetState, nextBenchEpoch);
    },
    options: input.options,
  });
  return {
    fleetState,
    nextBenchEpoch: benchEpochFromFleetState(fleetState),
    proposal: built.proposal,
  };
}
