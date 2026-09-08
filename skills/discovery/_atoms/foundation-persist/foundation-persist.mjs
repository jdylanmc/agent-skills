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
 * The retention check compares entries by exact text. It proves no prior entry
 * silently *vanished*. It cannot prove an entry's *meaning* survived: a reworded
 * entry whose original text no longer appears reads as a drop, and a caller
 * intent on hiding a change could keep the original text verbatim in `Resolved`
 * while burying an altered meaning elsewhere. That proxy is the seam this check
 * cannot see.
 *
 * The alignment gate is bound, not asserted. A caller cannot hand in
 * `alignment: "verified"` beside arbitrary bytes: it must also hand in
 * `alignedPayloadDigest`, the canonical digest of the aligned payload it showed
 * the human. The helper recomputes that digest over the normalized payload and
 * refuses (`alignment-unbound`) on any mismatch. The binding proves the persisted
 * payload is byte-for-byte the payload that was digested; it does NOT prove a
 * human understood it. `cycle`, `timestamp`, `expectedPriorRevision`, and
 * `history` are deliberately excluded from the digest, since the write appends
 * or checks them and they cannot be known at alignment time — so the digest
 * proves the aligned content, not the bookkeeping the write adds.
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

/** Discovery's alignment vocabulary. Only these two aligned results persist. */
export const PERSISTABLE_ALIGNMENT = Object.freeze(['verified', 'corrected']);

/** Human-aligned fields, excluding post-alignment domain/frontier derivations. */
export const ALIGNED_FINDING_FIELDS = Object.freeze(
  DURABLE_SETS.filter((field) => field !== 'domainModel'),
);

/** Fields introduced by issue #156; absent schema-1 artifacts read as empty. */
const OPTIONAL_SCHEMA_1_FIELDS = new Set([
  'sourceClaims',
  'relationshipClaims',
  'boundaryClaims',
  'risks',
  'domainModel',
]);

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
  'alignedPayloadDigest',
  'alignedFindingsDigest',
  'domainModelBasisDigest',
  'frontierBasisDigest',
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
 * The canonical digest of the aligned payload — the subject, all durable
 * sets, the frontier, the next action, and the resolved list. `cycle`,
 * `timestamp`, and `history` are excluded because the write appends them. A
 * caller computes this exact value over the payload it shows the human before
 * alignment, so `persistFoundation` can prove the bytes it persists are that
 * payload.
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
    const text = assertSingleLine(entry.entry, `resolved[${index}].entry`);
    const resolution = assertFreeTextLine(entry.resolution, `resolved[${index}].resolution`);
    return { field, entry: text, resolution };
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
  return JSON.stringify([field, entry]);
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

  for (const field of LIST_SECTIONS) {
    lines.push('', `## ${SECTION_TITLES[field]}`, '');
    const entries = foundation[field];
    if (entries.length === 0) {
      lines.push(NONE_MARKER);
    } else {
      for (const entry of entries) {
        lines.push(`- ${entry}`);
      }
    }
  }

  lines.push('', '## Next Action', '', foundation.nextAction);

  lines.push('', '## Resolved', '');
  if (foundation.resolved.length === 0) {
    lines.push(NONE_MARKER);
  } else {
    for (const item of foundation.resolved) {
      lines.push(`- ${item.field}: ${escapeResolvedField(item.entry)} — ${escapeResolvedField(item.resolution)}`);
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

/** The complete, exact set of `## ` section headings a foundation must carry. */
const REQUIRED_SECTION_TITLES = Object.freeze([
  ...LIST_SECTIONS.map((field) => SECTION_TITLES[field]),
  'Next Action',
  'Resolved',
  'History',
]);

/**
 * Read the exact, ordered metadata header. The renderer emits the four lines
 * `- Schema:`, `- Subject:`, `- Slug:`, `- Alignment:` in that order, once each,
 * immediately after the document heading and its blank line, and before the
 * first section. Parsing them positionally — rather than searching the whole
 * document for a matching prefix — means a legitimate list entry that merely
 * looks like `Subject: ...` can never be mistaken for metadata, and a metadata
 * line moved into a section can never masquerade as the header (R2/MF-3).
 * Returns `{ schema, subjectId, slug, alignment }`.
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
  if (allLines[6] !== '') {
    throw new FoundationPersistError('invalid-input', 'foundation must carry a blank line after its header block');
  }
  return { schema, subjectId, slug, alignment };
}

/**
 * Reject every ATX heading that is not the document heading or a canonical `##`
 * section, at any level. A `#`, `###`, or deeper heading, or a `##` heading that
 * is not one of the required sections, would restructure the document or smuggle
 * content past the section grammar, so it is refused (MF-3).
 */
function assertNoRogueHeadings(allLines) {
  for (let i = 0; i < allLines.length; i += 1) {
    const line = allLines[i];
    if (!HEADING_RE.test(line)) continue;
    if (i === 0 && line === HEADING) continue;
    const section = /^## (.+)$/.exec(line);
    if (section && REQUIRED_SECTION_TITLES.includes(section[1])) continue;
    throw new FoundationPersistError('invalid-input', `foundation contains an unexpected heading: ${line}`);
  }
}

function listFrom(sectionLines, title) {
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
    return assertNoControlChars(match[1], `${title} entry`);
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

  assertNoRogueHeadings(allLines);

  const { schema, subjectId, slug, alignment } = readHeader(allLines);
  if (!SUPPORTED_SCHEMA_VERSIONS.has(schema)) {
    throw new FoundationPersistError('unsupported-schema', `foundation schema ${schema} is not supported; this build reads schemas 1 and ${SCHEMA_VERSION}`);
  }
  if (!subjectId || !slug) {
    throw new FoundationPersistError('invalid-input', 'foundation is missing subject identity');
  }
  assertNoControlChars(subjectId, 'foundation subject id');
  assertNoControlChars(slug, 'foundation subject slug');

  const sections = splitSections(normalized);
  for (const title of sections.keys()) {
    if (!REQUIRED_SECTION_TITLES.includes(title)) {
      throw new FoundationPersistError('invalid-input', `foundation contains an unknown section: ${title}`);
    }
  }
  for (const title of REQUIRED_SECTION_TITLES) {
    if (!sections.has(title)) {
      // Schema 1 artifacts created before issue #156 have no Domain Model
      // section. Read them as an empty model so existing aligned foundations
      // remain rehydratable; the next successful write emits the section.
      if (
        schema === '1'
        &&
        [...OPTIONAL_SCHEMA_1_FIELDS]
          .map((field) => SECTION_TITLES[field])
          .includes(title)
      ) {
        continue;
      }
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
    foundation[field] = OPTIONAL_SCHEMA_1_FIELDS.has(field) && !sections.has(SECTION_TITLES[field])
      ? []
      : listFrom(sections.get(SECTION_TITLES[field]), SECTION_TITLES[field]);
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
    for (const line of resolvedTrimmed) {
      const match = /^- ([a-zA-Z]+): (.*)$/.exec(line);
      if (!match || !RETAINED_FIELDS.includes(match[1])) {
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
      foundation.resolved.push({ field: match[1], entry, resolution });
    }
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

  return foundation;
}

function countMultiset(entries) {
  const counts = new Map();
  for (const entry of entries) {
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
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
      if (!nextEntryFields.has(entry)) nextEntryFields.set(entry, new Set());
      nextEntryFields.get(entry).add(field);
    }
  }

  for (const field of RETAINED_FIELDS) {
    const available = countMultiset(next[field]);
    for (const [entry, count] of countMultiset(prior[field])) {
      for (let i = 0; i < count; i += 1) {
        const remaining = available.get(entry) ?? 0;
        if (remaining > 0) {
          available.set(entry, remaining - 1);
          continue;
        }
        const spendKey = pairKey(field, entry);
        const discharges = freshDischarges.get(spendKey) ?? 0;
        if (discharges > 0) {
          freshDischarges.set(spendKey, discharges - 1);
          continue;
        }
        const elsewhere = [...(nextEntryFields.get(entry) ?? [])].filter((other) => other !== field).sort();
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
  return JSON.stringify([item.field, item.entry, item.resolution]);
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

  const carriesDomainModel = Object.prototype.hasOwnProperty.call(intake, 'domainModel');
  const postAlignmentDerivation = typeof intake.alignedFindingsDigest === 'string';
  if (carriesDomainModel && !postAlignmentDerivation) {
    throw new FoundationPersistError(
      'derivation-unbound',
      'a domainModel requires alignedFindingsDigest and derivation basis receipts',
    );
  }
  if (postAlignmentDerivation) {
    for (const field of ['alignedFindingsDigest', 'domainModelBasisDigest', 'frontierBasisDigest']) {
      if (typeof intake[field] !== 'string' || !REVISION_RE.test(intake[field])) {
        throw new FoundationPersistError('invalid-input', `${field} must be a SHA-256 digest`);
      }
    }
  } else if (typeof intake.alignedPayloadDigest !== 'string' || !REVISION_RE.test(intake.alignedPayloadDigest)) {
    throw new FoundationPersistError('invalid-input', 'alignedPayloadDigest must be a SHA-256 digest of the aligned payload');
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
    foundation[field] = assertStringList(
      OPTIONAL_SCHEMA_1_FIELDS.has(field) ? (intake[field] ?? []) : intake[field],
      field,
    );
  }
  foundation.frontier = assertStringList(intake.frontier, 'frontier');
  foundation.nextAction = assertFreeTextLine(intake.nextAction, 'nextAction');

  if (postAlignmentDerivation) {
    const digest = alignedFindingsDigestOf(foundation);
    if (digest !== intake.alignedFindingsDigest) {
      throw new FoundationPersistError(
        'alignment-unbound',
        `the aligned findings digest does not match the persisted findings (declared ${intake.alignedFindingsDigest}, computed ${digest})`,
      );
    }
    if (
      intake.domainModelBasisDigest !== digest
      || intake.frontierBasisDigest !== digest
    ) {
      throw new FoundationPersistError(
        'derivation-unbound',
        'domain model and frontier receipts must bind to the aligned findings digest',
      );
    }
  } else {
    const digest = alignedPayloadDigestOf(foundation);
    if (digest !== intake.alignedPayloadDigest) {
      throw new FoundationPersistError(
        'alignment-unbound',
        `the aligned payload digest does not match the persisted payload (declared ${intake.alignedPayloadDigest}, computed ${digest}); the alignment gate is a binding, not a token`,
      );
    }
  }

  return { repositoryRoot, cycle, timestamp, alignmentResult: intake.alignment, expectedPriorRevision, foundation };
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
  for (const field of LIST_SECTIONS) {
    if (a[field].length !== b[field].length) return false;
    for (let i = 0; i < a[field].length; i += 1) {
      if (a[field][i] !== b[field][i]) return false;
    }
  }
  if (a.resolved.length !== b.resolved.length) return false;
  for (let i = 0; i < a.resolved.length; i += 1) {
    if (
      a.resolved[i].field !== b.resolved[i].field
      || a.resolved[i].entry !== b.resolved[i].entry
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
  const { repositoryRoot, cycle, timestamp, alignmentResult, expectedPriorRevision, foundation } = normalizeIntake(intake);

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
