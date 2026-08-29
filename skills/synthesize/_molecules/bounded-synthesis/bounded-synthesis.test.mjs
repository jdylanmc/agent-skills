/**
 * End-to-end pipeline tests for the bounded-synthesis molecule.
 *
 * This is a support file of the molecule (its name begins with the unit name),
 * not a new unit. It drives the WHOLE deterministic pipeline — bindFile ->
 * resolveProfile/evaluateBudget -> validateLedger -> evaluateSplit ->
 * resolveOutcome — against real fixtures written under `.test-sandbox/`, so a
 * regression in any stage would surface here even when each atom's own seam
 * tests still pass.
 *
 * The budget fixtures are FIXED literal text whose word count is stated as a
 * literal number and asserted against the production counter. They are never
 * padded to a target by calling `countWords`, so a counting regression breaks a
 * test rather than silently recalibrating the fixture. The padding is meaningful,
 * fully traced prose that the ledger accounts for on both sides.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { bindFile } from '../../_atoms/source-binding/source-binding.mjs';
import { countWords, evaluateBudget, resolveProfile } from '../../_atoms/synthesis-profile/synthesis-profile.mjs';
import { validateLedger } from '../../_atoms/disclosure-ledger/disclosure-ledger.mjs';
import { evaluateSplit } from '../../_atoms/split-proposal/split-proposal.mjs';
import { resolveOutcome } from '../../_atoms/synthesis-outcome/synthesis-outcome.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

const PROFILE = 'spec-nano';
const SOURCE_REL = 'docs/agent/specs/faster-checkout.full.md';
const CANDIDATE_PATH = 'docs/agent/specs/faster-checkout.nano.md';

const L = {
  spec: 'Spec identity is SPEC-FASTER-CHECKOUT for this bounded feature.',
  srcId: 'Discovery source is docs/agent/discovery/faster-checkout for this feature.',
  rev: 'Source revision is pinned to the recorded content digest value.',
  full: 'Full specification companion link is faster-checkout.full.md sibling document.',
  intent: 'Customers can select an eligible payment method without leaving the checkout flow.',
  ac1: 'An eligible customer can see the additional payment method during checkout today.',
  ac2: 'An ineligible customer sees the existing checkout experience left unchanged here.',
  nonGoal: 'Selecting a payment provider implementation is out of scope for this work item.',
};

// A single, short, fully traced cohesive line for scenarios that do not probe
// the budget boundary. It appears in both the source and the candidate and is
// named by one ledger entry.
const SHORT_PADDING = 'This short cohesive padding sentence is fully traced on both sides of the ledger.';

// Meaningful, fully traced prose. The 499-word candidate is the base document
// plus this paragraph; 500 and 501 append one more real word each. The base
// candidate is independently 83 words, so the paragraph lengths are 416, 417,
// and 418 respectively.
const PADDING_499 = [
  'The bounded synthesis padding paragraph exists to hold a known quantity of fully traced prose that the disclosure ledger accounts for on both sides.',
  'Every word here is present in the source specification and in the candidate nano so that no line is ever invented or left unaccounted for.',
  'The paragraph explains, in ordinary language, that the faster checkout feature lets an eligible customer choose an additional payment method without leaving the flow.',
  'It restates that an ineligible customer keeps the existing experience, and that choosing a payment provider is expressly out of scope for this work item.',
  'Because the candidate is measured over the whole document, this prose counts toward the budget exactly like a heading, a list marker, or fenced content would.',
  'The synthesis machinery treats the paragraph as one cohesive anchor, so the ledger entry that names it covers the entire line and leaves no residue behind.',
  'A single deterministic word count decides whether the candidate fits, and the boundary is exact, so five hundred words is allowed and five hundred and one is not.',
  'When the required meaning cannot fit, the honest response is a named refusal with a proposed split rather than truncation, relocation of authority, or a weakened criterion.',
  'This fixture therefore keeps the padding meaningful and traceable, never numeric garbage, so a regression in the counter breaks the assertion instead of quietly recalibrating it.',
  'The reviewer who reads the candidate still decides whether the smaller artifact says the right thing, because the mechanical checks prove accounting and traceability rather than preserved meaning.',
  'Each sentence adds ordinary words so the paragraph reaches a stable and independently known length that the test pins with a literal number rather than a computed one.',
  'The pipeline binds the source, resolves the profile, renders the candidate, validates the ledger, evaluates a split when needed, and finally resolves the outcome from that evidence.',
  'The revision that pins the source is the content digest of the exact bytes read, so a later run can prove it looked at the same artifact rather than a newer draft.',
  'The ledger digest pins the account of every meaningful thing in the source and what became of it.',
  'A shorter artifact that hides what it dropped is worse than a longer one honest about its own size.',
  'With this closing sentence the padding paragraph reaches its intended and independently counted length, so the budget assertions pin the exact boundary between a complete candidate and one that still needs a split.',
].join(' ');
const PADDING_500 = `${PADDING_499} precisely`;
const PADDING_501 = `${PADDING_500} indeed`;

function sourceBodyOf(padding) {
  return [L.spec, L.srcId, L.rev, L.full, L.intent, `AC-001: ${L.ac1}`, `AC-002: ${L.ac2}`, L.nonGoal, padding, ''].join('\n');
}

function candidateOf(padding) {
  return [
    L.spec, L.srcId, L.rev, L.full, L.intent,
    `- AC-001: ${L.ac1}`,
    `- AC-002: ${L.ac2}`,
    L.nonGoal,
    padding,
  ].join('\n');
}

function entriesOf(padding) {
  return [
    { id: 'spec-identity', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: L.spec, variantAnchor: L.spec, covers: ['spec-identity'] },
    { id: 'source-identity', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: L.srcId, variantAnchor: L.srcId, covers: ['source-identity'] },
    { id: 'source-revision', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: L.rev, variantAnchor: L.rev, covers: ['source-revision'] },
    { id: 'full-link', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: L.full, variantAnchor: L.full, covers: ['full-link'] },
    { id: 'intention', disposition: 'retained', kind: 'intention', classification: 'authoritative', sourceAnchor: L.intent, variantAnchor: L.intent, covers: ['intention'] },
    { id: 'ac-1', disposition: 'retained', kind: 'criterion', classification: 'authoritative', sourceAnchor: `AC-001: ${L.ac1}`, variantAnchor: `AC-001: ${L.ac1}`, covers: ['acceptance-criteria'] },
    { id: 'ac-2', disposition: 'retained', kind: 'criterion', classification: 'authoritative', sourceAnchor: `AC-002: ${L.ac2}`, variantAnchor: `AC-002: ${L.ac2}`, covers: [] },
    { id: 'non-goals', disposition: 'retained', kind: 'non-goal', classification: 'authoritative', sourceAnchor: L.nonGoal, variantAnchor: L.nonGoal, covers: ['non-goals'] },
    { id: 'padding', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: padding, variantAnchor: padding, covers: [] },
  ];
}

function validProposals() {
  return [
    { slug: 'eligibility', title: 'Eligibility cohesive piece', boundary: 'Everything about customer eligibility today.', units: ['intention', 'ac-1'], rationale: 'Eligibility is one cohesive concern here.' },
    { slug: 'display', title: 'Display cohesive piece', boundary: 'Everything about method display here.', units: ['ac-2', 'non-goals'], rationale: 'Display is a separate concern here.' },
  ];
}

function sandbox(t) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'bounded-synthesis-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeSource(root, body) {
  const absolute = path.join(root, SOURCE_REL);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, body);
  return createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
}

/** Run the whole deterministic pipeline and return every stage result. */
function pipeline(root, { declaredRevision, variantText, entries, proposals = [] }) {
  let binding;
  try {
    binding = bindFile({ repositoryRoot: root, sourcePath: SOURCE_REL, declaredRevision, profileId: PROFILE });
  } catch (error) {
    binding = { status: error.code };
  }
  const budget = evaluateBudget(PROFILE, variantText);
  const sourceText = fs.readFileSync(path.join(root, SOURCE_REL), 'utf8');
  let ledger;
  try {
    ledger = validateLedger({ entries, sourceText, variantText, profileId: PROFILE, sourcePath: SOURCE_REL, candidatePath: CANDIDATE_PATH });
  } catch (error) {
    ledger = { status: 'defect', code: error.code };
  }
  const split = (() => {
    try {
      return evaluateSplit({ budgetStatus: budget.status, proposals, ledgerEntries: entries, profileId: PROFILE, ledgerDigest: ledger.digest ?? null });
    } catch (error) {
      return { status: error.code };
    }
  })();
  const outcome = resolveOutcome({ profileId: PROFILE, candidatePath: CANDIDATE_PATH, binding, budget, ledger, split });
  return { binding, budget, ledger, split, outcome };
}

test('the profile the pipeline names actually resolves', () => {
  assert.equal(resolveProfile(PROFILE).id, PROFILE);
});

test('deterministic repeatability: the same inputs produce byte-identical stage results', (t) => {
  const root = sandbox(t);
  const declaredRevision = writeSource(root, sourceBodyOf(SHORT_PADDING));
  const args = { declaredRevision, variantText: candidateOf(SHORT_PADDING), entries: entriesOf(SHORT_PADDING) };
  const first = pipeline(root, args);
  const second = pipeline(root, args);
  for (const stage of ['binding', 'budget', 'ledger', 'split', 'outcome']) {
    assert.equal(JSON.stringify(first[stage]), JSON.stringify(second[stage]), `${stage} is not byte-identical across runs`);
  }
  assert.equal(first.outcome.status, 'complete');
});

test('the budget fixtures carry exactly 499, 500, and 501 words', () => {
  // The counter is pinned to independently stated literal numbers. A counting
  // regression breaks this assertion rather than re-calibrating the fixture.
  assert.equal(countWords(candidateOf(PADDING_499)), 499);
  assert.equal(countWords(candidateOf(PADDING_500)), 500);
  assert.equal(countWords(candidateOf(PADDING_501)), 501);
});

test('exact-limit boundary end to end: 499 within, 500 at-limit, both complete', (t) => {
  const root = sandbox(t);

  const rev499 = writeSource(root, sourceBodyOf(PADDING_499));
  const at499 = pipeline(root, { declaredRevision: rev499, variantText: candidateOf(PADDING_499), entries: entriesOf(PADDING_499) });
  assert.equal(at499.budget.words, 499);
  assert.equal(at499.budget.status, 'within');
  assert.equal(at499.ledger.status, 'clean');
  assert.equal(at499.outcome.status, 'complete');

  const rev500 = writeSource(root, sourceBodyOf(PADDING_500));
  const at500 = pipeline(root, { declaredRevision: rev500, variantText: candidateOf(PADDING_500), entries: entriesOf(PADDING_500) });
  assert.equal(at500.budget.words, 500);
  assert.equal(at500.budget.status, 'at-limit');
  assert.equal(at500.outcome.status, 'complete');
});

test('at 501 words the run is exactly needs-split with valid boundaries', (t) => {
  const root = sandbox(t);
  const rev501 = writeSource(root, sourceBodyOf(PADDING_501));
  const at501 = pipeline(root, { declaredRevision: rev501, variantText: candidateOf(PADDING_501), entries: entriesOf(PADDING_501), proposals: validProposals() });
  assert.equal(at501.budget.words, 501);
  assert.equal(at501.budget.status, 'over');
  assert.equal(at501.ledger.status, 'clean');
  assert.equal(at501.split.status, 'needs-split');
  assert.equal(at501.split.proposals.length, 2);
  assert.equal(at501.outcome.status, 'needs-split');
});

test('a source whose bytes changed after the revision was captured resolves stale-source', (t) => {
  const root = sandbox(t);
  const declaredRevision = writeSource(root, sourceBodyOf(SHORT_PADDING));
  // The bytes move underneath the pinned revision.
  fs.writeFileSync(path.join(root, SOURCE_REL), `${sourceBodyOf(SHORT_PADDING)}\nA late edit changed the source bytes here.\n`);
  const result = pipeline(root, { declaredRevision, variantText: candidateOf(SHORT_PADDING), entries: entriesOf(SHORT_PADDING) });
  assert.equal(result.binding.status, 'stale-source');
  assert.equal(result.outcome.status, 'stale-source');
});

test('a constraint present in the source but absent from the ledger resolves refused with unaccounted-source', (t) => {
  const root = sandbox(t);
  const body = `${sourceBodyOf(SHORT_PADDING)}The feature performs no second network round trip during checkout.\n`;
  const declaredRevision = writeSource(root, body);
  const result = pipeline(root, { declaredRevision, variantText: candidateOf(SHORT_PADDING), entries: entriesOf(SHORT_PADDING) });
  assert.equal(result.ledger.code, 'unaccounted-source');
  assert.equal(result.outcome.status, 'refused');
  assert.deepEqual(result.outcome.reasons, ['unaccounted-source']);
});

test('a fabricated candidate line resolves refused with invented-claim', (t) => {
  const root = sandbox(t);
  const declaredRevision = writeSource(root, sourceBodyOf(SHORT_PADDING));
  const variantText = `${candidateOf(SHORT_PADDING)}\nAn invented promise the source never supplied here.`;
  const result = pipeline(root, { declaredRevision, variantText, entries: entriesOf(SHORT_PADDING) });
  assert.equal(result.ledger.code, 'invented-claim');
  assert.equal(result.outcome.status, 'refused');
  assert.deepEqual(result.outcome.reasons, ['invented-claim']);
});

test('unsourced padding appended to the candidate resolves refused with invented-claim', (t) => {
  const root = sandbox(t);
  const declaredRevision = writeSource(root, sourceBodyOf(SHORT_PADDING));
  // Padding the candidate with prose the source never carried and no entry
  // anchors is exactly an invented claim.
  const variantText = `${candidateOf(SHORT_PADDING)}\nAdded filler prose the source never carried to pad the candidate out.`;
  const result = pipeline(root, { declaredRevision, variantText, entries: entriesOf(SHORT_PADDING) });
  assert.equal(result.ledger.code, 'invented-claim');
  assert.equal(result.outcome.status, 'refused');
});

test('a degenerate anchor resolves refused with degenerate-anchor', (t) => {
  const root = sandbox(t);
  const declaredRevision = writeSource(root, sourceBodyOf(SHORT_PADDING));
  const entries = entriesOf(SHORT_PADDING);
  entries[4] = { ...entries[4], sourceAnchor: 'checkout flow' };
  const result = pipeline(root, { declaredRevision, variantText: candidateOf(SHORT_PADDING), entries });
  assert.equal(result.ledger.code, 'degenerate-anchor');
  assert.equal(result.outcome.status, 'refused');
  assert.deepEqual(result.outcome.reasons, ['degenerate-anchor']);
});

test('an omitted acceptance criterion resolves refused with weakened-criterion', (t) => {
  const root = sandbox(t);
  const declaredRevision = writeSource(root, sourceBodyOf(SHORT_PADDING));
  const entries = entriesOf(SHORT_PADDING);
  entries[6] = { ...entries[6], disposition: 'omitted', reason: 'dropped a criterion to save words', variantAnchor: undefined };
  // Remove the corresponding candidate line so only the omission shows.
  const variantText = candidateOf(SHORT_PADDING).split('\n').filter((line) => !line.includes('AC-002')).join('\n');
  const result = pipeline(root, { declaredRevision, variantText, entries });
  assert.equal(result.ledger.code, 'weakened-criterion');
  assert.equal(result.outcome.status, 'refused');
  assert.deepEqual(result.outcome.reasons, ['weakened-criterion']);
});

test('over-budget meaning resolves needs-split with a valid partition and blocked without one', (t) => {
  const root = sandbox(t);
  const declaredRevision = writeSource(root, sourceBodyOf(PADDING_501));
  const over = candidateOf(PADDING_501);

  const withSplit = pipeline(root, { declaredRevision, variantText: over, entries: entriesOf(PADDING_501), proposals: validProposals() });
  assert.equal(withSplit.budget.status, 'over');
  assert.equal(withSplit.split.status, 'needs-split');
  assert.equal(withSplit.outcome.status, 'needs-split');

  const withoutSplit = pipeline(root, { declaredRevision, variantText: over, entries: entriesOf(PADDING_501), proposals: [] });
  assert.equal(withoutSplit.split.status, 'insufficient-split');
  assert.equal(withoutSplit.outcome.status, 'blocked');
});

test('status-only evidence stubs resolve blocked, never complete', () => {
  const outcome = resolveOutcome({
    profileId: PROFILE,
    candidatePath: CANDIDATE_PATH,
    binding: { status: 'bound' },
    budget: { status: 'within' },
    ledger: { status: 'clean' },
  });
  assert.equal(outcome.status, 'blocked');
});

test('a faithful ledger for the canonical spec-pair-shaped nano resolves complete', (t) => {
  // Regression guard for the over-strict anchor threshold: the canonical nano's
  // short title and metadata lines must be accountable with whole-line anchors,
  // so an honest first-consumer artifact resolves complete, not degenerate-anchor.
  const root = sandbox(t);
  const N = {
    title: 'Faster checkout',
    specId: 'Spec ID: SPEC-FASTER-CHECKOUT',
    source: 'Source: docs/agent/discovery/faster-checkout.md',
    rev: 'Source revision: 0123abcd4567ef89',
    full: 'Full specification: [faster-checkout.full.md](./faster-checkout.full.md)',
    intent: L.intent,
    ac1: L.ac1,
    ac2: L.ac2,
    nonGoal: L.nonGoal,
  };
  const nano = [
    `# ${N.title}`,
    `- ${N.specId}`,
    `- ${N.source}`,
    `- ${N.rev}`,
    `- ${N.full}`,
    '## Intention',
    N.intent,
    '## Acceptance Criteria',
    `- AC-001: ${N.ac1}`,
    `- AC-002: ${N.ac2}`,
    '## Non-goals',
    N.nonGoal,
  ].join('\n');
  const fullBody = [
    N.title, N.specId, N.source, N.rev, N.full, N.intent,
    `AC-001: ${N.ac1}`, `AC-002: ${N.ac2}`, N.nonGoal, '',
  ].join('\n');
  const entries = [
    { id: 'title', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.title, variantAnchor: N.title, covers: [] },
    { id: 'spec-identity', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.specId, variantAnchor: N.specId, covers: ['spec-identity'] },
    { id: 'source-identity', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.source, variantAnchor: N.source, covers: ['source-identity'] },
    { id: 'source-revision', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.rev, variantAnchor: N.rev, covers: ['source-revision'] },
    { id: 'full-link', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.full, variantAnchor: N.full, covers: ['full-link'] },
    { id: 'intention', disposition: 'retained', kind: 'intention', classification: 'authoritative', sourceAnchor: N.intent, variantAnchor: N.intent, covers: ['intention'] },
    { id: 'ac-1', disposition: 'retained', kind: 'criterion', classification: 'authoritative', sourceAnchor: `AC-001: ${N.ac1}`, variantAnchor: `AC-001: ${N.ac1}`, covers: ['acceptance-criteria'] },
    { id: 'ac-2', disposition: 'retained', kind: 'criterion', classification: 'authoritative', sourceAnchor: `AC-002: ${N.ac2}`, variantAnchor: `AC-002: ${N.ac2}`, covers: [] },
    { id: 'non-goals', disposition: 'retained', kind: 'non-goal', classification: 'authoritative', sourceAnchor: N.nonGoal, variantAnchor: N.nonGoal, covers: ['non-goals'] },
  ];
  const declaredRevision = writeSource(root, fullBody);
  const result = pipeline(root, { declaredRevision, variantText: nano, entries });
  assert.equal(result.budget.status, 'within');
  assert.equal(result.ledger.status, 'clean');
  assert.equal(result.outcome.status, 'complete');
});

test('a realistic multi-feature full/nano fixture resolves complete end to end', (t) => {
  // The round-4 regression guard: an honest, RICH nano — three criteria, two
  // non-goals, a table, a nested list, links, an indented continuation line, a
  // blockquote, and fenced content — must still reach within/clean/complete
  // under the hardened anchor, residue, and fence rules. The full and nano share
  // the meaningful lines so every retained entry traces to exact material on
  // both sides; the nano adds Markdown structure the ledger accounts for.
  const root = sandbox(t);

  // Each row is [markdown line, anchor, entry overrides]. A null entry means the
  // line is a declared section label or a fence delimiter, accounted for as
  // structure rather than by an anchor.
  const R = [
    ['# Faster Checkout Rollout', 'Faster Checkout Rollout', { id: 'title', kind: 'context', classification: 'supporting', covers: [] }],
    ['Spec ID: SPEC-FASTER-CHECKOUT', 'Spec ID: SPEC-FASTER-CHECKOUT', { id: 'spec-identity', kind: 'context', classification: 'supporting', covers: ['spec-identity'] }],
    ['Source: docs/agent/discovery/faster-checkout.md', 'Source: docs/agent/discovery/faster-checkout.md', { id: 'source-identity', kind: 'context', classification: 'supporting', covers: ['source-identity'] }],
    ['Source revision: 0123abcd4567ef89', 'Source revision: 0123abcd4567ef89', { id: 'source-revision', kind: 'context', classification: 'supporting', covers: ['source-revision'] }],
    ['Full specification: [faster-checkout.full.md](./faster-checkout.full.md)', 'Full specification: [faster-checkout.full.md](./faster-checkout.full.md)', { id: 'full-link', kind: 'context', classification: 'supporting', covers: ['full-link'] }],
    ['## Intention', null, null],
    ['Customers can select an eligible payment method without leaving the checkout flow.', 'Customers can select an eligible payment method without leaving the checkout flow.', { id: 'intention', kind: 'intention', classification: 'authoritative', covers: ['intention'] }],
    ['## Acceptance Criteria', null, null],
    ['- AC-001: An eligible customer can see the additional payment method during checkout today.', 'AC-001: An eligible customer can see the additional payment method during checkout today.', { id: 'ac-1', kind: 'criterion', classification: 'authoritative', covers: ['acceptance-criteria'] }],
    ['- AC-002: An ineligible customer sees the existing checkout experience left unchanged here.', 'AC-002: An ineligible customer sees the existing checkout experience left unchanged here.', { id: 'ac-2', kind: 'criterion', classification: 'authoritative', covers: [] }],
    ['- AC-003: A returning customer keeps any previously saved eligible payment method today.', 'AC-003: A returning customer keeps any previously saved eligible payment method today.', { id: 'ac-3', kind: 'criterion', classification: 'authoritative', covers: [] }],
    ['## Non-goals', null, null],
    ['- Selecting a payment provider implementation is out of scope for this work item.', 'Selecting a payment provider implementation is out of scope for this work item.', { id: 'non-goals', kind: 'non-goal', classification: 'authoritative', covers: ['non-goals'] }],
    ['- Redesigning the checkout visual layout is out of scope for this rollout effort.', 'Redesigning the checkout visual layout is out of scope for this rollout effort.', { id: 'non-goal-2', kind: 'non-goal', classification: 'authoritative', covers: [] }],
    ['## Rollout Notes', 'Rollout Notes', { id: 'rollout-notes', kind: 'context', classification: 'supporting', covers: [] }],
    ['| Metric | Target |', '| Metric | Target |', { id: 'table-head', kind: 'context', classification: 'supporting', covers: [] }],
    ['| --- | --- |', '| --- | --- |', { id: 'table-sep', kind: 'context', classification: 'supporting', covers: [] }],
    ['| Latency budget | 500 ms per request |', '| Latency budget | 500 ms per request |', { id: 'table-latency', kind: 'context', classification: 'supporting', covers: [] }],
    ['| Error rate ceiling | under 1 percent |', '| Error rate ceiling | under 1 percent |', { id: 'table-error', kind: 'context', classification: 'supporting', covers: [] }],
    ['> The rollout follows the staged eligibility plan agreed with the payments team.', 'The rollout follows the staged eligibility plan agreed with the payments team.', { id: 'quote', kind: 'context', classification: 'supporting', covers: [] }],
    ['- Phase one enables eligibility for the first customer wave during checkout.', 'Phase one enables eligibility for the first customer wave during checkout.', { id: 'phase-one', kind: 'context', classification: 'supporting', covers: [] }],
    ['  - Phase one covers the internal pilot customers before the public rollout.', 'Phase one covers the internal pilot customers before the public rollout.', { id: 'phase-one-nested', kind: 'context', classification: 'supporting', covers: [] }],
    ['  continued under phase one, the pilot excludes external partner accounts today.', 'continued under phase one, the pilot excludes external partner accounts today.', { id: 'phase-one-cont', kind: 'context', classification: 'supporting', covers: [] }],
    ['```', null, null],
    ['deploy checkout rollout to the eligible customer cohort in production now.', 'deploy checkout rollout to the eligible customer cohort in production now.', { id: 'fenced-deploy', kind: 'context', classification: 'supporting', covers: [] }],
    ['```', null, null],
  ];

  const doc = R.map((row) => row[0]).join('\n');
  const entries = R.filter((row) => row[2] !== null).map((row) => ({
    id: row[2].id,
    disposition: 'retained',
    kind: row[2].kind,
    classification: row[2].classification,
    sourceAnchor: row[1],
    variantAnchor: row[1],
    covers: row[2].covers,
  }));

  const declaredRevision = writeSource(root, `${doc}\n`);
  const result = pipeline(root, { declaredRevision, variantText: doc, entries });
  assert.ok(result.budget.words < 500, `expected under budget; got ${result.budget.words}`);
  assert.equal(result.budget.status, 'within');
  assert.equal(result.ledger.status, 'clean', `ledger not clean: ${JSON.stringify(result.ledger)}`);
  assert.equal(result.outcome.status, 'complete');
});
