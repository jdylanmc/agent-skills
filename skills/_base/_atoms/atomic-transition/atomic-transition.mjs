/**
 * A strategy-neutral contract for transitions that must be applied against one
 * exact ledger revision. Strategy state and payloads remain opaque: this atom
 * only checks their namespace before handing them back to their owner.
 */

import {
  mutateFleetState,
} from '../../../ship-with-squadron/_atoms/fleet-state/fleet-state.mjs';

export const ATOMIC_TRANSITION_SCHEMA_VERSION = 1;

export const FORBIDDEN_AUTHORITIES = Object.freeze([
  'merge',
  'approve',
  'enable-auto-merge',
  'accept-risk',
  'force-push',
  'close-tracker-work',
  'select-adjacent-work',
]);

const PROPOSAL_FIELDS = Object.freeze([
  'schemaVersion',
  'strategy',
  'binding',
  'reservation',
  'transition',
  'payload',
  'forbiddenAuthorities',
]);
const BINDING_FIELDS = Object.freeze([
  'expectedStateRevision',
  'run',
  'candidate',
  'lease',
  'agent',
  'fence',
]);
const RESERVATION_FIELDS = Object.freeze(['leases']);
const LEASE_FIELDS = Object.freeze(['lease', 'candidate', 'agent', 'fence']);
const OPAQUE_ENVELOPE_FIELDS = Object.freeze(['namespace', 'value']);
const TRANSITION_FIELDS = Object.freeze(['from', 'to']);
const CURRENT_FIELDS = Object.freeze([
  'stateRevision',
  'run',
  'candidate',
  'agent',
  'fence',
  'leases',
  'state',
]);
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[a-z0-9._-]*[a-z0-9])?$/u;
const STRATEGY_PATTERN = /^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/u;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(value, expected) {
  return isPlainObject(value)
    && same(Object.keys(value).sort(), [...expected].sort());
}

function identifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value) ? value : null;
}

function strategyName(value) {
  return typeof value === 'string' && STRATEGY_PATTERN.test(value) ? value : null;
}

function positiveFence(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function stateRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function isJsonValue(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((entry) => isJsonValue(entry, seen));
    seen.delete(value);
    return valid;
  }
  if (!isPlainObject(value) || seen.has(value)) return false;
  seen.add(value);
  const valid = Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function opaqueEnvelope(value, field, strategy, defects) {
  if (!exactKeys(value, OPAQUE_ENVELOPE_FIELDS)) {
    defects.push(`${field} must contain exactly namespace and value`);
    return null;
  }
  if (value.namespace !== strategy) {
    defects.push(`${field}.namespace must equal strategy`);
  }
  if (!isJsonValue(value.value)) {
    defects.push(`${field}.value must be JSON data`);
  }
  return isJsonValue(value.value)
    ? { namespace: value.namespace, value: structuredClone(value.value) }
    : null;
}

function normalizeLease(value, field, defects) {
  if (!exactKeys(value, LEASE_FIELDS)) {
    defects.push(`${field} must contain exactly lease, candidate, agent, and fence`);
    return null;
  }
  const normalized = {
    lease: identifier(value.lease),
    candidate: identifier(value.candidate),
    agent: identifier(value.agent),
    fence: positiveFence(value.fence),
  };
  for (const [name, entry] of Object.entries(normalized)) {
    if (entry === null) defects.push(`${field}.${name} is invalid`);
  }
  return Object.values(normalized).every((entry) => entry !== null) ? normalized : null;
}

function normalizeReservation(value, binding, defects) {
  if (!exactKeys(value, RESERVATION_FIELDS) || !Array.isArray(value.leases) || value.leases.length === 0) {
    defects.push('reservation must contain a non-empty leases array');
    return null;
  }
  const leases = value.leases.map((entry, index) => normalizeLease(entry, `reservation.leases[${index}]`, defects));
  if (leases.some((entry) => entry === null)) return null;

  const names = leases.map((entry) => entry.lease);
  if (new Set(names).size !== names.length) {
    defects.push('reservation leases must be unique');
  }
  for (const entry of leases) {
    if (entry.candidate !== binding.candidate) {
      defects.push(`reservation lease ${entry.lease} is bound to another candidate`);
    }
    if (entry.agent !== binding.agent) {
      defects.push(`reservation lease ${entry.lease} is bound to another agent`);
    }
  }
  const primary = leases.find((entry) => entry.lease === binding.lease);
  if (!primary) {
    defects.push('reservation omits the binding lease');
  } else if (primary.fence !== binding.fence) {
    defects.push('reservation primary lease fence differs from binding fence');
  }
  return leases;
}

/**
 * Validate an untrusted strategy proposal without interpreting its opaque
 * strategy state or payload.
 *
 * @param {unknown} input
 * @returns {{valid: boolean, defects: string[], proposal: object|null}}
 */
export function validateStrategyTransitionProposal(input) {
  const defects = [];
  if (!exactKeys(input, PROPOSAL_FIELDS)) {
    return {
      valid: false,
      defects: ['proposal must contain exactly schemaVersion, strategy, binding, reservation, transition, payload, and forbiddenAuthorities'],
      proposal: null,
    };
  }
  if (input.schemaVersion !== ATOMIC_TRANSITION_SCHEMA_VERSION) {
    defects.push(`unsupported proposal schemaVersion: ${JSON.stringify(input.schemaVersion)}`);
  }
  const strategy = strategyName(input.strategy);
  if (!strategy) defects.push('strategy must be a namespaced identifier');

  let binding = null;
  if (!exactKeys(input.binding, BINDING_FIELDS)) {
    defects.push('binding must contain exactly expectedStateRevision, run, candidate, lease, agent, and fence');
  } else {
    binding = {
      expectedStateRevision: stateRevision(input.binding.expectedStateRevision),
      run: identifier(input.binding.run),
      candidate: identifier(input.binding.candidate),
      lease: identifier(input.binding.lease),
      agent: identifier(input.binding.agent),
      fence: positiveFence(input.binding.fence),
    };
    for (const [name, value] of Object.entries(binding)) {
      if (value === null) defects.push(`binding.${name} is invalid`);
    }
  }

  const transition = exactKeys(input.transition, TRANSITION_FIELDS)
    ? {
      from: opaqueEnvelope(input.transition.from, 'transition.from', strategy, defects),
      to: opaqueEnvelope(input.transition.to, 'transition.to', strategy, defects),
    }
    : (defects.push('transition must contain exactly from and to'), null);
  const payload = opaqueEnvelope(input.payload, 'payload', strategy, defects);
  const reservation = binding
    ? normalizeReservation(input.reservation, binding, defects)
    : (defects.push('reservation cannot be validated without valid bindings'), null);

  if (!same(input.forbiddenAuthorities, FORBIDDEN_AUTHORITIES)) {
    defects.push('forbiddenAuthorities must exactly match the shared forbidden authorities');
  }

  if (
    defects.length
    || !strategy
    || !binding
    || Object.values(binding).some((value) => value === null)
    || !transition?.from
    || !transition?.to
    || !payload
    || !reservation
  ) {
    return { valid: false, defects, proposal: null };
  }

  return {
    valid: true,
    defects: [],
    proposal: {
      schemaVersion: ATOMIC_TRANSITION_SCHEMA_VERSION,
      strategy,
      binding,
      reservation: { leases: reservation },
      transition,
      payload,
      forbiddenAuthorities: [...FORBIDDEN_AUTHORITIES],
    },
  };
}

/**
 * Validate a group reservation as one all-or-none operation. Each requested
 * lease must match an authoritative lease exactly; a caller never receives a
 * usable subset.
 *
 * @param {unknown} requested
 * @param {unknown} authoritative
 * @returns {{valid: boolean, defects: string[]}}
 */
export function validateAtomicLeaseReservation(requested, authoritative) {
  const defects = [];
  if (!Array.isArray(requested) || requested.length === 0) {
    return { valid: false, defects: ['requested leases must be a non-empty array'] };
  }
  if (!Array.isArray(authoritative)) {
    return { valid: false, defects: ['authoritative leases must be an array'] };
  }
  const requestedLeases = requested.map((entry, index) => normalizeLease(entry, `requested[${index}]`, defects));
  const authoritativeLeases = authoritative.map((entry, index) => normalizeLease(entry, `authoritative[${index}]`, defects));
  if (requestedLeases.some((entry) => entry === null) || authoritativeLeases.some((entry) => entry === null)) {
    return { valid: false, defects };
  }

  const requestedNames = requestedLeases.map((entry) => entry.lease);
  if (new Set(requestedNames).size !== requestedNames.length) {
    defects.push('requested leases must be unique');
  }
  const authoritativeNames = authoritativeLeases.map((entry) => entry.lease);
  if (new Set(authoritativeNames).size !== authoritativeNames.length) {
    defects.push('authoritative leases must be unique');
  }
  const authoritativeByLease = new Map(authoritativeLeases.map((entry) => [entry.lease, entry]));
  for (const lease of requestedLeases) {
    const current = authoritativeByLease.get(lease.lease);
    if (!current) {
      defects.push(`lease ${lease.lease} is not reserved`);
    } else if (!same(current, lease)) {
      defects.push(`lease ${lease.lease} binding is no longer current`);
    }
  }
  return { valid: defects.length === 0, defects };
}

function normalizeCurrent(value, strategy, defects) {
  if (!exactKeys(value, CURRENT_FIELDS)) {
    defects.push('current state must contain exactly stateRevision, run, candidate, agent, fence, leases, and state');
    return null;
  }
  const current = {
    stateRevision: stateRevision(value.stateRevision),
    run: identifier(value.run),
    candidate: identifier(value.candidate),
    agent: identifier(value.agent),
    fence: positiveFence(value.fence),
    state: opaqueEnvelope(value.state, 'current.state', strategy, defects),
  };
  for (const [name, entry] of Object.entries(current)) {
    if (entry === null) defects.push(`current.${name} is invalid`);
  }
  if (!Array.isArray(value.leases)) {
    defects.push('current.leases must be an array');
    return null;
  }
  current.leases = value.leases.map((entry, index) => normalizeLease(entry, `current.leases[${index}]`, defects));
  return current.leases.some((entry) => entry === null) ? null : current;
}

/**
 * Check whether a validated proposal still describes the current strategy
 * snapshot. The caller owns producing the snapshot from its locked state.
 *
 * @param {unknown} proposal
 * @param {unknown} current
 * @returns {{current: boolean, defects: string[]}}
 */
export function evaluateTransitionCurrentness(proposal, current) {
  const validated = validateStrategyTransitionProposal(proposal);
  if (!validated.valid) {
    return { current: false, defects: validated.defects.map((defect) => `proposal: ${defect}`) };
  }

  const defects = [];
  const normalizedCurrent = normalizeCurrent(current, validated.proposal.strategy, defects);
  if (!normalizedCurrent) return { current: false, defects };

  const expected = validated.proposal.binding;
  for (const [currentField, bindingField] of [
    ['stateRevision', 'expectedStateRevision'],
    ['run', 'run'],
    ['candidate', 'candidate'],
    ['agent', 'agent'],
    ['fence', 'fence'],
  ]) {
    if (normalizedCurrent[currentField] !== expected[bindingField]) {
      defects.push(`current ${currentField} differs from proposal binding`);
    }
  }
  if (!same(normalizedCurrent.state, validated.proposal.transition.from)) {
    defects.push('current strategy state differs from transition source state');
  }
  const reservation = validateAtomicLeaseReservation(
    validated.proposal.reservation.leases,
    normalizedCurrent.leases,
  );
  defects.push(...reservation.defects);
  return { current: defects.length === 0, defects };
}

function normalizeCandidateEvidence(entry, index, defects) {
  const field = `evidence[${index}]`;
  const fields = ['candidate', 'candidateRevision', 'namespace', 'payload', 'status', 'supersededBy', 'invalidatedAtRevision', 'invalidationReason'];
  if (!exactKeys(entry, fields)) {
    defects.push(`${field} has an invalid envelope`);
    return null;
  }
  const normalized = {
    candidate: identifier(entry.candidate),
    candidateRevision: stateRevision(entry.candidateRevision),
    namespace: strategyName(entry.namespace),
    payload: isJsonValue(entry.payload) ? structuredClone(entry.payload) : null,
    status: entry.status,
    supersededBy: entry.supersededBy === null ? null : identifier(entry.supersededBy),
    invalidatedAtRevision: entry.invalidatedAtRevision === null
      ? null
      : stateRevision(entry.invalidatedAtRevision),
    invalidationReason: entry.invalidationReason === null
      ? null
      : identifier(entry.invalidationReason),
  };
  if (!normalized.candidate) defects.push(`${field}.candidate is invalid`);
  if (normalized.candidateRevision === null) defects.push(`${field}.candidateRevision is invalid`);
  if (!normalized.namespace) defects.push(`${field}.namespace is invalid`);
  if (normalized.payload === null && entry.payload !== null) defects.push(`${field}.payload must be JSON data`);
  if (!['current', 'invalidated'].includes(normalized.status)) defects.push(`${field}.status is invalid`);
  if (normalized.status === 'current'
      && (normalized.supersededBy !== null
        || normalized.invalidatedAtRevision !== null
        || normalized.invalidationReason !== null)) {
    defects.push(`${field}.current evidence cannot carry invalidation fields`);
  }
  if (normalized.status === 'invalidated'
      && (!normalized.supersededBy
        || normalized.invalidatedAtRevision === null
        || normalized.invalidationReason !== 'candidate-superseded')) {
    defects.push(`${field}.invalidated evidence must carry a candidate supersession`);
  }
  return defects.some((defect) => defect.startsWith(field)) ? null : normalized;
}

/**
 * Preserve selected-candidate evidence and invalidate every current evidence
 * record belonging to an older candidate. Already invalidated records are
 * immutable audit facts and therefore copied unchanged.
 *
 * @param {unknown} evidence
 * @param {unknown} selectedCandidate
 * @param {unknown} atStateRevision
 * @returns {{valid: boolean, defects: string[], evidence: object[]|null}}
 */
export function supersedeCandidateEvidence(evidence, selectedCandidate, atStateRevision) {
  const defects = [];
  const selected = identifier(selectedCandidate);
  const revision = stateRevision(atStateRevision);
  if (!Array.isArray(evidence)) defects.push('evidence must be an array');
  if (!selected) defects.push('selected candidate is invalid');
  if (revision === null) defects.push('supersession state revision is invalid');
  if (defects.length) return { valid: false, defects, evidence: null };

  const normalized = evidence.map((entry, index) => normalizeCandidateEvidence(entry, index, defects));
  const identities = normalized
    .filter(Boolean)
    .map((entry) => `${entry.candidate}\0${entry.candidateRevision}`);
  if (new Set(identities).size !== identities.length) {
    defects.push('evidence contains duplicate candidate revisions');
  }
  if (defects.length) return { valid: false, defects, evidence: null };

  return {
    valid: true,
    defects: [],
    evidence: normalized.map((entry) => (
      entry.status === 'current' && entry.candidate !== selected
        ? {
          ...entry,
          status: 'invalidated',
          supersededBy: selected,
          invalidatedAtRevision: revision,
          invalidationReason: 'candidate-superseded',
        }
        : entry
    )),
  };
}

/**
 * Atomically recheck a proposal while holding the existing Squadron fleet-state
 * lock. The callbacks keep strategy-specific projections and mutations outside
 * this generic contract while avoiding a second persistent ledger.
 *
 * @param {{
 *   file: string,
 *   manifest: object,
 *   proposal: object,
 *   readCurrent: (state: object) => object,
 *   transition: (state: object, proposal: object) => object,
 *   options?: object,
 * }} input
 * @returns {object}
 */
export function applyFleetStateTransition(input) {
  const validated = validateStrategyTransitionProposal(input?.proposal);
  if (!validated.valid) {
    throw new Error(`invalid transition proposal: ${validated.defects.join('; ')}`);
  }
  if (typeof input?.readCurrent !== 'function') {
    throw new Error('readCurrent must be a function');
  }
  if (typeof input?.transition !== 'function') {
    throw new Error('transition must be a function');
  }
  return mutateFleetState(
    input.file,
    input.manifest,
    validated.proposal.binding.expectedStateRevision,
    (state) => {
      const currentness = evaluateTransitionCurrentness(
        validated.proposal,
        input.readCurrent(structuredClone(state)),
      );
      if (!currentness.current) {
        throw new Error(`transition proposal is not current: ${currentness.defects.join('; ')}`);
      }
      return input.transition(structuredClone(state), structuredClone(validated.proposal));
    },
    input.options,
  );
}
