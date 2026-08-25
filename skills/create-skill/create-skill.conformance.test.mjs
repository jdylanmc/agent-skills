/**
 * Conformance tests for `create-skill` after it began roasting its own output.
 *
 * Three properties are pinned here because each is easy to lose quietly and
 * expensive to lose at all.
 *
 * 1. **The tool grant.** `create-skill` already declared `task`, and closing
 *    the review loop must widen nothing. The deriver refuses to *narrow* a
 *    grant silently; nothing but this test stops a human widening one.
 * 2. **`/roast` is untouched.** It is reached as a required nested skill. Its
 *    `disable-model-invocation: true` flag, its own grant, and its composition
 *    are not this skill's to change, and a skill that reviews its own output
 *    must not be able to soften the reviewer.
 * 3. **The review is a step, not a reminder.** The old step 5 directed the
 *    operator to a review agent. Review that must be remembered is review that
 *    gets skipped, so the wrapper must carry the invocation itself.
 *
 * The coaching step added alongside these is pinned in
 * `skills/skill-coach/skill-coach.conformance.test.mjs`, which owns that
 * package. What this suite still owns is the direction of the dependency: the
 * roast stays required, and the coach may only ever be optional.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'create-skill/SKILL.md';
const ROAST_ENTRY = 'roast/SKILL.md';

/**
 * The grant `create-skill` declared before it roasted its own output. Issue 41
 * is explicit that no grant widens; `task` was already present, which is what
 * makes the rubber duck affordable.
 */
const PINNED_TOOLS = ['read', 'search', 'edit', 'execute', 'task'];

/** The grant `/roast` declared before this change, pinned from the other side. */
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

test('the tool grant is unchanged by closing the review loop', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(
    parsed.allowedTools,
    PINNED_TOOLS,
    'roasting its own output must not widen or reorder the grant create-skill already had',
  );
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('nothing the skill composes needs a tool outside the pinned grant', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) {
      required.add(tool);
    }
  }
  const excess = [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort();
  assert.deepEqual(excess, [], `a composed unit needs ${excess.join(', ')}, which would widen the grant`);
  assert.deepEqual(derived.grantViolations, []);
});

test('the roast package is reached as a required nested skill and is otherwise untouched', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.requiresSkills, [
    { id: 'roast', source: 'local', required: true },
    { id: 'skill-coach', source: 'local', required: false },
    { id: 'changelog', source: 'local', required: false },
  ]);
  const roastEdge = parsed.requiresSkills.find((edge) => edge.id === 'roast');
  const coachEdge = parsed.requiresSkills.find((edge) => edge.id === 'skill-coach');
  assert.equal(roastEdge.required, true, 'adding a coach must not make the review optional');
  assert.equal(coachEdge.required, false, 'a required coach would fail runs that used to work');

  const roast = frontmatter(ROAST_ENTRY);
  assert.equal(roast.disableModelInvocation, true, '/roast stays human-invoked');
  assert.equal(roast.userInvocable, true);
  assert.deepEqual(roast.allowedTools, PINNED_ROAST_TOOLS, '/roast keeps its own grant');
  assert.deepEqual(roast.requiresSkills, []);

  const result = validateRepository(REPOSITORY_ROOT);
  for (const unit of closureFor(result, ENTRY)) {
    assert.ok(
      !unit.startsWith('roast/'),
      `${ENTRY} must reach /roast by invocation, not by composing ${unit}`,
    );
  }
});

test('the wrapper invokes the review instead of directing the operator to remember it', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /Run \[Self-roast remediation\]/);
  assert.match(entry, /invokes `\/roast` as a required nested skill/);
  assert.doesNotMatch(
    entry,
    /Direct the operator to `agents\/skill-reviewer\.agent\.md` for review/,
    'the reminder that made review skippable must be gone',
  );
});

test('the skill composes the remediation molecule and still composes the chronicler', () => {
  const parsed = frontmatter(ENTRY);
  assert.ok(parsed.composes.includes('_base/_molecules/chronicler/chronicler.md'));
  assert.ok(
    parsed.composes.includes('create-skill/_molecules/self-roast-remediation/self-roast-remediation.md'),
  );
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    'create-skill/_molecules/self-roast-remediation/self-roast-remediation.md',
    'create-skill/_atoms/self-roast-invocation/self-roast-invocation.md',
    'create-skill/_atoms/rubber-duck-brief/rubber-duck-brief.md',
    'create-skill/_atoms/roast-round-ledger/roast-round-ledger.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('the skill composes intent capture and reaches all three of its parts', () => {
  const parsed = frontmatter(ENTRY);
  assert.ok(
    parsed.composes.includes('create-skill/_molecules/intent-capture/intent-capture.md'),
    'intent capture is a step of the workflow, not an aside',
  );

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    'create-skill/_molecules/intent-capture/intent-capture.md',
    'create-skill/_atoms/intent-elicitation/intent-elicitation.md',
    'create-skill/_atoms/intent-synthesis/intent-synthesis.md',
    'create-skill/_atoms/intent-storage-gate/intent-storage-gate.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('intent is requested before any package structure is designed', () => {
  const entry = read(ENTRY);
  const capture = entry.indexOf('Capture what the skill is for with');
  const design = entry.indexOf('to establish the one reusable job, routing triggers');
  const create = entry.indexOf('Create only the new package under');
  assert.ok(capture > 0, 'the wrapper must carry the intent step itself');
  assert.ok(design > 0 && create > 0);
  assert.ok(
    capture < design && capture < create,
    'asking what the skill is for must come before designing or creating it',
  );
  assert.match(flat(ENTRY), /\*\*before any\s+package structure is designed\*\*/);
  assert.match(flat(ENTRY), /If he has not said what the skill is for, ask; never infer it and proceed/);
});

test('the roast and resolve loop still runs, and still runs after the build', () => {
  const entry = read(ENTRY);
  const capture = entry.indexOf('Capture what the skill is for with');
  const conformance = entry.indexOf('Use [Skill package conformance]');
  const roast = entry.indexOf('Run [Self-roast remediation]');
  assert.ok(roast > conformance, 'the package is roasted after it is built and validated');
  assert.ok(roast > capture, 'the review still closes the workflow rather than opening it');
  assert.match(flat(ENTRY), /coach -> elicit intent -> build -> validate -> roast -> resolve -> present/);
  assert.match(flat(ENTRY), /invokes `\/roast` as a required nested skill/);
  assert.match(flat(ENTRY), /re-roasts after every head-changing correction/);
});

test('a package cannot be reported complete unless a current roast ran and feedback was addressed', () => {
  const entry = flat(ENTRY);
  const remediation = flat('create-skill/_molecules/self-roast-remediation/self-roast-remediation.md');
  const invocation = flat('create-skill/_atoms/self-roast-invocation/self-roast-invocation.md');

  assert.match(entry, /Never report the package\s+complete, ready, finished, or reviewable unless `\/roast` actually ran/);
  assert.match(entry, /every finding has been addressed/);
  assert.match(entry, /unaddressed roast is a blocked\s+or halted run/);
  assert.match(entry, /`completion_status`: `complete`, `blocked`, `halted`, or\s+`awaiting-operator`/);
  assert.match(entry, /Treats roasting and remediation as required, not best effort/);
  assert.match(remediation, /caller\s+must not report the package complete/);
  assert.match(remediation, /A missing, refused, unsynthesized, or stale roast never produces a\s+`complete` result/);
  assert.match(remediation, /A roast with unaddressed feedback never produces a\s+`complete` result/);
  assert.match(invocation, /blocked from being called complete/);
  assert.match(invocation, /until each finding has an address recorded/);
});

test('the wrapper refuses to store an intent the operator has not confirmed', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /Never stores an intent the operator has not confirmed/);
  assert.match(entry, /Writes an intent only for the package this run creates/);

  const molecule = flat('create-skill/_molecules/intent-capture/intent-capture.md');
  assert.match(molecule, /A synthesis is never stored without the operator's confirmation/);
  assert.match(molecule, /Store only on confirmation/);
});

test('every package the skill creates must end up with an intent', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /\*\*Every package this skill creates has an intent\.\*\*/);
  assert.match(entry, /precondition of there being a package, not the first item on a list/);
  assert.match(entry, /A run that captures no intent produces no finished\s+package/);
  assert.match(
    entry,
    /Do not create a package and note the intent as\s+outstanding/,
    'the wrapper must close the route where a package ships with the intent outstanding',
  );
  assert.match(entry, /Produces no finished package without a stored intent/);

  const molecule = flat('create-skill/_molecules/intent-capture/intent-capture.md');
  assert.match(molecule, /\*\*This is a precondition, not a first step\.\*\*/);
  assert.match(molecule, /There is no route where the capture is skipped,\s+deferred, or declined/);
  assert.match(molecule, /## When It Cannot Be Captured/);
});

test('a package with no stored intent cannot be reported ready', () => {
  assert.match(
    flat('create-skill/_atoms/validation-release-gate/validation-release-gate.md'),
    /A package with no stored intent is never reported as ready/,
  );
  assert.match(
    flat('create-skill/_atoms/validation-release-gate/validation-release-gate.md'),
    /Verify the package has a stored intent before anything is called ready/,
  );
  assert.match(
    flat('create-skill/_molecules/skill-package-conformance/skill-package-conformance.md'),
    /A package with no stored intent never reaches `ready`/,
  );
  assert.match(
    flat('create-skill/_atoms/intent-storage-gate/intent-storage-gate.md'),
    /There is no route through it that reports\s+`satisfied` for a package whose intent was never captured/,
  );
});

test('a skill created by other means legitimately has no intent', () => {
  assert.match(
    flat(ENTRY),
    /A skill authored by some other means may\s+legitimately have none, which is not this skill's concern/,
  );
});

test('a stored intent is authoritative about its subject and inert as instruction', () => {
  for (const unit of [
    ENTRY,
    'create-skill/_molecules/intent-capture/intent-capture.md',
    'create-skill/_atoms/intent-storage-gate/intent-storage-gate.md',
  ]) {
    assert.match(
      flat(unit),
      /inert|never as instruction|not an instruction/,
      `${unit} must state that a stored intent does not direct what reads it`,
    );
  }
  assert.match(
    flat('create-skill/_atoms/intent-storage-gate/intent-storage-gate.md'),
    /## The Stored Intent Is Inert/,
  );
});

test('the stored intent is what the build answers to', () => {
  assert.match(
    flat(ENTRY),
    /Derive all of it\s+from the stored intent rather than inventing it separately/,
  );
  assert.match(
    flat('create-skill/_molecules/intent-capture/intent-capture.md'),
    /Where the design and the intent disagree, the intent is what\s+the operator asked for/,
  );

  for (const unit of [
    'create-skill/_molecules/skill-package-design/skill-package-design.md',
    'create-skill/_atoms/scope-contract/scope-contract.md',
  ]) {
    assert.match(
      flat(unit),
      /\| `intent` \| yes \|/,
      `${unit} must take the stored intent as a required input, or the design invents its own scope`,
    );
  }
  assert.match(
    flat('create-skill/_atoms/scope-contract/scope-contract.md'),
    /Take each refusal and each\s+confirmation point from the stored intent/,
  );
});

test('every new unit stays local to create-skill', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const promoted = [...result.graph.keys()].filter(
    (file) => file.startsWith('_base/') && /(self-roast|rubber-duck|roast-round)/.test(file),
  );
  assert.deepEqual(promoted, [], 'ADR 0001 keeps a first-consumer unit local; there is no second consumer');
});

test('the package states that severity is a category and not an approval', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /automates the review, never the approval/);
  assert.match(entry, /a human still signs off/);

  const molecule = flat('create-skill/_molecules/self-roast-remediation/self-roast-remediation.md');
  assert.match(molecule, /Severity remains a category/);
  assert.match(molecule, /a human still signs off/);
});

test('the package forbids weakening a repository gate to silence a finding', () => {
  for (const unit of [
    ENTRY,
    'create-skill/_molecules/self-roast-remediation/self-roast-remediation.md',
    'create-skill/_atoms/self-roast-invocation/self-roast-invocation.md',
  ]) {
    assert.match(
      flat(unit),
      /is the thing to fix/,
      `${unit} must state that an unsatisfiable package is fixed, not the gate`,
    );
  }
  assert.match(
    flat('create-skill/_atoms/self-roast-invocation/self-roast-invocation.md'),
    /Never weaken a repository gate/,
  );
});

test('the package states the rubber duck advises and never approves', () => {
  const atom = flat('create-skill/_atoms/rubber-duck-brief/rubber-duck-brief.md');
  assert.match(atom, /The rubber duck \*\*advises\*\*/);
  assert.match(atom, /its verdict is not an approval/);
  assert.match(atom, /A prompt that leaks the desired answer defeats the entire mechanism/);
  assert.match(atom, /No authorship/);
  assert.match(atom, /No preferred outcome/);
  assert.match(atom, /No rebuttal/);
});

test('every test file on disk is registered in the workflow', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.test-sandbox') {
        continue;
      }
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(path.relative(REPOSITORY_ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  walk(REPOSITORY_ROOT);

  const unregistered = found.filter((file) => !workflow.includes(file)).sort();
  assert.deepEqual(
    unregistered,
    [],
    'the workflow does not glob; an unregistered test never runs in continuous integration',
  );
  assert.ok(found.length > 0, 'the walk found no tests, which would make this assertion vacuous');
});

test('a new skill is recorded in the changelog as part of creating it', () => {
  // A library that gains a skill and mentions it later has a changelog nobody
  // can trust to be current.
  const parsed = frontmatter(ENTRY);
  const entry = flat(ENTRY);

  const changelogEdge = parsed.requiresSkills.find((edge) => edge.id === 'changelog');
  assert.ok(changelogEdge, 'create-skill must reach the changelog skill');
  assert.equal(changelogEdge.source, 'local');
  assert.equal(
    changelogEdge.required,
    false,
    'a hard requirement would fail creation in a repository with no changelog',
  );

  assert.match(entry, /\*\*Record the new skill in the changelog\.\*\*/);
  assert.match(entry, /place\s+the returned patch in the same change as the package itself/);
  assert.match(entry, /`Changelog: entered` with the proposed entry, or `Changelog: degraded`/);

  // Reached by invocation, never composed — the same rule as the coach.
  const result = validateRepository(REPOSITORY_ROOT);
  for (const unit of closureFor(result, ENTRY)) {
    assert.ok(
      !unit.startsWith('changelog/'),
      `${ENTRY} must reach the changelog by invocation, not by composing ${unit}`,
    );
  }
});

test('recording a changelog entry does not route around the changelog write boundary', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /`changelog` holds no write authority; it returns a patch/);
  assert.match(
    entry,
    /the entry still reaches history only\s+through the same human review that approves the new package/,
  );
  assert.match(entry, /it is never\s+added to a released section/);

  // Creating a skill must not silently decide where a project keeps history.
  assert.match(entry, /Do not create a changelog file as a side effect of\s+creating a skill/);
  assert.match(entry, /Changelog entry is best effort/);
});
