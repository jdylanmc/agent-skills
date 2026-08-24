#!/usr/bin/env node

/**
 * Validates the definition packet a coaching session hands to its caller.
 *
 * The packet is the only thing that leaves this skill, and everything that can
 * go wrong with it goes wrong quietly:
 *
 * 1. **A guess wearing the human's voice.** A coach that fills an unanswered
 *    question with something plausible produces a packet nothing downstream can
 *    tell apart from something the person actually said. So every claim
 *    attributed to the human carries the human's own words, and a claim with no
 *    words behind it is refused rather than reported as thin.
 * 2. **Unresolved material dressed as settled.** `ready` is the signal a caller
 *    acts on. A packet cannot be `ready` while it also carries a blocking open
 *    question, and it cannot be `ready` out of a run that degraded.
 * 3. **Borrowed authority.** The single confirmation that matters is the one
 *    the intent storage gate takes from the operator, bound to the exact bytes
 *    it presented. A packet that carries a confirmation, an approval, or a
 *    stored-intent path is claiming custody it does not have, and it is refused
 *    by name rather than as a nameless unknown field.
 * 4. **Write authority.** This skill writes nothing. A packet that reports
 *    files it created is describing something that did not happen here.
 *
 * Every check runs, and every defect is returned together. A caller that
 * rejects a packet needs the complete list, not the first thing that failed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class PacketError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PacketError';
    this.code = code;
  }
}

export const SCHEMA_VERSION = 1;

/**
 * The shortest quote that can be evidence of anything. A one-character quote
 * appears in every conversation, so without a floor "the human said so" would
 * mean whatever the coach asserted.
 */
export const QUOTE_FLOOR = 12;

export const PACKET_FIELDS = [
  'schemaVersion',
  'skill',
  'status',
  'coaching',
  'persona',
  'definition',
  'explored',
  'decisions',
  'recommendations',
  'examples',
  'unsettled',
];

export const PERSONA_FIELDS = ['status', 'path', 'digest', 'reason'];
export const DEFINITION_FIELDS = ['interaction', 'outcome', 'agreement', 'quote'];
export const EXPLORED_FIELDS = ['subject', 'finding', 'source', 'quote'];
export const DECISION_FIELDS = ['decision', 'reasoning', 'quote'];
export const RECOMMENDATION_FIELDS = ['recommendation', 'disposition', 'humanReasoning'];
export const EXAMPLE_FIELDS = ['situation', 'behavior'];
export const UNSETTLED_FIELDS = ['question', 'whyItMatters', 'blocking'];

export const PACKET_STATUSES = ['ready', 'unsettled'];
export const COACHING_STATUSES = ['coached', 'degraded'];
export const PERSONA_STATUSES = ['adopted', 'unavailable'];
export const AGREEMENTS = ['in-conversation', 'none'];
export const SOURCES = ['human', 'coach'];
export const DISPOSITIONS = ['accepted', 'rejected', 'open'];

/**
 * Field names that would claim the operator's confirmation, an approval, or
 * custody of a stored intent. None of them is an allowed field, so naming them
 * changes only the error a caller reads - which is the point: `unknown field
 * confirmed` and `this packet claims a confirmation it cannot hold` send an
 * author to two different places.
 */
export const CONFIRMATION_CLAIM_NAMES = [
  'confirmed',
  'confirmation',
  'operatorconfirmed',
  'humanconfirmed',
  'storageconfirmation',
  'confirmationdigest',
  'approved',
  'approval',
  'signoff',
  'signedoff',
  'stored',
  'storedintent',
  'intentpath',
  'intentstored',
  'gate',
  'gatestate',
];

/** Field names that would claim this skill wrote something. It never does. */
export const WRITE_CLAIM_NAMES = [
  'files',
  'writes',
  'written',
  'wrote',
  'writtenfiles',
  'createdfiles',
  'packagepath',
  'packagefiles',
  'intentfile',
  'filesystem',
];

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[-_\s]/g, '');
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

class DefectLog {
  constructor() {
    this.defects = [];
  }

  add(code, location, message) {
    this.defects.push({ code, path: location, message });
  }

  /**
   * Reports every key an object carries that its level does not allow, sorted
   * into the three categories so the reason is legible.
   */
  screenKeys(object, allowed, location) {
    for (const key of Object.keys(object).sort()) {
      if (allowed.includes(key)) {
        continue;
      }
      const normalized = normalizeKey(key);
      if (CONFIRMATION_CLAIM_NAMES.includes(normalized)) {
        this.add(
          'forged_confirmation',
          `${location}.${key}`,
          'a definition packet never carries the operator\'s confirmation, an approval, or a stored intent; that custody belongs to the intent storage gate',
        );
        continue;
      }
      if (WRITE_CLAIM_NAMES.includes(normalized)) {
        this.add(
          'write_claim',
          `${location}.${key}`,
          'a definition packet never reports files, because coaching writes nothing',
        );
        continue;
      }
      this.add('unknown_field', `${location}.${key}`, `the packet has no place for ${key}`);
    }
  }

  requireText(object, field, location) {
    if (!nonEmptyString(object[field])) {
      this.add('missing_field', `${location}.${field}`, `${field} is required and must be non-empty`);
      return false;
    }
    return true;
  }

  requireEnum(object, field, allowed, location) {
    if (!allowed.includes(object[field])) {
      this.add(
        'invalid_value',
        `${location}.${field}`,
        `${field} must be one of ${allowed.join(', ')}`,
      );
      return false;
    }
    return true;
  }

  requireQuote(object, field, location, why) {
    if (!this.requireText(object, field, location)) {
      return;
    }
    if (object[field].trim().length < QUOTE_FLOOR) {
      this.add(
        'unsupported_quote',
        `${location}.${field}`,
        `${why} (at least ${QUOTE_FLOOR} characters of what the person actually said)`,
      );
    }
  }

  requireArray(packet, field) {
    if (!Array.isArray(packet[field])) {
      this.add('invalid_value', field, `${field} must be an array, empty when there is nothing to record`);
      return null;
    }
    return packet[field];
  }
}

function validateEntries(log, entries, field, allowed, validateEntry) {
  if (entries === null) {
    return;
  }
  entries.forEach((entry, index) => {
    const location = `${field}[${index}]`;
    if (!isPlainObject(entry)) {
      log.add('invalid_value', location, 'every entry must be an object');
      return;
    }
    log.screenKeys(entry, allowed, location);
    validateEntry(entry, location);
  });
}

/**
 * Returns `{ status, defects }`. `status` is `valid` only when every check
 * passes; there is no partial pass, and no defect is suppressed by another.
 */
export function validatePacket(packet) {
  const log = new DefectLog();
  if (!isPlainObject(packet)) {
    log.add('invalid_value', 'packet', 'the packet must be a JSON object');
    return { status: 'refused', defects: log.defects };
  }

  log.screenKeys(packet, PACKET_FIELDS, 'packet');

  if (packet.schemaVersion !== SCHEMA_VERSION) {
    log.add('invalid_value', 'schemaVersion', `schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (!(packet.skill === null || nonEmptyString(packet.skill))) {
    log.add(
      'invalid_value',
      'skill',
      'skill is the candidate name, or null when the conversation has not settled one',
    );
  }
  const statusValid = log.requireEnum(packet, 'status', PACKET_STATUSES, 'packet');
  const coachingValid = log.requireEnum(packet, 'coaching', COACHING_STATUSES, 'packet');

  let personaValid = false;
  if (!isPlainObject(packet.persona)) {
    log.add('missing_field', 'persona', 'persona is required and records how the coach was resolved');
  } else {
    log.screenKeys(packet.persona, PERSONA_FIELDS, 'persona');
    personaValid = log.requireEnum(packet.persona, 'status', PERSONA_STATUSES, 'persona');
    if (packet.persona.status === 'adopted') {
      log.requireText(packet.persona, 'path', 'persona');
      log.requireText(packet.persona, 'digest', 'persona');
      if ('reason' in packet.persona) {
        log.add('invalid_value', 'persona.reason', 'an adopted persona records no failure reason');
      }
    }
    if (packet.persona.status === 'unavailable') {
      log.requireText(packet.persona, 'reason', 'persona');
      for (const field of ['path', 'digest']) {
        if (field in packet.persona) {
          log.add(
            'invalid_value',
            `persona.${field}`,
            'an unavailable persona resolved nothing, so it records no path or digest',
          );
        }
      }
    }
  }

  if (personaValid && coachingValid && packet.persona.status === 'unavailable' && packet.coaching === 'coached') {
    log.add(
      'degraded_mismatch',
      'coaching',
      'the coach persona did not resolve, so the run degraded and must say so',
    );
  }

  let definitionAgreed = false;
  if (!isPlainObject(packet.definition)) {
    log.add('missing_field', 'definition', 'definition is required and carries the interaction and the outcome');
  } else {
    log.screenKeys(packet.definition, DEFINITION_FIELDS, 'definition');
    log.requireText(packet.definition, 'interaction', 'definition');
    log.requireText(packet.definition, 'outcome', 'definition');
    log.requireEnum(packet.definition, 'agreement', AGREEMENTS, 'definition');
    log.requireQuote(
      packet.definition,
      'quote',
      'definition',
      'the definition must quote the person it came from',
    );
    definitionAgreed = packet.definition.agreement === 'in-conversation';
  }

  const explored = log.requireArray(packet, 'explored');
  validateEntries(log, explored, 'explored', EXPLORED_FIELDS, (entry, location) => {
    log.requireText(entry, 'subject', location);
    log.requireText(entry, 'finding', location);
    if (log.requireEnum(entry, 'source', SOURCES, location) && entry.source === 'human') {
      log.requireQuote(
        entry,
        'quote',
        location,
        'a finding attributed to the person must quote the person',
      );
    }
  });

  const decisions = log.requireArray(packet, 'decisions');
  validateEntries(log, decisions, 'decisions', DECISION_FIELDS, (entry, location) => {
    log.requireText(entry, 'decision', location);
    log.requireText(entry, 'reasoning', location);
    log.requireQuote(entry, 'quote', location, 'a decision is the person\'s, so it quotes the person');
  });

  const recommendations = log.requireArray(packet, 'recommendations');
  validateEntries(log, recommendations, 'recommendations', RECOMMENDATION_FIELDS, (entry, location) => {
    log.requireText(entry, 'recommendation', location);
    if (
      log.requireEnum(entry, 'disposition', DISPOSITIONS, location)
      && entry.disposition !== 'open'
      && !nonEmptyString(entry.humanReasoning)
    ) {
      log.add(
        'unattributed_disposition',
        `${location}.humanReasoning`,
        `a recommendation recorded as ${entry.disposition} carries the person's reason for it`,
      );
    }
  });

  const examples = log.requireArray(packet, 'examples');
  validateEntries(log, examples, 'examples', EXAMPLE_FIELDS, (entry, location) => {
    log.requireText(entry, 'situation', location);
    log.requireText(entry, 'behavior', location);
  });

  const unsettled = log.requireArray(packet, 'unsettled');
  validateEntries(log, unsettled, 'unsettled', UNSETTLED_FIELDS, (entry, location) => {
    log.requireText(entry, 'question', location);
    log.requireText(entry, 'whyItMatters', location);
    if (typeof entry.blocking !== 'boolean') {
      log.add(
        'invalid_value',
        `${location}.blocking`,
        'blocking must be true or false; an unmarked open question is how one gets carried as settled',
      );
    }
  });

  if (statusValid && packet.status === 'ready') {
    const blocking = (unsettled ?? []).filter((entry) => isPlainObject(entry) && entry.blocking === true);
    if (blocking.length) {
      log.add(
        'disguised_unsettled',
        'status',
        `a packet carrying ${blocking.length} blocking open question(s) is not ready`,
      );
    }
    if (!definitionAgreed) {
      log.add(
        'unsupported_ready',
        'status',
        'a packet is ready only when the person agreed to the definition in the conversation',
      );
    }
    if (coachingValid && packet.coaching === 'degraded') {
      log.add('unsupported_ready', 'status', 'a degraded run cannot certify that an idea is ready');
    }
    if (Array.isArray(explored) && explored.length === 0) {
      log.add(
        'unsupported_ready',
        'status',
        'a packet that explored nothing is an intake note, not a coached definition',
      );
    }
  }

  return { status: log.defects.length ? 'refused' : 'valid', defects: log.defects };
}

export const USAGE = `Usage: definition-packet.mjs --stdin
       definition-packet.mjs --packet <absolute-path>

  --stdin   Read the packet JSON from standard input. Use this when the caller
            holds no write authority.
  --packet  Absolute path to an existing packet file.
  --probe   Report availability and exit.

Exit 0 accepts the packet, 2 refuses it and names every defect, and 1 is a
usage or path failure.`;

export function parseArguments(argv) {
  if (argv.includes('--probe')) {
    return { probe: true };
  }
  const parsed = { probe: false, stdin: false, packet: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--stdin') {
      parsed.stdin = true;
      continue;
    }
    if (flag === '--packet') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new PacketError('usage', '--packet requires a value');
      }
      if (parsed.packet !== null) {
        throw new PacketError('usage', '--packet was given more than once');
      }
      parsed.packet = value;
      index += 1;
      continue;
    }
    throw new PacketError('usage', `unknown argument: ${flag}`);
  }
  if (parsed.stdin === (parsed.packet !== null)) {
    throw new PacketError('usage', 'pass exactly one of --stdin or --packet');
  }
  return parsed;
}

function readPacketFile(candidate) {
  if (!path.isAbsolute(candidate)) {
    throw new PacketError('unsafe_path', 'packet path must be absolute');
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new PacketError('unsafe_path', 'packet path must not traverse upward');
  }
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    throw new PacketError('unsafe_path', `packet does not exist: ${candidate}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new PacketError('unsafe_path', 'packet path must be a regular file');
  }
  return fs.readFileSync(candidate, 'utf8');
}

export function run(argv, streams = process, readStdin = () => fs.readFileSync(0, 'utf8')) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    streams.stderr.write(`${error.code ?? 'usage'}: ${error.message}\n${USAGE}\n`);
    return 1;
  }
  if (parsed.probe) {
    streams.stdout.write('definition-packet: available\n');
    return 0;
  }

  let raw;
  try {
    raw = parsed.stdin ? readStdin() : readPacketFile(parsed.packet);
  } catch (error) {
    if (error instanceof PacketError) {
      streams.stderr.write(`${error.code}: ${error.message}\n`);
      return 1;
    }
    streams.stderr.write(`unreadable: ${error.message}\n`);
    return 1;
  }

  let packet;
  try {
    packet = JSON.parse(raw);
  } catch (error) {
    streams.stderr.write(`invalid_json: the packet is not valid JSON: ${error.message}\n`);
    return 1;
  }

  const result = validatePacket(packet);
  streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.status === 'valid' ? 0 : 2;
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
