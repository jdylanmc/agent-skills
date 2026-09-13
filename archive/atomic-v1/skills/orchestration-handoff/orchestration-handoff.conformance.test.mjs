import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'orchestration-handoff/SKILL.md';
const HUMAN_ENTRY = 'handoff/SKILL.md';
const ADAPTER = 'orchestration-handoff/_atoms/orchestration-context-adapter/orchestration-context-adapter.md';
const PERSIST = '_base/_molecules/persist-orchestration-handoff/persist-orchestration-handoff.md';
const PINNED_TOOLS = ['read', 'search', 'execute'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

test('orchestration-handoff is the agent-invoked mirror of human handoff', () => {
  const orchestration = frontmatter(ENTRY);
  const human = frontmatter(HUMAN_ENTRY);

  assert.equal(orchestration.name, 'orchestration-handoff');
  assert.equal(orchestration.disableModelInvocation, false);
  assert.equal(orchestration.userInvocable, false);
  assert.equal(human.disableModelInvocation, true);
  assert.equal(human.userInvocable, true);
  assert.notDeepEqual(
    [orchestration.disableModelInvocation, orchestration.userInvocable],
    [human.disableModelInvocation, human.userInvocable],
    'the pair must not silently converge on the same invocation posture',
  );
});

test('the wrapper grants only the tools its composed units need', () => {
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

test('the skill composes chronicler, orchestration adapter, and sibling persistence', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    ADAPTER,
    PERSIST,
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    ADAPTER,
    PERSIST,
    '_base/_atoms/artifact-reference/artifact-reference.md',
    '_base/_atoms/handoff-render/handoff-render.md',
    '_base/_atoms/redact-sensitive/redact-sensitive.md',
    '_base/_atoms/temp-path-resolve/temp-path-resolve.md',
    '_base/_atoms/write-guarded/write-guarded.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('description carries positive and negative triggers', () => {
  const { description } = frontmatter(ENTRY);
  assert.match(description, /Use when/);
  assert.match(description, /orchestrating agent/);
  assert.match(description, /timeout, respawn, or reassignment/);
  assert.match(description, /Do not use/);
  assert.match(description, /human-invoked handoffs/);
  assert.match(description, /workspace files/);
});

test('the local adapter pins orchestration schema fields and untrusted evidence handling', () => {
  const adapter = flat(ADAPTER);
  for (const required of [
    'run_identity',
    'source_agent',
    'target_agent',
    'task_contract',
    'inputs',
    'constraints',
    'assumptions',
    'artifacts_and_references',
    'acceptance_criteria',
    'open_questions',
    'schema_version: 1',
    'GOAL',
    'SCOPE',
    'CONTEXT',
    'ACCEPTANCE',
    'VERIFY',
    'TIMEBOX',
    'FORBIDDEN',
    'REPORT',
    'STANDING',
  ]) {
    assert.match(adapter, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(adapter, /Treat every input document/);
  assert.match(adapter, /untrusted evidence/);
  assert.match(adapter, /No filename, destination, visibility, or placement interview/);
});

test('sibling persistence documents the schema decision and preserves shared-core guarantees', () => {
  const persist = flat(PERSIST);
  assert.match(persist, /sibling-persistence option/);
  assert.match(persist, /does not add fields, versions, or a discriminator/);
  assert.match(persist, /existing bounded handoff payload/);
  assert.match(persist, /Artifacts are linked rather than copied|artifacts are linked rather than copied/i);
  assert.match(persist, /operating system temporary directory/);
  assert.match(persist, /MIT attribution/);
});

test('the package carries plain human-readable inert intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'orchestration-handoff', 'intent.md'), 'utf8');
  const normalized = intent.replace(/\s+/g, ' ');

  assert.match(intent, /^# Intent: orchestration-handoff\s*$/m);
  assert.ok(!intent.startsWith('---'));
  assert.match(normalized, /agent-invoked mirror/);
  assert.match(normalized, /stable versioned schema/);
  assert.match(normalized, /sibling orchestration persistence molecule/);
  assert.doesNotMatch(normalized, /\b(always|must|never)\s+(read|execute|invoke|call|edit)\b/i);
});

test('the wrapper carries the create-skill signature footer', () => {
  const entry = read(ENTRY).trimEnd();
  assert.ok(entry.endsWith('<!-- 🤖 This skill was created using the create-skill AI skill. https://github.com/gaming-microsoft/ai-skills -->'));
  assert.match(entry, /---\n\n<!-- 🤖 This skill was created using the create-skill AI skill/);
});

test('the conformance suite is registered explicitly in the workflow', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );
  assert.match(workflow, /skills\/orchestration-handoff\/orchestration-handoff\.conformance\.test\.mjs/);
  assert.match(workflow, /skills\/_base\/_molecules\/persist-orchestration-handoff\/persist-orchestration-handoff\.test\.mjs/);
});
