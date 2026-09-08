/**
 * Contract test: the reduction this package asks for, against the provider that
 * has to perform it.
 *
 * `intent-request.md` writes down an output contract, and `intent-request.mjs`
 * builds a request in that shape and judges what comes back. Neither performs the
 * reduction, which is the point — but it does mean this package holds a
 * description of somebody else's obligations, and a description of an obligation
 * goes stale silently. A run would keep sending terms the provider no longer
 * accepts, or keep refusing results it correctly produced.
 *
 * So the description is checked against the real provider rather than against
 * prose: the provider's own validators run over the shared worked fixture, and
 * the result they produce is handed to the consumer's gate. A contract described
 * in two places agrees here or it does not agree at all.
 *
 * This is a test reaching across a package boundary on purpose. Asserting a
 * dependency is the one thing that cannot be done from inside one package.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { resolveProfile } from '../../../synthesize/_atoms/synthesis-profile/synthesis-profile.mjs';
import { evaluateBudget } from '../../../synthesize/_atoms/synthesis-profile/synthesis-profile.mjs';
import { collectLedgerDefects, validateLedger } from '../../../synthesize/_atoms/disclosure-ledger/disclosure-ledger.mjs';
import { evaluateSplit } from '../../../synthesize/_atoms/split-proposal/split-proposal.mjs';
import { resolveOutcome } from '../../../synthesize/_atoms/synthesis-outcome/synthesis-outcome.mjs';
import { persistCandidate } from '../../../synthesize/_atoms/candidate-persistence/candidate-persistence.mjs';
import {
  CANDIDATE,
  CANDIDATE_PATH,
  DECLARED,
  ENTRIES,
  SOURCE,
  SOURCE_PATH,
} from '../../../synthesize/_molecules/bounded-synthesis/bounded-synthesis.declared.fixtures.mjs';
import {
  INTENT_OUTPUT_CONTRACT,
  SYNTHESIS_PROVIDER,
  assertIntentResult,
  buildIntentRequest,
} from './intent-request.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, '..', '..', '..', '..');

test('the provider accepts the terms this package states', () => {
  // Every term is required by the provider and stated here; a term the provider
  // stopped reading, or started requiring, fails this immediately.
  const profile = resolveProfile(INTENT_OUTPUT_CONTRACT);
  assert.match(profile.id, /^declared:[0-9a-f]{64}$/);
  assert.equal(profile.wordBudget, INTENT_OUTPUT_CONTRACT.wordBudget);
  assert.equal(profile.outputPattern, INTENT_OUTPUT_CONTRACT.outputPattern);
  assert.equal(profile.workspaceRoot, INTENT_OUTPUT_CONTRACT.workspaceRoot);
  assert.deepEqual([...profile.requiredContent], [...INTENT_OUTPUT_CONTRACT.requiredContent]);
  assert.deepEqual([...profile.nonOmittableKinds], [...INTENT_OUTPUT_CONTRACT.nonOmittableKinds]);

  // The bundle shape this package derives is the source shape the provider's own
  // sourceKind implies, and the candidate is the one the provider's own pattern
  // produces for that bundle's slug.
  const suffix = `.${profile.sourceKind.split('-').slice(1).join('-')}.md`;
  const request = buildIntentRequest({ binding: { digest: 'a'.repeat(64) }, slug: 'demo-adopter', runId: 'run-1', attempt: 1 });
  assert.equal(request.source, `${profile.workspaceRoot}s12-demo-adopter-r5-run-1-a1${suffix}`);
  assert.equal(request.candidate, profile.outputPattern.replace('<slug>', 's12-demo-adopter-r5-run-1-a1'));
  assert.equal(request.skill, SYNTHESIS_PROVIDER);
});

test('a corrected attempt publishes beside the one it supersedes, never over it', () => {
  // End to end against the provider: attempt one persists, and attempt two -
  // same binding, same terms, corrected proposal - persists too instead of
  // hitting `replacement-not-authorized`, because it has its own identity.
  const sandbox = fs.mkdtempSync(path.join(REPOSITORY_ROOT, '.test-sandbox-attempt-'));
  try {
    fs.mkdirSync(path.join(sandbox, 'synthesis', 'intent'), { recursive: true });
    const binding = { digest: 'a'.repeat(64) };
    const written = [];
    for (const attempt of [1, 2]) {
      const request = buildIntentRequest({ binding, slug: 'demo-adopter', runId: 'run-1', attempt });
      const text = `# Intent: demo-adopter\n\nAttempt ${attempt}.\n`;
      const contract = resolveProfile(INTENT_OUTPUT_CONTRACT).id;
      const receipt = persistCandidate({
        repositoryRoot: sandbox,
        candidatePath: request.candidate,
        candidateText: text,
        outcome: {
          status: 'complete',
          contract,
          candidate: {
            path: request.candidate,
            digest: createHash('sha256').update(text).digest('hex'),
          },
        },
        runId: `attempt-${attempt}`,
        profile: INTENT_OUTPUT_CONTRACT,
      });
      assert.equal(receipt.status, 'persisted');
      written.push(request.candidate);
    }
    assert.notEqual(written[0], written[1]);
    // Both survive, so what the operator rejected is still readable beside what
    // he confirmed, and the provider's no-overwrite boundary was never relaxed.
    for (const candidate of written) {
      assert.ok(fs.existsSync(path.join(sandbox, candidate)), candidate);
    }
    // Reusing an attempt identity is still refused, which is the boundary itself.
    const replay = buildIntentRequest({ binding, slug: 'demo-adopter', runId: 'run-1', attempt: 1 });
    const text = '# Intent: demo-adopter\n\nAttempt 1.\n';
    assert.throws(
      () => persistCandidate({
        repositoryRoot: sandbox,
        candidatePath: replay.candidate,
        candidateText: text,
        outcome: {
          status: 'complete',
          contract: resolveProfile(INTENT_OUTPUT_CONTRACT).id,
          candidate: { path: replay.candidate, digest: createHash('sha256').update(text).digest('hex') },
        },
        runId: 'attempt-1-replay',
        profile: INTENT_OUTPUT_CONTRACT,
      }),
      (error) => error.code === 'replacement-not-authorized',
    );
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test('a real reduction produced by the provider is a result this package accepts', () => {
  // The strongest form of this check: run the provider's own validators over the
  // provider's own worked fixture, normalize the result the way the molecule
  // does, and hand it to the consumer's gate.
  const sourceDigest = createHash('sha256').update(SOURCE).digest('hex');
  const binding = {
    status: 'bound', sourcePath: SOURCE_PATH, slug: 'demo-adopter',
    revision: sourceDigest, digest: sourceDigest,
  };
  const budget = evaluateBudget(DECLARED, CANDIDATE);
  const ledger = validateLedger({
    entries: ENTRIES,
    sourceText: SOURCE,
    variantText: CANDIDATE,
    profileId: DECLARED,
    sourcePath: SOURCE_PATH,
    candidatePath: CANDIDATE_PATH,
  });
  const outcome = resolveOutcome({
    profileId: DECLARED,
    candidatePath: CANDIDATE_PATH,
    binding,
    budget,
    ledger,
    split: { status: 'not-required' },
  });
  assert.equal(outcome.status, 'complete');

  const request = buildIntentRequest({ binding, slug: 'demo-adopter', runId: 'run-1', attempt: 1 });
  assert.equal(request.candidate, outcome.candidate.path);

  // What the molecule stamps on: which provider it invoked, and the candidate
  // bytes it read back from the path the provider returned.
  const record = {
    status: outcome.status,
    profileId: ledger.profileId,
    contractTerms: INTENT_OUTPUT_CONTRACT,
    sourceDigest: binding.digest,
    candidatePath: outcome.candidate.path,
    candidateDigest: outcome.candidate.digest,
    ledger,
    synthesizedBy: SYNTHESIS_PROVIDER,
    intentText: CANDIDATE,
  };
  for (const field of ['status', 'profileId', 'sourceDigest', 'candidatePath', 'candidateDigest', 'ledger']) {
    assert.ok(record[field] !== undefined, `the provider supplies no ${field}`);
  }
  const permitted = assertIntentResult(record, binding, request);
  assert.equal(permitted.permitted, true);
  assert.equal(permitted.candidatePath, CANDIDATE_PATH);
  assert.equal(permitted.ledgerDigest, ledger.digest);
  assert.equal(permitted.ledgerAuthenticated, false);
});

test('the worked fixture is the contract this package states, so neither can drift alone', () => {
  assert.deepEqual({ ...DECLARED }, { ...INTENT_OUTPUT_CONTRACT });
  assert.ok(HERE.endsWith(path.join('_atoms', 'intent-request')));
});

test('five hundred words is a hard maximum the provider enforces over the whole candidate', () => {
  // The limit is asserted through the provider's own counter, not restated here.
  // A budget the consumer believed in and the provider did not would be the
  // worst kind of agreement: one nobody enforces.
  const budget = INTENT_OUTPUT_CONTRACT.wordBudget;
  assert.equal(budget, 500);
  const words = (count) => Array.from({ length: count }, () => 'word').join(' ');

  assert.equal(evaluateBudget(INTENT_OUTPUT_CONTRACT, words(budget - 1)).status, 'within');
  // Exactly the limit is allowed; one past it is not.
  assert.equal(evaluateBudget(INTENT_OUTPUT_CONTRACT, words(budget)).status, 'at-limit');
  assert.equal(evaluateBudget(INTENT_OUTPUT_CONTRACT, words(budget + 1)).status, 'over');

  // The count covers the COMPLETE candidate. A limit that ignored headings, list
  // markers, link text, or fenced content could be met by moving text into the
  // part it ignored.
  const furniture = `# Intent: demo\n\n## What this is for\n\n- ${words(budget)}\n`;
  assert.equal(evaluateBudget(INTENT_OUTPUT_CONTRACT, furniture).status, 'over');
});

test('essential intent that will not fit is split, never truncated or blurred', () => {
  // The two dishonest ways to make a candidate fit are dropping the tail and
  // softening a constraint until it stops committing anybody. Both are refused
  // by the provider under this contract, and the honest answer is a split.
  const profile = resolveProfile(INTENT_OUTPUT_CONTRACT);

  // Blurring: a non-omittable kind marked omitted is a ledger defect, whatever
  // reason accompanies it.
  for (const kind of profile.nonOmittableKinds) {
    assert.ok(
      INTENT_OUTPUT_CONTRACT.nonOmittableKinds.includes(kind),
      `${kind} must stay non-omittable under the contract this package states`,
    );
  }
  const dropped = ENTRIES.map((entry) => (entry.id === 'no-duplicates'
    ? {
      id: entry.id,
      kind: entry.kind,
      classification: entry.classification,
      disposition: 'omitted',
      covers: entry.covers,
      sourceAnchor: entry.sourceAnchor,
      reason: 'it did not fit the budget',
    }
    : entry));
  const codes = collectLedgerDefects({
    entries: dropped,
    sourceText: SOURCE,
    variantText: CANDIDATE.replace('It must never file the same defect twice.\n\n', ''),
    profileId: INTENT_OUTPUT_CONTRACT,
    sourcePath: SOURCE_PATH,
    candidatePath: CANDIDATE_PATH,
  }).map((defect) => defect.code);
  assert.ok(codes.includes('semantic-omission'), codes.join(', '));

  // Truncating: over budget with no proposed split does not resolve complete or
  // needs-split; it blocks.
  const ledger = validateLedger({
    entries: ENTRIES,
    sourceText: SOURCE,
    variantText: CANDIDATE,
    profileId: INTENT_OUTPUT_CONTRACT,
    sourcePath: SOURCE_PATH,
    candidatePath: CANDIDATE_PATH,
  });
  const sourceDigest = createHash('sha256').update(SOURCE).digest('hex');
  const overBudget = {
    words: profile.wordBudget + 1,
    budget: profile.wordBudget,
    status: 'over',
    profileId: profile.id,
  };
  const evidence = (split) => ({
    profileId: INTENT_OUTPUT_CONTRACT,
    candidatePath: CANDIDATE_PATH,
    binding: {
      status: 'bound', sourcePath: SOURCE_PATH, revision: sourceDigest, digest: sourceDigest,
    },
    budget: overBudget,
    ledger,
    split,
  });
  assert.deepEqual(resolveOutcome(evidence({ status: 'not-required' })).reasons, ['split-not-proposed']);

  // The honest answer: a bounded split that partitions the meaning that must
  // survive, with nothing dropped and nothing counted twice.
  const units = ledger.entries
    .filter((entry) => profile.nonOmittableKinds.includes(entry.kind))
    .map((entry) => entry.id);
  assert.ok(units.length >= 2, 'the worked fixture must carry enough to partition');
  const split = evaluateSplit({
    budgetStatus: 'over',
    ledgerEntries: ledger.entries,
    profileId: INTENT_OUTPUT_CONTRACT,
    ledgerDigest: ledger.digest,
    proposals: [
      {
        slug: 'demo-adopter-capture',
        title: 'Capture the failing run',
        boundary: 'what the skill produces for a maintainer',
        rationale: 'producing the report is one job',
        units: units.slice(0, 1),
      },
      {
        slug: 'demo-adopter-limits',
        title: 'Limits on disposition',
        boundary: 'what the skill refuses to do afterwards',
        rationale: 'refusing to dispose of a defect is a different job',
        units: units.slice(1),
      },
    ],
  });
  assert.equal(split.status, 'needs-split');
  assert.equal(resolveOutcome(evidence(split)).status, 'needs-split');
});
