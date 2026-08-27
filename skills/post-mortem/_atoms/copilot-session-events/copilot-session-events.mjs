#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { redactText } from '../../../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

/**
 * Deterministic reader for one explicitly selected Copilot session log.
 *
 * A session log is raw runtime evidence: it records what the runtime observed,
 * not what a skill decided was worth recording. That makes it valuable and
 * dangerous in the same breath, because the same file also holds prompts, tool
 * output, and the full text of every skill that was loaded. So this reader
 * emits a bounded projection - identities, kinds, outcomes, and counts - and
 * never the content fields. A field reaches the result only by being named in
 * a handler below.
 *
 * Two properties matter more than convenience here:
 *
 * - **Selection is proved, not guessed.** A log is read when its identity is
 *   established: the operator named the file, the runtime named the file or the
 *   session, or discovery found exactly one session the operating system can
 *   still prove is running. Nothing here sorts by modification time or treats
 *   the newest file as the current session, and an ambiguous root is refused
 *   rather than resolved.
 * - **Damage is reported, never repaired.** A torn line, an unknown event, a
 *   drifted schema, or an unfinished session becomes a stated limitation. The
 *   reader never reorders, back-fills, or infers a record it did not read.
 */

export class SessionEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SessionEvidenceError';
    this.code = code;
  }
}

export const EXIT_READ = 0;
export const EXIT_REFUSED = 1;

/** Bounds. Every one of them is reported when it binds, never silently applied. */
export const DEFAULT_MAX_EVENTS = 200;
export const DEFAULT_MAX_NOTES = 100;
export const DEFAULT_MAX_LINES = 500_000;
export const MAX_RECORD_BYTES = 1_048_576;
export const MAX_FIELD_CHARS = 120;
const READ_CHUNK_BYTES = 262_144;

/** Bounds the discovery scan, so a session root that grew without limit fails loudly. */
export const MAX_SCANNED_SESSIONS = 5_000;
const MAX_ANCESTOR_DEPTH = 32;
const IN_USE_LOCK = /^inuse\.(\d+)\.lock$/;
const SESSION_LOG_NAME = 'events.jsonl';

/**
 * How the identity of a selected log was established, strongest first. The kind
 * travels with the evidence, because "the operator named this file" and
 * "one session was still running" are different grades of proof and a reader of
 * the post-mortem is entitled to know which one it got.
 */
export const IDENTITY_KINDS = [
  'explicit-path',
  'runtime-transcript',
  'session-id',
  'live-process-lock',
  'sole-live-session',
];

/**
 * The event vocabulary this reader understands. A type outside this set is
 * counted and reported as unrecognized rather than guessed at, because a
 * runtime that adds an event is a schema change, not a defect in the log.
 */
export const SUPPORTED_EVENT_TYPES = [
  'abort',
  'assistant.message',
  'assistant.turn_end',
  'assistant.turn_start',
  'hook.end',
  'hook.start',
  'permission.completed',
  'permission.requested',
  'session.auto_mode_resolved',
  'session.compaction_complete',
  'session.compaction_start',
  'session.context_changed',
  'session.error',
  'session.info',
  'session.model_change',
  'session.permissions_changed',
  'session.plan_changed',
  'session.resume',
  'session.shutdown',
  'session.start',
  'session.usage_checkpoint',
  'session.warning',
  'session.workspace_file_changed',
  'skill.invoked',
  'subagent.completed',
  'subagent.failed',
  'subagent.started',
  'system.message',
  'system.notification',
  'tool.execution_complete',
  'tool.execution_start',
  'user.message',
];

const SUPPORTED = new Set(SUPPORTED_EVENT_TYPES);

function anchorFor(line) {
  return `E${line}`;
}

/**
 * The only way a string from the log reaches the result. Control characters go,
 * whitespace collapses, the value is cut to a bound, and the shared redaction
 * floor runs last, so a value that turns out to carry a secret is marked rather
 * than published.
 */
function safeString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const collapsed = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return null;
  }
  return redactText(collapsed.slice(0, MAX_FIELD_CHARS)).text;
}

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function at(record, dottedPath) {
  let cursor = record;
  for (const key of dottedPath.split('.')) {
    if (cursor === null || typeof cursor !== 'object' || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = cursor[key];
  }
  return cursor;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unavailable(code, detail, extra = {}) {
  return { status: 'unavailable', reason: { code, detail }, ...extra };
}

function selected(logPath, identity, notes = []) {
  return { status: 'selected', path: logPath, identity, notes };
}

/** A process the operating system still knows about, including one we may not signal. */
export function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * The current process and its ancestors. A session lock held by one of them is
 * this session, which is the only identity claim discovery is allowed to make
 * on its own. Where the lineage cannot be read - an unsupported platform, a
 * missing `ps` - the list is short and discovery falls through to the stricter
 * single-session rule rather than guessing.
 */
export function defaultAncestorPids(startPid = process.pid) {
  const lineage = [startPid];
  if (process.platform === 'win32') {
    return lineage;
  }
  let current = startPid;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH; depth += 1) {
    let parent;
    try {
      parent = Number.parseInt(
        execFileSync('ps', ['-o', 'ppid=', '-p', String(current)], { encoding: 'utf8' }).trim(),
        10,
      );
    } catch {
      return lineage;
    }
    if (!Number.isInteger(parent) || parent <= 1 || lineage.includes(parent)) {
      return lineage;
    }
    lineage.push(parent);
    current = parent;
  }
  return lineage;
}

function sessionRootFrom(stateRoot, environment) {
  if (typeof stateRoot === 'string' && stateRoot.trim() !== '') {
    return stateRoot;
  }
  const configured = environment.COPILOT_SESSION_STATE_ROOT;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured;
  }
  const home = environment.COPILOT_HOME;
  if (typeof home === 'string' && home.trim() !== '') {
    return path.join(home, 'session-state');
  }
  return null;
}

function isReadableFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Every session under the root that the operating system can still prove is
 * running, by way of an in-use lock naming a live process. A stale lock, a
 * session with no log, and a directory that cannot be read are all simply not
 * candidates: this function never ranks, and never breaks a tie.
 */
function liveSessions(root, isAlive, maxSessions) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { error: 'session_root_unreadable', candidates: [] };
  }
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length > maxSessions) {
    return { error: 'session_root_too_large', candidates: [], scanned: directories.length };
  }

  const candidates = [];
  for (const directory of directories) {
    const sessionDirectory = path.join(root, directory.name);
    let files;
    try {
      files = fs.readdirSync(sessionDirectory);
    } catch {
      continue;
    }
    const logPath = path.join(sessionDirectory, SESSION_LOG_NAME);
    for (const file of files) {
      const match = IN_USE_LOCK.exec(file);
      if (!match) {
        continue;
      }
      const pid = Number.parseInt(match[1], 10);
      if (!Number.isInteger(pid) || !isAlive(pid) || !isReadableFile(logPath)) {
        continue;
      }
      candidates.push({ sessionId: directory.name, pid, path: logPath });
    }
  }
  return { error: null, candidates: candidates.sort((a, b) => a.sessionId.localeCompare(b.sessionId)) };
}

/**
 * Decides which session log, if any, may be read, and refuses when identity
 * cannot be established. Refusal is the designed outcome, not a failure: the
 * post-mortem records the reason and continues on the session it can see.
 */
export function resolveSessionSelection({
  explicitPath = null,
  transcriptPath = null,
  sessionId = null,
  stateRoot = null,
  environment = process.env,
  isAlive = defaultIsAlive,
  ancestorPids = defaultAncestorPids,
  maxSessions = MAX_SCANNED_SESSIONS,
} = {}) {
  if (typeof explicitPath === 'string' && explicitPath.trim() !== '') {
    return selected(explicitPath, { kind: 'explicit-path', session_id: null, pid: null });
  }

  if (typeof transcriptPath === 'string' && transcriptPath.trim() !== '') {
    if (!isReadableFile(transcriptPath)) {
      return unavailable(
        'runtime_transcript_missing',
        'the runtime named a transcript that is not a readable file',
      );
    }
    return selected(transcriptPath, { kind: 'runtime-transcript', session_id: null, pid: null });
  }

  const root = sessionRootFrom(stateRoot, environment);

  if (typeof sessionId === 'string' && sessionId.trim() !== '') {
    if (root === null) {
      return unavailable(
        'session_root_unknown',
        'a session identifier was supplied but no session root is known',
      );
    }
    if (sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
      return unavailable('session_id_invalid', 'a session identifier names one directory');
    }
    const logPath = path.join(root, sessionId, SESSION_LOG_NAME);
    if (!isReadableFile(logPath)) {
      return unavailable(
        'session_id_not_found',
        'the supplied session identifier has no readable log under the session root',
      );
    }
    return selected(logPath, { kind: 'session-id', session_id: sessionId, pid: null });
  }

  if (root === null) {
    return unavailable(
      'session_root_unknown',
      'no session root was supplied and the runtime named none',
    );
  }

  const { error, candidates, scanned } = liveSessions(root, isAlive, maxSessions);
  if (error) {
    return unavailable(
      error,
      error === 'session_root_too_large'
        ? `the session root holds more than ${maxSessions} sessions (${scanned})`
        : 'the session root could not be read',
      { candidates: 0 },
    );
  }

  const lineage = new Set(ancestorPids());
  const mine = candidates.filter((candidate) => lineage.has(candidate.pid));
  if (mine.length === 1) {
    return selected(mine[0].path, {
      kind: 'live-process-lock',
      session_id: mine[0].sessionId,
      pid: mine[0].pid,
    });
  }
  if (mine.length > 1) {
    return unavailable(
      'session_identity_ambiguous',
      `${mine.length} live sessions are held by this process lineage`,
      { candidates: mine.length },
    );
  }
  if (candidates.length === 1) {
    return selected(
      candidates[0].path,
      { kind: 'sole-live-session', session_id: candidates[0].sessionId, pid: candidates[0].pid },
      [
        {
          code: 'session_identity_from_sole_live_session',
          detail: 'identity rests on this being the only running session, not on process lineage',
        },
      ],
    );
  }
  if (candidates.length === 0) {
    return unavailable(
      'session_identity_unavailable',
      'no running session could be proved under the session root',
      { candidates: 0 },
    );
  }
  return unavailable(
    'session_identity_ambiguous',
    `${candidates.length} sessions are running and none is provably this one`,
    { candidates: candidates.length },
  );
}

class Notes {
  constructor(maxNotes) {
    this.maxNotes = maxNotes;
    this.entries = [];
    this.exhausted = false;
    this.seen = new Set();
  }

  add(code, anchor, detail, dedupeKey = null) {
    if (dedupeKey !== null) {
      if (this.seen.has(dedupeKey)) {
        return;
      }
      this.seen.add(dedupeKey);
    }
    if (this.entries.length >= this.maxNotes) {
      if (!this.exhausted) {
        this.exhausted = true;
        this.entries.push({
          code: 'limitation_budget_exhausted',
          anchor: null,
          detail: `more than ${this.maxNotes} limitations were found; later ones are not listed`,
        });
      }
      return;
    }
    this.entries.push({ code, anchor, detail });
  }
}

/**
 * Field handlers. Each names the fields this reader depends on, which is what
 * drives schema-drift reporting: a known event that no longer carries a field
 * is a stated drift, not an exception and not a substituted default.
 */
const HANDLERS = new Map([
  ['session.start', ['data.sessionId']],
  ['session.shutdown', ['data.shutdownType']],
  ['session.warning', ['data.warningType']],
  ['session.error', ['data.errorType']],
  ['assistant.turn_start', ['data.turnId']],
  ['assistant.turn_end', ['data.turnId']],
  ['tool.execution_start', ['data.toolCallId', 'data.toolName']],
  ['tool.execution_complete', ['data.toolCallId', 'data.success']],
  ['subagent.started', ['data.toolCallId', 'data.agentName']],
  ['subagent.completed', ['data.toolCallId']],
  ['subagent.failed', ['data.toolCallId']],
  ['skill.invoked', ['data.name']],
  ['permission.completed', ['data.result.kind']],
]);

function reportDrift(notes, type, record, anchor) {
  for (const field of HANDLERS.get(type) ?? []) {
    if (at(record, field) === undefined) {
      notes.add('schema_drift', anchor, `${type} is missing ${field}`, `drift:${type}:${field}`);
    }
  }
}

class Projection {
  constructor(maxEvents) {
    this.maxEvents = maxEvents;
    this.events = [];
    this.exhausted = false;
  }

  push(event) {
    if (this.events.length >= this.maxEvents) {
      this.exhausted = true;
      return;
    }
    this.events.push(event);
  }
}

/**
 * Reads a sequence of already-separated log lines. `endsWithNewline` is the
 * difference between a session that was still being written and a file whose
 * last record is simply the last record, so the caller supplies it rather than
 * letting this function guess.
 */
export function extractSessionEvidence({
  lines,
  logId = null,
  endsWithNewline = true,
  maxEvents = DEFAULT_MAX_EVENTS,
  maxNotes = DEFAULT_MAX_NOTES,
  budgetExhausted = null,
} = {}) {
  if (lines === undefined || lines === null) {
    throw new SessionEvidenceError('no_selection', 'no session log was selected');
  }

  const notes = new Notes(maxNotes);
  const projection = new Projection(maxEvents);
  const byType = new Map();

  const openTurns = new Map();
  const openTools = new Map();
  const openSubagents = new Map();
  const subagentStack = [];

  const turns = { started: 0, completed: 0, incomplete: [], repeated: [] };
  const tools = {
    calls: 0,
    completions: 0,
    failures: 0,
    by_tool: {},
    failure_anchors: [],
    incomplete: [],
  };
  const subagents = { started: 0, completed: 0, failed: 0, spans: [] };
  const skills = { count: 0, invocations: [] };
  const messages = { operator: 0, agent: 0 };
  let sessionErrors = 0;

  let sessionId = null;
  let producer = null;
  let firstTimestamp = null;
  let lastTimestamp = null;
  let usableRecords = 0;
  let sawStart = false;
  let sawShutdown = false;
  let sawAbort = false;
  let sawCompaction = false;

  const materialize = (anchor, type, timestamp, fields) => {
    projection.push({ anchor, type, timestamp, ...fields });
  };

  const allLines = [...lines];
  for (const [index, rawLine] of allLines.entries()) {
    const anchor = anchorFor(index + 1);
    const isFinalLine = index === allLines.length - 1;
    const entry = typeof rawLine === 'string' ? { text: rawLine, oversized: false } : rawLine;
    if (entry.oversized) {
      notes.add(
        'oversized_record',
        anchor,
        `the record exceeded ${MAX_RECORD_BYTES} bytes and was not read`,
      );
      continue;
    }
    const line = entry.text.replace(/\r$/, '');

    if (line.trim() === '') {
      if (!(isFinalLine && !endsWithNewline)) {
        notes.add('blank_record', anchor, 'a blank line appears inside the log');
      }
      continue;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      if (isFinalLine && !endsWithNewline) {
        notes.add('torn_final_record', anchor, 'the last record was still being written');
      } else {
        notes.add('malformed_record', anchor, 'the line is not valid JSON');
      }
      continue;
    }

    if (!isPlainObject(record) || typeof record.type !== 'string') {
      notes.add('invalid_record', anchor, 'the record carries no event type');
      continue;
    }

    const { type } = record;
    byType.set(type, (byType.get(type) ?? 0) + 1);
    usableRecords += 1;

    const timestamp = safeString(record.timestamp);
    if (timestamp) {
      firstTimestamp ??= timestamp;
      lastTimestamp = timestamp;
    }

    if (!SUPPORTED.has(type)) {
      notes.add(
        'unrecognized_event',
        anchor,
        `unsupported event type ${safeString(type) ?? 'unnamed'}`,
        `unknown:${type}`,
      );
      continue;
    }

    reportDrift(notes, type, record, anchor);
    const enclosingSubagent = subagentStack.length
      ? subagentStack[subagentStack.length - 1].agent
      : null;

    switch (type) {
      case 'session.start': {
        const observed = safeString(at(record, 'data.sessionId'));
        if (sawStart && observed && sessionId && observed !== sessionId) {
          notes.add('foreign_session', anchor, 'a second session identity appears in this log');
        }
        sawStart = true;
        sessionId ??= observed;
        producer ??= safeString(at(record, 'data.producer'));
        materialize(anchor, type, timestamp, { session_id: observed });
        break;
      }
      case 'session.resume': {
        materialize(anchor, type, timestamp, {});
        break;
      }
      case 'session.shutdown': {
        sawShutdown = true;
        materialize(anchor, type, timestamp, {
          shutdown_type: safeString(at(record, 'data.shutdownType')),
        });
        break;
      }
      case 'session.compaction_start':
      case 'session.compaction_complete': {
        sawCompaction = true;
        materialize(anchor, type, timestamp, {});
        break;
      }
      case 'abort': {
        sawAbort = true;
        materialize(anchor, type, timestamp, { reason: safeString(at(record, 'data.reason')) });
        break;
      }
      case 'session.warning': {
        materialize(anchor, type, timestamp, {
          warning_type: safeString(at(record, 'data.warningType')),
        });
        break;
      }
      case 'session.error': {
        sessionErrors += 1;
        materialize(anchor, type, timestamp, {
          error_type: safeString(at(record, 'data.errorType')),
          status_code: typeof at(record, 'data.statusCode') === 'number'
            ? at(record, 'data.statusCode')
            : null,
        });
        break;
      }
      case 'user.message': {
        messages.operator += 1;
        break;
      }
      case 'assistant.message': {
        messages.agent += 1;
        break;
      }
      case 'assistant.turn_start': {
        const turnId = safeString(at(record, 'data.turnId'));
        turns.started += 1;
        if (turnId !== null) {
          if (openTurns.has(turnId)) {
            turns.repeated.push(anchor);
            notes.add('duplicate_turn_start', anchor, 'a turn records its start more than once');
          } else {
            openTurns.set(turnId, anchor);
          }
        }
        break;
      }
      case 'assistant.turn_end': {
        const turnId = safeString(at(record, 'data.turnId'));
        turns.completed += 1;
        if (turnId !== null) {
          if (openTurns.has(turnId)) {
            openTurns.delete(turnId);
          } else {
            notes.add('unmatched_turn_end', anchor, 'a turn ends without a recorded start');
          }
        }
        break;
      }
      case 'tool.execution_start': {
        const toolCallId = safeString(at(record, 'data.toolCallId'));
        const toolName = safeString(at(record, 'data.toolName')) ?? 'unnamed';
        tools.calls += 1;
        tools.by_tool[toolName] = (tools.by_tool[toolName] ?? 0) + 1;
        if (toolCallId !== null) {
          openTools.set(toolCallId, { anchor, toolName });
        }
        break;
      }
      case 'tool.execution_complete': {
        const toolCallId = safeString(at(record, 'data.toolCallId'));
        const success = safeBoolean(at(record, 'data.success'));
        tools.completions += 1;
        const opened = toolCallId === null ? null : openTools.get(toolCallId) ?? null;
        if (toolCallId !== null) {
          if (opened) {
            openTools.delete(toolCallId);
          } else {
            notes.add('unmatched_tool_completion', anchor, 'a tool result has no recorded request');
          }
        }
        if (success === false) {
          tools.failures += 1;
          if (tools.failure_anchors.length < maxEvents) {
            tools.failure_anchors.push(anchor);
          }
          materialize(anchor, type, timestamp, {
            tool_name: opened?.toolName ?? null,
            success: false,
            request_anchor: opened?.anchor ?? null,
          });
        }
        break;
      }
      case 'subagent.started': {
        const toolCallId = safeString(at(record, 'data.toolCallId'));
        const agent = safeString(at(record, 'data.agentName')) ?? 'unnamed';
        subagents.started += 1;
        const span = { anchor, agent, completed_anchor: null, outcome: null };
        if (subagents.spans.length < maxEvents) {
          subagents.spans.push(span);
        }
        if (toolCallId !== null) {
          openSubagents.set(toolCallId, span);
        }
        subagentStack.push({ toolCallId, agent, span });
        materialize(anchor, type, timestamp, { agent, within_subagent: enclosingSubagent });
        break;
      }
      case 'subagent.completed':
      case 'subagent.failed': {
        const toolCallId = safeString(at(record, 'data.toolCallId'));
        const outcome = type === 'subagent.failed' ? 'failed' : 'completed';
        if (outcome === 'failed') {
          subagents.failed += 1;
        } else {
          subagents.completed += 1;
        }
        const span = toolCallId === null ? null : openSubagents.get(toolCallId) ?? null;
        if (span) {
          span.completed_anchor = anchor;
          span.outcome = outcome;
          openSubagents.delete(toolCallId);
        } else {
          notes.add(
            'unmatched_subagent_completion',
            anchor,
            'a subagent ends without a recorded start',
          );
        }
        const stackIndex = subagentStack.findIndex((entry) => entry.toolCallId === toolCallId);
        if (stackIndex !== -1) {
          subagentStack.splice(stackIndex, 1);
        }
        materialize(anchor, type, timestamp, {
          agent: safeString(at(record, 'data.agentName')),
          start_anchor: span?.anchor ?? null,
          outcome,
        });
        break;
      }
      case 'skill.invoked': {
        const invocation = {
          anchor,
          name: safeString(at(record, 'data.name')) ?? 'unnamed',
          source: safeString(at(record, 'data.source')),
          trigger: safeString(at(record, 'data.trigger')),
          within_subagent: enclosingSubagent,
        };
        skills.count += 1;
        if (skills.invocations.length < maxEvents) {
          skills.invocations.push(invocation);
        }
        materialize(anchor, type, timestamp, {
          name: invocation.name,
          source: invocation.source,
          trigger: invocation.trigger,
          within_subagent: invocation.within_subagent,
        });
        break;
      }
      case 'permission.completed': {
        const outcome = safeString(at(record, 'data.result.kind'));
        if (outcome !== null && outcome !== 'allow' && outcome !== 'allowed') {
          materialize(anchor, type, timestamp, { outcome });
        }
        break;
      }
      default:
        break;
    }
  }

  for (const anchor of openTurns.values()) {
    turns.incomplete.push(anchor);
    notes.add('incomplete_turn', anchor, 'a turn starts and never ends in this log');
  }
  for (const opened of openTools.values()) {
    tools.incomplete.push(opened.anchor);
    notes.add('incomplete_tool_call', opened.anchor, 'a tool request records no result');
  }
  for (const span of openSubagents.values()) {
    notes.add('incomplete_subagent', span.anchor, 'a subagent starts and never completes in this log');
  }

  if (projection.exhausted) {
    notes.add(
      'event_budget_exhausted',
      null,
      `more than ${maxEvents} material events were found; later ones are counted but not listed`,
    );
  }
  if (budgetExhausted) {
    notes.add(budgetExhausted.code, null, budgetExhausted.detail);
  }
  if (usableRecords === 0) {
    notes.add('no_usable_records', null, 'the selection holds no usable event');
  } else {
    if (!sawStart) {
      notes.add('session_start_absent', null, 'the selection does not begin at a session start');
    }
    if (!sawShutdown) {
      notes.add('session_incomplete', null, 'the session records no shutdown');
    }
    if (sawAbort) {
      notes.add('session_aborted', null, 'the session records an abort');
    }
    if (sawCompaction) {
      notes.add('context_compacted', null, 'the session compacted its context');
    }
  }

  const completeness = sawCompaction
    ? 'compacted'
    : (notes.entries.length === 0 ? 'complete' : 'partial');

  return {
    log_id: logId,
    session_id: sessionId,
    producer,
    first_timestamp: firstTimestamp,
    last_timestamp: lastTimestamp,
    lines_read: allLines.length,
    usable_records: usableRecords,
    counts: {
      by_type: Object.fromEntries([...byType.entries()].sort(([a], [b]) => a.localeCompare(b))),
      operator_messages: messages.operator,
      agent_messages: messages.agent,
      tool_calls: tools.calls,
      tool_failures: tools.failures,
      subagent_calls: subagents.started,
      subagent_failures: subagents.failed,
      session_errors: sessionErrors,
      skill_invocations: skills.count,
      turns_started: turns.started,
      turns_completed: turns.completed,
    },
    turns,
    tools,
    subagents,
    skills,
    events: projection.events,
    limitations: notes.entries,
    evidence_completeness: completeness,
    confidence_cap: completeness === 'complete' ? 'none' : 'moderate',
  };
}

export function extractSessionEvidenceFromText(text, options = {}) {
  if (typeof text !== 'string') {
    throw new SessionEvidenceError('no_selection', 'no session log content was supplied');
  }
  const endsWithNewline = text === '' || text.endsWith('\n');
  const body = endsWithNewline ? text.slice(0, Math.max(text.length - 1, 0)) : text;
  return extractSessionEvidence({
    ...options,
    lines: body === '' ? [] : body.split('\n'),
    endsWithNewline,
  });
}

/**
 * Streams one selected file into separated lines without holding it in memory.
 * A Copilot session log is routinely hundreds of megabytes, so reading it whole
 * is not an option, and reading only its head would silently answer a question
 * about a session with a fact about its opening minutes.
 */
function* streamLines(fd, limits, state) {
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let remainder = '';
  let position = 0;
  let emitted = 0;
  let dropping = false;

  const emit = (value) => {
    emitted += 1;
    return value;
  };

  for (;;) {
    const bytes = fs.readSync(fd, buffer, 0, READ_CHUNK_BYTES, position);
    if (bytes === 0) {
      break;
    }
    position += bytes;
    remainder += buffer.toString('utf8', 0, bytes);

    let newline = remainder.indexOf('\n');
    while (newline !== -1) {
      const line = remainder.slice(0, newline);
      remainder = remainder.slice(newline + 1);
      if (emitted >= limits.maxLines) {
        state.budgetExhausted = {
          code: 'line_budget_exhausted',
          detail: `only the first ${limits.maxLines} records were read`,
        };
        state.endsWithNewline = true;
        return;
      }
      if (dropping) {
        dropping = false;
        yield emit({ text: '', oversized: true });
      } else if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
        yield emit({ text: '', oversized: true });
      } else {
        yield emit({ text: line, oversized: false });
      }
      newline = remainder.indexOf('\n');
    }

    // A record that outgrows the bound before its newline arrives is dropped
    // as it streams, so one pathological line cannot be held in memory. Its
    // line number is still emitted, because anchors are physical line numbers
    // and skipping one would silently renumber every record after it.
    if (Buffer.byteLength(remainder, 'utf8') > MAX_RECORD_BYTES) {
      dropping = true;
      remainder = '';
    }
  }

  if (dropping) {
    state.endsWithNewline = false;
    yield emit({ text: '', oversized: true });
    return;
  }
  if (remainder !== '') {
    state.endsWithNewline = false;
    yield emit({ text: remainder, oversized: false });
  }
}

/**
 * Reads one explicitly selected path. This function is the whole file-system
 * surface of the atom: it takes a path and refuses anything else. It never
 * lists a directory and never resolves a path the caller did not name.
 */
export function readSelectedSession(selectedPath, options = {}) {
  if (typeof selectedPath !== 'string' || selectedPath.trim() === '') {
    throw new SessionEvidenceError(
      'no_selection',
      'select one session log explicitly; this reader never searches for one',
    );
  }

  const resolved = path.resolve(selectedPath);
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch {
    throw new SessionEvidenceError(
      'unreadable_selection',
      `cannot read the selection: ${selectedPath}`,
    );
  }
  if (stats.isDirectory()) {
    throw new SessionEvidenceError(
      'not_a_file',
      'the selection is a directory; name the events.jsonl file itself',
    );
  }
  if (!stats.isFile()) {
    throw new SessionEvidenceError('not_a_file', 'the selection is not a regular file');
  }

  const limits = { maxLines: options.maxLines ?? DEFAULT_MAX_LINES };
  const state = { endsWithNewline: true, budgetExhausted: null };

  let fd;
  try {
    fd = fs.openSync(resolved, 'r');
  } catch {
    throw new SessionEvidenceError(
      'unreadable_selection',
      `cannot read the selection: ${selectedPath}`,
    );
  }

  try {
    const lines = [...streamLines(fd, limits, state)];
    return extractSessionEvidence({
      lines,
      logId: options.logId ?? selectedPath,
      endsWithNewline: state.endsWithNewline,
      maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
      maxNotes: options.maxNotes ?? DEFAULT_MAX_NOTES,
      budgetExhausted: state.budgetExhausted,
    });
  } finally {
    fs.closeSync(fd);
  }
}

export function parseArguments(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--probe') {
      options.probe = true;
      continue;
    }
    if (argument === '--resolve') {
      options.resolveOnly = true;
      continue;
    }
    if (
      argument === '--log-id'
      || argument === '--max-events'
      || argument === '--max-lines'
      || argument === '--session-id'
      || argument === '--session-root'
      || argument === '--transcript'
    ) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new SessionEvidenceError('usage', `${argument} requires a value`);
      }
      index += 1;
      if (argument === '--log-id') {
        options.logId = value;
      } else if (argument === '--session-id') {
        options.sessionId = value;
      } else if (argument === '--session-root') {
        options.stateRoot = value;
      } else if (argument === '--transcript') {
        options.transcriptPath = value;
      } else {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new SessionEvidenceError('usage', `${argument} requires a positive integer`);
        }
        options[argument === '--max-events' ? 'maxEvents' : 'maxLines'] = parsed;
      }
      continue;
    }
    if (argument.startsWith('--')) {
      throw new SessionEvidenceError(
        'usage',
        `unsupported option ${argument}; identity comes from a named path, a named session, or a proved live session`,
      );
    }
    positional.push(argument);
  }

  if (options.probe) {
    return { probe: true };
  }
  if (positional.length > 1) {
    throw new SessionEvidenceError('usage', 'select exactly one session log');
  }
  return { ...options, selectedPath: positional[0] ?? null };
}

function main(argv) {
  const parsed = parseArguments(argv);
  if (parsed.probe) {
    console.log('copilot-session-events: available');
    return EXIT_READ;
  }

  const resolution = resolveSessionSelection({
    explicitPath: parsed.selectedPath,
    transcriptPath: parsed.transcriptPath ?? null,
    sessionId: parsed.sessionId ?? null,
    stateRoot: parsed.stateRoot ?? null,
  });
  if (resolution.status !== 'selected') {
    throw new SessionEvidenceError(resolution.reason.code, resolution.reason.detail);
  }
  if (parsed.resolveOnly) {
    console.log(JSON.stringify(resolution, null, 2));
    return EXIT_READ;
  }

  const result = readSelectedSession(resolution.path, parsed);
  const logId = parsed.logId
    ?? (resolution.identity.session_id ? `session:${resolution.identity.session_id}` : resolution.path);
  console.log(JSON.stringify(
    { ...result, log_id: logId, identity: resolution.identity, identity_notes: resolution.notes },
    null,
    2,
  ));
  return EXIT_READ;
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
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    const code = error instanceof SessionEvidenceError ? error.code : 'failed';
    console.error(JSON.stringify({ error: { code, message: error.message } }));
    process.exitCode = EXIT_REFUSED;
  }
}
