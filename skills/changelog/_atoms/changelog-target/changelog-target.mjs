/**
 * Deterministic changelog target resolution and write safety.
 *
 * The original package wrote to a fixed path at the repository root. It now
 * writes to a path it computed, possibly from input supplied by a calling
 * skill or read out of issue text. That is a materially different risk: a
 * lexical path shown in an approval packet is not proof of where the bytes
 * actually land.
 *
 * Everything here is deterministic so it can be tested against the cases that
 * matter — traversal, absolute escapes, symlinked components, and a target
 * that changed between approval and write.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAILURES = {
  usage: 'usage',
  outsideRepository: 'outside_repository',
  symlinkComponent: 'symlink_component',
  notRegularFile: 'not_regular_file',
  approvalMismatch: 'approval_mismatch',
  nestedPublication: 'nested_publication',
};

export class TargetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Filenames recognized as a changelog, matched case-insensitively. */
const CHANGELOG_NAMES = ['CHANGELOG.md', 'CHANGELOG.markdown', 'CHANGES.md', 'HISTORY.md'];

export function isChangelogName(name) {
  return CHANGELOG_NAMES.some((candidate) => candidate.toLowerCase() === name.toLowerCase());
}

/**
 * Resolve a candidate path and prove it is safe to write.
 *
 * Containment is checked against the *real* repository root and the *real*
 * resolved target, because `realpath` is what the filesystem will follow. A
 * check against the lexical path would approve `docs/CHANGELOG.md` while the
 * bytes went wherever a symlink pointed.
 */
export function resolveTarget(repositoryRoot, candidate, { mustExist = false } = {}) {
  if (typeof repositoryRoot !== 'string' || !repositoryRoot) {
    throw new TargetError(FAILURES.usage, 'repositoryRoot is required');
  }
  if (typeof candidate !== 'string' || !candidate) {
    throw new TargetError(FAILURES.usage, 'candidate path is required');
  }

  const realRoot = fs.realpathSync(repositoryRoot);
  const absolute = path.resolve(realRoot, candidate);

  // Reject every symlink in the existing prefix, not just the leaf. A symlinked
  // parent directory redirects the write exactly as effectively as a symlinked
  // file, and is easier to miss.
  const relative = path.relative(realRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new TargetError(
      FAILURES.outsideRepository,
      `target resolves outside the repository: ${absolute}`,
    );
  }

  let walked = realRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    walked = path.join(walked, segment);
    let stat;
    try {
      stat = fs.lstatSync(walked);
    } catch {
      break; // Does not exist yet; nothing further to verify on this path.
    }
    if (stat.isSymbolicLink()) {
      throw new TargetError(
        FAILURES.symlinkComponent,
        `path component is a symbolic link: ${walked}`,
      );
    }
  }

  const exists = fs.existsSync(absolute);
  if (exists) {
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile()) {
      throw new TargetError(FAILURES.notRegularFile, `target is not a regular file: ${absolute}`);
    }
    // Re-verify containment after resolution, in case the leaf itself resolves
    // elsewhere despite surviving the component walk.
    const realTarget = fs.realpathSync(absolute);
    const realRelative = path.relative(realRoot, realTarget);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new TargetError(
        FAILURES.outsideRepository,
        `target resolves outside the repository: ${realTarget}`,
      );
    }
  }

  if (mustExist && !exists) {
    throw new TargetError(FAILURES.usage, `target does not exist: ${absolute}`);
  }

  return {
    canonicalPath: absolute,
    relativePath: relative.split(path.sep).join('/'),
    exists,
    contentHash: exists ? hash(fs.readFileSync(absolute)) : null,
  };
}

/**
 * Hash raw bytes, never decoded text.
 *
 * Decoding first would let two different byte sequences that both contain
 * invalid UTF-8 collapse to the same replacement characters and therefore the
 * same hash, which would make a real content change invisible to the binding.
 */
export function hash(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Bind an approval to exactly what was approved.
 *
 * Without this, approval covers a path and a patch that were true when they
 * were displayed. Between display and write the file can change or the path
 * can be replaced, and the previously approved patch would then be applied to
 * something nobody read.
 */
export function buildApproval({ canonicalPath, contentHash, patch, nested }) {
  if (typeof canonicalPath !== 'string' || !canonicalPath) {
    throw new TargetError(FAILURES.usage, 'canonicalPath is required');
  }
  if (typeof patch !== 'string') {
    throw new TargetError(FAILURES.usage, 'patch is required');
  }
  return {
    canonicalPath,
    contentHash: contentHash ?? null,
    patchHash: hash(patch),
    nested: Boolean(nested),
  };
}

/**
 * Verify, immediately before writing, that nothing moved.
 *
 * `nested` is the structural half of the caller-approval rule. A nested run is
 * one this skill did not start, which means the "approval" reaching it came
 * through another workflow rather than from a person in this run. No assertion
 * a caller makes can distinguish those, so a nested run never publishes —
 * regardless of what it was told.
 */
export function verifyApproval(repositoryRoot, approval, patch) {
  if (!approval || typeof approval !== 'object') {
    throw new TargetError(FAILURES.usage, 'approval is required');
  }
  if (approval.nested) {
    throw new TargetError(
      FAILURES.nestedPublication,
      'a nested run cannot publish; return the proposal instead',
    );
  }

  const current = resolveTarget(repositoryRoot, approval.canonicalPath, { mustExist: false });

  if (current.canonicalPath !== approval.canonicalPath) {
    throw new TargetError(
      FAILURES.approvalMismatch,
      `target path changed since approval: ${current.canonicalPath}`,
    );
  }
  if (current.contentHash !== approval.contentHash) {
    throw new TargetError(
      FAILURES.approvalMismatch,
      'target content changed since approval',
    );
  }
  if (hash(patch) !== approval.patchHash) {
    throw new TargetError(FAILURES.approvalMismatch, 'patch changed since approval');
  }

  return { status: 'verified', canonicalPath: current.canonicalPath };
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--probe') {
      args.probe = true;
      continue;
    }
    if (!token.startsWith('--')) {
      throw new TargetError(FAILURES.usage, `unexpected argument: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TargetError(FAILURES.usage, `${token} requires a value`);
    }
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function main(argv) {
  const args = parseArguments(argv);
  if (args.probe) {
    process.stdout.write('changelog-target: available\n');
    return;
  }
  if (!args.root || !args.path) {
    throw new TargetError(FAILURES.usage, '--root and --path are required');
  }
  process.stdout.write(`${JSON.stringify(resolveTarget(args.root, args.path), null, 2)}\n`);
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
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.code ?? FAILURES.usage, reason: null, message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}

export { CHANGELOG_NAMES, FAILURES };
