import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'discovery/SKILL.md';
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

test('discovery is user-invocable with a narrow pinned grant', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'discovery');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description merges discovery-loop while excluding neighbors', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /Use when/);
  assert.match(description, /discovery loop/);
  assert.match(description, /maintain discovery state/);
  assert.match(description, /Do not use/);
  assert.match(description, /interrogate/);
  assert.match(description, /map a domain/);
  assert.match(description, /write a spec/);
});

test('the skill composes chronicler, the read-only loop, and the mutation gate', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'discovery/_molecules/discovery-loop/discovery-loop.md',
    'discovery/_atoms/tracker-update-gate/tracker-update-gate.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'discovery/_molecules/discovery-loop/discovery-loop.md',
    'discovery/_atoms/evidence-reconcile/evidence-reconcile.md',
    'discovery/_atoms/frontier-ledger/frontier-ledger.md',
    'discovery/_atoms/tracker-update-gate/tracker-update-gate.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
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

test('tracker mutation is isolated to exactly one approval-gated unit', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const closure = closureFor(result, ENTRY);
  const mutationUnits = closure.filter((unit) => /tracker-update-gate/.test(unit));

  assert.deepEqual(mutationUnits, ['discovery/_atoms/tracker-update-gate/tracker-update-gate.md']);

  const gate = flat('discovery/_atoms/tracker-update-gate/tracker-update-gate.md');
  assert.match(gate, /explicit operator approval/);
  assert.match(gate, /exact target and update/);

  const loop = flat('discovery/_molecules/discovery-loop/discovery-loop.md');
  assert.match(loop, /Read-only body/);
  assert.match(loop, /cannot perform one/);
});

test('discovery explicitly refuses neighboring jobs', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /Not interrogate\./);
  assert.match(entry, /Not domain mapping\./);
  assert.match(entry, /Not specification\./);
  assert.match(entry, /Not ticketing or implementation\./);
});

test('the discovery packet separates evidence, decisions, questions, and frontier state', () => {
  const entry = flat(ENTRY);
  const evidence = flat('discovery/_atoms/evidence-reconcile/evidence-reconcile.md');
  const frontier = flat('discovery/_atoms/frontier-ledger/frontier-ledger.md');

  assert.match(entry, /confirmed facts with source references/);
  assert.match(entry, /decisions made during the loop/);
  assert.match(entry, /open questions/);
  assert.match(entry, /frontier classification/);
  assert.match(evidence, /Preserve source claims as claims before turning any of them into facts/);
  assert.match(frontier, /Keep confirmed facts separate from assumptions/);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'discovery', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: discovery\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /evidence-preserving loop/);
  assert.match(normalized, /must not absorb interrogation, domain mapping, specification, ticketing, or implementation/);
});

test('the workflow registers the discovery conformance suite explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/discovery\/discovery\.conformance\.test\.mjs/);
});
