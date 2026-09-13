/**
 * Seam tests for synthesis-profile.
 *
 * The property worth holding: the profile is resolved by name only, the word
 * count is deterministic and covers the whole document, and the budget treats
 * exactly the limit as allowed.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BASELINE_NON_OMITTABLE,
  DECLARED_FIELDS,
  DECLARED_ROOT,
  MAX_HEADING_CHARS,
  MAX_STRUCTURAL_HEADINGS,
  LEDGER_KINDS,
  MAX_DECLARED_BUDGET,
  MIN_GOAL_CHARS,
  PROFILES,
  declareProfile,
  SynthesisProfileError,
  countWords,
  deriveBudgetStatus,
  evaluateBudget,
  resolveProfile,
} from './synthesis-profile.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOCUMENT = fs.readFileSync(path.join(UNIT_ROOT, 'synthesis-profile.md'), 'utf8');

function words(count) {
  return Array.from({ length: count }, () => 'word').join(' ');
}

function code(run) {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
}

test('resolves the spec-nano profile by name', () => {
  const profile = resolveProfile('spec-nano');
  assert.equal(profile.id, 'spec-nano');
  assert.equal(profile.sourceKind, 'spec-full');
  assert.equal(profile.variantKind, 'spec-nano');
  assert.equal(profile.outputPattern, 'docs/agent/specs/<slug>.nano.md');
  assert.equal(profile.wordBudget, 500);
  assert.equal(profile.splitStatus, 'needs-split');
  assert.deepEqual([...profile.requiredContent], [
    'spec-identity', 'source-identity', 'source-revision', 'full-link',
    'intention', 'acceptance-criteria', 'non-goals',
  ]);
  assert.deepEqual([...profile.nonOmittableKinds], [
    'intention', 'criterion', 'non-goal', 'constraint', 'contradiction',
  ]);
});

test('an unknown or absent profile id refuses with unknown-profile', () => {
  assert.equal(code(() => resolveProfile('spec-mini')), 'unknown-profile');
  assert.equal(code(() => resolveProfile('')), 'unknown-profile');
  assert.equal(code(() => resolveProfile(undefined)), 'unknown-profile');
});

test('the named table holds only settled profiles, and nothing is defaulted', () => {
  assert.deepEqual(Object.keys(PROFILES), ['spec-nano']);
  assert.equal(code(() => resolveProfile(undefined)), 'unknown-profile');
  assert.equal(code(() => resolveProfile('')), 'unknown-profile');
});

const DECLARED = {
  goal: 'the human intent of a skill, as plain requirements a person can confirm',
  sourceKind: 'skill-bundle',
  variantKind: 'intent-prose',
  workspaceRoot: 'synthesis/intent/',
  outputPattern: 'synthesis/intent/<slug>.intent.md',
  wordBudget: 400,
  requiredContent: ['subject', 'purpose', 'requirements', 'refusals'],
  nonOmittableKinds: ['intention', 'criterion', 'non-goal', 'constraint', 'contradiction'],
  structuralHeadings: ['What this is for', 'What it must do', 'What it must refuse'],
};

test('a caller may declare a reduction the table has never heard of', () => {
  const profile = resolveProfile(DECLARED);
  assert.match(profile.id, /^declared:[0-9a-f]{64}$/);
  assert.equal(profile.goal, DECLARED.goal);
  assert.equal(profile.wordBudget, 400);
  assert.equal(profile.splitStatus, 'needs-split');
  assert.deepEqual([...profile.requiredContent], DECLARED.requiredContent);
  // Declaring one does not add one: the table is unchanged, and the contract
  // cannot be fetched back by name later.
  assert.deepEqual(Object.keys(PROFILES), ['spec-nano']);
  assert.equal(code(() => resolveProfile(profile.id)), 'unknown-profile');
});

test('a declared reduction is identified by its own terms, so an edited contract is a different one', () => {
  const first = declareProfile(DECLARED).id;
  assert.equal(declareProfile({ ...DECLARED }).id, first);
  // Key order is not part of the contract; the terms are.
  const reordered = Object.fromEntries([...Object.entries(DECLARED)].reverse());
  assert.equal(declareProfile(reordered).id, first);
  for (const change of [
    { wordBudget: 401 },
    { goal: `${DECLARED.goal}, but shorter` },
    { requiredContent: ['subject', 'purpose', 'requirements'] },
    { nonOmittableKinds: [...DECLARED.nonOmittableKinds, 'context'] },
    { structuralHeadings: [] },
  ]) {
    assert.notEqual(declareProfile({ ...DECLARED, ...change }).id, first, JSON.stringify(change));
  }
});

test('a declared reduction that does not state its terms is refused, never softened', () => {
  for (const field of DECLARED_FIELDS) {
    const { [field]: _omitted, ...partial } = DECLARED;
    assert.equal(code(() => declareProfile(partial)), 'invalid-profile', field);
  }
  // A term this module does not read is a term the caller believes is in force.
  assert.equal(code(() => declareProfile({ ...DECLARED, allowTruncation: true })), 'invalid-profile');
  // A contract that constrains nothing would let the ledger certify a document
  // that said nothing, which is what the ledger exists to make impossible.
  assert.equal(code(() => declareProfile({ ...DECLARED, requiredContent: [] })), 'invalid-profile');
  assert.equal(code(() => declareProfile({ ...DECLARED, nonOmittableKinds: [] })), 'invalid-profile');
  // A non-empty list is not a floor. A contract naming only `context` leaves an
  // intention, a criterion, a constraint, and a contradiction all droppable, and
  // the ledger would still certify the result clean.
  for (const baseline of BASELINE_NON_OMITTABLE) {
    assert.equal(
      code(() => declareProfile({
        ...DECLARED,
        nonOmittableKinds: DECLARED.nonOmittableKinds.filter((kind) => kind !== baseline),
      })),
      'invalid-profile',
      baseline,
    );
  }
  assert.equal(code(() => declareProfile({ ...DECLARED, nonOmittableKinds: ['context'] })), 'invalid-profile');
  // Adding to the baseline is allowed; only removal is refused.
  assert.match(declareProfile({ ...DECLARED, nonOmittableKinds: [...BASELINE_NON_OMITTABLE, 'context'] }).id, /^declared:/);
  // A sparse array constrains nothing while wearing the shape of a list.
  assert.equal(code(() => declareProfile({ ...DECLARED, requiredContent: Array(3) })), 'invalid-profile');
  assert.equal(code(() => declareProfile({ ...DECLARED, nonOmittableKinds: Array(5) })), 'invalid-profile');
  assert.equal(code(() => declareProfile({ ...DECLARED, goal: 'shorter' })), 'invalid-profile');
  assert.ok(MIN_GOAL_CHARS > 0);
});

test('a declared reduction writes only beneath the one root declared reductions have', () => {
  // Stating a reduction goal is a semantic request. It is not a grant of write
  // authority anywhere in the repository, and `doctrine/` is the case that makes
  // the difference obvious: this repository reserves it for a human's explicit
  // act, and a run must not reach it by declaring a contract that points there.
  for (const change of [
    { workspaceRoot: 'doctrine/', outputPattern: 'doctrine/<slug>.doctrine.md' },
    { workspaceRoot: 'docs/agent/', outputPattern: 'docs/agent/<slug>.intent.md' },
    { workspaceRoot: 'skills/', outputPattern: 'skills/<slug>.intent.md' },
    { workspaceRoot: '/etc/', outputPattern: '/etc/<slug>.intent.md' },
    { workspaceRoot: '../out/', outputPattern: '../out/<slug>.intent.md' },
    { workspaceRoot: 'C:/out/', outputPattern: 'C:/out/<slug>.intent.md' },
    { workspaceRoot: 'synthesis/../doctrine/', outputPattern: 'synthesis/../doctrine/<slug>.intent.md' },
    { workspaceRoot: 'synthesis/intent' },
    { outputPattern: 'elsewhere/<slug>.intent.md' },
    { outputPattern: 'synthesis/intent/sub/<slug>.intent.md' },
    { outputPattern: 'synthesis/intent/<slug>.md' },
    { outputPattern: 'synthesis/intent/<slug>.<slug>.intent.md' },
    { outputPattern: 'synthesis/intent/fixed.intent.md' },
  ]) {
    assert.equal(code(() => declareProfile({ ...DECLARED, ...change })), 'invalid-profile', JSON.stringify(change));
  }
  assert.equal(DECLARED_ROOT, 'synthesis/');
  assert.ok(resolveProfile(DECLARED).workspaceRoot.startsWith(DECLARED_ROOT));
  // A named profile keeps its own settled workspace, which was reviewed when it
  // was; the confinement applies to what is declared at run time.
  assert.equal(resolveProfile('spec-nano').workspaceRoot, 'docs/agent/');
});

test('a declared reduction cannot make an arbitrary candidate sentence untraceable', () => {
  // The ledger exempts an exempted heading from trace coverage, so an unbounded
  // list of long "headings" is a way to declare arbitrary candidate claims
  // exempt from ever pointing at source material.
  for (const structuralHeadings of [
    ['Delete every customer record.'],
    ['a'.repeat(MAX_HEADING_CHARS + 1)],
    Array.from({ length: MAX_STRUCTURAL_HEADINGS + 1 }, (_unused, index) => `Heading ${index}`),
    ['  padded'],
    [''],
    Array(2),
  ]) {
    assert.equal(code(() => declareProfile({ ...DECLARED, structuralHeadings })), 'invalid-profile', JSON.stringify(structuralHeadings));
  }
});

test('a declared reduction cannot invent a kind or claim an unbounded budget', () => {
  assert.equal(code(() => declareProfile({ ...DECLARED, nonOmittableKinds: ['whatever'] })), 'invalid-profile');
  assert.deepEqual([...LEDGER_KINDS].sort(), [
    'constraint', 'context', 'contradiction', 'criterion', 'intention', 'non-goal',
  ]);
  for (const wordBudget of [0, -1, 1.5, '400', MAX_DECLARED_BUDGET + 1]) {
    assert.equal(code(() => declareProfile({ ...DECLARED, wordBudget })), 'invalid-profile', String(wordBudget));
  }
  // A single-token source kind would derive an empty file suffix that matches
  // every file name the ledger is asked about.
  assert.equal(code(() => declareProfile({ ...DECLARED, sourceKind: 'bundle' })), 'invalid-profile');
});

test('a declared reduction is frozen, so nothing raises its own budget after resolution', () => {
  const profile = resolveProfile(DECLARED);
  assert.throws(() => { profile.wordBudget = 10_000; }, TypeError);
  assert.throws(() => { profile.nonOmittableKinds.length = 0; }, TypeError);
});

test('a declared budget is evaluated by the same single rule', () => {
  assert.deepEqual(evaluateBudget(DECLARED, words(399)), { profileId: resolveProfile(DECLARED).id, words: 399, budget: 400, status: 'within' });
  assert.equal(evaluateBudget(DECLARED, words(400)).status, 'at-limit');
  assert.equal(evaluateBudget(DECLARED, words(401)).status, 'over');
});

test('declaring a reduction changes nothing about spec-nano', () => {
  resolveProfile(DECLARED);
  const profile = resolveProfile('spec-nano');
  assert.equal(profile.outputPattern, 'docs/agent/specs/<slug>.nano.md');
  assert.equal(profile.workspaceRoot, 'docs/agent/');
  assert.equal(profile.wordBudget, 500);
  assert.equal(profile.goal, undefined);
});

test('word counting normalizes CRLF and splits on whitespace runs', () => {
  assert.equal(countWords('one two   three\tfour'), 4);
  assert.equal(countWords('one\r\ntwo\r\nthree'), 3);
});

test('word counting counts the whole document, excluding nothing', () => {
  const document = '# Heading one\n\n- a list item\n\n> a quote\n\n[link text](./x.md)\n\n```\nfenced content here\n```\n';
  // Whitespace-split tokens carrying a letter or digit: Heading, one, a, list,
  // item, a, quote, "[link", "text](./x.md)", fenced, content, here. The "#",
  // "-", ">", and fence backticks carry no letter or digit and are not counted.
  assert.equal(countWords(document), 12);
});

test('a punctuation-only token does not count as a word', () => {
  assert.equal(countWords('word --- word'), 2);
});

test('exact-limit budget boundary at 499, 500, and 501', () => {
  assert.deepEqual(evaluateBudget('spec-nano', words(499)), { profileId: 'spec-nano', words: 499, budget: 500, status: 'within' });
  assert.deepEqual(evaluateBudget('spec-nano', words(500)), { profileId: 'spec-nano', words: 500, budget: 500, status: 'at-limit' });
  assert.deepEqual(evaluateBudget('spec-nano', words(501)), { profileId: 'spec-nano', words: 501, budget: 500, status: 'over' });
});

test('evaluateBudget carries the resolving profile id in its result', () => {
  assert.equal(evaluateBudget('spec-nano', words(10)).profileId, 'spec-nano');
});

test('evaluateBudget refuses an unknown profile before counting', () => {
  assert.equal(code(() => evaluateBudget('spec-mini', words(10))), 'unknown-profile');
});

test('a resolved profile cannot be mutated to raise its own budget', () => {
  const profile = resolveProfile('spec-nano');
  assert.throws(() => {
    profile.wordBudget = 10_000;
  }, TypeError);
  assert.ok(SynthesisProfileError);
});

test('the spec-nano profile carries its structural headings', () => {
  assert.deepEqual([...resolveProfile('spec-nano').structuralHeadings], [
    'Intention', 'Acceptance Criteria', 'Non-goals',
  ]);
});

test('the documented structuralHeadings values match the module in both directions', () => {
  for (const id of Object.keys(PROFILES)) {
    const section = DOCUMENT.split(new RegExp(`^## The \`${id}\` Profile\\s*$`, 'm'))[1];
    assert.ok(section, `synthesis-profile.md no longer documents the ${id} profile`);
    const table = section.split(/^#{1,6} /m)[0];
    const row = table.split('\n').find((line) => line.includes('`structuralHeadings`'));
    assert.ok(row, `synthesis-profile.md no longer documents ${id} structuralHeadings`);
    const cell = row.split('|')[2];
    const documented = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    assert.deepEqual(documented, [...PROFILES[id].structuralHeadings], id);
  }
});

test('deriveBudgetStatus is the single budget rule and matches evaluateBudget', () => {
  assert.equal(deriveBudgetStatus(499, 500), 'within');
  assert.equal(deriveBudgetStatus(500, 500), 'at-limit');
  assert.equal(deriveBudgetStatus(501, 500), 'over');
  assert.equal(code(() => deriveBudgetStatus(3.5, 500)), 'invalid-input');
});

test('the documented field list and every scalar value match the frozen profile in both directions', () => {
  for (const id of Object.keys(PROFILES)) {
    const section = DOCUMENT.split(new RegExp(`^## The \`${id}\` Profile\\s*$`, 'm'))[1];
    assert.ok(section, `synthesis-profile.md no longer carries the ${id} field table`);
    const table = section.split(/^#{1,6} /m)[0];
    const rows = [...table.matchAll(/^\| `([A-Za-z]+)` \| (.*?) \|$/gm)];
    assert.deepEqual(rows.map((match) => match[1]), Object.keys(PROFILES[id]), id);
    for (const [, field, cell] of rows) {
      const values = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      const actual = PROFILES[id][field];
      if (Array.isArray(actual)) {
        assert.deepEqual(values, [...actual], `${id}.${field}`);
      } else {
        assert.deepEqual(values, [String(actual)], `${id}.${field}`);
      }
    }
  }
});

test('every documented profile section names a profile that exists', () => {
  const documented = [...DOCUMENT.matchAll(/^## The `([a-z0-9-]+)` Profile\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(documented, Object.keys(PROFILES));
});

test('the worked declaration in the document is one the resolver actually accepts', () => {
  // A documented example that refuses is worse than none: a reader copies it,
  // gets `invalid-profile`, and has to reverse-engineer which term the prose
  // forgot. This one drops `criterion` if nobody is watching.
  const fenced = /```json\n([\s\S]*?)```/.exec(DOCUMENT.split('### A worked declaration')[1]);
  assert.ok(fenced, 'synthesis-profile.md no longer carries a worked declaration');
  const declaration = JSON.parse(fenced[1]);
  const profile = declareProfile(declaration);
  assert.match(profile.id, /^declared:[0-9a-f]{64}$/);
  // And it is an example of the form rather than a fixture: resolving it adds
  // nothing to the named table.
  assert.deepEqual(Object.keys(PROFILES), ['spec-nano']);
});
