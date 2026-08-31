import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const STATE_SCHEMA = 1;
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

function validateState(state) {
  if (!state || state.schema !== STATE_SCHEMA || !Array.isArray(state.stack)) {
    fail('invalid-state', 'rehydration state is malformed or unsupported');
  }
  requireIdentifier(state.sessionId, 'sessionId');
  if (state.stack.length > MAX_FRAMES) fail('invalid-state', 'active stack exceeds its bound');
  for (const frame of state.stack) {
    requireIdentifier(frame.runId, 'runId');
    requireIdentifier(frame.rootSkill, 'rootSkill');
    requireIdentifier(frame.skill, 'skill');
    if (!Array.isArray(frame.files) || frame.files.length === 0 || frame.files.length > MAX_FILES) {
      fail('invalid-state', 'frame canonical read set is invalid');
    }
    for (const file of frame.files) {
      if (typeof file.path !== 'string' || Buffer.byteLength(file.path) > MAX_RELATIVE_PATH_BYTES ||
          !SHA256.test(file.digest) || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
        fail('invalid-state', 'frame canonical file identity is invalid');
      }
    }
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
  return validateState(JSON.parse(fs.readFileSync(target, 'utf8')));
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

function withStateLock(repositoryRoot, operation) {
  const directory = ensureSafeStateDirectory(repositoryRoot);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, '.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid }), { mode: 0o600 });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        let ownerAlive = false;
        let ownerKnown = false;
        try {
          const owner = JSON.parse(fs.readFileSync(path.join(lock, 'owner.json'), 'utf8'));
          if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
            ownerKnown = true;
            process.kill(owner.pid, 0);
            ownerAlive = true;
          }
        } catch (ownerError) {
          if (ownerError.code === 'EPERM') ownerAlive = true;
        }
        if (!ownerAlive && (ownerKnown || Date.now() - fs.statSync(lock).mtimeMs > LOCK_STALE_MS)) {
          fs.rmSync(lock, { recursive: true, force: true });
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
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function pendingPath(root) {
  return path.join(ensureSafeStateDirectory(root), 'pending.json');
}

function readPending(root) {
  const target = pendingPath(root);
  if (!fs.existsSync(target)) return [];
  const value = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!Array.isArray(value) || value.length > MAX_PENDING_RUNS) fail('invalid-state', 'pending run registry is invalid');
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
      state.stack.push(preparedFrame ?? {
          runId: requireIdentifier(input.runId, 'runId'),
          rootSkill: requireIdentifier(input.rootSkill, 'rootSkill'),
          skill: requireIdentifier(input.skill, 'skill'),
          logPath: relativePath(root, path.resolve(input.logPath)),
          files: buildCanonicalManifest(root, input.skill),
          checkpoint: { event: 'run', phase: 'before' },
        });
    }
    state.status = state.latch ? STATES.required : STATES.active;
  } else if (input.phase === 'after') {
    const index = state.stack.findLastIndex((frame) => `${frame.runId}:${frame.skill}` === key);
    if (index >= 0) state.stack.splice(index, 1);
    if (state.latch) {
      state.latch.remaining = state.latch.remaining.filter(
        (file) => file.runId !== input.runId || file.skill !== input.skill,
      );
      if (state.latch.remaining.length === 0) state.latch = undefined;
    }
    state.status = state.latch
      ? STATES.required
      : state.stack.length > 0 ? STATES.active : STATES.rehydrated;
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

export function arm(input) {
  return withStateLock(input.repositoryRoot, () => {
  const state = readStateUnlocked(input.repositoryRoot, input.sessionId);
  if (!state || state.stack.length === 0) return { status: 'inactive' };
  state.generation += 1;
  state.status = STATES.compacting;
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
  });
}

export function correlateSession(repositoryRoot, sessionId) {
  const root = canonicalRoot(repositoryRoot);
  requireIdentifier(sessionId, 'sessionId');
  return withStateLock(root, () => {
    if (readStateUnlocked(root, sessionId)) return { status: 'correlated' };
    const pending = readPending(root);
    if (pending.length === 0) return { status: 'none' };
    const roots = new Set(pending.map((frame) => `${frame.runId}:${frame.rootSkill}:${frame.logPath}`));
    if (roots.size !== 1) return { status: STATES.degraded, reason: 'ambiguous-active-runs' };
    const state = {
      schema: STATE_SCHEMA, sessionId, generation: 0, status: STATES.active,
      stack: pending.map(({ sessionId: _ignored, ...frame }) => frame),
      updatedAt: new Date().toISOString(),
    };
    writeStateUnlocked(root, state);
    writePending(root, pending.map((frame) => ({ ...frame, sessionId })));
    return { status: 'correlated' };
  });
}

export function expectedRead(repositoryRoot, sessionId) {
  const state = readState(repositoryRoot, sessionId);
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
  state.latch = undefined;
  state.updatedAt = new Date().toISOString();
  writeStateUnlocked(root, state);
  return { status: STATES.degraded, reason };
}

export function agentStopFallback(repositoryRoot, sessionId, stopHookActive) {
  return withStateLock(repositoryRoot, () => {
  const state = readStateUnlocked(repositoryRoot, sessionId);
  if (!state?.latch || state.status !== STATES.required) return { decision: 'allow' };
  if (stopHookActive || state.latch.agentStopBlocks >= MAX_AGENT_STOP_BLOCKS) {
    state.status = STATES.degraded;
    state.degradedReason = 'agent-stop-ceiling-avoided';
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
