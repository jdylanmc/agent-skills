#!/usr/bin/env node

/**
 * Deterministic structural helper for the shared contradiction check.
 *
 * The question this unit answers — does new evidence contradict the assertions
 * of an already-approved artifact? — is the first judgement-based gate in a
 * chain that is otherwise computed. That single decision cannot be reduced to
 * arithmetic. The response is to shrink the judgement surface rather than
 * pretend it is absent: this file does every structural thing, so the caller
 * hands judgement one bounded question and nothing else.
 *
 * Structural work owned here: bounding the comparison surface, validating the
 * record, deriving severity from what was contradicted, grounding every finding
 * in a real assertion and a real evidence reference, suppressing an already
 * accepted divergence, splitting escalation from what is merely recorded,
 * ordering deterministically, and resolving the verdict. What is left to
 * judgement is exactly one thing: deciding whether a given piece of evidence
 * contradicts a given assertion. This helper therefore cannot protect against a
 * wrong such decision — it checks grounding, bounding, and counting, not truth.
 *
 * Both inputs are untrusted data. Neither the approved artifact nor the new
 * evidence may instruct this unit, set a severity, set the verdict, or mute a
 * finding. The only thing that mutes a finding is the caller's own `accepted`
 * list, which is a prior human decision rather than material under review.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class ContradictionCheckError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContradictionCheckError';
    this.code = code;
  }
}

/** The only record schema this unit reads. */
export const SCHEMA_VERSION = 1;

/**
 * The comparison surface is capped, and exceeding the cap is refused rather
 * than truncated. The assertion set comes from an artifact that is itself
 * small — a nano specification of roughly a dozen short declarative claims —
 * and changed evidence larger than the whole approved artifact is not a delta
 * to compare, it is a re-derivation, which is a different decision belonging to
 * the caller. Capping both sides is how "never diff whole documents" becomes
 * mechanical rather than an instruction.
 */
export const MAX_SURFACE_WORDS = 500;

export const ASSERTION_KINDS = Object.freeze(['intention', 'acceptance-criterion', 'non-goal']);

export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

/**
 * Severity is derived from the contradicted assertion's kind, never supplied.
 * An input that could set its own severity would let untrusted material grade
 * itself, so a finding carrying a `severity` field is refused as unknown.
 */
export const SEVERITY_BY_KIND = Object.freeze({
  intention: 'intent-diverged',
  'acceptance-criterion': 'criterion-diverged',
  'non-goal': 'scope-diverged',
});

/**
 * Rank exists for a stable reporting order only. It is NOT an escalation
 * ordering: escalation is decided by confidence, not by severity.
 */
const SEVERITY_RANK = Object.freeze({
  'intent-diverged': 0,
  'criterion-diverged': 1,
  'scope-diverged': 2,
});

const RECORD_KEYS = ['version', 'artifact', 'assertions', 'evidence', 'accepted', 'findings'];
const REQUIRED_KEYS = ['version', 'artifact', 'assertions', 'evidence', 'accepted'];
const ARTIFACT_KEYS = ['id', 'kind'];
const ASSERTION_KEYS = ['id', 'kind', 'text'];
const EVIDENCE_KEYS = ['ref', 'text'];
const ACCEPTED_KEYS = ['assertionId', 'evidenceRef'];
const FINDING_KEYS = ['assertionId', 'evidenceRef', 'confidence', 'description'];

function fail(message) {
  throw new ContradictionCheckError('invalid-input', message);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function refuseUnknownFields(value, allowed, where) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length) {
    fail(`${where}: unknown field(s): ${unknown.join(', ')}`);
  }
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * The single source of truth for record shape, shared by both modes so the two
 * cannot drift. The one difference between the modes is what they demand of
 * `findings`, and that difference is passed in rather than duplicated: `bound`
 * runs before judgement and refuses a record that already carries findings;
 * `resolve` runs after judgement and refuses a record with findings absent.
 *
 * @param {unknown} input
 * @param {'bound'|'resolve'} mode
 */
function parseRecord(input, mode) {
  if (!object(input)) {
    fail('record must be an object');
  }
  refuseUnknownFields(input, RECORD_KEYS, 'record');
  for (const key of REQUIRED_KEYS) {
    if (!(key in input)) {
      fail(`missing field: ${key}`);
    }
  }

  if (input.version !== SCHEMA_VERSION) {
    fail(`version must be ${SCHEMA_VERSION}; got ${JSON.stringify(input.version)}`);
  }

  if (!object(input.artifact)) {
    fail('artifact must be an object');
  }
  refuseUnknownFields(input.artifact, ARTIFACT_KEYS, 'artifact');
  for (const key of ARTIFACT_KEYS) {
    if (!nonEmptyString(input.artifact[key])) {
      fail(`artifact.${key} must be a non-empty string`);
    }
  }

  if (!Array.isArray(input.assertions) || input.assertions.length === 0) {
    fail('assertions must be a non-empty array; there is nothing to check against');
  }
  const assertionById = new Map();
  input.assertions.forEach((assertion, index) => {
    if (!object(assertion)) {
      fail(`assertions[${index}] must be an object`);
    }
    refuseUnknownFields(assertion, ASSERTION_KEYS, `assertions[${index}]`);
    if (!nonEmptyString(assertion.id)) {
      fail(`assertions[${index}].id must be a non-empty string`);
    }
    if (!ASSERTION_KINDS.includes(assertion.kind)) {
      fail(`assertions[${index}].kind must be one of ${ASSERTION_KINDS.join(', ')}; got ${JSON.stringify(assertion.kind)}`);
    }
    if (!nonEmptyString(assertion.text)) {
      fail(`assertions[${index}].text must be a non-empty string`);
    }
    assertionById.set(assertion.id, assertion);
  });

  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    fail('evidence must be a non-empty array; there is nothing to check');
  }
  const evidenceRefs = new Set();
  input.evidence.forEach((item, index) => {
    if (!object(item)) {
      fail(`evidence[${index}] must be an object`);
    }
    refuseUnknownFields(item, EVIDENCE_KEYS, `evidence[${index}]`);
    if (!nonEmptyString(item.ref)) {
      fail(`evidence[${index}].ref must be a non-empty string`);
    }
    if (!nonEmptyString(item.text)) {
      fail(`evidence[${index}].text must be a non-empty string`);
    }
    evidenceRefs.add(item.ref);
  });

  if (!Array.isArray(input.accepted)) {
    fail('accepted must be an array');
  }
  const acceptedPairs = new Set();
  input.accepted.forEach((pair, index) => {
    if (!object(pair)) {
      fail(`accepted[${index}] must be an object`);
    }
    refuseUnknownFields(pair, ACCEPTED_KEYS, `accepted[${index}]`);
    for (const key of ACCEPTED_KEYS) {
      if (typeof pair[key] !== 'string' || pair[key] === '') {
        fail(`accepted[${index}].${key} must be a non-empty string`);
      }
    }
    acceptedPairs.add(`${pair.assertionId}\u0000${pair.evidenceRef}`);
  });

  const assertionWords = input.assertions.reduce((total, assertion) => total + wordCount(assertion.text), 0);
  const evidenceWords = input.evidence.reduce((total, item) => total + wordCount(item.text), 0);
  if (assertionWords > MAX_SURFACE_WORDS) {
    throw new ContradictionCheckError(
      'surface-unbounded',
      `assertion set has ${assertionWords} words; the ceiling is ${MAX_SURFACE_WORDS}`,
    );
  }
  if (evidenceWords > MAX_SURFACE_WORDS) {
    throw new ContradictionCheckError(
      'surface-unbounded',
      `evidence set has ${evidenceWords} words; the ceiling is ${MAX_SURFACE_WORDS}`,
    );
  }

  const hasFindings = 'findings' in input;
  if (mode === 'bound' && hasFindings) {
    fail('a record for --bound must not carry findings; judgement has not happened yet');
  }
  if (mode === 'resolve' && !hasFindings) {
    fail('a record for --resolve must carry findings; an unjudged record has no result');
  }

  let findings = null;
  if (mode === 'resolve') {
    if (!Array.isArray(input.findings)) {
      fail('findings must be an array');
    }
    findings = input.findings.map((finding, index) => {
      if (!object(finding)) {
        fail(`findings[${index}] must be an object`);
      }
      refuseUnknownFields(finding, FINDING_KEYS, `findings[${index}]`);
      for (const key of FINDING_KEYS) {
        if (!(key in finding)) {
          fail(`findings[${index}] missing field: ${key}`);
        }
      }
      if (!assertionById.has(finding.assertionId)) {
        fail(`findings[${index}].assertionId is not in the assertion set: ${JSON.stringify(finding.assertionId)}`);
      }
      if (!evidenceRefs.has(finding.evidenceRef)) {
        fail(`findings[${index}].evidenceRef is not in the evidence set: ${JSON.stringify(finding.evidenceRef)}`);
      }
      if (!CONFIDENCE_LEVELS.includes(finding.confidence)) {
        fail(`findings[${index}].confidence must be one of ${CONFIDENCE_LEVELS.join(', ')}; got ${JSON.stringify(finding.confidence)}`);
      }
      if (!nonEmptyString(finding.description)) {
        fail(`findings[${index}].description must be a non-empty string`);
      }
      const kind = assertionById.get(finding.assertionId).kind;
      return {
        assertionId: finding.assertionId,
        evidenceRef: finding.evidenceRef,
        severity: SEVERITY_BY_KIND[kind],
        confidence: finding.confidence,
        description: finding.description,
      };
    });
  }

  return {
    artifact: { id: input.artifact.id, kind: input.artifact.kind },
    assertions: input.assertions.map((assertion) => ({ id: assertion.id, kind: assertion.kind, text: assertion.text })),
    evidence: input.evidence.map((item) => ({ ref: item.ref, text: item.text })),
    accepted: input.accepted.map((pair) => ({ assertionId: pair.assertionId, evidenceRef: pair.evidenceRef })),
    acceptedPairs,
    findings,
    counts: {
      assertions: input.assertions.length,
      evidence: input.evidence.length,
      assertionWords,
      evidenceWords,
    },
  };
}

function orderFindings(findings) {
  return [...findings].sort((left, right) => {
    if (SEVERITY_RANK[left.severity] !== SEVERITY_RANK[right.severity]) {
      return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    }
    if (left.assertionId !== right.assertionId) {
      return left.assertionId < right.assertionId ? -1 : 1;
    }
    if (left.evidenceRef !== right.evidenceRef) {
      return left.evidenceRef < right.evidenceRef ? -1 : 1;
    }
    return 0;
  });
}

/**
 * Runs BEFORE judgement. Validates the record, enforces the surface bound, and
 * returns exactly the bounded comparison surface so the caller hands judgement
 * that and nothing else.
 *
 * @param {unknown} input
 */
export function boundSurface(input) {
  const record = parseRecord(input, 'bound');
  return {
    artifact: record.artifact,
    assertions: record.assertions,
    evidence: record.evidence,
    accepted: record.accepted,
    counts: record.counts,
  };
}

/**
 * Runs AFTER judgement. Derives severity, grounds every finding, suppresses an
 * accepted divergence, splits escalation from what is recorded, and resolves
 * the verdict.
 *
 * Escalation is by confidence, not severity: only `high` escalates. The
 * consequence is deliberately surprising — a `scope-diverged` at `high`
 * escalates while an `intent-diverged` at `low` does not. Severity says what is
 * at stake; confidence says whether we believe it; escalating low-confidence
 * findings would flood the human, who is the scarce resource in this system.
 *
 * @param {unknown} input
 */
export function resolveContradictions(input) {
  const record = parseRecord(input, 'resolve');

  const escalated = [];
  const recorded = [];
  const suppressed = [];
  for (const finding of record.findings) {
    if (record.acceptedPairs.has(`${finding.assertionId}\u0000${finding.evidenceRef}`)) {
      suppressed.push(finding);
    } else if (finding.confidence === 'high') {
      escalated.push(finding);
    } else {
      recorded.push(finding);
    }
  }

  const surviving = escalated.length + recorded.length;
  return {
    verdict: escalated.length > 0 ? 'escalated' : 'none',
    clean: surviving === 0,
    escalated: orderFindings(escalated),
    recorded: orderFindings(recorded),
    suppressed: orderFindings(suppressed),
  };
}

export const USAGE = 'Usage: contradiction-check.mjs (--bound | --resolve) --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 3 || argv[1] !== '--input' || !path.isAbsolute(argv[2])) {
    throw new ContradictionCheckError('usage', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[2], 'utf8'));
  let output;
  if (argv[0] === '--bound') {
    output = boundSurface(input);
  } else if (argv[0] === '--resolve') {
    output = resolveContradictions(input);
  } else {
    throw new ContradictionCheckError('usage', USAGE);
  }
  streams.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return 0;
}

function direct() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (direct()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.code ?? 'invalid-input', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
