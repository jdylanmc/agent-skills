#!/usr/bin/env node

/**
 * Validate a disclosure ledger against a source, a rendered candidate variant,
 * and a named profile resolved internally.
 *
 * A shorter artifact that hides what it dropped is worse than a longer one. The
 * ledger is the account of every meaningful thing in the source and what became
 * of it — kept, merged, reworded, or dropped — traced back to exact source
 * material and forward to exact variant text. This module finds the ways that
 * account can be dishonest: a claim that does not trace to the source, variant
 * content the source never supplied, source content no entry accounts for, an
 * anchor too short to have failed, a whole-line anchor that matches more than
 * one line without a disambiguating occurrence coordinate, a coordinate that
 * names a line its anchor does not occur on, a short anchor used to certify
 * required or authoritative content, a surviving entry with no candidate anchor
 * or an anchor absent from the candidate, a transformation with no stated
 * reason, a reworded claim that does not assert its meaning survived, a required
 * kind dropped, required content missing or covered ambiguously, authority
 * quietly relocated to the companion document, or an acceptance criterion
 * weakened.
 *
 * The profile is named, never handed in. A caller passes a `profileId` string;
 * this module resolves it from the fixed profile table. A caller can no longer
 * hand in a profile shape that checks nothing.
 *
 * A clean ledger proves that no defect of these named kinds was found. It is not
 * a proof that meaning was preserved, and it approves nothing.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveProfile } from '../synthesis-profile/synthesis-profile.mjs';

export class DisclosureLedgerError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'DisclosureLedgerError';
    this.code = code;
    this.detail = detail;
  }
}

export const DISPOSITIONS = ['retained', 'merged', 'reworded', 'omitted'];
export const CLASSIFICATIONS = ['authoritative', 'supporting'];
export const KINDS = ['intention', 'criterion', 'non-goal', 'constraint', 'contradiction', 'context'];

/**
 * The defect vocabulary, owned by the `Defect Categories` table in
 * `disclosure-ledger.md`. The same codes live here so the module runs without
 * parsing Markdown, and the regression suite derives both directions so neither
 * the table nor the module may gain or lose a code silently. Input errors
 * (`invalid-input`, `unknown-profile`) are refusals of the call, not ledger
 * defects, and are deliberately not in this list.
 */
export const DEFECT_CODES = [
  'profile-shape-mismatch',
  'invalid-entry',
  'untraceable-claim',
  'degenerate-anchor',
  'ambiguous-anchor',
  'anchor-line-mismatch',
  'underweight-authority',
  'unanchored-survival',
  'variant-anchor-absent',
  'invented-claim',
  'unaccounted-source',
  'undisclosed-transformation',
  'meaning-loss',
  'semantic-omission',
  'required-content-omitted',
  'ambiguous-required-coverage',
  'overloaded-required-coverage',
  'unknown-required-content',
  'hidden-authority',
  'weakened-criterion',
];

/**
 * The two anchor thresholds, owned by `disclosure-ledger.md` and exported here
 * so exactly one definition exists. An anchor shorter than `MIN_ANCHOR_CHARS`
 * characters or carrying fewer than `MIN_ANCHOR_WORDS` word tokens is short
 * enough to match by accident, and an anchor that cannot fail proves nothing.
 * `split-proposal.mjs` imports these same numbers rather than restating them.
 */
export const MIN_ANCHOR_CHARS = 12;
export const MIN_ANCHOR_WORDS = 3;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Phrases that name relocation of authority into the companion (full) document.
 * This list is owned by `disclosure-ledger.md`; the same tokens live here so the
 * check runs without parsing Markdown, and the regression suite derives both
 * directions.
 */
export const RELOCATION_PHRASES = [
  'relocated-to-companion',
  'moved to the full',
  'deferred to the full',
  'covered by the full',
  'see the full',
];

/**
 * A residue token is *shaped like* a structural token when it is pure
 * punctuation, a numeric literal or numeric compound, or a stable identifier of
 * the shape `AC-001`. This allowlist is owned by `disclosure-ledger.md`; the
 * regression suite derives it from that document in both directions. Punctuation
 * is structural unconditionally, but a number or identifier is structural only
 * when that exact token also occurs in the `sourceAnchor` of an entry that
 * covers the same line — a number is exactly the kind of thing that must never
 * be invented, so a candidate number traced to no covering claim is not excused.
 * Structural tokens excuse only the leftovers on a line an anchor already
 * matched; they never excuse an unanchored line.
 *
 * Tokenization happens FIRST, then classification. A numeric COMPOUND is one
 * token, so a currency amount, range, ratio, date, time, dotted version,
 * exponent, hexadecimal literal, or ordinal is a single unit that must occur in
 * the covering anchor — punctuation is structural only when it is NOT part of
 * such a compound. So `$5`, `5-10`, `5–10`, `5/10`, `5:1`, `09:30`,
 * `2026-08-29`, `2026.08.29`, `1.2.3`, `1e6`, `0x1F`, and `5th` each tokenize
 * atomically and never decompose into a bare number beside structural
 * punctuation; a candidate `$5` traced to a source that only said `5`, a colon
 * ratio `5:1` built from a separate `5` and `1`, a dotted date `2026.08.29`
 * assembled from `2026.08` and `29`, or an invented `5–10` range built from a
 * separate `5` and `10`, is an invented claim because the compound token is
 * absent from the covering `sourceAnchor`. A separator binds only BETWEEN two
 * numeric endpoints, so an ordinary sentence-final period does not glue onto the
 * number before it.
 *
 * A compound separator may carry OPTIONAL WHITESPACE on either side, so a spaced
 * range or ratio (`5 – 10`, `5 : 1`) is still one token; and each endpoint may
 * carry the same affixes a standalone numeric literal may — a leading currency
 * symbol, a trailing percent sign, and a trailing unit or ordinal suffix — so a
 * unit- or symbol-bearing range (`5ms–10ms`, `5%–10%`, `$5–$10`) is one token
 * too. The spaced separator must still sit between two numeric endpoints (each
 * carrying a digit), so an em dash between words, a colon before a list, and a
 * sentence-final period are not separators and do not glue prose together.
 */
const NUM_CORE = '[+-]?\\d[\\d,]*(?:\\.\\d+)?';

/**
 * A numeric compound ENDPOINT, owned alongside `NUMERIC_COMPOUND` by the
 * `Structural token shapes` section of `disclosure-ledger.md`. An endpoint is a
 * numeric core with the same optional affixes a standalone literal may carry: a
 * leading currency symbol, a trailing percent sign, and a trailing unit or
 * ordinal suffix. Each side of a compound separator is an endpoint, so
 * `$5–$10`, `5%–10%`, and `5ms–10ms` are single tokens while a bare separator
 * between two words never is.
 */
const NUM_ENDPOINT = `[$€£¥]?${NUM_CORE}%?[\\p{L}]*`;

/**
 * A numeric compound, owned by the `Structural token shapes` section of
 * `disclosure-ledger.md`, as an ordered alternation matched leftmost-first: a
 * hexadecimal literal (`0x1F`); an exponent (`1e6`, `2.5e-3`); a separator-joined
 * range, ratio, date, time, or dotted version (`5-10`, `5–10`, `5/10`, `5:1`,
 * `09:30`, `2026-08-29`, `2026/08/29`, `2026.08.29`, `1.2.3`, and the spaced and
 * affixed forms `5 – 10`, `5 : 1`, `5ms–10ms`, `5%–10%`, `$5–$10`); an adjacent
 * currency-symbol amount (`$5`, `€5`); or a plain numeric literal with an
 * optional `%` and trailing unit or ordinal suffix (`2.5`, `-5`, `99%`, `1,000`,
 * `500ms`, `5th`). The separator set is `-`, en dash, em dash, `/`, `:`, and
 * `.`, and a separator may carry OPTIONAL WHITESPACE on either side, so a colon
 * ratio or time and a dotted date or version atomize into one token — spaced or
 * not — rather than decomposing into a bare number beside structural
 * punctuation. Each endpoint is a `NUM_ENDPOINT`, so a currency symbol, percent
 * sign, or unit suffix on either side stays inside the compound. Each separator
 * must sit BETWEEN two numeric endpoints, so a sentence-final period (`The limit
 * is 500.`) is not a separator and the `500` stays a plain literal beside a bare
 * `.`. The range alternative is ordered BEFORE the currency and plain literals so
 * `5-10` never decomposes into `5` and `10` and `$5–$10` never decomposes into
 * `$5` and `$10`.
 */
const NUMERIC_COMPOUND = `0[xX][0-9A-Fa-f]+|${NUM_CORE}[eE][+-]?\\d+|${NUM_ENDPOINT}(?:\\s*[-–—/:.]\\s*${NUM_ENDPOINT})+|[$€£¥]${NUM_CORE}%?|${NUM_CORE}%?[\\p{L}]*`;

export const STRUCTURAL_TOKEN_SHAPES = [
  /^[^\p{L}\p{N}]+$/u,
  new RegExp(`^(?:${NUMERIC_COMPOUND})$`, 'u'),
  /^[A-Z][A-Z0-9]*-\d+$/,
];

/** The punctuation shape is unconditional; the rest are gated on anchor presence. */
const PUNCTUATION_SHAPE = STRUCTURAL_TOKEN_SHAPES[0];
const ANCHOR_GATED_SHAPES = STRUCTURAL_TOKEN_SHAPES.slice(1);

/**
 * The fence info-string grammar, owned by the `Fence delimiter lines` section of
 * `disclosure-ledger.md`. The same pattern lives here so the check runs without
 * parsing Markdown, and the regression suite derives both directions. A fence
 * opener's remainder is a language info string — pure syntax excluded from
 * coverage — ONLY when it is a defensible language tag optionally followed by an
 * attribute block:
 *
 * - The language tag STARTS WITH A LOWERCASE LETTER, is at most 20 characters,
 *   and carries at most two internal separators drawn from `_ + . -`. Real
 *   Markdown language tags are conventionally lowercase, so this admits `text`,
 *   `js`, `jsx`, `c++`, `objective-c`, and `shell-session`, but not a smuggled
 *   imperative such as `Erase-user-data` (it carries an uppercase letter, so it
 *   reads as prose) nor a hyphenated sentence such as
 *   `Delete-all-customer-records-now` (too long, too many separators, and
 *   capitalised).
 * - The optional attribute block is a real attribute list: a brace-delimited,
 *   whitespace-separated sequence of `.class`, `#id`, or `key=value` tokens, so
 *   `{.line-numbers}` is syntax but `{Delete all customer records now}` is not.
 *
 * A remainder that does NOT match — arbitrary prose after the run, such as
 * `Delete all customer records now`, a capitalised or hyphenated sentence, or a
 * brace block of prose — is CONTENT, so the whole line participates in coverage
 * on both sides and requires a trace; it cannot smuggle an invented claim past
 * validation as a fence opener's tail.
 */
const FENCE_LANG_TAG = '[a-z][a-z0-9]*(?:[_+.-][a-z0-9]*){0,2}';
const FENCE_LANG_LENGTH = '(?=[a-z0-9_+.-]{1,20}(?:\\s|\\{|$))';
const FENCE_ATTR = '(?:[.#][A-Za-z0-9_-]+|[A-Za-z0-9_-]+=[^\\s{}]+)';
const FENCE_ATTR_BLOCK = `\\{\\s*(?:${FENCE_ATTR}(?:\\s+${FENCE_ATTR})*)?\\s*\\}`;
export const FENCE_INFO_STRING = new RegExp(
  `^${FENCE_LANG_LENGTH}${FENCE_LANG_TAG}(?:\\s*${FENCE_ATTR_BLOCK})?$`,
);

/**
 * The residue tokenizer. A numeric compound is matched FIRST and atomically, so
 * `$5`, `5-10`, `2026-08-29`, and `500ms` are single tokens; then word tokens
 * (including identifiers like `AC-001`); then any single punctuation character.
 * Shared by coverage and by anchor-token collection so both see numbers the same
 * way, and its numeric alternation is exactly `NUMERIC_COMPOUND` so a token and
 * its structural shape can never drift apart.
 */
const RESIDUE_TOKEN = new RegExp(`${NUMERIC_COMPOUND}|[\\p{L}\\p{N}][\\p{L}\\p{N}-]*|[^\\s\\p{L}\\p{N}]`, 'gu');

function residueTokenize(text) {
  return String(text).match(RESIDUE_TOKEN) ?? [];
}

/** A word token carries at least one Unicode letter or digit. */
function wordTokens(text) {
  return String(text)
    .trim()
    .split(/\s+/)
    .filter((token) => token !== '' && /[\p{L}\p{N}]/u.test(token));
}

/**
 * An anchor is degenerate when, after trimming, it has fewer than
 * `MIN_ANCHOR_CHARS` characters or fewer than `MIN_ANCHOR_WORDS` word tokens.
 * Exported so `split-proposal.mjs` can hold its cohesive-text fields to the same
 * bar from one definition.
 */
export function isDegenerateAnchor(text) {
  if (typeof text !== 'string') {
    return true;
  }
  const trimmed = text.trim();
  if (trimmed.length < MIN_ANCHOR_CHARS) {
    return true;
  }
  return wordTokens(trimmed).length < MIN_ANCHOR_WORDS;
}

/**
 * Decide whether an anchor is degenerate *in the context of the lines it covers*.
 * A whole-line anchor — one that exactly equals a full content line after the
 * same leading-marker stripping coverage uses — cannot match by accident: it IS
 * the line, so the length and word minimums do not apply to it. Only an anchor
 * that is a proper substring of the lines it covers must clear
 * `MIN_ANCHOR_CHARS`/`MIN_ANCHOR_WORDS`. This is what lets a legitimate nano
 * account for short metadata lines such as `# Faster checkout` or
 * `- Source: docs/...` without a false `degenerate-anchor`.
 */
function anchorDegenerate(anchor, units) {
  if (typeof anchor !== 'string') {
    return true;
  }
  if (units.some((unit) => unit.stripped === anchor)) {
    return false;
  }
  return isDegenerateAnchor(anchor);
}

/**
 * A whole-line anchor is one that exactly equals a full content line (after the
 * same leading-marker stripping coverage uses). Such an anchor is exempt from
 * the length/word minimums, so its authority must be checked another way.
 */
function isWholeLineAnchor(anchor, units) {
  return typeof anchor === 'string' && units.some((unit) => unit.stripped === anchor);
}

/**
 * How many content lines an anchor is a substring of. A whole-line anchor that
 * also occurs inside other lines matches more than one line and cannot pinpoint
 * the line it certifies. A one-character anchor such as `a` occurs inside almost
 * every line of a real document and is caught here.
 */
function lineMatchCount(anchor, units) {
  if (typeof anchor !== 'string' || anchor === '') {
    return 0;
  }
  return units.reduce((count, unit) => (unit.stripped.includes(anchor) ? count + 1 : count), 0);
}

/**
 * Whether an anchor occurs on the 1-based content-unit line a coordinate names.
 * The coordinate is counted over the SAME stripped content units coverage uses
 * (`contentUnits`): 1 is the first non-blank content line after fence exclusion
 * and leading-marker stripping, 2 the second, and so on. A coordinate outside
 * `1..units.length`, or one whose named line does not contain the anchor as a
 * substring, does not occur where it claims — the caller records
 * `anchor-line-mismatch`.
 */
function anchorOccursOnLine(anchor, units, coord) {
  return typeof anchor === 'string'
    && Number.isInteger(coord)
    && coord >= 1
    && coord <= units.length
    && units[coord - 1].stripped.includes(anchor);
}

/**
 * A short anchor carries no authority. An anchor shorter than `MIN_ANCHOR_CHARS`
 * characters, after trimming, may account for supporting content but may not
 * certify a required-content item or authoritative material, so it is refused on
 * any entry that declares `covers` or is `classification: authoritative`.
 */
function isShortAnchor(anchor) {
  return typeof anchor === 'string' && anchor.trim().length < MIN_ANCHOR_CHARS;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

/**
 * Canonical serialization hashed with SHA-256: entries sorted by id, object
 * keys sorted, so identical inputs produce an identical digest regardless of
 * entry order or key insertion order.
 */
export function ledgerDigest(entries) {
  if (!Array.isArray(entries)) {
    throw new DisclosureLedgerError('invalid-input', 'entries must be an array');
  }
  const sorted = [...entries].sort((a, b) => String(a?.id).localeCompare(String(b?.id)));
  return createHash('sha256').update(stableStringify(sorted)).digest('hex');
}

function structurallyValid(entry) {
  return Boolean(
    entry
    && typeof entry === 'object'
    && !Array.isArray(entry)
    && typeof entry.id === 'string' && entry.id.trim() !== ''
    && DISPOSITIONS.includes(entry.disposition)
    && KINDS.includes(entry.kind)
    && CLASSIFICATIONS.includes(entry.classification)
    && typeof entry.sourceAnchor === 'string' && entry.sourceAnchor.trim() !== ''
    && (entry.variantAnchor === undefined || (typeof entry.variantAnchor === 'string' && entry.variantAnchor !== ''))
    && (entry.reason === undefined || typeof entry.reason === 'string')
    && (entry.meaningPreserved === undefined || typeof entry.meaningPreserved === 'boolean')
    && (entry.sourceLine === undefined || (Number.isInteger(entry.sourceLine) && entry.sourceLine >= 1))
    && (entry.variantLine === undefined || (Number.isInteger(entry.variantLine) && entry.variantLine >= 1))
    && (entry.covers === undefined || (Array.isArray(entry.covers) && entry.covers.every((id) => typeof id === 'string' && id.trim() !== ''))),
  );
}

function namesRelocation(reason) {
  if (typeof reason !== 'string') {
    return false;
  }
  const lowered = reason.toLowerCase();
  return RELOCATION_PHRASES.some((phrase) => lowered.includes(phrase));
}

const HEADING_LINE = /^\s{0,3}#{1,6}\s/;

function toPosix(value) {
  return String(value).split(/[\\/]/).join('/');
}

function posixBasename(value) {
  const parts = toPosix(value).split('/');
  return parts[parts.length - 1];
}

/**
 * Section labels are compared **exactly**: surrounding whitespace is trimmed,
 * but the comparison is CASE-SENSITIVE and interior whitespace is NOT collapsed.
 * So `## Non-goals` matches the declared `Non-goals`, while `## Non-Goals`,
 * `## INTENTION`, and an interior-double-space variant do not. "Exactly" in the
 * documentation therefore means exactly what the code does.
 */
function normalizeHeading(text) {
  return text.trim();
}

function stripLeadingMarkers(line) {
  let stripped = line;
  let changed = true;
  while (changed) {
    const before = stripped;
    stripped = stripped
      .replace(/^\s+/, '')
      .replace(/^>+\s*/, '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^\d+[.)]\s+/, '');
    changed = stripped !== before;
  }
  return stripped;
}

/**
 * Classify a line as a fence delimiter, statelessly describing its SHAPE only.
 * A delimiter is three or more backticks or tildes at the start of a line
 * indented fewer than four spaces (Markdown's indentation limit: a marker
 * indented four or more spaces is an indented code block, i.e. content, not a
 * fence). The remainder after the run is an info string ONLY when it matches the
 * narrow language-identifier grammar `FENCE_INFO_STRING`; a remainder of
 * arbitrary prose is NOT syntax, so the line is not a delimiter at all and
 * returns `null` to be accounted for as content. For a backtick fence the info
 * string may not itself contain a backtick, so a `` ``` `` line with a stray
 * backtick in its tail is not a delimiter. Returns `{marker, len, info}` where
 * `info` is whether a (grammar-valid) info string is present, or `null` when the
 * line is not delimiter-shaped or its remainder is non-syntax prose. Whether
 * such a line OPENS or CLOSES a fence is a question of state, decided in
 * `contentUnits`, not here.
 */
function fenceDelimiter(line) {
  const match = /^(\s*)(`{3,}|~{3,})([^\n]*)$/.exec(line);
  if (!match) {
    return null;
  }
  if (match[1].length >= 4) {
    return null;
  }
  const marker = match[2][0];
  const rest = match[3];
  if (marker === '`' && rest.includes('`')) {
    return null;
  }
  const info = rest.trim();
  if (info !== '' && !FENCE_INFO_STRING.test(info)) {
    return null;
  }
  return { marker, len: match[2].length, info: info !== '' };
}

/**
 * The non-blank content units of a document, with fences parsed STATEFULLY.
 * Each unit carries whether its ORIGINAL line was a heading and the line
 * stripped of leading Markdown markers. Headings are content, accounted for like
 * any other line except when they exactly equal a declared section label.
 *
 * Fence handling is a small state machine. Outside a fence, a delimiter-shaped
 * line OPENS a fence, recording its marker character and run length; an info
 * string is permitted on the opener only when it matches the language-identifier
 * grammar, and a delimiter-shaped line whose remainder is non-syntax prose is
 * not a delimiter at all (it is content). Inside a fence, the ONLY line that
 * closes it is a delimiter of the SAME marker character, at least as long as the
 * opener, and carrying no info string; every other line — including a delimiter
 * of a DIFFERENT marker — is content between the fences and still requires
 * anchors on both sides. Only true opening and closing delimiter lines are
 * excluded from coverage. The limit this keeps: a true opening or closing
 * delimiter line — its remainder empty or a bare language tag — can never itself
 * be accounted for, so only that delimiter syntax carries no claim; an opener
 * whose tail is prose is content and must be traced, and an unterminated fence
 * simply runs to the end of the document.
 */
function contentUnits(text) {
  const units = [];
  let fence = null;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const delimiter = fenceDelimiter(raw);
    if (fence === null) {
      if (delimiter) {
        fence = { marker: delimiter.marker, len: delimiter.len };
        continue;
      }
    } else if (delimiter && delimiter.marker === fence.marker && delimiter.len >= fence.len && !delimiter.info) {
      fence = null;
      continue;
    }
    const stripped = stripLeadingMarkers(raw);
    if (stripped.trim() !== '') {
      units.push({ isHeading: HEADING_LINE.test(raw), stripped });
    }
  }
  return units;
}

/**
 * A residue token is structural when it is pure punctuation (unconditionally),
 * or a numeric literal or stable identifier that ALSO occurs as a token in the
 * `allowance` — the union of the `sourceAnchor` tokens of the entries whose
 * anchor matched this same line. A number or identifier traced to no covering
 * claim is exactly an invented threshold or identifier, so it is not excused.
 */
function isStructuralToken(token, allowance) {
  if (PUNCTUATION_SHAPE.test(token)) {
    return true;
  }
  if (ANCHOR_GATED_SHAPES.some((shape) => shape.test(token))) {
    return allowance.has(token);
  }
  return false;
}

/**
 * Every match span of `anchor` within `line`, as `[start, end)` half-open
 * intervals over UTF-16 code units (the same units `String.prototype.indexOf`
 * and `.length` count, so a span aligns exactly with the characters it names).
 * Occurrences are found left to right; an empty anchor yields no spans.
 */
function anchorSpans(line, anchor) {
  const spans = [];
  if (typeof anchor !== 'string' || anchor === '') {
    return spans;
  }
  let from = 0;
  let index = line.indexOf(anchor, from);
  while (index !== -1) {
    spans.push([index, index + anchor.length]);
    from = index + anchor.length;
    index = line.indexOf(anchor, from);
  }
  return spans;
}

/**
 * Replace every code unit inside any of `spans` with a space, leaving the rest
 * of `line` intact. The union of spans is masked in ONE pass over the original
 * line, so overlapping spans mask their union and no span is ever computed
 * against a line an earlier span already mutated.
 */
function maskSpans(line, spans) {
  if (spans.length === 0) {
    return line;
  }
  const chars = line.split('');
  for (const [start, end] of spans) {
    for (let i = start; i < end && i < chars.length; i += 1) {
      chars[i] = ' ';
    }
  }
  return chars.join('');
}

/**
 * Token-residue coverage, gated per entry and ORDER-INDEPENDENT. Every anchor's
 * matched character spans are computed against the ORIGINAL stripped line, never
 * against a residue an earlier anchor already rewrote, so the result does not
 * depend on the order entries happen to be listed in: a short honest anchor and
 * a longer honest anchor that overlap on the same line both contribute their
 * spans, and the union is masked in one pass. The line is covered only when some
 * anchor matched it AND every unmasked residue token is structural —
 * punctuation, or a number/identifier carried by a covering entry's own
 * `sourceAnchor`. An UNANCHORED line is never covered, whatever its tokens. A
 * number borrowed from an unrelated sentence elsewhere in the document is not in
 * any covering anchor, so it is not structural here.
 *
 * A coordinate binds an anchor to the ONE content unit it names. An entry that
 * supplies a coordinate for this side (`sourceLine` on the source,
 * `variantLine` on the candidate) contributes its span only to that line — so an
 * anchor bound to line 9 does not silently cover an identical substring on line
 * 10. An entry with no coordinate for this side contributes to every line its
 * anchor is a substring of, as before.
 */
function lineCovered(stripped, lineNumber, entries, anchorKey, coordKey) {
  let matched = false;
  const spans = [];
  const allowance = new Set();
  for (const entry of entries) {
    const anchor = entry[anchorKey];
    if (typeof anchor !== 'string' || anchor === '') {
      continue;
    }
    const coord = entry[coordKey];
    if (Number.isInteger(coord) && coord !== lineNumber) {
      continue;
    }
    const entrySpans = anchorSpans(stripped, anchor);
    if (entrySpans.length === 0) {
      continue;
    }
    matched = true;
    spans.push(...entrySpans);
    for (const token of residueTokenize(entry.sourceAnchor)) {
      allowance.add(token);
    }
  }
  if (!matched) {
    return false;
  }
  const residue = maskSpans(stripped, spans);
  return residueTokenize(residue).every((token) => isStructuralToken(token, allowance));
}

/**
 * Coverage defects for one side. A heading whose text is exactly one of the
 * profile's declared section labels is exempt; every other unit, heading or
 * not, must be covered by an entry anchor on the given side (`sourceAnchor` and
 * `sourceLine` for the source, `variantAnchor` and `variantLine` for the
 * candidate). The 1-based content-unit line number is passed through so a
 * coordinate-bearing entry contributes only to the line it names.
 */
function coverageDefects(units, entries, anchorKey, coordKey, exemptHeadings, code, message) {
  const defects = [];
  units.forEach((unit, index) => {
    if (unit.isHeading && exemptHeadings.has(normalizeHeading(unit.stripped))) {
      return;
    }
    if (!lineCovered(unit.stripped, index + 1, entries, anchorKey, coordKey)) {
      defects.push({ code, line: unit.stripped, message });
    }
  });
  return defects;
}

/**
 * Return every defect found, in a deterministic order, so a caller can report
 * them together. `validateLedger` throws the first of these.
 */
export function collectLedgerDefects({ entries, sourceText, variantText, profileId, sourcePath, candidatePath }) {
  if (!Array.isArray(entries)) {
    return [{ code: 'invalid-entry', message: 'entries must be an array' }];
  }
  if (typeof sourceText !== 'string' || typeof variantText !== 'string') {
    throw new DisclosureLedgerError('invalid-input', 'sourceText and variantText must be strings');
  }
  let profile;
  try {
    profile = resolveProfile(profileId);
  } catch {
    throw new DisclosureLedgerError('unknown-profile', `no synthesis profile is named ${profileId}`);
  }
  if (typeof sourcePath !== 'string' || sourcePath.trim() === ''
    || typeof candidatePath !== 'string' || candidatePath.trim() === '') {
    throw new DisclosureLedgerError('invalid-input', 'sourcePath and candidatePath are required');
  }

  const defects = [];

  // Content units are computed once. The degenerate-anchor check is line-aware
  // (a whole-line anchor is never degenerate), residue coverage gates numbers
  // and identifiers per covering entry, and fences are parsed statefully.
  const sourceUnits = contentUnits(sourceText);
  const variantUnits = contentUnits(variantText);

  // 0. Profile shape: the source and candidate must be the artifacts this
  //    profile names. The source basename must be `<slug>.<sourceKind-suffix>.md`
  //    and the candidate must be the profile's outputPattern with the SAME slug,
  //    so profile fields are enforced rather than decorative labels.
  const sourceSuffix = profile.sourceKind.split('-').slice(1).join('-');
  const sourceMatch = new RegExp(`^(.+)\\.${sourceSuffix}\\.md$`).exec(posixBasename(sourcePath));
  const slug = sourceMatch ? sourceMatch[1] : null;
  const expectedCandidate = slug === null ? null : profile.outputPattern.replace('<slug>', slug);
  if (slug === null || !SLUG_PATTERN.test(slug)) {
    defects.push({ code: 'profile-shape-mismatch', message: `source ${posixBasename(sourcePath)} is not a ${profile.sourceKind} artifact named <slug>.${sourceSuffix}.md` });
  } else if (toPosix(candidatePath) !== expectedCandidate) {
    defects.push({ code: 'profile-shape-mismatch', message: `candidate ${toPosix(candidatePath)} does not match ${profile.outputPattern} for slug ${slug}` });
  }

  // 1. Structural validity and duplicate ids.
  const seenIds = new Set();
  const validEntries = [];
  for (const entry of entries) {
    if (!structurallyValid(entry)) {
      defects.push({ code: 'invalid-entry', id: entry?.id ?? null, message: 'entry is malformed or missing a required field' });
      continue;
    }
    if (seenIds.has(entry.id)) {
      defects.push({ code: 'invalid-entry', id: entry.id, message: 'duplicate entry id' });
      continue;
    }
    seenIds.add(entry.id);
    validEntries.push(entry);
  }

  // 2. Per-entry semantic checks, in entry order.
  for (const entry of validEntries) {
    if (!sourceText.includes(entry.sourceAnchor)) {
      defects.push({ code: 'untraceable-claim', id: entry.id, message: 'sourceAnchor is not exact source material' });
    }
    if (anchorDegenerate(entry.sourceAnchor, sourceUnits)
      || (typeof entry.variantAnchor === 'string' && entry.variantAnchor !== '' && anchorDegenerate(entry.variantAnchor, variantUnits))) {
      defects.push({ code: 'degenerate-anchor', id: entry.id, message: `an anchor shorter than ${MIN_ANCHOR_CHARS} characters or ${MIN_ANCHOR_WORDS} words could match by accident` });
    }
    // A whole-line anchor escapes the length minimum because it IS the line, so
    // it must instead pinpoint the ONE line it certifies on the side it is used
    // for. An anchor a whole line yet a substring of others matches many lines —
    // a one-character anchor matches almost all of them. When such an anchor
    // names no disambiguating line coordinate it certifies nothing in
    // particular (`ambiguous-anchor`). A coordinate resolves the occurrence, but
    // only when it actually points at a line the anchor occurs on; a coordinate
    // naming a line the anchor does not match is `anchor-line-mismatch`.
    for (const [anchorKey, coordKey, units, side] of [
      ['sourceAnchor', 'sourceLine', sourceUnits, 'source'],
      ['variantAnchor', 'variantLine', variantUnits, 'candidate'],
    ]) {
      const anchor = entry[anchorKey];
      if (typeof anchor !== 'string' || anchor === '') {
        continue;
      }
      const coord = entry[coordKey];
      const hasCoord = coord !== undefined;
      if (hasCoord && !anchorOccursOnLine(anchor, units, coord)) {
        defects.push({ code: 'anchor-line-mismatch', id: entry.id, message: `${coordKey} ${coord} does not name a ${side} line the ${anchorKey} occurs on` });
      } else if (!hasCoord && isWholeLineAnchor(anchor, units) && lineMatchCount(anchor, units) > 1) {
        defects.push({ code: 'ambiguous-anchor', id: entry.id, message: `a whole-line ${anchorKey} matches more than one ${side} line and names no ${coordKey}` });
      }
    }
    // A short anchor carries no authority. It may account for supporting content,
    // but it may not certify a required-content item or authoritative material,
    // so it is refused on any entry that declares `covers` or is authoritative.
    if ((Array.isArray(entry.covers) && entry.covers.length > 0) || entry.classification === 'authoritative') {
      if (isShortAnchor(entry.sourceAnchor)
        || (typeof entry.variantAnchor === 'string' && entry.variantAnchor !== '' && isShortAnchor(entry.variantAnchor))) {
        defects.push({ code: 'underweight-authority', id: entry.id, message: `an anchor shorter than ${MIN_ANCHOR_CHARS} characters may not certify required or authoritative content` });
      }
    }
    // A surviving entry — retained, merged, or reworded — must carry a
    // variantAnchor that actually occurs in the candidate. Only an omitted entry
    // may lack one. A missing anchor is `unanchored-survival`; a present anchor
    // absent from the candidate is `variant-anchor-absent`.
    if (['retained', 'merged', 'reworded'].includes(entry.disposition)) {
      if (typeof entry.variantAnchor !== 'string' || entry.variantAnchor === '') {
        defects.push({ code: 'unanchored-survival', id: entry.id, message: `a ${entry.disposition} entry must carry a variantAnchor tying it to candidate text` });
      } else if (!variantText.includes(entry.variantAnchor)) {
        defects.push({ code: 'variant-anchor-absent', id: entry.id, message: 'variantAnchor does not occur in the candidate text' });
      }
    }
    if (['merged', 'reworded', 'omitted'].includes(entry.disposition)
      && (typeof entry.reason !== 'string' || entry.reason.trim() === '')) {
      defects.push({ code: 'undisclosed-transformation', id: entry.id, message: `${entry.disposition} entry states no reason` });
    }
    if (entry.kind === 'criterion' && ['merged', 'omitted'].includes(entry.disposition)) {
      defects.push({ code: 'weakened-criterion', id: entry.id, message: 'an acceptance criterion may not be merged or omitted' });
    }
    if (entry.disposition === 'reworded' && entry.meaningPreserved !== true) {
      defects.push({ code: 'meaning-loss', id: entry.id, message: 'reworded entry does not assert meaningPreserved' });
    }
    if (entry.disposition === 'omitted' && profile.nonOmittableKinds.includes(entry.kind)) {
      defects.push({ code: 'semantic-omission', id: entry.id, message: `a ${entry.kind} may not be omitted under this profile` });
    }
    if (entry.classification === 'authoritative'
      && ['omitted', 'merged'].includes(entry.disposition)
      && namesRelocation(entry.reason)) {
      defects.push({ code: 'hidden-authority', id: entry.id, message: 'authoritative material relocated to the companion document' });
    }
  }

  // 2b. Coordinate collisions. A line coordinate names one occurrence; two
  //     entries naming the SAME coordinate for the same side both claim that one
  //     line and disambiguate nothing, so each is `ambiguous-anchor`.
  for (const [coordKey, side] of [['sourceLine', 'source'], ['variantLine', 'candidate']]) {
    const byCoord = new Map();
    for (const entry of validEntries) {
      const coord = entry[coordKey];
      if (Number.isInteger(coord)) {
        if (!byCoord.has(coord)) {
          byCoord.set(coord, []);
        }
        byCoord.get(coord).push(entry.id);
      }
    }
    for (const [coord, ids] of byCoord) {
      if (ids.length > 1) {
        for (const id of ids) {
          defects.push({ code: 'ambiguous-anchor', id, message: `${coordKey} ${coord} is named by more than one entry, so they claim the same ${side} line` });
        }
      }
    }
  }

  // 3. Required content coverage, declared by each entry's `covers` field. Each
  //    required id must be covered by exactly one retained or reworded entry,
  //    and no single entry may carry more than one required id.
  const required = new Set(profile.requiredContent);
  const coverageCount = new Map(profile.requiredContent.map((id) => [id, 0]));
  for (const entry of validEntries) {
    const covers = Array.isArray(entry.covers) ? entry.covers : [];
    const requiredCovered = covers.filter((id) => required.has(id));
    if (requiredCovered.length > 1) {
      defects.push({ code: 'overloaded-required-coverage', id: entry.id, message: `entry covers ${requiredCovered.length} required-content ids; an entry may carry at most one` });
    }
    for (const id of covers) {
      if (!required.has(id)) {
        defects.push({ code: 'unknown-required-content', id: entry.id, requiredId: id, message: `entry covers ${id}, which the profile does not list` });
        continue;
      }
      if (['retained', 'reworded'].includes(entry.disposition)) {
        coverageCount.set(id, coverageCount.get(id) + 1);
      }
    }
  }
  for (const requiredId of profile.requiredContent) {
    const count = coverageCount.get(requiredId);
    if (count === 0) {
      defects.push({ code: 'required-content-omitted', requiredId, message: `required content ${requiredId} is covered by no retained or reworded entry` });
    } else if (count > 1) {
      defects.push({ code: 'ambiguous-required-coverage', requiredId, message: `required content ${requiredId} is covered by ${count} entries; exactly one is required` });
    }
  }

  const exemptHeadings = new Set(profile.structuralHeadings.map(normalizeHeading));

  // 4. Invented content: candidate lines no entry's variantAnchor accounts for.
  //    Coverage is gated per entry, so a candidate number or identifier is
  //    structural only when a covering entry's own sourceAnchor carries it.
  defects.push(...coverageDefects(
    variantUnits,
    validEntries,
    'variantAnchor',
    'variantLine',
    exemptHeadings,
    'invented-claim',
    'candidate content is not accounted for by any ledger entry',
  ));

  // 5. Unaccounted source: source content no entry's sourceAnchor accounts for.
  defects.push(...coverageDefects(
    sourceUnits,
    validEntries,
    'sourceAnchor',
    'sourceLine',
    exemptHeadings,
    'unaccounted-source',
    'source content is claimed by no ledger entry',
  ));

  return defects;
}

/**
 * Validate the ledger. Returns a clean result carrying the resolved profile id
 * and the ledger digest, or throws with the first defect code.
 */
export function validateLedger(input) {
  const defects = collectLedgerDefects(input);
  if (defects.length) {
    const [first] = defects;
    throw new DisclosureLedgerError(first.code, first.message, { ...first, defects });
  }
  return {
    status: 'clean',
    profileId: resolveProfile(input.profileId).id,
    entries: input.entries,
    digest: ledgerDigest(input.entries),
    candidatePath: input.candidatePath,
    candidateDigest: createHash('sha256').update(input.variantText).digest('hex'),
  };
}

export const USAGE = 'Usage: disclosure-ledger.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new DisclosureLedgerError('usage', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  streams.stdout.write(`${JSON.stringify(validateLedger(input), null, 2)}\n`);
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
      error: { code: error.code ?? 'invalid-input', message: error.message, detail: error.detail ?? {} },
    })}\n`);
    process.exitCode = 1;
  }
}
