#!/usr/bin/env node

/**
 * The named synthesis profiles.
 *
 * A profile is the contract a bounded synthesis run obeys: what the smaller
 * variant must contain, where it is written, how large it may be, and what may
 * never be dropped from it. There is no default profile. An unknown or absent
 * profile id refuses, because defaulting is exactly how a specification gets
 * condensed under a contract nobody chose.
 *
 * The word count is deterministic and counts the whole document. A limit that
 * ignored headings, list markers, link text, or fenced content could always be
 * satisfied by moving text into the part it ignored, so nothing is excluded.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class SynthesisProfileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SynthesisProfileError';
    this.code = code;
  }
}

/**
 * The profile table. One row for now. Adding a variant is a row here, never a
 * fork of the synthesis machinery.
 */
export const PROFILES = Object.freeze({
  'spec-nano': Object.freeze({
    id: 'spec-nano',
    sourceKind: 'spec-full',
    variantKind: 'spec-nano',
    outputPattern: 'docs/agent/specs/<slug>.nano.md',
    workspaceRoot: 'docs/agent/',
    wordBudget: 500,
    requiredContent: Object.freeze([
      'spec-identity',
      'source-identity',
      'source-revision',
      'full-link',
      'intention',
      'acceptance-criteria',
      'non-goals',
    ]),
    nonOmittableKinds: Object.freeze([
      'intention',
      'criterion',
      'non-goal',
      'constraint',
      'contradiction',
    ]),
    structuralHeadings: Object.freeze([
      'Intention',
      'Acceptance Criteria',
      'Non-goals',
    ]),
    splitStatus: 'needs-split',
  }),
});

export function resolveProfile(id) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new SynthesisProfileError('unknown-profile', 'a profile id is required and is never defaulted');
  }
  const profile = PROFILES[id];
  if (!profile) {
    throw new SynthesisProfileError('unknown-profile', `no synthesis profile is named ${id}`);
  }
  return profile;
}

/**
 * Count every token that carries a Unicode letter or digit, over the whole
 * document. CRLF is normalized to LF; the text is split on runs of whitespace;
 * a token counts when it contains at least one letter or digit. Headings, list
 * markers, link text, and fenced content are all part of the complete document
 * and are all counted.
 */
export function countWords(text) {
  if (typeof text !== 'string') {
    throw new SynthesisProfileError('invalid-input', 'text must be a string');
  }
  const normalized = text.replace(/\r\n/g, '\n');
  const tokens = normalized.split(/\s+/).filter((token) => token !== '');
  let words = 0;
  for (const token of tokens) {
    if (/[\p{L}\p{N}]/u.test(token)) {
      words += 1;
    }
  }
  return words;
}

/**
 * Evaluate a candidate variant against a profile's word budget. The limit is a
 * maximum: exactly the budget is allowed. `within` is strictly under, `at-limit`
 * is exactly equal, `over` is strictly above.
 */
export function deriveBudgetStatus(words, budget) {
  if (!Number.isInteger(words) || !Number.isInteger(budget)) {
    throw new SynthesisProfileError('invalid-input', 'words and budget must be integers');
  }
  if (words < budget) {
    return 'within';
  }
  if (words === budget) {
    return 'at-limit';
  }
  return 'over';
}

export function evaluateBudget(profileId, text) {
  const profile = resolveProfile(profileId);
  const words = countWords(text);
  const budget = profile.wordBudget;
  return { profileId: profile.id, words, budget, status: deriveBudgetStatus(words, budget) };
}

export const USAGE = 'Usage: synthesis-profile.mjs --profile <id> [--text-file <absolute-path>]';

export function run(argv, streams = process) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--profile', '--text-file'].includes(flag) || value === undefined) {
      throw new SynthesisProfileError('usage', USAGE);
    }
    args[flag.slice(2)] = value;
  }
  if (!args.profile) {
    throw new SynthesisProfileError('usage', USAGE);
  }
  if (args['text-file']) {
    if (!path.isAbsolute(args['text-file'])) {
      throw new SynthesisProfileError('usage', USAGE);
    }
    const text = fs.readFileSync(args['text-file'], 'utf8');
    streams.stdout.write(`${JSON.stringify(evaluateBudget(args.profile, text), null, 2)}\n`);
    return 0;
  }
  streams.stdout.write(`${JSON.stringify(resolveProfile(args.profile), null, 2)}\n`);
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
      error: { code: error.code ?? 'unknown-profile', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
