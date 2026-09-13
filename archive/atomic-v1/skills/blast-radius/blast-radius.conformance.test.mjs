import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'blast-radius/SKILL.md';
const MOLECULE = 'blast-radius/_molecules/blast-radius-proof/blast-radius-proof.md';
const PINNED_TOOLS = ['execute', 'read', 'search'];
const ATOMS = [
  'blast-radius/_atoms/impact-trace/impact-trace.md',
  'blast-radius/_atoms/assertion-ladder/assertion-ladder.md',
  'blast-radius/_atoms/risk-proof-report/risk-proof-report.md',
];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

function section(relativePath, heading, nextHeading = '## ') {
  const content = read(relativePath);
  const start = content.indexOf(heading);
  assert.notEqual(start, -1, `${relativePath} must contain ${heading}`);
  const end = content.indexOf(nextHeading, start + heading.length);
  return content.slice(start, end === -1 ? undefined : end);
}

test('blast-radius is independently invocable with the pinned read-only grant', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'blast-radius');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('routing covers blast-radius, change-impact, breakage, and QA council language', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /blast radius/);
  assert.match(description, /what could this break/);
  assert.match(description, /change impact/);
  assert.match(description, /Quality Assurance council/);
  assert.match(description, /Do not use to edit candidate code or tests/);
  assert.match(description, /approve or accept risk/);
});

test('the skill directly composes chronicler and only local proof units', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    MOLECULE,
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of ['_base/_molecules/chronicler/chronicler.md', MOLECULE, ...ATOMS]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }

  for (const relativePath of [ENTRY, MOLECULE, ...ATOMS]) {
    for (const target of frontmatter(relativePath).composes ?? []) {
      assert.ok(
        target.startsWith('blast-radius/') || target.startsWith('_base/'),
        `${relativePath} must not compose ${target}`,
      );
    }
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

  const excess = [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort();
  assert.deepEqual(excess, [], `a composed unit needs ${excess.join(', ')}`);
  assert.deepEqual(derived.grantViolations, []);
});

test('the workflow traces direct and hidden consumers before selecting assertions', () => {
  const entry = flat(ENTRY);
  const trace = flat(ATOMS[0]);
  const molecule = flat(MOLECULE);

  assert.match(entry, /looks beyond direct callers/);
  assert.match(trace, /re-exports, facades, dependency injection, plugin and command registries/);
  assert.match(trace, /serialized data, schemas, protocols, database or cache contracts/);
  assert.match(trace, /events, queues, callbacks, reflection, dynamic loading, and runtime lookup/);
  assert.match(molecule, /smallest set of safety-critical, falsifiable assertions/);
  assert.match(molecule, /Do not create an assertion merely because a generic failure is imaginable/);
});

test('every assertion climbs the five rungs and stops exactly', () => {
  const entry = flat(ENTRY);
  const ladder = flat(ATOMS[1]);
  const molecule = flat(MOLECULE);

  for (const rung of [
    'assertion',
    'exact-source-citation',
    'ruled-out-bad-case',
    'executable-proof',
    'live-reproduction',
  ]) {
    assert.match(ladder, new RegExp(`\`${rung}\``));
  }
  assert.match(entry, /exact stopping rung and reason/);
  assert.match(ladder, /Stop at the first rung that cannot responsibly advance/);
  for (const progression of ['completed', 'unavailable', 'not-applicable', 'not-attempted']) {
    assert.match(ladder, new RegExp(`\`${progression}\``));
  }
  for (const outcome of ['supports-assertion', 'supports-bad-case', 'inconclusive', 'conflicting']) {
    assert.match(ladder, new RegExp(`\`${outcome}\``));
  }
  assert.match(ladder, /Mark every later rung `not-attempted`/);
  assert.match(ladder, /Command failure is not automatically acquisition failure/);
  assert.match(molecule, /strongest supported claim, and next evidence needed/);
});

test('the report separates evidence states and recommends exactly one cheapest proof', () => {
  const entry = flat(ENTRY);
  const report = flat(ATOMS[2]);
  const classification = section(ATOMS[2], '## Classification');
  const states = [...classification.matchAll(/^\| `([^`]+)` \|/gm)].map((match) => match[1]);

  assert.match(entry, /\*\*confirmed risks\*\*/);
  assert.match(entry, /\*\*cleared risks\*\*/);
  assert.match(entry, /\*\*unproven assertions\*\*/);
  assert.deepEqual(states, ['confirmed-risk', 'cleared-risk', 'unproven-assertion']);
  assert.match(report, /Classify each assertion exactly once/);
  assert.match(report, /Return exactly one recommendation slot/);
  assert.match(report, /regression-proof-status/);
  assert.match(report, /why a cheaper proof would not cross the required boundary/);
  assert.match(report, /Do not write the test, procedure, fixture, automation, or candidate change/);
  assert.match(report, /arithmetic cannot validate semantic proof quality/);
});

test('classification and proof-selection prerequisites are explicit and non-contradictory', () => {
  const report = flat(ATOMS[2]);
  const classification = section(ATOMS[2], '## Classification');
  const proof = section(ATOMS[2], '## Cheapest Pre-Merge Regression Proof Slot');

  assert.match(classification, /Consumer or path reachability alone never qualifies/);
  assert.match(classification, /necessarily produce that named bad case/);
  assert.doesNotMatch(classification, /candidate reaches it/);
  assert.match(proof, /`selected`/);
  assert.match(proof, /`unavailable`/);
  assert.match(proof.replace(/\s+/g, ' '), /do not disguise evidence acquisition as a regression proof/);
  assert.doesNotMatch(report, /obtain-more-evidence-before-selecting-proof/);
});

test('absence evidence, execution, and live reproduction stay bounded', () => {
  const entry = flat(ENTRY);
  const trace = flat(ATOMS[0]);
  const ladder = flat(ATOMS[1]);

  assert.match(entry, /no-match search proves only absence inside its recorded query and scope/);
  assert.match(trace, /not found in this search scope/);
  assert.match(ladder, /known not to mutate candidate or external state/);
  assert.match(ladder, /undocumented or unknown mutation behavior/);
  assert.match(ladder, /being a build or test alone does not make it mutating/);
  assert.match(ladder, /Live reproduction is optional/);
});

test('the skill exposes a council seam without invoking a council or judge', () => {
  const entry = flat(ENTRY);
  const molecule = flat(MOLECULE);

  assert.match(entry, /This skill is independently invocable/);
  assert.match(entry, /does not depend on, discover, or invoke a QA council or QA judge/);
  assert.match(entry, /human retains strategic authority and final approval/);
  assert.match(molecule, /neither invokes nor requires a council or judge/);
  assert.doesNotMatch(frontmatter(ENTRY).requiresSkills.join(' '), /council|judge/i);
  assert.match(molecule, /Human operators retain approval and strategic authority/);
});

test('the package states audience, purpose, and pinned provenance', () => {
  const entry = flat(ENTRY);
  const molecule = flat(MOLECULE);

  assert.match(entry, /change author or reviewer familiar with the repository/);
  assert.match(entry, /select the cheapest additional pre-merge evidence/);
  assert.match(entry, /does not approve the change/);
  assert.match(molecule, /cursor\/plugins/);
  assert.match(molecule, /46125561306434d8a1d7745d540d8932ab0cd2a2/);
  assert.match(molecule, /adapted in independently written language/);
});

test('the package refuses mutation, implementation, adjudication, and speculative lists', () => {
  const entry = flat(ENTRY);
  const report = flat(ATOMS[2]);

  assert.match(entry, /\*\*Read-only\.\*\* Do not edit candidate code, tests/);
  assert.match(entry, /\*\*Proof, not implementation\.\*\*/);
  assert.match(entry, /Do not output a giant speculative risk list/);
  assert.match(entry, /\*\*No adjudication\.\*\*/);
  assert.match(report, /No pass\/fail, approval, merge, or risk-acceptance verdict/);
});

test('the validation workflow registers the blast-radius conformance suite', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/blast-radius\/blast-radius\.conformance\.test\.mjs/);
});
