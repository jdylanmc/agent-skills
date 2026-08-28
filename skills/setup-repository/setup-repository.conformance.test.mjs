/**
 * Conformance tests for the setup-repository package's own shape.
 *
 * These assert the package advertises what it does, composes what it claims,
 * grants no more than its units need, and registers its tests. The behavioural
 * guarantees live in the atom suites; this file pins the wrapper.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import * as repositoryContext from './_atoms/repository-context/repository-context.mjs';
import * as contextArtifacts from './_atoms/context-artifacts/context-artifacts.mjs';
import * as writeGate from './_atoms/write-gate/write-gate.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'setup-repository/SKILL.md';
const MOLECULE = 'setup-repository/_molecules/repository-configuration/repository-configuration.md';
const PINNED_TOOLS = ['execute', 'read', 'search'];
const ATOMS = [
  'setup-repository/_atoms/repository-context/repository-context.md',
  'setup-repository/_atoms/context-artifacts/context-artifacts.md',
  'setup-repository/_atoms/write-gate/write-gate.md',
];
const OUTPUT_STATUSES = [
  'configured',
  'cancelled',
  'needs-input',
  'unsupported-provider',
  'unsafe-target',
  'stale-preview',
  'blocked',
];
const PROVIDER_CLASSES = ['github', 'gitlab', 'azure-devops', 'local'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

test('setup-repository is discoverable, user-invocable, and pinned to its grant', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'setup-repository');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
  // SR-06: the skill carries no direct `edit` grant. Writes go through the
  // write gate's executable, which is covered by the `execute` grant.
  assert.ok(!parsed.allowedTools.includes('edit'), 'the skill must not carry a direct edit grant');
});

test('the name and intent describe repository-context setup, not one repository', () => {
  const { description } = frontmatter(ENTRY);
  assert.match(description, /repository's agent context/);
  assert.match(description, /skills that need domain and tracker configuration/);
  assert.doesNotMatch(description, /jdylanmc|setup-jdylanmc/);
  assert.doesNotMatch(read(ENTRY), /setup-jdylanmc/);
});

test('the skill composes chronicler and the repository-configuration molecule', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'setup-repository/_molecules/repository-configuration/repository-configuration.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [MOLECULE, ...ATOMS]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('the molecule composes exactly the three atoms in order', () => {
  assert.deepEqual(frontmatter(MOLECULE).composes, ATOMS);
});

test('the skill grant is a superset of the union of its composed units', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) {
      required.add(tool);
    }
  }
  for (const tool of required) {
    assert.ok(PINNED_TOOLS.includes(tool), `grant must cover ${tool}`);
  }
  assert.deepEqual(derived.grantViolations.filter((v) => v.relativeFile === ENTRY), []);
});

test('writes go through the write gate command interface, not a direct edit grant', () => {
  // SR-06: the write gate is the enforced mutation path. No unit in the
  // package holds a direct `edit` grant. The gate's `.mjs` ships a documented
  // command interface (build-preview, apply-preview) so the `execute` grant
  // is what performs the write.
  assert.ok(!frontmatter(ENTRY).allowedTools.includes('edit'), 'skill has no direct edit grant');
  assert.ok(!frontmatter('setup-repository/_atoms/write-gate/write-gate.md').allowedTools.includes('edit'), 'write-gate atom has no direct edit grant');
  assert.ok(!frontmatter('setup-repository/_atoms/repository-context/repository-context.md').allowedTools.includes('edit'));
  assert.ok(!frontmatter('setup-repository/_atoms/context-artifacts/context-artifacts.md').allowedTools.includes('edit'));

  // The write-gate document names the command interface subcommands so the
  // executable path is discoverable rather than implicit.
  const gateDoc = read('setup-repository/_atoms/write-gate/write-gate.md');
  assert.match(gateDoc, /build-preview/);
  assert.match(gateDoc, /apply-preview/);
});

test('the workflow requires displaying every value or the complete rendered content before confirmation', () => {
  // SR-07: no confirmation is accepted unless the operator has seen the
  // complete preview. Both the skill workflow and the molecule workflow
  // state this as a requirement.
  const skillFlat = flat(ENTRY);
  assert.match(
    skillFlat,
    /Show the complete preview before requesting confirmation/i,
    'SKILL.md workflow must require showing the complete preview',
  );
  assert.match(
    skillFlat,
    /every normalized value|complete rendered file bytes|every rendered field/i,
    'SKILL.md workflow must require every value or the complete content',
  );
  assert.match(skillFlat, /previewId/, 'SKILL.md must reference the previewId shown to the operator');

  const moleculeFlat = fs.readFileSync(path.join(SKILLS_ROOT, MOLECULE), 'utf8').replace(/\s+/g, ' ');
  assert.match(
    moleculeFlat,
    /Before requesting confirmation, display the complete preview/i,
    'molecule workflow must require the complete preview before confirmation',
  );
  assert.match(moleculeFlat, /previewId/, 'molecule must reference the previewId shown to the operator');
});

test('the package composes no unit owned by another skill', () => {
  const foreign = [];
  for (const relativePath of [ENTRY, MOLECULE, ...ATOMS]) {
    for (const target of frontmatter(relativePath).composes ?? []) {
      if (!target.startsWith('setup-repository/') && !target.startsWith('_base/')) {
        foreign.push(`${relativePath} -> ${target}`);
      }
    }
  }
  assert.deepEqual(foreign, []);
});

test('SKILL.md documents the three generated files', () => {
  const entry = flat(ENTRY);
  for (const file of ['issue-tracker.md', 'domain.md', 'triage-labels.md']) {
    assert.match(entry, new RegExp(`\`${file.replace('.', '\\.')}\``), file);
  }
});

test('SKILL.md names the four provider classes and the seven output statuses', () => {
  const entry = flat(ENTRY);
  for (const provider of PROVIDER_CLASSES) {
    assert.match(entry, new RegExp(`\`${provider}\``), provider);
  }
  for (const status of OUTPUT_STATUSES) {
    assert.match(entry, new RegExp(`\`${status}\``), status);
  }
});

test('SKILL.md states the tracker and value boundaries from the issue', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /does not create, edit, close, label, assign, or relate tracker work items/);
  assert.match(entry, /does not invent a provider, project, repository,\s*area, label, or domain value/);
  assert.match(entry, /does not modify\s*repository instruction files, except an explicitly approved, bounded pointer/);
  assert.match(entry, /does not widen another skill's permissions or\s*silently install a consumer/);
  assert.match(entry, /does not copy employer, private, or\s*repository-specific content into the open-source template/);
});

test('SKILL.md ties issue-tracker.md to the downstream adapter resolution', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /resolves the full tracker-adapter contract/);
  assert.match(entry, /rather than guessing one/);
});

test('the helper statuses match the documented output statuses', () => {
  assert.deepEqual([...writeGate.WRITE_STATUSES].sort(), [
    'blocked', 'cancelled', 'configured', 'stale-preview', 'unsafe-target',
  ]);
  assert.deepEqual([...repositoryContext.SUPPORTED_PROVIDERS].sort(), [
    'azure-devops', 'github', 'gitlab', 'local',
  ]);
  assert.ok(Object.isFrozen(contextArtifacts.TRACKER_ADAPTER_CONTRACT));
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'setup-repository', 'intent.md'), 'utf8');
  assert.ok(!intent.startsWith('---'), 'an intent carries no frontmatter');
  assert.match(intent, /^# Intent: setup-repository\s*$/m);
  assert.ok(intent.replace(/^# Intent: setup-repository\s*$/m, '').trim().length > 0);
});

test('the workflow registers every setup-repository test file explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );
  for (const testFile of [
    'skills/setup-repository/setup-repository.conformance.test.mjs',
    'skills/setup-repository/_atoms/repository-context/repository-context.test.mjs',
    'skills/setup-repository/_atoms/context-artifacts/context-artifacts.test.mjs',
    'skills/setup-repository/_atoms/write-gate/write-gate.test.mjs',
  ]) {
    assert.ok(workflow.includes(testFile), `missing from validate-skills.yml: ${testFile}`);
  }
});
