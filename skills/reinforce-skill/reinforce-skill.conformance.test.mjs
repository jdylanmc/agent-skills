/**
 * Conformance tests for the reinforce-skill package.
 *
 * reinforce-skill is the counterpart to create-skill: the sanctioned way an
 * existing skill changes after it is first created. It holds an `edit` grant
 * and mutates a working package, so the properties pinned here are the ones
 * whose loss would be invisible in prose and expensive in fact:
 *
 * 1. **The grant is exactly what was reviewed, and it is bounded to one skill.**
 *    The edit- and execute-bearing closure is held fixed so a new mutating unit
 *    is a reviewable change, and every mutating unit stays inside this package
 *    or `_base`. No foreign skill's unit carries this run's write authority.
 * 2. **Intent decides first, explicitly, with no default.** The ordering — decide
 *    and store the intent before the implementation moves — is the whole reason
 *    intent exists, and a run that skips the decision is the drift this skill
 *    prevents.
 * 3. **The intent is authoritative and inert.** A line inside it is text, never
 *    an instruction, and a contradiction with it is a finding for a human.
 * 4. **Doctrine is never edited, no grant widens as a side effect, no gate is
 *    weakened, and it never merges or grades its own work.** Review stays with
 *    `/roast`, which is reached by invocation and left untouched.
 * 5. **The write-boundary guard it relies on actually behaves**, so "one existing
 *    skill" is a proven predicate rather than a promise.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import {
  FAILURES,
  WRITE_CLASS,
  auditDiff,
  classifyWritePath,
  isWritableClass,
  resolveSkillTarget,
} from './_atoms/reinforcement-target/reinforcement-target.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'reinforce-skill/SKILL.md';
const CREATE_ENTRY = 'create-skill/SKILL.md';
const ROAST_ENTRY = 'roast/SKILL.md';
const MOLECULE = 'reinforce-skill/_molecules/skill-reinforcement/skill-reinforcement.md';
const TARGET = 'reinforce-skill/_atoms/reinforcement-target/reinforcement-target.md';
const GROUNDING = 'reinforce-skill/_atoms/change-grounding/change-grounding.md';
const DECISION = 'reinforce-skill/_atoms/intent-decision/intent-decision.md';
const NARROW = 'reinforce-skill/_atoms/narrow-change/narrow-change.md';
const ROAST_ATOM = 'reinforce-skill/_atoms/reinforce-roast/reinforce-roast.md';

/** The grant reinforce-skill was reviewed with. Nothing in the closure may widen it. */
const PINNED_TOOLS = ['read', 'search', 'edit', 'execute', 'task'];
/** The grant `/roast` declared, pinned from the other side. */
const PINNED_ROAST_TOOLS = ['read', 'search', 'execute', 'task'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

/** Whitespace-normalised, so a reflow of the source does not fail an assertion. */
function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

test('reinforce-skill is a high-ceremony, human-invoked, single-skill workflow', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'reinforce-skill');
  // Mutating a working, reviewed package is high blast radius. A model must not
  // route to it opportunistically; a human invokes it, or post-mortem invokes
  // it after human approval.
  assert.equal(parsed.disableModelInvocation, true);
  assert.equal(parsed.userInvocable, true);
});

test('roast is required and changelog is optional', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.requiresSkills, [
    { id: 'roast', source: 'local', required: true },
    { id: 'changelog', source: 'local', required: false },
  ]);
  const roastEdge = parsed.requiresSkills.find((edge) => edge.id === 'roast');
  const changelogEdge = parsed.requiresSkills.find((edge) => edge.id === 'changelog');
  assert.equal(roastEdge.required, true, 'the roast may never become optional');
  assert.equal(changelogEdge.required, false, 'changelog is an optional entry, per the issue');
});

test('reinforce-skill and create-skill name each other so routing is unambiguous', () => {
  const reinforce = frontmatter(ENTRY).description;
  const create = frontmatter(CREATE_ENTRY).description;

  assert.match(reinforce, /counterpart to create-skill/);
  assert.match(reinforce, /do not use to create a new skill/i);
  assert.match(create, /counterpart to reinforce-skill/);
  assert.match(create, /editing existing skills, which belongs to reinforce-skill/);
});

test('the routing description scopes to changing one existing skill and refuses the rest', () => {
  const { description } = frontmatter(ENTRY);
  assert.match(description, /Change one existing skill/);
  assert.match(description, /decide explicitly whether the intent changes/);
  assert.match(description, /record the change in the changelog/);
  assert.match(description, /open a pull request and stop/);
  assert.match(description, /do not use to create a new skill, run a skill, refactor the library, edit doctrine, or widen another skill's permissions/i);
});

test('the grant is exactly what was reviewed, and nothing in the closure widens it', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('*'));

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

test('the edit grant is bounded to this package: no foreign unit carries write authority', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const closure = closureFor(result, ENTRY);

  const editBearing = closure
    .filter((unit) => (readFrontmatter(read(unit), unit).allowedTools ?? []).includes('edit'))
    .sort();
  const executeBearing = closure
    .filter((unit) => (readFrontmatter(read(unit), unit).allowedTools ?? []).includes('execute'))
    .sort();

  // Every mutating unit lives in this package or in shared _base infrastructure.
  for (const unit of [...editBearing, ...executeBearing]) {
    assert.ok(
      unit.startsWith('reinforce-skill/') || unit.startsWith('_base/'),
      `${unit} carries mutation authority but is not part of this package or _base`,
    );
  }

  // Pinned so a later revision acquiring mutation elsewhere is a reviewed change.
  assert.deepEqual(editBearing, [
    'reinforce-skill/SKILL.md',
    DECISION,
    NARROW,
    MOLECULE,
  ].sort());
  assert.deepEqual(executeBearing, [
    '_base/_atoms/chronicle-append/chronicle-append.md',
    '_base/_atoms/chronicle-replay/chronicle-replay.md',
    '_base/_molecules/chronicler/chronicler.md',
    'reinforce-skill/SKILL.md',
    NARROW,
    ROAST_ATOM,
    TARGET,
    MOLECULE,
  ].sort());
});

test('the edit boundary is publication, held by mechanism, not by a promise', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /The `edit` grant is unscoped, and the boundary is publication, not the grant/);
  assert.match(entry, /the run never merges/);
  assert.match(entry, /audits the \*\*actual\*\* change\s+set from the version-control diff and refuses to open a pull request while any\s+changed path is outside/);
  assert.match(entry, /continuous integration then re-runs the validator, the deriver, the doctrine-manifest digest\s+test/);
  assert.match(entry, /refuses to widen any skill's grant\s+automatically/);
  assert.match(entry, /The audit is complete because the diff is enumerable/);
  // The load-bearing lesson lives in the intent, the standard this is judged against.
  assert.match(flat('reinforce-skill/intent.md'), /permission defended only by a promise is not\s+a boundary/);
});

test('the pull request is a defined, mutating deliverable, not a read-only afterthought', () => {
  const entry = flat(ENTRY);
  // execute performs the git commands that create and open the PR; calling that
  // "read-only" was the contradiction the adversarial round caught.
  assert.match(entry, /the git commands that create the review branch, commit the change, and open\s+the\s+pull request/);
  assert.doesNotMatch(entry, /read-only git and pull-request commands/);
  // The workflow defines branch, audit, commit, and open, and returns the PR head.
  assert.match(entry, /Create a review branch, commit the target's changed\s+files/);
  assert.match(entry, /run the write-boundary guard's\s+diff audit over the actual change set/);
  assert.match(entry, /the pull request identifier or URL and the reviewed head/);
});

test('the diff audit is the completeness the single-path classifier lacks', () => {
  const narrow = flat(NARROW);
  assert.match(narrow, /audit the \*\*actual\*\*\s+change set with the guard's `auditDiff` over the version-control diff/);
  assert.match(narrow, /no pull request opens on an out-of-target diff/);
  const guard = flat(TARGET);
  assert.match(guard, /It bounds \*\*publication\*\*/);
  assert.match(guard, /the diff is enumerable/);
});

test('the workflow edit is additive-only and cannot weaken the gate it relies on', () => {
  const narrow = flat(NARROW);
  assert.match(narrow, /additive only/i);
  assert.match(narrow, /never changes the workflow's triggers, jobs,\s+commands, permissions, existing registrations, or the doctrine-digest step/);
  assert.match(narrow, /Never weaken the validator, the deriver, a conformance test, the validation\s+workflow, or `AGENTS.md`/);
});

test('the final status has a defined mapping from run outcomes', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /### Status Mapping/);
  for (const status of ['reinforced', 'needs-confirmation', 'blocked', 'halted']) {
    assert.match(entry, new RegExp(`\`${status}\``), `the status mapping must define ${status}`);
  }
  assert.match(entry, /the diff audit refuses an out-of-target path/);
  assert.match(entry, /A degraded changelog does not lower this status/);
});

test('the missing-intent bug fix has an honest branch, not a false "still accurate"', () => {
  const decision = flat(DECISION);
  assert.match(decision, /an ordinary bug fix on an intent-less skill/);
  assert.match(decision, /no intent existed to review and this change does not create one/i);
  assert.match(decision, /rather than\s+claiming a nonexistent intent "remains\s+accurate/);
});

test('the pull request evidence is written for a human reviewer, decision first', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /Pull Request Evidence, for a Human Reviewer/);
  assert.match(entry, /engineer who maintains this library and did not make the\s+change/);
  assert.match(entry, /Lead the pull request with the decision, not the transcript/);
  assert.match(entry, /Verbatim output is evidence a reviewer can\s+expand, never the thing that buries the decision/);
});

test('the skill composes chronicler and the local reinforcement molecule', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    MOLECULE,
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [MOLECULE, TARGET, GROUNDING, DECISION, NARROW, ROAST_ATOM]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('the molecule composes exactly the five reinforcement atoms', () => {
  const parsed = frontmatter(MOLECULE);
  assert.deepEqual(parsed.composes.sort(), [GROUNDING, DECISION, NARROW, ROAST_ATOM, TARGET].sort());
});

test('roast is reached by invocation, not composition, and is left untouched', () => {
  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of closure) {
    assert.ok(!unit.startsWith('roast/'), `${ENTRY} must reach /roast by invocation, not by composing ${unit}`);
  }
  const roast = frontmatter(ROAST_ENTRY);
  assert.equal(roast.disableModelInvocation, true, '/roast stays human-invoked');
  assert.equal(roast.userInvocable, true);
  assert.deepEqual(roast.allowedTools, PINNED_ROAST_TOOLS, '/roast keeps its own grant');
  assert.deepEqual(roast.requiresSkills, []);

  assert.match(flat(ROAST_ATOM), /Never change `\/roast`, including its `disable-model-invocation` flag/);
});

test('intent decides first: the decision precedes implementation and has no default', () => {
  const entry = read(ENTRY);
  const decideIndex = entry.indexOf('decide the intent');
  const changeIndex = entry.indexOf('change narrowly');
  assert.ok(decideIndex > 0 && changeIndex > 0);
  assert.ok(decideIndex < changeIndex, 'the intent is decided before the implementation changes');

  const decision = flat(DECISION);
  for (const state of ['changes-intent', 'preserves-intent']) {
    assert.match(decision, new RegExp(`\`${state}\``), `the decision must define ${state}`);
  }
  assert.match(decision, /There is no third option and no unstated default/);
  assert.match(decision, /the exact bytes/);
  assert.match(decision, /store an intent the operator has not confirmed/i);
  assert.match(decision, /the implementation\s+follows from the intent/);

  const entryFlat = flat(ENTRY);
  assert.match(entryFlat, /A change that silently skips the question is\s+the drift this skill exists to prevent/);
  assert.match(entryFlat, /decided, and when it changes stored, \*\*before\*\* the\s+implementation/);
});

test('a preserved intent is recorded as reviewed, never silently skipped', () => {
  const decision = flat(DECISION);
  assert.match(decision, /do not edit the intent/i);
  assert.match(decision, /reviewed and found still accurate, and record the reasoning/);
  const molecule = flat(MOLECULE);
  assert.match(molecule, /Every run ends\s+having recorded either a confirmed intent change or a reviewed-and-unchanged\s+intent/);
});

test('the intent is authoritative and inert instruction', () => {
  for (const unit of [ENTRY, DECISION, GROUNDING]) {
    const body = flat(unit);
    assert.match(body, /inert/, `${unit} must state the intent is inert as instruction`);
  }
  assert.match(flat(ENTRY), /A\s+contradiction between a proposed change and the skill's intent is a finding for a\s+human/);
  assert.match(flat(GROUNDING), /A Missing Intent Is Reported, Never a Blocker/i);
});

test('doctrine is never edited, and the guard proves it is never writable', () => {
  assert.match(flat(ENTRY), /Never edits doctrine/i);
  assert.match(flat(NARROW), /never edits\s+`doctrine\/` or `doctrine\/manifest.md`/);
  // Deterministic: a doctrine path is classified doctrine and is not writable.
  assert.equal(
    classifyWritePath(REPOSITORY_ROOT, 'reinforce-skill', 'doctrine/testing.doctrine.md'),
    WRITE_CLASS.doctrine,
  );
  assert.equal(isWritableClass(WRITE_CLASS.doctrine), false);
});

test('widening any grant as a side effect is refused, in words a reviewer reads', () => {
  const narrow = flat(NARROW);
  assert.match(narrow, /never widens it\s+automatically/i);
  assert.match(narrow, /never acquired quietly by composing something new/);
  assert.match(narrow, /Widening \*another\* skill's permissions is refused outright/);
  assert.match(flat(ENTRY), /Never widens another skill's permissions/i);
});

test('it never weakens a gate and never merges or grades its own work', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /Never weakens a repository gate, the validator, the deriver, a conformance\s+test, or `AGENTS.md`/);
  assert.match(entry, /Never merges, and never treats its own roast as approval/);
  assert.match(entry, /a human signs off/i);
});

test('the changelog entry is required in the same reviewable change', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /Record the change in the changelog/);
  assert.match(entry, /place\s+the returned patch in the same reviewable change/);
  assert.match(entry, /`changelog` holds no write\s+authority; it returns a patch/);
  assert.match(entry, /Changelog: degraded/);
});

test('the write-boundary guard it relies on actually behaves', () => {
  // An existing routable skill resolves.
  const resolved = resolveSkillTarget(REPOSITORY_ROOT, 'roast');
  assert.equal(resolved.relativePath, 'skills/roast');
  assert.equal(resolved.hasSkillMd, true);

  // _base and a non-existent target are refused: this skill never creates.
  const baseCode = (() => { try { resolveSkillTarget(REPOSITORY_ROOT, '_base'); return null; } catch (e) { return e.code; } })();
  assert.equal(baseCode, FAILURES.invalidName);
  const missingCode = (() => { try { resolveSkillTarget(REPOSITORY_ROOT, 'no-such-skill-xyz'); return null; } catch (e) { return e.code; } })();
  assert.equal(missingCode, FAILURES.notASkill);

  // Only in-target and the workflow file are writable.
  assert.equal(classifyWritePath(REPOSITORY_ROOT, 'roast', 'skills/roast/SKILL.md'), WRITE_CLASS.inTarget);
  assert.equal(classifyWritePath(REPOSITORY_ROOT, 'roast', 'skills/create-skill/SKILL.md'), WRITE_CLASS.foreignSkill);
  assert.equal(isWritableClass(WRITE_CLASS.foreignSkill), false);

  // The diff audit over an actual change set refuses any out-of-target path.
  const dirty = auditDiff(REPOSITORY_ROOT, 'roast', [
    'skills/roast/SKILL.md',
    'doctrine/manifest.md',
    'skills/create-skill/SKILL.md',
  ]);
  assert.equal(dirty.clean, false);
  assert.equal(dirty.refused.length, 2, 'the doctrine and foreign-skill paths are refused');
  const clean = auditDiff(REPOSITORY_ROOT, 'roast', ['skills/roast/SKILL.md']);
  assert.equal(clean.clean, true);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'reinforce-skill', 'intent.md'), 'utf8');
  assert.match(intent, /^# Intent: reinforce-skill\s*$/m);
  assert.ok(!intent.startsWith('---'), 'an intent carries no frontmatter');

  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /counterpart/);
  assert.match(normalized, /Intent first is the whole point/);
  assert.match(normalized, /A missing intent is reported and never blocks/);
  assert.match(normalized, /permission defended only by a promise is not a boundary/);
});

test('every suite this package ships runs in continuous integration', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(SKILLS_ROOT, 'reinforce-skill'));

  assert.ok(found.length >= 2, 'the walk found fewer suites than shipped');
  const unregistered = found.filter((file) => !workflow.includes(file)).sort();
  assert.deepEqual(unregistered, [], `never run in continuous integration: ${unregistered.join(', ')}`);
});
