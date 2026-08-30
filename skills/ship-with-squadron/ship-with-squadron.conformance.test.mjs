import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { DELIVERY_STAGES } from './_atoms/quality-evidence/quality-evidence.mjs';
import {
  FORBIDDEN_PROVIDER_OPERATIONS,
  PROVIDER_OPERATIONS,
} from './_atoms/provider-seam/provider-seam.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = path.join(ROOT, 'skills');
const ENTRY = 'ship-with-squadron/SKILL.md';
const PINNED_TOOLS = ['execute', 'read', 'search', 'task'];

function read(relative) {
  return fs.readFileSync(path.join(SKILLS, ...relative.split('/')), 'utf8');
}

function frontmatter(relative) {
  return readFrontmatter(read(relative), relative);
}

test('is human-only, routable, non-wildcard, and grants no edit authority', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'ship-with-squadron');
  assert.equal(parsed.disableModelInvocation, true);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('*'));
  assert.ok(!parsed.allowedTools.includes('edit'));
});

test('directly composes Chronicler and local fleet molecules only', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'ship-with-squadron/_molecules/fleet-control/fleet-control.md',
    'ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md',
  ]);
  const closure = closureFor(validateRepository(ROOT), ENTRY);
  assert.ok(closure.includes('ship-with-squadron/_atoms/dependency-frontier/dependency-frontier.md'));
  assert.ok(closure.includes('ship-with-squadron/_atoms/quality-evidence/quality-evidence.md'));
  assert.ok(!closure.some((file) => file.startsWith('chart-a-course/')));
  assert.ok(!closure.some((file) => file.startsWith('blast-radius/')));
});

test('pins required local workflow skills and review-stable external blast-radius seam', () => {
  assert.deepEqual(frontmatter(ENTRY).requiresSkills, [
    { id: 'run-ci', source: 'local', required: true },
    { id: 'roast', source: 'local', required: true },
    { id: 'blast-radius', source: 'external', required: true },
    { id: 'orchestration-handoff', source: 'local', required: true },
    { id: 'shepherd', source: 'local', required: false },
  ]);
  const quality = read('ship-with-squadron/_atoms/quality-evidence/quality-evidence.md').replace(/\s+/g, ' ');
  assert.match(quality, /Pull Request 157 is merged/);
  assert.match(quality, /4a946e4500479e028112b77bdf268c5b7a8aae1f/);
  assert.match(quality, /fails closed unless the exact contract revision is present/);
});

test('pins full delivery order and forbidden authority', () => {
  assert.deepEqual(DELIVERY_STAGES, [
    'implementation',
    'diff-reconciliation',
    'run-ci',
    'roast',
    'blast-radius-proof',
    'bounded-remediation',
    'criterion-verdict',
    'publication',
    'shepherd',
  ]);
  assert.deepEqual(PROVIDER_OPERATIONS, [
    'read-issue', 'read-issue-set', 'publish-change-request', 'observe-merge',
    'observe-change-request-revision',
  ]);
  assert.deepEqual(FORBIDDEN_PROVIDER_OPERATIONS, [
    'merge', 'approve', 'enable-auto-merge', 'accept-risk',
    'close-issue', 'close-change-request', 'force-push',
  ]);
  const body = read(ENTRY).replace(/\s+/g, ' ');
  for (const operation of ['merge', 'approve', 'enable auto-merge', 'accept risk', 'force-push', 'close tracker work']) {
    assert.match(body, new RegExp(operation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('permission closure stays inside the deliberate wrapper grant', () => {
  const derived = deriveGraph(ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual([...required].sort(), PINNED_TOOLS);
  assert.deepEqual(derived.grantViolations, []);
});

test('state is ignored separately from Chronicle and package intent is inert prose', () => {
  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /^\.ship-with-squadron\/$/m);
  const intent = read('ship-with-squadron/intent.md');
  assert.match(intent, /^# Intent: ship-with-squadron$/m);
  assert.ok(!intent.startsWith('---'));
});

test('all package tests are registered in the validation workflow', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'validate-skills.yml'), 'utf8');
  const tests = [
    'ship-with-squadron.conformance.test.mjs',
    '_atoms/fleet-manifest/fleet-manifest.test.mjs',
    '_atoms/dependency-frontier/dependency-frontier.test.mjs',
    '_atoms/fleet-state/fleet-state.test.mjs',
    '_atoms/assignment-ownership/assignment-ownership.test.mjs',
    '_atoms/quality-evidence/quality-evidence.test.mjs',
    '_atoms/provider-seam/provider-seam.test.mjs',
    '_atoms/readiness-set/readiness-set.test.mjs',
    '_atoms/fleet-disposition/fleet-disposition.test.mjs',
  ];
  for (const relative of tests) {
    assert.match(workflow, new RegExp(`skills/ship-with-squadron/${relative}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
