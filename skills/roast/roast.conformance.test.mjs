/**
 * Conformance tests for the consolidated `/roast` skill.
 *
 * Two properties are pinned here because both are easy to lose quietly.
 *
 * 1. The permission grant. Four sibling skills each declared
 *    `["read","search","execute","task"]`. Merging them must widen nothing,
 *    and a later change to a now much larger skill must not widen it either.
 *    The deriver already refuses to *narrow* a grant silently; nothing stops a
 *    human from adding a tool. This test does.
 *
 * 2. The single authored body. The shared roast contract, failure reference,
 *    and lens reference previously existed in three drifting copies. They are
 *    authored once now. This test asserts there is still exactly one of each.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { ARTIFACT_TYPES } from './_atoms/artifact-profile/artifact-profile.mjs';
import { classifyArtifact } from '../_base/_atoms/artifact-classify/artifact-classify.mjs';
import { GOVERNANCE } from './_atoms/doctrine-select/doctrine-select.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'roast/SKILL.md';

/** The exact grant every predecessor skill declared. Widening is a decision. */
const PINNED_TOOLS = ['read', 'search', 'execute', 'task'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

test('the roast skill declares exactly the pinned tool grant', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(
    parsed.allowedTools,
    PINNED_TOOLS,
    'consolidating four skills must not widen or reorder the grant they shared',
  );
  assert.ok(!parsed.allowedTools.includes('*'));
  assert.ok(!parsed.allowedTools.includes('edit'));
});

test('nothing the skill composes needs a tool outside the pinned grant', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) {
      required.add(tool);
    }
  }
  const excess = [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort();
  assert.deepEqual(
    excess,
    [],
    `a composed unit needs ${excess.join(', ')}, which would widen the pinned grant`,
  );
  assert.deepEqual(derived.grantViolations, []);
});

test('the skill declares its invocation flags and composes the chronicler', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.disableModelInvocation, true);
  assert.equal(parsed.userInvocable, true);
  assert.ok(parsed.composes.includes('_base/_molecules/chronicler/chronicler.md'));
});

test('one entry point reaches all four artifact branches', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const closure = closureFor(result, ENTRY);
  for (const unit of [
    'roast/_molecules/roast-target-intake/roast-target-intake.md',
    'roast/_molecules/roast-artifact-branch/roast-artifact-branch.md',
    'roast/_molecules/roast-code-branch/roast-code-branch.md',
    '_base/_atoms/artifact-classify/artifact-classify.md',
    'roast/_atoms/doctrine-select/doctrine-select.md',
    'roast/_atoms/artifact-profile/artifact-profile.md',
    'roast/_atoms/spec-pair/spec-pair.md',
    'roast/_atoms/spec-authority-screen/spec-authority-screen.md',
    '_base/_atoms/doctrine-evaluate/doctrine-evaluate.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('the code branch does not compose the shared artifact coordination molecule', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const coordinate = '_base/_molecules/roast-coordinate-review/roast-coordinate-review.md';

  const artifactBranch = closureFor(
    result,
    'roast/_molecules/roast-artifact-branch/roast-artifact-branch.md',
  );
  assert.ok(artifactBranch.includes(coordinate));

  const codeBranch = closureFor(result, 'roast/_molecules/roast-code-branch/roast-code-branch.md');
  assert.ok(
    !codeBranch.includes(coordinate),
    'code-review scope has its own shape; forcing it into the artifact shape would be a false abstraction',
  );
});

test('the artifact-type material is authored exactly once', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const shared = [
    'roast/_atoms/roast-contract/roast-contract.md',
    'roast/_atoms/roast-failure-recovery/roast-failure-recovery.md',
    'roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.md',
  ];
  for (const unit of shared) {
    assert.ok(result.graph.has(unit), `${unit} must exist`);
  }

  const duplicates = [...result.graph.keys()].filter((file) =>
    /(roast-contract|failure-and-recovery|roast-failure-recovery|trusted-lenses|trusted-manifest)/.test(
      file,
    ),
  );
  assert.deepEqual(
    duplicates.sort(),
    shared.sort(),
    'the contract, failure reference, and lens reference each exist exactly once',
  );
});

test('the spec type is a profile row rather than a second review framework', () => {
  // Issue #118 asked for a spec roaster and explicitly preferred extending
  // `/roast` over building a parallel one. This is what "extending" has to
  // mean mechanically: one more row, and no second contract.
  assert.ok(ARTIFACT_TYPES.includes('spec'));

  const result = validateRepository(REPOSITORY_ROOT);
  const forks = [...result.graph.keys()].filter((file) =>
    /spec-(contract|roast|reviewer|failure|lenses)|roast-spec-branch/.test(file),
  );
  assert.deepEqual(forks, [], `a parallel spec review framework appeared: ${forks.join(', ')}`);

  const branch = closureFor(result, 'roast/_molecules/roast-artifact-branch/roast-artifact-branch.md');
  assert.ok(branch.includes('roast/_atoms/spec-pair/spec-pair.md'));
  assert.ok(branch.includes('roast/_atoms/spec-authority-screen/spec-authority-screen.md'));
  assert.ok(branch.includes('roast/_atoms/roast-contract/roast-contract.md'));
});

test('a spec pair reaches the artifact branch end to end, and never the code branch', (t) => {
  // Acceptance criterion 1 of issue #118, checked at the entry point rather
  // than only inside the classifier: intake classifies from evidence, the
  // profile exists for what it classified, and doctrine governs it. A gap at
  // any of the three refuses a target `/roast` claims to accept.
  const sandbox = path.join(REPOSITORY_ROOT, '.test-sandbox');
  fs.mkdirSync(sandbox, { recursive: true });
  const root = fs.mkdtempSync(path.join(sandbox, 'roast-conformance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'checkout.nano.md'), '# Checkout\n');
  fs.writeFileSync(path.join(root, 'checkout.full.md'), '# Checkout, in full\n');

  const classified = classifyArtifact({ path: 'checkout.nano.md', repositoryRoot: root });
  assert.equal(classified.status, 'Classified');
  assert.equal(classified.type, 'spec');
  assert.equal(classified.routeToBranch, 'artifact');

  assert.deepEqual(
    ARTIFACT_TYPES.filter((type) => !(type in GOVERNANCE)),
    [],
    'every artifact profile needs a doctrine selection, or intake refuses the type it just classified',
  );
  assert.ok(GOVERNANCE.spec.primary.length > 0, 'no doctrine governs a spec target');
});

test('no predecessor roast skill package survives the consolidation', () => {
  const packages = fs
    .readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const survivors = packages.filter((name) => name.startsWith('roast-this-'));
  assert.deepEqual(survivors, [], `superseded packages still present: ${survivors.join(', ')}`);
  assert.ok(packages.includes('roast'));
});

test('the skill states that severity is a category and not a gate', () => {
  const entry = read(ENTRY);
  assert.match(entry, /`blocker`, `major`, `minor`, or `advisory`/);
  assert.match(entry, /Severity is a \*\*category only\*\*/);
  assert.match(entry, /approves nothing, blocks nothing/);
  assert.doesNotMatch(entry, /pass\/fail verdict is returned/);
});

test('every line item the skill promises carries a way to resolve it', () => {
  // The operator's requirement, held at the entry point as well as in each
  // branch, so the promise a reader sees first is the promise both branches
  // enforce.
  const entry = read(ENTRY);
  assert.match(entry, /Mandatory and non-empty on every line item, with no exception/);
  assert.match(entry, /Validation \| How a reader confirms the fix worked/);
  assert.match(entry, /a concern with no bounded fix is recorded as an open risk/);

  for (const branch of [
    'roast/_molecules/roast-artifact-branch/roast-artifact-branch.md',
    'roast/_molecules/roast-code-branch/roast-code-branch.md',
  ]) {
    const document = read(branch);
    assert.match(document, /non-empty `Recommendation`/, `${branch} omits the requirement`);
    assert.match(document, /non-empty `Validation`/, `${branch} omits Validation`);
    assert.match(document, /executes no recommendation/, `${branch} omits the read-only boundary`);
  }
});

test('the skill states that it approves no specification and decides no product question', () => {
  const entry = read(ENTRY);
  assert.match(entry, /Never approve a product specification/);
  assert.match(entry, /decide a product question it left\n  open/);
  assert.match(entry, /gains no approval authority by invoking it/);
  assert.match(entry, /`<spec>\.nano\.md` governs\n  and `<spec>\.full\.md` is context/);
});
