import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import {
  BENCH_EPOCH_SCHEMA_VERSION,
  MAX_DELIVERY_POOL_AGENTS,
} from './_atoms/bench-epoch/bench-epoch.mjs';
import { BENCH_ATOMIC_STRATEGY } from './_atoms/atomic-proposal/atomic-proposal.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = path.join(ROOT, 'skills');
const ENTRY = 'bench-squadron/SKILL.md';
const MOLECULE = 'bench-squadron/_molecules/bench-control/bench-control.md';
const ATOMS = [
  '_base/_atoms/atomic-transition/atomic-transition.md',
  'bench-squadron/_atoms/atomic-proposal/atomic-proposal.md',
  'bench-squadron/_atoms/bench-epoch/bench-epoch.md',
  'bench-squadron/_atoms/fleet-state/fleet-state.md',
  'bench-squadron/_atoms/role-doctrine/role-doctrine.md',
];

function read(relative) {
  return fs.readFileSync(path.join(SKILLS, ...relative.split('/')), 'utf8');
}

function frontmatter(relative) {
  return readFrontmatter(read(relative), relative);
}

test('is an explicit human-only workflow with a deliberate bounded grant', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'bench-squadron');
  assert.equal(parsed.disableModelInvocation, true);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.allowedTools, ['execute', 'read', 'task']);
  assert.deepEqual(parsed.requiresSkills, [
    { id: 'slop-sniper', source: 'local', required: true },
  ]);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('composes the shared atomic transition while keeping Bench choreography local', () => {
  const raw = read(ENTRY);
  const parsed = frontmatter(ENTRY);
  assert.match(raw, /atomic-transition/);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    MOLECULE,
  ]);
  assert.deepEqual(frontmatter(MOLECULE).composes, ATOMS);

  const closure = closureFor(validateRepository(ROOT), ENTRY);
  for (const unit of ['_base/_molecules/chronicler/chronicler.md', MOLECULE, ...ATOMS]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
  assert.ok(!closure.some((unit) => unit.startsWith('ship-with-squadron/')));
  assert.ok(closure.includes('_base/_atoms/atomic-transition/atomic-transition.md'));
});

test('has only local package units and a narrow transitive tool requirement', () => {
  const derived = deriveGraph(ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual([...required].sort(), ['execute', 'read']);
  assert.deepEqual(derived.grantViolations, []);
  for (const file of [ENTRY, MOLECULE, ...ATOMS]) {
    for (const target of frontmatter(file).composes ?? []) {
      assert.ok(
        target.startsWith('_base/') || target.startsWith('bench-squadron/'),
        `${file} composes foreign unit ${target}`,
      );
    }
  }
});

test('teaches the hard role, publication, epoch, and human authority boundaries', () => {
  assert.equal(BENCH_EPOCH_SCHEMA_VERSION, 2);
  assert.equal(MAX_DELIVERY_POOL_AGENTS, 5);
  const body = read(ENTRY).replace(/\s+/g, ' ');
  const molecule = read(MOLECULE).replace(/\s+/g, ' ');
  const roles = read('bench-squadron/_atoms/role-doctrine/role-doctrine.md').replace(/\s+/g, ' ');

  for (const text of [
    'separate orchestrator',
    'separate asynchronous Slop Sniper',
    'one through five distinct agents',
    '1 <= quorum <= delivery-pool size inclusive',
    'exact current epoch',
    'mutator may not sign',
    'invalidates all collected signatures and downstream claims',
    'review-ready only after',
    'human alone decides approval, merge, promotion, retirement, scope changes, and risk acceptance',
  ]) {
    assert.match(body, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(molecule, /current Fleet State binding/i);
  assert.match(molecule, /Scope, risk, approval, merge, promotion, and retirement remain human-only/i);
  assert.match(roles, /full text/i);
  assert.match(roles, /not a full-text lens/i);
});

test('the package intent is inert human prose and Fleet State reuse stays a code dependency', () => {
  const intent = read('bench-squadron/intent.md');
  assert.match(intent, /^# Intent: bench-squadron$/m);
  assert.ok(!intent.startsWith('---'));
  const adapter = read('bench-squadron/_atoms/fleet-state/fleet-state.mjs');
  assert.match(adapter, /assertFleetState/);
  assert.match(adapter, /ship-with-squadron\/_atoms\/fleet-state\/fleet-state\.mjs/);
});

test('adapts validated Bench transitions to Atomic Transition and its Fleet State CAS path', () => {
  assert.equal(BENCH_ATOMIC_STRATEGY, 'bench-squadron/v1');
  const adapter = read('bench-squadron/_atoms/atomic-proposal/atomic-proposal.mjs');
  const documentation = read('bench-squadron/_atoms/atomic-proposal/atomic-proposal.md');
  const control = read(MOLECULE);

  assert.match(adapter, /validateStrategyTransitionProposal/);
  assert.match(adapter, /applyFleetStateTransition/);
  assert.match(adapter, /createBenchAtomicCurrent/);
  assert.match(documentation, /currentness evaluator/i);
  assert.match(documentation, /compare-and-swap adapter/i);
  assert.match(control, /delegates the compatible durable write/i);
});
