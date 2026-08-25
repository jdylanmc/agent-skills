import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { resolveModelRoles } from './_molecules/model-role-resolver/model-role-resolver.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'model-role-resolution/SKILL.md';
const PINNED_TOOLS = ['execute', 'read'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

function role(result, name, index) {
  return result.roles.find((entry) => entry.role === name && (index === undefined || entry.index === index));
}

test('model-role-resolution is routable infrastructure with narrow permissions', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'model-role-resolution');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('routing description names positive and negative triggers', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /Resolve configurable model-role defaults and overrides/);
  assert.match(description, /agent-spawn-ready routing/);
  assert.match(description, /fallback, fanout, validation, and diversity status/);
  assert.match(description, /Use when/);
  assert.match(description, /debug model fallback behavior/);
  assert.match(description, /Do not use/);
  assert.match(description, /spawn agents/);
  assert.match(description, /change permissions/);
  assert.match(description, /replace agent-spawn/);
});

test('the skill composes chronicler and the local resolver molecule', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'model-role-resolution/_molecules/model-role-resolver/model-role-resolver.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'model-role-resolution/_molecules/model-role-resolver/model-role-resolver.md',
    'model-role-resolution/_atoms/model-role-defaults/model-role-defaults.md',
    'model-role-resolution/_atoms/model-role-override-contract/model-role-override-contract.md',
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

  const excess = [...required].filter((toolName) => !PINNED_TOOLS.includes(toolName)).sort();
  assert.deepEqual(excess, [], `a composed unit needs ${excess.join(', ')}`);
  assert.deepEqual(derived.grantViolations, []);
});

test('intent is plain prose and describes infrastructure rather than doctrine', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'model-role-resolution', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: model-role-resolution\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /explicit role map/);
  assert.match(normalized, /fanout/);
  assert.match(normalized, /agent-spawn/);
  assert.match(normalized, /never turn model identity into doctrine/);
});

test('defaults resolve deterministically and expose expected fanout', () => {
  const result = resolveModelRoles({
    availableModels: [
      'claude-sonnet-5', 'gpt-5.6-sol', 'gpt-5.5', 'claude-opus-5', 'gpt-5.4-mini',
      'claude-haiku-4.5', 'gpt-5-mini', 'grok-4.6', 'gemini-3.7-flash',
    ],
  });

  assert.equal(result.status, 'Resolved');
  assert.equal(result.fanout['architecture.candidates'], 3);
  assert.equal(result.fanout['qa.reviewers'], 3);
  assert.equal(role(result, 'implementer').routing.model, 'claude-sonnet-5');
  assert.equal(role(result, 'architecture.candidates', 2).routing.model, 'grok-4.6');
  assert.equal(role(result, 'qa.reviewers', 2).routing.model, 'gemini-3.7-flash');
});

test('panel override length controls fanout without padding defaults', () => {
  const result = resolveModelRoles({
    config: {
      architecture: { candidates: [{ model: 'claude-opus-5' }, { model: 'gpt-5.6-sol' }] },
      qa: { reviewers: [{ model: 'gpt-5.6-sol' }] },
    },
    availableModels: ['claude-opus-5', 'gpt-5.6-sol'],
  });

  assert.equal(result.fanout['architecture.candidates'], 2);
  assert.equal(result.roles.filter((entry) => entry.role === 'architecture.candidates').length, 2);
  assert.equal(result.fanout['qa.reviewers'], 1);
  assert.equal(result.roles.filter((entry) => entry.role === 'qa.reviewers').length, 1);
});

test('auto and inherit-parent aliases resolve visibly', () => {
  const result = resolveModelRoles({
    overrides: {
      cleanup: { model: 'auto' },
      architecture: { judge: { model: 'inherit-parent' } },
    },
    parentRouting: {
      model: 'gpt-5.6-sol',
      fallbackModels: ['claude-sonnet-5'],
      reasoningEffort: 'medium',
      contextTier: 'default',
    },
    availableModels: ['gpt-5.6-sol', 'claude-sonnet-5'],
  });

  assert.equal(role(result, 'cleanup')['model-status'], 'Runtime default');
  assert.equal(role(result, 'cleanup').routing.model, undefined);
  assert.match(role(result, 'architecture.judge').reasons.join('\n'), /Inherited parent routing/);
  assert.equal(role(result, 'architecture.judge').routing.model, 'gpt-5.6-sol');
});

test('unavailable requested slugs use listed fallback or become unavailable', () => {
  const result = resolveModelRoles({
    overrides: {
      implementer: { model: 'missing-alpha', fallbackModels: ['missing-beta', 'gpt-5.6-sol'] },
      cleanup: { model: 'missing-gamma', fallbackModels: ['missing-delta'] },
    },
    availableModels: ['gpt-5.6-sol'],
  });

  assert.equal(result.status, 'ResolvedWithDegradation');
  assert.equal(role(result, 'implementer').routing.model, 'gpt-5.6-sol');
  assert.equal(role(result, 'implementer')['model-status'], 'Fallback: gpt-5.6-sol');
  assert.equal(role(result, 'cleanup')['model-status'], 'No model available');
  assert.equal('model' in role(result, 'cleanup').routing, false);
  assert.match(result.warnings.join('\n'), /missing-alpha/);
  assert.match(result.warnings.join('\n'), /all listed fallbacks are unavailable/);
});

test('same-family panel diversity degradation is reported honestly', () => {
  const result = resolveModelRoles({
    overrides: {
      qa: {
        reviewers: [
          { model: 'gpt-5.6-sol' },
          { model: 'gpt-5.5' },
          { model: 'gpt-5.4' },
        ],
      },
    },
    availableModels: ['gpt-5.6-sol', 'gpt-5.5', 'gpt-5.4'],
  });

  const qa = result.diversity['qa.reviewers'];
  assert.equal(qa.status, 'Same-family degraded');
  assert.deepEqual(qa.families, { gpt: 3 });
  assert.match(result.warnings.join('\n'), /one family/i);
});

test('invalid configuration fails closed instead of guessing', () => {
  const result = resolveModelRoles({ overrides: { architecture: { candidates: { model: 'claude-opus-5' } } } });

  assert.equal(result.status, 'InvalidConfig');
  assert.deepEqual(result.roles, []);
  assert.match(result.errors.join('\n'), /architecture\.candidates panel override must be an array/);
});

test('unvalidated availability is surfaced rather than hidden', () => {
  const result = resolveModelRoles({ overrides: { implementer: { model: 'claude-sonnet-5' } } });

  assert.equal(result.status, 'ResolvedWithDegradation');
  assert.equal(role(result, 'implementer')['validation-status'], 'Not validated');
  assert.match(result.warnings.join('\n'), /without availability validation/);
});

test('the workflow registers the model-role-resolution conformance suite explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/model-role-resolution\/model-role-resolution\.conformance\.test\.mjs/);
  assert.match(workflow, /skills\/model-role-resolution\/_molecules\/model-role-resolver\/model-role-resolver\.test\.mjs/);
});
