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
  PROFILES,
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

test('there is no default profile beyond the declared table', () => {
  assert.deepEqual(Object.keys(PROFILES), ['spec-nano']);
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
  const section = DOCUMENT.split(/^## The `spec-nano` Profile\s*$/m)[1];
  const table = section.split(/^#{1,6} /m)[0];
  const row = table.split('\n').find((line) => line.includes('`structuralHeadings`'));
  assert.ok(row, 'synthesis-profile.md no longer documents structuralHeadings');
  const cell = row.split('|')[2];
  const documented = [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  assert.deepEqual(documented, [...PROFILES['spec-nano'].structuralHeadings]);
});

test('deriveBudgetStatus is the single budget rule and matches evaluateBudget', () => {
  assert.equal(deriveBudgetStatus(499, 500), 'within');
  assert.equal(deriveBudgetStatus(500, 500), 'at-limit');
  assert.equal(deriveBudgetStatus(501, 500), 'over');
  assert.equal(code(() => deriveBudgetStatus(3.5, 500)), 'invalid-input');
});

test('the documented spec-nano field list matches the frozen profile in both directions', () => {
  const section = DOCUMENT.split(/^## The `spec-nano` Profile\s*$/m)[1];
  assert.ok(section, 'synthesis-profile.md no longer carries the spec-nano field table');
  const table = section.split(/^#{1,6} /m)[0];
  const documented = [...table.matchAll(/^\| `([A-Za-z]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(documented, Object.keys(PROFILES['spec-nano']));
});
