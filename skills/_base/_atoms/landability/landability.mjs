/**
 * The shared vocabulary at the seam between a delivery run and the skill that
 * keeps a change request landable.
 *
 * One side produces these values and the other consumes them, which is exactly
 * the shape that drifts when each keeps its own copy. Two consumers already
 * exist, so the vocabulary lives here once: the terminal dispositions, the
 * base's up-to-date policy, and the freshness receipt a disposition is bound
 * to.
 *
 * A receipt is the part worth being strict about. A disposition says a change
 * request was landable against one base commit at one moment; without the
 * moment and the commits, a holder cannot tell whether it still describes
 * anything, and an incomplete receipt read as evidence is the failure this
 * seam exists to prevent.
 */

/** Every disposition the shepherding side may end on. Anything else is not an ending. */
export const TERMINAL_DISPOSITIONS = Object.freeze([
  'mergeable-and-green',
  'no-op-mergeable-and-green',
  'provider-unsupported',
  'provider-tool-unsupported',
  'provider-tool-missing',
  'provider-tool-unauthenticated',
  'needs-human',
  'blocked',
  'failing',
]);

const TERMINAL_SET = new Set(TERMINAL_DISPOSITIONS);

export function isTerminalDisposition(value) {
  return TERMINAL_SET.has(value);
}

/** Three values, never two. `unobserved` is not `not-required`. */
export const UP_TO_DATE_POLICIES = Object.freeze(['required', 'not-required', 'unobserved']);

const POLICY_SET = new Set(UP_TO_DATE_POLICIES);

/**
 * Normalize the base's up-to-date requirement.
 *
 * A boolean is the shape a provider client hands back, so it is mapped rather
 * than rejected. Anything else becomes `unobserved`, never `not-required`: one
 * says the policy was read and imposes nothing, the other says nobody could
 * look, and collapsing them treats a base that refuses a behind branch as one
 * that does not.
 *
 * @param {unknown} value
 * @returns {'required'|'not-required'|'unobserved'}
 */
export function normalizeUpToDatePolicy(value) {
  if (value === true) {
    return 'required';
  }
  if (value === false) {
    return 'not-required';
  }
  return POLICY_SET.has(value) ? value : 'unobserved';
}

/** True only when the requirement was actually stated. */
export function requiresUpToDateBranch(value) {
  return normalizeUpToDatePolicy(value) === 'required';
}

function commit(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * Build a freshness receipt from whatever was observed.
 *
 * @param {object} [input]
 * @returns {{observedAt: string|null, baseSha: string|null, headSha: string|null, upToDatePolicy: string, provider: string, complete: boolean}}
 */
export function buildFreshnessReceipt(input = {}) {
  const observedAt = commit(input.observedAt);
  const baseSha = commit(input.baseSha);
  const headSha = commit(input.headSha);

  return {
    observedAt,
    baseSha,
    headSha,
    upToDatePolicy: normalizeUpToDatePolicy(input.upToDatePolicy),
    provider: typeof input.provider === 'string' && input.provider !== '' ? input.provider : 'unobserved',
    complete: Boolean(observedAt && baseSha && headSha),
  };
}

/**
 * Check a receipt somebody else produced.
 *
 * A missing field and a field holding a number, an empty string, or an object
 * are the same defect from a consumer's side: there is nothing to compare a
 * later observation against. `complete: true` asserted over missing fields is
 * reported as its own defect rather than believed.
 *
 * @param {unknown} receipt
 * @returns {{valid: boolean, defects: string[]}}
 */
export function validateFreshnessReceipt(receipt) {
  if (receipt === null || typeof receipt !== 'object') {
    return { valid: false, defects: [`receipt: ${receipt === undefined ? 'absent' : 'not an object'}`] };
  }

  const defects = [];
  for (const field of ['observedAt', 'baseSha', 'headSha']) {
    if (!commit(receipt[field])) {
      defects.push(`receipt.${field}: ${receipt[field] === undefined ? 'absent' : 'not a non-empty string'}`);
    }
  }
  if (defects.length === 0 && receipt.complete === false) {
    defects.push('receipt.complete: the producer reported the receipt as incomplete');
  }
  if (defects.length > 0 && receipt.complete === true) {
    defects.push('receipt.complete: reported complete while fields are missing');
  }

  return { valid: defects.length === 0, defects };
}

/**
 * Compare a receipt against a later observation of the same refs.
 *
 * Both commits must match. A moved base means the disposition describes a
 * merge that no longer applies; a moved head means it describes different code.
 * Either way it is evidence about a state that no longer exists.
 *
 * An observation that could not be made is `unobserved` rather than `stale`,
 * because manufacturing drift nobody saw is its own kind of wrong. A caller
 * that cannot afford `unobserved` decides that, not this function.
 *
 * @param {object} receipt
 * @param {{baseSha?: string, headSha?: string}} [observation]
 * @returns {{freshness: 'fresh'|'stale'|'unobserved', drifted: string[]}}
 */
export function compareObservation(receipt, observation) {
  const observedBase = commit(observation?.baseSha);
  const observedHead = commit(observation?.headSha);
  const recordedBase = commit(receipt?.baseSha);
  const recordedHead = commit(receipt?.headSha);

  if (!observedBase || !observedHead || !recordedBase || !recordedHead) {
    return { freshness: 'unobserved', drifted: [] };
  }

  const drifted = [];
  if (recordedBase !== observedBase) {
    drifted.push(`base ${recordedBase} -> ${observedBase}`);
  }
  if (recordedHead !== observedHead) {
    drifted.push(`head ${recordedHead} -> ${observedHead}`);
  }

  return { freshness: drifted.length > 0 ? 'stale' : 'fresh', drifted };
}
