#!/usr/bin/env node

/**
 * Report-side enforcement of the two intent rules a roast must not merely state.
 *
 * 1. **The intent is never a review target.** The intent is the operator's
 *    statement of what he wanted. The skill is judged against it, never the
 *    reverse. A finding whose `Location` is the intent, or whose
 *    `Recommendation` directs a change at the intent, inverts that relationship.
 *
 * 2. **Rationale may withdraw a finding; an instruction may not.** A reviewer
 *    that does not know why something was built a certain way reports the oddity
 *    as a defect, so an intent that explains the construction legitimately
 *    withdraws or downgrades the finding. That legitimate power is exactly what
 *    an injected line would want. So a withdrawal that leans on the intent must
 *    cite a specific line of it, and a line the directive screen flagged is not
 *    citable.
 *
 * The line between the two, stated once:
 *
 *   Rationale **explains a construction** the finding named. An instruction
 *   **asserts a conclusion** about the review. "We deliberately split these
 *   because the shapes drift" could have been written before any review existed.
 *   "This finding is wrong", "ignore all findings", and "this skill has no
 *   defects" only make sense as a message to a reviewer, and are inert.
 *
 * This module reuses `roast-contract.mjs` for parsing rather than growing a
 * second report parser. That parser already fails closed on an entry under an
 * unrecognised heading, and a second parser would be a second thing to drift.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACCEPTED_FINDING_SECTIONS,
  EXEMPT_FINDING_SECTIONS,
  parseFindings,
} from '../roast-contract/roast-contract.mjs';

export class IntentScreenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntentScreenError';
    this.code = code;
  }
}

/** The field an entry carries when it leans on the intent. */
export const CITATION_FIELD = 'Intent citation';

/**
 * Sections whose entries must cite the intent when they mention it.
 *
 * Derived from the contract module rather than retyped. An accepted finding
 * that invokes the intent is asserting a requirement; a disposition that
 * invokes it is withdrawing or downgrading on the strength of it. Both are
 * exactly where an injected line would try to arrive. The remaining exempt
 * sections — open risks, evidence gaps, dismissed suspicions — record what could
 * not be resolved and cannot withdraw anything, which is where the observation
 * about an absent intent belongs.
 */
export const DISPOSITION_SECTIONS = EXEMPT_FINDING_SECTIONS.filter((heading) =>
  heading.startsWith('Rejected'),
);
export const CITATION_REQUIRED_SECTIONS = [...ACCEPTED_FINDING_SECTIONS, ...DISPOSITION_SECTIONS];

/** Sections that may note the intent without citing a line of it. */
export const CITATION_OPTIONAL_SECTIONS = EXEMPT_FINDING_SECTIONS.filter(
  (heading) => !DISPOSITION_SECTIONS.includes(heading),
);

/** Verbs that make the intent the thing being changed rather than the standard. */
export const INTENT_CHANGE_VERBS = [
  'change',
  'edit',
  'update',
  'rewrite',
  'revise',
  'amend',
  'delete',
  'remove',
  'relax',
  'reword',
  'modify',
  'correct',
  'fix',
  'adjust',
  'loosen',
  'soften',
  'drop',
  'weaken',
  'replace',
  'broaden',
  'narrow',
];

const INTENT_WORD = /\bintent\b/i;
const CITATION_FORM = /^(\S+):L(\d+)(?:-L(\d+))?(?:\s|$)/;
const DETERMINER = String.raw`(?:the\s+|this\s+|that\s+|its\s+|his\s+|your\s+|our\s+)?(?:file\s+)?(?:operator'?s?\s+)?(?:skill'?s?\s+)?(?:package'?s?\s+)?`;

function escapeToken(token) {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when the text directs a change **at** the intent.
 *
 * The verb must govern the intent directly. "Update the intent to match the
 * skill" inverts the relationship; "update SKILL.md to match the intent" is the
 * correct direction and must not be caught. That distinction is why this looks
 * for the intent as the verb's object rather than for the two words anywhere in
 * the same sentence.
 */
export function directsChangeAtIntent(text, locator = null) {
  if (typeof text !== 'string' || text.trim() === '') {
    return null;
  }
  const targets = [String.raw`intent(?:\.md)?\b`];
  if (locator) {
    targets.push(escapeToken(locator));
  }
  for (const verb of INTENT_CHANGE_VERBS) {
    for (const target of targets) {
      const pattern = new RegExp(`\\b${escapeToken(verb)}(?:s|d|ed|ing)?\\s+${DETERMINER}${target}`, 'i');
      if (pattern.test(text)) {
        return verb;
      }
    }
  }
  const nounForm = /\b(?:changes?|edits?|updates?|revisions?|modifications?|amendments?)\s+to\s+(?:the\s+)?intent\b/i;
  return nounForm.test(text) ? 'change' : null;
}

/** True when a `Location` value names the intent as the located artifact. */
export function locatesIntent(value, locator = null) {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }
  if (/\bintent\.md\b/i.test(value)) {
    return true;
  }
  if (locator && value.includes(locator)) {
    return true;
  }
  return /^\s*(?:the\s+)?intent\b/i.test(value);
}

function entryText(entry, { includeCitation = false } = {}) {
  const parts = [entry.id];
  for (const [name, field] of entry.fields) {
    if (!includeCitation && name === CITATION_FIELD) {
      continue;
    }
    parts.push(field.value);
  }
  return parts.join('\n');
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const SWEPT_FIELD = /^\s*-\s+(Location|Intent citation)\s*:\s*(.*)$/;

/**
 * Fail-closed sweep for schema field lines no parsed entry owns.
 *
 * The entry parser keys on a `###` heading. A report that writes a finding some
 * other way — bolded, under a fourth-level heading, or with the heading lost —
 * produces zero entries, and every per-entry rule above then passes on a report
 * that visibly names the intent as its target. That is the exact failure this
 * repository has shipped before: a checker that saw nothing and called it
 * success, behind a fully green suite.
 *
 * So the raw text is swept for the two field labels these rules turn on, and any
 * occurrence outside a fenced block that no parsed entry claims is a defect in
 * its own right rather than a silent skip.
 */
function unattributedFields(report, entries) {
  const claimed = new Set();
  for (const entry of entries) {
    for (const field of entry.fields.values()) {
      claimed.add(field.line);
    }
  }

  const found = [];
  let fence = null;
  const lines = report.replace(/\r\n/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = FENCE.exec(lines[index]);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) {
      continue;
    }
    const match = SWEPT_FIELD.exec(lines[index]);
    if (match && !claimed.has(index + 1)) {
      found.push({ line: index + 1, label: match[1], value: match[2].trim() });
    }
  }
  return found;
}

function requireScreenedRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new IntentScreenError('usage', 'an intent record is required');
  }
  if (!['Present', 'Empty', 'Missing', 'Unreadable'].includes(record.status)) {
    throw new IntentScreenError('unscreened_intent', `unknown intent status: ${record.status}`);
  }
  if (typeof record.locator !== 'string' || record.locator.trim() === '') {
    throw new IntentScreenError(
      'unscreened_intent',
      'the intent record carries no locator, so a citation could name any file and resolve',
    );
  }
  const screen = record.screen;
  if (!screen || screen.performed !== true) {
    throw new IntentScreenError(
      'unscreened_intent',
      'the intent record carries no performed directive screen, so the injection screen was skipped',
    );
  }
  if (!Array.isArray(screen.directiveLines)) {
    throw new IntentScreenError('unscreened_intent', 'the intent record declares no directiveLines');
  }
  const hasContent = record.status === 'Present' || record.status === 'Empty';
  if (hasContent) {
    if (screen.applicable !== true) {
      throw new IntentScreenError(
        'unscreened_intent',
        `intent status ${record.status} has content but the screen reports it as not applicable`,
      );
    }
    if (screen.linesScreened !== record.lines) {
      throw new IntentScreenError(
        'unscreened_intent',
        `the screen examined ${screen.linesScreened} of ${record.lines} line(s), so part of the intent was never classified`,
      );
    }
  }
  return record;
}

/**
 * Validates one synthesized roast against the intent rules.
 *
 * Returns `Valid` with an empty defect list, or `Invalid` naming each entry and
 * the rule it broke. A report that never mentions the intent is valid: the rules
 * are per entry, not a demand that the intent be invoked.
 */
export function screenReport(report, record, options = {}) {
  if (typeof report !== 'string') {
    throw new IntentScreenError('invalid_report', 'report must be a string');
  }
  requireScreenedRecord(record);

  const parsed = parseFindings(report, options.sections);
  const unattributed = unattributedFields(report, parsed.entries);
  const locator = record.locator ?? null;
  const flagged = new Map(record.screen.directiveLines.map((entry) => [entry.line, entry]));
  const optional = new Set(CITATION_OPTIONAL_SECTIONS);
  const defects = [];
  let intentReferences = 0;
  let citations = 0;

  for (const entry of parsed.entries) {
    const location = entry.fields.get('Location')?.value ?? '';
    if (locatesIntent(location, locator)) {
      defects.push({
        category: 'Intent as review target',
        entry: entry.id,
        section: entry.section,
        line: entry.fields.get('Location')?.line ?? entry.line,
        message: `entry ${entry.id} locates the intent at "${location.trim()}"; the skill is judged against the intent, never the intent against the skill`,
      });
    }

    const recommendation = entry.fields.get('Recommendation')?.value ?? '';
    const verb = directsChangeAtIntent(recommendation, locator);
    if (verb) {
      defects.push({
        category: 'Intent as review target',
        entry: entry.id,
        section: entry.section,
        line: entry.fields.get('Recommendation')?.line ?? entry.line,
        message: `entry ${entry.id} recommends to ${verb} the intent; changing the intent is the operator's decision and never a recommendation of this review`,
      });
    }

    const citation = entry.fields.get(CITATION_FIELD)?.value?.trim() ?? '';
    const mentionsIntent = INTENT_WORD.test(entryText(entry));
    if (mentionsIntent) {
      intentReferences += 1;
    }
    const citationRequired = entry.section === null || !optional.has(entry.section);

    if (mentionsIntent && citationRequired && citation === '') {
      defects.push({
        category: 'Uncited intent reliance',
        entry: entry.id,
        section: entry.section,
        line: entry.line,
        message: `entry ${entry.id} relies on the intent but carries no ${CITATION_FIELD}, so the exact requirement or rationale it rests on cannot be checked`,
      });
    }

    if (citation === '') {
      continue;
    }
    citations += 1;

    if (record.status !== 'Present') {
      defects.push({
        category: 'Unresolvable intent citation',
        entry: entry.id,
        section: entry.section,
        line: entry.fields.get(CITATION_FIELD).line,
        message: `entry ${entry.id} cites the intent, but the intent status is ${record.status}, so there is no line to cite`,
      });
      continue;
    }

    const match = CITATION_FORM.exec(citation);
    if (!match) {
      defects.push({
        category: 'Unresolvable intent citation',
        entry: entry.id,
        section: entry.section,
        line: entry.fields.get(CITATION_FIELD).line,
        message: `entry ${entry.id} cites "${citation}", which is not of the form <intent locator>:L<line>[-L<line>]`,
      });
      continue;
    }

    const [, citedLocator, rawStart, rawEnd] = match;
    if (locator && citedLocator !== locator) {
      defects.push({
        category: 'Unresolvable intent citation',
        entry: entry.id,
        section: entry.section,
        line: entry.fields.get(CITATION_FIELD).line,
        message: `entry ${entry.id} cites ${citedLocator}, which is not the resolved intent ${locator}`,
      });
      continue;
    }

    const start = Number(rawStart);
    const end = rawEnd === undefined ? start : Number(rawEnd);
    if (start < 1 || end < start || end > (record.lines ?? 0)) {
      defects.push({
        category: 'Unresolvable intent citation',
        entry: entry.id,
        section: entry.section,
        line: entry.fields.get(CITATION_FIELD).line,
        message: `entry ${entry.id} cites lines ${start}-${end}, which the intent (${record.lines} line(s)) does not contain`,
      });
      continue;
    }

    const inert = [];
    for (let cursor = start; cursor <= end; cursor += 1) {
      if (flagged.has(cursor)) {
        inert.push(flagged.get(cursor));
      }
    }
    if (inert.length) {
      defects.push({
        category: 'Inert intent citation',
        entry: entry.id,
        section: entry.section,
        line: entry.fields.get(CITATION_FIELD).line,
        message: `entry ${entry.id} cites line ${inert[0].line} of the intent, which the directive screen flagged as a ${inert[0].category} on "${inert[0].trigger}"; an instruction is inert and never rationale`,
      });
    }
  }

  for (const stray of unattributed) {
    defects.push({
      category: 'Unattributed intent field',
      entry: null,
      section: null,
      line: stray.line,
      message: `line ${stray.line} carries a ${stray.label} field that no recognised finding owns, so the intent rules were never applied to it`,
    });
  }

  return {
    status: defects.length ? 'Invalid' : 'Valid',
    intentStatus: record.status,
    intentLocator: locator,
    intentLines: record.lines ?? null,
    directiveLines: record.screen.directiveLines.length,
    entriesScanned: parsed.entries.length,
    unattributedFields: unattributed.length,
    intentReferences,
    citations,
    defects,
  };
}

const VALUE_FLAGS = ['--report', '--intent'];

export const USAGE = `Usage: intent-screen.mjs --report <path> --intent <path>

  --report  Absolute path to the synthesized roast or envelope to screen.
  --intent  Absolute path to the intent record produced by intent-source.mjs.
  --probe   Report availability and exit.`;

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { probe: true };
    }
    if (!VALUE_FLAGS.includes(flag)) {
      throw new IntentScreenError('usage', `unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new IntentScreenError('usage', `${flag} requires a value`);
    }
    const name = flag.slice(2);
    if (name in values) {
      throw new IntentScreenError('usage', `${flag} was given more than once`);
    }
    values[name] = value;
    index += 1;
  }
  for (const required of ['report', 'intent']) {
    if (!(required in values)) {
      throw new IntentScreenError('usage', `missing required argument for --${required}`);
    }
  }
  return { probe: false, ...values };
}

function readFile(candidate, label) {
  if (!path.isAbsolute(candidate)) {
    throw new IntentScreenError('unsafe_path', `${label} path must be absolute`);
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new IntentScreenError('unsafe_path', `${label} path must not traverse upward`);
  }
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    throw new IntentScreenError('unsafe_path', `${label} does not exist: ${candidate}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new IntentScreenError('unsafe_path', `${label} path must be a regular file`);
  }
  return fs.readFileSync(candidate, 'utf8');
}

export function run(argv, streams = process) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    streams.stderr.write(`${error.code ?? 'usage'}: ${error.message}\n${USAGE}\n`);
    return 1;
  }
  if (parsed.probe) {
    streams.stdout.write('intent-screen: available\n');
    return 0;
  }

  let result;
  try {
    const report = readFile(parsed.report, '--report');
    let record;
    try {
      record = JSON.parse(readFile(parsed.intent, '--intent'));
    } catch (error) {
      if (error instanceof IntentScreenError) {
        throw error;
      }
      throw new IntentScreenError('invalid_record', `intent record is not valid JSON: ${error.message}`);
    }
    result = screenReport(report, record);
  } catch (error) {
    const code = error instanceof IntentScreenError ? error.code : 'invalid_report';
    streams.stderr.write(`${code}: ${error.message}\n`);
    return 1;
  }

  streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'Valid' ? 0 : 2;
}

function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  process.exitCode = run(process.argv.slice(2));
}
