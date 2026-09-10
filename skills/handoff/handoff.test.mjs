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
    what_worked: 'Using the shared core kept context selection separate from persistence.',
    what_did_not_work: 'No failed implementation attempts are confirmed in this scenario.',
    next_steps: 'Run graph validation, derivation, tests, and git diff checks before opening the pull request.',
    available_skills: ['handoff', 'post-mortem', 'spec'],
    ...overrides,
  };
}

test('handoff is explicitly invoked and delegates persistence to the shared core', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  assert.ok(result.routableSkills.includes('handoff'));

  const { raw, frontmatter } = parseSkill();
  assert.equal(frontmatter.disableModelInvocation, true);
  assert.equal(frontmatter.userInvocable, true);
  assert.deepEqual(frontmatter.allowedTools, ['read', 'search', 'execute']);
  assert.deepEqual(frontmatter.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    '_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md',
  ]);
  assert.match(frontmatter.description, /Use only when/);
  assert.match(frontmatter.description, /Do not invoke automatically/);
  assert.match(raw, /No filename, destination, visibility, or placement questions\./);
  assert.match(raw, /Do not create or copy a handoff\s+file in the workspace\./);
});

test('handoff carries a plain human-readable intent', () => {
  const intentPath = path.join(REPOSITORY_ROOT, 'skills', 'handoff', 'intent.md');
  assert.ok(fs.lstatSync(intentPath).isFile());
  const intent = fs.readFileSync(intentPath, 'utf8');
  const normalized = intent.replace(/\s+/g, ' ');

  assert.match(intent, /^# Intent: handoff\s*$/m);
  assert.ok(!intent.startsWith('---'));
  assert.match(normalized, /one bounded continuation artifact/);
  assert.match(normalized, /must not ask where to save the file/);
});

test('the entry documents evidence selection and a single persistence operation', () => {
  const raw = fs.readFileSync(SKILL, 'utf8').replace(/\s+/g, ' ');

  assert.match(raw, /If they conflict with evidence, preserve the evidence/);
  assert.match(raw, /Keep read and search inside the repository/);
  assert.match(raw, /Let the core normalize the slug/);
  assert.match(raw, /refuse with the missing evidence if that would make the handoff misleading/);
  assert.match(raw, /Pass the payload unchanged on standard input/);
  assert.match(raw, /Do not manually run its individual stages or retry persistence failures/);
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

test('an invented skill suggestion is refused rather than handed to the next agent', () => {
  const payload = representativePayload({
    suggested_skills: [{ skill: 'not-a-real-skill', reason: 'sounds plausible' }],
    available_skills: ['handoff', 'roast'],
  });

  assert.throws(
    () => persist(payload),
    /unknown_skill/,
    'a suggestion outside available_skills must be refused',
  );
});

test('the guard is armed by the package, not merely available in the core', () => {
  const skill = fs.readFileSync(SKILL, 'utf8');

  assert.match(skill, /populate `available_skills`/, 'the caller must populate the real skill inventory');
});

test('a recommended next move is marked as judgement rather than stated as fact', () => {
  const skill = fs.readFileSync(SKILL, 'utf8');

  assert.match(
    skill,
    /Recommendation:/,
    'next_steps must require explicit judgement language for a recommended move',
  );
});

test('open problems have one named home so a broken session cannot read as finished', () => {
  const skill = fs.readFileSync(SKILL, 'utf8').replace(/\s+/g, ' ');

  assert.match(
    skill,
    /problems still open when the session stopped in `what_did_not_work`/,
    'what_did_not_work must carry currently open problems, not only past attempts',
  );
});
