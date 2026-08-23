#!/usr/bin/env node

/**
 * Asks the operator what the skill is for, and holds the discipline that keeps
 * the asking useful.
 *
 * Two opposite failures are both easy here, and both are quiet.
 *
 * 1. **Demanding a form.** A twelve-question intake gets terse, defensive
 *    answers that describe the form rather than the intent, and the one thing
 *    worth capturing — the reasoning behind a decision nobody would guess — is
 *    exactly what a form never asks for. So the opening ask is a single open
 *    invitation, authored once, here, and the operator may answer it in any
 *    shape at all.
 * 2. **Never asking.** The opposite failure is accepting whatever arrives and
 *    proceeding, so an intent silently missing the reason a refusal exists
 *    reads as complete. That is the fail-open shape this repository has already
 *    shipped: a check skipped rather than failed when the data is absent.
 *
 * The resolution is that the *opening* is unstructured and the *closing* is
 * not. A coverage record names every topic a regeneration needs, and this
 * module refuses it unless each topic is either evidenced by something the
 * operator actually said or carries exactly one follow-up question. A topic
 * cannot be absent, a claim of coverage cannot be unevidenced, and a question
 * cannot be asked about something already answered.
 *
 * Evidence is checked against the transcript by substring rather than taken on
 * assertion, because "I judged this covered" is not a check.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class ElicitationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ElicitationError';
    this.code = code;
  }
}

/**
 * The exact words shown to the operator. One open ask, no form, and every
 * suggestion explicitly skippable.
 *
 * The list of things worth mentioning is present because a regeneration needs
 * them, but it is framed as a prompt for memory rather than as fields to fill
 * in. The last paragraph states the storage gate up front: naming the
 * confirmation step before the operator starts talking is what makes rambling
 * safe, because nothing he says is committed to by saying it.
 */
export const ELICITATION_PROMPT = `Before any of this gets built, tell me what the skill is for.

Say it however it comes out. Ramble, double back, contradict yourself, go off
on the last time this went badly. Unstructured is fine and is genuinely what I
want. There is no form here and nothing to fill in.

Things worth mentioning if they come to mind, and worth skipping if they do
not: the one job it does; when you would reach for it and when you would not;
what it should flatly refuse to do, and why refusing is the right answer; what
it is allowed to touch and why you would trust it with that; anything it must
stop and ask you about before doing; and anything you already tried that did
not work, which is the part that gets lost.

I will write it back to you as clean prose. You correct it until it is right.
Nothing is stored until you say so.`;

/**
 * What a regeneration needs in order to rebuild the skill from this intent
 * alone. `intent-elicitation.md` owns this list; the drift suite derives it
 * from that document and fails when the two disagree.
 */
export const COVERAGE_TOPICS = [
  'one-job',
  'triggers',
  'refusals',
  'permissions',
  'gates',
  'rationale',
];

const TOPIC_FIELDS = ['topic', 'covered', 'evidence'];
const FOLLOW_UP_FIELDS = ['topic', 'question'];
const RECORD_FIELDS = ['transcript', 'topics', 'followUps'];

function assertKnownKeys(object, allowed, code, label) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length) {
    throw new ElicitationError(code, `${label} carries unknown field(s): ${unknown.join(', ')}`);
  }
}

function requireText(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ElicitationError(code, message);
  }
  return value.trim();
}

/** Whitespace-insensitive, case-insensitive comparison surface. */
export function normalizeForEvidence(value) {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The floor on what counts as a quote.
 *
 * Checking that evidence appears in the transcript is worthless without this.
 * A single character appears in every transcript, so `evidence: "a"` would
 * satisfy the check on every topic and the coverage guard would degrade to
 * "whatever the caller asserted" while still reporting `complete` — the exact
 * fail-open shape this repository keeps shipping. The floor forces a quote long
 * enough to be about something.
 */
export const MINIMUM_EVIDENCE_WORDS = 4;
export const MINIMUM_EVIDENCE_CHARACTERS = 16;

/**
 * Quotes that must never be accepted as evidence. The suite runs each through
 * `reviewElicitation` against a transcript that contains it, and fails when one
 * is accepted.
 */
export const TRIVIAL_EVIDENCE_PROBES = ['a', 'I', 'o', '.', 'the', 'a thing', 'sorts them'];

/**
 * Validates one elicitation record.
 *
 * Returns `{ status, gaps, questions, evidence }`. `status` is `complete` only
 * when every topic is covered by something the operator said and no question
 * remains outstanding. Anything malformed is a refusal rather than a downgrade
 * to `questions-pending`, so a broken record can never be mistaken for an
 * honest gap.
 */
export function reviewElicitation(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new ElicitationError('invalid_input', 'the elicitation record must be an object');
  }
  assertKnownKeys(record, RECORD_FIELDS, 'unknown_field', 'the elicitation record');

  const transcript = requireText(
    record.transcript,
    'missing_transcript',
    'the operator has not said anything yet; ask before designing anything',
  );
  const haystack = normalizeForEvidence(transcript);

  if (!Array.isArray(record.topics)) {
    throw new ElicitationError('invalid_input', 'topics must be an array');
  }
  const followUps = record.followUps ?? [];
  if (!Array.isArray(followUps)) {
    throw new ElicitationError('invalid_input', 'followUps must be an array');
  }

  const covered = new Map();
  const evidence = new Map();
  for (const entry of record.topics) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ElicitationError('invalid_input', 'every topic entry must be an object');
    }
    assertKnownKeys(entry, TOPIC_FIELDS, 'unknown_field', 'a topic entry');
    const topic = requireText(entry.topic, 'invalid_input', 'a topic entry requires a topic');
    if (!COVERAGE_TOPICS.includes(topic)) {
      throw new ElicitationError(
        'unknown_topic',
        `${topic} is not a topic regeneration needs; known topics are ${COVERAGE_TOPICS.join(', ')}`,
      );
    }
    if (covered.has(topic)) {
      throw new ElicitationError('duplicate_topic', `${topic} is assessed more than once`);
    }
    if (typeof entry.covered !== 'boolean') {
      throw new ElicitationError(
        'invalid_input',
        `${topic} must declare covered as a boolean; an absent assessment is not a covered one`,
      );
    }
    if (entry.covered) {
      const quoted = typeof entry.evidence === 'string' ? entry.evidence.trim() : '';
      if (!quoted) {
        throw new ElicitationError(
          'unsupported_coverage',
          `${topic} is claimed covered with no evidence; quote what the operator said`,
        );
      }
      const normalizedQuote = normalizeForEvidence(quoted);
      if (
        normalizedQuote.length < MINIMUM_EVIDENCE_CHARACTERS
        || normalizedQuote.split(' ').filter(Boolean).length < MINIMUM_EVIDENCE_WORDS
      ) {
        throw new ElicitationError(
          'unsupported_coverage',
          `${topic} cites too little to be a quote: ${quoted}. Quote at least ${MINIMUM_EVIDENCE_WORDS} words of what the operator actually said, because a fragment short enough to appear anywhere proves nothing.`,
        );
      }
      if (!haystack.includes(normalizedQuote)) {
        throw new ElicitationError(
          'unsupported_coverage',
          `${topic} cites evidence that does not appear in what the operator said: ${quoted}`,
        );
      }
      evidence.set(topic, quoted);
    } else if (typeof entry.evidence === 'string' && entry.evidence.trim()) {
      throw new ElicitationError(
        'invalid_input',
        `${topic} is marked uncovered but carries evidence; decide which it is`,
      );
    }
    covered.set(topic, entry.covered);
  }

  const missing = COVERAGE_TOPICS.filter((topic) => !covered.has(topic));
  if (missing.length) {
    throw new ElicitationError(
      'missing_topic',
      `every topic is assessed explicitly; unassessed: ${missing.join(', ')}. An unassessed topic is not a covered one.`,
    );
  }

  const asked = new Map();
  for (const entry of followUps) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ElicitationError('invalid_input', 'every follow-up must be an object');
    }
    assertKnownKeys(entry, FOLLOW_UP_FIELDS, 'unknown_field', 'a follow-up');
    const topic = requireText(entry.topic, 'invalid_input', 'a follow-up requires a topic');
    if (!COVERAGE_TOPICS.includes(topic)) {
      throw new ElicitationError('unknown_topic', `${topic} is not a topic regeneration needs`);
    }
    const question = requireText(entry.question, 'invalid_input', 'a follow-up requires a question');
    if (covered.get(topic)) {
      throw new ElicitationError(
        'redundant_question',
        `${topic} was already answered; asking it again spends the operator's patience on something he has said`,
      );
    }
    if (asked.has(topic)) {
      throw new ElicitationError(
        'duplicate_question',
        `${topic} is asked more than once; one gap is one question, and a list of questions is the form this step exists to avoid`,
      );
    }
    asked.set(topic, question);
  }

  const gaps = COVERAGE_TOPICS.filter((topic) => !covered.get(topic));
  const unasked = gaps.filter((topic) => !asked.has(topic));
  if (unasked.length) {
    throw new ElicitationError(
      'unasked_gap',
      `these topics are missing and no question was asked about them: ${unasked.join(', ')}. A gap nobody asks about is a gap that gets invented later.`,
    );
  }

  return {
    status: gaps.length ? 'questions-pending' : 'complete',
    gaps,
    questions: gaps.map((topic) => ({ topic, question: asked.get(topic) })),
    evidence: Object.fromEntries(evidence),
  };
}

const VALUE_FLAGS = ['--review'];

export const USAGE = `Usage: intent-elicitation.mjs --prompt
       intent-elicitation.mjs --review <path>

  --prompt  Print the exact opening ask shown to the operator.
  --review  Absolute path to a JSON elicitation record to validate.
  --probe   Report availability and exit.`;

export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { mode: 'probe' };
    }
    if (flag === '--prompt') {
      if (values.prompt) {
        throw new ElicitationError('usage', '--prompt was given more than once');
      }
      values.prompt = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(flag)) {
      throw new ElicitationError('usage', `unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new ElicitationError('usage', `${flag} requires a value`);
    }
    const name = flag.slice(2);
    if (name in values) {
      throw new ElicitationError('usage', `${flag} was given more than once`);
    }
    values[name] = value;
    index += 1;
  }
  if (values.prompt && values.review) {
    throw new ElicitationError('usage', '--prompt and --review are separate modes');
  }
  if (!values.prompt && !values.review) {
    throw new ElicitationError('usage', 'pass either --prompt or --review');
  }
  return values.prompt ? { mode: 'prompt' } : { mode: 'review', review: values.review };
}

export function readRecordFile(candidate) {
  if (!path.isAbsolute(candidate)) {
    throw new ElicitationError('unsafe_path', 'record path must be absolute');
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new ElicitationError('unsafe_path', 'record path must not traverse upward');
  }
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    throw new ElicitationError('unsafe_path', `record does not exist: ${candidate}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new ElicitationError('unsafe_path', 'record path must be a regular file');
  }
  try {
    return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch (error) {
    if (error instanceof ElicitationError) {
      throw error;
    }
    throw new ElicitationError('invalid_json', `record is not valid JSON: ${error.message}`);
  }
}

export function run(argv, streams = process) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    streams.stderr.write(`${error.code ?? 'usage'}: ${error.message}\n${USAGE}\n`);
    return 1;
  }
  if (parsed.mode === 'probe') {
    streams.stdout.write('intent-elicitation: available\n');
    return 0;
  }
  if (parsed.mode === 'prompt') {
    streams.stdout.write(`${ELICITATION_PROMPT}\n`);
    return 0;
  }
  try {
    const result = reviewElicitation(readRecordFile(parsed.review));
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof ElicitationError) {
      streams.stderr.write(`${error.code}: ${error.message}\n`);
      return ['usage', 'unsafe_path', 'invalid_json'].includes(error.code) ? 1 : 2;
    }
    throw error;
  }
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
