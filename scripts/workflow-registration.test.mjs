import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The validation workflow names every test file explicitly and does not glob.
 * A test file that is committed but never registered passes locally and never
 * runs in continuous integration, which reads as coverage while guarding
 * nothing. This guard turns that silent gap into a named failure.
 */

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VALIDATE_WORKFLOW = path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml');

function discoverTests(relativeRoot) {
  const absoluteRoot = path.join(REPOSITORY_ROOT, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }
  const found = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join('/'));
      }
    }
  };
  visit(absoluteRoot);
  return found;
}

function workflowTests() {
  const workflow = fs.readFileSync(VALIDATE_WORKFLOW, 'utf8');
  return [...workflow.matchAll(/(?:^|\s)((?:scripts|skills)\/\S+\.test\.mjs)(?=\s|$)/g)]
    .map((match) => match[1]);
}

test('the validation workflow runs every committed test file', () => {
  const discovered = [...discoverTests('scripts'), ...discoverTests('skills')].sort();
  const listed = new Set(workflowTests());
  const missing = discovered.filter((testFile) => !listed.has(testFile));

  assert.deepEqual(
    missing,
    [],
    `missing from .github/workflows/validate-skills.yml: ${missing.join(', ')}`,
  );
});

test('the workflow lists no test file that does not exist', () => {
  // The reverse direction. A stale entry fails the whole run with a file-not-
  // found rather than a test failure, which is a confusing way to learn that a
  // package was removed or not yet migrated.
  const absent = [...new Set(workflowTests())]
    .filter((testFile) => !fs.existsSync(path.join(REPOSITORY_ROOT, testFile)))
    .sort();

  assert.deepEqual(absent, [], `listed in the workflow but not present: ${absent.join(', ')}`);
});

test('the workflow lists each test file exactly once', () => {
  const listed = workflowTests();
  const duplicates = [...new Set(listed.filter((t, i) => listed.indexOf(t) !== i))].sort();

  assert.deepEqual(duplicates, [], `listed more than once: ${duplicates.join(', ')}`);
});
