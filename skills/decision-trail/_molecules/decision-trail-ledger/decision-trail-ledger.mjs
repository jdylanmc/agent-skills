import crypto from 'node:crypto';

import { redactTextWithConfiguredIdentifiers } from '../../../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

export const CONFIDENCE = ['high', 'medium', 'low', 'unreconstructable'];
export const OUTCOME_STATES = ['proposed', 'accepted', 'rejected', 'superseded', 'unreconstructable'];
export const REDACTION_STATES = ['raw', 'sanitized', 'redacted', 'publishable'];
export const PUBLICATION_GATES = [
  'local-only',
  'needs-redaction',
  'needs-independent-review',
  'ready-for-review',
  'blocked',
];

const FORMULA_PREFIX_PATTERN = /^\s*[=+\-@]/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const CHAIN_FIELDS = new Set(['row_digest', 'previous_digest']);

export class DecisionTrailError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DecisionTrailError';
    this.code = code;
  }
}

function defect(type, sequence, detail) {
  return { type, sequence: sequence ?? null, detail };
}

function stable(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash('sha256').update(stable(value), 'utf8').digest('hex');
}

function stripChainFields(entry) {
  const copy = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!CHAIN_FIELDS.has(key)) {
      copy[key] = value;
    }
  }
  return copy;
}

export function sanitizeText(value, path = 'value') {
  if (typeof value !== 'string') {
    return { value, changes: [] };
  }

  const changes = [];
  let sanitized = value.replace(CONTROL_CHARACTER_PATTERN, (match) => {
    changes.push({ path, type: 'control-character', replacement: '[removed-control-character]' });
    return '';
  });

  const redacted = redactTextWithConfiguredIdentifiers(sanitized);
  if (redacted.text !== sanitized) {
    sanitized = redacted.text;
    changes.push(...redacted.redactions.map((redaction) => ({
      path,
      type: 'sensitive-redaction',
      category: redaction.category,
      count: redaction.count,
      replacement: `[REDACTED:${redaction.category}]`,
    })));
  }

  if (FORMULA_PREFIX_PATTERN.test(sanitized) && !sanitized.startsWith("'")) {
    sanitized = `'${sanitized}`;
    changes.push({ path, type: 'spreadsheet-formula-prefix', replacement: 'single-quote-prefix' });
  }

  return { value: sanitized, changes };
}

export function sanitizeValue(value, path = 'value') {
  if (typeof value === 'string') {
    return sanitizeText(value, path);
  }
  if (Array.isArray(value)) {
    const output = [];
    const changes = [];
    value.forEach((item, index) => {
      const result = sanitizeValue(item, `${path}[${index}]`);
      output.push(result.value);
      changes.push(...result.changes);
    });
    return { value: output, changes };
  }
  if (value && typeof value === 'object') {
    const output = {};
    const changes = [];
    for (const [key, item] of Object.entries(value)) {
      const result = sanitizeValue(item, `${path}.${key}`);
      output[key] = result.value;
      changes.push(...result.changes);
    }
    return { value: output, changes };
  }
  return { value, changes: [] };
}

export function sanitizeEntry(entry) {
  const { value, changes } = sanitizeValue(entry, 'entry');
  const redactionState = changes.some((change) => change.type === 'sensitive-redaction')
    ? 'redacted'
    : changes.length > 0 ? 'sanitized' : value.redaction_state;
  return {
    ...value,
    redaction_state: REDACTION_STATES.includes(redactionState) ? redactionState : 'sanitized',
    sanitization_changes: [...(value.sanitization_changes ?? []), ...changes],
  };
}

function locatorMap(items) {
  return new Map((items ?? [])
    .filter((item) => item?.locator)
    .map((item) => [item.locator, item]));
}

function actualEvidenceDigest(actual) {
  return typeof actual?.content === 'string' ? digest(actual.content) : null;
}

function evidenceSupports(verification, decisionId, runEvidenceByLocator) {
  const actual = runEvidenceByLocator.get(verification?.locator);
  return typeof verification?.verified_by === 'string'
    && verification.verified_by.trim().length > 0
    && typeof verification.verified_at === 'string'
    && !Number.isNaN(Date.parse(verification.verified_at))
    && typeof verification.source_digest === 'string'
    && /^[0-9a-f]{64}$/i.test(verification.source_digest)
    && actual?.trust_boundary === 'scoped-run-evidence'
    && actualEvidenceDigest(actual) === verification.source_digest
    && Array.isArray(verification.supports)
    && (verification.supports.includes('*') || verification.supports.includes(decisionId));
}

function normalizeModelFamily(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function rowDefects(entry, index, evidenceByLocator, runEvidenceByLocator) {
  const problems = [];
  const sequence = entry.sequence;

  for (const existing of entry.defects ?? []) {
    problems.push(defect(existing.type ?? 'row_declared_defect', sequence, existing.detail ?? 'row carries a declared defect'));
  }

  if (sequence !== index + 1) {
    problems.push(defect('reordered_trail', sequence, `row at position ${index + 1} carries sequence ${String(sequence)}`));
  }

  for (const field of [
    'decision_id',
    'timestamp',
    'decision_maker',
    'decision',
    'selected_option',
    'route_rationale',
    'authority_check',
    'outcome_state',
    'redaction_state',
  ]) {
    if (entry[field] === undefined || entry[field] === null || String(entry[field]).trim() === '') {
      problems.push(defect('unreconstructable_reasoning', sequence, `missing ${field}`));
    }
  }

  if (!CONFIDENCE.includes(entry.confidence)) {
    problems.push(defect('unreconstructable_reasoning', sequence, 'confidence is missing or invalid'));
  }
  if (!OUTCOME_STATES.includes(entry.outcome_state)) {
    problems.push(defect('unreconstructable_reasoning', sequence, 'outcome_state is missing or invalid'));
  }
  if (!REDACTION_STATES.includes(entry.redaction_state)) {
    problems.push(defect('unsafe_content', sequence, 'redaction_state is missing or invalid'));
  }

  if (entry.confidence !== 'unreconstructable') {
    if (!Array.isArray(entry.rejected_alternatives) || entry.rejected_alternatives.length === 0) {
      problems.push(defect('dropped_alternative', sequence, 'no rejected alternative is recorded'));
    }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      problems.push(defect('unsupported_evidence', sequence, 'no supporting evidence is recorded'));
    }
  }

  for (const [altIndex, alternative] of (entry.rejected_alternatives ?? []).entries()) {
    if (!alternative?.option || !alternative?.reason_lost) {
      problems.push(defect('dropped_alternative', sequence, `alternative ${altIndex + 1} is incomplete`));
    }
    for (const locator of alternative?.evidence ?? []) {
      const catalogItem = evidenceByLocator.get(locator);
      if (!evidenceSupports(catalogItem, entry.decision_id, runEvidenceByLocator)) {
        problems.push(defect('unsupported_evidence', sequence, `alternative evidence ${locator} is missing, unverified, or does not support ${entry.decision_id}`));
      }
    }
  }

  for (const evidence of entry.evidence ?? []) {
    const catalogItem = evidenceByLocator.get(evidence?.locator);
    if (!evidence?.locator || !evidenceSupports(catalogItem, entry.decision_id, runEvidenceByLocator)) {
      problems.push(defect('unsupported_evidence', sequence, `evidence ${evidence?.locator ?? '<missing>'} is missing, unverified, or does not support ${entry.decision_id}`));
    }
    if (!evidence?.summary || String(evidence.summary).trim() === '') {
      problems.push(defect('unsupported_evidence', sequence, `evidence ${evidence?.locator ?? '<missing>'} has no summary`));
    }
  }

  for (const change of entry.sanitization_changes ?? []) {
    if (change.type === 'spreadsheet-formula-prefix' || change.type === 'control-character') {
      continue;
    }
    if (change.type === 'sensitive-redaction') {
      continue;
    }
    problems.push(defect('unsafe_content', sequence, `unknown sanitization change ${change.type}`));
  }

  return problems;
}

export function buildTrailPacket(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DecisionTrailError('invalid_input', 'decision trail input must be an object');
  }
  if (!Array.isArray(input.entries)) {
    throw new DecisionTrailError('invalid_input', 'entries must be an array');
  }

  const sanitizedMetadata = sanitizeValue({
    trail_id: input.trail_id ?? 'decision-trail',
    scope: input.scope ?? 'unspecified',
    created_at: input.created_at ?? new Date().toISOString(),
    decision_maker: input.decision_maker ?? 'unknown',
    source_context: input.source_context ?? [],
  }, 'packet');
  const evidenceByLocator = locatorMap(options.verification_results ?? []);
  const runEvidenceByLocator = locatorMap(options.run_evidence ?? []);
  const sanitizedEntries = input.entries.map(sanitizeEntry);
  const defects = [];
  const verifyPersisted = input.mode === 'verify-persisted' || input.persisted === true;
  let previousDigest = null;

  const entries = sanitizedEntries.map((entry, index) => {
    defects.push(...rowDefects(entry, index, evidenceByLocator, runEvidenceByLocator));

    const expectedPrevious = index === 0 ? null : previousDigest;
    if (verifyPersisted && !('previous_digest' in entry)) {
      defects.push(defect('tampered_trail', entry.sequence, 'persisted row is missing previous_digest'));
    }
    if ('previous_digest' in entry && (entry.previous_digest ?? null) !== expectedPrevious) {
      defects.push(defect('tampered_trail', entry.sequence, 'previous_digest does not match preceding row'));
    }

    const canonical = stripChainFields({ ...entry, previous_digest: expectedPrevious });
    const rowDigest = digest(canonical);
    if (verifyPersisted && !entry.row_digest) {
      defects.push(defect('tampered_trail', entry.sequence, 'persisted row is missing row_digest'));
    }
    if (entry.row_digest && entry.row_digest !== rowDigest) {
      defects.push(defect('tampered_trail', entry.sequence, 'row_digest does not match canonical row content'));
    }
    previousDigest = rowDigest;

    return {
      ...entry,
      previous_digest: expectedPrevious,
      row_digest: rowDigest,
    };
  });

  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.sequence)) {
      defects.push(defect('sequence_gap', entry.sequence, 'duplicate sequence number'));
    }
    seen.add(entry.sequence);
  }
  for (let sequence = 1; sequence <= entries.length; sequence += 1) {
    if (!seen.has(sequence)) {
      defects.push(defect('sequence_gap', sequence, 'missing sequence number'));
    }
  }

  const trailDigest = digest(entries.map((entry) => ({ sequence: entry.sequence, row_digest: entry.row_digest })));
  if (verifyPersisted && input.audit?.row_count === undefined) {
    defects.push(defect('tampered_trail', null, 'persisted packet is missing row_count'));
  } else if (input.audit?.row_count !== undefined && input.audit.row_count !== entries.length) {
    defects.push(defect('tampered_trail', null, 'persisted row_count does not match actual row count'));
  }
  if (verifyPersisted && input.trail_digest === undefined) {
    defects.push(defect('tampered_trail', null, 'persisted packet is missing trail_digest'));
  } else if (input.trail_digest !== undefined && input.trail_digest !== trailDigest) {
    defects.push(defect('tampered_trail', null, 'persisted trail_digest does not match actual trail content'));
  }

  const highStakes = input.high_stakes === true || input.publication_target === 'commit' || input.publication_target === 'publish';
  const anyRaw = entries.some((entry) => entry.redaction_state === 'raw');
  const targetRequiresApproval = input.publication_target === 'commit' || input.publication_target === 'publish';

  let publicationGate = 'local-only';
  if (anyRaw) {
    defects.push(defect('publication_gate_unmet', null, 'redaction is required before publication'));
    publicationGate = 'needs-redaction';
  }

  if (targetRequiresApproval && !input.reviewer_need) {
    defects.push(defect('publication_gate_unmet', null, 'publication requires a stated reviewer need'));
  }
  if (targetRequiresApproval && input.explicit_operator_approval !== true) {
    defects.push(defect('publication_gate_unmet', null, 'publication requires explicit operator approval'));
  }

  if (highStakes) {
    const review = options.independent_review;
    if (!review || typeof review !== 'object') {
      publicationGate = publicationGate === 'local-only' ? 'needs-independent-review' : publicationGate;
    } else {
      const creatorFamily = normalizeModelFamily(review.creator_model_family);
      const reviewerFamily = normalizeModelFamily(review.reviewer_model_family);
      const reviewEvidence = evidenceByLocator.get(review.evidence_locator);
      if (!creatorFamily
        || !reviewerFamily
        || creatorFamily === reviewerFamily
        || review.result !== 'pass'
        || review.trail_digest !== trailDigest
        || reviewEvidence?.reviewed_trail_digest !== trailDigest
        || !evidenceSupports(reviewEvidence, 'independent-review', runEvidenceByLocator)) {
        defects.push(defect('publication_gate_unmet', null, 'independent review provenance is incomplete, unverified, self-authored, or not bound to this trail digest'));
      }
    }
  }

  if (defects.length > 0 && publicationGate !== 'needs-redaction') {
    publicationGate = 'blocked';
  } else if (defects.length === 0 && targetRequiresApproval && publicationGate === 'local-only') {
    publicationGate = 'ready-for-review';
  }

  if (!PUBLICATION_GATES.includes(publicationGate)) {
    throw new DecisionTrailError('internal_error', `unknown publication gate ${publicationGate}`);
  }

  return {
    ...sanitizedMetadata.value,
    entries,
    audit: {
      row_count: entries.length,
      defects,
      sanitization_changes: [
        ...sanitizedMetadata.changes,
        ...entries.flatMap((entry) => entry.sanitization_changes ?? []),
      ],
      complete: defects.length === 0,
    },
    publication_gate: publicationGate,
    trail_digest: trailDigest,
  };
}

export function validateTrail(input, options = {}) {
  return buildTrailPacket(
    { ...input, mode: options.mode ?? input?.mode ?? 'verify-persisted' },
    options,
  ).audit;
}
