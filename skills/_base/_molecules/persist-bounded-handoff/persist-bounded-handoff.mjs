#!/usr/bin/env node
/**
 * Bounded handoff: validation, redaction, rendering, temporary-path
 * resolution, and guarded verified writing.
 *
 * Callers supply confirmed context. This module owns the persisted artifact:
 * the section schema and its order, the bounds, the redaction floor, the
 * single temporary child directory, the collision-resistant name, and the
 * write that proves what landed. Every atom entry point calls into this
 * module, so one validated implementation serves all of them.
 *
 * Portions adapted from Matt Pocock's `handoff` skill,
 * https://github.com/mattpocock/skills, MIT License, Copyright (c) 2026 Matt
 * Pocock. The complete copyright and permission notice is preserved in the
 * Attribution section of `persist-bounded-handoff.md`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadIdentifierConfig,
  redactConfiguredIdentifiers,
} from '../../_atoms/redact-sensitive/redact-sensitive.config.mjs';

export const SCHEMA_VERSION = 1;

export const MAX_SECTION_BYTES = 8000;
export const MAX_DOCUMENT_BYTES = 65536;
export const MAX_REDACT_BYTES = 65536;
export const MAX_INPUT_BYTES = 262144;
export const MAX_ARTIFACTS = 50;
export const MAX_SUGGESTED_SKILLS = 10;
export const MAX_LOCATOR_BYTES = 300;
export const MAX_NOTE_BYTES = 300;
export const MAX_REASON_BYTES = 200;
export const MAX_SLUG_LENGTH = 64;
export const MAX_FENCE_LINES = 20;
export const MAX_FENCE_BYTES = 2000;
export const MAX_NAME_ATTEMPTS = 100;
export const MAX_WRITE_ATTEMPTS = 5;

export const DEFAULT_TITLE = 'Handoff';
export const DEFAULT_CHILD_DIRECTORY = 'handoffs';
export const PLACEHOLDER = 'No confirmed information yet.';

/**
 * The approved heading order. `Goal`, `Current Progress`, `What Worked`,
 * `What Didn't Work`, and `Next Steps` keep their pickup-compatible relative
 * order; `Decisions and Constraints` and `Artifacts and References` are always
 * present; `Suggested Skills` is the only optional section.
 */
export const SECTIONS = [
  { key: 'goal', heading: 'Goal', kind: 'prose', required: true },
  { key: 'current_progress', heading: 'Current Progress', kind: 'prose', required: true },
  {
    key: 'decisions_and_constraints',
    heading: 'Decisions and Constraints',
    kind: 'prose',
    required: true,
  },
  {
    key: 'artifacts_and_references',
    heading: 'Artifacts and References',
    kind: 'artifacts',
    required: true,
  },
  { key: 'what_worked', heading: 'What Worked', kind: 'prose', required: true },
  { key: 'what_did_not_work', heading: "What Didn't Work", kind: 'prose', required: true },
  { key: 'suggested_skills', heading: 'Suggested Skills', kind: 'skills', required: false },
  { key: 'next_steps', heading: 'Next Steps', kind: 'prose', required: true },
];

export const SECTION_KEYS = SECTIONS.map((section) => section.key);
export const HEADING_ORDER = SECTIONS.map((section) => section.heading);

const PAYLOAD_FIELDS = new Set([
  'schema_version',
  'title',
  'slug',
  'slug_source',
  'available_skills',
  ...SECTION_KEYS,
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CHILD_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TITLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 '\u2019.,()-]{0,79}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
/**
 * A high surrogate with no low surrogate after it, or a low surrogate with no
 * high surrogate before it. Such a code unit has no UTF-8 encoding, so it is
 * replaced with U+FFFD the moment it is written. Rejecting it while the
 * payload is still being normalized turns a late `verification_failed` on a
 * file that already exists into an early `malformed_payload` a caller can fix.
 */
const LONE_SURROGATE_PATTERN =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const FENCE_PATTERN = /^\s{0,3}(`{3,}|~{3,})/;

export class HandoffError extends Error {
  constructor(code, message, reason = null) {
    super(message);
    this.name = 'HandoffError';
    this.code = code;
    this.reason = reason;
  }
}

function fail(code, message, reason = null) {
  throw new HandoffError(code, message, reason);
}

/** The one refusal a caller may answer by resolving a fresh name. */
export const TARGET_EXISTS = 'target_exists';

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* -------------------------------------------------------------------------
 * Redaction
 * ---------------------------------------------------------------------- */

/**
 * Whole words that name a secret. Short and ambiguous entries such as `key`,
 * `sig`, and `pat` are safe here precisely because this tier matches a whole
 * word and never a substring, which is what keeps `monkeys`, `design`, and
 * `path` out of the rule.
 */
const SECRET_WORDS = new Set([
  'accesskey', 'accountkey', 'apikey', 'apikeys', 'auth', 'authorization',
  'clientsecret', 'connectionstring', 'credential', 'credentials', 'key',
  'keys', 'passphrase', 'passwd', 'password', 'passwords', 'pat', 'privatekey',
  'pwd', 'sas', 'secret', 'secrets', 'sig', 'signature', 'token', 'tokens',
]);

/**
 * Compounds recognized anywhere in a key that has been stripped to letters
 * and digits. This tier exists for the forms that carry no boundary at all -
 * `PGPASSWORD`, `APIKEY`, `AWSSECRETKEY` - so every entry has to be long and
 * specific enough that containing it is evidence by itself.
 */
const SECRET_COMPOUNDS = [
  'accesskey', 'accesstoken', 'accountkey', 'apikey', 'apitoken', 'authtoken',
  'bearertoken', 'clientsecret', 'connectionstring', 'credential',
  'encryptionkey', 'idtoken', 'masterkey', 'passphrase', 'passwd', 'password',
  'privatekey', 'refreshtoken', 'secretkey', 'securitytoken', 'sessiontoken',
  'sharedaccesssignature', 'signingkey', 'sshkey',
];

/**
 * Words that name a secret only when the key holds more than one of them.
 * `DB_PASS`, `MYSQL_PASS`, and `userPass` are credentials; a sentence about a
 * second `pass:` is not, and a bare `pass` is far too common in a handoff's
 * own prose to spend on this.
 */
const QUALIFIED_SECRET_WORDS = new Set(['pass']);

/**
 * Splits a key into words on separators, on a camel-case boundary, and on a
 * letter-to-digit boundary, so `access_token`, `accessToken`, `AccessToken`,
 * `ACCESS_TOKEN`, and `oauth2Token` all yield the word `token`.
 */
function keyWords(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * A key names a secret when one of its words is a secret word, or when the
 * key stripped to letters and digits contains a secret compound. Testing the
 * captured key as a string rather than matching alternatives inside the
 * expression keeps the scan linear, and the two tiers together mean the
 * keyword may sit anywhere in the key without a short word such as `pat`
 * matching the middle of `path`.
 */
export function namesSecret(key) {
  const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SECRET_COMPOUNDS.some((word) => compact.includes(word))) {
    return true;
  }
  const words = keyWords(key);
  return words.some(
    (word) => SECRET_WORDS.has(word)
      || (words.length > 1 && QUALIFIED_SECRET_WORDS.has(word)),
  );
}

/** Keys are short. Bounding the run keeps one pathological token cheap. */
const SECRET_KEY = String.raw`[A-Za-z0-9_.\[\]-]{1,64}`;

/**
 * An unquoted secret value runs to whitespace, but stops before punctuation
 * that carries structure - a closing bracket, a query separator, or sentence
 * punctuation - so redaction never swallows the Markdown around it.
 */
const SECRET_VALUE = String.raw`(?:"[^"\n]*"|'[^'\n]*'|[^\s,;)\]}>"'&]*[^\s,;)\]}>"'&.!?])`;

/**
 * A key and its value are on one line. The separator carries spaces and tabs,
 * never a line break.
 *
 * An unbounded `\s*` reaches across a blank line, so a sentence that merely
 * ends in `key:` pairs with the next section's `##` heading; the document is
 * rewritten and then reported as `redaction_incomplete`.
 *
 * Allowing one indented continuation line instead is worse, not better. In a
 * handoff an indented line after `key:` is almost always a nested bullet or a
 * wrapped sentence, and because the value backtracks to a single character the
 * span replaced is the child bullet's `-` or the sentence's first word:
 * `- Auth:\n  - uses Entra ID` becomes `- Auth:\n  [REDACTED:secret] uses
 * Entra ID`, which destroys the list and tells the reader a credential was
 * removed from a line that never held one. That result is a fixed point, so
 * nothing catches it and the damaged document is written as a success.
 *
 * One line it is. A credential split across lines is the caller's content to
 * fix, and the bound is documented so the caller knows to fix it.
 */
const ASSIGNMENT_PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9_.\[\]-])(${SECRET_KEY})([ \t]*[:=][ \t]*)(${SECRET_VALUE})`,
  'g',
);

/**
 * Replaces the value of every assignment whose key names a secret.
 *
 * Scanning is manual rather than a `replace` call because a key that does not
 * name a secret must not consume its value: `https://host/x?token=...` matches
 * with the key `https`, and a plain replace would skip past the `token`
 * assignment nested inside it. Resuming immediately after the separator finds
 * the inner assignment while still advancing, so the scan terminates.
 */
function redactAssignments(text) {
  ASSIGNMENT_PATTERN.lastIndex = 0;
  let result = '';
  let cursor = 0;
  let hits = 0;
  let match = ASSIGNMENT_PATTERN.exec(text);
  while (match !== null) {
    const [whole, key, separator, value] = match;
    if (namesSecret(key)) {
      result += `${text.slice(cursor, match.index)}${key}${separator}[REDACTED:secret]`;
      cursor = match.index + whole.length;
      hits += 1;
    } else {
      ASSIGNMENT_PATTERN.lastIndex = match.index + key.length + separator.length;
    }
    match = ASSIGNMENT_PATTERN.exec(text);
  }
  return { text: `${result}${text.slice(cursor)}`, hits };
}

const MARKER_SPAN_PATTERN = /\[REDACTED:[a-z-]+\]/g;

const LOCAL_PART_CHARACTER = /[A-Za-z0-9._%+-]/;
const DOMAIN_CHARACTER = /[A-Za-z0-9.-]/;
const DOMAIN_SHAPE = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/**
 * Replaces every electronic mail address, anchoring on `@` and walking out
 * from it rather than scanning for a local part.
 *
 * A regular expression cannot do this safely. Scanning for the local part
 * makes `[A-Za-z0-9._%+-]+@` retry at every position of a long run, which is
 * quadratic on adversarial dotted input. Pinning the run with a lookbehind
 * fixes that but breaks two other things: a span whose domain turns out not
 * to end in a top-level domain is consumed without being replaced, hiding a
 * real address behind it, and the lookbehind reads the text before an
 * already-replaced address, so a second address glued to the first is missed
 * on one pass and found on the next.
 *
 * Walking out from `@` has neither problem. Every character is visited a
 * bounded number of times, the left walk stops at `cursor` so a local part
 * can never reach back into text already emitted, and a span that is not an
 * address advances by one `@` instead of by its whole length.
 */
function redactEmails(text) {
  let result = '';
  let cursor = 0;
  let hits = 0;
  let searchFrom = 0;
  for (;;) {
    const at = text.indexOf('@', searchFrom);
    if (at === -1) {
      break;
    }
    let start = at;
    while (start > cursor && LOCAL_PART_CHARACTER.test(text[start - 1])) {
      start -= 1;
    }
    let end = at + 1;
    while (end < text.length && DOMAIN_CHARACTER.test(text[end])) {
      end += 1;
    }
    // A sentence ends `...@contoso.example.` and a domain does not end in a
    // separator, so give the trailing punctuation back to the prose.
    while (end > at + 1 && (text[end - 1] === '.' || text[end - 1] === '-')) {
      end -= 1;
    }
    if (start < at && DOMAIN_SHAPE.test(text.slice(at + 1, end))) {
      result += `${text.slice(cursor, start)}[REDACTED:email]`;
      cursor = end;
      searchFrom = end;
      hits += 1;
      continue;
    }
    searchFrom = at + 1;
  }
  return { text: `${result}${text.slice(cursor)}`, hits };
}

/**
 * Runs one rule over the spans between existing redaction markers, never over
 * a marker and never across one.
 *
 * This is what makes redaction idempotent by construction instead of by every
 * rule remembering to exempt its own output. A key or a value allowed to run
 * into `[REDACTED:` finds the marker's own colon: `secrets[a@b.example]`
 * becomes `secrets[[REDACTED:email]]`, and a second pass then reads
 * `secrets[[REDACTED` as a secret key and nests a marker inside a marker.
 * Excising the markers first removes the whole class.
 */
function outsideMarkers(apply) {
  return (text) => {
    MARKER_SPAN_PATTERN.lastIndex = 0;
    let result = '';
    let cursor = 0;
    let hits = 0;
    let match = MARKER_SPAN_PATTERN.exec(text);
    while (match !== null) {
      const span = apply(text.slice(cursor, match.index));
      result += `${span.text}${match[0]}`;
      hits += span.hits;
      cursor = match.index + match[0].length;
      match = MARKER_SPAN_PATTERN.exec(text);
    }
    const tail = apply(text.slice(cursor));
    return { text: `${result}${tail.text}`, hits: hits + tail.hits };
  };
}

function fromPattern(source, replace) {
  return (text) => {
    const pattern = new RegExp(source.source, source.flags);
    let hits = 0;
    const next = text.replace(pattern, (...args) => {
      const whole = args[0];
      const replaced = replace(whole, ...args.slice(1, -2));
      if (replaced !== whole) {
        hits += 1;
      }
      return replaced;
    });
    return { text: next, hits };
  };
}

/**
 * The deterministic redaction floor. Every rule replaces the sensitive span
 * with an explicit marker so a reader can see that something was removed
 * rather than silently reading an incomplete document.
 */
const REDACTION_RULES = [
  {
    category: 'private-key',
    apply: fromPattern(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
      () => '[REDACTED:private-key]',
    ),
  },
  {
    category: 'credential',
    apply: fromPattern(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, () => '[REDACTED:credential]'),
  },
  {
    category: 'token',
    apply: fromPattern(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, () => '[REDACTED:token]'),
  },
  {
    category: 'token',
    apply: fromPattern(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, () => '[REDACTED:token]'),
  },
  {
    category: 'token',
    apply: fromPattern(/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, () => '[REDACTED:token]'),
  },
  {
    category: 'token',
    apply: fromPattern(/\bsk-[A-Za-z0-9_-]{16,}\b/g, () => '[REDACTED:token]'),
  },
  {
    category: 'token',
    apply: fromPattern(
      /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
      () => '[REDACTED:token]',
    ),
  },
  {
    category: 'credential',
    apply: fromPattern(/\bAKIA[0-9A-Z]{16}\b/g, () => '[REDACTED:credential]'),
  },
  {
    category: 'connection-string',
    apply: fromPattern(
      /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mssql|redis|amqps?):\/\/[^/\s:@]+:[^@/\s]+@[^/\s]+/gi,
      () => '[REDACTED:connection-string]',
    ),
  },
  {
    category: 'secret',
    apply: redactAssignments,
  },
  {
    category: 'email',
    apply: redactEmails,
  },
  {
    category: 'phone',
    apply: fromPattern(
      /(?<![\w-])(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?![\w-])/g,
      () => '[REDACTED:phone]',
    ),
  },
];

export const REDACTION_CATEGORIES = [
  ...new Set(REDACTION_RULES.map((rule) => rule.category)),
].sort();

/**
 * Every rule, scoped to the spans between existing markers. Built once so a
 * call does not rebuild the wrappers, and kept separate from `REDACTION_RULES`
 * so each rule stays readable as the span it recognizes.
 */
const SEGMENTED_RULES = REDACTION_RULES.map((rule) => ({
  category: rule.category,
  apply: outsideMarkers(rule.apply),
}));

/**
 * Applies the deterministic redaction floor. The result is idempotent: every
 * marker this function emits is excised before any rule runs again, so
 * redacting already-redacted text returns the same text no matter what sits
 * beside a marker.
 *
 * `redactions` counts spans this call actually changed, so a second pass over
 * already-redacted text reports nothing.
 */
export function redactText(value) {
  if (typeof value !== 'string') {
    fail('malformed_payload', 'redaction input must be a string');
  }
  if (byteLength(value) > MAX_REDACT_BYTES) {
    fail(
      'malformed_payload',
      `redaction input exceeds ${MAX_REDACT_BYTES} UTF-8 bytes; a handoff is bounded evidence, not a transcript`,
    );
  }
  let text = value;
  const counts = new Map();
  for (const rule of SEGMENTED_RULES) {
    const { text: next, hits } = rule.apply(text);
    text = next;
    if (hits) {
      counts.set(rule.category, (counts.get(rule.category) ?? 0) + hits);
    }
  }
  const redactions = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category));
  return { text, redactions };
}

function mergeRedactions(target, redactions) {
  for (const entry of redactions) {
    target.set(entry.category, (target.get(entry.category) ?? 0) + entry.count);
  }
}

/**
 * Applies the broad handoff floor first, then the repository-specific terms.
 * The configuration module is intentionally dependency-free, so this shared
 * implementation can serve both the atom entry point and persisted handoffs.
 */
export function redactTextWithConfiguredIdentifiers(value, identifiers = []) {
  const floor = redactText(value);
  const configured = redactConfiguredIdentifiers(floor.text, identifiers);
  const counts = new Map();
  mergeRedactions(counts, floor.redactions);
  mergeRedactions(counts, configured.redactions);
  return {
    text: configured.text,
    redactions: [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((left, right) => left.category.localeCompare(right.category)),
  };
}

/* -------------------------------------------------------------------------
 * Payload validation
 * ---------------------------------------------------------------------- */

/**
 * The one normalization an adapter may rely on. A repository or work name
 * such as `Acme.Widgets` or `Ship_With_Squadron` becomes `acme-widgets` or
 * `ship-with-squadron`. Callers that hold a raw name pass it as `slug_source`
 * rather than reimplementing this, and callers that already hold a normalized
 * name pass `slug`, which is validated and never rewritten.
 */
export function slugify(value) {
  if (typeof value !== 'string') {
    fail('malformed_payload', 'slug source must be a string');
  }
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
  if (!slug) {
    fail('malformed_payload', `slug source has no usable characters: ${JSON.stringify(value)}`);
  }
  return slug;
}

/**
 * Resolves the file-name slug from the two accepted forms. Exactly one is
 * supplied: `slug` is validated as already normalized, `slugSource` is a raw
 * name this core normalizes. Both end at the same guarantee, so the name a
 * handoff is written under always matches `SLUG_PATTERN`.
 */
function resolveSlug(slug, slugSource) {
  const hasSlug = slug !== undefined && slug !== null && slug !== '';
  const hasSource = slugSource !== undefined && slugSource !== null && slugSource !== '';
  if (hasSlug && hasSource) {
    fail(
      'malformed_payload',
      'supply either a normalized slug or a raw slug source, not both',
    );
  }
  if (hasSource) {
    return slugify(normalizeLine(slugSource, 'slug_source', MAX_LOCATOR_BYTES));
  }
  const normalized = normalizeLine(slug ?? '', 'slug', MAX_SLUG_LENGTH);
  if (!SLUG_PATTERN.test(normalized)) {
    fail(
      'malformed_payload',
      'slug must be lowercase alphanumeric words joined by single hyphens; supply the raw repository or work name as slug_source to have it normalized here',
    );
  }
  return normalized;
}

function normalizeText(value, field) {
  if (typeof value !== 'string') {
    fail('malformed_payload', `${field} must be a string`);
  }
  const text = value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
  if (CONTROL_CHARACTER_PATTERN.test(text)) {
    fail('malformed_payload', `${field} carries a control character`);
  }
  if (LONE_SURROGATE_PATTERN.test(text)) {
    fail('malformed_payload', `${field} carries an unpaired UTF-16 surrogate`);
  }
  if (byteLength(text) > MAX_SECTION_BYTES) {
    fail(
      'malformed_payload',
      `${field} exceeds ${MAX_SECTION_BYTES} UTF-8 bytes; reference the artifact instead of reproducing it`,
    );
  }
  return text;
}

function normalizeLine(value, field, limit) {
  if (typeof value !== 'string') {
    fail('malformed_payload', `${field} must be a string`);
  }
  const line = value.trim();
  if (!line) {
    fail('malformed_payload', `${field} must not be empty`);
  }
  if (/[\r\n]/.test(line) || CONTROL_CHARACTER_PATTERN.test(line)) {
    fail('malformed_payload', `${field} must be a single line`);
  }
  if (LONE_SURROGATE_PATTERN.test(line)) {
    fail('malformed_payload', `${field} carries an unpaired UTF-16 surrogate`);
  }
  if (byteLength(line) > limit) {
    fail('malformed_payload', `${field} exceeds ${limit} UTF-8 bytes`);
  }
  return line;
}

/**
 * Walks `text` line by line, telling the visitor whether each line is a fence
 * delimiter, fenced content, or ordinary text. Returns the unterminated fence
 * marker, or `null` when every fence closed.
 */
function walkLines(text, visit) {
  let fence = null;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = FENCE_PATTERN.exec(line);
    if (match) {
      const marker = match[1];
      if (fence === null) {
        fence = marker;
        visit(line, index, 'fence-open');
        continue;
      }
      if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
        visit(line, index, 'fence-close');
        continue;
      }
    }
    visit(line, index, fence === null ? 'text' : 'fenced');
  }
  return fence;
}

/** The `##` headings a rendered document actually carries, ignoring fences. */
export function documentHeadings(text) {
  const headings = [];
  walkLines(text, (line, index, kind) => {
    if (kind === 'text' && /^## \S/.test(line)) {
      headings.push(line.slice(3).trim());
    }
  });
  return headings;
}

/**
 * Rejects two things a section body must not do: reproduce an artifact instead
 * of referencing it, and introduce a structural heading of its own. A body
 * that emits `## Next Steps` would leave the rendered document disagreeing
 * with the heading order this core promises its readers.
 */
function assertSectionShape(text, field) {
  let start = 0;
  let bytes = 0;
  const unterminated = walkLines(text, (line, index, kind) => {
    if (kind === 'fence-open') {
      start = index;
      bytes = 0;
      return;
    }
    if (kind === 'text') {
      if (/^ {0,3}#{1,2} /.test(line)) {
        fail(
          'malformed_payload',
          `${field} introduces its own top-level heading; a section body may not add a document or section heading`,
        );
      }
      return;
    }
    if (kind !== 'fenced') {
      return;
    }
    bytes += byteLength(line) + 1;
    if (index - start > MAX_FENCE_LINES || bytes > MAX_FENCE_BYTES) {
      fail(
        'inlined_artifact_body',
        `${field} inlines a fenced block longer than ${MAX_FENCE_LINES} lines or ${MAX_FENCE_BYTES} bytes; reference the artifact instead`,
      );
    }
  });
  if (unterminated !== null) {
    fail('malformed_payload', `${field} leaves a fenced block unterminated`);
  }
}

/**
 * A locator is a whitespace-free token: a URL, a path, an issue or pull
 * request identifier, or a commit. Prose about the artifact belongs in `note`,
 * which keeps the reference machine-checkable.
 */
function normalizeArtifact(entry, index) {
  const field = `artifacts_and_references[${index}]`;
  if (typeof entry === 'string') {
    return { reference: normalizeLocator(entry, field), note: '' };
  }
  if (!isPlainObject(entry)) {
    fail('malformed_payload', `${field} must be a string or an object`);
  }
  const unknown = Object.keys(entry).filter((key) => !['reference', 'note'].includes(key));
  if (unknown.length) {
    fail('malformed_payload', `${field} has unknown field(s): ${unknown.sort().join(', ')}`);
  }
  if (!('reference' in entry)) {
    fail('malformed_payload', `${field} requires reference`);
  }
  const note = entry.note === undefined || entry.note === null || entry.note === ''
    ? ''
    : normalizeLine(entry.note, `${field}.note`, MAX_NOTE_BYTES);
  return { reference: normalizeLocator(entry.reference, `${field}.reference`), note };
}

function normalizeLocator(value, field) {
  const locator = normalizeLine(value, field, MAX_LOCATOR_BYTES);
  if (/\s/.test(locator)) {
    fail(
      'malformed_payload',
      `${field} must be a whitespace-free locator such as a URL, path, #issue, or commit; put prose in note`,
    );
  }
  // A locator is rendered as `- <reference> - <note>`, so one ending in a
  // separator forms an assignment with the join that neither field could form
  // alone: `token:` beside any note reads as `token: -`. The document then
  // fails the post-render redaction check with a category the caller is told
  // not to retry. No real locator ends this way, so refusing it here turns an
  // unrecoverable failure into one the message explains.
  if (/[:=]$/.test(locator)) {
    fail(
      'malformed_payload',
      `${field} must not end in ':' or '='; a locator ends at the resource, not at a separator`,
    );
  }
  return locator;
}

/**
 * Checks one reference set, and optionally the section bodies that reference
 * set exists to keep short. References survive; a reproduced artifact body
 * does not.
 */
export function checkArtifactReferences(input) {
  if (!isPlainObject(input)) {
    fail('malformed_payload', 'payload must be a JSON object with references and bodies');
  }
  const unknown = Object.keys(input).filter((key) => !['references', 'bodies'].includes(key));
  if (unknown.length) {
    fail('malformed_payload', `payload has unknown field(s): ${unknown.sort().join(', ')}`);
  }
  const { references, bodies } = input;
  if (references !== undefined && references !== null && !Array.isArray(references)) {
    fail('malformed_payload', 'references must be an array');
  }
  const list = references ?? [];
  if (list.length > MAX_ARTIFACTS) {
    fail('malformed_payload', `references holds more than ${MAX_ARTIFACTS} entries`);
  }
  const normalized = list.map((entry, index) => normalizeArtifact(entry, index));

  if (bodies !== undefined && bodies !== null && !isPlainObject(bodies)) {
    fail('malformed_payload', 'bodies must be an object of named section text');
  }
  const checked = [];
  for (const [field, value] of Object.entries(bodies ?? {})) {
    assertSectionShape(normalizeText(value, field), field);
    checked.push(field);
  }

  return { references: normalized, bodies_checked: checked.sort() };
}

function normalizeSuggestedSkill(entry, index, availableSkills) {
  const field = `suggested_skills[${index}]`;
  if (!isPlainObject(entry)) {
    fail('malformed_payload', `${field} must be an object with skill and reason`);
  }
  const unknown = Object.keys(entry).filter((key) => !['skill', 'reason'].includes(key));
  if (unknown.length) {
    fail('malformed_payload', `${field} has unknown field(s): ${unknown.sort().join(', ')}`);
  }
  const skill = normalizeLine(entry.skill ?? '', `${field}.skill`, MAX_LOCATOR_BYTES);
  if (!SKILL_ID_PATTERN.test(skill)) {
    fail('malformed_payload', `${field}.skill must be a lowercase hyphenated skill identifier`);
  }
  // A skill identifier is rendered verbatim, so one that a redaction rule
  // would rewrite is rejected here rather than corrupting the document or
  // tripping the post-render check.
  if (redactText(skill).text !== skill) {
    fail(
      'malformed_payload',
      `${field}.skill looks like a credential and cannot be rendered as a skill identifier`,
    );
  }
  const reason = normalizeLine(entry.reason ?? '', `${field}.reason`, MAX_REASON_BYTES);
  // A suggestion can only be checked against the caller's real skill set, so
  // a non-empty suggested_skills always requires a populated available_skills
  // to validate against. Absence is refused rather than treated as consent -
  // an unset guard here would let an invented skill reach the next agent.
  if (!Array.isArray(availableSkills) || availableSkills.length === 0) {
    fail(
      'unknown_skill',
      `${field}.skill names ${skill}, but available_skills was not supplied so no suggestion can be validated`,
    );
  }
  if (!availableSkills.includes(skill)) {
    fail(
      'unknown_skill',
      `${field}.skill names ${skill}, which is not in the caller's available skills`,
    );
  }
  return { skill, reason };
}

export function normalizePayload(input) {
  if (!isPlainObject(input)) {
    fail('malformed_payload', 'payload must be a JSON object');
  }
  const unknown = Object.keys(input).filter((key) => !PAYLOAD_FIELDS.has(key));
  if (unknown.length) {
    fail('malformed_payload', `payload has unknown field(s): ${unknown.sort().join(', ')}`);
  }
  if (input.schema_version !== undefined && input.schema_version !== SCHEMA_VERSION) {
    fail('malformed_payload', `unsupported schema_version: ${JSON.stringify(input.schema_version)}`);
  }

  const slug = resolveSlug(input.slug, input.slug_source);

  const title = input.title === undefined || input.title === null
    ? DEFAULT_TITLE
    : normalizeLine(input.title, 'title', 80);
  if (!TITLE_PATTERN.test(title)) {
    fail('malformed_payload', 'title must be a short plain-text heading');
  }

  let availableSkills = null;
  if (input.available_skills !== undefined && input.available_skills !== null) {
    if (!Array.isArray(input.available_skills)) {
      fail('malformed_payload', 'available_skills must be an array of skill identifiers');
    }
    availableSkills = input.available_skills.map((entry, index) => {
      const skill = normalizeLine(entry, `available_skills[${index}]`, MAX_LOCATOR_BYTES);
      if (!SKILL_ID_PATTERN.test(skill)) {
        fail(
          'malformed_payload',
          `available_skills[${index}] must be a lowercase hyphenated skill identifier`,
        );
      }
      return skill;
    });
  }

  const sections = {};
  for (const section of SECTIONS) {
    const raw = input[section.key];
    if (section.kind === 'prose') {
      if (raw === undefined || raw === null || raw === '') {
        sections[section.key] = '';
        continue;
      }
      const text = normalizeText(raw, section.key);
      assertSectionShape(text, section.key);
      sections[section.key] = text;
      continue;
    }
    if (section.kind === 'artifacts') {
      if (raw === undefined || raw === null) {
        sections[section.key] = [];
        continue;
      }
      if (!Array.isArray(raw)) {
        fail('malformed_payload', `${section.key} must be an array of artifact references`);
      }
      if (raw.length > MAX_ARTIFACTS) {
        fail('malformed_payload', `${section.key} holds more than ${MAX_ARTIFACTS} references`);
      }
      sections[section.key] = raw.map((entry, index) => normalizeArtifact(entry, index));
      continue;
    }
    if (raw === undefined || raw === null) {
      sections[section.key] = null;
      continue;
    }
    if (!Array.isArray(raw)) {
      fail('malformed_payload', `${section.key} must be an array of suggested skills`);
    }
    if (raw.length > MAX_SUGGESTED_SKILLS) {
      fail(
        'malformed_payload',
        `${section.key} holds more than ${MAX_SUGGESTED_SKILLS} suggestions`,
      );
    }
    sections[section.key] = raw.length
      ? raw.map((entry, index) => normalizeSuggestedSkill(entry, index, availableSkills))
      : null;
  }

  return { schema_version: SCHEMA_VERSION, title, slug, available_skills: availableSkills, ...sections };
}

export function redactPayload(payload, identifiers = []) {
  const counts = new Map();
  const redact = (value) => {
    const result = redactTextWithConfiguredIdentifiers(value, identifiers);
    mergeRedactions(counts, result.redactions);
    return result.text;
  };

  const next = { ...payload };
  next.title = redact(payload.title);
  for (const section of SECTIONS) {
    const value = payload[section.key];
    if (section.kind === 'prose') {
      next[section.key] = redact(value);
      continue;
    }
    if (section.kind === 'artifacts') {
      next[section.key] = value.map((entry) => ({
        reference: redact(entry.reference),
        note: entry.note ? redact(entry.note) : '',
      }));
      continue;
    }
    next[section.key] = value === null
      ? null
      : value.map((entry) => {
        if (redactTextWithConfiguredIdentifiers(entry.skill, identifiers).text !== entry.skill) {
          fail(
            'malformed_payload',
            'a suggested skill identifier matches a sensitive identifier and cannot be rendered',
          );
        }
        return { skill: entry.skill, reason: redact(entry.reason) };
      });
  }

  const redactions = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category));
  return { payload: next, redactions };
}

/* -------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------- */

export function renderHandoff(payload) {
  if (!isPlainObject(payload) || payload.schema_version !== SCHEMA_VERSION) {
    fail('malformed_payload', 'renderHandoff requires a payload from normalizePayload');
  }
  const blocks = [`# ${payload.title}`];
  const included = [];

  for (const section of SECTIONS) {
    const value = payload[section.key];
    if (section.kind === 'skills') {
      if (value === null || value.length === 0) {
        continue;
      }
      included.push(section.heading);
      blocks.push(`## ${section.heading}`);
      blocks.push(value.map((entry) => `- ${entry.skill} - ${entry.reason}`).join('\n'));
      continue;
    }
    included.push(section.heading);
    blocks.push(`## ${section.heading}`);
    if (section.kind === 'artifacts') {
      blocks.push(
        value.length
          ? value
            .map((entry) => (entry.note ? `- ${entry.reference} - ${entry.note}` : `- ${entry.reference}`))
            .join('\n')
          : PLACEHOLDER,
      );
      continue;
    }
    blocks.push(value === '' ? PLACEHOLDER : value);
  }

  const document = `${blocks.join('\n\n')}\n`;
  // The rendered headings must be the headings this function reports. Section
  // bodies cannot introduce one, so a disagreement here is a defect rather
  // than caller input, and a caller that trusts `headings` deserves the check.
  const rendered = documentHeadings(document);
  if (rendered.length !== included.length || rendered.some((heading, index) => heading !== included[index])) {
    fail(
      'malformed_payload',
      `rendered headings ${JSON.stringify(rendered)} do not match the schema ${JSON.stringify(included)}`,
    );
  }
  if (byteLength(document) > MAX_DOCUMENT_BYTES) {
    fail(
      'malformed_payload',
      `rendered handoff exceeds ${MAX_DOCUMENT_BYTES} UTF-8 bytes; reference more and reproduce less`,
    );
  }
  return { document, headings: included };
}

/* -------------------------------------------------------------------------
 * Temporary path resolution
 * ---------------------------------------------------------------------- */

export function utcStamp(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    fail('malformed_payload', 'timestamp is not a valid date');
  }
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * Resolves the runtime-reported operating-system temporary directory and
 * creates exactly one child inside it. `mkdir` is deliberately non-recursive:
 * a missing temporary root is a runtime fault to report, not a tree to build.
 */
export function resolveTempDirectory(child = DEFAULT_CHILD_DIRECTORY) {
  if (typeof child !== 'string' || !CHILD_PATTERN.test(child)) {
    fail('malformed_payload', 'temporary child directory must be one lowercase hyphenated name');
  }

  let base;
  try {
    base = fs.realpathSync(os.tmpdir());
  } catch (error) {
    fail('temp_unavailable', `the runtime temporary directory is unusable: ${error.message}`);
  }
  if (!fs.statSync(base).isDirectory()) {
    fail('temp_unavailable', `the runtime temporary directory is not a directory: ${base}`);
  }

  const target = path.join(base, child);
  // Create first, then inspect whatever is actually there. Inspecting first
  // and creating afterwards leaves a window in which the entry that passed the
  // check is replaced by the one that gets used.
  try {
    fs.mkdirSync(target, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      fail('unsafe_temp_root', `${target} could not be created: ${error.message}`);
    }
  }

  let entry;
  try {
    entry = fs.lstatSync(target);
  } catch (error) {
    fail('unsafe_temp_root', `${target} cannot be inspected: ${error.message}`);
  }
  if (entry.isSymbolicLink()) {
    fail('unsafe_temp_root', `${target} is a symbolic link`);
  }
  if (!entry.isDirectory()) {
    fail('unsafe_temp_root', `${target} exists and is not a directory`);
  }
  // On a shared temporary root any local account can pre-create the child.
  // Writing into a directory somebody else owns or can write to means the
  // handoff can be replaced after it was verified.
  if (typeof process.getuid === 'function') {
    if (entry.uid !== process.getuid()) {
      fail('unsafe_temp_root', `${target} is owned by another user`);
    }
    if ((entry.mode & 0o022) !== 0) {
      fail('unsafe_temp_root', `${target} is writable by other users`);
    }
  }
  return fs.realpathSync(target);
}

/**
 * Proposes the first unused `<slug>-<UTC timestamp>.md` name, disambiguating
 * with a two-digit ordinal. The proposal is not a reservation: the write
 * creates the file exclusively, so a name taken in between is caught there.
 */
export function resolveHandoffPath({
  slug,
  slugSource,
  now = new Date(),
  child = DEFAULT_CHILD_DIRECTORY,
} = {}) {
  const normalized = resolveSlug(slug, slugSource);
  const directory = resolveTempDirectory(child);
  const stamp = utcStamp(now);

  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${String(attempt).padStart(2, '0')}`;
    const name = `${normalized}-${stamp}${suffix}.md`;
    const candidate = path.join(directory, name);
    try {
      fs.lstatSync(candidate);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { directory, path: candidate, name, attempt: attempt + 1 };
      }
      fail('unsafe_target', `${candidate} cannot be inspected: ${error.message}`);
    }
  }
  fail(
    'name_exhausted',
    `no unused handoff name for ${normalized} at ${stamp} within ${MAX_NAME_ATTEMPTS} attempts`,
  );
}

/* -------------------------------------------------------------------------
 * Guarded verified write
 * ---------------------------------------------------------------------- */

export function writeGuarded({ destination, allowedRoot, content }) {
  if (typeof content !== 'string') {
    fail('malformed_payload', 'content must be a string');
  }
  // A lone surrogate has no UTF-8 encoding, so the bytes that land can never
  // equal the string that was sent. Refusing it here means the reread check
  // reports real corruption rather than an input this atom already knew was
  // unwritable, and nothing is created in the meantime.
  if (LONE_SURROGATE_PATTERN.test(content)) {
    fail('malformed_payload', 'content carries an unpaired UTF-16 surrogate and cannot be encoded');
  }
  if (typeof destination !== 'string' || !path.isAbsolute(destination)) {
    fail('malformed_payload', 'destination must be an absolute path');
  }
  if (typeof allowedRoot !== 'string' || !path.isAbsolute(allowedRoot)) {
    fail('malformed_payload', 'allowedRoot must be an absolute path');
  }

  let realRoot;
  try {
    realRoot = fs.realpathSync(allowedRoot);
  } catch (error) {
    fail('unsafe_target', `allowed root ${allowedRoot} is unusable: ${error.message}`);
  }
  if (!fs.statSync(realRoot).isDirectory()) {
    fail('unsafe_target', `allowed root ${realRoot} is not a directory`);
  }

  const resolved = path.resolve(destination);
  const parent = path.dirname(resolved);
  const name = path.basename(resolved);
  if (!name || name === '.' || name === '..') {
    fail('path_escape', `destination ${destination} does not name a file`);
  }

  let parentEntry;
  try {
    parentEntry = fs.lstatSync(parent);
  } catch (error) {
    fail('unsafe_target', `destination directory ${parent} is unusable: ${error.message}`);
  }
  if (parentEntry.isSymbolicLink()) {
    fail('unsafe_target', `destination directory ${parent} is a symbolic link`);
  }
  if (!parentEntry.isDirectory()) {
    fail('unsafe_target', `destination directory ${parent} is not a directory`);
  }
  if (fs.realpathSync(parent) !== realRoot) {
    fail('path_escape', `destination ${resolved} is outside the allowed root ${realRoot}`);
  }

  let existing = null;
  try {
    existing = fs.lstatSync(resolved);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      fail('unsafe_target', `${resolved} cannot be inspected: ${error.message}`);
    }
  }
  if (existing?.isSymbolicLink()) {
    fail('unsafe_target', `${resolved} is a symbolic link`);
  }
  if (existing && !existing.isFile()) {
    fail('unsafe_target', `${resolved} exists and is not a regular file`);
  }
  if (existing) {
    fail(
      'unsafe_target',
      `${resolved} already exists; a handoff never replaces an earlier one`,
      TARGET_EXISTS,
    );
  }

  let handle;
  try {
    // Exclusive create is the guard that survives a race: an entry that
    // appears between the check above and this call fails here rather than
    // being followed or overwritten.
    handle = fs.openSync(resolved, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      fail(
        'unsafe_target',
        `${resolved} already exists; a handoff never replaces an earlier one`,
        TARGET_EXISTS,
      );
    }
    fail('write_failed', `${resolved} could not be created: ${error.message}`);
  }

  const bytes = byteLength(content);
  try {
    fs.writeFileSync(handle, content, 'utf8');
    fs.fsyncSync(handle);
  } catch (error) {
    fs.closeSync(handle);
    fs.rmSync(resolved, { force: true });
    fail('write_failed', `${resolved} could not be written: ${error.message}`);
  }
  fs.closeSync(handle);

  const written = fs.lstatSync(resolved);
  if (written.isSymbolicLink() || !written.isFile()) {
    fs.rmSync(resolved, { force: true });
    fail('verification_failed', `${resolved} is not a regular file after writing`);
  }
  const reread = fs.readFileSync(resolved, 'utf8');
  if (reread !== content) {
    fs.rmSync(resolved, { force: true });
    fail('verification_failed', `${resolved} does not hold what was written`);
  }

  return { path: resolved, bytes };
}

/* -------------------------------------------------------------------------
 * Composed operation
 * ---------------------------------------------------------------------- */

export function persistBoundedHandoff(input, {
  now = new Date(),
  child = DEFAULT_CHILD_DIRECTORY,
  identifiers = [],
} = {}) {
  const normalized = normalizePayload(input);
  const { payload, redactions } = redactPayload(normalized, identifiers);
  const rendered = renderHandoff(payload);
  const settled = redactTextWithConfiguredIdentifiers(rendered.document, identifiers);
  const redactionCounts = new Map();
  mergeRedactions(redactionCounts, redactions);
  mergeRedactions(redactionCounts, settled.redactions);
  const document = settled.text;
  const headings = documentHeadings(document);
  const allRedactions = [...redactionCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((left, right) => left.category.localeCompare(right.category));

  // Both redaction layers are idempotent, so a second pass that still finds
  // something is a defect in this module rather than in the caller's content.
  if (redactTextWithConfiguredIdentifiers(document, identifiers).text !== document) {
    fail('redaction_incomplete', 'the rendered handoff still matches a redaction rule');
  }

  let lastError = null;
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const target = resolveHandoffPath({ slug: payload.slug, now, child });
    try {
      const written = writeGuarded({
        destination: target.path,
        allowedRoot: target.directory,
        content: document,
      });
      return {
        path: written.path,
        directory: target.directory,
        name: target.name,
        bytes: written.bytes,
        headings,
        redactions: allRedactions,
        suggested_skills_included: payload.suggested_skills !== null,
      };
    } catch (error) {
      // Only a name taken between the proposal and the exclusive create is
      // retryable. Every other refusal is a real refusal.
      if (!(error instanceof HandoffError) || error.reason !== TARGET_EXISTS) {
        throw error;
      }
      lastError = error;
    }
  }
  fail(
    'name_exhausted',
    `a collision-free handoff name was taken on every attempt: ${lastError?.message ?? 'unknown'}`,
  );
}

/* -------------------------------------------------------------------------
 * Shared entry-point helpers
 * ---------------------------------------------------------------------- */

/**
 * `values` maps a flag to the field it fills; `flags` maps a flag to a boolean
 * field. An unknown flag, a missing value, and a repeated flag are all usage
 * failures rather than silently ignored input.
 */
export function parseFlags(argv, { values = {}, flags = {} } = {}, usage = '') {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag in flags) {
      parsed[flags[flag]] = true;
      continue;
    }
    const field = values[flag];
    if (!field) {
      fail('usage', `unknown argument: ${flag}\n${usage}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('usage', `${flag} requires a value\n${usage}`);
    }
    if (field in parsed) {
      fail('usage', `${flag} was given more than once\n${usage}`);
    }
    parsed[field] = value;
    index += 1;
  }
  return parsed;
}

export function readTextSource({ file, stdin }, usage, label = 'input') {
  if (Boolean(file) === Boolean(stdin)) {
    fail('usage', `supply exactly one ${label} source\n${usage}`);
  }
  let raw;
  try {
    raw = stdin ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail('usage', `${label} could not be read: ${error.message}`);
  }
  if (byteLength(raw) > MAX_INPUT_BYTES) {
    fail('malformed_payload', `${label} exceeds ${MAX_INPUT_BYTES} UTF-8 bytes`);
  }
  return raw;
}

export function readJsonSource(source, usage, label = 'payload') {
  const raw = readTextSource(source, usage, label);
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail('malformed_payload', `${label} is not valid JSON: ${error.message}`);
  }
}

export function readPayload(argv, usage) {
  const parsed = parseFlags(
    argv,
    { values: { '--payload': 'file' }, flags: { '--stdin': 'stdin' } },
    usage,
  );
  return readJsonSource(parsed, usage);
}

/**
 * The availability answer for one unit. Naming the unit rather than the
 * handoff family keeps a generic atom honest: `redact-sensitive` and
 * `write-guarded` are usable outside a handoff, and a probe that answered
 * `handoff: available` would tie them to a caller they do not know about.
 */
export function probeResponse(unit) {
  return `${unit}: available`;
}

/**
 * Runs one entry point and reports its outcome.
 *
 * A failure is one JSON object on standard error, never prose, because the
 * discriminator a caller acts on is a field rather than a phrase: only
 * `unsafe_target` with reason `target_exists` may be answered by resolving a
 * fresh name and calling again. `reason` is always present and is `null` when
 * the category carries no discriminator.
 */
export function runEntryPoint(argv, handler, unit) {
  if (typeof unit !== 'string' || !unit) {
    throw new TypeError('runEntryPoint requires the name of the unit it runs');
  }
  if (argv.includes('--probe')) {
    process.stdout.write(`${probeResponse(unit)}\n`);
    return;
  }
  try {
    process.stdout.write(handler(argv));
  } catch (error) {
    const handoffError = error instanceof HandoffError;
    const failure = {
      error: {
        code: handoffError ? error.code : 'internal_error',
        reason: handoffError ? error.reason : null,
        message: error.message,
      },
    };
    process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
    process.exitCode = 1;
  }
}

export function isDirectInvocation(moduleUrl) {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

const USAGE = 'Usage: persist-bounded-handoff.mjs (--payload <file> | --stdin) [--config <path>] [--probe]';

function readPersistedHandoff(argv) {
  const parsed = parseFlags(
    argv,
    {
      values: { '--payload': 'file', '--config': 'config' },
      flags: { '--stdin': 'stdin' },
    },
    USAGE,
  );
  let config;
  try {
    config = loadIdentifierConfig({
      file: parsed.config,
      json: process.env.REDACT_SENSITIVE_CONFIG_JSON,
    });
  } catch (error) {
    if (error.code === 'malformed_config') {
      fail(error.code, error.message);
    }
    throw error;
  }
  return {
    payload: readJsonSource(parsed, USAGE),
    identifiers: config.identifiers,
  };
}

if (isDirectInvocation(import.meta.url)) {
  runEntryPoint(
    process.argv.slice(2),
    (argv) => {
      const { payload, identifiers } = readPersistedHandoff(argv);
      return `${JSON.stringify(persistBoundedHandoff(payload, { identifiers }), null, 2)}\n`;
    },
    'persist-bounded-handoff',
  );
}
