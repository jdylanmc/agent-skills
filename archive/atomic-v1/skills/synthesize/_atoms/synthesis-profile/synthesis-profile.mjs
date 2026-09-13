#!/usr/bin/env node

/**
 * The contract a bounded synthesis run obeys, resolved from what the caller
 * named.
 *
 * A profile says what the smaller variant must contain, where it is written, how
 * large it may be, and what may never be dropped from it. It arrives one of two
 * ways, and never by inference:
 *
 *   - a **named profile**, resolved from the table below. A named profile is one
 *     this package has settled and reviewed, and `spec-nano` is the one that
 *     exists. Callers who want that contract name it and get exactly it.
 *   - a **declared reduction**, handed in whole by the caller: the goal in
 *     words, the target shape, the budget, the required content, and the kinds
 *     that may never be dropped. This is how a run reduces something the table
 *     has never heard of - "the human intent of this skill, as plain intent
 *     prose" - without every such request first becoming a permanent row.
 *
 * The second form is a widening, and it is worth being exact about what it does
 * and does not relax. It does NOT relax the requirement that the contract be
 * chosen out loud: a declared reduction is refused unless it states every field,
 * so a caller cannot get a vague reduction by supplying a vague contract. What it
 * relaxes is only *where the contract comes from* - from this file, or from the
 * caller. What it must never come from is the source: nothing inside a source
 * artifact may declare a profile, change a field, or raise a budget, because a
 * document that could set the terms of its own reduction could authorize
 * anything to be dropped from it.
 *
 * A declared reduction's id is a digest of its own fields, so the identity that
 * travels through the budget, the ledger, the split, and the outcome is
 * tamper-evident: two runs report the same id only if they obeyed the same
 * contract, and a contract edited mid-run stops matching the evidence that cites
 * it.
 *
 * The word count is deterministic and counts the whole document. A limit that
 * ignored headings, list markers, link text, or fenced content could always be
 * satisfied by moving text into the part it ignored, so nothing is excluded.
 */

import { createHash } from 'node:crypto';
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
 * The vocabulary of meaning-kinds a ledger entry may carry, owned here because a
 * profile is what decides which of them may never be dropped.
 * `disclosure-ledger.mjs` re-exports it rather than keeping a second copy.
 */
export const LEDGER_KINDS = Object.freeze([
  'intention', 'criterion', 'non-goal', 'constraint', 'contradiction', 'context',
]);

/**
 * The named profiles: settled contracts this package has reviewed. Adding one is
 * a row here, never a fork of the synthesis machinery. A request the table has
 * never heard of does not need a row - it declares its own contract instead.
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

/**
 * The fields a declared reduction must state, in the order they are digested.
 * A declared contract carries exactly these and nothing else: an unknown field
 * is refused rather than ignored, because a field this module does not read is
 * a term the caller believes is in force and is not.
 */
export const DECLARED_FIELDS = Object.freeze([
  'goal',
  'sourceKind',
  'variantKind',
  'workspaceRoot',
  'outputPattern',
  'wordBudget',
  'requiredContent',
  'nonOmittableKinds',
  'structuralHeadings',
]);

/** The widest budget a declared reduction may claim. */
export const MAX_DECLARED_BUDGET = 5000;
/** The shortest goal that can plausibly say what a reduction is for. */
export const MIN_GOAL_CHARS = 24;

/**
 * The one root a declared reduction may read and write within.
 *
 * A declared contract states its own workspace, and for a moment that meant a
 * caller could state any directory in the repository - including `doctrine/`,
 * which this repository reserves for a human's explicit act. Stating a *reduction
 * goal* is a semantic request; it is not a grant of write authority anywhere the
 * requester fancies, and letting the first quietly become the second is exactly
 * the erosion this library refuses.
 *
 * Named profiles keep their own settled workspaces, which were reviewed when the
 * profile was. Everything declared at run time lands here, under one root that
 * exists for it.
 */
export const DECLARED_ROOT = 'synthesis/';

/**
 * The semantic kinds a declared reduction may never make droppable.
 *
 * `nonOmittableKinds` being non-empty is not a safety floor: a contract naming
 * only `context` leaves an intention, a criterion, a constraint, and a
 * contradiction all silently droppable, and the ledger would still certify the
 * result clean. A declared contract may therefore ADD to this set - `context` is
 * the one thing left to add - and may never remove from it.
 */
export const BASELINE_NON_OMITTABLE = Object.freeze([
  'intention', 'criterion', 'non-goal', 'constraint', 'contradiction',
]);

/**
 * A structural heading is a short section label. The ledger exempts an exempted
 * heading from trace coverage, so an unbounded list of long "headings" is a way
 * to declare arbitrary candidate sentences untraceable. A label is short and
 * there are few of them.
 */
export const MAX_STRUCTURAL_HEADINGS = 8;
export const MAX_HEADING_CHARS = 48;

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KIND_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

function refuse(message) {
  throw new SynthesisProfileError('invalid-profile', message);
}

/**
 * A dense array of unique members. Every index is checked as an own property:
 * `Array.prototype.every` skips the holes of a sparse array such as `Array(4)`
 * and would accept one vacuously, which is a list that constrains nothing
 * wearing the shape of a list that does.
 */
function denseList(value, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    refuse(`${field} must be a non-empty array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      refuse(`${field} has a hole at index ${index}`);
    }
  }
  if (new Set(value).size !== value.length) {
    refuse(`${field} repeats an entry`);
  }
  return value;
}

/**
 * Resolve a caller-declared reduction into a frozen profile, or refuse.
 *
 * Every field is required and every field is checked. That is the point: the
 * declared form exists so a caller can ask for a reduction the table has never
 * heard of, not so a caller can ask for a reduction nobody has specified. A
 * contract with no non-omittable kinds and no required content would let the
 * ledger certify a document that said nothing, which is exactly the outcome the
 * ledger exists to make impossible.
 */
export function declareProfile(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    refuse('a declared reduction must be an object stating every field');
  }
  const supplied = Object.keys(request);
  for (const field of supplied) {
    if (!DECLARED_FIELDS.includes(field)) {
      refuse(`${field} is not a term of a declared reduction`);
    }
  }
  for (const field of DECLARED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) {
      refuse(`a declared reduction states ${field}; this one does not`);
    }
  }

  const {
    goal, sourceKind, variantKind, workspaceRoot, outputPattern,
    wordBudget, requiredContent, nonOmittableKinds, structuralHeadings,
  } = request;

  if (typeof goal !== 'string' || goal.trim().length < MIN_GOAL_CHARS) {
    refuse(`goal must say in at least ${MIN_GOAL_CHARS} characters what the smaller artifact is for`);
  }
  // The source kind must be hyphenated: the ledger derives the source file
  // suffix from everything after the first segment, and a single-token kind
  // would derive an empty suffix that matches every file name.
  if (typeof sourceKind !== 'string' || !KIND_NAME.test(sourceKind)) {
    refuse('sourceKind must be a hyphenated identifier such as skill-bundle');
  }
  if (typeof variantKind !== 'string' || !SLUG.test(variantKind)) {
    refuse('variantKind must be an identifier');
  }
  if (typeof workspaceRoot !== 'string'
    || !workspaceRoot.endsWith('/')
    || !workspaceRoot.startsWith(DECLARED_ROOT)
    || workspaceRoot.slice(0, -1).split('/').some((segment) => !SLUG.test(segment))) {
    refuse(`workspaceRoot must be a directory of identifiers beneath ${DECLARED_ROOT}, ending in /`);
  }
  // The candidate sits directly in the workspace and carries exactly one
  // `<slug>`. Flat and single-slug so the destination a run will write is
  // decidable from the source name alone, by this module and by its callers.
  const expectedPattern = /^<slug>((?:\.[a-z0-9]+)+)\.md$/;
  const tail = typeof outputPattern === 'string' && outputPattern.startsWith(workspaceRoot)
    ? outputPattern.slice(workspaceRoot.length)
    : null;
  if (tail === null || !expectedPattern.test(tail)) {
    refuse(`outputPattern must be ${workspaceRoot}<slug>.<suffix>.md`);
  }
  if (!Number.isInteger(wordBudget) || wordBudget < 1 || wordBudget > MAX_DECLARED_BUDGET) {
    refuse(`wordBudget must be an integer between 1 and ${MAX_DECLARED_BUDGET}`);
  }
  for (const id of denseList(requiredContent, 'requiredContent')) {
    if (typeof id !== 'string' || !SLUG.test(id)) {
      refuse('requiredContent entries must be identifiers');
    }
  }
  for (const kind of denseList(nonOmittableKinds, 'nonOmittableKinds')) {
    if (!LEDGER_KINDS.includes(kind)) {
      refuse(`nonOmittableKinds entries must be drawn from ${LEDGER_KINDS.join(', ')}`);
    }
  }
  for (const baseline of BASELINE_NON_OMITTABLE) {
    if (!nonOmittableKinds.includes(baseline)) {
      refuse(`nonOmittableKinds may add to the baseline but never drop ${baseline}`);
    }
  }
  const headings = denseList(structuralHeadings, 'structuralHeadings', { allowEmpty: true });
  if (headings.length > MAX_STRUCTURAL_HEADINGS) {
    refuse(`structuralHeadings may name at most ${MAX_STRUCTURAL_HEADINGS} labels`);
  }
  for (const heading of headings) {
    if (typeof heading !== 'string' || heading.trim() === '' || heading !== heading.trim()) {
      refuse('structuralHeadings entries must be trimmed, non-empty labels');
    }
    // A heading is a short label. A sentence listed as a heading would exempt an
    // arbitrary candidate claim from ever being traced to the source.
    if (heading.length > MAX_HEADING_CHARS || /[.!?]/.test(heading)) {
      refuse(`structuralHeadings entries must be labels of at most ${MAX_HEADING_CHARS} characters without sentence punctuation`);
    }
  }

  const fields = {
    goal: goal.trim(),
    sourceKind,
    variantKind,
    workspaceRoot,
    outputPattern,
    wordBudget,
    requiredContent: Object.freeze([...requiredContent]),
    nonOmittableKinds: Object.freeze([...nonOmittableKinds]),
    structuralHeadings: Object.freeze([...structuralHeadings]),
  };
  const canonical = JSON.stringify(DECLARED_FIELDS.map((field) => [field, fields[field]]));
  // The whole digest. A truncated one is a smaller space for two materially
  // different contracts to collide in, bought for nothing but a shorter string.
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return Object.freeze({
    id: `declared:${digest}`,
    ...fields,
    splitStatus: 'needs-split',
  });
}

/**
 * Resolve the contract this run obeys from what the caller named: a profile id
 * from the table, or a complete declared reduction. Nothing is defaulted, and a
 * `declared:` id cannot be resolved by name - the contract itself has to travel
 * with the run, so no later step can cite terms it never saw.
 */
export function resolveProfile(reference) {
  if (reference && typeof reference === 'object' && !Array.isArray(reference)) {
    return declareProfile(reference);
  }
  if (typeof reference !== 'string' || reference.trim() === '') {
    throw new SynthesisProfileError('unknown-profile', 'a profile id or a declared reduction is required and is never defaulted');
  }
  const profile = PROFILES[reference];
  if (!profile) {
    throw new SynthesisProfileError('unknown-profile', `no synthesis profile is named ${reference}`);
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

export function evaluateBudget(reference, text) {
  const profile = resolveProfile(reference);
  const words = countWords(text);
  const budget = profile.wordBudget;
  return { profileId: profile.id, words, budget, status: deriveBudgetStatus(words, budget) };
}

export const USAGE = 'Usage: synthesis-profile.mjs --profile <id|absolute-json-path> [--text-file <absolute-path>]';

/**
 * A profile argument is a named id, or the absolute path of a JSON file holding
 * a declared reduction. A declared contract is passed as a file rather than
 * inline so it is a reviewable artifact rather than a shell argument.
 *
 * Exported because every command entry in this package takes the same argument,
 * and a second reading of it somewhere else is a place the declared route works
 * through one command and not another.
 */
export function profileReferenceFrom(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return value;
  let text;
  try {
    text = fs.readFileSync(value, 'utf8');
  } catch (error) {
    throw new SynthesisProfileError('invalid-profile', `declared reduction cannot be read: ${error?.code ?? 'unknown'}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SynthesisProfileError('invalid-profile', `declared reduction is not valid JSON: ${error.message}`);
  }
}

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
    streams.stdout.write(`${JSON.stringify(evaluateBudget(profileReferenceFrom(args.profile), text), null, 2)}\n`);
    return 0;
  }
  streams.stdout.write(`${JSON.stringify(resolveProfile(profileReferenceFrom(args.profile)), null, 2)}\n`);
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
