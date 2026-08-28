import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyArtifact } from './artifact-classify.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SANDBOX_ROOT = path.join(ROOT, '.test-sandbox');

function reflowed(value) {
  return JSON.stringify(value).replace(/\s+/g, ' ');
}

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'artifact-classify-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
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
  assert.deepEqual(result.couldNotDistinguish, ['agent', 'skill', 'prompt', 'spec', 'code']);
});

test('classifies either half of a specification pair as a spec, never as code', (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, 'specs'));
  fs.writeFileSync(path.join(root, 'specs', 'checkout-hold.nano.md'), '# Checkout hold\n');
  fs.writeFileSync(path.join(root, 'specs', 'checkout-hold.full.md'), '# Checkout hold, in full\n');

  for (const half of ['specs/checkout-hold.nano.md', 'specs/checkout-hold.full.md']) {
    const result = classifyArtifact({ path: half, repositoryRoot: root });
    assert.equal(result.status, 'Classified', half);
    assert.equal(result.type, 'spec', half);
    assert.equal(result.routeToBranch, 'artifact', half);
    assert.equal(result.confidence, 'high', half);
    assert.match(reflowed(result.evidence), /specification pair naming convention/);
    assert.match(reflowed(result.evidence), /sibling resolves beside it/);
  }
});

test('a specification whose sibling is absent still classifies rather than refusing', (t) => {
  // The missing half is exactly what the review must report. Refusing to
  // classify would hide the one defect the operator most needs to see.
  const root = workspace(t);
  fs.writeFileSync(path.join(root, 'checkout-hold.nano.md'), '# Checkout hold\n');

  const result = classifyArtifact({ path: 'checkout-hold.nano.md', repositoryRoot: root });

  assert.equal(result.status, 'Classified');
  assert.equal(result.type, 'spec');
  assert.equal(result.routeToBranch, 'artifact');
  assert.match(reflowed(result.evidence), /full sibling is absent/);
});

test('a specification inside a prompts directory refuses rather than picking a side', (t) => {
  // Two conventions genuinely collide here, and the classifier does not get to
  // decide which the operator meant.
  const root = workspace(t);
  fs.mkdirSync(path.join(root, 'prompts'));
  fs.writeFileSync(path.join(root, 'prompts', 'checkout.nano.md'), '# Checkout\n');

  const result = classifyArtifact({ path: 'prompts/checkout.nano.md', repositoryRoot: root });

  assert.equal(result.status, 'Refused');
  assert.equal(result.category, 'Ambiguous target');
  assert.deepEqual(result.couldNotDistinguish.sort(), ['prompt', 'spec']);
});

test('a specification that quotes a diff is still a specification', (t) => {
  // Content must not overrule an exact path convention here. A full
  // specification documenting a change would otherwise become an ambiguous
  // target and get no review at all.
  const root = workspace(t);
  fs.writeFileSync(
    path.join(root, 'checkout.full.md'),
    [
      '# Checkout, in full',
      '',
      'The rejected approach edited the handler directly:',
      '',
      'diff --git a/src/checkout.ts b/src/checkout.ts',
      '@@ -1 +1 @@',
      '-const hold = 0;',
      '+const hold = 15;',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(root, 'checkout.nano.md'), '# Checkout\n');

  const result = classifyArtifact({ path: 'checkout.full.md', repositoryRoot: root });

  assert.equal(result.status, 'Classified');
  assert.equal(result.type, 'spec');
  assert.equal(result.routeToBranch, 'artifact');
  assert.doesNotMatch(reflowed(result.evidence), /diff syntax/);
});
