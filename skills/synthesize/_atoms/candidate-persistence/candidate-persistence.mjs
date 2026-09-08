#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveProfile } from '../synthesis-profile/synthesis-profile.mjs';

export class CandidatePersistenceError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'CandidatePersistenceError';
    this.code = code;
    this.detail = detail;
  }
}

const DIGEST = /^[0-9a-f]{64}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Read a receipt field once, as an OWN DATA property, or report its absence.
 *
 * A receipt is evidence, and evidence has to sit on the object. Reading fields
 * with ordinary property access let two things through: a value inherited from a
 * prototype, which is not on the receipt at all, and an accessor that returns the
 * right answer to the check and something else to the use. Both published a
 * candidate whose receipt did not actually say what the code had read.
 *
 * So each field is captured once, from its own descriptor, and every later
 * comparison uses the captured value.
 */
function ownField(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

/**
 * Whether a contract reference is a caller-declared reduction rather than a
 * named profile: either the terms themselves, or the `declared:` id a run
 * reports for them.
 */
function declaresContract(reference) {
  return (reference !== null && typeof reference === 'object' && !Array.isArray(reference))
    || String(reference ?? '').startsWith('declared:');
}

/**
 * The one destination the run's own contract permits.
 *
 * This used to be a regular expression naming `docs/agent/specs/<slug>.nano.md`
 * literally, which worked while one profile existed and would have silently
 * refused every other contract's candidate. It is now derived from the profile
 * the run resolved: the destination is that contract's `outputPattern` with the
 * source's slug, and nothing else is publishable.
 *
 * Deriving it rather than listing it matters more now than it did. A caller may
 * declare its own reduction, so there is no fixed set of destinations to keep a
 * list of; the check that remains meaningful is that the path being written is
 * the path the contract this run obeyed says to write.
 */
export function destinationFor(reference, candidatePath) {
  let profile;
  try {
    profile = resolveProfile(reference);
  } catch {
    return null;
  }
  if (typeof candidatePath !== 'string') return null;
  const parts = profile.outputPattern.split('<slug>');
  if (parts.length !== 2) return null;
  const [prefix, suffix] = parts;
  const posix = candidatePath.split('\\').join('/');
  if (!posix.startsWith(prefix) || !posix.endsWith(suffix)
    || posix.length <= prefix.length + suffix.length) {
    return null;
  }
  const slug = posix.slice(prefix.length, posix.length - suffix.length);
  // The slug grammar admits no separator and no dot, so a match cannot climb out
  // of the destination the pattern names or fan out into a sibling directory.
  return SLUG.test(slug) ? { profileId: profile.id, slug } : null;
}

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

function assertInputs({ repositoryRoot, candidatePath, candidateText, outcome, runId, profile }) {
  if (!path.isAbsolute(repositoryRoot)
    || typeof candidateText !== 'string'
    || !outcome || typeof outcome !== 'object'
    || typeof runId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(runId)) {
    throw new CandidatePersistenceError('invalid-input', 'candidate persistence input is incomplete');
  }
  if (outcome.status !== 'complete') {
    throw new CandidatePersistenceError('outcome-not-persistable', `outcome ${outcome.status ?? 'missing'} cannot persist a canonical candidate`);
  }
  // The contract comes from the validated receipt, and `profile` supplies its
  // terms only when the receipt names a contract that cannot be resolved by name
  // - which is every declared reduction. Reading the contract off the receipt is
  // better provenance than taking it as a separate argument that nothing ties
  // back to the run.
  const contract = ownField(outcome, 'contract');
  const candidate = ownField(outcome, 'candidate');
  const reference = profile ?? contract;
  const destination = destinationFor(reference, candidatePath);
  if (destination === null) {
    // A `declared:` id names terms that cannot be fetched back by name, so a
    // declared run needs its contract handed over whichever slot the id arrived
    // in. Saying which of the two things went wrong is the difference between a
    // caller fixing the call and a caller hunting a path bug that is not there.
    throw new CandidatePersistenceError(
      'invalid-input',
      String(reference ?? '').startsWith('declared:')
        ? 'a declared contract cannot be resolved by name; supply its terms as profile'
        : "the candidate is not the destination this run's contract names",
    );
  }
  // A declared reduction MUST carry the validated contract id on its receipt.
  //
  // Checking the receipt only when it happened to name a contract left the case
  // that matters wide open: a receipt with no contract evidence, published with
  // whatever terms the caller handed in. Two declared contracts can name the same
  // destination while differing in budget, required content, or what may never be
  // dropped, so a candidate validated under strict terms could be published under
  // weaker ones and nothing would notice. Absent evidence is not permission.
  //
  // Named profiles keep their original receipt semantics, in which the receipt
  // carried a path and a digest and no contract. That is safe for a different
  // reason rather than by oversight: a declared workspace must sit beneath the
  // one root declared reductions have, so no declared destination can ever
  // collide with a named profile's, and the named reference cannot be standing in
  // for a declared run. A present contract is still compared.
  if (declaresContract(reference) && !isNonEmptyString(contract)) {
    throw new CandidatePersistenceError(
      'contract-evidence-missing',
      'a declared reduction publishes only from a receipt naming the contract it was validated under',
    );
  }
  if (isNonEmptyString(contract) && destination.profileId !== contract) {
    throw new CandidatePersistenceError(
      'contract-mismatch',
      `the receipt was validated under ${contract}; publication was asked for under ${destination.profileId}`,
    );
  }
  const candidatePathClaim = candidate === null || typeof candidate !== 'object'
    ? undefined
    : ownField(candidate, 'path');
  const candidateDigestClaim = candidate === null || typeof candidate !== 'object'
    ? undefined
    : ownField(candidate, 'digest');
  if (candidatePathClaim !== candidatePath
    || !DIGEST.test(String(candidateDigestClaim))
    || revisionOf(Buffer.from(candidateText, 'utf8')) !== candidateDigestClaim) {
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
