#!/usr/bin/env node

/**
 * Bind exactly one identified, revision-bound source artifact.
 *
 * Synthesis converts one source into a smaller variant. Before anything is
 * rendered, the run must prove which artifact it is converting and that the
 * artifact has not moved since it was identified. This module produces that
 * proof: it refuses an unidentified or unbound source, refuses an absolute path
 * or a path outside the profile-derived workspace or reached through a symlink,
 * refuses an artifact it cannot read, and refuses a source whose declared
 * revision no longer matches the bytes on disk. On success it returns a binding
 * that carries the SHA-256 digest of the exact bytes it read.
 *
 * The revision is the digest. A caller that could assert the observed revision
 * could assert freshness, so freshness is derived from the artifact rather than
 * taken from the caller: the module computes the digest of the bytes it read and
 * compares the declared revision to it. Nothing here is inferred. A missing
 * source path, a missing declared revision, or a missing profile is a refusal,
 * never a default, because a defaulted input is how a run quietly synthesizes
 * the wrong document under a workspace nobody chose.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveProfile } from '../synthesis-profile/synthesis-profile.mjs';

export class SourceBindingError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SourceBindingError';
    this.code = code;
    this.detail = detail;
  }
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The refusal vocabulary, owned by the `Refusals` table in `source-binding.md`.
 * The same codes live here so the regression suite derives both directions and
 * neither the table nor the module may gain or lose a code silently.
 */
export const REFUSAL_CODES = [
  'unbound-source',
  'unknown-profile',
  'outside-workspace',
  'unsafe-path',
  'unreadable',
  'stale-source',
  'usage',
];

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function slugOf(sourcePath) {
  const base = path.basename(sourcePath);
  const slug = base.split('.')[0];
  if (!SLUG_PATTERN.test(slug)) {
    throw new SourceBindingError(
      'unbound-source',
      `source file name does not yield a stable slug: ${base}`,
    );
  }
  return slug;
}

/**
 * Resolve the workspace from the fixed profile table. The containment root can
 * never be widened by a caller, because no caller supplies it.
 */
function workspaceOf(profileId) {
  let profile;
  try {
    profile = resolveProfile(profileId);
  } catch {
    throw new SourceBindingError('unknown-profile', `no synthesis profile is named ${profileId}`);
  }
  return profile.workspaceRoot;
}

/**
 * Resolve the workspace-relative, symlink-free absolute path of the source, or
 * refuse. Kept separate so the containment and symlink rules are one place.
 */
function resolveWorkspacePath(repositoryRoot, sourcePath, workspaceRoot) {
  const root = path.resolve(repositoryRoot);
  let rootStat;
  let canonicalRoot;
  try {
    rootStat = fs.lstatSync(root);
    canonicalRoot = fs.realpathSync(root);
  } catch (error) {
    throw new SourceBindingError('unreadable', 'repository root cannot be inspected', { filesystemCode: error?.code ?? 'unknown' });
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || canonicalRoot !== root) {
    throw new SourceBindingError('unsafe-path', 'repository root must be an existing canonical directory without symbolic links');
  }
  const workspace = path.resolve(root, workspaceRoot);
  const absolute = path.resolve(root, sourcePath);
  const relativeToWorkspace = path.relative(workspace, absolute);
  if (
    relativeToWorkspace === ''
    || relativeToWorkspace.startsWith('..')
    || path.isAbsolute(relativeToWorkspace)
  ) {
    throw new SourceBindingError(
      'outside-workspace',
      `source is not beneath ${toPosix(path.relative(root, workspace))}/: ${sourcePath}`,
      { workspaceRoot: toPosix(path.relative(root, workspace)) },
    );
  }
  return { root, absolute };
}

function refuseSymlinkComponents(root, absolute, io) {
  const relative = path.relative(root, absolute);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = io.lstatSync(current);
    } catch (error) {
      throw new SourceBindingError('unreadable', `source path cannot be inspected: ${toPosix(path.relative(root, current))}`, { filesystemCode: error?.code ?? 'unknown' });
    }
    if (stat.isSymbolicLink()) {
      throw new SourceBindingError('unsafe-path', `source path passes through a symbolic link: ${toPosix(path.relative(root, current))}`);
    }
  }
}

/**
 * Bind one identified source. Reads the artifact, computes its revision from the
 * exact bytes, proves the declared revision matches, and returns the binding.
 */
export function bindSource({
  repositoryRoot,
  sourcePath,
  declaredRevision,
  profileId,
  io = fs,
}) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.trim() === '') {
    throw new SourceBindingError('unbound-source', 'repositoryRoot is required');
  }
  if (typeof sourcePath !== 'string' || sourcePath.trim() === '') {
    throw new SourceBindingError('unbound-source', 'a source path is required and is never inferred');
  }
  if (path.isAbsolute(sourcePath)) {
    throw new SourceBindingError('unbound-source', `the source is named relative to the repository root, never absolute: ${sourcePath}`);
  }
  if (typeof declaredRevision !== 'string' || declaredRevision.trim() === '') {
    throw new SourceBindingError('unbound-source', 'a declared source revision is required and is never inferred');
  }

  const workspaceRoot = workspaceOf(profileId);
  const slug = slugOf(sourcePath);
  const { root, absolute } = resolveWorkspacePath(repositoryRoot, sourcePath, workspaceRoot);
  refuseSymlinkComponents(root, absolute, io);

  let stat;
  let bytes;
  try {
    stat = io.lstatSync(absolute);
    bytes = io.readFileSync(absolute);
  } catch (error) {
    throw new SourceBindingError(
      'unreadable',
      `source cannot be read: ${sourcePath}`,
      { filesystemCode: error?.code ?? 'unknown' },
    );
  }
  if (!stat.isFile()) {
    throw new SourceBindingError('unreadable', `source is not a regular file: ${sourcePath}`);
  }

  const observedRevision = createHash('sha256').update(bytes).digest('hex');

  if (declaredRevision !== observedRevision) {
    throw new SourceBindingError(
      'stale-source',
      'the source moved since it was identified',
      { declaredRevision, observedRevision },
    );
  }

  return {
    status: 'bound',
    sourcePath: toPosix(path.relative(root, absolute)),
    slug,
    revision: observedRevision,
    digest: observedRevision,
  };
}

/**
 * The filesystem-facing entry. It resolves the same binding as `bindSource`
 * from a path on disk; both share one implementation so the refusal contract
 * cannot drift between them.
 */
export function bindFile(options) {
  return bindSource(options);
}

export const USAGE = 'Usage: source-binding.mjs --root <absolute-path> --source <workspace-relative-path> --revision <declared-revision> --profile <profile-id>';

export function run(argv, streams = process) {
  const args = {};
  let sourceCount = 0;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--root', '--source', '--revision', '--profile'].includes(flag) || value === undefined) {
      throw new SourceBindingError('usage', USAGE);
    }
    if (flag === '--source') {
      sourceCount += 1;
    }
    args[flag.slice(2)] = value;
  }
  if (sourceCount !== 1) {
    throw new SourceBindingError('usage', 'exactly one --source is accepted');
  }
  if (!args.root || !args.source || !args.revision || !args.profile) {
    throw new SourceBindingError('usage', USAGE);
  }
  if (!path.isAbsolute(args.root)) {
    throw new SourceBindingError('usage', USAGE);
  }
  const binding = bindFile({
    repositoryRoot: args.root,
    sourcePath: args.source,
    declaredRevision: args.revision,
    profileId: args.profile,
  });
  streams.stdout.write(`${JSON.stringify(binding, null, 2)}\n`);
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
      error: { code: error.code ?? 'unbound-source', message: error.message, detail: error.detail ?? {} },
    })}\n`);
    process.exitCode = 1;
  }
}
