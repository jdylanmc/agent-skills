/**
 * Conformance tests for the ship package, stage one.
 *
 * Ship is an orchestration that will later gain real authority, so the
 * properties pinned here are the ones whose loss would be invisible in prose:
 *
 * 1. **It does not yet hold authority it does not yet use.** Stage one builds
 *    nothing and dispatches nobody, so it grants neither `edit` nor `task`. A
 *    later stage widening that grant should be a deliberate, reviewed edit —
 *    not something that arrives by composing a new unit.
 * 2. **Scope creep is refused structurally.** This is the documented failure
 *    mode of every delivery run in this repository so far, and "be careful" is
 *    not a control.
 * 3. **It never merges and never grades its own work.** Validation and review
 *    stay with `run-ci`, `roast`, and `shepherd`.
 * 4. **The shepherd question is asked first.** Asked last, it stops being a
 *    decision and becomes an assumption.
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
const ENTRY = 'ship/SKILL.md';
const MOLECULE = 'ship/_molecules/delivery-grounding/delivery-grounding.md';
const GROUNDING = 'ship/_atoms/issue-grounding/issue-grounding.md';
const LAZINESS = 'ship/_atoms/laziness-lens/laziness-lens.md';
const SCOPE = 'ship/_atoms/scope-boundary/scope-boundary.md';

/** The grant stage one was reviewed with. Nothing here may widen it. */
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

test('ship is a routable single-issue delivery skill', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'ship');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
});

test('the routing description scopes to grounding and does not promise delivery', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /Ground one tracker issue into a confirmed delivery plan/);
  assert.match(description, /Implementation, validation, review, and handover are not yet available/);
  assert.match(description, /Do not use to work a whole backlog or fleet/);
  assert.match(description, /ship-with-squadron/);
  assert.match(description, /do not use to implement, merge, approve, or accept risk/);

  // A stage that builds nothing must not advertise that it takes an issue to
  // done; routing metadata is read before any in-body staging disclaimer.
  assert.doesNotMatch(description, /Take one tracker issue to done/);
});

test('stage one holds no authority it does not yet use', () => {
  const parsed = frontmatter(ENTRY);

  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'), 'stage one builds nothing, so it grants no edit');
  assert.ok(!parsed.allowedTools.includes('task'), 'stage one dispatches nobody, so it grants no task');
  assert.ok(!parsed.allowedTools.includes('*'));

  const entry = flat(ENTRY);
  assert.match(entry, /no `edit` grant and no `task` grant/);
  assert.match(
    entry,
    /a permission is never\s+acquired as a side effect of composing something new/,
  );

  const result = validateRepository(REPOSITORY_ROOT);
  for (const unit of closureFor(result, ENTRY)) {
    const tools = readFrontmatter(read(unit), unit).allowedTools ?? [];
    assert.ok(!tools.includes('edit') && !tools.includes('*'), `${unit} reaches write authority`);
  }
});

test('the execute-bearing closure is pinned, because execute can mutate', () => {
  // `execute` runs arbitrary commands, so "no edit grant" is not proof that
  // nothing is written. The honest control is holding the set of units that
  // carry execute fixed, so a new one is a reviewable change rather than a
  // detail. This is the assertion that would catch a later stage acquiring
  // mutation quietly.
  const result = validateRepository(REPOSITORY_ROOT);
  const executeBearing = closureFor(result, ENTRY)
    .filter((unit) => (readFrontmatter(read(unit), unit).allowedTools ?? []).includes('execute'))
    .sort();

  assert.deepEqual(executeBearing, [
    '_base/_atoms/chronicle-append/chronicle-append.md',
    '_base/_atoms/chronicle-replay/chronicle-replay.md',
    '_base/_molecules/chronicler/chronicler.md',
    'ship/SKILL.md',
    'ship/_atoms/issue-grounding/issue-grounding.md',
    'ship/_molecules/delivery-grounding/delivery-grounding.md',
  ]);

  assert.match(
    flat(ENTRY),
    /`execute` is not a read-only capability, and the absence of `edit` is not\s+proof that nothing is written/,
  );
});

test('nothing in the closure widens the pinned grant', () => {
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

test('the skill composes chronicler and the local grounding units', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    MOLECULE,
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of ['_base/_molecules/chronicler/chronicler.md', MOLECULE, GROUNDING, LAZINESS, SCOPE]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('the shepherd question has exactly one owner and is asked before grounding', () => {
  const entry = read(ENTRY);
  const molecule = read(MOLECULE);
  const grounding = read(GROUNDING);

  const askIndex = entry.indexOf('Ask whether to shepherd on completion');
  const groundIndex = entry.indexOf('Run [Delivery grounding]');
  assert.ok(askIndex > 0 && groundIndex > 0);
  assert.ok(askIndex < groundIndex, 'the shepherd question precedes grounding');
  assert.match(flat(ENTRY), /This skill is the only place\s+the question is asked/);

  // Structural: only the root may ask. A second asker could return a second
  // answer, and nothing defines which one wins.
  assert.match(flat(MOLECULE), /Do not ask\s+again\. The question has one owner/);
  assert.match(flat(MOLECULE), /The shepherd question is not asked here; it arrives already answered/);
  assert.match(flat(GROUNDING), /This atom records it and never\s+re-asks/);

  for (const [label, body] of [['molecule', molecule], ['grounding atom', grounding]]) {
    assert.ok(
      !/\bAsk whether\b/.test(body),
      `the ${label} must not ask the shepherd question itself`,
    );
  }
});

test('a packet is grounded only when the operator confirmed it', () => {
  const entry = flat(ENTRY);
  const molecule = flat(MOLECULE);

  for (const state of ['confirmed', 'corrected', 'not-aligned']) {
    assert.match(molecule, new RegExp(`\`${state}\``), `the alignment gate must define ${state}`);
  }
  assert.match(molecule, /A packet is `grounded` \*\*only\*\* when alignment is `confirmed`/);
  assert.match(molecule, /Otherwise the\s+run returns `needs-alignment` and stops/);
  assert.match(molecule, /No packet is `grounded` without explicit operator confirmation/);

  assert.match(entry, /A packet is `grounded` \*\*only\*\* when the operator explicitly confirmed/);
  assert.match(
    entry,
    /Silence, a status question, an unrelated reply, or a caller asserting that\s+someone already agreed are none of them confirmation/,
  );
  assert.match(entry, /an unconfirmed\s+packet must never become fixed scope/);

  // `needs-alignment` must be reachable as a terminal status, not just prose.
  assert.match(entry, /`status`: `grounded`, `needs-alignment`/);
});

test('the laziness lens cannot be used to route around the scope boundary', () => {
  const laziness = flat(LAZINESS);

  assert.match(laziness, /Leaks, and Whose They Are/);
  assert.match(
    laziness,
    /A leak counts here only when the \*\*planned change introduces it\*\*/,
  );
  assert.match(laziness, /A leak that already existed is \*\*adjacent\*\*/);
  assert.match(laziness, /it does not count against the laziness verdict/);
  assert.match(laziness, /Where this lens and the scope boundary appear\s+to disagree, the scope boundary wins/);

  // The original wording made leaving any known rough edge a failing answer,
  // which directly contradicted the scope boundary.
  assert.doesNotMatch(laziness, /A known rough edge is left because it is not strictly in scope/);
});

test('an enabling change must be justified rather than asserted', () => {
  const scope = flat(SCOPE);

  assert.match(scope, /`enabling` is the class that leaks, because necessity is easy to assert/);
  assert.match(scope, /evidence the criterion is \*\*impossible\*\* without it/);
  assert.match(scope, /the in-scope alternatives considered, and why each fails/);
  assert.match(scope, /the smallest bounded version of the change/);
  assert.match(scope, /explicit operator confirmation/);
  assert.match(scope, /Without all five it is `adjacent`/);
});

test('the change ledger is exhaustive so a later stage can match every diff unit', () => {
  const scope = flat(SCOPE);
  const entry = flat(ENTRY);

  assert.match(scope, /Classification is exhaustive, not sampled/);
  assert.match(scope, /a stable identifier, so a later stage can map each unit of the eventual\s+diff back to exactly one confirmed `in-scope` or `enabling` entry/);
  assert.match(scope, /A change appearing in the diff with no matching ledger entry is an\s+undisclosed\s+change, and it stops the run/);
  assert.match(entry, /every planned change with a stable identifier\s+and classification/);
});

test('a dependency blocks when it prevents landing, not only when it changes requirements', () => {
  const grounding = flat(GROUNDING);
  const entry = flat(ENTRY);

  assert.match(grounding, /prevents safely\s+implementing, validating, integrating, or landing this issue/);
  assert.match(grounding, /an unavailable upstream interface, an unmerged prerequisite change/);
  for (const cls of ['blocking', 'changes-requirements', 'informational']) {
    assert.match(grounding, new RegExp(`\`${cls}\``), `dependency classes must include ${cls}`);
    assert.match(entry, new RegExp(`\`${cls}\``), `the output contract must surface ${cls}`);
  }
});

test('a blocked issue stops the run and names the blocker', () => {
  const grounding = flat(GROUNDING);
  const entry = flat(ENTRY);

  assert.match(grounding, /`blocked` \| A dependency prevents starting\. Name the blocker and why it blocks\. \|/);
  assert.match(grounding, /A blocked issue stops the run/);
  assert.match(entry, /refuses a blocked issue and names the blocker/);
  assert.match(entry, /with any blocker named and why it blocks/);
});

test('acceptance criteria are the definition of done and are numbered', () => {
  const grounding = flat(GROUNDING);
  const entry = flat(ENTRY);

  assert.match(grounding, /Extract the acceptance criteria as a numbered list/);
  assert.match(grounding, /ask for them rather than inferring a definition\s+of done from the title/);
  assert.match(entry, /definition of done as numbered acceptance criteria/);
});

test('adjacent findings are reported and never acted on', () => {
  const scope = flat(SCOPE);
  const entry = flat(ENTRY);

  for (const cls of ['in-scope', 'enabling', 'adjacent', 'out-of-scope', 'blocking-defect']) {
    assert.match(scope, new RegExp(`\`${cls}\``), `the classification must cover ${cls}`);
  }
  assert.match(scope, /`adjacent` \| A real improvement the issue did not ask for\. \| Report it\. Do not do it\. \|/);
  assert.match(scope, /The tempting case is a one-line fix in a file already being edited/);
  assert.match(scope, /It is still adjacent/);
  assert.match(entry, /Adjacent findings are reported and never\s+acted on, including a one-line fix in a file already being edited/);
});

test('stage one composes no implementation, validation, or review owner', () => {
  // If a later stage absorbs run-ci's or roast's job instead of composing it,
  // the "does not grade its own work" boundary becomes prose only.
  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  const foreign = closure.filter(
    (unit) => !unit.startsWith('ship/') && !unit.startsWith('_base/'),
  );
  assert.deepEqual(foreign, [], `stage one must not reach another skill's units: ${foreign.join(', ')}`);

  assert.deepEqual(frontmatter(ENTRY).requiresSkills, [], 'stage one invokes nothing yet');
});

test('the laziness lens is applied before implementation and names concrete reductions', () => {
  const laziness = flat(LAZINESS);
  const molecule = flat(MOLECULE);

  assert.match(laziness, /Borrow the fatigue of whoever maintains this next/);
  for (const verdict of ['lean', 'trim', 'over-engineered', 'under-specified']) {
    assert.match(laziness, new RegExp(`\`${verdict}\``), `the lens must define ${verdict}`);
  }
  assert.match(laziness, /"Simplify this" is not actionable/);
  assert.match(laziness, /It is not an argument against structure/);
  assert.match(
    molecule,
    /reductions are cheap now and\s+expensive after code exists/,
  );
});

test('ship never merges and does not grade its own work', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /\*\*Never merges, approves, or accepts risk\.\*\*/);
  assert.match(entry, /Merge authority belongs to a\s+person/);
  assert.match(entry, /\*\*Does not grade its own work\.\*\*/);
  assert.match(entry, /Validation is `run-ci`'s job and adversarial\s+review is `roast`'s/);
  assert.match(entry, /a workflow that both writes the change and\s+judges the change is grading its own work/i);
});

test('stage one builds nothing', () => {
  const entry = flat(ENTRY);
  const molecule = flat(MOLECULE);

  assert.match(entry, /This stage grounds; it does not build/);
  assert.match(entry, /Nothing has been branched,\s+edited, or committed/);
  assert.match(molecule, /No branch, no edit, no commit, no tracker mutation/);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'ship', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: ship\s*$/m);
  assert.ok(!intent.startsWith('---'), 'an intent carries no frontmatter');

  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /Taking one issue to done/);
  assert.match(normalized, /grading its own work/);
  assert.match(normalized, /success at the wrong\s*thing/);
  assert.match(normalized, /Merge authority stays with a person/);
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
  walk(path.join(SKILLS_ROOT, 'ship'));

  assert.ok(found.length >= 1, 'the walk found no suites, which would make this assertion vacuous');
  const unregistered = found.filter((file) => !workflow.includes(file)).sort();
  assert.deepEqual(unregistered, [], `never run in continuous integration: ${unregistered.join(', ')}`);
});
