import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'domain-mapping/SKILL.md';
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

test('domain-mapping is an explicit human-only read-only action', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'domain-mapping');
  assert.equal(parsed.disableModelInvocation, true);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description distinguishes explicit human use from excluded work graphs', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /Use only when/);
  assert.match(description, /human invokes `\/domain-mapping`/);
  assert.match(description, /actors/);
  assert.match(description, /Do not use/);
  assert.match(description, /GitHub issues/);
  assert.match(description, /dependency chains/);
  assert.match(description, /critical paths/);
  assert.match(description, /roadmaps/);
});

test('the wrapper composes its human-only domain operation', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'domain-mapping/_molecules/domain-map/domain-map.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'domain-mapping/_molecules/domain-map/domain-map.md',
    'domain-mapping/_atoms/domain-inventory/domain-inventory.md',
    '_base/_atoms/relationship-map/relationship-map.md',
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

test('domain-mapping explicitly refuses neighboring jobs', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /Not interrogate\./);
  assert.match(entry, /Not discovery\./);
  assert.match(entry, /Not specification\./);
  assert.match(entry, /Not implementation planning\./);
  assert.match(entry, /Not backlog mapping\./);
  assert.match(entry, /Read-only with respect to repository and trackers/);
});

test('the map keeps entities, relationships, boundaries, and uncertainty separate', () => {
  const entry = flat(ENTRY);
  const molecule = flat('domain-mapping/_molecules/domain-map/domain-map.md');
  const inventory = flat('domain-mapping/_atoms/domain-inventory/domain-inventory.md');
  const relationships = flat('_base/_atoms/relationship-map/relationship-map.md');

  assert.match(entry, /glossary entries with aliases, contested terms/);
  assert.match(entry, /relationships between entities, with direction, confidence, and evidence/);
  assert.match(entry, /boundaries and seams/);
  assert.match(molecule, /overloaded or contested terms/);
  assert.match(inventory, /Mark guesses as guesses/);
  assert.match(relationships, /Do not invent a relationship/);
});

test('the human operation is local and its relationship atom is shared', () => {
  const map = frontmatter('domain-mapping/_molecules/domain-map/domain-map.md');
  assert.deepEqual(map.usedBy, ['domain-mapping/SKILL.md']);
  const relationships = frontmatter('_base/_atoms/relationship-map/relationship-map.md');
  assert.deepEqual(relationships.usedBy, [
    'discovery/_molecules/aligned-domain-model/aligned-domain-model.md',
    'domain-mapping/_molecules/domain-map/domain-map.md',
  ]);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'domain-mapping', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: domain-mapping\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /concepts, actors, systems, boundaries/);
  assert.match(normalized, /must not become discovery, interrogation, specification, ticketing, or implementation/);
});

test('the workflow registers the domain-mapping conformance suite explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/domain-mapping\/domain-mapping\.conformance\.test\.mjs/);
});
