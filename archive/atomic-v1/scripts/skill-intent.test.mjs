import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');

function routableSkills() {
  return fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_base')
    .filter((entry) => fs.existsSync(path.join(SKILLS_ROOT, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function validateIntent(skill, intentPath, content) {
  if (content === undefined) {
    return [];
  }

  const errors = [];
  if (content.startsWith('---')) {
    errors.push(`${intentPath} must not have frontmatter`);
  }
  if (content.trim() === '') {
    errors.push(`${intentPath} must not be empty`);
  }
  if (!new RegExp(`^# Intent: ${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(content)) {
    errors.push(`${intentPath} must start with "# Intent: ${skill}"`);
  }
  return errors;
}

test('a routable skill may omit intent', () => {
  assert.deepEqual(validateIntent('example', 'skills/example/intent.md', undefined), []);
});

test('a present intent preserves all validation invariants', () => {
  assert.deepEqual(validateIntent(
    'example',
    'skills/example/intent.md',
    '# Intent: example\n\nWhy this skill exists.\n',
  ), []);
  assert.deepEqual(validateIntent('example', 'skills/example/intent.md', ''), [
    'skills/example/intent.md must not be empty',
    'skills/example/intent.md must start with "# Intent: example"',
  ]);
  assert.deepEqual(validateIntent(
    'example',
    'skills/example/intent.md',
    '---\nname: example\n---\n# Intent: example\n',
  ), [
    'skills/example/intent.md must not have frontmatter',
  ]);
  assert.deepEqual(validateIntent(
    'example',
    'skills/example/intent.md',
    'Why this skill exists.\n',
  ), [
    'skills/example/intent.md must start with "# Intent: example"',
  ]);
  assert.deepEqual(validateIntent(
    'example',
    'skills/example/intent.md',
    '# Intent: another-skill\n',
  ), [
    'skills/example/intent.md must start with "# Intent: example"',
  ]);
});

test('every present routable skill intent preserves all validation invariants', () => {
  const malformed = [];

  for (const skill of routableSkills()) {
    const relativePath = `skills/${skill}/intent.md`;
    const intentPath = path.join(SKILLS_ROOT, skill, 'intent.md');
    const content = fs.existsSync(intentPath) ? fs.readFileSync(intentPath, 'utf8') : undefined;
    malformed.push(...validateIntent(skill, relativePath, content));
  }

  assert.deepEqual(malformed, [], malformed.join('; '));
});
