import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { DECLARED_FIELDS, PROFILES } from './_atoms/synthesis-profile/synthesis-profile.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const ENTRY = 'synthesize/SKILL.md';
const MOLECULE = 'synthesize/_molecules/bounded-synthesis/bounded-synthesis.md';
const PINNED_TOOLS = ['edit', 'execute', 'read'];
const ATOMS = [
  'synthesize/_atoms/candidate-persistence/candidate-persistence.md',
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
  assert.match(parsed.description, /one stated reduction contract/);
  assert.match(parsed.description, /spec-nano/);
  assert.match(parsed.description, /500 words/);
  assert.match(parsed.description, /caller-declared reduction/);
  for (const refusal of ['author the source specification', 'review or roast', 'approve', 'publish', 'implement', 'shepherd', 'merge']) {
    assert.match(parsed.description, new RegExp(refusal, 'i'));
  }
});

test('the package publishes no capability registry a consumer would have to probe', () => {
  // A machine-readable list of offered reductions was tried and removed. It made
  // every new request a registry entry, and it made consumers probe a
  // declaration and block when it was absent - failing on the shape of this
  // package's frontmatter rather than on anything about the work.
  const head = read(ENTRY).split('\n---\n')[0];
  const declared = ['name', 'description', 'allowed-tools', 'includes', 'composes',
    'disable-model-invocation', 'user-invocable', 'requires-skills'];
  for (const line of head.split('\n').slice(1)) {
    if (line.trim() === '') continue;
    const [, field] = /^([a-z-]+):/.exec(line) ?? [];
    assert.ok(field === undefined || declared.includes(field), `unexpected frontmatter field: ${line}`);
  }
  const skill = flat(ENTRY);
  assert.doesNotMatch(skill, /declares exactly the ids/i);
  // Every desired result is stated by the caller, so no vocabulary of offered
  // reductions exists here for a consumer to look one up in.
  assert.match(skill, /## Declared Reductions/);
});

test('a result the named table has never heard of is declared, not registered', () => {
  const skill = flat(ENTRY);
  assert.match(skill, /## Declared Reductions/);
  assert.match(skill, /human intent of a skill as plain requirements/i);
  assert.match(skill, /relaxes exactly one thing/i);
  assert.match(skill, /where the contract comes from/i);
  assert.match(skill, /The contract never comes from the source/i);
  assert.match(skill, /candidate text only/i);
  // The declared route must not be able to grant itself a reduction that
  // constrains nothing.
  assert.match(skill, /may not be empty/i);
  // Every term the module requires is named in the unit that owns the field list.
  const unit = read('synthesize/_atoms/synthesis-profile/synthesis-profile.md');
  for (const field of DECLARED_FIELDS) {
    assert.ok(unit.includes(`\`${field}\``), `synthesis-profile.md does not document ${field}`);
  }
});

test('the spec-nano profile is preserved exactly, and remains the only named one', () => {
  const profile = PROFILES['spec-nano'];
  assert.deepEqual(Object.keys(PROFILES), ['spec-nano']);
  assert.equal(profile.outputPattern, 'docs/agent/specs/<slug>.nano.md');
  assert.equal(profile.workspaceRoot, 'docs/agent/');
  assert.equal(profile.wordBudget, 500);
  assert.deepEqual([...profile.requiredContent], [
    'spec-identity', 'source-identity', 'source-revision', 'full-link',
    'intention', 'acceptance-criteria', 'non-goals',
  ]);
  const skill = flat(ENTRY);
  assert.match(skill, /## Specification Nano Profile/);
  assert.match(skill, /docs\/agent\/specs\/<slug>\.nano\.md/);
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

test('the molecule composes all six atoms', () => {
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

test('candidate output is staged, status-dependent, and promoted only after complete', () => {
  const skill = flat(ENTRY);
  const molecule = flat(MOLECULE);
  assert.match(skill, /status-dependent/i);
  assert.match(skill, /candidate: not-produced/i);
  assert.match(skill, /atomically promotes? a verified staged candidate only after `?complete`?/i);
  assert.match(molecule, /do not write the canonical path during rendering or validation/i);
  assert.match(molecule, /refuses every existing destination/i);
  assert.match(skill, /never reports `?complete`? unless the canonical candidate was created/i);
});

test('the workflow relationship places roast downstream and defers the /spec reinforcement', () => {
  const skill = flat(ENTRY);
  assert.match(skill, /synthesize\(spec-nano\) generates the bounded candidate/i);
  assert.match(skill, /roast performs one independent read-only specification review pass/i);
  assert.match(skill, /a human approves nano authority/i);
  assert.match(skill, /caller supplies the sibling nano\/full pair and Spec's authority rules to Roast/i);
  assert.match(skill, /independent inspection-only review of both/i);
  assert.doesNotMatch(skill, /Roast's `spec` artifact profile|nano\/full authority screen/i);
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
