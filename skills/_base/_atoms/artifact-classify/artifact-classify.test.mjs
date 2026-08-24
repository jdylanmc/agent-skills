import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyArtifact } from './artifact-classify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function reflowed(value) {
  return JSON.stringify(value).replace(/\s+/g, ' ');
}

test('classifies an agent definition from path and frontmatter evidence', () => {
  const result = classifyArtifact({ path: 'agents/skill-reviewer.agent.md', repositoryRoot: ROOT });

  assert.equal(result.status, 'Classified');
  assert.equal(result.type, 'agent');
  assert.equal(result.routeToBranch, 'artifact');
  assert.equal(result.confidence, 'high');
  assert.match(reflowed(result.evidence), /agent path convention/);
  assert.match(reflowed(result.evidence), /agent frontmatter/);
});

test('classifies a skill package from its root directory', () => {
  const result = classifyArtifact({ path: 'skills/roast', repositoryRoot: ROOT });

  assert.equal(result.status, 'Classified');
  assert.equal(result.type, 'skill');
  assert.equal(result.routeToBranch, 'artifact');
  assert.equal(result.confidence, 'high');
  assert.match(reflowed(result.evidence), /skill package directory/);
});

test('classifies supplied instructional text as a prompt when no stronger marker exists', () => {
  const result = classifyArtifact({
    text: 'You are a release-note assistant. Always return exactly three bullets and do not invent facts.',
    locator: 'supplied-text:test-01',
  });

  assert.equal(result.status, 'Classified');
  assert.equal(result.type, 'prompt');
  assert.equal(result.routeToBranch, 'artifact');
  assert.equal(result.confidence, 'medium');
  assert.match(reflowed(result.evidence), /prompt wording/);
});

test('classifies pull-request and diff references as code-review scope', () => {
  for (const reference of ['PR #76', 'branch diff against origin/main', 'working-tree changes']) {
    const result = classifyArtifact({ reference });
    assert.equal(result.status, 'Classified');
    assert.equal(result.type, 'code');
    assert.equal(result.routeToBranch, 'code');
    assert.equal(result.confidence, 'high');
  }
});

test('classifies pasted unified diffs as code-review scope', () => {
  const result = classifyArtifact({
    text: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-console.log("old")\n+console.log("new")\n',
  });

  assert.equal(result.status, 'Classified');
  assert.equal(result.type, 'code');
  assert.equal(result.routeToBranch, 'code');
  assert.match(reflowed(result.evidence), /diff syntax/);
});

test('refuses conflicting Markdown evidence instead of guessing', () => {
  const result = classifyArtifact({
    text: [
      '---',
      'name: suspicious',
      'allowed-tools: ["read"]',
      'target: github-copilot',
      'tools: ["read"]',
      '---',
      '',
      '# Suspicious Artifact',
    ].join('\n'),
    locator: 'supplied-text:ambiguous-01',
  });

  assert.equal(result.status, 'Refused');
  assert.equal(result.category, 'Ambiguous target');
  assert.deepEqual(result.couldNotDistinguish, ['skill', 'agent']);
  assert.match(reflowed(result.candidates), /skill frontmatter/);
  assert.match(reflowed(result.candidates), /agent frontmatter/);
});

test('refuses generic Markdown files with insufficient evidence', () => {
  const result = classifyArtifact({ path: 'README.md', repositoryRoot: ROOT });

  assert.equal(result.status, 'Refused');
  assert.equal(result.category, 'Insufficient evidence');
  assert.deepEqual(result.couldNotDistinguish, ['agent', 'skill', 'prompt', 'code']);
});
