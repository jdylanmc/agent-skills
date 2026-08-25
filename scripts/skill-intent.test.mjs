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

test('every routable skill has a plain intent file', () => {
  const missing = [];
  const malformed = [];

  for (const skill of routableSkills()) {
    const intentPath = path.join(SKILLS_ROOT, skill, 'intent.md');
    if (!fs.existsSync(intentPath)) {
      missing.push(`skills/${skill}/intent.md`);
      continue;
    }

    const intent = fs.readFileSync(intentPath, 'utf8');
    if (intent.startsWith('---')) {
      malformed.push(`skills/${skill}/intent.md must not have frontmatter`);
    }
    if (!new RegExp(`^# Intent: ${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').test(intent)) {
      malformed.push(`skills/${skill}/intent.md must start with "# Intent: ${skill}"`);
    }
  }

  assert.deepEqual(missing, [], `missing routable skill intent files: ${missing.join(', ')}`);
  assert.deepEqual(malformed, [], malformed.join('; '));
});
