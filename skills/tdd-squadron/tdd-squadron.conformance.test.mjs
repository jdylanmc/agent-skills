import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'tdd-squadron/SKILL.md';
const PINNED_TOOLS = ['execute', 'read', 'search', 'task'];

function read(relative) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relative.split('/')), 'utf8');
}

function frontmatter(relative) {
  return readFrontmatter(read(relative), relative);
}

function flat(relative) {
  return read(relative).replace(/\s+/g, ' ');
}

test('is an explicit, model-disabled, narrowly granted experiment', () => {
  const entry = frontmatter(ENTRY);
  assert.equal(entry.disableModelInvocation, true);
  assert.equal(entry.userInvocable, true);
  assert.deepEqual(entry.allowedTools, PINNED_TOOLS);
  assert.ok(!entry.allowedTools.includes('*'));
  assert.ok(!entry.allowedTools.includes('edit'));
  assert.deepEqual(entry.requiresSkills, [{ id: 'slop-sniper', source: 'local', required: true }]);
});

test('composes Chronicler, shared atomic transition, and the local TDD molecule', () => {
  const entry = frontmatter(ENTRY);
  assert.deepEqual(entry.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md',
  ]);
  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  assert.ok(closure.includes('tdd-squadron/_atoms/tdd-lifecycle/tdd-lifecycle.md'));
  assert.ok(closure.includes('tdd-squadron/_atoms/doctrine-lenses/doctrine-lenses.md'));
  assert.ok(closure.includes('_base/_atoms/atomic-transition/atomic-transition.md'));
  assert.ok(!closure.some((unit) => unit.startsWith('ship-with-squadron/')));
});

test('uses the shared atomic transition contract', () => {
  const entry = frontmatter(ENTRY);
  const source = flat(ENTRY);
  const molecule = flat('tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md');
  const adapter = read('tdd-squadron/_atoms/atomic-proposal/atomic-proposal.mjs');
  assert.match(source, /atomic-transition/);
  assert.ok(entry.includes.includes('tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md'));
  assert.ok(frontmatter('tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md').composes
    .includes('tdd-squadron/_atoms/atomic-proposal/atomic-proposal.md'));
  assert.match(adapter, /applyFleetStateTransition/);
  assert.match(adapter, /state\.strategyState/);
  assert.match(molecule, /shared compare-and-swap/);
});

test('pins TDD choreography, authority, full-text doctrine, and advisory audit boundaries', () => {
  const entry = flat(ENTRY);
  const lenses = flat('tdd-squadron/_atoms/doctrine-lenses/doctrine-lenses.md');
  const advisory = flat('tdd-squadron/_atoms/slop-sniper-advisory/slop-sniper-advisory.md');
  assert.match(entry, /two-seat reservation for two distinct people: `red` and `green`/);
  assert.match(entry, /alternate complete vertical slices, starting with Red and then Green/);
  assert.match(entry, /There is no per-slice Roast/);
  assert.match(entry, /one `roastmaster` and three distinct `roaster` agents/);
  assert.match(entry, /leaving the fifth delivery seat available/);
  assert.match(entry, /Any candidate mutation invalidates every prior Roast claim and returns the candidate to TDD/);
  assert.match(entry, /Only the configured trusted publication-agent identity may publish a review-ready change request/);
  assert.match(lenses, /complete, unabridged text/);
  assert.match(lenses, /canonical doctrine manifest and record its revision and digest/);
  assert.match(advisory, /asynchronously/);
  assert.match(advisory, /only at a later safe transition/);
});

test('derived unit fields and skill grant remain valid', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual([...required].sort(), PINNED_TOOLS);
  assert.deepEqual(derived.grantViolations, []);
});

test('intent remains inert plain-language source', () => {
  const intent = read('tdd-squadron/intent.md');
  assert.match(intent, /^# Intent: tdd-squadron$/m);
  assert.ok(!intent.startsWith('---'));
});
