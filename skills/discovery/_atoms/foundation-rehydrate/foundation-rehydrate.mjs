#!/usr/bin/env node

/**
 * Deterministic re-entry for Discovery.
 *
 * At the start of every Discovery invocation, before selecting or beginning the
 * next cycle, Discovery must ground itself on the exact persisted, human-aligned
 * foundation for its subject rather than on conversation memory. This module
 * resolves that foundation by reading the artifacts ITSELF — it enumerates
 * `<repositoryRoot>/docs/agent/discovery/`, reads each `*.md`, and parses it —
 * so identity, alignment, and revision are derived from the bytes on disk, never
 * from caller-supplied metadata. It returns either the rehydrated Discovery
 * state or a named recovery state. It never writes, edits, aligns, approves, or
 * mutates a tracker.
 *
 * Reading the artifacts itself is the point. A caller cannot assert a subject
 * identity, an alignment, a revision, or the bytes of a foundation: those would
 * let foreign bytes rehydrate under a forged identity, or let a caller claim a
 * verified write this atom must prove for itself. The intake carries only the
 * subject to match, the repository to read, and the continuation to check
 * against. Any extra field is refused as unknown — including any field asserting
 * a verified write (AC7).
 *
 * The distinction this module enforces mechanically: a post-write reread proves
 * the persisted bytes match what was written, and is write verification only.
 * It is NOT evidence that a fresh or compacted agent grounded on those bytes.
 * That is this module's job, on these bytes, at the start of the next run.
 *
 * The resolution refuses to guess. A missing, ambiguous, unreadable, unaligned,
 * or stale foundation produces an explicit recovery state; the run never
 * silently continues from memory (AC4). The stale/unreadable split is exact: a
 * carried continuation that no longer describes this subject's foundation (the
 * artifact is absent, its revision moved, or it now declares a different
 * subject) is `foundation-stale`, never `foundation-missing`; bytes that exist
 * but cannot be recovered (a read error, a parse failure, a symlinked component,
 * or a basename that disagrees with the declared slug) are `foundation-unreadable`,
 * in both cold-start and compacted modes. The discovery directory's components
 * are walked one at a time, following no symbolic link, so a symlinked ancestor
 * cannot redirect enumeration outside the repository. The run fails closed on any
 * unreadable artifact whether or not a match was found. Ambiguity is never
 * resolved by choosing a candidate.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FOUNDATION_FIELDS,
  CONFIRMED,
  parseFoundation,
  revisionOf,
  validateBoundedLocator,
  DISCOVERY_DIR_POSIX,
} from '../foundation-persist/foundation-persist.mjs';

export class FoundationRehydrateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FoundationRehydrateError';
    this.code = code;
  }
}

export const STATE_VERSION = 1;

/** The success status and the five named recovery states this helper can emit. */
export const REHYDRATED = 'rehydrated';
export const RECOVERY = Object.freeze({
  missing: 'foundation-missing',
  ambiguous: 'foundation-ambiguous',
  unreadable: 'foundation-unreadable',
  unaligned: 'foundation-unaligned',
  stale: 'foundation-stale',
});

/** Rehydration mode, both real, tested paths (AC10). */
export const MODES = Object.freeze({
  coldStart: 'cold-start',
  compactedSession: 'compacted-session',
});

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DISCOVERY_DIR_SEGMENTS = ['docs', 'agent', 'discovery'];

const INTAKE_FIELDS = Object.freeze(['version', 'repositoryRoot', 'subject', 'expected']);

const CONTINUATION_PREFIX = 'discovery-foundation:';
// Anchored, line-oriented grammar. A continuation reference is a whole standalone
// line, or that same line as a handoff list item with a leading "- ". Nothing
// before `discovery-foundation:` on the line but optional whitespace and that
// bullet, and nothing after the revision. Ordinary prose that merely contains
// the substring is not a reference.
const CONTINUATION_LINE_RE = /^\s*(?:- )?discovery-foundation: (\S+)@([a-f0-9]{64})$/;

function makeRehydrateError(code, message) {
  return new FoundationRehydrateError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new FoundationRehydrateError('invalid-input', `${label} must be non-empty text`);
  }
  return value;
}

/**
 * Encode a continuation reference as one canonical, unambiguous line suitable
 * for a bounded handoff's Artifacts and References section. The next invocation
 * parses it back and feeds it as `expected`.
 */
export function renderContinuation({ locator, revision } = {}) {
  validateBoundedLocator(locator, makeRehydrateError);
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
    throw new FoundationRehydrateError('invalid-input', 'revision must be a SHA-256 digest');
  }
  return `${CONTINUATION_PREFIX} ${locator}@${revision}`;
}

/**
 * Recover exactly one continuation reference from arbitrary surrounding handoff
 * text. The scan is anchored and line-oriented: each line is matched against the
 * documented standalone grammar (optionally as a `- ` list item), so prose that
 * merely mentions the prefix is not a reference. The recovered locator is run
 * through the shared bounded-locator validator. Zero references or more than one
 * is refused — the helper never chooses.
 */
export function parseContinuation(text) {
  if (typeof text !== 'string') {
    throw new FoundationRehydrateError('invalid-input', 'continuation text must be a string');
  }
  const found = [];
  // Normalize CRLF before matching. The repository validation matrix includes
  // windows-latest, so a canonical Windows-style handoff line ends `...\r\n`;
  // splitting on `\n` alone would leave a trailing `\r` that the anchored regex
  // rejects. Strip one trailing carriage return per line (MF-5).
  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const match = CONTINUATION_LINE_RE.exec(line);
    if (match) {
      found.push({ locator: match[1], revision: match[2] });
    }
  }
  if (found.length === 0) {
    throw new FoundationRehydrateError('invalid-input', `no ${CONTINUATION_PREFIX} reference was found in the handoff text`);
  }
  if (found.length > 1) {
    throw new FoundationRehydrateError('invalid-input', `more than one ${CONTINUATION_PREFIX} reference was found; refusing to choose among ${found.length}`);
  }
  validateBoundedLocator(found[0].locator, makeRehydrateError);
  return { locator: found[0].locator, revision: found[0].revision };
}

function normalizeIntake(intake) {
  if (!isPlainObject(intake)) {
    throw new FoundationRehydrateError('invalid-input', 'the rehydrate intake must be an object');
  }
  const unknown = Object.keys(intake).filter((field) => !INTAKE_FIELDS.includes(field)).sort();
  if (unknown.length) {
    // There is deliberately no field a caller may use to assert a verified
    // write, a subject identity per file, an alignment, or foundation bytes.
    // Any such field is unknown and refused here (AC7, F1/F2).
    throw new FoundationRehydrateError('invalid-input', `unknown field(s): ${unknown.join(', ')}`);
  }
  if (intake.version !== STATE_VERSION) {
    throw new FoundationRehydrateError('invalid-input', `version must be ${STATE_VERSION}`);
  }

  const repositoryRoot = nonEmptyString(intake.repositoryRoot, 'repositoryRoot');
  if (!path.isAbsolute(repositoryRoot)) {
    throw new FoundationRehydrateError('invalid-input', 'repositoryRoot must be an absolute path');
  }

  if (!isPlainObject(intake.subject)) {
    throw new FoundationRehydrateError('invalid-input', 'subject must be an object with id and slug');
  }
  const subjectUnknown = Object.keys(intake.subject).filter((k) => k !== 'id' && k !== 'slug').sort();
  if (subjectUnknown.length) {
    throw new FoundationRehydrateError('invalid-input', `subject has unknown field(s): ${subjectUnknown.join(', ')}`);
  }
  const id = nonEmptyString(intake.subject.id, 'subject.id');
  const slug = nonEmptyString(intake.subject.slug, 'subject.slug');
  if (!SLUG_RE.test(slug)) {
    throw new FoundationRehydrateError('invalid-input', `subject.slug must match ${SLUG_RE}`);
  }

  let expected = null;
  if (intake.expected !== null) {
    if (!isPlainObject(intake.expected)) {
      throw new FoundationRehydrateError('invalid-input', 'expected must be an object or null');
    }
    const expUnknown = Object.keys(intake.expected).filter((k) => k !== 'locator' && k !== 'revision').sort();
    if (expUnknown.length) {
      throw new FoundationRehydrateError('invalid-input', `expected has unknown field(s): ${expUnknown.join(', ')}`);
    }
    expected = {
      locator: validateBoundedLocator(intake.expected.locator, makeRehydrateError).locator,
      revision: nonEmptyString(intake.expected.revision, 'expected.revision'),
    };
  }

  return { repositoryRoot, subject: { id, slug }, expected };
}

const realIo = {
  lstat: (target) => fs.lstatSync(target),
  readdir: (target) => fs.readdirSync(target),
  read: (target) => fs.readFileSync(target, 'utf8'),
};

/**
 * `lstat` that classifies every filesystem outcome. Returns `{ stat }` for a
 * present path, `{ stat: null }` for a genuinely absent one, and `{ failure }`
 * carrying the underlying condition for any other error, so no raw `EACCES` or
 * `EISDIR` escapes to a caller (R5).
 */
function safeLstat(io, target) {
  try {
    return { stat: io.lstat(target) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { stat: null };
    return { failure: error.message };
  }
}

/** `read` that classifies its outcome as `{ content }`, `{ missing }`, or `{ failure }`. */
function safeRead(io, target) {
  try {
    return { content: io.read(target) };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { missing: true };
    return { failure: error.message };
  }
}

/**
 * Read one `.md` entry safely. A symbolic link is never followed; it is reported
 * so the caller can see it was skipped. Returns a descriptor: an unreadable or
 * unparsable file carries `error` and no `parsed`. `unreadable: true` marks any
 * artifact that could not be recovered — a read/parse failure OR a deliberate
 * symlink skip — so the caller can fail closed rather than silently continue
 * (R7). A skipped symbolic link additionally carries `symlink: true` to record
 * why it was not read; it is never followed and its bytes are never recovered,
 * so like every other unrecovered artifact it cannot be dismissed as not this
 * subject's.
 */
function readArtifact(io, dir, name) {
  const locator = `${DISCOVERY_DIR_POSIX}/${name}`;
  const full = path.join(dir, name);
  const { stat, failure } = safeLstat(io, full);
  if (failure !== undefined) {
    return { locator, error: `could not be inspected: ${failure}`, unreadable: true };
  }
  if (stat === null) {
    return { locator, error: 'the file disappeared before it could be read', unreadable: true };
  }
  if (stat.isSymbolicLink()) {
    return { locator, error: 'entry is a symbolic link and was not followed', symlink: true, unreadable: true };
  }
  if (!stat.isFile()) {
    return { locator, error: 'entry is not a regular file', unreadable: true };
  }
  const readResult = safeRead(io, full);
  if (readResult.content === undefined) {
    return { locator, error: `could not be read: ${readResult.failure ?? 'the file disappeared before it could be read'}`, unreadable: true };
  }
  const content = readResult.content;
  let parsed;
  try {
    parsed = parseFoundation(content);
  } catch (error) {
    return { locator, content, error: `foundation could not be recovered: ${error.message}`, unreadable: true };
  }
  const missingFields = FOUNDATION_FIELDS.filter((field) => parsed[field] === undefined);
  if (missingFields.length) {
    return { locator, content, error: `foundation is missing distinct field(s): ${missingFields.join(', ')}`, unreadable: true };
  }
  // Canonical-destination contract (MF-7): persistence always targets
  // `<declared slug>.md`, so an artifact whose file basename disagrees with the
  // slug it declares is not a foundation persistence could continue from. The
  // parsed identity is still returned so the artifact can participate in
  // matching — a lone such match fails closed as `foundation-unreadable`, and
  // two same-subject matches remain a genuine ambiguity for the human — but the
  // `basenameMismatch` flag and `error` mark that it can never be rehydrated
  // from directly.
  if (name !== `${parsed.subject.slug}.md`) {
    return {
      locator,
      content,
      parsed,
      revision: revisionOf(content),
      basenameMismatch: true,
      error: `file basename ${name} disagrees with the declared slug ${parsed.subject.slug} (persistence would target ${parsed.subject.slug}.md)`,
    };
  }
  return { locator, content, parsed, revision: revisionOf(content) };
}

function rehydratedState(subject, artifact, mode, ignored) {
  const rehydrated = {
    status: REHYDRATED,
    mode,
    subjectId: subject.id,
    foundation: {
      locator: artifact.locator,
      revision: artifact.revision,
      subjectId: subject.id,
      alignment: CONFIRMED,
    },
    // The exact locator and revision the next compaction must carry (AC6).
    continuation: {
      locator: artifact.locator,
      revision: artifact.revision,
    },
    ignored,
  };
  for (const field of FOUNDATION_FIELDS) {
    rehydrated[field] = artifact.parsed[field];
  }
  return rehydrated;
}

/**
 * Resolve, verify, and rehydrate by reading the subject's discovery directory.
 * Returns a result whose `status` is either `rehydrated` or one of the five
 * named recovery states. Malformed intake throws `invalid-input`.
 */
export function rehydrateFoundation(intake, { io = realIo } = {}) {
  const { repositoryRoot, subject, expected } = normalizeIntake(intake);

  const dir = path.join(repositoryRoot, ...DISCOVERY_DIR_SEGMENTS);
  const canonicalLocator = `${DISCOVERY_DIR_POSIX}/${subject.slug}.md`;

  // A compacted continuation names exactly one artifact and revision. Resolve
  // it directly. The recovery vocabulary follows the SF-1 split: the carried
  // continuation is `foundation-stale` when it no longer describes this
  // subject's foundation (the artifact is absent, its revision moved, or it now
  // declares a different subject), and `foundation-unreadable` when the bytes
  // exist but cannot be recovered (a read error, a parse failure, a symlinked
  // component, or a basename that disagrees with the declared slug). A stale
  // continuation is never degraded to `foundation-missing` (AC4).
  if (expected !== null) {
    const expFull = path.join(repositoryRoot, expected.locator);
    const staleWith = (currentRevision, note) => ({
      status: RECOVERY.stale,
      locator: expected.locator,
      subjectId: subject.id,
      expectedLocator: expected.locator,
      expectedRevision: expected.revision,
      currentRevision,
      note,
    });
    const unreadableWith = (note) => ({
      status: RECOVERY.unreadable,
      locator: expected.locator,
      subjectId: subject.id,
      readFailure: note,
      ignored: [],
    });

    // Walk every bounded path component with lstat and follow no symbolic link
    // in the chain (R1). The locator was already validated to be exactly
    // docs/agent/discovery/<slug>.md, so the segments are the bound itself.
    const segments = expected.locator.split('/');
    let walked = repositoryRoot;
    for (let i = 0; i < segments.length; i += 1) {
      walked = path.join(walked, segments[i]);
      const last = i === segments.length - 1;
      const { stat, failure } = safeLstat(io, walked);
      if (failure !== undefined) {
        return unreadableWith(`the carried continuation path component ${segments[i]} could not be inspected: ${failure}`);
      }
      if (stat === null) {
        return staleWith(null, 'the carried continuation no longer resolves to an artifact');
      }
      if (stat.isSymbolicLink()) {
        return unreadableWith(`the carried continuation resolves through a symbolic link at ${segments[i]}, which is not followed`);
      }
      if (!last && !stat.isDirectory()) {
        return staleWith(null, `the carried continuation path component ${segments[i]} is not a directory`);
      }
      if (last && !stat.isFile()) {
        return staleWith(null, 'the carried continuation does not resolve to a regular file');
      }
    }

    const readResult = safeRead(io, expFull);
    if (readResult.missing) {
      return staleWith(null, 'the carried continuation no longer resolves to an artifact');
    }
    if (readResult.content === undefined) {
      return unreadableWith(`the carried continuation could not be read: ${readResult.failure ?? 'the file disappeared before it could be read'}`);
    }
    const content = readResult.content;
    // Revision is compared before parsing: identity, alignment, and content are
    // only trusted once the carried revision still matches the bytes on disk. A
    // mismatched revision is stale even when the bytes are unparsable (R10).
    const currentRevision = revisionOf(content);
    if (currentRevision !== expected.revision) {
      return staleWith(currentRevision, 'the carried continuation revision no longer matches');
    }
    let parsed;
    try {
      parsed = parseFoundation(content);
    } catch (error) {
      return unreadableWith(`the carried continuation could not be parsed: ${error.message}`);
    }
    const missingFields = FOUNDATION_FIELDS.filter((field) => parsed[field] === undefined);
    if (missingFields.length) {
      return unreadableWith(`the carried continuation is missing distinct field(s): ${missingFields.join(', ')}`);
    }
    if (parsed.subject.id !== subject.id || parsed.subject.slug !== subject.slug) {
      return staleWith(currentRevision, `the carried continuation belongs to subject ${parsed.subject.id}/${parsed.subject.slug}, not ${subject.id}/${subject.slug}`);
    }
    // Canonical-destination contract (MF-7): the artifact's basename must be
    // `<declared slug>.md`, or persistence would target a different file and
    // dead-end. A disagreement is unreadable, not a valid foundation.
    const basename = segments[segments.length - 1];
    if (basename !== `${parsed.subject.slug}.md`) {
      return unreadableWith(`the carried continuation file basename ${basename} disagrees with the declared slug ${parsed.subject.slug} (persistence would target ${parsed.subject.slug}.md)`);
    }
    if (parsed.alignment !== CONFIRMED) {
      return {
        status: RECOVERY.unaligned,
        locator: expected.locator,
        subjectId: subject.id,
        alignment: parsed.alignment,
        ignored: [],
      };
    }
    // Report the ACTUAL validated locator; never relabel a resolved path by its
    // basename (R1).
    const artifact = { locator: expected.locator, parsed, revision: currentRevision };
    return rehydratedState(subject, artifact, MODES.compactedSession, []);
  }

  // Cold start: discover the foundation by enumerating the directory. Walk
  // docs, agent, and discovery component by component with lstat, following no
  // symbolic link — the same no-symlink discipline the persist side uses. A bare
  // lstat of the final directory would follow a symlinked ancestor (`docs`,
  // `agent`) and read bytes from outside the repository, so each component is
  // classified individually (MF-1).
  {
    let walked = repositoryRoot;
    for (const segment of DISCOVERY_DIR_SEGMENTS) {
      walked = path.join(walked, segment);
      const { stat, failure } = safeLstat(io, walked);
      if (failure !== undefined) {
        return {
          status: RECOVERY.unreadable,
          locator: canonicalLocator,
          subjectId: subject.id,
          readFailure: `the discovery path component ${walked} could not be inspected: ${failure}`,
          ignored: [],
        };
      }
      if (stat === null) {
        return { status: RECOVERY.missing, locator: canonicalLocator, subjectId: subject.id, ignored: [] };
      }
      if (stat.isSymbolicLink()) {
        return {
          status: RECOVERY.unreadable,
          locator: canonicalLocator,
          subjectId: subject.id,
          readFailure: `${walked} is a symbolic link; refusing to follow it to enumerate foundations`,
          ignored: [],
        };
      }
      if (!stat.isDirectory()) {
        return {
          status: RECOVERY.unreadable,
          locator: canonicalLocator,
          subjectId: subject.id,
          readFailure: `${walked} exists and is not a directory`,
          ignored: [],
        };
      }
    }
  }

  let names;
  try {
    names = io.readdir(dir).filter((name) => name.endsWith('.md')).sort();
  } catch (error) {
    return {
      status: RECOVERY.unreadable,
      locator: canonicalLocator,
      subjectId: subject.id,
      readFailure: `the discovery directory could not be enumerated: ${error.message}`,
      ignored: [],
    };
  }

  const matches = [];
  const ignored = [];
  const unreadableFiles = [];
  for (const name of names) {
    const artifact = readArtifact(io, dir, name);
    if (artifact.parsed
      && artifact.parsed.subject.id === subject.id
      && artifact.parsed.subject.slug === subject.slug) {
      matches.push(artifact);
      continue;
    }
    if (artifact.parsed) {
      ignored.push({
        locator: artifact.locator,
        declaredSubject: { id: artifact.parsed.subject.id, slug: artifact.parsed.subject.slug },
        reason: `declares subject ${artifact.parsed.subject.id}/${artifact.parsed.subject.slug}, not ${subject.id}/${subject.slug}`,
      });
      continue;
    }
    ignored.push({ locator: artifact.locator, reason: artifact.error });
    if (artifact.unreadable) {
      unreadableFiles.push({ locator: artifact.locator, reason: artifact.error });
    }
  }

  // Fail closed on any artifact that could not be recovered (MF-2): if any
  // `*.md` in the discovery directory could not be read or parsed — including a
  // symbolic link, which is deliberately never followed — the state is
  // `foundation-unreadable` naming those files, whether or not a match was
  // found, because an unrecovered artifact could itself be this subject's
  // foundation and its true subject is unknowable without reading it. This
  // precedes match resolution and ambiguity. A file that parsed but whose
  // basename disagrees with its declared slug is handled by the match logic
  // below, not here, so two same-subject artifacts still surface as a genuine
  // ambiguity for the human. As a result, `foundation-missing` means every
  // artifact was readable and none is this subject's, and `rehydrated` means
  // every artifact was readable and exactly one is this subject's, at its
  // canonical path (R7/MF-7).
  if (unreadableFiles.length) {
    return {
      status: RECOVERY.unreadable,
      locator: canonicalLocator,
      subjectId: subject.id,
      readFailure: `${unreadableFiles.length} artifact(s) in the discovery directory could not be read or parsed: ${unreadableFiles.map((entry) => `${entry.locator} (${entry.reason})`).join('; ')}`,
      ignored,
    };
  }

  if (matches.length > 1) {
    return {
      status: RECOVERY.ambiguous,
      subjectId: subject.id,
      candidates: matches.map((artifact) => artifact.locator),
      ignored,
    };
  }

  if (matches.length === 0) {
    return { status: RECOVERY.missing, locator: canonicalLocator, subjectId: subject.id, ignored };
  }

  const match = matches[0];
  // A lone match whose basename disagrees with its declared slug fails closed:
  // persistence would target `<slug>.md`, which is not this file, so rehydrating
  // from it would dead-end (MF-7).
  if (match.basenameMismatch) {
    return {
      status: RECOVERY.unreadable,
      locator: canonicalLocator,
      subjectId: subject.id,
      readFailure: `the only foundation matching this subject is at a non-canonical path: ${match.locator} (${match.error})`,
      ignored,
    };
  }
  if (match.parsed.alignment !== CONFIRMED) {
    return {
      status: RECOVERY.unaligned,
      locator: match.locator,
      subjectId: subject.id,
      alignment: match.parsed.alignment,
      ignored,
    };
  }

  return rehydratedState(subject, match, MODES.coldStart, ignored);
}

export const USAGE = 'Usage: foundation-rehydrate.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new FoundationRehydrateError('usage', USAGE);
  }
  let raw;
  try {
    raw = fs.readFileSync(argv[1], 'utf8');
  } catch (error) {
    throw new FoundationRehydrateError('invalid-input', `could not read the intake file ${argv[1]}: ${error.message}`);
  }
  const intake = JSON.parse(raw);
  const result = rehydrateFoundation(intake);
  streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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
      error: { code: error.code ?? 'invalid-input', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
