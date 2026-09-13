#!/usr/bin/env node

/**
 * Deterministic persistence for a human-aligned Discovery foundation.
 *
 * Discovery must be able to start a later run from the exact shared
 * understanding a human aligned on, not from conversation memory. That requires
 * a durable artifact. This module owns that artifact: it renders the aligned
 * foundation to a single Markdown file beneath `docs/agent/discovery/`, refuses
 * to silently drop any previously recorded durable entry, appends one immutable
 * history line per aligned cycle, and stages the write so a failure leaves the
 * prior authority untouched.
 *
 * Retention is per field and by multiset. A durable entry the human previously
 * aligned on — in any durable set or the frontier — is never
 * removed by a write. It must reappear in the SAME field with at least its prior
 * multiplicity, or be discharged by a field-qualified, count-aware `Resolved`
 * record. A resolution record is `{field, entry, resolution}`; it discharges
 * exactly one occurrence in exactly its named field, and only a record freshly
 * added by this write discharges a drop. Reappearing in a different field is not
 * retention: an entry that leaves one section and shows up in another is refused
 * (`foundation-regression`) naming both fields, because laundering a confirmed
 * fact into an open question is a silent rewrite, not a carry-forward. Prior
 * `Resolved` records are preserved as a multiset — every prior record reappears
 * with at least its prior count — so none is dropped or rewritten, and a second,
 * conflicting resolution for the same `(field, entry)` is refused unless it is
 * byte-identical to the existing one.
 *
 * The retention check compares scalar entries by exact text and structured
 * entries by canonical JSON. It proves no prior entry silently *vanished*. It
 * cannot prove an entry's *meaning* survived: a reworded entry whose canonical
 * value no longer appears reads as a drop, and a caller intent on hiding a
 * change could keep the original entry in `Resolved` while burying an altered
 * meaning elsewhere. That proxy is the seam this check cannot see.
 *
 * The alignment gate is bound, not asserted. Every new write must carry the
 * complete canonical findings packet, `alignedFindingsDigest`, an explicit
 * `domainModel`, and a receipt chain. `domainModelBasisDigest` must equal the
 * aligned-findings digest, `domainModelDigest` must equal the canonical digest
 * of the validated domain model, and `frontierBasisDigest` must equal that
 * domain-model digest. `frontierDigest` must equal the canonical digest of that
 * model digest plus the validated frontier and next action. The helper
 * recomputes all content digests and refuses
 * (`alignment-unbound` or `derivation-unbound`) on mismatch. The binding proves
 * the persisted findings and model are byte-for-byte the values that were
 * digested; it does NOT prove a human understood them.
 *
 * Persistence is bound to the revision the cycle rehydrated. The intake carries
 * `expectedPriorRevision` (`null` only for a genuine first cycle). It is checked
 * FIRST — before retention, history, or rendering: when the destination exists
 * and its current revision differs, or is absent when a revision was expected,
 * or already exists when `null` was declared, the write refuses with
 * `concurrent-modification`. This wider guard covers the whole
 * rehydrate-to-persist interval; the immediate pre-rename recheck is a narrower
 * second guard covering only the instant before the rename.
 *
 * The write is failure-atomic. New bytes are staged to a sibling temporary file,
 * reread and structurally re-parsed, and the destination is rechecked; only then
 * is the staged file `rename`d over the destination. The `rename` is the single
 * commit point. Any failure detected BEFORE it — staging, reread, re-parse,
 * deep-compare, or the pre-rename recheck — leaves the prior authority untouched
 * and attempts to remove the staged file; if that cleanup itself fails, the
 * primary error keeps its code and its message additionally names the staged
 * file left behind, and no raw filesystem error escapes or masks the primary
 * failure. A failure detected AFTER the rename is reported as
 * `post-commit-verification-failed`, whose message states plainly that the
 * destination has already been replaced; when the reread fails it names only the
 * revision this write intended to commit and states that the current on-disk
 * revision is unknown, because verification could not read it. It is never
 * reported as `verification-failed`, which would falsely imply the original
 * survived. `rename` is atomic within one filesystem; the recheck narrows but
 * does not eliminate the race, because a writer can still land between the
 * recheck and the rename.
 *
 * The expected-prior-revision guard is checked before any filesystem state is
 * created: the bounded destination is inspected without creating a directory, so
 * a stale refusal leaves the filesystem exactly as it was. Missing directories
 * are created only after the guard passes.
 *
 * `renderFoundation` and `parseFoundation` are NOT unconditional inverses. The
 * parser round-trips exactly the LF-terminated documents the renderer produces;
 * CRLF input is normalized to LF on read, so `render(parse(crlfBytes))` differs
 * from `crlfBytes` by design.
 *
 * The post-write reread proves the persisted bytes can be read back and match
 * what was written, and re-parses them to prove the recovered foundation is the
 * intended one. It is write verification only. It is NOT evidence that a later,
 * fresh, or compacted agent grounded itself on those bytes; that guarantee
 * belongs to `foundation-rehydrate` at the start of the next run (AC7).
 *
 * Persisting a new revision moves the artifact's whole-file digest. That
 * movement never invalidates an approved specification: under
 * `spec/_atoms/discovery-source` a moved digest on an approved specification
 * produces `held`, and only `_base/_atoms/contradiction-check` may reopen
 * approved work. This module does not approve, invalidate, re-derive, signal,
 * or reach any specification, and it duplicates neither unit's logic.
 */

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class FoundationPersistError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FoundationPersistError';
    this.code = code;
  }
}

export const STATE_VERSION = 1;
export const SCHEMA_VERSION = 2;
const SUPPORTED_SCHEMA_VERSIONS = new Set(['1', String(SCHEMA_VERSION)]);

/**
 * The durable sets the retention guarantee protects. Frontier is the
 * current cycle's disposition but is also retained, because an unresolved
 * frontier entry must survive across runs.
 */
export const DURABLE_SETS = Object.freeze([
  'confirmedFacts',
  'evidenceReferences',
  'decisions',
  'constraints',
  'assumptions',
  'contradictions',
  'openQuestions',
  'sourceClaims',
  'relationshipClaims',
  'boundaryClaims',
  'risks',
  'scope',
  'exclusions',
  'domainModel',
]);

/** Every distinct field a rehydrated Discovery state exposes (AC5). */
export const FOUNDATION_FIELDS = Object.freeze([...DURABLE_SETS, 'frontier', 'nextAction']);

/** The fields whose prior entries must be retained across a write. */
export const RETAINED_FIELDS = Object.freeze([...DURABLE_SETS, 'frontier']);

/** Fields whose upstream contracts produce JSON-compatible records, not text. */
export const STRUCTURED_RECORD_FIELDS = Object.freeze([
  'relationshipClaims',
  'boundaryClaims',
  'domainModel',
]);

const STRUCTURED_RECORD_FIELD_SET = new Set(STRUCTURED_RECORD_FIELDS);

/** Discovery's alignment vocabulary. Only these two aligned results persist. */
export const PERSISTABLE_ALIGNMENT = Object.freeze(['verified', 'corrected']);

/** Human-aligned fields, excluding post-alignment domain/frontier derivations. */
export const ALIGNED_FINDING_FIELDS = Object.freeze(
  DURABLE_SETS.filter((field) => field !== 'domainModel'),
);

/** Every field emitted by the documented-findings atom. */
export const DOCUMENTED_FINDINGS_FIELDS = Object.freeze([
  ...ALIGNED_FINDING_FIELDS,
  'resolved',
]);

/** Fields introduced by issue #156; genuine schema-1 artifacts omit all five. */
const POST_SCHEMA_1_FIELDS = Object.freeze([
  'sourceClaims',
  'relationshipClaims',
  'boundaryClaims',
  'risks',
  'domainModel',
]);
const POST_SCHEMA_1_FIELD_SET = new Set(POST_SCHEMA_1_FIELDS);

/** The token the persisted artifact records, matching what discovery-source requires. */
export const CONFIRMED = 'confirmed';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION_RE = /^[a-f0-9]{64}$/;
const UTC_TIMESTAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/;
const HEADING_RE = /^#{1,6}\s/;

/** The one directory, in POSIX form, that a foundation locator may name. */
export const DISCOVERY_DIR_POSIX = 'docs/agent/discovery';
const LOCATOR_FILE_RE = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

/**
 * The single bounded-locator validator shared across persist and rehydrate. A
 * locator must be a normalized repository-relative POSIX path that is exactly
 * `docs/agent/discovery/<slug>.md`: no absolute paths, no backslashes, no `.`
 * or `..` segments, no empty segments, and nothing outside that directory. It
 * returns the ACTUAL validated locator and its slug, never a value derived from
 * resolving the path on disk. `makeError(code, message)` builds the caller's
 * own error type so an invalid locator is a caller defect (`invalid-input`),
 * not a recovery state.
 */
export function validateBoundedLocator(locator, makeError) {
  const fail = (message) => { throw makeError('invalid-input', message); };
  if (typeof locator !== 'string' || locator.trim() === '') {
    fail('locator must be non-empty text');
  }
  if (locator.includes('\\')) {
    fail(`locator must not contain a backslash: ${JSON.stringify(locator)}`);
  }
  if (locator.startsWith('/') || path.isAbsolute(locator)) {
    fail(`locator must be a repository-relative path, not absolute: ${JSON.stringify(locator)}`);
  }
  const segments = locator.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`locator must not contain empty, "." or ".." segments: ${JSON.stringify(locator)}`);
  }
  if (segments.length !== 4 || segments[0] !== 'docs' || segments[1] !== 'agent' || segments[2] !== 'discovery') {
    fail(`locator must be ${DISCOVERY_DIR_POSIX}/<slug>.md: ${JSON.stringify(locator)}`);
  }
  const match = LOCATOR_FILE_RE.exec(segments[3]);
  if (!match) {
    fail(`locator file must be <slug>.md with slug matching ${SLUG_RE}: ${JSON.stringify(locator)}`);
  }
  return { locator, slug: match[1], segments };
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * A canonical RFC 3339 UTC timestamp is more than a shape. After the lexical
 * check, the calendar and clock ranges are validated and the parsed instant is
 * confirmed to round-trip to the same fields, so an impossible date or time
 * such as `2026-99-99T99:99:99Z` is refused as `invalid-input`.
 */
function assertRfc3339Utc(value, label) {
  assertSingleLine(value, label);
  const match = UTC_TIMESTAMP_RE.exec(value);
  if (!match) {
    throw new FoundationPersistError('invalid-input', `${label} must be a canonical RFC 3339 UTC timestamp (YYYY-MM-DDThh:mm:ss[.sss]Z)`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const monthDays = month >= 1 && month <= 12
    ? (month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1])
    : 0;
  if (month < 1 || month > 12 || day < 1 || day > monthDays || hour > 23 || minute > 59 || second > 59) {
    throw new FoundationPersistError('invalid-input', `${label} names an impossible calendar or clock value: ${value}`);
  }
  const roundTrip = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() !== month - 1
    || roundTrip.getUTCDate() !== day
    || roundTrip.getUTCHours() !== hour
    || roundTrip.getUTCMinutes() !== minute
    || roundTrip.getUTCSeconds() !== second
  ) {
    throw new FoundationPersistError('invalid-input', `${label} does not round-trip to a real UTC instant: ${value}`);
  }
  return value;
}

const INTAKE_FIELDS = Object.freeze([
  'version',
  'repositoryRoot',
  'subject',
  'alignment',
  'alignedFindingsDigest',
  'domainModelBasisDigest',
  'domainModelDigest',
  'frontierBasisDigest',
  'frontierDigest',
  'expectedPriorRevision',
  'cycle',
  'timestamp',
  ...DURABLE_SETS,
  'frontier',
  'nextAction',
  'resolved',
]);

const SECTION_TITLES = Object.freeze({
  confirmedFacts: 'Confirmed Facts',
  evidenceReferences: 'Evidence References',
  decisions: 'Decisions',
  constraints: 'Constraints',
  assumptions: 'Assumptions',
  contradictions: 'Contradictions',
  openQuestions: 'Open Questions',
  sourceClaims: 'Source Claims',
  relationshipClaims: 'Relationship Claims',
  boundaryClaims: 'Boundary Claims',
  risks: 'Risks',
  scope: 'Scope',
  exclusions: 'Exclusions',
  domainModel: 'Domain Model',
  frontier: 'Frontier',
});

const LIST_SECTIONS = Object.freeze([...DURABLE_SETS, 'frontier']);
const SCHEMA_1_LIST_SECTIONS = Object.freeze(
  LIST_SECTIONS.filter((field) => !POST_SCHEMA_1_FIELD_SET.has(field)),
);
const SCHEMA_1_RETAINED_FIELD_SET = new Set(SCHEMA_1_LIST_SECTIONS);

const NONE_MARKER = '_None recorded._';
const HEADING = '# Discovery Foundation';

/** SHA-256 hex digest of exact bytes — the same revision definition discovery-source uses. */
export function revisionOf(bytes) {
  return createHash('sha256').update(bytes, 'utf8').digest('hex');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A key-order-independent canonical serialization. Objects serialize with keys
 * sorted; arrays preserve order because a list's order is meaningful.
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Legacy whole-payload digest utility retained for compatibility with callers
 * that must identify old inputs. `persistFoundation` does not accept this as a
 * schema-2 write binding; new writes use `alignedFindingsDigestOf`.
 */
export function alignedPayloadDigestOf(payload) {
  const canonical = {
    subject: { id: payload.subject.id, slug: payload.subject.slug },
    nextAction: payload.nextAction,
    frontier: payload.frontier,
    resolved: (payload.resolved ?? []).map((item) => ({ field: item.field, entry: item.entry, resolution: item.resolution })),
  };
  for (const field of DURABLE_SETS) {
    canonical[field] = payload[field] ?? [];
  }
  return createHash('sha256').update(canonicalize(canonical), 'utf8').digest('hex');
}

/**
 * Digest only the findings shown at the human alignment gate. Domain model,
 * frontier, and next action are produced afterward and bind back to this
 * digest through their basis receipts.
 */
export function alignedFindingsDigestOf(payload) {
  const canonical = {
    subject: { id: payload.subject.id, slug: payload.subject.slug },
    resolved: (payload.resolved ?? []).map((item) => ({
      field: item.field,
      entry: item.entry,
      resolution: item.resolution,
    })),
  };
  for (const field of ALIGNED_FINDING_FIELDS) {
    canonical[field] = payload[field] ?? [];
  }
  return createHash('sha256').update(canonicalize(canonical), 'utf8').digest('hex');
}

function assertSingleLine(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FoundationPersistError('invalid-input', `${label} must be non-empty text`);
  }
  if (/[\n\r]/.test(value)) {
    throw new FoundationPersistError('invalid-input', `${label} must be a single line`);
  }
  assertNoControlChars(value, label);
  return value;
}

/**
 * Reject every ASCII control character (U+0000–U+001F and U+007F) in a persisted
 * string. A NUL or other control byte inside a durable entry, a resolution, the
 * next action, the frontier, the subject identity, the cycle, or the timestamp
 * could collide two distinct records on a separator-joined key or smuggle bytes
 * past a line-oriented parser, so it is refused as `invalid-input` on both the
 * write path and on parse (R6). Newline and carriage return are control
 * characters too; callers that reach here through `assertSingleLine` have
 * already been refused for those with a clearer message.
 */
function assertNoControlChars(value, label) {
  const match = /[\u0000-\u001f\u007f]/.exec(value);
  if (match) {
    const code = match[0].codePointAt(0).toString(16).padStart(2, '0');
    throw new FoundationPersistError('invalid-input', `${label} must not contain the control character U+${code.toUpperCase().padStart(4, '0')}`);
  }
  return value;
}

/**
 * A rendered free-text line that could open Markdown structure is refused, the
 * same defence handoff bodies use. A value beginning `#`..`######` followed by
 * whitespace is an ATX heading and would restructure the persisted document.
 */
function assertFreeTextLine(value, label) {
  const line = assertSingleLine(value, label);
  if (HEADING_RE.test(line)) {
    throw new FoundationPersistError('invalid-input', `${label} must not begin a Markdown heading`);
  }
  return line;
}

function assertStringList(value, label) {
  if (!Array.isArray(value)) {
    throw new FoundationPersistError('invalid-input', `${label} must be an array`);
  }
  return value.map((entry, index) => assertSingleLine(entry, `${label}[${index}]`));
}

function assertJsonCompatible(value, label, ancestors = new Set()) {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    assertNoControlChars(value, label);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new FoundationPersistError('invalid-input', `${label} must contain only canonical finite JSON numbers`);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new FoundationPersistError('invalid-input', `${label} must not contain a circular reference`);
    }
    ancestors.add(value);
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new FoundationPersistError('invalid-input', `${label} must not contain sparse arrays`);
      }
      result.push(assertJsonCompatible(value[index], `${label}[${index}]`, ancestors));
    }
    ancestors.delete(value);
    return result;
  }
  if (isPlainObject(value) && Object.getPrototypeOf(value) === Object.prototype) {
    if (ancestors.has(value)) {
      throw new FoundationPersistError('invalid-input', `${label} must not contain a circular reference`);
    }
    ancestors.add(value);
    const result = {};
    for (const key of Object.keys(value)) {
      assertNoControlChars(key, `${label} key`);
      Object.defineProperty(result, key, {
        value: assertJsonCompatible(value[key], `${label}.${key}`, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    ancestors.delete(value);
    return result;
  }
  throw new FoundationPersistError(
    'invalid-input',
    `${label} must contain only JSON-compatible null, boolean, finite number, string, array, and plain-object values`,
  );
}

function assertStructuredRecord(value, label) {
  if (!isPlainObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new FoundationPersistError('invalid-input', `${label} must be a JSON-compatible object record`);
  }
  return assertJsonCompatible(value, label);
}

const CLAIM_KEYS = Object.freeze([
  'source',
  'target',
  'relationship',
  'direction',
  'evidence',
  'confidence',
  'notes',
]);
const DIRECTION_VALUES = Object.freeze(['directed', 'bidirectional', 'unknown']);
const CONFIDENCE_VALUES = Object.freeze(['confirmed', 'likely', 'contested', 'unknown']);

function assertExactKeys(value, requiredKeys, label) {
  const actual = Object.keys(value).sort();
  const required = [...requiredKeys].sort();
  const missing = required.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  const unknown = actual.filter((key) => !requiredKeys.includes(key));
  if (missing.length || unknown.length) {
    const details = [
      missing.length ? `missing field(s): ${missing.join(', ')}` : null,
      unknown.length ? `unknown field(s): ${unknown.join(', ')}` : null,
    ].filter(Boolean).join('; ');
    throw new FoundationPersistError('invalid-input', `${label} must contain exactly ${required.join(', ')} (${details})`);
  }
}

function assertEvidenceList(value, label) {
  if (!Array.isArray(value)) {
    throw new FoundationPersistError('invalid-input', `${label} must be an array of JSON-compatible object records`);
  }
  return value.map((entry, index) => assertStructuredRecord(entry, `${label}[${index}]`));
}

function assertEnum(value, allowed, label) {
  const checked = assertSingleLine(value, label);
  if (!allowed.includes(checked)) {
    throw new FoundationPersistError('invalid-input', `${label} must be one of ${allowed.join(', ')}`);
  }
  return checked;
}

function assertClaimRecord(value, label, kind) {
  if (!isPlainObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new FoundationPersistError('invalid-input', `${label} must be a ${kind} object record`);
  }
  assertExactKeys(value, CLAIM_KEYS, label);
  return {
    source: assertSingleLine(value.source, `${label}.source`),
    target: assertSingleLine(value.target, `${label}.target`),
    relationship: assertSingleLine(value.relationship, `${label}.relationship`),
    direction: assertEnum(value.direction, DIRECTION_VALUES, `${label}.direction`),
    evidence: assertEvidenceList(value.evidence, `${label}.evidence`),
    confidence: assertEnum(value.confidence, CONFIDENCE_VALUES, `${label}.confidence`),
    notes: assertStringList(value.notes, `${label}.notes`),
  };
}

function assertRelationshipClaim(value, label) {
  return assertClaimRecord(value, label, 'relationship claim');
}

function assertBoundaryClaim(value, label) {
  return assertClaimRecord(value, label, 'boundary claim');
}

export const DOMAIN_MODEL_KEYS = Object.freeze([
  'actors',
  'concepts',
  'systems',
  'terms',
  'states',
  'events',
  'relationships',
  'boundaries',
  'confidence',
  'unsettledSeams',
]);

const DOMAIN_ITEM_KEYS = Object.freeze([
  'kind',
  'name',
  'aliases',
  'evidence',
  'confidence',
  'notes',
]);
const DOMAIN_ITEM_KIND_BY_FIELD = Object.freeze({
  actors: 'actor',
  concepts: 'concept',
  systems: 'system',
});
const TERM_KEYS = Object.freeze([...DOMAIN_ITEM_KEYS, 'contested']);
const STATE_KEYS = Object.freeze([...DOMAIN_ITEM_KEYS, 'transitionsTo']);
const EVENT_KEYS = Object.freeze([...DOMAIN_ITEM_KEYS, 'emittedBy']);
const UNSETTLED_SEAM_KEYS = Object.freeze([
  'kind',
  'question',
  'evidence',
  'confidence',
  'notes',
]);

function assertDomainItem(value, label, expectedKind, requiredKeys = DOMAIN_ITEM_KEYS) {
  if (!isPlainObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new FoundationPersistError('invalid-input', `${label} must be a ${expectedKind} object record`);
  }
  assertExactKeys(value, requiredKeys, label);
  const kind = assertSingleLine(value.kind, `${label}.kind`);
  if (kind !== expectedKind) {
    throw new FoundationPersistError('invalid-input', `${label}.kind must be ${expectedKind}`);
  }
  const record = {
    kind,
    name: assertSingleLine(value.name, `${label}.name`),
    aliases: assertStringList(value.aliases, `${label}.aliases`),
    evidence: assertEvidenceList(value.evidence, `${label}.evidence`),
    confidence: assertEnum(value.confidence, CONFIDENCE_VALUES, `${label}.confidence`),
    notes: assertStringList(value.notes, `${label}.notes`),
  };
  if (expectedKind === 'term') {
    if (typeof value.contested !== 'boolean') {
      throw new FoundationPersistError('invalid-input', `${label}.contested must be a boolean`);
    }
    record.contested = value.contested;
  } else if (expectedKind === 'state') {
    record.transitionsTo = assertStringList(value.transitionsTo, `${label}.transitionsTo`);
  } else if (expectedKind === 'event') {
    record.emittedBy = assertSingleLine(value.emittedBy, `${label}.emittedBy`);
  }
  return record;
}

function assertDomainItemList(value, label, expectedKind, requiredKeys = DOMAIN_ITEM_KEYS) {
  if (!Array.isArray(value)) {
    throw new FoundationPersistError('invalid-input', `${label} must be an array`);
  }
  return value.map((entry, index) => assertDomainItem(entry, `${label}[${index}]`, expectedKind, requiredKeys));
}

function assertUnsettledSeams(value, label) {
  if (!Array.isArray(value)) {
    throw new FoundationPersistError('invalid-input', `${label} must be an array`);
  }
  return value.map((entry, index) => {
    const itemLabel = `${label}[${index}]`;
    if (!isPlainObject(entry) || Object.getPrototypeOf(entry) !== Object.prototype) {
      throw new FoundationPersistError('invalid-input', `${itemLabel} must be an unsettled-seam object record`);
    }
    assertExactKeys(entry, UNSETTLED_SEAM_KEYS, itemLabel);
    const kind = assertSingleLine(entry.kind, `${itemLabel}.kind`);
    if (kind !== 'unsettled-seam') {
      throw new FoundationPersistError('invalid-input', `${itemLabel}.kind must be unsettled-seam`);
    }
    return {
      kind,
      question: assertSingleLine(entry.question, `${itemLabel}.question`),
      evidence: assertEvidenceList(entry.evidence, `${itemLabel}.evidence`),
      confidence: assertEnum(entry.confidence, CONFIDENCE_VALUES, `${itemLabel}.confidence`),
      notes: assertStringList(entry.notes, `${itemLabel}.notes`),
    };
  });
}

function assertDomainModelAggregate(value, label) {
  if (!isPlainObject(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new FoundationPersistError('invalid-input', `${label} must be an aggregate domain-model object record`);
  }
  assertExactKeys(value, DOMAIN_MODEL_KEYS, label);
  return {
    actors: assertDomainItemList(value.actors, `${label}.actors`, DOMAIN_ITEM_KIND_BY_FIELD.actors),
    concepts: assertDomainItemList(value.concepts, `${label}.concepts`, DOMAIN_ITEM_KIND_BY_FIELD.concepts),
    systems: assertDomainItemList(value.systems, `${label}.systems`, DOMAIN_ITEM_KIND_BY_FIELD.systems),
    terms: assertDomainItemList(value.terms, `${label}.terms`, 'term', TERM_KEYS),
    states: assertDomainItemList(value.states, `${label}.states`, 'state', STATE_KEYS),
    events: assertDomainItemList(value.events, `${label}.events`, 'event', EVENT_KEYS),
    relationships: assertStructuredRecordList(value.relationships, 'relationshipClaims', `${label}.relationships`),
    boundaries: assertStructuredRecordList(value.boundaries, 'boundaryClaims', `${label}.boundaries`),
    confidence: assertEnum(value.confidence, CONFIDENCE_VALUES, `${label}.confidence`),
    unsettledSeams: assertUnsettledSeams(value.unsettledSeams, `${label}.unsettledSeams`),
  };
}

function assertStructuredRecordForField(value, field, label) {
  if (field === 'relationshipClaims') return assertRelationshipClaim(value, label);
  if (field === 'boundaryClaims') return assertBoundaryClaim(value, label);
  if (field === 'domainModel') return assertDomainModelAggregate(value, label);
  return assertStructuredRecord(value, label);
}

function assertStructuredRecordList(value, field, label) {
  if (!Array.isArray(value)) {
    throw new FoundationPersistError('invalid-input', `${label} must be an array`);
  }
  if (field === 'domainModel' && value.length !== 1) {
    throw new FoundationPersistError('invalid-input', `${label} must contain exactly one aggregate domain-model record`);
  }
  return value.map((entry, index) => assertStructuredRecordForField(entry, field, `${label}[${index}]`));
}

/** SHA-256 of the canonical, validated aggregate domain model. */
export function domainModelDigestOf(domainModel) {
  const validated = assertStructuredRecordList(domainModel, 'domainModel', 'domainModel');
  return createHash('sha256').update(canonicalize(validated), 'utf8').digest('hex');
}

/** SHA-256 of the model-bound frontier content and selected next action. */
export function frontierDigestOf({ domainModelDigest, frontier, nextAction } = {}) {
  if (typeof domainModelDigest !== 'string' || !REVISION_RE.test(domainModelDigest)) {
    throw new FoundationPersistError('invalid-input', 'domainModelDigest must be a SHA-256 digest');
  }
  const canonical = {
    domainModelDigest,
    frontier: assertStringList(frontier, 'frontier'),
    nextAction: assertFreeTextLine(nextAction, 'nextAction'),
  };
  return createHash('sha256').update(canonicalize(canonical), 'utf8').digest('hex');
}

function assertFieldEntries(value, field) {
  return STRUCTURED_RECORD_FIELD_SET.has(field)
    ? assertStructuredRecordList(value, field, field)
    : assertStringList(value, field);
}

function assertResolved(value) {
  if (!Array.isArray(value)) {
    throw new FoundationPersistError('invalid-input', 'resolved must be an array');
  }
  const byPair = new Map();
  const records = value.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new FoundationPersistError('invalid-input', `resolved[${index}] must be an object`);
    }
    const unknown = Object.keys(entry).filter((key) => key !== 'field' && key !== 'entry' && key !== 'resolution');
    if (unknown.length) {
      throw new FoundationPersistError('invalid-input', `resolved[${index}] has unknown field(s): ${unknown.sort().join(', ')}`);
    }
    const field = assertSingleLine(entry.field, `resolved[${index}].field`);
    if (!RETAINED_FIELDS.includes(field)) {
      throw new FoundationPersistError('invalid-input', `resolved[${index}].field must be one of the retained fields (${RETAINED_FIELDS.join(', ')}): ${field}`);
    }
    let resolvedEntry;
    if (STRUCTURED_RECORD_FIELD_SET.has(field)) {
      resolvedEntry = assertStructuredRecordForField(entry.entry, field, `resolved[${index}].entry`);
    } else {
      resolvedEntry = assertSingleLine(entry.entry, `resolved[${index}].entry`);
    }
    const resolution = assertFreeTextLine(entry.resolution, `resolved[${index}].resolution`);
    return { field, entry: resolvedEntry, resolution };
  });

  // A second, conflicting resolution for the same (field, entry) is refused
  // unless it is byte-identical to the existing one. Byte-identical duplicates
  // are a legitimate multiset and are kept.
  for (const record of records) {
    const key = pairKey(record.field, record.entry);
    const existing = byPair.get(key);
    if (existing !== undefined && existing !== record.resolution) {
      throw new FoundationPersistError(
        'foundation-regression',
        `two conflicting resolutions for ${JSON.stringify(record.entry)} in ${record.field}; a (field, entry) may carry only one resolution unless it is byte-identical`,
      );
    }
    byPair.set(key, record.resolution);
  }
  return records;
}

/**
 * Collision-proof key construction for `(field, entry)` and `(field, entry,
 * resolution)` tuples. Earlier code joined the parts with a NUL separator, which
 * a NUL inside an entry could defeat by shifting the boundary; control
 * characters are now refused everywhere, but the key is also encoded
 * unambiguously as a canonical JSON tuple so the guarantee does not rest on the
 * refusal alone (R6).
 */
function pairKey(field, entry) {
  return canonicalize([field, entry]);
}

const STRUCTURED_ENTRY_PREFIX = 'JSON: ';

function renderStructuredEntry(entry) {
  return `${STRUCTURED_ENTRY_PREFIX}${canonicalize(entry)}`;
}

function parseStructuredEntry(value, field, schema, label) {
  if (!value.startsWith(STRUCTURED_ENTRY_PREFIX)) {
    throw new FoundationPersistError('invalid-input', `${label} must use the "${STRUCTURED_ENTRY_PREFIX}" structured encoding in schema ${SCHEMA_VERSION}`);
  }
  const encoded = value.slice(STRUCTURED_ENTRY_PREFIX.length);
  let parsed;
  try {
    parsed = JSON.parse(encoded);
  } catch (error) {
    throw new FoundationPersistError('invalid-input', `${label} contains malformed structured JSON: ${error.message}`);
  }
  const record = assertStructuredRecordForField(parsed, field, label);
  if (canonicalize(record) !== encoded) {
    throw new FoundationPersistError('invalid-input', `${label} must use canonical JSON with sorted object keys`);
  }
  return record;
}

/**
 * Encode a resolved entry or resolution for the single-line `Resolved` record.
 * Any legal durable entry must round-trip — backticks, colons, pipes, em dashes,
 * a leading `- `, and the `_None recorded._` sentinel — so the two structural
 * delimiters (`: ` after the field and ` — ` between entry and resolution) are
 * made unambiguous by backslash-escaping the backslash and the em dash. A real
 * ` — ` delimiter is a space, an em dash, and a space; an escaped em dash is a
 * backslash then an em dash, so it can never form the delimiter (F4).
 */
function escapeResolvedField(value) {
  return value.replace(/\\/g, '\\\\').replace(/\u2014/g, '\\\u2014');
}

function unescapeResolvedField(value) {
  let decoded = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    if (index + 1 >= value.length) {
      throw new FoundationPersistError('invalid-input', 'Resolved field contains a trailing escape');
    }
    const escaped = value[index + 1];
    if (escaped !== '\\' && escaped !== '\u2014') {
      throw new FoundationPersistError('invalid-input', `Resolved field contains an unknown escape: \\${escaped}`);
    }
    decoded += escaped;
    index += 1;
  }
  return decoded;
}

/**
 * Render a foundation object to the canonical Markdown bytes. The parser
 * round-trips exactly the LF-terminated documents this renderer produces; see
 * the module header on why CRLF input is not an inverse.
 */
export function renderFoundation(foundation) {
  const lines = [HEADING, ''];
  lines.push(`- Schema: ${SCHEMA_VERSION}`);
  lines.push(`- Subject: ${foundation.subject.id}`);
  lines.push(`- Slug: ${foundation.subject.slug}`);
  lines.push(`- Alignment: ${foundation.alignment}`);
  lines.push(`- Aligned Findings Digest: ${foundation.alignedFindingsDigest}`);
  lines.push(`- Domain Model Basis Digest: ${foundation.domainModelBasisDigest}`);
  lines.push(`- Domain Model Digest: ${foundation.domainModelDigest}`);
  lines.push(`- Frontier Basis Digest: ${foundation.frontierBasisDigest}`);
  lines.push(`- Frontier Digest: ${foundation.frontierDigest}`);

  for (const field of LIST_SECTIONS) {
    lines.push('', `## ${SECTION_TITLES[field]}`, '');
    const entries = foundation[field];
    if (entries.length === 0) {
      lines.push(NONE_MARKER);
    } else {
      for (const entry of entries) {
        lines.push(`- ${STRUCTURED_RECORD_FIELD_SET.has(field) ? renderStructuredEntry(entry) : entry}`);
      }
    }
  }

  lines.push('', '## Next Action', '', foundation.nextAction);

  lines.push('', '## Resolved', '');
  if (foundation.resolved.length === 0) {
    lines.push(NONE_MARKER);
  } else {
    for (const item of foundation.resolved) {
      if (isPlainObject(item.entry)) {
        lines.push(`- JSON: ${canonicalize(item)}`);
      } else {
        lines.push(`- ${item.field}: ${escapeResolvedField(item.entry)} — ${escapeResolvedField(item.resolution)}`);
      }
    }
  }

  lines.push('', '## History', '');
  if (foundation.history.length === 0) {
    lines.push(NONE_MARKER);
  } else {
    for (const item of foundation.history) {
      lines.push(`- ${item.cycle} | ${item.timestamp} | ${item.alignment} | succeeds ${item.priorRevision ?? 'none'}`);
    }
  }

  const document = `${lines.join('\n')}\n`;
  assertNoDuplicateHeading(document);
  return document;
}

/**
 * A rendered document must never carry two identical `## ` section headings. Our
 * renderer cannot produce one from valid input, so a duplicate means a field
 * value injected structure the free-text guard missed; refuse it.
 */
function assertNoDuplicateHeading(document) {
  const seen = new Set();
  for (const line of document.split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      if (seen.has(heading[1])) {
        throw new FoundationPersistError('invalid-input', `rendered document contains a duplicate section heading: ${heading[1]}`);
      }
      seen.add(heading[1]);
    }
  }
}

function splitSections(body) {
  const sections = new Map();
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current !== null) {
      sections.set(current, buffer);
    }
  };
  for (const line of body.split('\n')) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      flush();
      if (sections.has(heading[1])) {
        // A duplicate section heading would let a later section silently replace
        // an earlier one, discarding durable evidence. Refuse instead of
        // overwriting (R2).
        throw new FoundationPersistError('invalid-input', `foundation contains a duplicate section heading: ${heading[1]}`);
      }
      sections.set(heading[1], null);
      current = heading[1];
      buffer = [];
    } else if (current !== null) {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** The complete, exact ordered section headings for each readable schema. */
const SCHEMA_1_SECTION_TITLES = Object.freeze([
  ...SCHEMA_1_LIST_SECTIONS.map((field) => SECTION_TITLES[field]),
  'Next Action',
  'Resolved',
  'History',
]);
const SCHEMA_2_SECTION_TITLES = Object.freeze([
  ...LIST_SECTIONS.map((field) => SECTION_TITLES[field]),
  'Next Action',
  'Resolved',
  'History',
]);

function sectionTitlesForSchema(schema) {
  return schema === '1' ? SCHEMA_1_SECTION_TITLES : SCHEMA_2_SECTION_TITLES;
}

/**
 * Read the exact, ordered metadata header. Schema 1 emits four identity lines;
 * schema 2 follows those lines with the complete lineage receipt
 * block, in exact order immediately after the document heading and its blank
 * line, and before the first section. Parsing them positionally — rather than searching the whole
 * document for a matching prefix — means a legitimate list entry that merely
 * looks like `Subject: ...` can never be mistaken for metadata, and a metadata
 * line moved into a section can never masquerade as the header (R2/MF-3).
 * Returns the identity metadata and, for schema 2 only, its declared lineage.
 */
function readHeader(allLines) {
  if (allLines[1] !== '') {
    throw new FoundationPersistError('invalid-input', 'foundation must carry a blank line after its heading');
  }
  const readMeta = (index, key, missingIsSchema = false) => {
    const line = allLines[index];
    const prefix = `- ${key}: `;
    if (typeof line !== 'string' || !line.startsWith(prefix)) {
      if (missingIsSchema) {
        throw new FoundationPersistError('unsupported-schema', 'foundation is missing its schema version line');
      }
      throw new FoundationPersistError('invalid-input', `foundation is missing its "- ${key}:" header line in the expected position`);
    }
    return line.slice(prefix.length);
  };
  const schema = readMeta(2, 'Schema', true);
  const subjectId = readMeta(3, 'Subject');
  const slug = readMeta(4, 'Slug');
  const alignment = readMeta(5, 'Alignment');
  const lineage = schema === '1'
    ? {}
    : {
      alignedFindingsDigest: readMeta(6, 'Aligned Findings Digest'),
      domainModelBasisDigest: readMeta(7, 'Domain Model Basis Digest'),
      domainModelDigest: readMeta(8, 'Domain Model Digest'),
      frontierBasisDigest: readMeta(9, 'Frontier Basis Digest'),
      frontierDigest: readMeta(10, 'Frontier Digest'),
    };
  const headerEnd = schema === '1' ? 6 : 11;
  if (allLines[headerEnd] !== '') {
    throw new FoundationPersistError('invalid-input', 'foundation must carry a blank line after its header block');
  }
  return { schema, subjectId, slug, alignment, lineage };
}

/**
 * Reject every ATX heading that is not the document heading or a canonical `##`
 * section, at any level. A `#`, `###`, or deeper heading, or a `##` heading that
 * is not one of the required sections, would restructure the document or smuggle
 * content past the section grammar, so it is refused (MF-3).
 */
function assertNoRogueHeadings(allLines, allowedSectionTitles) {
  for (let i = 0; i < allLines.length; i += 1) {
    const line = allLines[i];
    if (!HEADING_RE.test(line)) continue;
    if (i === 0 && line === HEADING) continue;
    const section = /^## (.+)$/.exec(line);
    if (section && allowedSectionTitles.includes(section[1])) continue;
    throw new FoundationPersistError('invalid-input', `foundation contains an unexpected heading: ${line}`);
  }
}

function assertSectionOrder(allLines, expectedTitles) {
  const actualTitles = allLines
    .map((line) => /^## (.+)$/.exec(line))
    .filter(Boolean)
    .map((match) => match[1]);
  if (
    actualTitles.length !== expectedTitles.length
    || actualTitles.some((title, index) => title !== expectedTitles[index])
  ) {
    throw new FoundationPersistError(
      'invalid-input',
      `foundation sections must appear exactly in schema order: ${expectedTitles.join(', ')}`,
    );
  }
}

function listFrom(sectionLines, title, field, schema) {
  if (!sectionLines) {
    throw new FoundationPersistError('invalid-input', `foundation is missing the ${title} section`);
  }
  const trimmed = sectionLines.filter((line) => line !== '');
  if (trimmed.length === 1 && trimmed[0] === NONE_MARKER) {
    return [];
  }
  return trimmed.map((line) => {
    const match = /^- (.+)$/.exec(line);
    if (!match) {
      throw new FoundationPersistError('invalid-input', `malformed entry in ${title}: ${line}`);
    }
    return STRUCTURED_RECORD_FIELD_SET.has(field)
      ? parseStructuredEntry(match[1], field, schema, `${title} entry`)
      : assertNoControlChars(match[1], `${title} entry`);
  });
}

/**
 * Validate one parsed history record with the same validators the write path
 * uses, so a history line with an impossible timestamp, a non-persistable
 * alignment, or a malformed prior revision is refused on parse rather than
 * silently trusted (MF-3).
 */
function assertParsedHistory(record, line) {
  assertNoControlChars(record.cycle, 'History cycle');
  if (record.cycle.includes('|')) {
    throw new FoundationPersistError('invalid-input', `malformed History entry (cycle contains a pipe): ${line}`);
  }
  assertRfc3339Utc(record.timestamp, 'History timestamp');
  if (!PERSISTABLE_ALIGNMENT.includes(record.alignment)) {
    throw new FoundationPersistError('invalid-input', `malformed History entry (alignment must be one of ${PERSISTABLE_ALIGNMENT.join(', ')}): ${line}`);
  }
  if (record.priorRevision !== null && !REVISION_RE.test(record.priorRevision)) {
    throw new FoundationPersistError('invalid-input', `malformed History entry (prior revision is not a SHA-256 digest or "none"): ${line}`);
  }
  return record;
}

/**
 * Parse the canonical Markdown bytes back into a foundation object. Throws a
 * `foundation`-shaped error when a document is readable as text but cannot be
 * recovered as a foundation, which is exactly what a caller needs to tell a
 * real foundation from an arbitrary Markdown file.
 *
 * The parse is strict and canonical: the metadata header is an exact, ordered
 * block read positionally; every ATX heading that is not the document heading or
 * a canonical `##` section is refused at any level; every required section
 * occurs exactly once and no unknown section appears; and every parsed history
 * record is validated with the write path's own validators. A duplicate heading
 * is refused rather than allowed to silently replace durable evidence (R2).
 */
export function parseFoundation(bytes) {
  if (typeof bytes !== 'string') {
    throw new FoundationPersistError('invalid-input', 'foundation bytes must be a string');
  }
  const normalized = bytes.replace(/\r\n/g, '\n');
  const allLines = normalized.split('\n');
  if (allLines[0] !== HEADING) {
    throw new FoundationPersistError('invalid-input', `foundation must begin with "${HEADING}"`);
  }

  const { schema, subjectId, slug, alignment, lineage } = readHeader(allLines);
  if (!SUPPORTED_SCHEMA_VERSIONS.has(schema)) {
    throw new FoundationPersistError('unsupported-schema', `foundation schema ${schema} is not supported; this build reads schemas 1 and ${SCHEMA_VERSION}`);
  }
  const requiredSectionTitles = sectionTitlesForSchema(schema);
  assertNoRogueHeadings(allLines, requiredSectionTitles);
  assertSectionOrder(allLines, requiredSectionTitles);
  if (!subjectId || !slug) {
    throw new FoundationPersistError('invalid-input', 'foundation is missing subject identity');
  }
  assertNoControlChars(subjectId, 'foundation subject id');
  assertNoControlChars(slug, 'foundation subject slug');

  const sections = splitSections(normalized);
  for (const title of sections.keys()) {
    if (!requiredSectionTitles.includes(title)) {
      throw new FoundationPersistError('invalid-input', `foundation contains an unknown section: ${title}`);
    }
  }
  for (const title of requiredSectionTitles) {
    if (!sections.has(title)) {
      throw new FoundationPersistError('invalid-input', `foundation is missing the ${title} section`);
    }
  }

  const foundation = {
    subject: { id: subjectId, slug },
    alignment,
    resolved: [],
    history: [],
  };

  for (const field of LIST_SECTIONS) {
    foundation[field] = schema === '1' && POST_SCHEMA_1_FIELD_SET.has(field)
      ? []
      : listFrom(sections.get(SECTION_TITLES[field]), SECTION_TITLES[field], field, schema);
  }

  const nextActionLines = sections.get('Next Action');
  const nextAction = nextActionLines.filter((line) => line !== '').join('\n');
  if (nextAction === '') {
    throw new FoundationPersistError('invalid-input', 'foundation Next Action is empty');
  }
  assertNoControlChars(nextAction, 'foundation Next Action');
  foundation.nextAction = nextAction;

  const resolvedTrimmed = sections.get('Resolved').filter((line) => line !== '');
  if (resolvedTrimmed.length === 0) {
    throw new FoundationPersistError('invalid-input', 'foundation Resolved section is empty');
  }
  if (!(resolvedTrimmed.length === 1 && resolvedTrimmed[0] === NONE_MARKER)) {
    const parsedResolved = [];
    for (const line of resolvedTrimmed) {
      if (line.startsWith('- JSON: ')) {
        if (schema === '1') {
          throw new FoundationPersistError('invalid-input', 'schema 1 does not support structured Resolved entries');
        }
        const encoded = line.slice('- JSON: '.length);
        let parsed;
        try {
          parsed = JSON.parse(encoded);
        } catch (error) {
          throw new FoundationPersistError('invalid-input', `malformed Resolved JSON entry: ${error.message}`);
        }
        if (!isPlainObject(parsed) || canonicalize(parsed) !== encoded) {
          throw new FoundationPersistError('invalid-input', `malformed or noncanonical Resolved JSON entry: ${line}`);
        }
        parsedResolved.push(parsed);
        continue;
      }
      const match = /^- ([a-zA-Z]+): (.*)$/.exec(line);
      const allowedResolvedFields = schema === '1' ? SCHEMA_1_RETAINED_FIELD_SET : new Set(RETAINED_FIELDS);
      if (!match || !allowedResolvedFields.has(match[1])) {
        throw new FoundationPersistError('invalid-input', `malformed Resolved entry: ${line}`);
      }
      const parts = match[2].split(' \u2014 ');
      if (parts.length !== 2) {
        throw new FoundationPersistError('invalid-input', `malformed Resolved entry: ${line}`);
      }
      const entry = assertNoControlChars(unescapeResolvedField(parts[0]), 'Resolved entry');
      const resolution = assertNoControlChars(unescapeResolvedField(parts[1]), 'Resolved resolution');
      if (entry === '' || resolution === '') {
        throw new FoundationPersistError('invalid-input', `malformed Resolved entry: ${line}`);
      }
      parsedResolved.push({ field: match[1], entry, resolution });
    }
    foundation.resolved = assertResolved(parsedResolved);
  }

  const historyTrimmed = sections.get('History').filter((line) => line !== '');
  if (!(historyTrimmed.length === 1 && historyTrimmed[0] === NONE_MARKER)) {
    for (const line of historyTrimmed) {
      const match = /^- (.+?) \| (.+?) \| (.+?) \| succeeds (.+)$/.exec(line);
      if (!match) {
        throw new FoundationPersistError('invalid-input', `malformed History entry: ${line}`);
      }
      const record = {
        cycle: match[1],
        timestamp: match[2],
        alignment: match[3],
        priorRevision: match[4] === 'none' ? null : match[4],
      };
      assertParsedHistory(record, line);
      foundation.history.push(record);
    }
  }

  if (schema === String(SCHEMA_VERSION)) {
    for (const [field, digest] of Object.entries(lineage)) {
      if (!REVISION_RE.test(digest)) {
        throw new FoundationPersistError('invalid-input', `${field} must be a SHA-256 digest`);
      }
      foundation[field] = digest;
    }
    const alignedFindingsDigest = alignedFindingsDigestOf(foundation);
    if (foundation.alignedFindingsDigest !== alignedFindingsDigest) {
      throw new FoundationPersistError(
        'invalid-input',
        `alignedFindingsDigest does not match the persisted findings (declared ${foundation.alignedFindingsDigest}, computed ${alignedFindingsDigest})`,
      );
    }
    if (foundation.domainModelBasisDigest !== alignedFindingsDigest) {
      throw new FoundationPersistError('invalid-input', 'domainModelBasisDigest does not bind the domain model to alignedFindingsDigest');
    }
    const domainModelDigest = domainModelDigestOf(foundation.domainModel);
    if (foundation.domainModelDigest !== domainModelDigest) {
      throw new FoundationPersistError(
        'invalid-input',
        `domainModelDigest does not match the persisted domain model (declared ${foundation.domainModelDigest}, computed ${domainModelDigest})`,
      );
    }
    if (foundation.frontierBasisDigest !== domainModelDigest) {
      throw new FoundationPersistError('invalid-input', 'frontierBasisDigest does not bind the frontier to domainModelDigest');
    }
    const frontierDigest = frontierDigestOf({
      domainModelDigest,
      frontier: foundation.frontier,
      nextAction: foundation.nextAction,
    });
    if (foundation.frontierDigest !== frontierDigest) {
      throw new FoundationPersistError(
        'invalid-input',
        `frontierDigest does not match the persisted frontier and next action (declared ${foundation.frontierDigest}, computed ${frontierDigest})`,
      );
    }
  }

  return foundation;
}

function countMultiset(entries) {
  const counts = new Map();
  for (const entry of entries) {
    const key = canonicalize(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * Per-field, multiset retention. A prior entry in a retained field must reappear
 * in the SAME field with at least its prior multiplicity, or be discharged by a
 * `Resolved` record naming that exact field and entry. Discharge is count-aware
 * and field-qualified: a resolution record discharges exactly one occurrence in
 * exactly its named field, and it must be a record freshly added by this write.
 * Reappearing in a different field is refused, naming the field it left and the
 * field it appeared in. Prior `Resolved` records are preserved as a multiset:
 * every prior `{field, entry, resolution}` must reappear with at least its prior
 * count, so none is dropped or rewritten.
 */
function enforceRetention(prior, next) {
  // Prior resolutions are an immutable multiset. Every prior record must survive
  // with at least its prior count; a shortfall is a drop or a rewrite.
  const nextResolvedCounts = countTriples(next.resolved);
  const seenPrior = new Map();
  for (const item of prior.resolved) {
    const key = tripleKey(item);
    const used = (seenPrior.get(key) ?? 0) + 1;
    seenPrior.set(key, used);
    if ((nextResolvedCounts.get(key) ?? 0) < used) {
      throw new FoundationPersistError(
        'foundation-regression',
        `persisting would rewrite or remove a prior Resolved record for ${JSON.stringify(item.entry)} in ${item.field}; prior resolutions are immutable.`,
      );
    }
  }

  // The discharges this write may spend are the resolution records it newly
  // adds, keyed by (field, entry). Prior records are already spent.
  const priorResolvedCounts = countTriples(prior.resolved);
  const freshDischarges = new Map();
  for (const [key, count] of nextResolvedCounts) {
    const fresh = count - (priorResolvedCounts.get(key) ?? 0);
    if (fresh <= 0) continue;
    const { field, entry } = parseTripleKey(key);
    const dischargeKey = pairKey(field, entry);
    freshDischarges.set(dischargeKey, (freshDischarges.get(dischargeKey) ?? 0) + fresh);
  }

  const nextEntryFields = new Map();
  for (const field of RETAINED_FIELDS) {
    for (const entry of new Set(next[field])) {
      const key = canonicalize(entry);
      if (!nextEntryFields.has(key)) nextEntryFields.set(key, new Set());
      nextEntryFields.get(key).add(field);
    }
  }

  for (const field of RETAINED_FIELDS) {
    const available = countMultiset(next[field]);
    for (const [entryKey, count] of countMultiset(prior[field])) {
      const entry = JSON.parse(entryKey);
      for (let i = 0; i < count; i += 1) {
        const remaining = available.get(entryKey) ?? 0;
        if (remaining > 0) {
          available.set(entryKey, remaining - 1);
          continue;
        }
        const spendKey = pairKey(field, entry);
        const discharges = freshDischarges.get(spendKey) ?? 0;
        if (discharges > 0) {
          freshDischarges.set(spendKey, discharges - 1);
          continue;
        }
        const elsewhere = [...(nextEntryFields.get(entryKey) ?? [])].filter((other) => other !== field).sort();
        if (elsewhere.length) {
          throw new FoundationPersistError(
            'foundation-regression',
            `persisting would move ${JSON.stringify(entry)} out of ${field} into ${elsewhere.join(', ')}; a moved entry is not retention. Resolve it in ${field} or keep it there.`,
          );
        }
        throw new FoundationPersistError(
          'foundation-regression',
          `persisting would drop a previously recorded ${field} entry: ${JSON.stringify(entry)}; removal requires a Resolved record naming ${field}, not a silent write.`,
        );
      }
    }
  }
}

function tripleKey(item) {
  return canonicalize([item.field, item.entry, item.resolution]);
}

function parseTripleKey(key) {
  const [field, entry] = JSON.parse(key);
  return { field, entry };
}

function countTriples(resolved) {
  const counts = new Map();
  for (const item of resolved) {
    const key = tripleKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function normalizeIntake(intake) {
  if (!isPlainObject(intake)) {
    throw new FoundationPersistError('invalid-input', 'the persist intake must be an object');
  }
  const unknown = Object.keys(intake).filter((field) => !INTAKE_FIELDS.includes(field)).sort();
  if (unknown.length) {
    throw new FoundationPersistError('invalid-input', `unknown field(s): ${unknown.join(', ')}`);
  }
  if (intake.version !== STATE_VERSION) {
    throw new FoundationPersistError('invalid-input', `version must be ${STATE_VERSION}`);
  }

  const repositoryRoot = assertSingleLine(intake.repositoryRoot, 'repositoryRoot');
  if (!path.isAbsolute(repositoryRoot)) {
    throw new FoundationPersistError('invalid-input', 'repositoryRoot must be an absolute path');
  }

  if (!isPlainObject(intake.subject)) {
    throw new FoundationPersistError('invalid-input', 'subject must be an object with id and slug');
  }
  const subjectUnknown = Object.keys(intake.subject).filter((k) => k !== 'id' && k !== 'slug').sort();
  if (subjectUnknown.length) {
    throw new FoundationPersistError('invalid-input', `subject has unknown field(s): ${subjectUnknown.join(', ')}`);
  }
  const id = assertSingleLine(intake.subject.id, 'subject.id');
  if (typeof intake.subject.slug !== 'string' || intake.subject.slug.trim() === '') {
    throw new FoundationPersistError('invalid-input', 'subject.slug must be non-empty text');
  }
  const slug = intake.subject.slug;
  if (/\\/.test(slug) || slug.includes('..') || slug.includes('/') || path.isAbsolute(slug) || !SLUG_RE.test(slug)) {
    throw new FoundationPersistError(
      'unsafe-destination',
      `subject.slug must match ${SLUG_RE} and name no path outside docs/agent/discovery/: ${slug}`,
    );
  }

  if (typeof intake.alignment !== 'string' || !PERSISTABLE_ALIGNMENT.includes(intake.alignment)) {
    throw new FoundationPersistError(
      'unaligned',
      `alignment must be one of ${PERSISTABLE_ALIGNMENT.join(', ')} to persist; rereading is never approval`,
    );
  }

  for (const field of [...DOCUMENTED_FINDINGS_FIELDS, 'domainModel']) {
    if (!Object.prototype.hasOwnProperty.call(intake, field)) {
      throw new FoundationPersistError('invalid-input', `${field} is required for a canonical schema-2 write`);
    }
  }
  for (const field of ['alignedFindingsDigest', 'domainModelBasisDigest', 'domainModelDigest', 'frontierBasisDigest', 'frontierDigest']) {
    if (!Object.prototype.hasOwnProperty.call(intake, field)) {
      throw new FoundationPersistError('invalid-input', `${field} is required for a canonical schema-2 write`);
    }
    if (typeof intake[field] !== 'string' || !REVISION_RE.test(intake[field])) {
      throw new FoundationPersistError('invalid-input', `${field} must be a SHA-256 digest`);
    }
  }

  if (!('expectedPriorRevision' in intake)) {
    throw new FoundationPersistError('invalid-input', 'expectedPriorRevision is required (a SHA-256 digest, or null only for a genuine first cycle)');
  }
  let expectedPriorRevision = intake.expectedPriorRevision;
  if (expectedPriorRevision !== null && (typeof expectedPriorRevision !== 'string' || !REVISION_RE.test(expectedPriorRevision))) {
    throw new FoundationPersistError('invalid-input', 'expectedPriorRevision must be a SHA-256 digest or null');
  }

  const cycle = assertSingleLine(intake.cycle, 'cycle');
  if (cycle.includes('|')) {
    throw new FoundationPersistError('invalid-input', 'cycle must not contain a pipe');
  }
  const timestamp = assertRfc3339Utc(intake.timestamp, 'timestamp');

  const foundation = {
    subject: { id, slug },
    alignment: CONFIRMED,
    resolved: assertResolved(intake.resolved),
  };
  for (const field of DURABLE_SETS) {
    foundation[field] = assertFieldEntries(intake[field], field);
  }
  foundation.frontier = assertStringList(intake.frontier, 'frontier');
  foundation.nextAction = assertFreeTextLine(intake.nextAction, 'nextAction');

  const digest = alignedFindingsDigestOf(foundation);
  if (digest !== intake.alignedFindingsDigest) {
    throw new FoundationPersistError(
      'alignment-unbound',
      `the aligned findings digest does not match the persisted findings (declared ${intake.alignedFindingsDigest}, computed ${digest})`,
    );
  }
  const domainModelDigest = domainModelDigestOf(foundation.domainModel);
  if (intake.domainModelBasisDigest !== digest) {
    throw new FoundationPersistError(
      'derivation-unbound',
      'domainModelBasisDigest must bind the domain model to the aligned findings digest',
    );
  }
  if (intake.domainModelDigest !== domainModelDigest) {
    throw new FoundationPersistError(
      'derivation-unbound',
      `domainModelDigest does not match the validated domain model (declared ${intake.domainModelDigest}, computed ${domainModelDigest})`,
    );
  }
  if (intake.frontierBasisDigest !== domainModelDigest) {
    throw new FoundationPersistError(
      'derivation-unbound',
      'frontierBasisDigest must bind the frontier to domainModelDigest',
    );
  }
  const frontierDigest = frontierDigestOf({
    domainModelDigest,
    frontier: foundation.frontier,
    nextAction: foundation.nextAction,
  });
  if (intake.frontierDigest !== frontierDigest) {
    throw new FoundationPersistError(
      'derivation-unbound',
      `frontierDigest does not match the model-bound frontier and next action (declared ${intake.frontierDigest}, computed ${frontierDigest})`,
    );
  }

  Object.assign(foundation, {
    alignedFindingsDigest: digest,
    domainModelBasisDigest: intake.domainModelBasisDigest,
    domainModelDigest,
    frontierBasisDigest: intake.frontierBasisDigest,
    frontierDigest,
  });

  return {
    repositoryRoot,
    cycle,
    timestamp,
    alignmentResult: intake.alignment,
    expectedPriorRevision,
    alignedFindingsDigest: digest,
    domainModelBasisDigest: intake.domainModelBasisDigest,
    domainModelDigest,
    frontierBasisDigest: intake.frontierBasisDigest,
    frontierDigest,
    foundation,
  };
}

const realIo = {
  lstat: (target) => fs.lstatSync(target),
  mkdir: (target) => fs.mkdirSync(target),
  read: (target) => fs.readFileSync(target, 'utf8'),
  write: (target, data) => fs.writeFileSync(target, data),
  rename: (from, to) => fs.renameSync(from, to),
  // A real unlink reports its failure rather than swallowing it, so cleanup can
  // be classified and a staged file that could not be removed is named in the
  // returned error rather than silently left behind (MF-8).
  unlink: (target) => fs.unlinkSync(target),
};

/**
 * Remove a staged temporary file, never throwing. A genuinely absent staged
 * file (`ENOENT`) is a clean no-op; any other failure is reported as a note so
 * the caller can add it to the primary error without masking it. Cleanup never
 * replaces the primary failure (MF-8).
 */
function safeCleanup(io, staged) {
  try {
    io.unlink(staged);
    return null;
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    return error && error.message ? error.message : String(error);
  }
}

/**
 * Rethrow the primary failure after attempting to remove the staged file. If
 * cleanup itself failed, the primary error keeps its own code and its message is
 * augmented to report that cleanup failed and to name the staged file left
 * behind. No raw Node error from cleanup ever escapes or masks the primary
 * failure (MF-8).
 */
function throwAfterCleanup(io, staged, error) {
  const cleanupNote = safeCleanup(io, staged);
  if (cleanupNote !== null && error instanceof FoundationPersistError) {
    error.message += ` (additionally, the staged file ${staged} could not be removed: ${cleanupNote}; it may be left behind)`;
  }
  throw error;
}

/**
 * `lstat` that returns null for a genuinely absent path and maps every other
 * filesystem failure to a documented persist code, so a raw `EACCES`/`EISDIR`
 * never escapes to a caller (R5).
 */
function classifiedLstat(io, target, code, what) {
  try {
    return io.lstat(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw new FoundationPersistError(code, `could not inspect ${what}: ${error.message}`);
  }
}

/** `read` mapped to a documented persist code on any filesystem failure (R5). */
function classifiedRead(io, target, code, what) {
  try {
    return io.read(target);
  } catch (error) {
    throw new FoundationPersistError(code, `could not read ${what}: ${error.message}`);
  }
}

/**
 * Inspect each bounded path component with `lstat` WITHOUT creating anything,
 * refusing a symbolic link, an existing non-directory in the chain, or an
 * existing destination that is not a regular file. `mkdirSync`/`writeFileSync`
 * follow links, so a symlinked `docs`, `agent`, `discovery`, or final target
 * could redirect the write outside the bound; this check refuses that.
 *
 * Inspection is deliberately separate from creation so no filesystem state is
 * written before the `expectedPriorRevision` guard runs: a stale refusal must
 * leave the filesystem exactly as it was (MF-9). It returns the list of missing
 * directories (in order) and the destination's `lstat`, so the caller can run
 * its guards first and only then create the missing directories. It cannot close
 * the time-of-check/time-of-use window: a component could be swapped between this
 * walk and the rename.
 */
function inspectBoundedDestination(io, repositoryRoot, destination) {
  const missingDirs = [];
  let dir = repositoryRoot;
  let sawMissing = false;
  for (const segment of ['docs', 'agent', 'discovery']) {
    dir = path.join(dir, segment);
    if (sawMissing) {
      // A parent was absent, so this component is necessarily absent too; there
      // is nothing to inspect and it must be created.
      missingDirs.push(dir);
      continue;
    }
    const stat = classifiedLstat(io, dir, 'unsafe-destination', `${dir} while bounding the destination`);
    if (stat === null) {
      missingDirs.push(dir);
      sawMissing = true;
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new FoundationPersistError('unsafe-destination', `${dir} is a symbolic link; refusing to follow it out of the bound`);
    }
    if (!stat.isDirectory()) {
      throw new FoundationPersistError('unsafe-destination', `${dir} exists and is not a directory`);
    }
  }
  let destStat = null;
  if (!sawMissing) {
    destStat = classifiedLstat(io, destination, 'unsafe-destination', `${destination}`);
    if (destStat !== null) {
      if (destStat.isSymbolicLink()) {
        throw new FoundationPersistError('unsafe-destination', `${destination} is a symbolic link; refusing to follow it out of the bound`);
      }
      if (!destStat.isFile()) {
        throw new FoundationPersistError('unsafe-destination', `${destination} exists and is not a regular file`);
      }
    }
  }
  return { missingDirs, destStat };
}

/**
 * Create the directories `inspectBoundedDestination` found missing, in order.
 * This runs only AFTER the revision guard passes, so a refusal never leaves a
 * directory behind (MF-9).
 */
function createBoundedDirectories(io, missingDirs) {
  for (const dir of missingDirs) {
    try {
      io.mkdir(dir);
    } catch (error) {
      throw new FoundationPersistError('write-failed', `could not create ${dir}: ${error.message}`);
    }
  }
}

function foundationsEqual(a, b) {
  if (a.subject.id !== b.subject.id || a.subject.slug !== b.subject.slug) return false;
  if (a.alignment !== b.alignment) return false;
  if (a.nextAction !== b.nextAction) return false;
  for (const field of ['alignedFindingsDigest', 'domainModelBasisDigest', 'domainModelDigest', 'frontierBasisDigest', 'frontierDigest']) {
    if (a[field] !== b[field]) return false;
  }
  for (const field of LIST_SECTIONS) {
    if (a[field].length !== b[field].length) return false;
    for (let i = 0; i < a[field].length; i += 1) {
      if (canonicalize(a[field][i]) !== canonicalize(b[field][i])) return false;
    }
  }
  if (a.resolved.length !== b.resolved.length) return false;
  for (let i = 0; i < a.resolved.length; i += 1) {
    if (
      a.resolved[i].field !== b.resolved[i].field
      || canonicalize(a.resolved[i].entry) !== canonicalize(b.resolved[i].entry)
      || a.resolved[i].resolution !== b.resolved[i].resolution
    ) return false;
  }
  if (a.history.length !== b.history.length) return false;
  for (let i = 0; i < a.history.length; i += 1) {
    const x = a.history[i];
    const y = b.history[i];
    if (x.cycle !== y.cycle || x.timestamp !== y.timestamp || x.alignment !== y.alignment || x.priorRevision !== y.priorRevision) {
      return false;
    }
  }
  return true;
}

/**
 * Persist one aligned Discovery foundation. Reads any existing artifact, checks
 * the expected-prior-revision guard, enforces retention, appends one history
 * line, stages the write, structurally verifies it, and atomically renames it
 * into place. The `rename` is the single commit point: any failure detected
 * before it leaves the prior authority untouched and unlinks the staged file;
 * a failure detected after it is reported as `post-commit-verification-failed`,
 * because the destination has already been replaced (R3).
 */
export function persistFoundation(intake, { io = realIo } = {}) {
  const {
    repositoryRoot,
    cycle,
    timestamp,
    alignmentResult,
    expectedPriorRevision,
    alignedFindingsDigest,
    domainModelBasisDigest,
    domainModelDigest,
    frontierBasisDigest,
    frontierDigest,
    foundation,
  } = normalizeIntake(intake);

  const locator = `docs/agent/discovery/${foundation.subject.slug}.md`;
  const destination = path.join(repositoryRoot, 'docs', 'agent', 'discovery', `${foundation.subject.slug}.md`);

  // Inspect the bounded destination WITHOUT creating anything, so the revision
  // guard below can refuse a stale write while leaving the filesystem exactly as
  // it was. Missing directories are created only after the guard passes (MF-9).
  const { missingDirs, destStat } = inspectBoundedDestination(io, repositoryRoot, destination);

  let priorRevision = null;
  let priorHistory = [];
  const priorExists = destStat !== null;
  const priorBytes = priorExists ? classifiedRead(io, destination, 'verification-failed', `the existing ${locator}`) : null;
  if (priorExists) {
    priorRevision = revisionOf(priorBytes);
  }

  // The wider guard (R4): persistence must be bound to the revision the cycle
  // rehydrated on, checked FIRST — before retention, history, or rendering. It
  // covers the whole rehydrate-to-persist interval, which the immediate
  // pre-rename recheck below cannot see.
  if (expectedPriorRevision === null) {
    if (priorExists) {
      throw new FoundationPersistError(
        'concurrent-modification',
        `${locator} already exists at revision ${priorRevision}, but this write declared itself a first cycle (expectedPriorRevision: null); a second cycle must carry the revision it rehydrated`,
      );
    }
  } else if (!priorExists) {
    throw new FoundationPersistError(
      'concurrent-modification',
      `${locator} does not exist, but this write expected to succeed revision ${expectedPriorRevision}; the foundation it rehydrated is gone`,
    );
  } else if (priorRevision !== expectedPriorRevision) {
    throw new FoundationPersistError(
      'concurrent-modification',
      `${locator} is at revision ${priorRevision}, not the ${expectedPriorRevision} this cycle rehydrated; another write landed in the rehydrate-to-persist interval`,
    );
  }

  if (priorExists) {
    const prior = parseFoundation(priorBytes);

    if (prior.subject.id !== foundation.subject.id || prior.subject.slug !== foundation.subject.slug) {
      throw new FoundationPersistError(
        'subject-mismatch',
        `an existing foundation at ${locator} belongs to subject ${JSON.stringify(prior.subject.id)}/${JSON.stringify(prior.subject.slug)}, not ${JSON.stringify(foundation.subject.id)}/${JSON.stringify(foundation.subject.slug)}; persisting a different subject over it is refused`,
      );
    }

    enforceRetention(prior, foundation);
    priorHistory = prior.history;
  }

  foundation.history = [
    ...priorHistory,
    { cycle, timestamp, alignment: alignmentResult, priorRevision },
  ];

  const bytes = renderFoundation(foundation);
  const revision = revisionOf(bytes);
  const intended = parseFoundation(bytes);

  // The guards have passed; now — and only now — create any missing bounded
  // directories, so a refusal above left the filesystem untouched (MF-9).
  createBoundedDirectories(io, missingDirs);

  const staged = `${destination}.${randomUUID()}.tmp`;
  // Everything in this block runs BEFORE the commit point. On any failure the
  // staged file is unlinked and the original destination is untouched.
  try {
    try {
      io.write(staged, bytes);
    } catch (error) {
      throw new FoundationPersistError('write-failed', `could not stage ${locator}: ${error.message}`);
    }

    const stagedBack = classifiedRead(io, staged, 'verification-failed', `the staged ${locator}`);
    if (stagedBack !== bytes) {
      throw new FoundationPersistError('verification-failed', `the staged ${locator} did not match the written bytes`);
    }
    let stagedFoundation;
    try {
      stagedFoundation = parseFoundation(stagedBack);
    } catch (error) {
      throw new FoundationPersistError('verification-failed', `the staged ${locator} did not re-parse as the intended foundation: ${error.message}`);
    }
    if (!foundationsEqual(stagedFoundation, intended)) {
      throw new FoundationPersistError('verification-failed', `the staged ${locator} re-parsed to a different foundation than intended`);
    }

    // Immediate pre-rename recheck (the narrower second guard): the destination
    // must still hold the revision this call read. It covers only the instant
    // between here and the rename; the expectedPriorRevision guard above covers
    // the wider rehydrate-to-persist window.
    const swapStat = classifiedLstat(io, destination, 'concurrent-modification', `${destination} before committing`);
    if (priorRevision === null) {
      if (swapStat !== null) {
        const nowRevision = revisionOf(classifiedRead(io, destination, 'concurrent-modification', `${destination} before committing`));
        throw new FoundationPersistError('concurrent-modification', `${locator} appeared since this write began (expected absent, found revision ${nowRevision}); refusing to overwrite`);
      }
    } else {
      if (swapStat === null) {
        throw new FoundationPersistError('concurrent-modification', `${locator} was removed since this write began (expected revision ${priorRevision}, found none); refusing to overwrite`);
      }
      const nowRevision = revisionOf(classifiedRead(io, destination, 'concurrent-modification', `${destination} before committing`));
      if (nowRevision !== priorRevision) {
        throw new FoundationPersistError('concurrent-modification', `${locator} changed since this write began (expected revision ${priorRevision}, found ${nowRevision}); refusing to overwrite`);
      }
    }
  } catch (error) {
    throwAfterCleanup(io, staged, error);
  }

  // ---- Commit point. After this rename succeeds, the destination is replaced.
  try {
    io.rename(staged, destination);
  } catch (error) {
    throwAfterCleanup(io, staged, new FoundationPersistError('write-failed', `could not commit ${locator}: ${error.message}`));
  }

  // Post-commit verification. The destination has already been replaced with
  // `revision`, so a failure here is NOT "the original is untouched" — it is a
  // distinct, honestly-named state (R3).
  let readBack;
  try {
    readBack = io.read(destination);
  } catch (error) {
    throw new FoundationPersistError(
      'post-commit-verification-failed',
      `${locator} was committed and the destination is already replaced with the revision this write intended to commit (${revision}); the current on-disk revision is unknown because verification could not reread it: ${error.message}`,
    );
  }
  if (readBack !== bytes) {
    const nowRevision = revisionOf(readBack);
    throw new FoundationPersistError(
      'post-commit-verification-failed',
      `${locator} was committed and the destination is already replaced, but its reread does not match the written bytes; the revision now on disk is ${nowRevision} (intended ${revision})`,
    );
  }

  return {
    status: 'persisted',
    locator,
    revision,
    subjectId: foundation.subject.id,
    alignment: CONFIRMED,
    alignedFindingsDigest,
    domainModelBasisDigest,
    domainModelDigest,
    frontierBasisDigest,
    frontierDigest,
    priorRevision,
    historyLength: foundation.history.length,
    // Post-write reread proves the persisted bytes; it is NOT next-run
    // rehydration evidence. foundation-rehydrate proves grounding on the next
    // invocation (AC7).
    writeVerified: true,
    writeVerificationNote: 'Post-write reread is write verification only and is not evidence that a later run rehydrated from these bytes.',
  };
}

export const USAGE = 'Usage: foundation-persist.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new FoundationPersistError('usage', USAGE);
  }
  let raw;
  try {
    raw = fs.readFileSync(argv[1], 'utf8');
  } catch (error) {
    throw new FoundationPersistError('invalid-input', `could not read the intake file ${argv[1]}: ${error.message}`);
  }
  const intake = JSON.parse(raw);
  const result = persistFoundation(intake);
  streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
