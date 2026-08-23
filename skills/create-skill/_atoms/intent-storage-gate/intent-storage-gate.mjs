#!/usr/bin/env node

/**
 * Refuses to store an intent the operator has not confirmed.
 *
 * The intent is the operator's, not the skill's reading of it. A synthesis is a
 * guess until he says otherwise, and a stored guess is worse than no intent at
 * all: it looks authoritative, it is the input a regeneration trusts above
 * everything else, and nothing downstream can tell it apart from something he
 * actually said.
 *
 * "Confirm before storing" written in a workflow is a request that the caller
 * remember. Here it is a state machine that refuses. Storage requires a
 * confirmation bound to the exact bytes that were shown, so a correction after
 * a confirmation cannot ride on the old answer — the same head-binding rule the
 * remediation ledger uses for a stale roast, applied to a stale yes.
 *
 * Two validated implementations are reused rather than restated:
 * `intent-elicitation.mjs` decides whether the operator was actually asked, and
 * `intent-synthesis.mjs` decides whether the draft is plain requirements. Unit
 * composition runs strictly downward; a code dependency between sibling scripts
 * is a separate graph, and duplicating either rule here would let the two
 * copies drift.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { reviewElicitation } from '../intent-elicitation/intent-elicitation.mjs';
import { reviewIntentDraft } from '../intent-synthesis/intent-synthesis.mjs';

export class GateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GateError';
    this.code = code;
  }
}

export const STATUSES = ['awaiting-draft', 'presented', 'corrected', 'confirmed', 'stored'];


const STATE_FIELDS = [
  'version',
  'skill',
  'status',
  'presentedDigest',
  'confirmedDigest',
  'storedPath',
  'coverage',
  'history',
];

/**
 * The fields each event may carry. A union across event types would let an
 * event carry a field that belongs to a different one and have it silently
 * ignored, so the allow-list is per type.
 */
export const EVENT_FIELDS = {
  create: ['type', 'skill', 'coverage'],
  'draft-presented': ['type', 'draft'],
  'operator-corrected': ['type', 'note'],
  'operator-confirmed': ['type', 'digest'],
  store: ['type', 'draft', 'path'],
};

/** Derived from the field allow-list, so the two can never name different sets. */
export const EVENT_TYPES = Object.keys(EVENT_FIELDS);

export const STATE_VERSION = 1;

/** The canonical file name an intent is stored under. */
export const INTENT_FILE_NAME = 'intent.md';

function assertKnownKeys(object, allowed, code, label) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length) {
    throw new GateError(code, `${label} carries unknown field(s): ${unknown.join(', ')}`);
  }
}

function requireText(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GateError(code, message);
  }
  return value.trim();
}

/**
 * Validates a draft without altering it.
 *
 * Trimming here would be a quiet defect: the digest would bind to bytes the
 * operator never saw, so the words stored would not be the words confirmed —
 * which is the single guarantee this gate exists to make.
 */
function requireDraft(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GateError('invalid_event', message);
  }
  return value;
}

/** Line-ending-insensitive digest of a draft. */
export function digestOf(draft) {
  if (typeof draft !== 'string') {
    throw new GateError('invalid_input', 'a draft must be a string');
  }
  return crypto.createHash('sha256').update(draft.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Opens the gate for one skill. The elicitation record is re-validated here
 * rather than trusted, and an incomplete one is refused: an intent stored
 * without the operator having been asked about a topic a regeneration needs is
 * an intent with a hole in it that reads as whole.
 */
export function createGate(event) {
  const skill = requireText(event.skill, 'invalid_input', 'the gate requires a skill name');
  if (event.coverage === undefined || event.coverage === null) {
    throw new GateError(
      'coverage_missing',
      'the gate requires the elicitation record; an intent is not stored for a question nobody asked',
    );
  }
  const review = reviewElicitation(event.coverage);
  if (review.status !== 'complete') {
    throw new GateError(
      'coverage_incomplete',
      `the operator has not answered ${review.gaps.join(', ')}; ask before storing anything`,
    );
  }
  return {
    version: STATE_VERSION,
    skill,
    status: 'awaiting-draft',
    presentedDigest: null,
    confirmedDigest: null,
    storedPath: null,
    coverage: { status: review.status, evidence: review.evidence },
    history: [{ type: 'create', skill }],
  };
}

function assertState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new GateError('invalid_state', 'the gate state must be an object');
  }
  assertKnownKeys(state, STATE_FIELDS, 'unknown_state_field', 'the gate state');
  if (state.version !== STATE_VERSION) {
    throw new GateError('invalid_state', `unsupported gate state version: ${state.version}`);
  }
  if (!STATUSES.includes(state.status)) {
    throw new GateError('invalid_state', `unknown gate status: ${state.status}`);
  }
  if (!Array.isArray(state.history)) {
    throw new GateError('invalid_state', 'the gate state must carry a history array');
  }
  return state;
}

function safeTargetPath(candidate, skill) {
  const target = requireText(candidate, 'invalid_input', 'storing requires a path');
  if (!path.isAbsolute(target)) {
    throw new GateError('unsafe_path', 'the intent path must be absolute');
  }
  if (target.split(path.sep).includes('..')) {
    throw new GateError('unsafe_path', 'the intent path must not traverse upward');
  }
  const segments = target.split(path.sep);
  if (segments[segments.length - 1] !== INTENT_FILE_NAME) {
    throw new GateError('unsafe_path', `an intent is stored as ${INTENT_FILE_NAME}`);
  }
  if (segments[segments.length - 2] !== skill) {
    throw new GateError(
      'unsafe_path',
      `the intent for ${skill} is stored in that skill's own package; got ${target}`,
    );
  }
  const parent = path.dirname(target);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new GateError('unsafe_path', `the package directory does not exist: ${parent}`);
  }
  if (fs.existsSync(target)) {
    throw new GateError(
      'already_stored',
      `${target} already exists; this skill creates a new package and never overwrites an intent`,
    );
  }
  return target;
}

/**
 * Applies one event. Every refusal names the rule it enforces, and no event
 * degrades into a warning: a rejected event leaves the state exactly as it was.
 */
export function applyEvent(state, event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new GateError('invalid_event', 'an event must be an object');
  }
  const type = requireText(event.type, 'invalid_event', 'an event requires a type');
  if (!EVENT_TYPES.includes(type)) {
    throw new GateError('unknown_event', `unknown event type: ${type}`);
  }
  assertKnownKeys(event, EVENT_FIELDS[type], 'unknown_event_field', `a ${type} event`);
  if (type === 'create') {
    if (state !== null) {
      throw new GateError('already_created', 'the gate for this intent is already open');
    }
    return createGate(event);
  }

  const current = assertState(state);
  if (current.status === 'stored') {
    throw new GateError(
      'already_stored',
      'this intent has been stored; correcting it afterwards is a different job than creating it',
    );
  }
  const next = { ...current, history: [...current.history] };

  switch (type) {
    case 'draft-presented': {
      const draft = requireDraft(event.draft, 'presenting requires the draft text');
      const review = reviewIntentDraft(draft, current.skill);
      if (review.status !== 'plain' || review.shape !== 'well-formed') {
        throw new GateError(
          'not_plain_intent',
          `the draft is not plain requirements: ${[
            ...review.problems,
            ...review.findings.map((finding) => `line ${finding.line} ${finding.kind}: ${finding.detail}`),
          ].join(' | ')}`,
        );
      }
      next.presentedDigest = digestOf(draft);
      next.confirmedDigest = null;
      next.status = 'presented';
      next.history.push({ type, digest: next.presentedDigest });
      return next;
    }
    case 'operator-corrected': {
      if (current.status === 'awaiting-draft') {
        throw new GateError('nothing_presented', 'there is no draft to correct yet');
      }
      const note = requireText(
        event.note,
        'invalid_event',
        'a correction requires the operator\'s words; an unrecorded correction is a correction that gets re-made',
      );
      next.presentedDigest = null;
      next.confirmedDigest = null;
      next.status = 'corrected';
      next.history.push({ type, note });
      return next;
    }
    case 'operator-confirmed': {
      if (current.status !== 'presented') {
        throw new GateError(
          'nothing_presented',
          'the operator can only confirm a draft that is currently in front of him',
        );
      }
      const digest = requireText(event.digest, 'invalid_event', 'a confirmation names the draft it confirms');
      if (digest !== current.presentedDigest) {
        throw new GateError(
          'stale_confirmation',
          'the confirmation names a draft other than the one presented; present the current draft and ask again',
        );
      }
      next.confirmedDigest = digest;
      next.status = 'confirmed';
      next.history.push({ type, digest });
      return next;
    }
    case 'store': {
      if (current.status !== 'confirmed') {
        throw new GateError(
          'unconfirmed',
          'an unconfirmed synthesis is never stored; this is the operator\'s intent, not the skill\'s reading of it',
        );
      }
      const draft = requireDraft(event.draft, 'storing requires the draft text');
      const digest = digestOf(draft);
      if (digest !== current.confirmedDigest) {
        throw new GateError(
          'unconfirmed',
          'the text being stored is not the text that was confirmed; present the changed draft and ask again',
        );
      }
      const review = reviewIntentDraft(draft, current.skill);
      if (review.status !== 'plain' || review.shape !== 'well-formed') {
        throw new GateError('not_plain_intent', 'the confirmed text is not plain requirements');
      }
      const target = safeTargetPath(event.path, current.skill);
      fs.writeFileSync(target, draft.endsWith('\n') ? draft : `${draft}\n`, { flag: 'wx' });
      next.status = 'stored';
      next.storedPath = target;
      next.history.push({ type, digest, path: target });
      return next;
    }
    default:
      throw new GateError('unknown_event', `unhandled event type: ${type}`);
  }
}

export function gateReport(state) {
  const current = assertState(state);
  return {
    skill: current.skill,
    status: current.status,
    confirmed: current.confirmedDigest !== null,
    storedPath: current.storedPath,
    coverage: current.coverage,
    events: current.history.map((entry) => entry.type),
  };
}

const VALUE_FLAGS = ['--state', '--event'];

export const USAGE = `Usage: intent-storage-gate.mjs --state <path> --event <path> [--report]

  --state   Absolute path to the gate state file; created by a create event.
  --event   Absolute path to a JSON event to apply.
  --report  Print the gate report after applying the event.
  --probe   Report availability and exit.`;

export function parseArguments(argv) {
  const values = { report: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { probe: true };
    }
    if (flag === '--report') {
      if (values.report) {
        throw new GateError('usage', '--report was given more than once');
      }
      values.report = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(flag)) {
      throw new GateError('usage', `unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new GateError('usage', `${flag} requires a value`);
    }
    const name = flag.slice(2);
    if (name in values) {
      throw new GateError('usage', `${flag} was given more than once`);
    }
    values[name] = value;
    index += 1;
  }
  for (const required of ['state', 'event']) {
    if (!(required in values)) {
      throw new GateError('usage', `--${required} is required`);
    }
  }
  return { probe: false, ...values };
}

function assertSafePath(candidate, label, { mustExist }) {
  if (!path.isAbsolute(candidate)) {
    throw new GateError('unsafe_path', `${label} path must be absolute`);
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new GateError('unsafe_path', `${label} path must not traverse upward`);
  }
  let stats = null;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    if (mustExist) {
      throw new GateError('unsafe_path', `${label} does not exist: ${candidate}`);
    }
    return candidate;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new GateError('unsafe_path', `${label} path must be a regular file`);
  }
  return candidate;
}

function readJson(candidate, label) {
  try {
    return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch (error) {
    throw new GateError('invalid_json', `${label} is not valid JSON: ${error.message}`);
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
  if (parsed.probe) {
    streams.stdout.write('intent-storage-gate: available\n');
    return 0;
  }
  try {
    assertSafePath(parsed.state, 'state', { mustExist: false });
    assertSafePath(parsed.event, 'event', { mustExist: true });
    const event = readJson(parsed.event, 'event');
    const state = fs.existsSync(parsed.state) ? readJson(parsed.state, 'state') : null;
    const next = applyEvent(state, event);
    fs.writeFileSync(parsed.state, `${JSON.stringify(next, null, 2)}\n`);
    if (parsed.report) {
      streams.stdout.write(`${JSON.stringify(gateReport(next), null, 2)}\n`);
    } else {
      streams.stdout.write(`${next.status}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof GateError) {
      streams.stderr.write(`${error.code}: ${error.message}\n`);
      return ['usage', 'unsafe_path', 'invalid_json'].includes(error.code) ? 1 : 2;
    }
    if (error && typeof error.code === 'string') {
      streams.stderr.write(`${error.code}: ${error.message}\n`);
      return 2;
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
