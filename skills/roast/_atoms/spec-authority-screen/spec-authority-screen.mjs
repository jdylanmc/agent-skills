#!/usr/bin/env node

/**
 * The nano authority, checked.
 *
 * `spec-pair` establishes what is true about a specification pair. This module
 * checks that the roast written about that pair respects the one rule the pair
 * rests on: `<spec>.nano.md` is authority and `<spec>.full.md` is context.
 *
 * The rule is stated in the resolved contract, and a rule that only appears in
 * prose is a rule a tired reviewer inverts at four in the afternoon. Item 12,
 * 13, and 14 of the spec envelope checklist point at this checker for the same
 * reason items 10 and 11 point at theirs: a report that quietly recommends
 * changing an approved specification so that its unapproved companion is right
 * would be acted on before anybody noticed which way round it was.
 *
 * This module screens. It raises no finding, assigns no severity, approves
 * nothing, and returns no verdict about the specification. A defect here is an
 * ordinary schema failure and takes the ordinary retry-once-then-report route.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFindings } from '../roast-contract/roast-contract.mjs';

export class SpecAuthorityScreenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpecAuthorityScreenError';
    this.code = code;
  }
}

/**
 * The vocabulary below is owned by `spec-authority-screen.md`. The document
 * states each list for a reader; these constants hold the same tokens so the
 * screen runs without parsing Markdown, and the regression suite derives the
 * document's lists and fails when the two disagree in either direction.
 */

/** The field an entry carries when it rests on a disagreement between layers. */
export const AUTHORITY_FIELD = 'Authority';

/** The two document shapes this screen runs against. */
export const PHASES = ['envelope', 'roast'];

/** Words that name the authoritative layer. */
export const NANO_TERMS = ['nano', 'nano specification', 'nano artifact'];

/** Words that name the context layer. */
export const FULL_TERMS = ['full specification', 'full spec', 'full artifact'];

/** Words that assert one text should be brought into agreement with another. */
export const ALIGNMENT_TERMS = [
  'agree with',
  'agrees with',
  'match',
  'matches',
  'align',
  'aligns',
  'consistent with',
  'in line with',
  'reconcile',
  'reflect',
];

/** Words that say two layers disagree. */
export const CONFLICT_TERMS = [
  'conflict',
  'conflicts',
  'contradict',
  'contradicts',
  'disagree',
  'disagrees',
  'overrides',
  'supersedes',
  'widens',
];

/** Words that reverse the direction of the clause they open. */
export const NEGATION_TERMS = ['do not', "don't", 'never', 'avoid', 'rather than', 'instead of'];

export const DEFECT_CATEGORIES = [
  'Missing pair evidence',
  'Inverted authority',
  'Unattributed authority',
  'Undeclared criterion citation',
];

const MANIFEST_HEADING = /^##\s+Evidence Manifest\s*$/;
const ANY_HEADING = /^#{1,6}\s+/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const CRITERION_TOKEN = /\bAC-?\d+\b/gi;
/** A locator counts only as a whole path token, never as part of a longer one. */
const PATH_CHARACTER = /[A-Za-z0-9._\-/\\]/;

function normalizeCriterionId(raw) {
  return raw.toUpperCase().replace(/^AC-?/, 'AC-');
}

function positionOf(haystack, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').exec(haystack);
  return match ? match.index : -1;
}

function firstPosition(haystack, phrases) {
  const found = phrases.map((phrase) => positionOf(haystack, phrase)).filter((index) => index !== -1);
  return found.length ? Math.min(...found) : -1;
}

function mentions(haystack, phrases) {
  return firstPosition(haystack, phrases) !== -1;
}

/**
 * Whether a clause *opens* with one of the phrases, after leading whitespace.
 * Direction is reversed by a negation that heads the clause it governs; one
 * that trails ("update the nano spec to match the full spec, rather than
 * leaving the drift") reverses nothing and must not suppress the inversion.
 */
function opensWith(clause, phrases) {
  const trimmed = clause.trimStart();
  return phrases.some((phrase) => {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    return new RegExp(`^${escaped}(?![A-Za-z0-9])`, 'i').test(trimmed);
  });
}

/**
 * Whether a line names one exact locator as a whole path token. Substring
 * containment would let `checkout.nano.md.bak` satisfy the entry for
 * `checkout.nano.md`, which is the kind of pass that reads as a check.
 */
export function namesLocator(line, locator) {
  let from = 0;
  for (;;) {
    const index = line.indexOf(locator, from);
    if (index === -1) {
      return false;
    }
    const before = index === 0 ? '' : line[index - 1];
    const after = line[index + locator.length] ?? '';
    if (!PATH_CHARACTER.test(before) && !PATH_CHARACTER.test(after)) {
      return true;
    }
    from = index + 1;
  }
}

/** Splits a recommendation into the clauses direction is judged within. */
function clausesOf(text) {
  return text
    .split(/[.;\n]/)
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '');
}

/** Every line of `## Evidence Manifest`, with fenced content excluded. */
export function manifestLines(report) {
  const lines = report.replace(/\r\n/g, '\n').split('\n');
  const collected = [];
  let fence = null;
  let inside = false;
  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
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
    if (MANIFEST_HEADING.test(line)) {
      inside = true;
      continue;
    }
    if (inside && ANY_HEADING.test(line)) {
      break;
    }
    if (inside && line.trim() !== '') {
      collected.push(line);
    }
  }
  return collected;
}

function entryText(entry) {
  return [...entry.fields.values()].map((field) => field.value).join('\n');
}

function requireStagedPair(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new SpecAuthorityScreenError('usage', 'a spec pair record is required');
  }
  if (record.schemaVersion !== 1) {
    throw new SpecAuthorityScreenError(
      'unstaged_pair',
      `unknown spec pair record schema: ${record.schemaVersion}`,
    );
  }
  if (!['Paired', 'Incomplete pair', 'Unreadable'].includes(record.status)) {
    throw new SpecAuthorityScreenError('unstaged_pair', `unknown pair status: ${record.status}`);
  }
  if (record.authority?.layer !== 'nano') {
    throw new SpecAuthorityScreenError(
      'unstaged_pair',
      'the record does not name the nano layer as the authority, so there is no authority to check against',
    );
  }
  for (const layer of ['nano', 'full']) {
    const member = record.files?.[layer];
    if (!member || typeof member.locator !== 'string' || member.locator.trim() === '') {
      throw new SpecAuthorityScreenError(
        'unstaged_pair',
        `the record carries no ${layer} locator, so a manifest entry could name any file and resolve`,
      );
    }
  }
  if (!Array.isArray(record.criteria)) {
    throw new SpecAuthorityScreenError(
      'unstaged_pair',
      'the record declares no criteria list, so a citation could name any identifier and resolve',
    );
  }
  return record;
}

/**
 * Screens one synthesized roast against a staged pair.
 *
 * Returns `Valid` with an empty defect list, or `Invalid` naming each entry and
 * the rule it broke. A report that cites no criterion and rests on no
 * disagreement is valid: the rules are per entry, not a demand that entries
 * discuss the authority.
 */
export function screenSpecReport(report, record, options = {}) {
  if (typeof report !== 'string') {
    throw new SpecAuthorityScreenError('invalid_report', 'report must be a string');
  }
  const phase = options.phase ?? null;
  if (!PHASES.includes(phase)) {
    throw new SpecAuthorityScreenError(
      'usage',
      `phase must be one of ${PHASES.join(', ')}; the envelope carries a manifest and the final roast does not`,
    );
  }
  requireStagedPair(record);

  const nano = record.files.nano;
  const full = record.files.full;
  const nanoTerms = [...NANO_TERMS, nano.locator];
  const fullTerms = [...FULL_TERMS, full.locator];
  const declared = new Set(record.criteria.map((entry) => normalizeCriterionId(entry.id)));
  const parsed = parseFindings(report, options.sections);
  const manifest = manifestLines(report);
  const defects = [];

  if (phase === 'envelope') {
    const claimed = new Set();
    for (const member of [nano, full]) {
      const index = manifest.findIndex(
        (candidate, position) => !claimed.has(position) && namesLocator(candidate, member.locator),
      );
      if (index === -1) {
        defects.push({
          category: 'Missing pair evidence',
          entry: null,
          message: `the evidence manifest has no entry naming ${member.locator}; both siblings are staged, and an absent one is staged with its status rather than omitted`,
        });
        continue;
      }
      claimed.add(index);
      if (member.status !== 'Present' && positionOf(manifest[index], member.status) === -1) {
        defects.push({
          category: 'Missing pair evidence',
          entry: null,
          message: `the manifest names ${member.locator} without its ${member.status} status, so a reader cannot tell the sibling was never read`,
        });
      }
    }
  }

  let criterionCitations = 0;
  let authorityEntries = 0;

  for (const entry of parsed.entries) {
    const text = entryText(entry);

    for (const match of text.matchAll(CRITERION_TOKEN)) {
      const id = normalizeCriterionId(match[0]);
      criterionCitations += 1;
      if (!declared.has(id)) {
        defects.push({
          category: 'Undeclared criterion citation',
          entry: entry.id,
          section: entry.section,
          line: entry.line,
          message: `entry ${entry.id} cites ${id}, which the staged nano specification does not declare`,
        });
      }
    }

    const recommendation = entry.fields.get('Recommendation')?.value ?? '';
    const declaredAuthority = entry.fields.get(AUTHORITY_FIELD)?.value?.trim() ?? '';
    if (
      declaredAuthority !== '' &&
      (!namesLocator(declaredAuthority, nano.locator) ||
        namesLocator(declaredAuthority, full.locator))
    ) {
      defects.push({
        category: 'Inverted authority',
        entry: entry.id,
        section: entry.section,
        line: entry.fields.get(AUTHORITY_FIELD).line,
        message: `entry ${entry.id} names "${declaredAuthority}" as the authority; the authority of this pair is ${nano.locator} alone and nothing in either file moves it`,
      });
    }

    for (const clause of clausesOf(recommendation)) {
      if (opensWith(clause, NEGATION_TERMS)) {
        continue;
      }
      const nanoAt = firstPosition(clause, nanoTerms);
      if (nanoAt === -1) {
        continue;
      }
      const alignAt = firstPosition(clause.slice(nanoAt), ALIGNMENT_TERMS);
      if (alignAt === -1) {
        continue;
      }
      if (firstPosition(clause.slice(nanoAt + alignAt), fullTerms) === -1) {
        continue;
      }
      defects.push({
        category: 'Inverted authority',
        entry: entry.id,
        section: entry.section,
        line: entry.fields.get('Recommendation').line,
        message: `entry ${entry.id} recommends bringing the nano specification into agreement with the full specification; the nano artifact is the authority, so the full artifact is what changes`,
      });
      break;
    }

    if (mentions(text, CONFLICT_TERMS) && mentions(text, fullTerms)) {
      authorityEntries += 1;
      if (declaredAuthority === '') {
        defects.push({
          category: 'Unattributed authority',
          entry: entry.id,
          section: entry.section,
          line: entry.line,
          message: `entry ${entry.id} rests on a disagreement between the layers but carries no ${AUTHORITY_FIELD} field, so the layer it treats as authoritative cannot be checked`,
        });
      }
    }
  }

  return {
    status: defects.length === 0 ? 'Valid' : 'Invalid',
    phase,
    pairStatus: record.status,
    authorityLocator: nano.locator,
    manifestLines: manifest.length,
    entriesScanned: parsed.entries.length,
    criteriaDeclared: declared.size,
    criterionCitations,
    authorityEntries,
    defects,
  };
}

const VALUE_FLAGS = ['--report', '--pair', '--phase'];

export const USAGE = `Usage: spec-authority-screen.mjs --report <path> --pair <path> --phase <envelope|roast>

  --report  Absolute path to the synthesized roast or envelope to screen.
  --pair    Absolute path to the spec pair record produced by spec-pair.mjs.
  --phase   Which document is being screened. Only the envelope carries an
            evidence manifest, so only that phase checks one.
  --probe   Report availability and exit.`;

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { probe: true };
    }
    if (!VALUE_FLAGS.includes(flag)) {
      throw new SpecAuthorityScreenError('usage', `unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new SpecAuthorityScreenError('usage', `${flag} requires a value`);
    }
    const name = flag.slice(2);
    if (name in values) {
      throw new SpecAuthorityScreenError('usage', `${flag} was given more than once`);
    }
    values[name] = value;
    index += 1;
  }
  for (const required of ['report', 'pair', 'phase']) {
    if (!(required in values)) {
      throw new SpecAuthorityScreenError('usage', `missing required argument for --${required}`);
    }
  }
  if (!PHASES.includes(values.phase)) {
    throw new SpecAuthorityScreenError(
      'usage',
      `--phase must be one of ${PHASES.join(', ')}, not ${values.phase}`,
    );
  }
  return { probe: false, ...values };
}

function readFile(candidate, label) {
  if (!path.isAbsolute(candidate)) {
    throw new SpecAuthorityScreenError('unsafe_path', `${label} path must be absolute`);
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new SpecAuthorityScreenError('unsafe_path', `${label} path must not traverse upward`);
  }
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    throw new SpecAuthorityScreenError('unsafe_path', `${label} does not exist: ${candidate}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new SpecAuthorityScreenError('unsafe_path', `${label} path must be a regular file`);
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
    streams.stdout.write('spec-authority-screen: available\n');
    return 0;
  }

  let result;
  try {
    const report = readFile(parsed.report, '--report');
    let record;
    try {
      record = JSON.parse(readFile(parsed.pair, '--pair'));
    } catch (error) {
      if (error instanceof SpecAuthorityScreenError) {
        throw error;
      }
      throw new SpecAuthorityScreenError(
        'invalid_record',
        `spec pair record is not valid JSON: ${error.message}`,
      );
    }
    result = screenSpecReport(report, record, { phase: parsed.phase });
  } catch (error) {
    const code = error instanceof SpecAuthorityScreenError ? error.code : 'invalid_report';
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
