#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
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
/**
 * A redaction marker is never split. Bounding a value that ends mid-marker
 * would publish `[REDACTED` - a string that says nothing was removed - so the
 * bound stretches by at most one marker to keep the statement intact.
 */
export const MAX_MARKER_CHARS = 32;
const PARTIAL_MARKER = /\[[A-Z]*:?[a-z-]*$/;
/**
 * How much of a value the redaction floor sees before the bound is applied.
 * Wider than the published bound so a secret that begins near the cut is still
 * recognized as a secret rather than truncated into an unrecognizable fragment.
 */
export const REDACT_INPUT_CHARS = 4_000;
const READ_CHUNK_BYTES = 262_144;

/**
 * Cardinality budgets. A log is untrusted input, so every collection built
 * from it is bounded: a session that invents ten thousand event types, or
 * leaves ten thousand operations open, must cost a bounded amount of memory
 * and produce a bounded record. Each budget reports itself when it binds.
 */
export const MAX_EVENT_TYPES = 100;
export const MAX_OPEN_OPERATIONS = 5_000;
export const MAX_ANCHOR_LIST = 200;
/** How many distinct tool names are named before the rest are counted together. */
export const MAX_TOOL_NAMES = 100;
/** How deep a nested subagent stack is tracked before nesting stops being claimed. */
export const MAX_SUBAGENT_DEPTH = 100;
/** Counted together when a tool name is unpublishable or past the budget. */
export const OTHER_TOOL_NAMES = 'other_tools';
/**
 * How many times one kind of limitation is listed before it is summarized.
 * A log with five thousand unfinished tool calls has one problem, not five
 * thousand, and listing each one would push every other limitation out of a
 * bounded record.
 */
export const MAX_NOTES_PER_CODE = 20;
/** Native counts fold into this bucket once the type budget is spent. */
export const OTHER_EVENT_TYPES = 'other_event_types';

/** The one shape test for "this string is a filesystem location". */
export function isPathShaped(value) {
  if (typeof value !== 'string') {
    return false;
  }
  return value.startsWith('/')
    || value.startsWith('\\')
    || value.startsWith('~/')
    || /^[A-Za-z]:[\\/]/.test(value)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    || value.includes('/../')
    || value.includes('\\..\\');
}

/**
 * A key that may be published as a native count. Anything else - a path, a
 * credential, a sentence, an unbounded identifier - folds into the opaque
 * bucket rather than reaching the record as a label an attacker chose.
 */
const SAFE_COUNT_KEY = /^[A-Za-z][A-Za-z0-9._-]{0,59}$/;

export function isPublishableCountKey(key) {
  return typeof key === 'string' && SAFE_COUNT_KEY.test(key) && !isPathShaped(key);
}

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
 * This adapter's native event types, mapped to the provider-neutral evidence
 * kinds every adapter emits. The neutral vocabulary is owned by the adapter
 * seam and deliberately not imported here: the seam holds the registry, so an
 * import back the other way would make the two units mutually dependent. The
 * seam's contract check is what proves this mapping stayed inside the
 * vocabulary.
 */
const NEUTRAL_KINDS = new Map([
  ['session.start', 'session_started'],
  ['session.resume', 'session_resumed'],
  ['session.shutdown', 'session_ended'],
  ['session.compaction_start', 'context_compaction_started'],
  ['session.compaction_complete', 'context_compaction_completed'],
  ['abort', 'session_aborted'],
  ['session.error', 'runtime_error'],
  ['session.warning', 'runtime_warning'],
  ['tool.execution_complete', 'tool_failure'],
  ['subagent.started', 'subagent_started'],
  ['subagent.completed', 'subagent_ended'],
  ['subagent.failed', 'subagent_ended'],
  ['skill.invoked', 'skill_invoked'],
  ['permission.completed', 'permission_denied'],
]);

/** The neutral detail fields an entry may carry. Everything else is dropped. */
const NEUTRAL_DETAIL_FIELDS = [
  'name',
  'source',
  'trigger',
  'agent',
  'outcome',
  'within_subagent',
  'start_anchor',
  'request_anchor',
  'tool_name',
  'error_type',
  'status_code',
  'shutdown_type',
  'warning_type',
  'reason',
  'session_id',
];

/**
 * The identifier a ledger publishes for its source. An absolute path is never
 * published: a post-mortem record is read by people who did not run the
 * session, and a machine path is both useless to them and more than they were
 * asked to be told. A session identity is the useful name; when there is none,
 * a digest still lets two readings of the same file be recognized as one.
 */
export function publishedLogId({ requestedLogId = null, sessionId = null, sourcePath = null }) {
  const requested = safeString(requestedLogId);
  if (requested !== null && !isPathShaped(requested)) {
    return requested;
  }
  const session = safeString(sessionId);
  if (session !== null) {
    return `session:${session}`;
  }
  const material = typeof sourcePath === 'string' && sourcePath !== ''
    ? sourcePath
    : String(requestedLogId ?? '');
  return `sha256:${createHash('sha256').update(material, 'utf8').digest('hex')}`;
}

/**
 * Projects this adapter's reading into the provider-neutral evidence ledger.
 * Diagnosis and rendering read the ledger, never this adapter's vocabulary, so
 * a second harness can be added without touching either of them.
 */
export function toEvidenceLedger(reading, resolution = null) {
  const entries = [];
  const limitations = [...reading.limitations];
  const unmapped = new Set();
  for (const event of reading.events) {
    const kind = NEUTRAL_KINDS.get(event.type);
    if (!kind) {
      // A materialized event with no neutral kind is a mapping gap in this
      // adapter. Dropping it silently would shrink the evidence without
      // telling anyone the ledger is missing something the log recorded.
      if (!unmapped.has(event.type)) {
        unmapped.add(event.type);
        limitations.push({
          code: 'unmapped_event',
          anchor: event.anchor,
          detail: `this adapter records ${event.type} but maps it to no neutral evidence kind`,
        });
      }
      continue;
    }
    const detail = {};
    let withheld = 0;
    for (const field of NEUTRAL_DETAIL_FIELDS) {
      const value = event[field];
      if (value === undefined || value === null) {
        continue;
      }
      // A detail value that turns out to be a filesystem location is withheld
      // rather than published, and withholding it costs one field instead of
      // the whole ledger.
      if (isPathShaped(value)) {
        withheld += 1;
        continue;
      }
      detail[field] = value;
    }
    if (withheld > 0) {
      limitations.push({
        code: 'detail_withheld',
        anchor: event.anchor,
        detail: `${withheld} detail field(s) held a filesystem path and were not published`,
      });
    }
    entries.push({ anchor: event.anchor, kind, at: event.timestamp ?? null, detail });
  }

  return {
    ledger_version: 1,
    provider: COPILOT_ADAPTER.id,
    harness: COPILOT_ADAPTER.id,
    source: {
      kind: 'session-log',
      log_id: reading.log_id,
      session_id: reading.session_id,
      identity: resolution?.identity ?? null,
      identity_notes: resolution?.notes ?? [],
    },
    completeness: reading.evidence_completeness,
    confidence_cap: reading.confidence_cap,
    counts: {
      operator_messages: reading.counts.operator_messages,
      agent_messages: reading.counts.agent_messages,
      turns_started: reading.counts.turns_started,
      turns_completed: reading.counts.turns_completed,
      tool_calls: reading.counts.tool_calls,
      tool_failures: reading.counts.tool_failures,
      subagent_calls: reading.counts.subagent_calls,
      subagent_failures: reading.counts.subagent_failures,
      skill_invocations: reading.counts.skill_invocations,
      runtime_errors: reading.counts.session_errors,
    },
    entries,
    skills: reading.skills.invocations,
    limitations,
    provider_native: { event_counts: publishableCounts(reading.counts.by_type) },
  };
}

/**
 * Folds raw event-type counts into publishable keys. An unrecognized type name
 * comes from the log, so it is a label chosen by whatever wrote the file; it is
 * counted, never reproduced, once it fails the key test or the budget.
 */
export function publishableCounts(byType) {
  const published = {};
  let folded = 0;
  for (const [key, count] of Object.entries(byType ?? {})) {
    if (key === OTHER_EVENT_TYPES) {
      // The reader may already have folded types into this bucket. Adding to it
      // rather than assigning keeps both foldings, instead of one erasing the
      // other and understating what the log held.
      folded += count;
      continue;
    }
    if (isPublishableCountKey(key) && Object.keys(published).length < MAX_EVENT_TYPES) {
      published[key] = count;
      continue;
    }
    folded += count;
  }
  if (folded > 0) {
    published[OTHER_EVENT_TYPES] = (published[OTHER_EVENT_TYPES] ?? 0) + folded;
  }
  return published;
}

/**
 * The adapter contract the seam calls: how this harness is recognized, how a
 * log is chosen for it, and how a reading becomes the common ledger.
 */
export const COPILOT_ADAPTER = {
  id: 'copilot',
  harnesses: ['copilot', 'copilot-cli', 'github-copilot', 'github-copilot-cli'],
  detect(environment = {}) {
    return ['COPILOT_SESSION_STATE_ROOT', 'COPILOT_HOME'].some(
      (name) => typeof environment[name] === 'string' && environment[name].trim() !== '',
    );
  },
  resolve(request = {}) {
    return resolveSessionSelection(request);
  },
  read(resolution, options = {}) {
    return toEvidenceLedger(
      readSelectedSession(resolution.path, {
        ...options,
        // The proved identity travels with the read, so the reading publishes
        // the identity that was established rather than the one the file claims.
        provenSessionId: resolution.identity?.session_id ?? null,
      }),
      resolution,
    );
  },
};

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
  // Redact first, then bound, then redact again. Bounding first can cut a
  // credential in half so the pattern no longer matches, which would publish
  // a fragment of the secret instead of a marker; redacting again catches a
  // marker the bound itself split.
  const redacted = redactText(collapsed.slice(0, REDACT_INPUT_CHARS)).text;
  if (redacted.length <= MAX_FIELD_CHARS) {
    return redacted;
  }
  let bounded = redacted.slice(0, MAX_FIELD_CHARS);
  const partial = PARTIAL_MARKER.exec(bounded);
  if (partial) {
    const markerEnd = redacted.indexOf(']', partial.index);
    bounded = markerEnd !== -1 && markerEnd - partial.index <= MAX_MARKER_CHARS
      ? redacted.slice(0, markerEnd + 1)
      : bounded.slice(0, partial.index);
  }
  return redactText(bounded).text;
}

function safeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

/**
 * An identifier that is safe to publish. A session identity read out of a log
 * is untrusted input like any other field, so one shaped like a filesystem
 * location is withheld rather than echoed into the record. The unpublishable
 * value is still tracked internally, so the reading can say it was there.
 */
function publishableIdentity(value) {
  return isPathShaped(value) ? null : value;
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
 * The current process and its ancestors, with an explicit statement of whether
 * the walk actually succeeded. A session lock held by one of them is this
 * session, which is the strongest identity claim discovery may make on its own.
 *
 * The walk uses `ps`, so it is POSIX-only. On Windows, and wherever `ps` is
 * missing or refuses, the lineage is reported `unavailable` rather than
 * returned short and silently treated as complete - the difference between
 * "no ancestor holds a session" and "we could not ask" decides whether a
 * non-match is evidence or ignorance, and callers must be able to tell.
 */
export function defaultProcessLineage(startPid = process.pid) {
  const lineage = [startPid];
  if (process.platform === 'win32') {
    return { pids: lineage, status: 'unavailable', reason: 'process lineage is not read on Windows' };
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
      return {
        pids: lineage,
        status: lineage.length > 1 ? 'walked' : 'unavailable',
        reason: 'the process table could not be read',
      };
    }
    if (!Number.isInteger(parent) || parent <= 1 || lineage.includes(parent)) {
      return { pids: lineage, status: 'walked', reason: null };
    }
    lineage.push(parent);
    current = parent;
  }
  return { pids: lineage, status: 'walked', reason: null };
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
    // `lstat`, not `stat`: a symbolic link to a session log is refused rather
    // than followed, so the thing that was named is the thing that is read.
    return fs.lstatSync(candidate).isFile();
  } catch {
    return false;
  }
}

/**
 * Opens the selection once and verifies the descriptor, rather than checking a
 * path and opening it afterwards. Between a check and an open, a path can be
 * replaced; a descriptor cannot. `O_NOFOLLOW` refuses a symbolic link at open
 * time where the platform provides it, and where it does not, the pre-open
 * `lstat` plus the post-open `fstat` refuse anything that is not a regular
 * file. Either way the failure is a refusal, never a read of something else.
 */
function openRegularFile(resolved, selectedPath) {
  const { O_RDONLY, O_NOFOLLOW } = fs.constants;
  const flags = typeof O_NOFOLLOW === 'number' ? O_RDONLY | O_NOFOLLOW : O_RDONLY;

  if (!isReadableFile(resolved)) {
    throw new SessionEvidenceError(
      'not_a_file',
      'the selection is not a regular file, or is a link to one',
    );
  }

  let fd;
  try {
    fd = fs.openSync(resolved, flags);
  } catch (error) {
    throw new SessionEvidenceError(
      error.code === 'ELOOP' ? 'not_a_file' : 'unreadable_selection',
      error.code === 'ELOOP'
        ? 'the selection is a symbolic link'
        : `cannot read the selection: ${selectedPath}`,
    );
  }

  try {
    if (!fs.fstatSync(fd).isFile()) {
      throw new SessionEvidenceError('not_a_file', 'the opened selection is not a regular file');
    }
  } catch (error) {
    fs.closeSync(fd);
    throw error instanceof SessionEvidenceError
      ? error
      : new SessionEvidenceError('unreadable_selection', `cannot inspect the selection: ${selectedPath}`);
  }
  return fd;
}

/**
 * Every session under the root that the operating system can still prove is
 * running, by way of an in-use lock naming a live process. A stale lock, a
 * session with no log, and a directory that cannot be read are all simply not
 * candidates: this function never ranks, and never breaks a tie.
 *
 * Candidates are sessions, not locks. One session may be held by several live
 * processes - a client and its helper, a resumed window - and counting those
 * holders separately would invent an ambiguity between a session and itself.
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

  const bySession = new Map();
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
      const existing = bySession.get(directory.name);
      if (existing) {
        existing.pids.push(pid);
      } else {
        bySession.set(directory.name, { sessionId: directory.name, pids: [pid], path: logPath });
      }
    }
  }
  const candidates = [...bySession.values()]
    .map((candidate) => ({ ...candidate, pids: [...candidate.pids].sort((a, b) => a - b) }))
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));
  return { error: null, candidates };
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
  processLineage = defaultProcessLineage,
  maxSessions = MAX_SCANNED_SESSIONS,
} = {}) {
  if (typeof explicitPath === 'string' && explicitPath.trim() !== '') {
    // Checked the same way a runtime-named transcript is. A named path that is
    // a directory or does not exist is a refusal here rather than an exception
    // three steps later, so every identity kind fails in the same shape.
    if (!isReadableFile(explicitPath)) {
      return unavailable(
        'unreadable_selection',
        'the named session log is not a readable file',
      );
    }
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

  const lineage = processLineage();
  const lineagePids = new Set(Array.isArray(lineage) ? lineage : lineage.pids);
  const lineageAvailable = Array.isArray(lineage) ? true : lineage.status === 'walked';
  const lineageNote = lineageAvailable ? [] : [{
    code: 'process_lineage_unavailable',
    detail: (Array.isArray(lineage) ? null : lineage.reason)
      ?? 'this platform does not expose the process lineage, so a lock held by an ancestor cannot be recognized',
  }];
  // Identity by lock is identity by process id, which an operating system may
  // reuse after a process exits. A live lock plus a matching lineage is strong;
  // the weaker claims below say so in their notes rather than in a comment.
  const pidNote = {
    code: 'identity_rests_on_process_id',
    detail: 'a session was identified by a live in-use lock, and a process id can be reused after a process exits',
  };
  const mine = candidates.filter(
    (candidate) => candidate.pids.some((pid) => lineagePids.has(pid)),
  );
  if (mine.length === 1) {
    const held = mine[0].pids.find((pid) => lineagePids.has(pid));
    return selected(mine[0].path, {
      kind: 'live-process-lock',
      session_id: mine[0].sessionId,
      pid: held,
      holders: mine[0].pids.length,
    }, [pidNote]);
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
      {
        kind: 'sole-live-session',
        session_id: candidates[0].sessionId,
        pid: candidates[0].pids[0],
        holders: candidates[0].pids.length,
      },
      [
        {
          code: 'session_identity_from_sole_live_session',
          detail: 'identity rests on this being the only running session, not on process lineage',
        },
        pidNote,
        ...lineageNote,
      ],
    );
  }
  if (candidates.length === 0) {
    return unavailable(
      'session_identity_unavailable',
      'no running session could be proved under the session root',
      { candidates: 0, notes: lineageNote },
    );
  }
  return unavailable(
    'session_identity_ambiguous',
    lineageAvailable
      ? `${candidates.length} sessions are running and none is provably this one`
      : `${candidates.length} sessions are running and this platform cannot prove which is this one`,
    { candidates: candidates.length, notes: lineageNote },
  );
}

class Notes {
  constructor(maxNotes) {
    this.maxNotes = maxNotes;
    this.entries = [];
    this.exhausted = false;
    this.seen = new Set();
    this.byCode = new Map();
  }

  add(code, anchor, detail, dedupeKey = null) {
    if (dedupeKey !== null) {
      if (this.seen.has(dedupeKey)) {
        return;
      }
      this.seen.add(dedupeKey);
    }
    const occurrences = (this.byCode.get(code) ?? 0) + 1;
    this.byCode.set(code, occurrences);
    if (occurrences > MAX_NOTES_PER_CODE) {
      return;
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

  /** Summarizes every limitation kind that occurred more often than it is listed. */
  finalize() {
    for (const [code, occurrences] of this.byCode) {
      if (occurrences > MAX_NOTES_PER_CODE) {
        this.entries.push({
          code: 'repeated_limitation',
          anchor: null,
          detail: `${code} occurred ${occurrences} times; the first ${MAX_NOTES_PER_CODE} are listed`,
        });
      }
    }
    return this.entries;
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
 * Reads a sequence of already-separated log lines, pulling them one at a time.
 *
 * The sequence is consumed with a single record of lookahead and is never
 * materialized: a session log is routinely hundreds of megabytes, so holding
 * one in an array would make memory a function of how long the session ran.
 * The lookahead exists because the last line means something different from
 * every other line - an unterminated one was still being written - and that
 * can only be known once the next line fails to arrive.
 *
 * `endsWithNewline` is the other half of that judgement and is supplied by the
 * caller rather than guessed at here.
 */
export function extractSessionEvidence({
  lines,
  logId = null,
  sourcePath = null,
  provenSessionId = null,
  endsWithNewline = true,
  maxEvents = DEFAULT_MAX_EVENTS,
  maxNotes = DEFAULT_MAX_NOTES,
  maxLines = Number.POSITIVE_INFINITY,
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
  let unforgottenOperations = 0;
  let untrackedNesting = 0;

  const materialize = (anchor, type, timestamp, fields) => {
    projection.push({ anchor, type, timestamp, ...fields });
  };

  let lineBudgetExhausted = false;
  let linesRead = 0;
  const consume = (rawLine, lineNumber, isFinalLine) => {
    const anchor = anchorFor(lineNumber);
    const entry = typeof rawLine === 'string' ? { text: rawLine, oversized: false } : rawLine;
    if (entry.oversized) {
      notes.add(
        'oversized_record',
        anchor,
        `the record exceeded ${MAX_RECORD_BYTES} bytes and was not read`,
      );
      return;
    }
    const line = entry.text.replace(/\r$/, '');
    // A line the reader knows was unterminated, or the last line of a text
    // input that did not end with a newline. Either way it was still being
    // written, which is a different fact from a malformed record.
    const unterminated = entry.unterminated === true || (isFinalLine && !endsWithNewline);

    if (line.trim() === '') {
      if (!unterminated) {
        notes.add('blank_record', anchor, 'a blank line appears inside the log');
      }
      return;
    }

    let record;
    try {
      record = JSON.parse(line);
    } catch {
      if (unterminated) {
        notes.add('torn_final_record', anchor, 'the last record was still being written');
      } else {
        notes.add('malformed_record', anchor, 'the line is not valid JSON');
      }
      return;
    }

    if (!isPlainObject(record) || typeof record.type !== 'string') {
      notes.add('invalid_record', anchor, 'the record carries no event type');
      return;
    }

    const { type } = record;
    if (byType.has(type) || byType.size < MAX_EVENT_TYPES) {
      byType.set(type, (byType.get(type) ?? 0) + 1);
    } else {
      byType.set(OTHER_EVENT_TYPES, (byType.get(OTHER_EVENT_TYPES) ?? 0) + 1);
      notes.add(
        'event_type_budget_exhausted',
        anchor,
        `more than ${MAX_EVENT_TYPES} distinct event types appear; the rest are counted together`,
      );
    }
    usableRecords += 1;

    const timestamp = safeString(record.timestamp);
    if (timestamp) {
      firstTimestamp ??= timestamp;
      lastTimestamp = timestamp;
    }

    if (!SUPPORTED.has(type)) {
      // The type name comes from the log. Report it only when it is a name a
      // record may carry; otherwise say that one was there and count it.
      const reportable = publishableIdentity(safeString(type));
      notes.add(
        'unrecognized_event',
        anchor,
        reportable !== null && isPublishableCountKey(reportable)
          ? `unsupported event type ${reportable}`
          : 'an unsupported event type that cannot be published as a name',
        `unknown:${type}`,
      );
      return;
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
        materialize(anchor, type, timestamp, { session_id: publishableIdentity(observed) });
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
          } else if (openTurns.size < MAX_OPEN_OPERATIONS) {
            openTurns.set(turnId, anchor);
          } else {
            unforgottenOperations += 1;
            notes.add(
              'open_operation_budget_exhausted',
              anchor,
              `more than ${MAX_OPEN_OPERATIONS} operations are open at once; later ones are counted, not tracked`,
            );
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
        const observedName = safeString(at(record, 'data.toolName')) ?? 'unnamed';
        // A tool name comes from the log, so it is bucketed unless it is a
        // publishable name, and the set of names is bounded like every other
        // collection built from untrusted input.
        const known = Object.prototype.hasOwnProperty.call(tools.by_tool, observedName);
        const publishable = isPublishableCountKey(observedName)
          && (known || Object.keys(tools.by_tool).length < MAX_TOOL_NAMES);
        const toolName = publishable ? observedName : OTHER_TOOL_NAMES;
        if (!publishable) {
          notes.add(
            'tool_name_budget_exhausted',
            anchor,
            `a tool name was not published; at most ${MAX_TOOL_NAMES} publishable names are named`,
          );
        }
        tools.calls += 1;
        tools.by_tool[toolName] = (tools.by_tool[toolName] ?? 0) + 1;
        if (toolCallId !== null && openTools.size < MAX_OPEN_OPERATIONS) {
          openTools.set(toolCallId, { anchor, toolName });
        } else if (toolCallId !== null) {
          unforgottenOperations += 1;
          notes.add(
            'open_operation_budget_exhausted',
            anchor,
            `more than ${MAX_OPEN_OPERATIONS} operations are open at once; later ones are counted, not tracked`,
          );
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
        if (toolCallId !== null && openSubagents.size < MAX_OPEN_OPERATIONS) {
          openSubagents.set(toolCallId, span);
        }
        if (subagentStack.length < MAX_SUBAGENT_DEPTH) {
          subagentStack.push({ toolCallId, agent, span });
        } else {
          untrackedNesting += 1;
          notes.add(
            'subagent_depth_budget_exhausted',
            anchor,
            `subagents nest deeper than ${MAX_SUBAGENT_DEPTH}; deeper ones are counted, not tracked`,
          );
        }
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
  };

  // One record of lookahead: hold the previous line until the next one proves
  // it was not the last, then process it. Nothing else is retained.
  let pending = null;
  let pendingNumber = 0;
  for (const rawLine of lines) {
    if (linesRead >= maxLines) {
      lineBudgetExhausted = true;
      break;
    }
    linesRead += 1;
    if (pending !== null) {
      consume(pending, pendingNumber, false);
    }
    pending = rawLine;
    pendingNumber = linesRead;
  }
  if (pending !== null) {
    consume(pending, pendingNumber, !lineBudgetExhausted);
  }
  if (lineBudgetExhausted) {
    notes.add(
      'line_budget_exhausted',
      null,
      `only the first ${maxLines} records were read`,
    );
  }

  for (const anchor of openTurns.values()) {
    if (turns.incomplete.length < MAX_ANCHOR_LIST) {
      turns.incomplete.push(anchor);
    }
    notes.add('incomplete_turn', anchor, 'a turn starts and never ends in this log');
  }
  for (const opened of openTools.values()) {
    if (tools.incomplete.length < MAX_ANCHOR_LIST) {
      tools.incomplete.push(opened.anchor);
    }
    notes.add('incomplete_tool_call', opened.anchor, 'a tool request records no result');
  }
  for (const span of openSubagents.values()) {
    notes.add('incomplete_subagent', span.anchor, 'a subagent starts and never completes in this log');
  }
  if (turns.incomplete.length >= MAX_ANCHOR_LIST || tools.incomplete.length >= MAX_ANCHOR_LIST) {
    notes.add(
      'anchor_list_budget_exhausted',
      null,
      `more than ${MAX_ANCHOR_LIST} unfinished operations were found; the rest are counted, not listed`,
    );
  }

  if (projection.exhausted) {
    notes.add(
      'event_budget_exhausted',
      null,
      `more than ${maxEvents} material events were found; later ones are counted but not listed`,
    );
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

  // The log claims a session identity; discovery may have proved one. When they
  // disagree the proof wins and the disagreement is stated, because the claim is
  // the untrusted half: a file can say anything about which session it is.
  const claimedSessionId = sessionId;
  let publishedSessionId = provenSessionId ?? claimedSessionId;
  if (provenSessionId !== null && claimedSessionId !== null && provenSessionId !== claimedSessionId) {
    notes.add(
      'session_identity_contradiction',
      null,
      'the selected log claims a different session than the one whose identity was proved',
    );
    publishedSessionId = provenSessionId;
  }
  if (isPathShaped(publishedSessionId)) {
    notes.add(
      'session_identity_unpublishable',
      null,
      'the recorded session identity is a filesystem path and was not published',
    );
    publishedSessionId = null;
  }
  // The claim is preserved only when it is publishable. A path-shaped claim is
  // reported by its limitation, never republished under another field name.
  const publishedClaim = isPathShaped(claimedSessionId) ? null : claimedSessionId;

  notes.finalize();

  // Completeness is decided last, after every limitation this reading can
  // raise - including the ones about identity. Deciding it earlier is how a
  // reading that later discovered it might be about another session altogether
  // still called itself complete and carried no cap.
  const completeness = sawCompaction
    ? 'compacted'
    : (notes.entries.length === 0 ? 'complete' : 'partial');

  return {
    log_id: publishedLogId({ requestedLogId: logId, sessionId: publishedSessionId, sourcePath }),
    // A caller may hand in a path as its "identifier". It is refused as the
    // published identity above; echoing it back here would undo that.
    requested_log_id: publishableIdentity(safeString(logId)),
    session_id: publishedSessionId,
    claimed_session_id: publishedClaim,
    producer,
    first_timestamp: firstTimestamp,
    last_timestamp: lastTimestamp,
    lines_read: linesRead,
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
    untracked_operations: unforgottenOperations,
    untracked_nesting: untrackedNesting,
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
 * A session log is routinely hundreds of megabytes, so reading it whole is not
 * an option, and reading only its head would silently answer a question about a
 * session with a fact about its opening minutes.
 *
 * The generator marks an unterminated final line rather than reporting it out
 * of band, because its consumer reads lazily and would otherwise decide whether
 * the last record was torn before this function had reached the end of the file.
 */
export function* streamLines(fd) {
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  // A chunk boundary lands wherever the file says it does, which is routinely
  // in the middle of a multi-byte character. Decoding each chunk on its own
  // would turn that character into replacement bytes and corrupt the record
  // around it, so the decoder holds the partial sequence until the rest arrives.
  const decoder = new StringDecoder('utf8');
  let remainder = '';
  let position = 0;
  let dropping = false;

  for (;;) {
    const bytes = fs.readSync(fd, buffer, 0, READ_CHUNK_BYTES, position);
    if (bytes === 0) {
      break;
    }
    position += bytes;
    remainder += decoder.write(buffer.subarray(0, bytes));

    let newline = remainder.indexOf('\n');
    while (newline !== -1) {
      const line = remainder.slice(0, newline);
      remainder = remainder.slice(newline + 1);
      if (dropping) {
        dropping = false;
        yield { text: '', oversized: true };
      } else if (Buffer.byteLength(line, 'utf8') > MAX_RECORD_BYTES) {
        yield { text: '', oversized: true };
      } else {
        yield { text: line, oversized: false };
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
    yield { text: '', oversized: true, unterminated: true };
    return;
  }
  remainder += decoder.end();
  if (remainder !== '') {
    yield { text: remainder, oversized: false, unterminated: true };
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
  let directory = false;
  try {
    directory = fs.lstatSync(resolved).isDirectory();
  } catch {
    throw new SessionEvidenceError(
      'unreadable_selection',
      `cannot read the selection: ${selectedPath}`,
    );
  }
  if (directory) {
    throw new SessionEvidenceError(
      'not_a_file',
      'the selection is a directory; name the session log file itself',
    );
  }

  const fd = openRegularFile(resolved, selectedPath);

  try {
    return extractSessionEvidence({
      // The generator is handed over unconsumed: the reader pulls one line at
      // a time, so a log larger than memory is read the same way a small one is.
      lines: streamLines(fd),
      logId: options.logId ?? null,
      sourcePath: resolved,
      provenSessionId: options.provenSessionId ?? null,
      maxEvents: options.maxEvents ?? DEFAULT_MAX_EVENTS,
      maxNotes: options.maxNotes ?? DEFAULT_MAX_NOTES,
      maxLines: options.maxLines ?? DEFAULT_MAX_LINES,
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
    // The resolution names a file, and naming it in output is the same leak the
    // reader refuses everywhere else. Publish what was decided, not where.
    const { path: resolvedPath, ...published } = resolution;
    console.log(JSON.stringify({
      ...published,
      log_id: publishedLogId({
        sessionId: resolution.identity.session_id,
        sourcePath: resolvedPath,
      }),
    }, null, 2));
    return EXIT_READ;
  }

  // The reader already decided what may be published as this log's identity.
  // Overriding it here is how an absolute path reaches output, so the command
  // prints what the reader produced and adds only the resolution's own fields.
  const result = readSelectedSession(resolution.path, {
    ...parsed,
    provenSessionId: resolution.identity.session_id ?? null,
  });
  console.log(JSON.stringify(
    { ...result, identity: resolution.identity, identity_notes: resolution.notes },
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
