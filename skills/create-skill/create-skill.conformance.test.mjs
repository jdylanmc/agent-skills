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
  assert.deepEqual(parsed.requiresSkills, [{ id: 'roast', source: 'local', required: true }]);

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
    /Direct the operator to `agents\/skill-coach\.agent\.md` for review/,
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
