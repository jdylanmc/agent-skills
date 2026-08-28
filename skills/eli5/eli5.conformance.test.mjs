import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import {
  LADDER_LEVELS,
  LINE_WORD_LIMIT,
  MINIMUM_BULLETS,
  SECTION_WORD_LIMIT,
} from './_atoms/explanation-ladder/explanation-ladder.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'eli5/SKILL.md';
const GROUNDING = 'eli5/_atoms/subject-grounding/subject-grounding.md';
const LADDER = 'eli5/_atoms/explanation-ladder/explanation-ladder.md';
const PINNED_TOOLS = ['execute', 'read', 'search'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

test('eli5 is user-invocable, model-invocable, and read-only (criteria 1, 9)', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'eli5');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description carries positive and negative triggers (criterion 1)', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /Use when/);
  assert.match(description, /\/eli5 <subject>/);
  assert.match(description, /three increasing levels/);
  assert.match(description, /Do not use/);
  assert.match(description, /domain-mapping/);
  assert.match(description, /discovery/);
  assert.match(description, /interrogate/);
  assert.match(description, /spec/);
  assert.match(description, /implement or modify/);
});

test('the skill composes exactly chronicler and the two local atoms', () => {
  const parsed = frontmatter(ENTRY);

  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'eli5/_atoms/subject-grounding/subject-grounding.md',
    'eli5/_atoms/explanation-ladder/explanation-ladder.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'eli5/_atoms/subject-grounding/subject-grounding.md',
    'eli5/_atoms/explanation-ladder/explanation-ladder.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('nothing in the closure widens the pinned grant (criterion 9)', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) {
      required.add(tool);
    }
  }

  const excess = [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort();
  assert.deepEqual(excess, [], `a composed unit needs ${excess.join(', ')}`);
  assert.deepEqual(derived.grantViolations, []);
});

test('the package pins the three levels, in order, with the required labels (criterion 2)', () => {
  assert.deepEqual(
    LADDER_LEVELS.map((level) => level.id),
    ['five-year-old', 'junior', 'expert'],
  );
  assert.deepEqual(LADDER_LEVELS.map((level) => level.heading), [
    'Explain like I am five',
    'Explain like I am a junior practitioner',
    'Explain like I am an expert',
  ]);

  const ladder = flat(LADDER);
  const fiveAt = ladder.indexOf('Explain like I am five');
  const juniorAt = ladder.indexOf('Explain like I am a junior practitioner');
  const expertAt = ladder.indexOf('Explain like I am an expert');
  assert.ok(fiveAt >= 0 && juniorAt > fiveAt && expertAt > juniorAt, 'levels appear in order');

  const entry = flat(ENTRY);
  for (const heading of LADDER_LEVELS.map((level) => level.heading)) {
    assert.ok(entry.includes(heading), `the output contract names "${heading}"`);
  }
});

test('the concise, bullet-heavy style is stated and pinned to the checker constants (criterion 3)', () => {
  const ladder = flat(LADDER);

  assert.match(ladder, /extremely concise/);
  assert.match(ladder, /Short bullets/);
  assert.match(ladder, /\*\*bold\*\*|bold/i);
  assert.ok(ladder.includes(String(SECTION_WORD_LIMIT)), `states the ${SECTION_WORD_LIMIT}-word section limit`);
  assert.ok(ladder.includes(String(LINE_WORD_LIMIT)), `states the ${LINE_WORD_LIMIT}-word line limit`);
  assert.ok(ladder.includes(String(MINIMUM_BULLETS)), `states the ${MINIMUM_BULLETS}-bullet minimum`);
});

test('the junior audience adapts to the subject domain rather than defaulting to software (criterion 4)', () => {
  const ladder = flat(LADDER);

  assert.match(ladder, /junior practitioner of the subject's own field/);
  assert.match(ladder, /does not default to software/);
  assert.match(ladder, /junior lawyer/);
  assert.match(ladder, /junior biologist/);
  assert.match(ladder, /codebase or software system a junior software engineer/);
  assert.match(ladder, /do not silently fall back to software engineering/);
});

test('repository subjects are grounded before explaining, and grounding is bounded (criteria 5, 6)', () => {
  const grounding = flat(GROUNDING);
  const entry = flat(ENTRY);

  assert.match(entry, /Ground the subject/);
  assert.match(grounding, /Prefer \*\*local and primary\*\* evidence/);
  assert.match(grounding, /own instructions and entry points/);
  // Bounded warm-up: it reads for shape and stops, and never dumps an inventory.
  assert.match(grounding, /Stop when another file would not change the explanation/);
  assert.match(grounding, /Never enumerate every file/);
  assert.match(grounding, /warm context, not a complete one/);
});

test('deeper levels may qualify earlier simplifications and must not repeat them (criterion 7)', () => {
  const ladder = flat(LADDER);

  assert.match(ladder, /Each rung \*\*adds depth\*\*/);
  assert.match(ladder, /may \*\*qualify or correct\*\* an earlier simplification/);
  assert.match(ladder, /No rung \*\*restates\*\*/);
  assert.match(ladder, /content-repeated/);
});

test('an ungroundable or ambiguous subject yields a bounded limit, never invention (criterion 8)', () => {
  const grounding = flat(GROUNDING);

  assert.match(grounding, /unresolvable/);
  assert.match(grounding, /say what evidence would resolve it/i);
  assert.match(grounding, /Do not manufacture a confident explanation/);
  assert.match(grounding, /single bounded clarifying question/);
  assert.match(grounding, /never a reason to fill the gap with invention/);
});

test('the read-only boundary is explicit: no edits, mutations, or publication (criterion 9)', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /Read-only\./);
  assert.match(entry, /performs no edits, mutations, or publication/);
  assert.match(entry, /Never implements or modifies the subject/);
  assert.match(entry, /never as instructions that widen this skill/);
});

test('no web or fetch grant is claimed; external subjects are labelled general-knowledge', () => {
  const entry = flat(ENTRY);
  const grounding = flat(GROUNDING);

  assert.match(entry, /No web or fetch grant/);
  assert.match(grounding, /no web or fetch grant/i);
  assert.match(grounding, /general-knowledge/);
});

test('the package carries a plain intent file starting "# Intent: eli5"', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'eli5', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: eli5\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /three times over/);
  assert.match(normalized, /does not map a domain, run a discovery loop, interrogate an idea, write a specification/);
});

test('the workflow registers all three new eli5 test files (criterion 10)', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  for (const testFile of [
    'skills/eli5/_atoms/explanation-ladder/explanation-ladder.test.mjs',
    'skills/eli5/_atoms/explanation-ladder/explanation-ladder.adversarial.test.mjs',
    'skills/eli5/eli5.conformance.test.mjs',
  ]) {
    assert.ok(workflow.includes(testFile), `workflow must register ${testFile}`);
  }
});
