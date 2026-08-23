/**
 * Chronicle: bounded Skill Run Log recording and replay.
 *
 * Callers supply meaningful event data and an inherited run context. This
 * module owns the persisted envelope: schema version, attribution, timestamp,
 * recorded sequence, validation, bounds, and ordinary file input and output.
 *
 * Ordering is internal. Replay treats the physical line order of the log as
 * authoritative and reports a recorded sequence that disagrees with it as a
 * defect rather than silently reordering or repairing the evidence.
 */

import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 2;
export const SUPPORTED_SCHEMA_VERSIONS = [1, 2];
export const MAX_SUMMARY_BYTES = 500;
export const MAX_REFERENCE_BYTES = 200;
export const MAX_IDENTIFIER_BYTES = 100;
export const MAX_EVIDENCE_ITEMS = 10;
export const MAX_EVENT_BYTES = 4096;

export const PHASES = ['before', 'after', 'observation'];

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

const EVENT_FIELDS = [
  'schema_version',
  'run_id',
  'root_skill',
  'skill',
  'sequence',
  'timestamp',
  'event',
  'phase',
  'operation',
  'outcome',
  'summary',
  'evidence',
  'truncated',
];

/** What a caller may supply per event. Anything else is a caller mistake. */
const CALLER_FIELDS = ['skill', 'event', 'phase', 'summary', 'operation', 'outcome', 'evidence'];

/** What the inherited run context may carry. */
const CONTEXT_FIELDS = ['run_id', 'root_skill', 'log_path'];

export class ChronicleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChronicleError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ChronicleError(code, message);
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

/** Truncates on a UTF-8 codepoint boundary so a persisted event is never malformed. */
function boundText(value, maxBytes) {
  const buffer = Buffer.from(value, 'utf8');
  if (buffer.length <= maxBytes) {
    return { text: value, truncated: false };
  }

  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0xC0) === 0x80) {
    end -= 1;
  }
  const lead = buffer[end];
  let width = 1;
  if ((lead & 0xE0) === 0xC0) {
    width = 2;
  } else if ((lead & 0xF0) === 0xE0) {
    width = 3;
  } else if ((lead & 0xF8) === 0xF0) {
    width = 4;
  }
  if (end + width <= maxBytes) {
    end += width;
  }

  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true };
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail('invalid_input', `${field} must be a non-empty identifier`);
  }
  if (byteLength(value) > MAX_IDENTIFIER_BYTES) {
    fail('invalid_input', `${field} must not exceed ${MAX_IDENTIFIER_BYTES} bytes`);
  }
  return value;
}

function requireCleanText(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail('invalid_input', `${field} must be a non-empty string`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    fail('invalid_input', `${field} must not contain control characters`);
  }
  return value.trim();
}

/**
 * Builds the persisted event from caller input plus inherited run context.
 * The record carries no writer-assigned sequence: physical log position is the
 * only ordering, and replay assigns it. That removes an unwinnable race
 * between concurrent writers.
 */
export function buildEvent(input, context, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('invalid_input', 'event input must be an object');
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    fail('invalid_input', 'run context must be an object');
  }

  for (const field of Object.keys(input)) {
    if (!CALLER_FIELDS.includes(field)) {
      fail('invalid_input', `unknown event field: ${field}`);
    }
  }
  for (const field of Object.keys(context)) {
    if (!CONTEXT_FIELDS.includes(field)) {
      fail('invalid_input', `unknown run-context field: ${field}`);
    }
  }

  const runId = requireIdentifier(context.run_id, 'run_id');
  const rootSkill = requireIdentifier(context.root_skill, 'root_skill');
  const skill = requireIdentifier(input.skill ?? context.root_skill, 'skill');
  const eventName = requireIdentifier(input.event, 'event');

  if (!PHASES.includes(input.phase)) {
    fail('invalid_input', `phase must be one of ${PHASES.join(', ')}`);
  }

  const summaryInput = requireCleanText(input.summary, 'summary');
  const bounded = boundText(summaryInput, MAX_SUMMARY_BYTES);
  let truncated = bounded.truncated;

  const event = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    root_skill: rootSkill,
    skill,
    timestamp: now.toISOString(),
    event: eventName,
    phase: input.phase,
    summary: bounded.text,
  };

  if (input.operation !== undefined && input.operation !== null && input.operation !== '') {
    event.operation = requireIdentifier(input.operation, 'operation');
  }
  if (input.outcome !== undefined && input.outcome !== null && input.outcome !== '') {
    event.outcome = requireIdentifier(input.outcome, 'outcome');
  }

  if (input.evidence !== undefined && input.evidence !== null) {
    if (!Array.isArray(input.evidence)) {
      fail('invalid_input', 'evidence must be an array of short references');
    }
    const references = [];
    for (const item of input.evidence.slice(0, MAX_EVIDENCE_ITEMS)) {
      const reference = requireCleanText(item, 'evidence reference');
      const boundedReference = boundText(reference, MAX_REFERENCE_BYTES);
      truncated = truncated || boundedReference.truncated;
      references.push(boundedReference.text);
    }
    if (input.evidence.length > MAX_EVIDENCE_ITEMS) {
      truncated = true;
    }
    if (references.length > 0) {
      event.evidence = references;
    }
  }

  if (truncated) {
    event.truncated = true;
  }

  const line = JSON.stringify(event);
  if (byteLength(line) > MAX_EVENT_BYTES) {
    // Defense in depth. Every individual bound is chosen so a valid event
    // stays well under this limit, so this branch is not reachable from
    // `emitEvent`; it guards against a future bound being raised carelessly.
    fail('event_too_large', `event exceeds ${MAX_EVENT_BYTES} bytes`);
  }
  return event;
}

/** Validates a persisted event read back from a log, including its bounds. */
export function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return 'record is not an object';
  }
  for (const field of Object.keys(event)) {
    if (!EVENT_FIELDS.includes(field)) {
      return `unknown field: ${field}`;
    }
  }
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(event.schema_version)) {
    return `unsupported schema_version: ${String(event.schema_version)}`;
  }
  if (event.schema_version >= 2 && 'sequence' in event) {
    return 'sequence is not recorded from schema version 2';
  }
  for (const field of ['run_id', 'root_skill', 'skill', 'event']) {
    if (typeof event[field] !== 'string' || !IDENTIFIER_PATTERN.test(event[field])) {
      return `invalid ${field}`;
    }
    if (byteLength(event[field]) > MAX_IDENTIFIER_BYTES) {
      return `${field} exceeds ${MAX_IDENTIFIER_BYTES} bytes`;
    }
  }
  for (const field of ['operation', 'outcome']) {
    if (field in event) {
      if (typeof event[field] !== 'string' || !IDENTIFIER_PATTERN.test(event[field])) {
        return `invalid ${field}`;
      }
      if (byteLength(event[field]) > MAX_IDENTIFIER_BYTES) {
        return `${field} exceeds ${MAX_IDENTIFIER_BYTES} bytes`;
      }
    }
  }
  if (!PHASES.includes(event.phase)) {
    return 'invalid phase';
  }
  if (typeof event.summary !== 'string' || event.summary.length === 0) {
    return 'invalid summary';
  }
  if (byteLength(event.summary) > MAX_SUMMARY_BYTES) {
    return `summary exceeds ${MAX_SUMMARY_BYTES} bytes`;
  }
  if (CONTROL_CHARACTER_PATTERN.test(event.summary)) {
    return 'summary contains control characters';
  }
  if (typeof event.timestamp !== 'string' || Number.isNaN(Date.parse(event.timestamp))) {
    return 'invalid timestamp';
  }
  if ('evidence' in event) {
    if (!Array.isArray(event.evidence) || !event.evidence.every((item) => typeof item === 'string')) {
      return 'invalid evidence';
    }
    if (event.evidence.length > MAX_EVIDENCE_ITEMS) {
      return `evidence exceeds ${MAX_EVIDENCE_ITEMS} references`;
    }
    if (event.evidence.some((item) => byteLength(item) > MAX_REFERENCE_BYTES)) {
      return `an evidence reference exceeds ${MAX_REFERENCE_BYTES} bytes`;
    }
  }
  if ('truncated' in event && event.truncated !== true) {
    return 'invalid truncated flag';
  }
  if (byteLength(JSON.stringify(event)) > MAX_EVENT_BYTES) {
    return `record exceeds ${MAX_EVENT_BYTES} bytes`;
  }
  return null;
}

/**
 * Rejects a target that is not a Skill Run Log, so a mistyped path cannot
 * append to an unrelated file or write through a symbolic link.
 */
function assertUsableLogTarget(logPath) {
  if (!logPath.endsWith('.jsonl')) {
    fail('invalid_input', 'log_path must name a .jsonl Skill Run Log');
  }

  let stats;
  try {
    stats = fs.lstatSync(logPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    fail('log_unavailable', `cannot inspect the Skill Run Log: ${error.message}`);
  }

  if (stats.isSymbolicLink()) {
    fail('invalid_input', 'log_path must not be a symbolic link');
  }
  if (!stats.isFile()) {
    fail('invalid_input', 'log_path must be a regular file');
  }
  if (stats.size === 0) {
    return;
  }

  let head;
  try {
    const handle = fs.openSync(logPath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stats.size, MAX_EVENT_BYTES));
      const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
      head = buffer.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(handle);
    }
  } catch (error) {
    fail('log_unavailable', `cannot read the Skill Run Log: ${error.message}`);
  }

  const firstLine = head.split('\n', 1)[0].trim();
  let parsed = null;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    parsed = null;
  }
  if (!parsed
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || !SUPPORTED_SCHEMA_VERSIONS.includes(parsed.schema_version)) {
    fail('invalid_input', 'log_path is not a Skill Run Log');
  }
}

/** True when the log exists, is not empty, and does not end with a newline. */
function needsSeparator(logPath) {
  let handle;
  try {
    handle = fs.openSync(logPath, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  try {
    const { size } = fs.fstatSync(handle);
    if (size === 0) {
      return false;
    }
    const buffer = Buffer.alloc(1);
    fs.readSync(handle, buffer, 0, 1, size - 1);
    return buffer[0] !== 0x0A;
  } finally {
    fs.closeSync(handle);
  }
}

/**
 * Appends one event to the Skill Run Log. Recording is best effort: a caller
 * that receives a ChronicleError reports it, marks evidence incomplete, and
 * continues delivery.
 */
export function emitEvent(input, context, options = {}) {
  const logPath = context?.log_path;
  if (typeof logPath !== 'string' || !path.isAbsolute(logPath)) {
    fail('invalid_input', 'log_path must be an absolute path');
  }

  // Validate caller input before touching the filesystem, so a rejected event
  // leaves no directory or file behind.
  const event = buildEvent(input, context, options.now);

  assertUsableLogTarget(logPath);

  let separator;
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    // A previous writer that stopped mid-record leaves no trailing newline.
    // Without this separator the next append would concatenate onto that torn
    // line and destroy both records while still reporting success.
    separator = needsSeparator(logPath) ? '\n' : '';
  } catch (error) {
    fail('log_unavailable', `cannot prepare the Skill Run Log: ${error.message}`);
  }

  try {
    fs.appendFileSync(logPath, `${separator}${JSON.stringify(event)}\n`, { encoding: 'utf8' });
  } catch (error) {
    fail('append_failed', `cannot append to the Skill Run Log: ${error.message}`);
  }
  return event;
}

/**
 * Reconstructs Skill Run State from one explicitly selected log. Replay never
 * repairs, reorders, or invents evidence; every problem becomes a defect.
 */
export function replayLog(logPath, options = {}) {
  let contents;
  try {
    contents = fs.readFileSync(logPath, 'utf8');
  } catch (error) {
    fail('log_unavailable', `cannot read the selected Skill Run Log: ${error.message}`);
  }

  const logId = options.logId ?? logPath;
  if (typeof logId !== 'string'
    || logId.length === 0
    || byteLength(logId) > MAX_REFERENCE_BYTES
    || CONTROL_CHARACTER_PATTERN.test(logId)) {
    fail('invalid_input', `log id must be clean text of at most ${MAX_REFERENCE_BYTES} bytes`);
  }

  const defects = [];
  const events = [];
  const lines = contents.split('\n');

  let runId = null;
  let rootSkill = null;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    const anchor = `L${index + 1}`;
    if (line.length === 0) {
      if (index < lines.length - 1) {
        defects.push({ type: 'blank_record', anchor, detail: 'blank line inside the log' });
      }
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      defects.push({ type: 'malformed_record', anchor, detail: 'record is not valid JSON' });
      return;
    }

    const problem = validateEvent(parsed);
    if (problem) {
      defects.push({ type: 'invalid_record', anchor, detail: problem });
      return;
    }

    if (runId === null) {
      runId = parsed.run_id;
      rootSkill = parsed.root_skill;
    } else if (parsed.run_id !== runId) {
      defects.push({
        type: 'foreign_run',
        anchor,
        detail: `record belongs to run ${parsed.run_id}, not ${runId}`,
      });
      return;
    } else if (parsed.root_skill !== rootSkill) {
      defects.push({
        type: 'run_identity_drift',
        anchor,
        detail: `run ${runId} changes root skill from ${rootSkill} to ${parsed.root_skill}`,
      });
      return;
    }

    const { sequence: _legacySequence, ...record } = parsed;
    // Physical log position is the only ordering, and it backs the L anchors.
    events.push({ ...record, sequence: events.length + 1, anchor, line: index + 1 });
  });

  const operations = new Map();
  for (const event of events) {
    // Only intent and outcome define an operation. An observation that merely
    // references an operation must not create a phantom entry.
    if (!event.operation || event.phase === 'observation') {
      continue;
    }
    const entry = operations.get(event.operation) ?? {
      operation: event.operation,
      skill: event.skill,
      started: null,
      completed: null,
      outcome: null,
    };
    if (event.phase === 'before') {
      if (entry.started !== null) {
        defects.push({
          type: 'duplicate_operation_start',
          anchor: event.anchor,
          detail: `operation ${event.operation} starts more than once`,
        });
      } else if (entry.completed !== null) {
        defects.push({
          type: 'operation_out_of_order',
          anchor: event.anchor,
          detail: `operation ${event.operation} records intent after its outcome at ${entry.completed}`,
        });
      }
      entry.started = entry.started ?? event.anchor;
    } else if (event.phase === 'after') {
      if (entry.completed !== null) {
        defects.push({
          type: 'duplicate_operation_outcome',
          anchor: event.anchor,
          detail: `operation ${event.operation} records an outcome more than once`,
        });
      } else {
        entry.completed = event.anchor;
        entry.outcome = event.outcome ?? null;
      }
    }
    operations.set(event.operation, entry);
  }

  for (const entry of operations.values()) {
    if (entry.started && !entry.completed) {
      defects.push({
        type: 'incomplete_operation',
        anchor: entry.started,
        detail: `operation ${entry.operation} records intent with no outcome`,
      });
    } else if (!entry.started && entry.completed) {
      defects.push({
        type: 'unmatched_outcome',
        anchor: entry.completed,
        detail: `operation ${entry.operation} records an outcome with no intent`,
      });
    }
  }

  if (events.length === 0) {
    defects.push({ type: 'no_usable_records', anchor: 'L0', detail: 'the log holds no usable event' });
  }

  return {
    schema_version: SCHEMA_VERSION,
    log_id: logId,
    run_id: runId,
    root_skill: rootSkill,
    skills: [...new Set(events.map((event) => event.skill))].sort(),
    event_count: events.length,
    events,
    operations: [...operations.values()],
    defects,
    complete: defects.length === 0,
  };
}
