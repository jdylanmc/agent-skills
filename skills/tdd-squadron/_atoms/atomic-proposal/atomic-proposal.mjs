import {
  applyFleetStateTransition,
  validateStrategyTransitionProposal,
} from '../../../_base/_atoms/atomic-transition/atomic-transition.mjs';
import { assertFleetState } from '../../../ship-with-squadron/_atoms/fleet-state/fleet-state.mjs';
import {
  TDD_STRATEGY,
  assertTddState,
  validateTddTransitionProposal,
} from '../tdd-lifecycle/tdd-lifecycle.mjs';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function tddStateFromFleetState(state) {
  const strategyState = state.strategyState;
  if (!isRecord(strategyState) || strategyState.namespace !== TDD_STRATEGY || !isRecord(strategyState.value)) {
    throw new Error('Fleet State must carry the current TDD strategy state');
  }
  return structuredClone(assertTddState(strategyState.value));
}

function trustedClock(clock) {
  if (clock === undefined) return () => new Date().toISOString();
  if (typeof clock !== 'function') {
    throw new Error('TDD Atomic transition clock must be a function');
  }
  return clock;
}

function trustedNow(clock) {
  const now = clock();
  if (typeof now !== 'string') {
    throw new Error('TDD Atomic transition clock must return an ISO timestamp');
  }
  return now;
}

function tddProjection(tddState) {
  return {
    controlRevision: tddState.controlRevision,
    candidate: structuredClone(tddState.candidate),
  };
}

function assertFleetBoundTddProposal(fleetState, proposal, now) {
  const tddState = tddStateFromFleetState(fleetState);
  const validated = validateTddTransitionProposal(tddState, proposal, { now });
  if (tddState.runId !== fleetState.runId || validated.binding.run !== fleetState.runId) {
    throw new Error('TDD proposal run does not match current Fleet State');
  }
  return { tddState, proposal: validated };
}

function assertAtomicProposal(proposal) {
  const validated = validateStrategyTransitionProposal(proposal);
  if (!validated.valid || validated.proposal.strategy !== TDD_STRATEGY) {
    throw new Error(`TDD Atomic proposal is invalid: ${validated.defects.join('; ')}`);
  }
  return validated.proposal;
}

function atomicProposalFromTddProposal(fleetState, tddProposal) {
  return assertAtomicProposal({
    ...tddProposal,
    binding: {
      ...tddProposal.binding,
      expectedStateRevision: fleetState.revision,
    },
  });
}

function withTddState(fleetState, tddState) {
  if (!isRecord(tddState)) {
    throw new Error('TDD Atomic Fleet State transition must return current TDD state');
  }
  assertTddState(tddState);
  if (tddState.strategy !== TDD_STRATEGY || tddState.runId !== fleetState.runId) {
    throw new Error('TDD Atomic Fleet State transition must return current TDD state');
  }
  return {
    ...fleetState,
    strategyState: {
      namespace: TDD_STRATEGY,
      value: structuredClone(tddState),
    },
  };
}

/**
 * Adapts a current TDD proposal to the shared Atomic Transition envelope.
 * The generic ledger revision is bound here; TDD's control revision remains
 * within its strategy projection.
 */
export function createTddAtomicTransition(input) {
  if (!isRecord(input)) throw new Error('TDD Atomic transition input must be an object');
  const { fleetState, manifest, proposal, now } = input;
  assertFleetState(fleetState, manifest);
  const current = assertFleetBoundTddProposal(fleetState, proposal, now);
  const sharedProposal = atomicProposalFromTddProposal(fleetState, current.proposal);
  return {
    tddProposal: current.proposal,
    proposal: sharedProposal,
    current: createTddAtomicCurrent({
      fleetState,
      manifest,
      proposal,
      atomicProposal: sharedProposal,
      now,
    }),
  };
}

/**
 * Derives the shared currentness projection from the TDD envelope in the
 * locked Fleet State, never from a caller-owned TDD snapshot.
 */
export function createTddAtomicCurrent(input) {
  if (!isRecord(input)) throw new Error('TDD Atomic current input must be an object');
  const {
    fleetState,
    manifest,
    proposal,
    atomicProposal,
    now,
  } = input;
  assertFleetState(fleetState, manifest);
  const current = assertFleetBoundTddProposal(fleetState, proposal, now);
  const sharedProposal = assertAtomicProposal(atomicProposal);
  const expectedSharedProposal = atomicProposalFromTddProposal(fleetState, current.proposal);
  if (JSON.stringify(sharedProposal) !== JSON.stringify(expectedSharedProposal)) {
    throw new Error('Atomic proposal does not match the current TDD proposal and Fleet State');
  }
  const projection = tddProjection(current.tddState);
  if (JSON.stringify(projection) !== JSON.stringify(current.proposal.transition.from.value)) {
    throw new Error('TDD proposal transition source does not match locked TDD strategy state');
  }
  if (sharedProposal.binding.run !== fleetState.runId) {
    throw new Error('Atomic proposal run does not match current Fleet State');
  }
  return {
    stateRevision: fleetState.revision,
    run: fleetState.runId,
    candidate: sharedProposal.binding.candidate,
    agent: sharedProposal.binding.agent,
    fence: sharedProposal.binding.fence,
    leases: structuredClone(sharedProposal.reservation.leases),
    state: {
      namespace: TDD_STRATEGY,
      value: projection,
    },
  };
}

/**
 * Rechecks a TDD proposal under the shared Fleet State lock and persists the
 * TDD successor in the same compare-and-swap mutation. `clock` is read from
 * inside the lock for proposal validation and supplied to the lifecycle
 * callback as its fourth argument.
 */
export function applyTddAtomicFleetStateTransition(input) {
  if (!isRecord(input)) throw new Error('TDD Atomic transition input must be an object');
  if (typeof input.transition !== 'function') {
    throw new Error('TDD Atomic transition requires a TDD transition callback');
  }
  const clock = trustedClock(input.clock);
  const built = createTddAtomicTransition({
    ...input,
    now: trustedNow(clock),
  });
  const fleetState = applyFleetStateTransition({
    file: input.file,
    manifest: input.manifest,
    proposal: built.proposal,
    readCurrent: (lockedFleetState) => {
      const now = trustedNow(clock);
      return createTddAtomicCurrent({
        fleetState: lockedFleetState,
        manifest: input.manifest,
        proposal: input.proposal,
        atomicProposal: built.proposal,
        now,
      });
    },
    transition: (lockedFleetState, sharedProposal) => {
      const now = trustedNow(clock);
      const locked = assertFleetBoundTddProposal(
        lockedFleetState,
        input.proposal,
        now,
      );
      const nextTddState = input.transition(
        structuredClone(locked.tddState),
        structuredClone(locked.proposal),
        structuredClone(sharedProposal),
        now,
      );
      return withTddState(lockedFleetState, nextTddState);
    },
    options: input.options,
  });
  return {
    fleetState,
    tddState: tddStateFromFleetState(fleetState),
    proposal: built.proposal,
  };
}
