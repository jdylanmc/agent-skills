#!/usr/bin/env node

/**
 * Deterministic approval-state resolver for a specification pair.
 *
 * Approval is a merge to the default branch, not a field. That is a property
 * about who can produce the evidence, and prose cannot hold it: the same agent
 * that writes a specification can write "approved: true" beside it, and a
 * permission guarded only by a promise is not guarded.
 *
 * So the observation is taken from a remote-tracking ref the run cannot move,
 * and the resolution is a strict comparison of digests: equal bytes on the
 * default branch means approved, anything else means draft. Unknown fields
 * are refused rather than ignored, because ignoring a forged "approved" field
 * would let the agent assert its own approval.
 *
 * Nothing here merges, approves, publishes, or fetches. It resolves an
 * observation somebody else gathered.
 */

import crypto from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFileCb);

export class ApprovalStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApprovalStateError';
    this.code = code;
  }
}

export const STATE_VERSION = 1;
export const APPROVAL_BOUNDARIES = ['git-default-branch'];

const FIELDS = [
  'version',
  'boundary',
  'remote',
  'defaultBranch',
  'defaultBranchRef',
  'nanoPath',
  'nanoDigest',
  'publishedDigest',
  'publishedCommit',
  'observedAt',
  'observedWith',
];

const NANO_PATH_RE = /^docs\/agent\/specs\/([a-z0-9]+(?:-[a-z0-9]+)*)\.nano\.md$/;
const HEX_SHA256_RE = /^[a-fA-F0-9]{64}$/;
const COMMIT_SHA_RE = /^[a-fA-F0-9]{40}$/;

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApprovalStateError('invalid-observation', `${field} must be non-empty text`);
  }
  return value.trim();
}

export function resolveApprovalState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApprovalStateError('invalid-observation', 'the approval observation must be an object');
  }

  const unknown = Object.keys(input).filter((f) => !FIELDS.includes(f)).sort();
  if (unknown.length) {
    throw new ApprovalStateError('invalid-observation', `unknown field(s): ${unknown.join(', ')}`);
  }
  const missing = FIELDS.filter((f) => !(f in input));
  if (missing.length) {
    throw new ApprovalStateError('invalid-observation', `missing field(s): ${missing.join(', ')}`);
  }

  if (input.version !== STATE_VERSION) {
    throw new ApprovalStateError('invalid-observation', `version must be ${STATE_VERSION}`);
  }

  const boundary = text(input.boundary, 'boundary');
  if (!APPROVAL_BOUNDARIES.includes(boundary)) {
    throw new ApprovalStateError('unsupported-boundary', `boundary must be one of ${APPROVAL_BOUNDARIES.join(', ')}; got ${boundary}`);
  }

  const remote = text(input.remote, 'remote');
  const defaultBranch = text(input.defaultBranch, 'defaultBranch');
  const defaultBranchRef = text(input.defaultBranchRef, 'defaultBranchRef');

  const expectedRef = `${remote}/${defaultBranch}`;
  if (!defaultBranchRef.includes('/')) {
    throw new ApprovalStateError(
      'invalid-observation',
      `defaultBranchRef must contain a slash — a bare local branch name is writable by this run and therefore is not a boundary`,
    );
  }
  if (defaultBranchRef !== expectedRef) {
    throw new ApprovalStateError(
      'invalid-observation',
      `defaultBranchRef must equal <remote>/<defaultBranch> (expected ${expectedRef}, got ${defaultBranchRef})`,
    );
  }

  const nanoPath = text(input.nanoPath, 'nanoPath');
  if (nanoPath.includes('\\')) {
    throw new ApprovalStateError('invalid-observation', 'nanoPath must not contain backslashes');
  }
  if (path.isAbsolute(nanoPath) || nanoPath.includes('..')) {
    throw new ApprovalStateError('invalid-observation', 'nanoPath must be a relative path without traversal');
  }
  const pathMatch = NANO_PATH_RE.exec(nanoPath);
  if (!pathMatch) {
    throw new ApprovalStateError(
      'invalid-observation',
      'nanoPath must match docs/agent/specs/<slug>.nano.md where <slug> is lowercase ASCII alphanumeric words separated by single hyphens',
    );
  }
  const slug = pathMatch[1];

  const nanoDigest = text(input.nanoDigest, 'nanoDigest');
  if (!HEX_SHA256_RE.test(nanoDigest)) {
    throw new ApprovalStateError('invalid-observation', 'nanoDigest must be a 64-character hex SHA-256');
  }

  // publishedDigest and publishedCommit must both be null or both be present.
  const hasPublishedDigest = input.publishedDigest !== null;
  const hasPublishedCommit = input.publishedCommit !== null;
  if (hasPublishedDigest !== hasPublishedCommit) {
    throw new ApprovalStateError(
      'invalid-observation',
      'publishedDigest and publishedCommit must both be null or both be present',
    );
  }

  let publishedDigest = null;
  let publishedCommit = null;

  if (hasPublishedDigest) {
    publishedDigest = text(input.publishedDigest, 'publishedDigest');
    if (!HEX_SHA256_RE.test(publishedDigest)) {
      throw new ApprovalStateError('invalid-observation', 'publishedDigest must be a 64-character hex SHA-256');
    }
  }

  if (hasPublishedCommit) {
    publishedCommit = text(input.publishedCommit, 'publishedCommit');
    if (!COMMIT_SHA_RE.test(publishedCommit)) {
      throw new ApprovalStateError('invalid-observation', 'publishedCommit must be a 40-character hex commit SHA');
    }
  }

  const observedAt = text(input.observedAt, 'observedAt');
  if (Number.isNaN(Date.parse(observedAt))) {
    throw new ApprovalStateError('invalid-observation', 'observedAt must be a parseable ISO-8601 timestamp');
  }

  if (!Array.isArray(input.observedWith)
    || input.observedWith.length === 0
    || input.observedWith.some((cmd) => typeof cmd !== 'string' || cmd.trim() === '')) {
    throw new ApprovalStateError(
      'invalid-observation',
      'observedWith must be a non-empty array of non-empty strings',
    );
  }

  // Resolution: deterministic, no judgement.
  if (publishedDigest !== null && publishedDigest.toLowerCase() === nanoDigest.toLowerCase()) {
    return {
      state: 'approved',
      slug,
      nanoPath,
      boundary,
      defaultBranchRef,
      commit: publishedCommit.toLowerCase(),
      digest: nanoDigest.toLowerCase(),
      publishedDigest: publishedDigest.toLowerCase(),
      observedAt,
      reasons: [],
    };
  }

  if (publishedDigest === null) {
    return {
      state: 'draft',
      slug,
      nanoPath,
      boundary,
      defaultBranchRef,
      commit: null,
      digest: nanoDigest.toLowerCase(),
      publishedDigest: null,
      observedAt,
      reasons: ['not-on-default-branch'],
    };
  }

  return {
    state: 'draft',
    slug,
    nanoPath,
    boundary,
    defaultBranchRef,
    commit: publishedCommit.toLowerCase(),
    digest: nanoDigest.toLowerCase(),
    publishedDigest: publishedDigest.toLowerCase(),
    observedAt,
    reasons: ['differs-from-default-branch'],
  };
}

/**
 * Verify an approval observation against the repository rather than trusting
 * the caller's asserted digests. This keeps `resolveApprovalState` pure and
 * deterministic while adding a checkable layer on top.
 *
 * `git` is an injectable command runner:
 *   `({ args, cwd, encoding }) => Promise<{ status: 'ok', stdout } | { status: 'error', stderr }>`.
 * The default shells out via `node:child_process.execFile` with argument arrays
 * (never interpolated strings) so that paths cannot escape the command.
 * The structured result lets callers distinguish a recognizable missing-path
 * condition from repository corruption, permissions errors, or killed
 * processes. Only a missing-path failure is classified as "absent from the
 * default branch"; every other git failure is refused.
 *
 * When the published nano blob exists, the verifier also parses its provenance
 * lines (`- Source:` and `- Source revision:`) using the same fenced-block
 * exclusion and single-match rules as `spec-pair.mjs`. The parsed values are
 * returned as `publishedSource` and `publishedSourceRevision` so that
 * `discovery-source` can bind the approval to the exact source and revision
 * the human merged.
 */
export async function verifyApprovalObservation({
  repositoryRoot,
  observation,
  git = defaultGit,
  _readFile = (p) => fs.readFileSync(p),
} = {}) {
  if (!repositoryRoot || typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)) {
    throw new ApprovalStateError(
      'unverified-observation',
      'repositoryRoot must be a non-empty absolute path',
    );
  }
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) {
    throw new ApprovalStateError(
      'unverified-observation',
      'observation must be an object',
    );
  }

  const nanoPath = observation.nanoPath;
  if (typeof nanoPath !== 'string' || nanoPath.trim() === '') {
    throw new ApprovalStateError(
      'unverified-observation',
      'observation.nanoPath must be non-empty text',
    );
  }

  const defaultBranchRef = observation.defaultBranchRef;
  if (typeof defaultBranchRef !== 'string' || defaultBranchRef.trim() === '') {
    throw new ApprovalStateError(
      'unverified-observation',
      'observation.defaultBranchRef must be non-empty text',
    );
  }

  const remote = observation.remote;
  if (typeof remote !== 'string' || remote.trim() === '') {
    throw new ApprovalStateError(
      'unverified-observation',
      'observation.remote must be non-empty text',
    );
  }

  const defaultBranch = observation.defaultBranch;
  if (typeof defaultBranch !== 'string' || defaultBranch.trim() === '') {
    throw new ApprovalStateError(
      'unverified-observation',
      'observation.defaultBranch must be non-empty text',
    );
  }

  // F1: Prove the remote is a configured remote of this repository.
  const remoteUrlResult = await git({ args: ['remote', 'get-url', remote], cwd: repositoryRoot });
  if (remoteUrlResult.status !== 'ok') {
    throw new ApprovalStateError(
      'unverified-observation',
      `remote "${remote}" is not a configured remote of this repository`,
    );
  }

  // F1: Prove the ref is a real remote-tracking ref, not a local branch or
  // arbitrary name. git rev-parse --symbolic-full-name must resolve to
  // refs/remotes/<remote>/<defaultBranch>.
  const symbolicResult = await git({
    args: ['rev-parse', '--symbolic-full-name', defaultBranchRef],
    cwd: repositoryRoot,
  });
  const expectedSymbolic = `refs/remotes/${remote}/${defaultBranch}`;
  if (
    symbolicResult.status !== 'ok' ||
    symbolicResult.stdout.trim() !== expectedSymbolic
  ) {
    throw new ApprovalStateError(
      'unverified-observation',
      `defaultBranchRef "${defaultBranchRef}" does not resolve to a remote-tracking ref (expected ${expectedSymbolic})`,
    );
  }

  // F1: Prove the branch is the remote's own default branch, not one the
  // caller picked. git symbolic-ref refs/remotes/<remote>/HEAD must equal
  // refs/remotes/<remote>/<defaultBranch>.
  const remoteHeadResult = await git({
    args: ['symbolic-ref', `refs/remotes/${remote}/HEAD`],
    cwd: repositoryRoot,
  });
  if (remoteHeadResult.status !== 'ok') {
    throw new ApprovalStateError(
      'unverified-observation',
      `cannot prove "${defaultBranch}" is the default branch of remote "${remote}" — refs/remotes/${remote}/HEAD is not set. Run: git remote set-head ${remote} --auto`,
    );
  }
  const remoteHeadValue = remoteHeadResult.stdout.trim();
  if (remoteHeadValue !== expectedSymbolic) {
    throw new ApprovalStateError(
      'unverified-observation',
      `"${defaultBranch}" is not the default branch of remote "${remote}" (HEAD points to ${remoteHeadValue}, expected ${expectedSymbolic})`,
    );
  }

  // F1: Validate observedWith — it must name meaningful tokens that describe
  // the observation: a fetch of the same remote, and reads of the same ref and
  // path that verification performed.
  if (!Array.isArray(observation.observedWith) || observation.observedWith.length === 0) {
    throw new ApprovalStateError(
      'unverified-observation',
      'observedWith must be a non-empty array of commands describing the observation',
    );
  }
  const observedCommands = observation.observedWith.join(' ');
  const observedWithErrors = [];
  if (!observedCommands.includes(remote)) {
    observedWithErrors.push(`must reference remote "${remote}"`);
  }
  if (!observedCommands.includes(defaultBranchRef) && !observedCommands.includes(`${remote}/${defaultBranch}`)) {
    observedWithErrors.push(`must reference ref "${defaultBranchRef}"`);
  }
  if (!observedCommands.includes(nanoPath)) {
    observedWithErrors.push(`must reference nanoPath "${nanoPath}"`);
  }
  if (observedWithErrors.length > 0) {
    throw new ApprovalStateError(
      'unverified-observation',
      `observedWith does not describe the verified observation: ${observedWithErrors.join('; ')}`,
    );
  }

  const disagreements = [];

  // Recompute nanoDigest from the working-tree file.
  const workingTreePath = path.join(repositoryRoot, nanoPath);
  let recomputedNanoDigest;
  try {
    const bytes = _readFile(workingTreePath);
    recomputedNanoDigest = crypto.createHash('sha256').update(bytes).digest('hex');
  } catch (err) {
    throw new ApprovalStateError(
      'unverified-observation',
      `working-tree file unreadable at ${nanoPath}: ${err.message}`,
    );
  }

  if (recomputedNanoDigest !== observation.nanoDigest?.toLowerCase()) {
    disagreements.push({
      field: 'nanoDigest',
      supplied: observation.nanoDigest ?? null,
      recomputed: recomputedNanoDigest,
    });
  }

  // Resolve the default branch ref commit.
  let recomputedPublishedCommit;
  const revParseResult = await git({ args: ['rev-parse', defaultBranchRef], cwd: repositoryRoot });
  if (revParseResult.status !== 'ok') {
    throw new ApprovalStateError(
      'unverified-observation',
      `could not resolve ref ${defaultBranchRef} — is the remote-tracking branch fetched?`,
    );
  }
  recomputedPublishedCommit = revParseResult.stdout.trim();

  // Recompute publishedDigest from the blob on the default branch ref.
  let recomputedPublishedDigest;
  let publishedNanoBytes = null;
  const blobSpec = `${defaultBranchRef}:${nanoPath}`;
  const showResult = await git({
    args: ['show', blobSpec],
    cwd: repositoryRoot,
    encoding: 'buffer',
  });
  if (showResult.status === 'ok') {
    publishedNanoBytes = showResult.stdout;
    recomputedPublishedDigest = crypto
      .createHash('sha256')
      .update(publishedNanoBytes)
      .digest('hex');
  } else {
    // Classify only a recognizable missing-path failure as absent.
    const stderr = typeof showResult.stderr === 'string'
      ? showResult.stderr
      : (showResult.stderr ? showResult.stderr.toString('utf8') : '');
    if (
      stderr.includes('does not exist') ||
      stderr.includes('not exist in') ||
      stderr.includes('path ') && stderr.includes(' does not exist') ||
      stderr.includes('fatal: path') ||
      stderr.includes('exists on disk, but not in')
    ) {
      recomputedPublishedDigest = null;
      recomputedPublishedCommit = null;
    } else {
      throw new ApprovalStateError(
        'unverified-observation',
        `git failure reading ${blobSpec}: ${stderr || 'unknown error'}`,
      );
    }
  }

  if (recomputedPublishedCommit !== null) {
    if (
      observation.publishedCommit?.toLowerCase() !==
      recomputedPublishedCommit.toLowerCase()
    ) {
      disagreements.push({
        field: 'publishedCommit',
        supplied: observation.publishedCommit ?? null,
        recomputed: recomputedPublishedCommit,
      });
    }
  } else {
    if (observation.publishedCommit !== null) {
      disagreements.push({
        field: 'publishedCommit',
        supplied: observation.publishedCommit,
        recomputed: null,
      });
    }
  }

  if (recomputedPublishedDigest !== null) {
    if (
      observation.publishedDigest?.toLowerCase() !==
      recomputedPublishedDigest.toLowerCase()
    ) {
      disagreements.push({
        field: 'publishedDigest',
        supplied: observation.publishedDigest ?? null,
        recomputed: recomputedPublishedDigest,
      });
    }
  } else {
    if (observation.publishedDigest !== null) {
      disagreements.push({
        field: 'publishedDigest',
        supplied: observation.publishedDigest,
        recomputed: null,
      });
    }
  }

  if (disagreements.length > 0) {
    const detail = disagreements
      .map((d) => `${d.field}: supplied=${d.supplied}, recomputed=${d.recomputed}`)
      .join('; ');
    throw new ApprovalStateError(
      'unverified-observation',
      `observation disagrees with repository: ${detail}`,
    );
  }

  // Parse provenance from the published nano bytes (F2 binding).
  let publishedSource = null;
  let publishedSourceRevision = null;
  if (publishedNanoBytes !== null) {
    const nanoText = publishedNanoBytes.toString('utf8');
    publishedSource = parseNanoLineValue(nanoText, 'Source');
    publishedSourceRevision = parseNanoLineValue(nanoText, 'Source revision');
  }

  // Resolve the approval state so the caller can check both verified and state.
  const approvalResult = resolveApprovalState(observation);

  return {
    verified: true,
    state: approvalResult.state,
    recomputedNanoDigest,
    recomputedPublishedDigest,
    recomputedPublishedCommit,
    publishedSource,
    publishedSourceRevision,
  };
}

/**
 * Parse a `- Label: value` line from nano text, excluding fenced code blocks.
 * Uses the same rules as spec-pair.mjs: a value that appears zero times or
 * more than once returns null (not a throw — the verifier reports absence
 * rather than crashing on a malformed published document).
 */
function withoutFencedBlocks(text) {
  const output = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*(```+|~~~+)/)?.[1] ?? null;
    if (marker) {
      if (fence === null) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      output.push('');
      continue;
    }
    output.push(fence === null ? line : '');
  }
  return output.join('\n');
}

function parseNanoLineValue(text, label) {
  const visible = withoutFencedBlocks(text);
  const matches = [...visible.matchAll(new RegExp(`^- ${label}:\\s*(.+)$`, 'gm'))];
  if (matches.length !== 1) return null;
  return matches[0][1].trim();
}

async function defaultGit({ args, cwd, encoding } = {}) {
  try {
    if (encoding === 'buffer') {
      const { stdout } = await execFileAsync('git', args, {
        cwd,
        encoding: 'buffer',
        maxBuffer: 10 * 1024 * 1024,
      });
      return { status: 'ok', stdout };
    }
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return { status: 'ok', stdout };
  } catch (err) {
    return { status: 'error', stderr: err.stderr ?? err.message };
  }
}

export const USAGE = [
  'Usage:',
  '  approval-state.mjs --input <absolute-json-path>',
  '  approval-state.mjs --verify --root <absolute-repository-root> --input <absolute-json-path>',
].join('\n');

export function run(argv, streams = process) {
  // --input <path> (resolve only, synchronous)
  if (argv.length === 2 && argv[0] === '--input' && path.isAbsolute(argv[1])) {
    const input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
    streams.stdout.write(`${JSON.stringify(resolveApprovalState(input), null, 2)}\n`);
    return 0;
  }

  // --verify --root <root> --input <path> (verify then resolve, async)
  if (
    argv.length === 4 &&
    argv[0] === '--verify' &&
    argv[1] === '--root' &&
    path.isAbsolute(argv[2]) &&
    argv[3].startsWith('--input=')
  ) {
    // Normalize: --input=<path> → extract path
    const inputPath = argv[3].slice('--input='.length);
    if (!path.isAbsolute(inputPath)) {
      throw new ApprovalStateError('usage', USAGE);
    }
    return runVerify(argv[2], inputPath, streams);
  }

  if (
    argv.length === 5 &&
    argv[0] === '--verify' &&
    argv[1] === '--root' &&
    path.isAbsolute(argv[2]) &&
    argv[3] === '--input' &&
    path.isAbsolute(argv[4])
  ) {
    return runVerify(argv[2], argv[4], streams);
  }

  throw new ApprovalStateError('usage', USAGE);
}

async function runVerify(root, inputPath, streams) {
  const observation = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  await verifyApprovalObservation({ repositoryRoot: root, observation });
  const result = resolveApprovalState(observation);
  streams.stdout.write(`${JSON.stringify({ ...result, verified: true }, null, 2)}\n`);
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
    const result = run(process.argv.slice(2));
    if (result instanceof Promise) {
      result.then(
        (code) => { process.exitCode = code; },
        (error) => {
          process.stderr.write(`${JSON.stringify({
            error: { code: error.code ?? 'invalid-observation', message: error.message },
          })}\n`);
          process.exitCode = 1;
        },
      );
    } else {
      process.exitCode = result;
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.code ?? 'invalid-observation', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
