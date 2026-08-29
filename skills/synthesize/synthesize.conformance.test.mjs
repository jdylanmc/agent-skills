import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const ENTRY = 'synthesize/SKILL.md';
const MOLECULE = 'synthesize/_molecules/bounded-synthesis/bounded-synthesis.md';
const PINNED_TOOLS = ['edit', 'execute', 'read'];
const ATOMS = [
  'synthesize/_atoms/source-binding/source-binding.md',
  'synthesize/_atoms/synthesis-profile/synthesis-profile.md',
  'synthesize/_atoms/disclosure-ledger/disclosure-ledger.md',
  'synthesize/_atoms/split-proposal/split-proposal.md',
  'synthesize/_atoms/synthesis-outcome/synthesis-outcome.md',
];
const read = (relative) => fs.readFileSync(path.join(SKILLS_ROOT, relative), 'utf8');
const flat = (relative) => read(relative).replace(/\s+/g, ' ');
const frontmatter = (relative) => readFrontmatter(
  fs.readFileSync(path.join(SKILLS_ROOT, relative), 'utf8'),
  relative,
);

test('synthesize is routable, pinned, and depends on no other skill', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'synthesize');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.match(parsed.description, /one identified, revision-bound source artifact/);
  assert.match(parsed.description, /one named synthesis profile/);
  assert.match(parsed.description, /spec-nano/);
  assert.match(parsed.description, /500 words/);
  for (const refusal of ['author the source specification', 'review or roast', 'approve', 'publish', 'implement', 'shepherd', 'merge']) {
    assert.match(parsed.description, new RegExp(refusal, 'i'));
  }
});

test('composition reaches chronicler, the molecule, and every atom without widening the grant', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'synthesize/_molecules/bounded-synthesis/bounded-synthesis.md',
  ]);

  const closure = closureFor(validateRepository(ROOT), ENTRY);
  assert.ok(closure.includes(MOLECULE), `${ENTRY} must reach ${MOLECULE}`);
  for (const atom of ATOMS) {
    assert.ok(closure.includes(atom), `${ENTRY} must reach ${atom}`);
  }

  const derived = deriveGraph(ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual(
    [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort(),
    [],
  );
  assert.deepEqual(derived.grantViolations, []);
});

test('the molecule composes all five atoms', () => {
  const parsed = frontmatter(MOLECULE);
  assert.equal(parsed.level, 'molecule');
  assert.deepEqual([...parsed.composes].sort(), [...ATOMS].sort());
});

test('the skill produces a candidate and never reviews, approves, publishes, implements, or merges', () => {
  const skill = flat(ENTRY);
  assert.match(skill, /candidate/);
  assert.match(skill, /does not roast, grade, or approve/i);
  assert.match(skill, /opens no change request and writes no code/i);
  assert.match(skill, /never settled authority/i);
  assert.match(skill, /remains a candidate until a human approves it/i);
});

test('the search grant is dropped and no repository-wide discovery is claimed', () => {
  const parsed = frontmatter(ENTRY);
  assert.ok(!parsed.allowedTools.includes('search'), 'search must not be granted');
  const skill = flat(ENTRY);
  assert.match(skill, /there is no repository-wide discovery/i);
  assert.match(skill, /opens only the explicitly supplied source artifact/i);
  assert.doesNotMatch(skill, /resolve the source artifact and repository context/i);
});

test('the wrapper discloses that mechanical checks do not prove preserved meaning', () => {
  const skill = flat(ENTRY);
  assert.match(skill, /do \*\*not\*\* prove that a reworded claim still means what the source meant|do not prove that a reworded claim still means what the source meant/i);
  assert.match(skill, /independent review pass/i);
});

test('the wrapper is trimmed: it does not restate the word-counting algorithm or the full field schema', () => {
  const skill = flat(ENTRY);
  // The step-by-step counting algorithm belongs to the profile unit, not here.
  assert.doesNotMatch(skill, /CRLF is normalized/i);
  assert.doesNotMatch(skill, /split on whitespace runs/i);
  // The full field schema belongs to the synthesis-profile unit.
  assert.match(skill, /own the full field schema/i);
  // The essential top-level facts and boundaries remain.
  assert.match(skill, /bounded at 500 words/);
  assert.match(skill, /Nano authority is never weakened to fit/i);
});

test('the skill never claims to invoke roast and declares no skill dependency', () => {
  const skill = flat(ENTRY);
  assert.match(skill, /invokes no other skill/i);
  assert.match(skill, /Roast is a separate downstream pass/i);
  assert.doesNotMatch(skill, /invoke[a-z]* roast/i);
  assert.doesNotMatch(skill, /Submit the exact candidate pair to .?roast/i);
});

test('the 500-word budget and its three prohibited shortcuts are stated', () => {
  const skill = flat(ENTRY);
  assert.match(skill, /bounded at 500 words/);
  assert.match(skill, /exactly 500 words is allowed/);
  assert.match(skill, /truncation/i);
  assert.match(skill, /relocating authority into the full companion/i);
  assert.match(skill, /weakening an acceptance criterion/i);
  assert.match(skill, /Nano authority is never weakened to fit/i);
});

test('needs-split and the full status vocabulary are in the output contract', () => {
  const skill = flat(ENTRY);
  for (const status of ['complete', 'needs-split', 'refused', 'stale-source', 'blocked']) {
    assert.match(skill, new RegExp(`\`${status}\``));
  }
  assert.match(skill, /proposed secondary boundaries/i);
  assert.match(skill, /disclosure ledger with its digest/i);
});

test('the workflow relationship places roast downstream and defers the /spec reinforcement', () => {
  const skill = flat(ENTRY);
  assert.match(skill, /synthesize\(spec-nano\) generates the bounded candidate/i);
  assert.match(skill, /roast performs one independent read-only specification review pass/i);
  assert.match(skill, /a human approves nano authority/i);
  assert.match(skill, /this change does not modify `?\/spec`?/i);
});

test('the package does not present itself as editing /spec', () => {
  const skill = flat(ENTRY);
  assert.doesNotMatch(skill, /edits? `?\/spec/i);
  assert.doesNotMatch(skill, /modifies `?\/spec/i);
  assert.match(skill, /does not modify `?\/spec`?/i);
});

test('intent.md exists, carries no frontmatter, and names the skill', () => {
  const intentPath = path.join(SKILLS_ROOT, 'synthesize', 'intent.md');
  assert.ok(fs.existsSync(intentPath), 'synthesize/intent.md must exist');
  const intent = fs.readFileSync(intentPath, 'utf8');
  assert.equal(readFrontmatter(intent, 'synthesize/intent.md'), null);
  assert.match(intent, /^# Intent: synthesize/);
  assert.match(intent, /disclosure ledger/i);
  assert.match(intent, /refusing beats degrading/i);
  assert.match(intent, /only a candidate/i);
});
