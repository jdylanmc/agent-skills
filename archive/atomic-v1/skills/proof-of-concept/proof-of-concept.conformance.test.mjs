import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'proof-of-concept/SKILL.md';
const PINNED_TOOLS = ['execute', 'read', 'search'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

test('proof-of-concept is user-invocable with a bounded execution grant', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'proof-of-concept');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description names prototype triggers and production refusals', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /proof of concept/);
  assert.match(description, /prototype this/);
  assert.match(description, /spike a library/);
  assert.match(description, /Do not use/);
  assert.match(description, /production implementation/);
  assert.match(description, /commit prototype code/);
});

test('the skill composes chronicler and local prototype learning units', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'proof-of-concept/_molecules/prototype-learning/prototype-learning.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'proof-of-concept/_molecules/prototype-learning/prototype-learning.md',
    'proof-of-concept/_atoms/poc-scope/poc-scope.md',
    'proof-of-concept/_atoms/prototype-run/prototype-run.md',
    'proof-of-concept/_atoms/poc-findings/poc-findings.md',
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

  const excess = [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort();
  assert.deepEqual(excess, [], `a composed unit needs ${excess.join(', ')}`);
  assert.deepEqual(derived.grantViolations, []);
});

test('prototype code is evidence rather than product code', () => {
  const entry = flat(ENTRY);
  const findings = flat('proof-of-concept/_atoms/poc-findings/poc-findings.md');

  assert.match(entry, /Prototype code is evidence, not product code/);
  assert.match(entry, /Do not harden, ship, or\s+promote it into implementation/);
  assert.match(findings, /Prototype code is never the durable deliverable/);
  assert.match(findings, /prototype success for production readiness/);
});

test('repository persistence and dangerous operations are approval gated', () => {
  const entry = flat(ENTRY);
  const run = flat('proof-of-concept/_atoms/prototype-run/prototype-run.md');
  const molecule = flat('proof-of-concept/_molecules/prototype-learning/prototype-learning.md');

  assert.match(entry, /Repository persistence requires explicit approval/);
  assert.match(entry, /Do not commit, push, deploy/);
  assert.match(run, /Do not deploy/);
  assert.match(run, /Do not commit or push/);
  assert.match(molecule, /Ask before preserving artifacts in the repository/);
});

test('discovery may route to proof-of-concept and receives learning back', () => {
  const entry = flat(ENTRY);
  const molecule = flat('proof-of-concept/_molecules/prototype-learning/prototype-learning.md');

  assert.match(entry, /discovery routes here because a cheap bounded prototype would answer a discovery question/);
  assert.match(entry, /return findings\s+in a shape discovery can incorporate/);
  assert.match(molecule, /Return learning to discovery when discovery owns the question/);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'proof-of-concept', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: proof-of-concept\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /stress-tests it with real code/);
  assert.match(normalized, /prototype is usually throwaway/i);
});

test('the workflow registers the proof-of-concept conformance suite explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/proof-of-concept\/proof-of-concept\.conformance\.test\.mjs/);
});
