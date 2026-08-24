import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILL = path.join(REPOSITORY_ROOT, 'skills', 'handoff', 'SKILL.md');
const ADAPTER = path.join(
  REPOSITORY_ROOT,
  'skills',
  'handoff',
  '_atoms',
  'handoff-context-adapter',
  'handoff-context-adapter.md',
);
const PERSIST = path.join(
  REPOSITORY_ROOT,
  'skills',
  '_base',
  '_molecules',
  'persist-bounded-handoff',
  'persist-bounded-handoff.mjs',
);

function parseSkill() {
  const raw = fs.readFileSync(SKILL, 'utf8');
  return { raw, frontmatter: readFrontmatter(raw, 'handoff/SKILL.md') };
}

function persist(payload) {
  const stdout = execFileSync(process.execPath, [PERSIST, '--stdin'], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const result = JSON.parse(stdout);
  try {
    result.document = fs.readFileSync(result.path, 'utf8');
    return result;
  } finally {
    fs.rmSync(result.path, { force: true });
  }
}

function representativePayload(overrides = {}) {
  return {
    schema_version: 1,
    slug_source: 'skills issue 44 handoff',
    goal: 'Create a human-facing handoff skill wrapper for issue #44.',
    current_progress: 'The wrapper package is implemented in skills/handoff and awaits validation.',
    decisions_and_constraints: 'The implementation composes the shared bounded-handoff core and does not choose a destination itself.',
    artifacts_and_references: [
      { reference: '#44', note: 'human-facing handoff skill issue' },
      { reference: '#42', note: 'parent bounded handoff capability' },
      { reference: 'docs/adr/0001-use-local-units-and-promote-proven-shared-units.md', note: 'local-first unit policy' },
      { reference: 'skills/handoff/SKILL.md', note: 'routable wrapper' },
    ],
    what_worked: 'Using a local adapter kept caller-specific context separate from persistence.',
    what_did_not_work: 'No failed implementation attempts are confirmed in this scenario.',
    next_steps: 'Run graph validation, derivation, tests, and git diff checks before opening the pull request.',
    available_skills: ['handoff', 'post-mortem', 'spec'],
    ...overrides,
  };
}

test('handoff skill is an explicitly invoked wrapper over the adapter and shared core', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  assert.ok(result.routableSkills.includes('handoff'));

  const { raw, frontmatter } = parseSkill();
  assert.equal(frontmatter.disableModelInvocation, true);
  assert.equal(frontmatter.userInvocable, true);
  assert.deepEqual(frontmatter.allowedTools, ['read', 'search', 'execute']);
  assert.deepEqual(frontmatter.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'handoff/_atoms/handoff-context-adapter/handoff-context-adapter.md',
    '_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md',
  ]);
  assert.match(frontmatter.description, /Use only when/);
  assert.match(frontmatter.description, /Do not invoke automatically/);
  assert.match(raw, /No filename, destination, visibility, or placement questions\./);
  assert.match(raw, /Do not create or copy a handoff\s+file in the workspace\./);
});

test('handoff context adapter preserves evidence boundaries and delegates persistence', () => {
  const raw = fs.readFileSync(ADAPTER, 'utf8');
  const frontmatter = readFrontmatter(raw, 'handoff/_atoms/handoff-context-adapter/handoff-context-adapter.md');

  assert.equal(frontmatter.level, 'atom');
  assert.deepEqual(frontmatter.composes, []);
  assert.match(raw, /Arguments tailor the handoff without overriding confirmed evidence\./);
  assert.match(raw, /Existing artifacts are linked rather than copied\./);
  assert.match(raw, /No filename, destination, visibility, or placement interview is introduced\./);
  assert.match(raw, /No workspace file is created or modified by this adapter\./);
});

test('representative human handoff payload persists to the runtime temp handoffs directory', () => {
  const result = persist(representativePayload({
    suggested_skills: [
      { skill: 'post-mortem', reason: 'Review the completed session if the next agent needs process lessons.' },
    ],
  }));

  const tempRoot = fs.realpathSync(os.tmpdir());
  const directory = fs.realpathSync(path.dirname(result.path));
  assert.equal(path.basename(directory), 'handoffs');
  assert.ok(!path.relative(tempRoot, directory).startsWith('..'));
  assert.equal(result.suggested_skills_included, true);
  assert.ok(result.bytes > 0);
  assert.match(result.document, /^# Handoff\n/);
  assert.match(result.document, /## Suggested Skills\n\n- post-mortem - Review the completed session/);
  assert.match(result.document, /- #44 - human-facing handoff skill issue/);
});

test('suggested skills section is omitted when no next skill is useful', () => {
  const result = persist(representativePayload());

  assert.equal(result.suggested_skills_included, false);
  assert.ok(!result.headings.includes('Suggested Skills'));
  assert.doesNotMatch(result.document, /^## Suggested Skills$/m);
});
