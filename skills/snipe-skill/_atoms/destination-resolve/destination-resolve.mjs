/**
 * Deterministic destination resolution for Skill Sniper.
 *
 * An adoption run writes somewhere. Deciding where is the single most dangerous
 * inference in the workflow, because every plausible guess is also a way to
 * write private material into a public checkout or the reverse.
 *
 * So this module refuses to guess, and it refuses in three distinct ways:
 *
 *   1. **Nothing is discovered.** Candidates arrive from the operator or from an
 *      applicable instruction file the runtime already established. A candidate
 *      whose origin is a filesystem sweep is refused by shape, so "just look
 *      around for a skills directory" has no code path to run through.
 *   2. **Silence is not a selection.** With no explicit choice from the
 *      operator, the result is `ambiguous` and one bounded question, however
 *      many candidates were declared. One declared candidate is not consent.
 *   3. **A failed resolution never becomes a different destination.** When the
 *      operator's named destination is not declared, the result names no
 *      alternative and `assertNoFallback` refuses the substitution outright.
 *
 * Boundaries are opaque strings, not an enum. This package encodes no taxonomy
 * of destinations - no personal/work/team ladder - because the operator's own
 * instruction hierarchy owns that vocabulary and this file would go stale
 * against it.
 */

export const RESOLUTION_STATUSES = ['resolved', 'ambiguous', 'unresolved'];

export const DESTINATION_FAILURES = {
  usage: 'usage',
  invalidCandidate: 'invalid_candidate',
  duplicateCandidate: 'duplicate_candidate',
  scanAttempted: 'scan_attempted',
  crossBoundaryFallback: 'cross_boundary_fallback',
};

/** Where a candidate destination is allowed to come from. */
export const CANDIDATE_ORIGINS = ['operator', 'instruction'];

/** Origins that mean somebody swept for a destination instead of resolving one. */
export const SCAN_ORIGINS = ['scan', 'discovery', 'search', 'glob', 'filesystem'];

const CANDIDATE_FIELDS = ['id', 'boundary', 'private', 'origin'];

export class DestinationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DestinationError';
    this.code = code;
  }
}

function opaqueIdentity(candidate) {
  // A stable correlation handle a report outside the boundary can name. It is
  // derived from the candidate, so two reports about the same destination
  // agree, and it carries none of the destination's own words.
  //
  // It is **not a confidentiality control**. The derivation is unkeyed and
  // short, so anyone holding the handle and a list of plausible destinations
  // recomputes the match immediately. Its job is correlation without quoting,
  // and the unit document says exactly that rather than implying secrecy.
  let hash = 0x811c9dc5;
  for (const character of `${candidate.boundary}\u0000${candidate.id}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `destination-${hash.toString(16).padStart(8, '0')}`;
}

function validateCandidate(candidate, index) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new DestinationError(
      DESTINATION_FAILURES.invalidCandidate,
      `candidate ${index} must be an object`,
    );
  }
  const keys = Object.keys(candidate).sort();
  if (SCAN_ORIGINS.includes(candidate.origin)) {
    throw new DestinationError(
      DESTINATION_FAILURES.scanAttempted,
      `candidate ${index} was discovered by ${candidate.origin}; destinations are named, never swept for`,
    );
  }
  if (JSON.stringify(keys) !== JSON.stringify([...CANDIDATE_FIELDS].sort())) {
    throw new DestinationError(
      DESTINATION_FAILURES.invalidCandidate,
      `candidate ${index} requires exactly ${CANDIDATE_FIELDS.join(', ')}`,
    );
  }
  // An identity is compared verbatim against the operator's trimmed choice, so
  // surrounding whitespace is refused at declaration time rather than producing
  // a candidate that is accepted and can never be selected.
  for (const field of ['id', 'boundary']) {
    const value = candidate[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new DestinationError(
        DESTINATION_FAILURES.invalidCandidate,
        `candidate ${index} requires a non-empty ${field}`,
      );
    }
    if (value !== value.trim()) {
      throw new DestinationError(
        DESTINATION_FAILURES.invalidCandidate,
        `candidate ${index} ${field} carries surrounding whitespace, so nothing could ever name it`,
      );
    }
  }
  if (typeof candidate.private !== 'boolean') {
    throw new DestinationError(
      DESTINATION_FAILURES.invalidCandidate,
      `candidate ${index} requires a boolean private flag`,
    );
  }
  if (!CANDIDATE_ORIGINS.includes(candidate.origin)) {
    throw new DestinationError(
      DESTINATION_FAILURES.invalidCandidate,
      `candidate ${index} origin must be one of ${CANDIDATE_ORIGINS.join(', ')}`,
    );
  }
  return candidate;
}

function describe(candidate) {
  return {
    id: candidate.id,
    boundary: candidate.boundary,
    private: candidate.private,
    origin: candidate.origin,
    disclosure: candidate.private ? 'opaque' : 'plain',
    publicIdentity: candidate.private ? opaqueIdentity(candidate) : candidate.id,
  };
}

/**
 * Resolve exactly one destination, or say precisely why there is not one.
 *
 * `explicit` is the destination the operator named. `candidates` are the
 * destinations applicable instructions declare. Both are supplied; neither is
 * found by this function.
 */
export function resolveDestination({ explicit, candidates } = {}) {
  if (!Array.isArray(candidates)) {
    throw new DestinationError(DESTINATION_FAILURES.usage, 'candidates must be an array');
  }
  candidates.forEach(validateCandidate);
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) {
      throw new DestinationError(
        DESTINATION_FAILURES.duplicateCandidate,
        `duplicate declared destination: ${candidate.id}`,
      );
    }
    seen.add(candidate.id);
  }
  if (explicit !== undefined && explicit !== null && typeof explicit !== 'string') {
    throw new DestinationError(DESTINATION_FAILURES.usage, 'explicit must be a string when supplied');
  }

  const named = typeof explicit === 'string' ? explicit.trim() : '';

  if (named === '') {
    if (candidates.length === 0) {
      return {
        status: 'unresolved',
        reason: 'no-declared-destination',
        declaredCount: 0,
        question: 'Which destination should this adoption target? None is declared here.',
      };
    }
    return {
      status: 'ambiguous',
      reason: 'no-explicit-destination',
      declaredCount: candidates.length,
      question: 'Which declared destination should this adoption target?',
    };
  }

  const match = candidates.find((candidate) => candidate.id === named);
  if (!match) {
    // Deliberately no `alternatives`. Naming the destinations the operator did
    // not ask for is how a failed resolution turns into a write on the wrong
    // side of a boundary.
    return {
      status: 'unresolved',
      reason: 'explicit-destination-not-declared',
      requested: named,
      declaredCount: candidates.length,
      question: `${named} is not declared by the applicable instructions. Which destination should this adoption target?`,
    };
  }

  return { status: 'resolved', destination: describe(match) };
}

/**
 * Refuse the substitution that an unresolved destination invites.
 *
 * A run that failed to resolve what the operator named has learned nothing
 * about where the work should go instead. Continuing into any other candidate -
 * on the same boundary or another one - is a decision only the operator makes.
 */
export function assertNoFallback(previous, next) {
  if (!previous || !RESOLUTION_STATUSES.includes(previous.status)) {
    throw new DestinationError(DESTINATION_FAILURES.usage, 'previous must be a resolution result');
  }
  if (previous.status === 'resolved') {
    return { permitted: true, destination: previous.destination };
  }
  throw new DestinationError(
    DESTINATION_FAILURES.crossBoundaryFallback,
    `resolution ended ${previous.status} (${previous.reason}); ${
      next?.id ?? 'another destination'
    } is not a fallback, and the operator answers the question instead`,
  );
}

/**
 * Public-safe reporting for a resolved private destination.
 *
 * The parent of an adoption run often lives outside the destination's trust
 * boundary. It still needs to know that a destination was resolved and what
 * happened there, so it gets an opaque identity and a coarse status rather than
 * a redacted-looking blank.
 */
export function publicSummary(resolution) {
  if (!resolution || !RESOLUTION_STATUSES.includes(resolution.status)) {
    throw new DestinationError(DESTINATION_FAILURES.usage, 'resolution must be a resolution result');
  }
  if (resolution.status !== 'resolved') {
    return { status: resolution.status, reason: resolution.reason, destination: null };
  }
  const { destination } = resolution;
  return {
    status: 'resolved',
    reason: null,
    destination: {
      identity: destination.publicIdentity,
      disclosure: destination.disclosure,
      private: destination.private,
    },
  };
}
