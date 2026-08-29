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
 * the caller.
 *
 * A word count bounds how many distinct claims the surface can carry; it is NOT
 * a size bound. One whitespace-delimited token can be arbitrarily long, and a
 * script written without whitespace (many CJK texts) counts an entire paragraph
 * as a single word. So the word bound alone cannot stop a surface too large to
 * compare from arriving as "one word".
 */
export const MAX_SURFACE_WORDS = 500;

/**
 * The derived size bound that the word bound cannot supply. Written as a
 * multiple of the word bound rather than as a second magic number so the
 * derivation is visible: at roughly ten characters per claim-bearing word, a
 * surface past this is too large to compare regardless of how few whitespace
 * tokens it contains. This bounds size, not intent — it refuses a surface too
 * large to be a delta, but it cannot tell that a short whole document was
 * pasted in as evidence. That remains the caller's judgement.
 */
export const MAX_SURFACE_CHARACTERS = MAX_SURFACE_WORDS * 10;

/**
 * The identifier ceiling. An identifier is a stable label, not a payload, and a
 * label longer than the whole comparison surface is not a label — it is a
 * document smuggled through an id field. So it is derived from the surface
 * character bound rather than introduced as a fresh magic number: nothing that
 * would not fit in the surface may masquerade as one of its labels. It caps
 * `artifact.id`, `artifact.kind`, `assertions[].id`, `evidence[].ref`, and both
 * members of every `accepted` pair. A finding's identifiers are not capped here
 * because they must ground in an already-capped assertion id and evidence ref.
 */
export const MAX_IDENTIFIER_CHARACTERS = MAX_SURFACE_CHARACTERS;

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

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/**
 * One source of truth for "is this a usable string", per the laziness
 * discipline: a validator that disagrees with another validator is two bugs
 * waiting to diverge. A string is usable when, after trimming ECMAScript
 * whitespace (what `String.prototype.trim` removes — not only ASCII spaces and
 * tabs, but every Unicode whitespace code point) and stripping zero-width and
 * other Unicode format characters (`\p{Cf}`), meaningful characters remain. A
 * lone zero-width space is therefore not a non-empty identifier. Trimming and
 * stripping decide emptiness only; the returned record keeps each value's
 * original characters unchanged — no format character is removed from a stored
 * identifier or text.
 */
const FORMAT_OR_ZERO_WIDTH = /[\p{Cf}\u200B-\u200D\uFEFF]/gu;
function usableString(value) {
  return typeof value === 'string'
    && value.replace(FORMAT_OR_ZERO_WIDTH, '').trim() !== '';
}

/**
 * An identifier is a stable label, not a payload. Refused in one place so the
 * rule cannot drift between call sites: it must be a usable string, carry no
 * control character (U+0000–U+001F, U+007F), and be no longer than the
 * identifier ceiling. The control-character refusal states the contract;
 * belt-and-braces with `pairKey`'s collision-proof encoding it means a future
 * widening of the identifier vocabulary cannot silently reintroduce a false
 * clean check through a serialization collision. The ceiling refuses a whole
 * document smuggled through a label field.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/;
function refuseBadIdentifier(value, where) {
  if (!usableString(value)) {
    fail(`${where} must be a non-empty identifier`);
  }
  if (CONTROL_CHARACTERS.test(value)) {
    fail(`${where} must not contain a control character`);
  }
  if (characterCount(value) > MAX_IDENTIFIER_CHARACTERS) {
    fail(`${where} exceeds the identifier ceiling of ${MAX_IDENTIFIER_CHARACTERS} characters; an identifier longer than the whole comparison surface is not a label`);
  }
}

/**
 * The suppression and finding-identity key. `JSON.stringify` of a two-element
 * array is an unambiguous encoding: distinct (assertionId, evidenceRef) pairs
 * cannot serialize to the same string, unlike a delimiter-joined form where an
 * identifier containing the delimiter collides with a different pair. This is
 * the braces to the control-character refusal's belt.
 */
function pairKey(assertionId, evidenceRef) {
  return JSON.stringify([assertionId, evidenceRef]);
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * One source of truth for "every field on this schema object is a supplied, own
 * property". It refuses two failure modes together so no schema object can be
 * validated for one and not the other:
 *
 * - an unknown own field (something not in `allowed`), which is how untrusted
 *   material would smuggle a `severity`, an `instruction`, or a proposed edit;
 * - an allowed field reachable only through the prototype chain, which is how a
 *   record built with `Object.create` mutes a real finding — `Object.keys` sees
 *   nothing unknown, yet the value is later read through the prototype. `key in`
 *   walks the prototype where `hasOwnProperty` does not, so a field must be both
 *   present and own.
 *
 * Applied to the record and to every nested object — `artifact`, each
 * assertion, each evidence item, each accepted pair, each finding — so the
 * inherited-field rule has one home rather than being re-applied per object.
 */
function refuseUnknownOrInheritedFields(value, allowed, where) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length) {
    fail(`${where}: unknown field(s): ${unknown.join(', ')}`);
  }
  for (const key of allowed) {
    if (key in value && !hasOwn(value, key)) {
      fail(`${where}: field must be an own property, not inherited: ${key}`);
    }
  }
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function characterCount(text) {
  return [...text].length;
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
  refuseUnknownOrInheritedFields(input, RECORD_KEYS, 'record');
  for (const key of REQUIRED_KEYS) {
    if (!hasOwn(input, key)) {
      fail(`missing field: ${key}`);
    }
  }

  if (input.version !== SCHEMA_VERSION) {
    fail(`version must be ${SCHEMA_VERSION}; got ${JSON.stringify(input.version)}`);
  }

  if (!object(input.artifact)) {
    fail('artifact must be an object');
  }
  refuseUnknownOrInheritedFields(input.artifact, ARTIFACT_KEYS, 'artifact');
  for (const key of ARTIFACT_KEYS) {
    refuseBadIdentifier(input.artifact[key], `artifact.${key}`);
  }

  if (!Array.isArray(input.assertions) || input.assertions.length === 0) {
    fail('assertions must be a non-empty array; there is nothing to check against');
  }
  const assertionById = new Map();
  input.assertions.forEach((assertion, index) => {
    if (!object(assertion)) {
      fail(`assertions[${index}] must be an object`);
    }
    refuseUnknownOrInheritedFields(assertion, ASSERTION_KEYS, `assertions[${index}]`);
    refuseBadIdentifier(assertion.id, `assertions[${index}].id`);
    if (!ASSERTION_KINDS.includes(assertion.kind)) {
      fail(`assertions[${index}].kind must be one of ${ASSERTION_KINDS.join(', ')}; got ${JSON.stringify(assertion.kind)}`);
    }
    if (!usableString(assertion.text)) {
      fail(`assertions[${index}].text must be a non-empty string`);
    }
    if (assertionById.has(assertion.id)) {
      fail(`assertions[${index}].id duplicates an earlier assertion id: ${JSON.stringify(assertion.id)}`);
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
    refuseUnknownOrInheritedFields(item, EVIDENCE_KEYS, `evidence[${index}]`);
    refuseBadIdentifier(item.ref, `evidence[${index}].ref`);
    if (!usableString(item.text)) {
      fail(`evidence[${index}].text must be a non-empty string`);
    }
    if (evidenceRefs.has(item.ref)) {
      fail(`evidence[${index}].ref duplicates an earlier evidence ref: ${JSON.stringify(item.ref)}`);
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
    refuseUnknownOrInheritedFields(pair, ACCEPTED_KEYS, `accepted[${index}]`);
    for (const key of ACCEPTED_KEYS) {
      refuseBadIdentifier(pair[key], `accepted[${index}].${key}`);
    }
    // A duplicate accepted pair is a caller defect, never a second mute: the
    // (assertionId, evidenceRef) pair is the identity of one divergence, the
    // same identity rule findings key on, so a repeated acceptance is refused
    // rather than silently collapsed. Refusing here keeps the acceptance side
    // and the finding side from disagreeing about what one divergence is.
    const key = pairKey(pair.assertionId, pair.evidenceRef);
    if (acceptedPairs.has(key)) {
      fail(`accepted[${index}] duplicates an earlier accepted pair: (${pair.assertionId}, ${pair.evidenceRef})`);
    }
    acceptedPairs.add(key);
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

  const assertionCharacters = input.assertions.reduce((total, assertion) => total + characterCount(assertion.text), 0);
  const evidenceCharacters = input.evidence.reduce((total, item) => total + characterCount(item.text), 0);
  if (assertionCharacters > MAX_SURFACE_CHARACTERS) {
    throw new ContradictionCheckError(
      'surface-unbounded',
      `assertion set has ${assertionCharacters} characters; the ceiling is ${MAX_SURFACE_CHARACTERS}`,
    );
  }
  if (evidenceCharacters > MAX_SURFACE_CHARACTERS) {
    throw new ContradictionCheckError(
      'surface-unbounded',
      `evidence set has ${evidenceCharacters} characters; the ceiling is ${MAX_SURFACE_CHARACTERS}`,
    );
  }

  const hasFindings = hasOwn(input, 'findings');
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
    const seenFindingPairs = new Set();
    let descriptionCharacters = 0;
    findings = input.findings.map((finding, index) => {
      if (!object(finding)) {
        fail(`findings[${index}] must be an object`);
      }
      refuseUnknownOrInheritedFields(finding, FINDING_KEYS, `findings[${index}]`);
      for (const key of FINDING_KEYS) {
        if (!hasOwn(finding, key)) {
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
      if (!usableString(finding.description)) {
        fail(`findings[${index}].description must be a non-empty string`);
      }
      descriptionCharacters += characterCount(finding.description);
      // One divergence is one finding. The (assertionId, evidenceRef) pair is
      // the identity of a divergence — the very key suppression uses — so a
      // repeated pair cannot be allowed to land in escalated and recorded at
      // once, nor be emitted twice. Refusing it keeps the two from disagreeing.
      const identity = pairKey(finding.assertionId, finding.evidenceRef);
      if (seenFindingPairs.has(identity)) {
        fail(`findings[${index}] duplicates an earlier finding pair: (${finding.assertionId}, ${finding.evidenceRef})`);
      }
      seenFindingPairs.add(identity);
      const kind = assertionById.get(finding.assertionId).kind;
      return {
        assertionId: finding.assertionId,
        evidenceRef: finding.evidenceRef,
        severity: SEVERITY_BY_KIND[kind],
        confidence: finding.confidence,
        description: finding.description,
      };
    });
    // The finding descriptions are a third comparison side and must be bounded
    // like the assertion and evidence sides, or an unbounded description would
    // slip past every other cap. The same character ceiling applies to the
    // total of all descriptions, refused with the finding-description side named.
    if (descriptionCharacters > MAX_SURFACE_CHARACTERS) {
      throw new ContradictionCheckError(
        'surface-unbounded',
        `finding descriptions have ${descriptionCharacters} characters; the ceiling is ${MAX_SURFACE_CHARACTERS}`,
      );
    }
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
      assertionCharacters,
      evidenceCharacters,
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
    if (record.acceptedPairs.has(pairKey(finding.assertionId, finding.evidenceRef))) {
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
  // Validate the mode and argument shape fully BEFORE reading the file, so a
  // usage error is classified as usage regardless of unrelated filesystem
  // state: an unknown mode is a usage failure whether or not the path exists.
  const mode = argv[0];
  if (argv.length !== 3
    || (mode !== '--bound' && mode !== '--resolve')
    || argv[1] !== '--input'
    || !path.isAbsolute(argv[2])) {
    throw new ContradictionCheckError('usage', USAGE);
  }
  // Reading and parsing the input file is a boundary of trust, and its failures
  // are classified into this unit's own vocabulary rather than leaking Node's
  // ENOENT or EISDIR. The underlying condition is carried in the message so the
  // cause is not swallowed.
  let input;
  try {
    input = JSON.parse(fs.readFileSync(argv[2], 'utf8'));
  } catch (cause) {
    throw new ContradictionCheckError(
      'unreadable-input',
      `cannot read or parse ${argv[2]}: ${cause.message}`,
    );
  }
  const output = mode === '--bound' ? boundSurface(input) : resolveContradictions(input);
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
