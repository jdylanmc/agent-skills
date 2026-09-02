import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const STATE_SCHEMA = 2;
export const MAX_FRAMES = 16;
export const MAX_FILES = 64;
export const MAX_RELATIVE_PATH_BYTES = 300;
export const MAX_CHECKPOINT_BYTES = 4096;
export const MAX_AGENT_STOP_BLOCKS = 1;
export const MAX_PENDING_RUNS = 16;
const LOCK_WAIT_MS = 2500;
const LOCK_STALE_MS = 500;
export const STATES = Object.freeze({
  active: 'active',
  compacting: 'compacting',
  required: 'rehydration-required',
  rehydrated: 'rehydrated',
  degraded: 'degraded',
});

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const PERSISTED_STATES = new Set([
  STATES.active,
  STATES.required,
  STATES.rehydrated,
  STATES.degraded,
]);
const LATCH_TRIGGERS = new Set(['manual', 'auto', 'resume']);

export class RehydrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RehydrationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new RehydrationError(code, message);
}

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function requireIdentifier(value, field) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    fail('invalid-input', `${field} must be a bounded opaque identifier`);
  }
  return value;
}

function canonicalRoot(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)) {
    fail('invalid-input', 'repositoryRoot must be absolute');
  }
  const root = fs.realpathSync(repositoryRoot);
  if (!fs.statSync(root).isDirectory()) {
    fail('invalid-input', 'repositoryRoot must be a directory');
  }
  return root;
}

function relativePath(root, absolute) {
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    fail('unsafe-path', 'canonical instruction path escapes the repository');
  }
  if (Buffer.byteLength(relative, 'utf8') > MAX_RELATIVE_PATH_BYTES) {
    fail('bounded-state-exceeded', 'canonical instruction path is too long');
  }
  return relative;
}

function readCanonicalFile(root, relative) {
  const lexical = path.resolve(root, relative);
  const real = fs.realpathSync(lexical);
  if (real !== lexical || !real.startsWith(`${root}${path.sep}`)) {
    fail('unsafe-path', `canonical instruction is not an in-root regular file: ${relative}`);
  }
  const stat = fs.statSync(real);
  if (!stat.isFile()) {
    fail('unsafe-path', `canonical instruction is not a regular file: ${relative}`);
  }
  const bytes = fs.readFileSync(real);
  return { path: relativePath(root, real), digest: digest(bytes), bytes: stat.size };
}

function parseIncludes(text, source) {
  const match = text.match(/^includes:\s*(\[[^\n]*\])\s*$/m);
  if (!match) {
    fail('invalid-package', `${source} has no parseable includes list`);
  }
  let includes;
  try {
    includes = JSON.parse(match[1]);
  } catch {
    fail('invalid-package', `${source} has an invalid includes list`);
  }
  if (!Array.isArray(includes) || includes.some((entry) => typeof entry !== 'string')) {
    fail('invalid-package', `${source} includes must be a string array`);
  }
  return includes;
}

function resolveInclude(root, ownerSkill, include) {
  const candidates = include.startsWith('_base/')
    ? [`skills/${include}`]
    : [`skills/${include}`, `skills/${ownerSkill}/${include}`];
  for (const candidate of candidates) {
    const absolute = path.resolve(root, candidate);
    if (fs.existsSync(absolute)) {
      return relativePath(root, absolute);
    }
  }
  fail('missing-instructions', `required reference is missing: ${include}`);
}

export function buildCanonicalManifest(repositoryRoot, skill) {
  const root = canonicalRoot(repositoryRoot);
  requireIdentifier(skill, 'skill');
  const first = `skills/${skill}/SKILL.md`;
  const queue = [first];
  const seen = new Set();
  const files = [];

  while (queue.length > 0) {
    const relative = queue.shift();
    if (seen.has(relative)) continue;
    if (seen.size >= MAX_FILES) {
      fail('bounded-state-exceeded', `canonical read set exceeds ${MAX_FILES} files`);
    }
    seen.add(relative);
    const file = readCanonicalFile(root, relative);
    files.push(file);
    const text = fs.readFileSync(path.join(root, relative), 'utf8');
    for (const include of parseIncludes(text, relative)) {
      if (!include.endsWith('.md')) continue;
      queue.push(resolveInclude(root, skill, include));
    }
  }

  return files;
}

export function statePath(repositoryRoot, sessionId) {
  const root = canonicalRoot(repositoryRoot);
  requireIdentifier(sessionId, 'sessionId');
  return path.join(root, '.skill-log', 'rehydration', `${digest(sessionId)}.json`);
}

function validStoredIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

function validStoredTimestamp(value) {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function validStoredRelativePath(value) {
  return typeof value === 'string' &&
    value.length > 0 &&
    Buffer.byteLength(value, 'utf8') <= MAX_RELATIVE_PATH_BYTES &&
    !value.includes('\\') &&
    !path.posix.isAbsolute(value) &&
    value !== '.' &&
    !value.startsWith('../') &&
    path.posix.normalize(value) === value;
}

function validateStoredFile(file, withOwner = false) {
  if (!file || typeof file !== 'object' || Array.isArray(file) ||
      !validStoredRelativePath(file.path) ||
      !SHA256.test(file.digest) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      (withOwner && (!validStoredIdentifier(file.runId) ||
        !validStoredIdentifier(file.skill)))) {
    fail('invalid-state', 'canonical file identity is invalid');
  }
}

function validateCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint) ||
      !validStoredIdentifier(checkpoint.event) ||
      !validStoredIdentifier(checkpoint.phase) ||
      (checkpoint.operation !== undefined && !validStoredIdentifier(checkpoint.operation)) ||
      (checkpoint.outcome !== undefined && !validStoredIdentifier(checkpoint.outcome))) {
    fail('invalid-state', 'frame checkpoint is invalid');
  }
}

function validateStoredFrame(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame) ||
      !validStoredIdentifier(frame.runId) ||
      !validStoredIdentifier(frame.rootSkill) ||
      !validStoredIdentifier(frame.skill) ||
      !validStoredRelativePath(frame.logPath)) {
    fail('invalid-state', 'active frame identity is invalid');
  }
  if (!Array.isArray(frame.files) || frame.files.length === 0 || frame.files.length > MAX_FILES) {
    fail('invalid-state', 'frame canonical read set is invalid');
  }
  for (const file of frame.files) validateStoredFile(file);
  validateCheckpoint(frame.checkpoint);
}

function sameOwnedFile(left, right) {
  return left.path === right.path &&
    left.digest === right.digest &&
    left.bytes === right.bytes &&
    left.runId === right.runId &&
    left.skill === right.skill;
}

function lifecycleReceipt(generation, frame) {
  if (!frame) return undefined;
  return {
    generation,
    beforeRecorded: false,
    afterRecorded: false,
    owner: {
      runId: frame.runId,
      rootSkill: frame.rootSkill,
      skill: frame.skill,
      logPath: frame.logPath,
    },
  };
}

function validateState(state, expectedSessionId) {
  if (!state || state.schema !== STATE_SCHEMA || !Array.isArray(state.stack)) {
    fail('invalid-state', 'rehydration state is malformed or unsupported');
  }
  if (!validStoredIdentifier(state.sessionId) ||
      (expectedSessionId !== undefined && state.sessionId !== expectedSessionId)) {
    fail('invalid-state', 'persisted session identity is invalid');
  }
  if (!Number.isSafeInteger(state.generation) || state.generation < 0) {
    fail('invalid-state', 'rehydration generation is invalid');
  }
  if (!PERSISTED_STATES.has(state.status)) {
    fail('invalid-state', 'rehydration status is invalid');
  }
  if (!validStoredTimestamp(state.updatedAt)) {
    fail('invalid-state', 'rehydration update timestamp is invalid');
  }
  if (state.lastCompletedGeneration !== undefined &&
      (!Number.isSafeInteger(state.lastCompletedGeneration) ||
       state.lastCompletedGeneration < 0 ||
       state.lastCompletedGeneration > state.generation)) {
    fail('invalid-state', 'completed generation is invalid');
  }
  if (state.lifecycle !== undefined &&
      (!state.lifecycle || typeof state.lifecycle !== 'object' ||
       Array.isArray(state.lifecycle) ||
       !Number.isSafeInteger(state.lifecycle.generation) ||
       state.lifecycle.generation !== state.generation ||
       typeof state.lifecycle.beforeRecorded !== 'boolean' ||
       typeof state.lifecycle.afterRecorded !== 'boolean' ||
       !state.lifecycle.owner ||
       typeof state.lifecycle.owner !== 'object' ||
       Array.isArray(state.lifecycle.owner) ||
       !validStoredIdentifier(state.lifecycle.owner.runId) ||
       !validStoredIdentifier(state.lifecycle.owner.rootSkill) ||
       !validStoredIdentifier(state.lifecycle.owner.skill) ||
       !validStoredRelativePath(state.lifecycle.owner.logPath) ||
       (state.lifecycle.afterRecorded && !state.lifecycle.beforeRecorded))) {
    fail('invalid-state', 'rehydration lifecycle receipt is invalid');
  }
  if (state.degradedReason !== undefined && !validStoredIdentifier(state.degradedReason)) {
    fail('invalid-state', 'degraded reason is invalid');
  }
  if (state.degradedAgentStopBlocks !== undefined &&
      (!Number.isSafeInteger(state.degradedAgentStopBlocks) ||
       state.degradedAgentStopBlocks < 0 ||
       state.degradedAgentStopBlocks > MAX_AGENT_STOP_BLOCKS)) {
    fail('invalid-state', 'degraded agent-stop counter is invalid');
  }
  if (state.stack.length > MAX_FRAMES) fail('invalid-state', 'active stack exceeds its bound');
  for (const frame of state.stack) validateStoredFrame(frame);

  if (state.status === STATES.active && state.stack.length === 0) {
    fail('invalid-state', 'active state has no active run');
  }
  if ((state.status === STATES.active || state.status === STATES.rehydrated) &&
      state.generation > 0 &&
      state.lastCompletedGeneration !== state.generation) {
    fail('invalid-state', 'non-required state has an uncompleted generation');
  }
  if (state.status === STATES.degraded) {
    if (state.latch !== undefined || state.degradedReason === undefined) {
      fail('invalid-state', 'degraded state is inconsistent');
    }
  } else if (state.degradedReason !== undefined || state.degradedAgentStopBlocks !== undefined) {
    fail('invalid-state', 'non-degraded state carries degraded fields');
  }

  if (state.status === STATES.required) {
    if (!state.latch || typeof state.latch !== 'object' || Array.isArray(state.latch) ||
        state.stack.length === 0 ||
        !Number.isSafeInteger(state.latch.generation) ||
        state.latch.generation !== state.generation ||
        state.generation < 1 ||
        !LATCH_TRIGGERS.has(state.latch.trigger) ||
        !validStoredTimestamp(state.latch.armedAt) ||
        !Array.isArray(state.latch.remaining) ||
        state.latch.remaining.length === 0 ||
        !Number.isSafeInteger(state.latch.agentStopBlocks) ||
        state.latch.agentStopBlocks < 0 ||
        state.latch.agentStopBlocks > MAX_AGENT_STOP_BLOCKS ||
        typeof state.latch.enforcementRecorded !== 'boolean' ||
        state.lifecycle === undefined) {
      fail('invalid-state', 'rehydration latch is invalid');
    }
    if (state.lastCompletedGeneration !== undefined &&
        state.lastCompletedGeneration >= state.generation) {
      fail('invalid-state', 'armed generation is already marked complete');
    }
    const canonicalSequence = state.stack.flatMap((frame) =>
      frame.files.map((file) => ({ ...file, runId: frame.runId, skill: frame.skill })));
    if (state.latch.remaining.length > canonicalSequence.length) {
      fail('invalid-state', 'rehydration latch exceeds the canonical read set');
    }
    const offset = canonicalSequence.length - state.latch.remaining.length;
    for (let index = 0; index < state.latch.remaining.length; index += 1) {
      const file = state.latch.remaining[index];
      validateStoredFile(file, true);
      if (!sameOwnedFile(file, canonicalSequence[offset + index])) {
        fail('invalid-state', 'rehydration latch is not the canonical unread suffix');
      }
    }
  } else if (state.latch !== undefined) {
    fail('invalid-state', 'rehydration latch exists outside required state');
  }
  return state;
}

function ensureSafeStateDirectory(repositoryRoot) {
  const root = canonicalRoot(repositoryRoot);
  const logDirectory = path.join(root, '.skill-log');
  const stateDirectory = path.join(logDirectory, 'rehydration');
  for (const directory of [logDirectory, stateDirectory]) {
    if (!fs.existsSync(directory)) continue;
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail('invalid-state', `${path.relative(root, directory)} must be a real directory`);
    }
  }
  return stateDirectory;
}

function readStateUnlocked(repositoryRoot, sessionId) {
  ensureSafeStateDirectory(repositoryRoot);
  const target = statePath(repositoryRoot, sessionId);
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('invalid-state', 'state path is unsafe');
  return validateState(JSON.parse(fs.readFileSync(target, 'utf8')), sessionId);
}

export function readState(repositoryRoot, sessionId) {
  return readStateUnlocked(repositoryRoot, sessionId);
}

function writeStateUnlocked(repositoryRoot, state) {
  const target = statePath(repositoryRoot, state.sessionId);
  validateState(state);
  const directory = ensureSafeStateDirectory(repositoryRoot);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.next-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
  return target;
}

export function writeState(repositoryRoot, state) {
  return withStateLock(repositoryRoot, () => writeStateUnlocked(repositoryRoot, state));
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function removeLock(lock, expectedToken, expectedIno) {
  try {
    if (expectedIno !== undefined && fs.statSync(lock).ino !== expectedIno) return false;
    if (expectedToken !== undefined) {
      const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
      if (owner.token !== expectedToken) return false;
    }
    const removed = `${lock}.removed-${process.pid}-${crypto.randomUUID()}`;
    fs.renameSync(lock, removed);
    fs.rmSync(removed, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function withStateLock(repositoryRoot, operation) {
  const directory = ensureSafeStateDirectory(repositoryRoot);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  const token = crypto.randomUUID();
  while (true) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      fs.writeFileSync(
        path.join(lock, 'owner.json'),
        JSON.stringify({ pid: process.pid, token }),
        { mode: 0o600 },
      );
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        let ownerAlive = false;
        let ownerKnown = false;
        let ownerToken;
        const observed = fs.statSync(lock);
        try {
          const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
          if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
            ownerKnown = true;
            ownerToken = owner.token;
            process.kill(owner.pid, 0);
            ownerAlive = true;
          }
        } catch (ownerError) {
          if (ownerError.code === 'EPERM') ownerAlive = true;
        }
        if (!ownerAlive && (ownerKnown || Date.now() - observed.mtimeMs > LOCK_STALE_MS)) {
          removeLock(lock, ownerToken, observed.ino);
          continue;
        }
      } catch (inspectError) {
        if (inspectError.code === 'ENOENT') continue;
        throw inspectError;
      }
      if (Date.now() >= deadline) fail('state-lock-timeout', 'rehydration state lock is busy');
      sleep(10);
    }
  }
  try {
    return operation();
  } finally {
    removeLock(lock, token);
  }
}

function pendingPath(root) {
  return path.join(ensureSafeStateDirectory(root), 'pending.json');
}

function readPending(root) {
  const target = pendingPath(root);
  if (!fs.existsSync(target)) return [];
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail('invalid-state', 'pending run registry path is unsafe');
  }
  const value = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!Array.isArray(value) || value.length > MAX_PENDING_RUNS) fail('invalid-state', 'pending run registry is invalid');
  for (const frame of value) {
    validateStoredFrame(frame);
    if (frame.sessionId !== undefined && !validStoredIdentifier(frame.sessionId)) {
      fail('invalid-state', 'pending run session identity is invalid');
    }
  }
  return value;
}

function writePending(root, pending) {
  const target = pendingPath(root);
  const temporary = `${target}.next-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(pending)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

function mutateRegistration(root, sessionId, input, preparedFrame) {
  const state = readStateUnlocked(root, sessionId) ?? {
    schema: STATE_SCHEMA, sessionId, generation: 0, status: STATES.active, stack: [],
  };
  const key = `${input.runId}:${input.skill}`;
  if (input.phase === 'before') {
    if (!state.stack.some((frame) => `${frame.runId}:${frame.skill}` === key)) {
      if (state.stack.length >= MAX_FRAMES) fail('bounded-state-exceeded', 'active stack is full');
      const frame = preparedFrame ?? {
          runId: requireIdentifier(input.runId, 'runId'),
          rootSkill: requireIdentifier(input.rootSkill, 'rootSkill'),
          skill: requireIdentifier(input.skill, 'skill'),
          logPath: relativePath(root, path.resolve(input.logPath)),
          files: buildCanonicalManifest(root, input.skill),
          checkpoint: { event: 'run', phase: 'before' },
        };
      state.stack.push(frame);
      if (state.latch) {
        state.latch.remaining.push(...frame.files.map((file) => ({
          ...file,
          runId: frame.runId,
          skill: frame.skill,
        })));
      }
    }
    if (state.status !== STATES.degraded) {
      state.status = state.latch ? STATES.required : STATES.active;
      delete state.degradedReason;
    }
  } else if (input.phase === 'after') {
    const index = state.stack.findLastIndex((frame) => `${frame.runId}:${frame.skill}` === key);
    if (index >= 0) {
      state.stack.splice(index, 1);
      if (state.latch) {
        state.status = STATES.degraded;
        state.degradedReason = state.stack.length === 0
          ? 'all-runs-ended-during-rehydration'
          : 'active-run-ended-during-rehydration';
        state.degradedAgentStopBlocks = 0;
        state.latch = undefined;
      }
    }
    if (state.status !== STATES.degraded) {
      state.status = state.latch
        ? STATES.required
        : state.stack.length > 0 ? STATES.active : STATES.rehydrated;
    }
  } else {
    fail('invalid-input', 'run phase must be before or after');
  }
  state.updatedAt = new Date().toISOString();
  return writeStateUnlocked(root, state);
}

export function registerRun(input) {
  const root = canonicalRoot(input.repositoryRoot);
  return withStateLock(root, () => {
    if (input.sessionId) {
      return mutateRegistration(root, requireIdentifier(input.sessionId, 'sessionId'), input);
    }
    const registry = readPending(root);
    const logPath = relativePath(root, path.resolve(input.logPath));
    const correlated = registry.find((frame) =>
      frame.sessionId && frame.runId === input.runId &&
      frame.rootSkill === input.rootSkill && frame.logPath === logPath);
    if (correlated) {
      const result = mutateRegistration(root, correlated.sessionId, input);
      const key = `${input.runId}:${input.skill}`;
      if (input.phase === 'before' && !registry.some((frame) => `${frame.runId}:${frame.skill}` === key)) {
        registry.push({ ...readStateUnlocked(root, correlated.sessionId).stack.at(-1), sessionId: correlated.sessionId });
      } else if (input.phase === 'after') {
        const index = registry.findLastIndex((frame) => `${frame.runId}:${frame.skill}` === key);
        if (index >= 0) registry.splice(index, 1);
      }
      writePending(root, registry);
      return result;
    }
    const key = `${input.runId}:${input.skill}`;
    if (input.phase === 'before' && !registry.some((frame) => `${frame.runId}:${frame.skill}` === key)) {
      if (registry.length >= MAX_PENDING_RUNS) fail('bounded-state-exceeded', 'pending run registry is full');
      registry.push({
        runId: requireIdentifier(input.runId, 'runId'),
        rootSkill: requireIdentifier(input.rootSkill, 'rootSkill'),
        skill: requireIdentifier(input.skill, 'skill'),
        logPath,
        files: buildCanonicalManifest(root, input.skill),
        checkpoint: { event: 'run', phase: 'before' },
      });
    } else if (input.phase === 'after') {
      const index = registry.findLastIndex((frame) => `${frame.runId}:${frame.skill}` === key);
      if (index >= 0) registry.splice(index, 1);
    } else if (input.phase !== 'before') {
      fail('invalid-input', 'run phase must be before or after');
    }
    writePending(root, registry);
    return pendingPath(root);
  });
}

export function updateCheckpoint(input) {
  return withStateLock(input.repositoryRoot, () => {
  let sessionId = input.sessionId;
  if (!sessionId) {
    sessionId = readPending(input.repositoryRoot).find(
      (frame) => frame.sessionId && frame.runId === input.runId && frame.skill === input.skill,
    )?.sessionId;
  }
  if (!sessionId) return null;
  const state = readStateUnlocked(input.repositoryRoot, sessionId);
  if (!state || state.stack.length === 0) return null;
  const frame = [...state.stack].reverse().find(
    (candidate) => candidate.runId === input.runId && candidate.skill === input.skill,
  );
  if (!frame) return null;
  frame.checkpoint = {
    event: requireIdentifier(input.event, 'event'),
    phase: requireIdentifier(input.phase, 'phase'),
    ...(input.operation ? { operation: requireIdentifier(input.operation, 'operation') } : {}),
    ...(input.outcome ? { outcome: requireIdentifier(input.outcome, 'outcome') } : {}),
  };
  state.updatedAt = new Date().toISOString();
  return writeStateUnlocked(input.repositoryRoot, state);
  });
}

function armUnlocked(input) {
  const state = readStateUnlocked(input.repositoryRoot, input.sessionId);
  if (!state || state.stack.length === 0) return { status: 'inactive' };
  if (state.status === STATES.degraded) {
    return { status: STATES.degraded, reason: state.degradedReason };
  }
  state.generation += 1;
  state.status = STATES.compacting;
  state.lifecycle = lifecycleReceipt(state.generation, state.stack[0]);
  const files = state.stack.flatMap((frame) =>
    frame.files.map((file) => ({ ...file, skill: frame.skill, runId: frame.runId })));
  state.latch = {
    generation: state.generation,
    trigger: input.trigger,
    armedAt: new Date(input.timestamp ?? Date.now()).toISOString(),
    remaining: files,
    agentStopBlocks: 0,
    enforcementRecorded: false,
  };
  state.status = STATES.required;
  state.updatedAt = new Date().toISOString();
  writeStateUnlocked(input.repositoryRoot, state);
  return { status: state.status, generation: state.generation, files: files.map((file) => file.path) };
}

export function arm(input) {
  return withStateLock(input.repositoryRoot, () => {
    return armUnlocked(input);
  });
}

function correlateSessionUnlocked(root, sessionId) {
  requireIdentifier(sessionId, 'sessionId');
  const existing = readStateUnlocked(root, sessionId);
  let pending;
  try {
    pending = readPending(root);
  } catch {
    if (existing?.status === STATES.degraded) {
      return {
        status: STATES.degraded,
        reason: existing.degradedReason,
      };
    }
    if (existing?.latch) {
      return degradeUnlocked(root, existing, 'pending-registry-invalid');
    }
    const state = {
      schema: STATE_SCHEMA,
      sessionId,
      generation: existing?.generation ?? 0,
      ...(existing?.lastCompletedGeneration !== undefined
        ? { lastCompletedGeneration: existing.lastCompletedGeneration }
        : {}),
      status: STATES.degraded,
      stack: existing?.stack ?? [],
      ...(existing?.lifecycle
        ? { lifecycle: existing.lifecycle }
        : lifecycleReceipt(existing?.generation ?? 0, existing?.stack?.[0])
          ? { lifecycle: lifecycleReceipt(existing?.generation ?? 0, existing.stack[0]) }
          : {}),
      degradedReason: 'pending-registry-invalid',
      degradedAgentStopBlocks: 0,
      updatedAt: new Date().toISOString(),
    };
    writeStateUnlocked(root, state);
    return { status: STATES.degraded, reason: state.degradedReason };
  }
  const unclaimed = pending.filter((frame) => !frame.sessionId);
  const rootKey = (frame) => `${frame.runId}:${frame.rootSkill}:${frame.logPath}`;
  const terminal = existing?.status === STATES.rehydrated &&
    existing.stack.length === 0 &&
    !existing.latch;
  if (existing?.status === STATES.degraded) {
    return { status: STATES.degraded, reason: existing.degradedReason };
  }

  let candidates = unclaimed;
  if (existing && !terminal && existing.stack.length > 0) {
    const compatibleRoot = rootKey(existing.stack[0]);
    candidates = unclaimed.filter((frame) => rootKey(frame) === compatibleRoot);
  }

  if (candidates.length === 0) {
    if (existing?.status === STATES.degraded) {
      return { status: STATES.degraded, reason: existing.degradedReason };
    }
    return { status: existing ? 'correlated' : 'none' };
  }

  const roots = new Set(candidates.map(rootKey));
  if (roots.size !== 1) {
    const state = {
      schema: STATE_SCHEMA,
      sessionId,
      generation: existing?.generation ?? 0,
      status: STATES.degraded,
      stack: existing?.stack ?? [],
      ...(existing?.lifecycle
        ? { lifecycle: existing.lifecycle }
        : lifecycleReceipt(existing?.generation ?? 0, existing?.stack?.[0])
          ? { lifecycle: lifecycleReceipt(existing?.generation ?? 0, existing.stack[0]) }
          : {}),
      degradedReason: 'ambiguous-active-runs',
      degradedAgentStopBlocks: 0,
      updatedAt: new Date().toISOString(),
    };
    writeStateUnlocked(root, state);
    return { status: STATES.degraded, reason: state.degradedReason };
  }

  const claimed = candidates.map(({ sessionId: _ignored, ...frame }) => frame);
  let state;
  if (!existing || terminal) {
    state = {
      schema: STATE_SCHEMA,
      sessionId,
      generation: existing?.generation ?? 0,
      ...(existing?.lastCompletedGeneration !== undefined
        ? { lastCompletedGeneration: existing.lastCompletedGeneration }
        : {}),
      status: STATES.active,
      stack: claimed,
      updatedAt: new Date().toISOString(),
    };
  } else {
    const existingKeys = new Set(existing.stack.map((frame) => `${frame.runId}:${frame.skill}`));
    const additions = claimed.filter((frame) => !existingKeys.has(`${frame.runId}:${frame.skill}`));
    if (existing.stack.length + additions.length > MAX_FRAMES) {
      fail('bounded-state-exceeded', 'active stack is full');
    }
    existing.stack.push(...additions);
    if (existing.latch) {
      existing.latch.remaining.push(...additions.flatMap((frame) =>
        frame.files.map((file) => ({ ...file, runId: frame.runId, skill: frame.skill }))));
    }
    existing.status = existing.latch ? STATES.required : STATES.active;
    delete existing.degradedReason;
    existing.updatedAt = new Date().toISOString();
    state = existing;
  }
  writeStateUnlocked(root, state);
  const candidateKeys = new Set(candidates.map((frame) => `${frame.runId}:${frame.skill}:${frame.logPath}`));
  writePending(root, pending.map((frame) =>
    !frame.sessionId && candidateKeys.has(`${frame.runId}:${frame.skill}:${frame.logPath}`)
      ? { ...frame, sessionId }
      : frame));
  return { status: 'correlated' };
}

export function correlateSession(repositoryRoot, sessionId) {
  const root = canonicalRoot(repositoryRoot);
  return withStateLock(root, () => correlateSessionUnlocked(root, sessionId));
}

export function resumeSession(input) {
  const root = canonicalRoot(input.repositoryRoot);
  return withStateLock(root, () => {
    const correlation = correlateSessionUnlocked(root, input.sessionId);
    if (correlation.status === STATES.degraded) return correlation;
    const state = readStateUnlocked(root, input.sessionId);
    if (!state || state.stack.length === 0) return { status: 'inactive' };
    if (state.status === STATES.required && state.latch) {
      return {
        status: state.status,
        generation: state.generation,
        files: state.latch.remaining.map((file) => file.path),
      };
    }
    return armUnlocked({ ...input, repositoryRoot: root, trigger: 'resume' });
  });
}

export function expectedRead(repositoryRoot, sessionId) {
  const state = readState(repositoryRoot, sessionId);
  if (state?.status === STATES.degraded) {
    return { status: STATES.degraded, reason: state.degradedReason };
  }
  if (!state?.latch || state.status !== STATES.required) return { status: 'inactive' };
  return { status: state.status, generation: state.generation, file: state.latch.remaining[0] };
}

export function noteEnforcement(repositoryRoot, sessionId) {
  return withStateLock(repositoryRoot, () => {
  const state = readStateUnlocked(repositoryRoot, sessionId);
  if (!state?.latch || state.latch.enforcementRecorded) return false;
  state.latch.enforcementRecorded = true;
  writeStateUnlocked(repositoryRoot, state);
  return true;
  });
}

export function appendLifecycleRecord(repositoryRoot, sessionId, generation, phase, callbacks) {
  if (!callbacks || typeof callbacks.hasRecord !== 'function' ||
      typeof callbacks.append !== 'function') {
    fail('invalid-input', 'lifecycle recording callbacks are required');
  }
  return withStateLock(repositoryRoot, () => {
    const state = readStateUnlocked(repositoryRoot, sessionId);
    if (!state?.lifecycle || state.lifecycle.generation !== generation) return false;
    if (phase !== 'before' && phase !== 'after') {
      fail('invalid-input', 'lifecycle phase must be before or after');
    }

    const phaseRecorded = callbacks.hasRecord(phase);
    const beforeRecorded = phase === 'before'
      ? phaseRecorded
      : callbacks.hasRecord('before');
    if (phase === 'after' && !beforeRecorded) return false;

    if (phaseRecorded) {
      state.lifecycle.beforeRecorded ||= phase === 'before' || beforeRecorded;
      state.lifecycle.afterRecorded ||= phase === 'after';
      state.updatedAt = new Date().toISOString();
      writeStateUnlocked(repositoryRoot, state);
      return false;
    }
    if (phase === 'before' && state.lifecycle.afterRecorded) return false;

    callbacks.append();
    state.lifecycle.beforeRecorded ||= phase === 'before' || beforeRecorded;
    state.lifecycle.afterRecorded ||= phase === 'after';
    state.updatedAt = new Date().toISOString();
    writeStateUnlocked(repositoryRoot, state);
    return true;
  });
}

export function acknowledgeRead(input) {
  const root = canonicalRoot(input.repositoryRoot);
  return withStateLock(root, () => {
  const state = readStateUnlocked(root, input.sessionId);
  if (!state?.latch || state.status !== STATES.required) return { status: 'inactive' };
  if (input.generation !== state.generation) {
    return { status: STATES.required, reason: 'stale-packet' };
  }
  const expected = state.latch.remaining[0];
  if (!expected || input.relativePath !== expected.path ||
      (input.runId !== undefined && input.runId !== expected.runId) ||
      (input.skill !== undefined && input.skill !== expected.skill)) {
    return degradeUnlocked(root, state, 'wrong-identity');
  }
  if (!input.resultEvidence || typeof input.resultEvidence !== 'object' ||
      Array.isArray(input.resultEvidence)) {
    return degradeUnlocked(root, state, 'tool-result-malformed');
  }
  if (input.resultEvidence.status === 'not-success') {
    return degradeUnlocked(root, state, 'tool-result-not-success');
  }
  if (input.resultEvidence.status !== 'success' ||
      !Number.isSafeInteger(input.resultEvidence.bytes) ||
      input.resultEvidence.bytes < 0 ||
      !SHA256.test(input.resultEvidence.digest)) {
    return degradeUnlocked(root, state, 'tool-result-malformed');
  }
  if (input.resultEvidence.bytes !== expected.bytes ||
      input.resultEvidence.digest !== expected.digest) {
    return degradeUnlocked(root, state, 'tool-result-content-mismatch');
  }
  let current;
  try {
    current = readCanonicalFile(root, expected.path);
  } catch {
    return degradeUnlocked(root, state, 'missing-instructions');
  }
  if (current.digest !== expected.digest) return degradeUnlocked(root, state, 'digest-drift');
  state.latch.remaining.shift();
  state.updatedAt = new Date().toISOString();
  if (state.latch.remaining.length > 0) {
    writeStateUnlocked(root, state);
    return { status: STATES.required, next: state.latch.remaining[0] };
  }
  let checkpoint;
  try {
    checkpoint = renderCheckpoint(state);
  } catch (error) {
    if (error.code === 'bounded-state-exceeded') return degradeUnlocked(root, state, 'checkpoint-too-large');
    throw error;
  }
  state.status = STATES.rehydrated;
  state.lastCompletedGeneration = state.generation;
  state.latch = undefined;
  writeStateUnlocked(root, state);
  return { status: STATES.rehydrated, checkpoint };
  });
}

function degrade(root, state, reason) {
  return withStateLock(root, () => degradeUnlocked(root, state, reason));
}

function degradeUnlocked(root, state, reason) {
  state.status = STATES.degraded;
  state.degradedReason = reason;
  state.degradedAgentStopBlocks = 0;
  state.latch = undefined;
  state.updatedAt = new Date().toISOString();
  writeStateUnlocked(root, state);
  return { status: STATES.degraded, reason };
}

export function agentStopFallback(repositoryRoot, sessionId, stopHookActive) {
  return withStateLock(repositoryRoot, () => {
  const state = readStateUnlocked(repositoryRoot, sessionId);
  if (state?.status === STATES.degraded) {
    if (stopHookActive) {
      return { decision: 'allow', degraded: true, reason: state.degradedReason };
    }
    const blocks = state.degradedAgentStopBlocks ?? 0;
    if (blocks < MAX_AGENT_STOP_BLOCKS) {
      state.degradedAgentStopBlocks = blocks + 1;
      state.updatedAt = new Date().toISOString();
      writeStateUnlocked(repositoryRoot, state);
      return {
        decision: 'block',
        degraded: true,
        reason:
          `Compaction rehydration is degraded (${state.degradedReason}). ` +
          'Stop material work and report this persisted failure before ending.',
      };
    }
    return { decision: 'allow', degraded: true, reason: state.degradedReason };
  }
  if (!state?.latch || state.status !== STATES.required) return { decision: 'allow' };
  if (stopHookActive || state.latch.agentStopBlocks >= MAX_AGENT_STOP_BLOCKS) {
    state.status = STATES.degraded;
    state.degradedReason = 'agent-stop-ceiling-avoided';
    state.degradedAgentStopBlocks = MAX_AGENT_STOP_BLOCKS;
    state.latch = undefined;
    writeStateUnlocked(repositoryRoot, state);
    return { decision: 'allow', degraded: true };
  }
  state.latch.agentStopBlocks += 1;
  writeStateUnlocked(repositoryRoot, state);
  return {
    decision: 'block',
    reason: `Compaction rehydration is still required. Read the next canonical file exactly: ${state.latch.remaining[0].path}`,
  };
  });
}

export function renderCheckpoint(state) {
  const packet = {
    kind: 'compaction-rehydration-checkpoint',
    generation: state.generation,
    sessionId: state.sessionId,
    rootRun: state.stack[0]?.runId,
    activeStack: state.stack.map((frame) => ({
      runId: frame.runId,
      rootSkill: frame.rootSkill,
      skill: frame.skill,
      checkpoint: frame.checkpoint,
    })),
    instruction: 'Resume the existing run. The reads above rehydrate instructions; do not invoke those skills again.',
  };
  const text = JSON.stringify(packet);
  if (Buffer.byteLength(text, 'utf8') > MAX_CHECKPOINT_BYTES) {
    fail('bounded-state-exceeded', 'rehydration checkpoint exceeds its bound');
  }
  return text;
}
