#!/usr/bin/env node

/**
 * Evaluate a split proposal when required meaning will not fit the budget.
 *
 * When a variant cannot hold the required meaning within its profile budget,
 * the honest answer is a named refusal with proposed cohesive secondary
 * boundaries — never truncation, never moving authority into the companion
 * document, never weakening a criterion. This module checks that the proposed
 * split is a real partition of the complete inventory of non-omittable source
 * meaning — intention, criteria, non-goals, constraints, and contradictions.
 *
 * The inventory is not asserted by the caller. It is DERIVED from the validated
 * disclosure ledger: every entry whose `kind` is in the profile's
 * `nonOmittableKinds`, keyed by entry id. A caller can no longer omit a
 * constraint from a hand-written list and have an incomplete split partition
 * perfectly. The result echoes the ledger digest and the resolved profile id so
 * a split is traceable to the exact ledger it partitions and the profile it
 * obeys. The supplied `ledgerDigest` is not trusted: it is recomputed from the
 * entries the split was given and must match, so a split cannot float free of
 * the ledger it claims to partition.
 *
 * A split into one piece is the original problem renamed, so it is refused.
 * Whether the proposed boundaries are actually cohesive is a human judgement
 * this module does not make; it checks the partition and the substance, no more.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MIN_ANCHOR_CHARS, MIN_ANCHOR_WORDS, isDegenerateAnchor, ledgerDigest as computeLedgerDigest } from '../disclosure-ledger/disclosure-ledger.mjs';
import { resolveProfile } from '../synthesis-profile/synthesis-profile.mjs';

export class SplitProposalError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SplitProposalError';
    this.code = code;
    this.detail = detail;
  }
}

/**
 * The refusal vocabulary, owned by the `Refusals` table in `split-proposal.md`.
 * The same codes live here so the regression suite derives both directions and
 * neither side may gain or lose a code silently. `usage` is a command-line
 * argument error rather than a proposal refusal and is deliberately omitted.
 */
export const REFUSAL_CODES = [
  'invalid-input',
  'unknown-profile',
  'ledger-digest-mismatch',
  'insufficient-split',
  'incohesive-boundary',
  'overlapping-boundary',
  'uncovered-criterion',
  'unknown-criterion',
  'invalid-slug',
];

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Derive the non-omittable inventory from the validated ledger entries. Every
 * entry whose kind is non-omittable under the profile is a unit that must land
 * in exactly one proposal, keyed by its entry id.
 */
function deriveInventory(ledgerEntries, profile) {
  if (!Array.isArray(ledgerEntries)) {
    throw new SplitProposalError('invalid-input', 'ledgerEntries must be an array');
  }
  const nonOmittable = new Set(profile.nonOmittableKinds);
  const inventory = new Set();
  for (const entry of ledgerEntries) {
    if (!entry || typeof entry !== 'object' || !isNonEmptyString(entry.id) || !isNonEmptyString(entry.kind)) {
      throw new SplitProposalError('invalid-input', 'each ledger entry needs a string id and kind');
    }
    if (nonOmittable.has(entry.kind)) {
      inventory.add(entry.id);
    }
  }
  return inventory;
}

export function evaluateSplit({ budgetStatus, proposals, ledgerEntries, profileId, ledgerDigest }) {
  if (!['within', 'at-limit', 'over'].includes(budgetStatus)) {
    throw new SplitProposalError('invalid-input', `budgetStatus must be within, at-limit, or over; got ${budgetStatus}`);
  }

  if (budgetStatus !== 'over') {
    // Do not refuse an unnecessary proposal; report that no split is required.
    return { status: 'not-required', proposals: Array.isArray(proposals) ? proposals : [], ledgerDigest: ledgerDigest ?? null, profileId: profileId ?? null };
  }

  let profile;
  try {
    profile = resolveProfile(profileId);
  } catch {
    throw new SplitProposalError('unknown-profile', `no synthesis profile is named ${profileId}`);
  }
  const declared = deriveInventory(ledgerEntries, profile);

  // The split must be provably a split of the exact ledger it claims to
  // partition. The echoed digest is recomputed from the entries the split was
  // given and must equal the digest the caller supplied; a missing or
  // non-matching digest is a refusal, so a split cannot float free of its ledger.
  const expectedDigest = computeLedgerDigest(ledgerEntries);
  if (!isNonEmptyString(ledgerDigest) || ledgerDigest !== expectedDigest) {
    throw new SplitProposalError(
      'ledger-digest-mismatch',
      'ledgerDigest is missing or does not match the digest of the ledger entries',
      { expectedDigest, received: ledgerDigest ?? null },
    );
  }

  if (!Array.isArray(proposals) || proposals.length < 2) {
    throw new SplitProposalError('insufficient-split', 'an over-budget variant needs at least two split proposals');
  }

  const slugs = new Set();
  for (const proposal of proposals) {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
      throw new SplitProposalError('incohesive-boundary', 'each proposal must be an object');
    }
    if (!isNonEmptyString(proposal.slug) || !SLUG_PATTERN.test(proposal.slug)) {
      throw new SplitProposalError('invalid-slug', `invalid proposal slug: ${proposal.slug}`);
    }
    if (slugs.has(proposal.slug)) {
      throw new SplitProposalError('invalid-slug', `duplicate proposal slug: ${proposal.slug}`);
    }
    slugs.add(proposal.slug);
  }

  for (const proposal of proposals) {
    for (const field of ['title', 'boundary', 'rationale']) {
      if (!isNonEmptyString(proposal[field]) || isDegenerateAnchor(proposal[field])) {
        throw new SplitProposalError(
          'incohesive-boundary',
          `proposal ${proposal.slug} ${field} is missing or shorter than ${MIN_ANCHOR_CHARS} characters or ${MIN_ANCHOR_WORDS} words`,
        );
      }
    }
    if (!Array.isArray(proposal.units) || proposal.units.length === 0) {
      throw new SplitProposalError('incohesive-boundary', `proposal ${proposal.slug} cites no units`);
    }
  }

  const seen = new Set();
  for (const proposal of proposals) {
    for (const id of proposal.units) {
      if (!isNonEmptyString(id)) {
        throw new SplitProposalError('incohesive-boundary', `proposal ${proposal.slug} cites a malformed unit`);
      }
      if (!declared.has(id)) {
        throw new SplitProposalError('unknown-criterion', `proposal ${proposal.slug} cites undeclared unit ${id}`);
      }
      if (seen.has(id)) {
        throw new SplitProposalError('overlapping-boundary', `unit ${id} appears in more than one proposal`);
      }
      seen.add(id);
    }
  }

  const uncovered = [...declared].filter((id) => !seen.has(id));
  if (uncovered.length) {
    throw new SplitProposalError('uncovered-criterion', `no proposal covers ${uncovered.join(', ')}`, { uncovered });
  }

  return { status: 'needs-split', proposals, ledgerDigest, profileId: profile.id };
}

export const USAGE = 'Usage: split-proposal.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new SplitProposalError('usage', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  streams.stdout.write(`${JSON.stringify(evaluateSplit(input), null, 2)}\n`);
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
      error: { code: error.code ?? 'invalid-input', message: error.message, detail: error.detail ?? {} },
    })}\n`);
    process.exitCode = 1;
  }
}
