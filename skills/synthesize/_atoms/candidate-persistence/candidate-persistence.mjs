#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class CandidatePersistenceError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'CandidatePersistenceError';
    this.code = code;
    this.detail = detail;
  }
}

const DIGEST = /^[0-9a-f]{64}$/;
const CANDIDATE = /^docs\/agent\/specs\/[a-z0-9]+(?:-[a-z0-9]+)*\.nano\.md$/;

function revisionOf(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function inspectDestination(io, destination) {
  try {
    const stat = io.lstat(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new CandidatePersistenceError('unsafe-path', 'candidate destination must be a regular file');
    }
    return { exists: true };
  } catch (error) {
    if (error instanceof CandidatePersistenceError) throw error;
    if (error?.code === 'ENOENT') return { exists: false, revision: null };
    throw new CandidatePersistenceError('unsafe-path', 'candidate destination cannot be inspected', { filesystemCode: error?.code ?? 'unknown' });
  }
}

function assertSafeComponents(io, root, destination) {
  const relative = path.relative(root, destination);
  let current = root;
  for (const segment of relative.split(path.sep).slice(0, -1)) {
    current = path.join(current, segment);
    try {
      if (io.lstat(current).isSymbolicLink()) {
        throw new CandidatePersistenceError('unsafe-path', `candidate path passes through a symbolic link: ${path.relative(root, current)}`);
      }
    } catch (error) {
      if (error instanceof CandidatePersistenceError) throw error;
      if (error?.code === 'ENOENT') return;
      throw new CandidatePersistenceError('unsafe-path', 'candidate path component cannot be inspected', { filesystemCode: error?.code ?? 'unknown' });
    }
  }
}

function assertInputs({ repositoryRoot, candidatePath, candidateText, outcome, runId }) {
  if (!path.isAbsolute(repositoryRoot)
    || typeof candidatePath !== 'string'
    || !CANDIDATE.test(candidatePath)
    || typeof candidateText !== 'string'
    || !outcome || typeof outcome !== 'object'
    || typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(runId)) {
    throw new CandidatePersistenceError('invalid-input', 'candidate persistence input is incomplete or outside the profile destination');
  }
  if (outcome.status !== 'complete') {
    throw new CandidatePersistenceError('outcome-not-persistable', `outcome ${outcome.status ?? 'missing'} cannot persist a canonical candidate`);
  }
  if (outcome.candidate?.path !== candidatePath
    || !DIGEST.test(String(outcome.candidate?.digest))
    || revisionOf(Buffer.from(candidateText, 'utf8')) !== outcome.candidate.digest) {
    throw new CandidatePersistenceError('candidate-receipt-mismatch', 'candidate bytes or path do not match the validated outcome receipt');
  }
}

export function persistCandidate(input, {
  io = {
    lstat: (value) => fs.lstatSync(value),
    read: (value) => fs.readFileSync(value),
    mkdir: (value) => fs.mkdirSync(value, { recursive: true }),
    write: (value, bytes) => fs.writeFileSync(value, bytes, { flag: 'wx' }),
    link: (from, to) => fs.linkSync(from, to),
    unlink: (value) => fs.unlinkSync(value),
  },
  uuid = randomUUID,
} = {}) {
  assertInputs(input);
  const { repositoryRoot, candidatePath, candidateText, runId } = input;
  const destination = path.resolve(repositoryRoot, candidatePath);
  const root = path.resolve(repositoryRoot);
  let rootStat;
  let canonicalRoot;
  try {
    rootStat = fs.lstatSync(root);
    canonicalRoot = fs.realpathSync(root);
  } catch (error) {
    throw new CandidatePersistenceError('unsafe-path', 'repository root cannot be inspected', { filesystemCode: error?.code ?? 'unknown' });
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || canonicalRoot !== root) {
    throw new CandidatePersistenceError('unsafe-path', 'repository root must be an existing canonical directory without symbolic links');
  }
  if (!destination.startsWith(`${root}${path.sep}`)) {
    throw new CandidatePersistenceError('invalid-input', 'candidate destination escapes the repository root');
  }

  const bytes = Buffer.from(candidateText, 'utf8');
  const intendedRevision = revisionOf(bytes);
  let staged;
  let stagedCreated = false;
  try {
    assertSafeComponents(io, root, destination);
    if (inspectDestination(io, destination).exists) {
      throw new CandidatePersistenceError('replacement-not-authorized', 'candidate already exists; synthesize never overwrites canonical output');
    }
    io.mkdir(path.dirname(destination));
    assertSafeComponents(io, root, destination);
    const nonce = uuid();
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(nonce)) {
      throw new CandidatePersistenceError('invalid-input', 'staging nonce is not a safe path component');
    }
    staged = `${destination}.stage-${runId}-${nonce}`;
    io.write(staged, bytes);
    stagedCreated = true;
    const reread = io.read(staged);
    if (revisionOf(reread) !== intendedRevision) {
      throw new CandidatePersistenceError('verification-failed', 'staged candidate bytes did not verify');
    }
    assertSafeComponents(io, root, destination);
    io.link(staged, destination);
    try {
      io.unlink(staged);
    } catch (cleanup) {
      stagedCreated = false;
      return {
        status: 'persisted',
        candidatePath,
        revision: intendedRevision,
        cleanupWarning: { staged, filesystemCode: cleanup?.code ?? 'unknown' },
      };
    }
    stagedCreated = false;
    return { status: 'persisted', candidatePath, revision: intendedRevision };
  } catch (error) {
    let cleanupError;
    if (stagedCreated && staged) {
      try { io.unlink(staged); } catch (cleanup) { cleanupError = cleanup?.code ?? 'unknown'; }
    }
    if (error instanceof CandidatePersistenceError) {
      if (cleanupError) error.detail = { ...error.detail, cleanupError, staged };
      throw error;
    }
    const code = error?.code === 'EEXIST' ? 'concurrent-modification' : 'staging-failed';
    throw new CandidatePersistenceError(code, 'candidate staging or promotion failed', {
      filesystemCode: error?.code ?? 'unknown',
      ...(cleanupError ? { cleanupError, staged } : {}),
    });
  }
}

export const USAGE = 'Usage: candidate-persistence.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new CandidatePersistenceError('invalid-input', USAGE);
  }
  let input;
  try {
    input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  } catch (error) {
    throw new CandidatePersistenceError('invalid-input', 'candidate persistence input cannot be read or parsed', {
      filesystemCode: error?.code ?? 'unknown',
    });
  }
  streams.stdout.write(`${JSON.stringify(persistCandidate(input), null, 2)}\n`);
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
      error: {
        code: error.code ?? 'staging-failed',
        message: error.message,
        detail: error.detail ?? {},
      },
    })}\n`);
    process.exitCode = 1;
  }
}
