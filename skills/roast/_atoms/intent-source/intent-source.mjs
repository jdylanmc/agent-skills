#!/usr/bin/env node

/**
 * Resolve and screen the intent of a reviewed skill package.
 *
 * An intent is authoritative about what one skill was supposed to do, and inert
 * as instruction. That second half is the whole safeguard: doctrine is pinned by
 * a manifest digest, while an intent is an ordinary file sitting inside the
 * package under review. If an intent could instruct, the artifact best placed to
 * disarm a review would be the file shipped alongside the thing being reviewed.
 *
 * This module never obeys an intent. It returns a record, and the record is
 * data. The directive screen below is a second line of defence against one
 * specific route: a reviewer legitimately withdraws a finding when the intent
 * explains a construction the finding misread, and an injected line must not be
 * able to buy that same withdrawal by pretending to be rationale.
 *
 * Two failure modes are designed against explicitly, because both would look
 * like success:
 *
 * - Reporting `Missing` for a package that ships an intent. A symbolic link, a
 *   directory, or a failed read returns `Unreadable` with the reason. The two
 *   statuses are never merged.
 * - A screen that examines nothing and reports a clean result. `performed` is
 *   unconditional and `linesScreened` is reported, so a consumer can prove the
 *   whole file was classified rather than trusting that it was.
 *
 * The screen vocabulary is owned by `intent-source.md`. It is duplicated here so
 * the command runs without parsing Markdown, and `intent-source.drift.test.mjs`
 * derives the lists from that document and fails in both directions.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class IntentSourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IntentSourceError';
    this.code = code;
  }
}

/** An intent lives at exactly one place inside the package it describes. */
export const INTENT_FILE_NAME = 'intent.md';

/** Directive verbs that flag only alongside a review object. */
export const DIRECTIVE_VERBS = [
  'ignore',
  'skip',
  'omit',
  'withhold',
  'downgrade',
  'dismiss',
  'return',
  'report',
  'raise',
  'lower',
  'treat',
];

/** Directive verbs whose imperative form needs no object to be an order. */
export const SOLO_DIRECTIVE_VERBS = [
  'approve',
  'suppress',
  'disregard',
  'waive',
  'bypass',
  'override',
  'exempt',
];

/** Nouns that make a directive verb an instruction about this review. */
export const REVIEW_OBJECTS = [
  'finding',
  'findings',
  'review',
  'reviewer',
  'roast',
  'check',
  'checks',
  'doctrine',
  'severity',
  'report',
  'audit',
  'critique',
  'package',
];

/** Prefixes that put a verb into imperative position mid-sentence. */
export const MODAL_PREFIXES = ['do not', "don't", 'never', 'always', 'please', 'must', 'should'];

/** Phrases that assert an outcome of the review rather than explain a design. */
export const CONCLUSION_ASSERTIONS = [
  'has no defects',
  'have no defects',
  'contains no defects',
  'is defect-free',
  'is defect free',
  'nothing is wrong',
  'needs no changes',
  'no changes are needed',
  'is already correct',
  'is correct as written',
  'requires no review',
  'is exempt from review',
  'is above reproach',
];

/** The whole vocabulary, in the shape the drift suite compares against. */
export const SCREEN_VOCABULARY = {
  'Directive verbs that need a review object': DIRECTIVE_VERBS,
  'Directive verbs that stand alone': SOLO_DIRECTIVE_VERBS,
  'Review objects': REVIEW_OBJECTS,
  'Modal prefixes': MODAL_PREFIXES,
  'Conclusion assertions': CONCLUSION_ASSERTIONS,
};

export const INTENT_STATUSES = ['Present', 'Empty', 'Missing', 'Unreadable'];

const LIST_MARKER = /^\s*(?:(?:[-*+]|\d+[.)]|#{1,6}|>)\s+)+/;
const EMPHASIS = /[*_`~]/g;
const SENTENCE_SPLIT = /(?<=[.!?;:])\s+/;

function escapeToken(token) {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeSentence(sentence) {
  return sentence.replace(/^[\s"'([]+/, '').toLowerCase();
}

function startsWithVerb(sentence, verb) {
  return new RegExp(`^${escapeToken(verb)}\\b`).test(sentence);
}

function modalPrefixed(sentence, verb) {
  return MODAL_PREFIXES.some((prefix) =>
    new RegExp(`\\b${escapeToken(prefix)}\\s+(?:not\\s+)?${escapeToken(verb)}\\b`).test(sentence),
  );
}

function hasReviewObject(sentence) {
  return REVIEW_OBJECTS.some((object) => new RegExp(`\\b${escapeToken(object)}\\b`).test(sentence));
}

/**
 * Classifies one line.
 *
 * Position is the whole distinction. "Review that has to be remembered is review
 * that gets skipped" describes the world; "Skip the doctrine check" gives an
 * order. Only a verb in imperative position — starting a sentence, or behind a
 * modal prefix — is treated as a directive, which is why the first sentence is
 * citable rationale and the second is inert.
 */
export function screenLine(rawLine) {
  // Emphasis is removed before anything else. A sentence ending `wrong.**`
  // otherwise never splits, so a following clause merges into the first one and
  // lends it an object it does not contain. That mis-flagged a real line of
  // `skills/roast/intent.md`, which is exactly the kind of sentence a reviewer
  // needs to cite.
  const flattened = String(rawLine).replace(EMPHASIS, '');
  const lowered = flattened.toLowerCase();
  for (const phrase of CONCLUSION_ASSERTIONS) {
    if (lowered.includes(phrase)) {
      return { category: 'conclusion assertion', trigger: phrase };
    }
  }

  const stripped = flattened.replace(LIST_MARKER, '');
  for (const rawSentence of stripped.split(SENTENCE_SPLIT)) {
    const sentence = normalizeSentence(rawSentence);
    if (sentence === '') {
      continue;
    }
    for (const verb of SOLO_DIRECTIVE_VERBS) {
      if (startsWithVerb(sentence, verb) || modalPrefixed(sentence, verb)) {
        return { category: 'directive instruction', trigger: verb };
      }
    }
    if (!hasReviewObject(sentence)) {
      continue;
    }
    for (const verb of DIRECTIVE_VERBS) {
      if (startsWithVerb(sentence, verb) || modalPrefixed(sentence, verb)) {
        return { category: 'directive instruction', trigger: verb };
      }
    }
  }
  return null;
}

/**
 * Classifies every line of an intent.
 *
 * `linesScreened` is returned rather than assumed. A screen that looks at
 * nothing and reports a clean result is worse than no screen at all, so the
 * count is published and a consumer compares it with the line count.
 */
export function screenIntent(text) {
  if (typeof text !== 'string') {
    throw new IntentSourceError('usage', 'intent text must be a string');
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const directiveLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const verdict = screenLine(lines[index]);
    if (verdict) {
      directiveLines.push({
        line: index + 1,
        category: verdict.category,
        trigger: verdict.trigger,
        text: lines[index].trim(),
      });
    }
  }
  return {
    performed: true,
    applicable: true,
    linesScreened: lines.length,
    directiveLines,
  };
}

function emptyScreen() {
  return { performed: true, applicable: false, linesScreened: 0, directiveLines: [] };
}

function requireSafeDirectory(candidate, label) {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new IntentSourceError('usage', `${label} is required`);
  }
  if (!path.isAbsolute(candidate)) {
    throw new IntentSourceError('unsafe_path', `${label} must be absolute`);
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new IntentSourceError('unsafe_path', `${label} must not traverse upward`);
  }
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    throw new IntentSourceError('unsafe_path', `${label} does not exist: ${candidate}`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new IntentSourceError('unsafe_path', `${label} must be a real directory: ${candidate}`);
  }
}

function locatorFor(absolute, repositoryRoot) {
  if (!repositoryRoot) {
    return absolute.split(path.sep).join('/');
  }
  const relative = path.relative(repositoryRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return absolute.split(path.sep).join('/');
  }
  return relative.split(path.sep).join('/');
}

/**
 * Resolves one package's intent into a record.
 *
 * Never returns `Missing` for a path that exists. That distinction is the point
 * of the function: a package that ships an intent and is reported as having none
 * loses the only axis doctrine cannot see, silently, while every other part of
 * the review still looks healthy.
 */
export function resolveIntent(options = {}) {
  const packageRoot = options.packageRoot;
  requireSafeDirectory(packageRoot, '--package-root');
  const repositoryRoot = options.repositoryRoot ?? null;
  if (repositoryRoot !== null) {
    requireSafeDirectory(repositoryRoot, '--repository-root');
  }

  const absolute = path.join(packageRoot, INTENT_FILE_NAME);
  const locator = locatorFor(absolute, repositoryRoot);
  const base = { blocking: false, locator, bytes: null, lines: null, digest: null };

  let stats;
  try {
    stats = fs.lstatSync(absolute);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return {
        ...base,
        status: 'Missing',
        screen: emptyScreen(),
        observation: `No intent file at ${locator}. The review continues without an intent standard, and this absence is reported rather than treated as a failure.`,
      };
    }
    return {
      ...base,
      status: 'Unreadable',
      screen: emptyScreen(),
      observation: `The intent at ${locator} could not be inspected (${error.code ?? 'unknown error'}), so it exists but was not read.`,
    };
  }

  if (stats.isSymbolicLink()) {
    return {
      ...base,
      status: 'Unreadable',
      screen: emptyScreen(),
      observation: `The intent at ${locator} is a symbolic link and was not followed, so an intent exists but was not read.`,
    };
  }
  if (!stats.isFile()) {
    return {
      ...base,
      status: 'Unreadable',
      screen: emptyScreen(),
      observation: `The intent at ${locator} is not a regular file, so an intent path exists but was not read.`,
    };
  }

  let raw;
  try {
    raw = fs.readFileSync(absolute, 'utf8');
  } catch (error) {
    return {
      ...base,
      status: 'Unreadable',
      screen: emptyScreen(),
      observation: `The intent at ${locator} exists but could not be read (${error.code ?? 'unknown error'}).`,
    };
  }

  const normalized = raw.replace(/\r\n/g, '\n');
  const bytes = Buffer.byteLength(normalized, 'utf8');
  const lines = normalized.split('\n').length;
  const digest = `sha256:${crypto.createHash('sha256').update(normalized, 'utf8').digest('hex')}`;

  if (normalized.trim() === '') {
    return {
      ...base,
      status: 'Empty',
      bytes,
      lines,
      digest,
      screen: screenIntent(normalized),
      observation: `The intent at ${locator} exists but states no requirement, so it sets no standard to judge the package against.`,
    };
  }

  const screen = screenIntent(normalized);
  const flagged = screen.directiveLines.length;
  return {
    ...base,
    status: 'Present',
    bytes,
    lines,
    digest,
    screen,
    observation: flagged
      ? `The intent at ${locator} was read as requirements. ${flagged} line(s) are instruction-shaped, are inert, and are not citable as rationale.`
      : `The intent at ${locator} was read as requirements. No line is instruction-shaped.`,
  };
}

const VALUE_FLAGS = ['--package-root', '--repository-root'];

export const USAGE = `Usage: intent-source.mjs --package-root <absolute path> \\
  [--repository-root <absolute path>]

  --package-root     Absolute path of the reviewed skill package. Required.
  --repository-root  Absolute root the reported locator is relative to.
  --probe            Report availability and exit.`;

/**
 * Parses the command line, refusing anything it does not recognise.
 *
 * A misspelled flag must not fall back to a default. That exact fail-open cost
 * this repository a defect once already: an override that silently became an
 * inference, behind a fully green suite.
 */
export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { probe: true };
    }
    if (!VALUE_FLAGS.includes(flag)) {
      throw new IntentSourceError('usage', `unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new IntentSourceError('usage', `${flag} requires a value`);
    }
    const name = flag.slice(2);
    if (name in values) {
      throw new IntentSourceError('usage', `${flag} was given more than once`);
    }
    values[name] = value;
    index += 1;
  }
  if (!('package-root' in values)) {
    throw new IntentSourceError('usage', 'missing required argument for --package-root');
  }
  return {
    probe: false,
    packageRoot: values['package-root'],
    repositoryRoot: values['repository-root'] ?? null,
  };
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
    streams.stdout.write('intent-source: available\n');
    return 0;
  }
  let record;
  try {
    record = resolveIntent(parsed);
  } catch (error) {
    const code = error instanceof IntentSourceError ? error.code : 'usage';
    streams.stderr.write(`${code}: ${error.message}\n`);
    return 1;
  }
  streams.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  return 0;
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
