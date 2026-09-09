/**
 * The confirmation gate Skill Sniper cannot get past without the operator.
 *
 * Two moments in an adoption run look like decisions and are not:
 *
 *   - **the synthesized intent**, which is a proposal about what the operator
 *     meant, produced by reducing a document he did not write; and
 *   - **an answer to a question the authoring context asked**, which is a
 *     proposal about what he wants, produced by reading that same document.
 *
 * Both are evidence-backed, both are usually right, and both are exactly the
 * kind of thing a long run talks itself into treating as settled. So neither is
 * a paragraph reminding the model to check. Each is a state this gate is in, and
 * proceeding from any other state is refused.
 *
 * ## What this gate does and does not prove
 *
 * It proves **byte binding**: a release is bound to the exact text that was
 * presented, a correction invalidates it, and a state that does not replay from
 * its own recorded events is refused rather than trusted. Every one of those is
 * checked here, including on state that arrived from disk.
 *
 * It does **not** authenticate a person. `actor` is an assertion made by
 * whatever writes the event, and this module has no trusted channel to a human
 * to check it against. Rejecting `source`, `agent`, `authoring-context`, and
 * `synthesize` keeps the workflow's own components from confirming on the
 * operator's behalf, which is the honest scope of the control. Treating it as
 * proof of human origin would be an overclaim, and the accompanying document
 * says so in those words.
 *
 * That is why the event log is now byte-complete: a state carries every event
 * that produced it, with actor and digest, so a later reader can see what was
 * confirmed and by which declared actor rather than taking a status field's
 * word for it.
 */

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const GATE_SUBJECTS = ['adoption-intent', 'authoring-answer'];
export const GATE_STATUSES = ['awaiting-presentation', 'presented', 'corrected', 'confirmed', 'released'];
export const GATE_EVENTS = ['open', 'presented', 'corrected', 'confirmed', 'release'];

/** The only actor this gate accepts. See the honesty note above. */
export const CONFIRMING_ACTOR = 'human';
export const NON_CONFIRMING_ACTORS = ['source', 'agent', 'authoring-context', 'synthesize'];

export const GATE_FAILURES = {
  usage: 'usage',
  unknownEvent: 'unknown_event',
  unknownField: 'unknown_field',
  unknownSubject: 'unknown_subject',
  outOfOrder: 'out_of_order',
  staleConfirmation: 'stale_confirmation',
  nonHumanConfirmation: 'non_human_confirmation',
  unconfirmed: 'unconfirmed',
  forgedState: 'forged_state',
};

const EVENT_FIELDS = {
  open: ['type', 'subject'],
  presented: ['type', 'text'],
  corrected: ['type', 'actor', 'words'],
  confirmed: ['type', 'actor', 'digest'],
  release: ['type'],
};

export class GateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GateError';
    this.code = code;
  }
}

export function digestOf(text) {
  if (typeof text !== 'string') {
    throw new GateError(GATE_FAILURES.usage, 'text must be a string');
  }
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function createState() {
  return {
    subject: null,
    status: 'awaiting-presentation',
    presentedDigest: null,
    confirmedDigest: null,
    corrections: [],
    released: false,
    events: [],
  };
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new GateError(GATE_FAILURES.usage, 'event must be an object');
  }
  if (!GATE_EVENTS.includes(event.type)) {
    throw new GateError(GATE_FAILURES.unknownEvent, `unknown event type: ${event.type}`);
  }
  const allowed = EVENT_FIELDS[event.type];
  for (const key of Object.keys(event)) {
    if (!allowed.includes(key)) {
      throw new GateError(
        GATE_FAILURES.unknownField,
        `${event.type} has no field ${key}; an unknown field is a refusal, not a default`,
      );
    }
  }
  return event;
}

function requireHuman(event) {
  if (event.actor === CONFIRMING_ACTOR) return;
  if (NON_CONFIRMING_ACTORS.includes(event.actor)) {
    throw new GateError(
      GATE_FAILURES.nonHumanConfirmation,
      `${event.actor} supplies evidence, never the operator's answer`,
    );
  }
  throw new GateError(
    GATE_FAILURES.nonHumanConfirmation,
    `only ${CONFIRMING_ACTOR} confirms; received actor "${event.actor}"`,
  );
}

/**
 * The recorded form of an event.
 *
 * It keeps everything the reducer needs, so a state replays from its own log,
 * plus the declared actor, so a reader can see who each event claimed to be
 * rather than inferring it from a status field.
 */
function recordOf(event) {
  switch (event.type) {
    case 'open':
      return { type: 'open', subject: event.subject };
    case 'presented':
      return { type: 'presented', digest: digestOf(event.text) };
    case 'corrected':
      return { type: 'corrected', actor: event.actor, words: event.words };
    case 'confirmed':
      return { type: 'confirmed', actor: event.actor, digest: event.digest };
    default:
      return { type: event.type };
  }
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Validate a record's own shape, independently of how it arrived.
 *
 * Both the live path and the replay path go through this, so a record that
 * could never have been produced legitimately is refused when it is read back
 * off disk exactly as it would have been refused when it was applied.
 */
function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new GateError(GATE_FAILURES.forgedState, 'every recorded event must be an object');
  }
  const shapes = {
    open: ['type', 'subject'],
    presented: ['type', 'digest'],
    corrected: ['type', 'actor', 'words'],
    confirmed: ['type', 'actor', 'digest'],
    release: ['type'],
  };
  const allowed = shapes[record.type];
  if (!allowed) {
    throw new GateError(
      GATE_FAILURES.forgedState,
      `unrecognized recorded event: ${JSON.stringify(record.type ?? null)}`,
    );
  }
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...allowed].sort())) {
    throw new GateError(
      GATE_FAILURES.forgedState,
      `a ${record.type} record carries exactly ${allowed.join(', ')}`,
    );
  }
  if ((record.type === 'presented' || record.type === 'confirmed') && !SHA256.test(record.digest)) {
    throw new GateError(GATE_FAILURES.forgedState, `a ${record.type} record requires a SHA-256 digest`);
  }
  if (record.type === 'corrected' && (typeof record.words !== 'string' || record.words.trim() === '')) {
    throw new GateError(GATE_FAILURES.forgedState, "a correction records the operator's own words");
  }
  return record;
}

/**
 * The single reducer. Every ordering, authority, and staleness rule lives here,
 * so the live path and the replay path cannot diverge.
 */
function reduce(state, record) {
  validateRecord(record);
  if (state.released) {
    throw new GateError(
      GATE_FAILURES.outOfOrder,
      'this episode was released and is terminal; a further confirmation needs its own episode',
    );
  }
  const next = {
    ...state,
    corrections: [...state.corrections],
    events: [...state.events, record],
  };

  switch (record.type) {
    case 'open': {
      if (state.subject !== null) {
        throw new GateError(
          GATE_FAILURES.outOfOrder,
          'this episode is already open; a second subject needs its own episode',
        );
      }
      if (!GATE_SUBJECTS.includes(record.subject)) {
        throw new GateError(
          GATE_FAILURES.unknownSubject,
          `subject must be one of ${GATE_SUBJECTS.join(', ')}`,
        );
      }
      next.subject = record.subject;
      return next;
    }
    case 'presented': {
      if (state.subject === null) {
        throw new GateError(GATE_FAILURES.outOfOrder, 'open the episode before presenting');
      }
      next.presentedDigest = record.digest;
      next.confirmedDigest = null;
      next.status = 'presented';
      return next;
    }
    case 'corrected': {
      if (!['presented', 'corrected', 'confirmed'].includes(state.status)) {
        throw new GateError(GATE_FAILURES.outOfOrder, 'nothing has been presented to correct');
      }
      requireHuman(record);
      next.corrections.push(record.words);
      next.presentedDigest = null;
      next.confirmedDigest = null;
      next.status = 'corrected';
      return next;
    }
    case 'confirmed': {
      if (state.status !== 'presented' || state.presentedDigest === null) {
        throw new GateError(
          GATE_FAILURES.outOfOrder,
          'there is no presentation in front of the operator to confirm',
        );
      }
      requireHuman(record);
      if (record.digest !== state.presentedDigest) {
        throw new GateError(
          GATE_FAILURES.staleConfirmation,
          'the confirmation names text other than what was presented',
        );
      }
      next.confirmedDigest = record.digest;
      next.status = 'confirmed';
      return next;
    }
    case 'release': {
      if (state.status !== 'confirmed' || state.confirmedDigest === null) {
        throw new GateError(
          GATE_FAILURES.unconfirmed,
          `nothing proceeds from ${state.status}; the operator has not confirmed these words`,
        );
      }
      next.released = true;
      next.status = 'released';
      return next;
    }
    default:
      throw new GateError(GATE_FAILURES.unknownEvent, `unhandled event: ${record.type}`);
  }
}

/**
 * Rebuild a state from its own event log.
 *
 * This is what makes a state file checkable rather than merely assertive. A
 * status field alone is a string somebody wrote; a status that reproduces from
 * the events recorded beside it is a claim that can be tested, and one that does
 * not reproduce is refused.
 */
export function replay(events) {
  if (!Array.isArray(events)) {
    throw new GateError(GATE_FAILURES.usage, 'events must be an array');
  }
  return events.reduce((state, record) => reduce(state, record), createState());
}

/**
 * Refuse any state that is not exactly the reduction of its own event log.
 *
 * Applied to every state that arrives from outside this module, which is the
 * only place a hand-authored "already confirmed" file could get in. It catches
 * a status without the events that would produce it. It cannot catch a
 * well-formed log somebody wrote by hand, because nothing here can; that limit
 * is stated plainly in the unit document rather than papered over.
 */
export function verifyState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new GateError(GATE_FAILURES.usage, 'state must be an object');
  }
  const expectedKeys = Object.keys(createState()).sort();
  if (JSON.stringify(Object.keys(state).sort()) !== JSON.stringify(expectedKeys)) {
    throw new GateError(
      GATE_FAILURES.forgedState,
      `state must carry exactly ${expectedKeys.join(', ')}`,
    );
  }
  let replayed;
  try {
    replayed = replay(state.events);
  } catch (error) {
    throw new GateError(
      GATE_FAILURES.forgedState,
      `state does not replay from its own events: ${error.message}`,
    );
  }
  if (JSON.stringify(replayed) !== JSON.stringify(state)) {
    throw new GateError(
      GATE_FAILURES.forgedState,
      'state is not the reduction of its own event log',
    );
  }
  return state;
}

/** Apply one event to a verified state. Every refusal names the rule it broke. */
export function applyEvent(state, event) {
  verifyState(state);
  validateEvent(event);
  if (event.type === 'presented' && (typeof event.text !== 'string' || event.text.trim() === '')) {
    throw new GateError(GATE_FAILURES.usage, 'presented requires the full text, not a summary');
  }
  if (event.type === 'corrected' && (typeof event.words !== 'string' || event.words.trim() === '')) {
    throw new GateError(GATE_FAILURES.usage, "a correction records the operator's own words");
  }
  if (event.type === 'confirmed' && (typeof event.digest !== 'string' || !SHA256.test(event.digest))) {
    throw new GateError(GATE_FAILURES.usage, 'a confirmation names the digest of the text presented');
  }
  return reduce(state, recordOf(event));
}

export function applyEvents(events) {
  return events.reduce(applyEvent, createState());
}

/**
 * The check every consumer runs before using confirmed text.
 *
 * It verifies the state replays from its own log, then re-derives the digest
 * from the bytes actually about to be used, so text that changed after the yes
 * is refused rather than carried.
 */
export function requireConfirmed(state, text) {
  try {
    verifyState(state);
  } catch (error) {
    return { requirement: 'blocked', reasons: [error.message] };
  }
  if (!state.released || state.confirmedDigest === null) {
    return { requirement: 'blocked', reasons: [`gate status is ${state.status}`] };
  }
  const actual = digestOf(text);
  if (actual !== state.confirmedDigest) {
    return {
      requirement: 'blocked',
      reasons: ['the text about to be used is not the text the operator confirmed'],
    };
  }
  return { requirement: 'satisfied', subject: state.subject, digest: actual };
}

function usage(message) {
  throw new GateError(GATE_FAILURES.usage, message);
}

function parseArguments(argv) {
  const options = { state: null, event: null, confirmed: null, report: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--report') {
      options.report = true;
    } else if (argument === '--state' || argument === '--event' || argument === '--confirmed') {
      const value = argv[index + 1];
      if (value === undefined) usage(`${argument} requires a value`);
      options[argument.slice(2)] = value;
      index += 1;
    } else {
      usage(`unknown argument: ${argument}`);
    }
  }
  if (!options.state) usage('--state <path> is required');
  if (!options.event && !options.confirmed) usage('--event <path> or --confirmed <path> is required');
  if (options.event && options.confirmed) usage('--event and --confirmed are separate operations');
  return options;
}

function readJson(file, what) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new GateError(GATE_FAILURES.usage, `cannot read ${what}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new GateError(GATE_FAILURES.forgedState, `${what} is not valid JSON: ${error.message}`);
  }
}

export function main(argv) {
  const options = parseArguments(argv);
  const state = fs.existsSync(options.state)
    ? readJson(options.state, 'gate state')
    : createState();

  if (options.confirmed) {
    let text;
    try {
      text = fs.readFileSync(options.confirmed, 'utf8');
    } catch (error) {
      throw new GateError(GATE_FAILURES.usage, `cannot read confirmed text: ${error.message}`);
    }
    const result = requireConfirmed(state, text);
    console.log(JSON.stringify(result, null, 2));
    if (result.requirement !== 'satisfied') {
      throw new GateError(GATE_FAILURES.unconfirmed, result.reasons.join('; '));
    }
    return;
  }

  const next = applyEvent(state, readJson(options.event, 'event'));
  fs.writeFileSync(options.state, `${JSON.stringify(next, null, 2)}\n`);
  console.log(options.report ? JSON.stringify(next, null, 2) : `${next.events.at(-1).type} -> ${next.status}`);
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.code ? `${error.code}: ${error.message}` : error.message);
    process.exitCode = error.code === GATE_FAILURES.usage ? 1 : 2;
  }
}
