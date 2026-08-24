import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'interrogate/SKILL.md';
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

test('interrogate is a user-invocable read-only questioning skill', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'interrogate');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description includes positive and negative triggers', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /Use when/);
  assert.match(description, /grill/);
  assert.match(description, /Do not use/);
  assert.match(description, /domain map/);
  assert.match(description, /spec/);
  assert.match(description, /trackers/);
});

test('the skill composes chronicler and only local interrogation units', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'interrogate/_molecules/document-interrogation/document-interrogation.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'interrogate/_molecules/document-interrogation/document-interrogation.md',
    'interrogate/_atoms/evidence-packet/evidence-packet.md',
    'interrogate/_atoms/question-ledger/question-ledger.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('nothing in the closure widens the pinned read-only grant', () => {
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

test('interrogate explicitly refuses neighboring jobs', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /Not discovery\./);
  assert.match(entry, /Not domain mapping\./);
  assert.match(entry, /Not specification\./);
  assert.match(entry, /Not code review\./);
  assert.match(entry, /Read-only with respect to the repository and trackers/);
});

test('the interrogation packet keeps evidence, answers, and open questions separate', () => {
  const entry = flat(ENTRY);
  const molecule = flat('interrogate/_molecules/document-interrogation/document-interrogation.md');
  const evidence = flat('interrogate/_atoms/evidence-packet/evidence-packet.md');
  const ledger = flat('interrogate/_atoms/question-ledger/question-ledger.md');

  assert.match(entry, /confirmed facts grounded in evidence/);
  assert.match(entry, /assumptions, contradictions, ambiguities, and dependency questions/);
  assert.match(molecule, /unresolved questions/);
  assert.match(evidence, /Keep source claims separate from confirmed facts/);
  assert.match(ledger, /A partial answer is not a confirmed requirement/);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'interrogate', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: interrogate\s*$/m);
  assert.ok(!intent.startsWith('---'));
  assert.match(intent, /grill me with docs/);
  assert.match(intent, /must not implement, write trackers, produce a domain model, produce a spec/);
});

test('the workflow registers the interrogate conformance suite explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/interrogate\/interrogate\.conformance\.test\.mjs/);
});
