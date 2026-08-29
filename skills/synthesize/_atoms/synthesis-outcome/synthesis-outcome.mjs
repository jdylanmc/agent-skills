#!/usr/bin/env node

/**
 * Deterministic synthesis-outcome resolver.
 *
 * This module narrates nothing and reads no file. It resolves one run to a
 * single status from explicit, STRUCTURAL evidence: the source binding, the
 * budget evaluation, the ledger result, and the split result. It resolves worst
 * to best, so a stronger reason to stop always wins over a weaker one.
 *
 * A status stub is not evidence. `{status: 'bound'}`, `{status: 'within'}`, and
 * `{status: 'clean'}` name an outcome without carrying the identity, path,
 * counts, and digests the checks produce. This resolver requires the structure
 * and, beyond structure, requires the pieces to be INTERNALLY CONSISTENT and
 * bound to the resolved profile: the revision is the digest, the budget is the
 * profile's budget, the status is what the profile's rule derives, the candidate
 * path is the profile's pattern with the source's slug, the source is inside the
 * profile's workspace after path normalization, the clean ledger's digest is the
 * digest of its own entries, and an over-budget run carries split evidence bound
 * to the same ledger and profile. It returns `blocked` with a specific named
 * reason when any part is missing, malformed, or inconsistent.
 *
 * This resolver stays a PURE resolver over the evidence the other atoms produced
 * in the same run. It deliberately does not re-read the source or candidate and
 * does not recompute any stage: doing so would collapse five atoms into one. Its
 * guarantee is therefore narrow — the evidence is internally consistent and
 * profile-bound — not that the artifacts exist as described. It proves
 * consistency, not truth.
 *
 * `complete` is a statement about mechanical checks. It is not approval. The
 * variant remains a candidate until a human approves it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveBudgetStatus, resolveProfile } from '../synthesis-profile/synthesis-profile.mjs';
import { ledgerDigest } from '../disclosure-ledger/disclosure-ledger.mjs';

export class SynthesisOutcomeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SynthesisOutcomeError';
    this.code = code;
  }
}

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const BUDGET_STATUSES = ['within', 'at-limit', 'over'];

/**
 * The resolvable statuses, worst to best, and the named `blocked` reasons the
 * consistency checks emit. Owned by the status/reason table in
 * `synthesis-outcome.md`; the regression suite derives both directions.
 */
export const STATUSES = ['blocked', 'stale-source', 'refused', 'needs-split', 'complete'];

/**
 * Every `blocked` reason this resolver can emit, as a stable hyphenated code.
 * Owned by the `Blocked Reasons` table in `synthesis-outcome.md`; the same codes
 * live here so the resolver runs without parsing Markdown, and the regression
 * suite drives the resolver down each blocked path, collects the emitted reason,
 * and asserts it is a member of this list AND appears in the documented table.
 * The `reasons` array carries only these codes; any human-readable detail rides
 * in a separate `detail` field so a prose reason can never drift in unlisted.
 */
export const BLOCKED_REASONS = [
  'binding-missing',
  'binding-refused',
  'profile-id-missing',
  'unknown-profile',
  'candidate-path-missing',
  'candidate-digest-missing',
  'candidate-evidence-mismatch',
  'binding-evidence-incomplete',
  'budget-evidence-incomplete',
  'evidence-profile-mismatch',
  'ledger-evidence-missing',
  'revision-digest-mismatch',
  'budget-not-profile-bound',
  'budget-status-inconsistent',
  'source-path-absolute',
  'source-path-escapes-root',
  'candidate-path-absolute',
  'candidate-path-escapes-root',
  'candidate-path-mismatch',
  'source-outside-workspace',
  'ledger-evidence-incomplete',
  'ledger-digest-mismatch',
  'split-not-proposed',
  'split-ledger-mismatch',
  'split-profile-mismatch',
  'split-proposals-incomplete',
  'split-status-inconsistent',
  'split-partition-inconsistent',
];

function toPosix(value) {
  return String(value).split(/[\\/]/).join('/');
}

/**
 * Normalize a path that must stay INSIDE the relative workspace root, refusing
 * anything that would carry it out. An absolute path — a leading `/`, a Windows
 * drive like `C:`, or a UNC `//server` form — is refused outright, and a leading
 * `..` that pops above the relative root is an escape, not a no-op: it is
 * refused rather than silently dropped. Interior `.`/`..` segments that resolve
 * within the root are collapsed as before. The result names whether the path is
 * contained and, when it is, its normalized form; when it is not, `role` is the
 * side (`source`/`candidate`) and `kind` is `absolute` or `escapes-root`, which
 * the caller maps to a stable blocked reason.
 */
function containedNormalize(value, role) {
  const posix = toPosix(value);
  if (posix.startsWith('/') || posix.startsWith('//') || /^[A-Za-z]:/.test(posix)) {
    return { ok: false, reason: `${role}-path-absolute` };
  }
  const out = [];
  for (const segment of posix.split('/')) {
    if (segment === '' || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (out.length === 0) {
        return { ok: false, reason: `${role}-path-escapes-root` };
      }
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return { ok: true, normalized: out.join('/') };
}

function slugOf(sourcePath) {
  const parts = toPosix(sourcePath).split('/');
  return parts[parts.length - 1].split('.')[0];
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * A split proposal is COMPLETE only when it carries the fields a valid split
 * partition produces for every proposal: a non-empty `slug`, `title`,
 * `boundary`, and `rationale`, and a `units` array of one or more non-empty
 * strings at EVERY index. A structurally empty proposal such as `{}` proposes no
 * cohesive boundary, a `units: [null]` array names no cohesive unit, and a
 * SPARSE `units` array such as `Array(1)` — length one but no member at index 0
 * — names no cohesive unit either. `Array.prototype.every` skips the holes of a
 * sparse array and would vacuously accept it, so each index is checked as an own
 * property holding a non-empty string. This is structural validation of the
 * sibling evidence, not a recomputation of the partition — so an over-budget run
 * that offers one, offers fewer than two, or carries a malformed or missing unit
 * member is `split-proposals-incomplete`, never `needs-split`.
 */
function everyIndexNonEmptyString(array) {
  for (let index = 0; index < array.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(array, index) || !isNonEmptyString(array[index])) {
      return false;
    }
  }
  return true;
}

function isCompleteProposal(proposal) {
  return isObject(proposal)
    && isNonEmptyString(proposal.slug)
    && isNonEmptyString(proposal.title)
    && isNonEmptyString(proposal.boundary)
    && isNonEmptyString(proposal.rationale)
    && Array.isArray(proposal.units)
    && proposal.units.length > 0
    && everyIndexNonEmptyString(proposal.units);
}

function blocked(reason, detail) {
  const out = { status: 'blocked', reasons: [reason] };
  if (detail !== undefined) {
    out.detail = detail;
  }
  return out;
}

export function resolveOutcome(input) {
  if (!isObject(input)) {
    throw new SynthesisOutcomeError('invalid-input', 'outcome evidence must be an object');
  }
  const { profileId, candidatePath, binding, budget, ledger, split } = input;

  // 1. blocked: no binding, or a non-staleness binding refusal. Missing
  //    evidence is unmet evidence, checked before the run's own claims.
  if (!isObject(binding)) {
    return blocked('binding-missing');
  }
  if (binding.status !== 'bound' && binding.status !== 'stale-source') {
    return blocked('binding-refused', binding.reason ?? binding.status ?? 'unknown');
  }

  // 2. stale-source: the bound source moved since it was identified. A stale run
  //    legitimately renders no candidate to measure, so it resolves here before
  //    the candidate, budget, and ledger evidence is demanded.
  if (binding.status === 'stale-source') {
    return { status: 'stale-source', reasons: ['the source moved since it was identified'] };
  }

  // The source is freshly bound. Every remaining piece of evidence must be
  // present and structurally complete, never a bare status stub.
  if (!isNonEmptyString(profileId)) {
    return blocked('profile-id-missing');
  }
  // Resolve the profile the run names. An unknown id proves nothing about the
  // evidence, so the run is blocked before its own claims are weighed.
  let profile;
  try {
    profile = resolveProfile(profileId);
  } catch {
    return blocked('unknown-profile');
  }
  if (!isNonEmptyString(candidatePath)) {
    return blocked('candidate-path-missing');
  }
  if (!isNonEmptyString(binding.sourcePath)
    || !isNonEmptyString(binding.revision)
    || !DIGEST_PATTERN.test(String(binding.digest))) {
    return blocked('binding-evidence-incomplete');
  }
  if (!isObject(budget)
    || !isInteger(budget.words)
    || !isInteger(budget.budget)
    || !BUDGET_STATUSES.includes(budget.status)
    || !isNonEmptyString(budget.profileId)) {
    return blocked('budget-evidence-incomplete');
  }
  if (budget.profileId !== profileId) {
    return blocked('evidence-profile-mismatch');
  }
  if (!isObject(ledger) || !isNonEmptyString(ledger.status)) {
    return blocked('ledger-evidence-missing');
  }

  // 2b. Internal consistency. Structure alone is not evidence: the pieces must
  //     agree with each other and with the resolved profile. The resolver cannot
  //     re-read the artifacts, so this proves the evidence is self-consistent and
  //     profile-bound, not that it is true.
  //  - the revision IS the content digest;
  if (binding.revision !== binding.digest) {
    return blocked('revision-digest-mismatch');
  }
  //  - the budget is the profile's own word budget;
  if (budget.budget !== profile.wordBudget) {
    return blocked('budget-not-profile-bound');
  }
  //  - the status is exactly what the profile's rule derives from the words;
  if (!Number.isInteger(budget.words) || budget.words < 0
    || budget.status !== deriveBudgetStatus(budget.words, profile.wordBudget)) {
    return blocked('budget-status-inconsistent');
  }
  //  - both paths are relative and contained: an absolute path or a `..` that
  //    escapes the relative root is refused outright rather than normalized away,
  //    so traversal and absolute-path evidence cannot be silently erased.
  const sourceNorm = containedNormalize(binding.sourcePath, 'source');
  if (!sourceNorm.ok) {
    return blocked(sourceNorm.reason);
  }
  const candidateNorm = containedNormalize(candidatePath, 'candidate');
  if (!candidateNorm.ok) {
    return blocked(candidateNorm.reason);
  }
  const normalizedSource = sourceNorm.normalized;
  const normalizedCandidate = candidateNorm.normalized;
  //  - the candidate is the profile's outputPattern with the source's slug.
  if (normalizedCandidate !== profile.outputPattern.replace('<slug>', slugOf(normalizedSource))) {
    return blocked('candidate-path-mismatch');
  }
  //  - the source is beneath the profile's workspace root, after normalization.
  if (!normalizedSource.startsWith(profile.workspaceRoot)) {
    return blocked('source-outside-workspace');
  }

  // 3. refused: a ledger defect means the profile cannot be satisfied without
  //    losing meaning. Carry the defect code as the named reason. A defect
  //    ledger has no digest to demand, so refused is resolved before the clean
  //    ledger's structure is required.
  if (ledger.status !== 'clean') {
    return { status: 'refused', reasons: [ledger.code ?? ledger.status ?? 'a disclosure-ledger defect'] };
  }
  if (!DIGEST_PATTERN.test(String(ledger.digest)) || !isNonEmptyString(ledger.profileId)) {
    return blocked('ledger-evidence-incomplete');
  }
  if (!DIGEST_PATTERN.test(String(ledger.candidateDigest))) {
    return blocked('candidate-digest-missing');
  }
  if (ledger.candidatePath !== normalizedCandidate) {
    return blocked('candidate-evidence-mismatch');
  }
  if (ledger.profileId !== profileId) {
    return blocked('evidence-profile-mismatch');
  }
  //  - the clean ledger's digest is the digest of its own entries. An unverified
  //    digest could name a ledger the run never validated, so it is recomputed.
  if (!Array.isArray(ledger.entries)) {
    return blocked('ledger-evidence-incomplete');
  }
  let recomputedDigest;
  try {
    recomputedDigest = ledgerDigest(ledger.entries);
  } catch {
    recomputedDigest = null;
  }
  if (recomputedDigest !== ledger.digest) {
    return blocked('ledger-digest-mismatch');
  }

  // 4. needs-split: over budget with a valid partitioning proposal set. The split
  //    evidence must be structurally complete and bound to this run: it must name
  //    the split status, echo the ledger digest and the profile, and carry at
  //    least two COMPLETE proposals. Each failure has its own named reason.
  if (budget.status === 'over') {
    if (!isObject(split) || split.status !== 'needs-split') {
      return blocked('split-not-proposed');
    }
    if (split.ledgerDigest !== ledger.digest) {
      return blocked('split-ledger-mismatch');
    }
    if (split.profileId !== profileId) {
      return blocked('split-profile-mismatch');
    }
    if (!Array.isArray(split.proposals) || split.proposals.length < 2
      || !split.proposals.every(isCompleteProposal)) {
      return blocked('split-proposals-incomplete');
    }
    const required = new Set(
      ledger.entries
        .filter((entry) => profile.nonOmittableKinds.includes(entry.kind))
        .map((entry) => entry.id),
    );
    const seen = new Set();
    for (const proposal of split.proposals) {
      for (const unit of proposal.units) {
        if (!required.has(unit) || seen.has(unit)) {
          return blocked('split-partition-inconsistent');
        }
        seen.add(unit);
      }
    }
    if (seen.size !== required.size) {
      return blocked('split-partition-inconsistent');
    }
    return { status: 'needs-split', reasons: ['required meaning does not fit the budget'] };
  }
  if (split !== undefined
    && (!isObject(split) || !['not-required', 'within-budget'].includes(split.status))) {
    return blocked('split-status-inconsistent');
  }

  // 5. complete: fresh bound source, budget satisfied, clean ledger, one
  //    profile named throughout. Not approval — the variant is a candidate.
  return {
    status: 'complete',
    reasons: [],
    candidate: { path: normalizedCandidate, digest: ledger.candidateDigest },
  };
}

export const USAGE = 'Usage: synthesis-outcome.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new SynthesisOutcomeError('usage', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  streams.stdout.write(`${JSON.stringify(resolveOutcome(input), null, 2)}\n`);
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
