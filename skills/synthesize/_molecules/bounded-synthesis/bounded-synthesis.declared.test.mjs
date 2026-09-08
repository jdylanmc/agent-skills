/**
 * Behavioural tests for a caller-declared reduction, end to end through the real
 * pipeline: bind one assembled bundle, resolve the declared contract, measure the
 * candidate, validate the disclosure ledger against the rendered candidate,
 * evaluate a split, resolve the outcome, and persist.
 *
 * The property worth holding is that the declared route is a real capability and
 * not a shape the machinery merely accepts. A contract that resolved cleanly and
 * that no run could actually satisfy would still pass every unit test, which is
 * the worst combination: a route that reports itself usable and refuses
 * everything handed to it. So these tests drive a genuine reduction to
 * `complete` and genuine losses to refusals, and they check that a declared
 * contract borrows nothing from `spec-nano` and grants itself nothing.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { bindSource } from '../../_atoms/source-binding/source-binding.mjs';
import { collectLedgerDefects, validateLedger } from '../../_atoms/disclosure-ledger/disclosure-ledger.mjs';
import { evaluateSplit } from '../../_atoms/split-proposal/split-proposal.mjs';
import { PROFILES, evaluateBudget, resolveProfile } from '../../_atoms/synthesis-profile/synthesis-profile.mjs';
import { resolveOutcome } from '../../_atoms/synthesis-outcome/synthesis-outcome.mjs';
import { finalizeSynthesis } from './bounded-synthesis.mjs';
import {
  CANDIDATE,
  CANDIDATE_PATH,
  DECLARED,
  ENTRIES,
  SOURCE,
  SOURCE_PATH,
} from './bounded-synthesis.declared.fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.resolve(HERE, '..', '..', '..', '..', '.test-sandbox', 'bounded-synthesis-declared');
let serial = 0;

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function root(t) {
  serial += 1;
  const value = path.join(SANDBOX, `${process.pid}-${serial}`);
  fs.mkdirSync(path.join(value, 'synthesis', 'intent'), { recursive: true });
  fs.writeFileSync(path.join(value, SOURCE_PATH), SOURCE);
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}

function ledgerOf(entries = ENTRIES, variantText = CANDIDATE) {
  return validateLedger({
    entries,
    sourceText: SOURCE,
    variantText,
    profileId: DECLARED,
    sourcePath: SOURCE_PATH,
    candidatePath: CANDIDATE_PATH,
  });
}

function defectCodes(entries, variantText = CANDIDATE) {
  return collectLedgerDefects({
    entries,
    sourceText: SOURCE,
    variantText,
    profileId: DECLARED,
    sourcePath: SOURCE_PATH,
    candidatePath: CANDIDATE_PATH,
  }).map((defect) => defect.code);
}

function evidence(repositoryRoot, overrides = {}) {
  const variantText = overrides.variantText ?? CANDIDATE;
  const binding = bindSource({
    repositoryRoot,
    sourcePath: SOURCE_PATH,
    declaredRevision: digest(SOURCE),
    profileId: DECLARED,
  });
  const budget = evaluateBudget(DECLARED, variantText);
  const ledger = ledgerOf(overrides.entries ?? ENTRIES, variantText);
  const split = evaluateSplit({
    budgetStatus: budget.status,
    proposals: [],
    ledgerEntries: ledger.entries,
    profileId: DECLARED,
    ledgerDigest: ledger.digest,
  });
  return {
    profileId: DECLARED,
    candidatePath: CANDIDATE_PATH,
    binding,
    budget,
    ledger,
    split,
    ...overrides.evidence,
  };
}

test('one assembled bundle reduces to one persisted candidate under a declared contract', (t) => {
  const repositoryRoot = root(t);
  const input = evidence(repositoryRoot);

  assert.equal(input.binding.status, 'bound');
  assert.equal(input.binding.slug, 'demo-adopter-attempt-1');
  assert.equal(input.binding.revision, digest(SOURCE));
  assert.equal(input.budget.status, 'within');
  assert.equal(input.ledger.status, 'clean');
  assert.equal(input.split.status, 'not-required');

  const outcome = resolveOutcome(input);
  assert.equal(outcome.status, 'complete');
  assert.equal(outcome.candidate.path, CANDIDATE_PATH);

  const final = finalizeSynthesis({
    outcome,
    repositoryRoot,
    candidatePath: CANDIDATE_PATH,
    candidateText: CANDIDATE,
    runId: 'declared-run',
    profile: DECLARED,
  });
  assert.equal(final.persistence.status, 'persisted');
  assert.equal(fs.readFileSync(path.join(repositoryRoot, CANDIDATE_PATH), 'utf8'), CANDIDATE);
});

test('the candidate is plain requirements: no frontmatter, no path, no revision', () => {
  assert.ok(!CANDIDATE.startsWith('---'), 'an intent candidate carries no frontmatter');
  assert.ok(!CANDIDATE.includes(SOURCE_PATH), 'the source path is run evidence, not candidate text');
  assert.ok(!CANDIDATE.includes(digest(SOURCE)), 'the revision is run evidence, not candidate text');
  // Traceability is proved by the ledger, which anchors every surviving claim
  // to exact source material, rather than by naming the source in the prose.
  for (const entry of ENTRIES) {
    assert.ok(SOURCE.includes(entry.sourceAnchor), entry.id);
    if (entry.variantAnchor) assert.ok(CANDIDATE.includes(entry.variantAnchor), entry.id);
  }
});

test('a declared reduction refuses rather than silently dropping required meaning', () => {
  const dropped = ENTRIES.map((entry) => (entry.id === 'no-duplicates'
    ? {
      id: entry.id,
      kind: entry.kind,
      classification: entry.classification,
      disposition: 'omitted',
      covers: entry.covers,
      sourceAnchor: entry.sourceAnchor,
      reason: 'the candidate reads better without it',
    }
    : entry));
  const variantText = CANDIDATE.replace('It must never file the same defect twice.\n\n', '');
  const codes = defectCodes(dropped, variantText);
  assert.ok(codes.includes('semantic-omission'), codes.join(', '));
  assert.ok(codes.includes('required-content-omitted'), codes.join(', '));
});

test('a claim the bundle never made is an invented claim', () => {
  const codes = defectCodes(ENTRIES, `${CANDIDATE}\nIt also files a support ticket for every failure.\n`);
  assert.ok(codes.includes('invented-claim'), codes.join(', '));
});

test('bundle content no entry accounts for is unaccounted source', () => {
  const codes = defectCodes(ENTRIES.filter((entry) => entry.id !== 'assembly-note'));
  assert.ok(codes.includes('unaccounted-source'), codes.join(', '));
});

test('a refused ledger resolves the run to refused and persists nothing', (t) => {
  const repositoryRoot = root(t);
  const outcome = resolveOutcome(evidence(repositoryRoot, {
    evidence: { ledger: { status: 'defective', code: 'semantic-omission' } },
  }));
  assert.equal(outcome.status, 'refused');
  assert.deepEqual(outcome.reasons, ['semantic-omission']);
  assert.equal(fs.existsSync(path.join(repositoryRoot, CANDIDATE_PATH)), false);
});

test("over the declared budget the run needs a split, never a trim", (t) => {
  const repositoryRoot = root(t);
  const profile = resolveProfile(DECLARED);
  const overBudget = {
    words: profile.wordBudget + 1,
    budget: profile.wordBudget,
    status: 'over',
    profileId: profile.id,
  };

  const withoutSplit = resolveOutcome(evidence(repositoryRoot, {
    evidence: { budget: overBudget, split: { status: 'not-required' } },
  }));
  assert.equal(withoutSplit.status, 'blocked');
  assert.deepEqual(withoutSplit.reasons, ['split-not-proposed']);

  const ledger = ledgerOf();
  const nonOmittable = ledger.entries
    .filter((entry) => profile.nonOmittableKinds.includes(entry.kind))
    .map((entry) => entry.id);
  assert.ok(nonOmittable.length >= 2, 'the fixture must carry enough non-omittable units to partition');
  const split = evaluateSplit({
    budgetStatus: 'over',
    ledgerEntries: ledger.entries,
    profileId: DECLARED,
    ledgerDigest: ledger.digest,
    proposals: [
      {
        slug: 'demo-adopter-capture',
        title: 'Capture the failing run',
        boundary: 'what the skill produces for a maintainer',
        rationale: 'producing the report is one job',
        units: nonOmittable.slice(0, 1),
      },
      {
        slug: 'demo-adopter-limits',
        title: 'Limits on disposition',
        boundary: 'what the skill refuses to do afterwards',
        rationale: 'refusing to dispose of a defect is a different job',
        units: nonOmittable.slice(1),
      },
    ],
  });
  assert.equal(split.status, 'needs-split');

  const outcome = resolveOutcome(evidence(repositoryRoot, {
    evidence: { budget: overBudget, split },
  }));
  assert.equal(outcome.status, 'needs-split');
  assert.equal(fs.existsSync(path.join(repositoryRoot, CANDIDATE_PATH)), false);
});

test("a declared reduction cannot read outside the workspace it declared", (t) => {
  const repositoryRoot = root(t);
  fs.mkdirSync(path.join(repositoryRoot, 'docs', 'agent', 'specs'), { recursive: true });
  const stray = 'docs/agent/specs/demo-adopter-attempt-1.full.md';
  fs.writeFileSync(path.join(repositoryRoot, stray), SOURCE);
  assert.throws(
    () => bindSource({
      repositoryRoot,
      sourcePath: stray,
      declaredRevision: digest(SOURCE),
      profileId: DECLARED,
    }),
    (error) => error.code === 'outside-workspace',
  );
});

test('a bundle bound under one contract does not validate under another', () => {
  // The ledger enforces the profile's own artifact shapes, so an intent bundle
  // and an intent candidate are not a spec-nano pair by accident.
  const codes = collectLedgerDefects({
    entries: ENTRIES,
    sourceText: SOURCE,
    variantText: CANDIDATE,
    profileId: 'spec-nano',
    sourcePath: SOURCE_PATH,
    candidatePath: CANDIDATE_PATH,
  }).map((defect) => defect.code);
  assert.ok(codes.includes('profile-shape-mismatch'), codes.join(', '));
});

test('a stale bundle is refused before anything is reduced', (t) => {
  const repositoryRoot = root(t);
  fs.writeFileSync(path.join(repositoryRoot, SOURCE_PATH), `${SOURCE}\nA later edit.\n`);
  assert.throws(
    () => bindSource({
      repositoryRoot,
      sourcePath: SOURCE_PATH,
      declaredRevision: digest(SOURCE),
      profileId: DECLARED,
    }),
    (error) => error.code === 'stale-source',
  );
});

test('the contract is the caller\'s, and the machinery privileges nothing about it', () => {
  const profile = resolveProfile(DECLARED);
  // It is not a row. Nothing was added to the named table by using it, and the
  // run cannot fetch the contract back by name later.
  assert.deepEqual(Object.keys(PROFILES), ['spec-nano']);
  assert.match(profile.id, /^declared:[0-9a-f]{64}$/);
  assert.equal(profile.goal, DECLARED.goal);
  // The goal is the caller's words. The machinery stores and reports it and
  // never matches on it: a different goal with identical terms is a different
  // contract, and identical terms with a different goal are too.
  assert.notEqual(resolveProfile({ ...DECLARED, goal: `${DECLARED.goal}, briefly` }).id, profile.id);
});

test('an incomplete contract stops the run before the source is even read', (t) => {
  const repositoryRoot = root(t);
  const { nonOmittableKinds: _dropped, ...incomplete } = DECLARED;
  assert.throws(
    () => bindSource({
      repositoryRoot,
      sourcePath: SOURCE_PATH,
      declaredRevision: digest(SOURCE),
      profileId: incomplete,
    }),
    (error) => error.code === 'invalid-profile',
  );
  // And a contract that constrains nothing is refused rather than obeyed.
  assert.throws(
    () => bindSource({
      repositoryRoot,
      sourcePath: SOURCE_PATH,
      declaredRevision: digest(SOURCE),
      profileId: { ...DECLARED, nonOmittableKinds: [], requiredContent: [] },
    }),
    (error) => error.code === 'invalid-profile',
  );
});
