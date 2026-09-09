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

test('assigns current eligible full-strength models without weakening role packets', () => {
  const roles = read('bench-squadron/_atoms/role-doctrine/role-doctrine.md').replace(/\s+/g, ' ');

  for (const model of ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']) {
    assert.match(roles, new RegExp(model.replaceAll('.', '\\.')));
  }
  assert.match(roles, /inspect the exact model IDs the current runtime advertises/i);
  assert.match(roles, /latest two major generations that the operator has confirmed/i);
  assert.match(roles, /record the eligible IDs, the selected ID for every role, the reasoning effort, and the context tier/i);
  assert.match(roles, /Slop Sniper \| `gpt-6-astra` \| `xhigh` \| `default`/i);
  assert.match(roles, /Do not infer that another provider's version numbers are comparable/i);
  assert.match(roles, /four eligible aliases do not become five independent families/i);
  assert.match(roles, /Never silently use a mini, flash, older-generation, runtime-default, or otherwise unproven model/i);
  assert.match(roles, /stop before dispatch and return the observed IDs and the exact human choice required/i);
  assert.match(roles, /ordinary context tier by default/i);
  assert.match(roles, /Do not truncate, summarize, or omit a lens/i);
  assert.match(roles, /existing pool cap, quorum, and bounded task packets/i);
  assert.match(roles, /future integration seam is the recorded runtime inventory and per-role selection/i);
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

test('bounds preparation separately and exits without silently renewing or changing authority', () => {
  const entry = read(ENTRY).replace(/\s+/g, ' ');
  const control = read(MOLECULE).replace(/\s+/g, ' ');
  assert.match(entry, /same confirmation, bound preparation separately from execution/i);
  assert.match(entry, /preparation exit before promising overnight delivery/i);
  for (const requirement of [
    /finite preparation budget, its start time, the execution budget/i,
    /absolute cutoff and timezone/i,
    /Retries and changed probe designs consume that same budget/i,
    /Before each preparation action, compare the current time/i,
    /Reaching either deadline ends preparation/i,
    /Preparation does not extend the overall cutoff/i,
    /coordination checks, not a claim of runtime hard cancellation/i,
    /whether execution and notification require this session to remain open/i,
    /Prepared:.*This is not a running claim/i,
    /Authorized fallback:.*operator's prior authorization/i,
    /different workflow is an explicit handoff/i,
    /Without an authorized fallback, do not silently switch modes/i,
    /Do not begin another setup project at exhaustion/i,
  ]) assert.match(control.replaceAll('**', ''), requirement);
});

test('running requires accepted revision-bound ownership and fresh execution, not setup artifacts', () => {
  const entry = read(ENTRY).replace(/\s+/g, ' ');
  const control = read(MOLECULE).replace(/\s+/g, ' ');
  assert.match(entry, /Report `running` only after accepted delivery ownership and a current runtime observation/i);
  for (const requirement of [
    /exact run, assignment, agent identity, owned worktree and candidate revision, Fleet State revision, and Bench epoch/i,
    /acknowledgement accepting that bounded assignment from its actual delivery owner/i,
    /generic task-registry `running` label without accepted assignment evidence is insufficient/i,
    /cannot replace a Fleet State reservation or proposal signature/i,
    /`waiting` \| The accepted owner is waiting, idle, or awaiting a result/i,
    /`unconfirmed` \| Ownership or current execution evidence is missing, stale, or mismatched/i,
    /worktree, plan, probe, queued dispatch, or scheduled morning reminder cannot establish `running`/i,
    /Name the receipt and observation time/i,
    /rebind acceptance and reobserve execution before renewing the claim/i,
    /After a session gap, report the gap and reobserve/i,
    /never imply completed delivery, review readiness, or confirmed cancellation/i,
  ]) assert.match(control, requirement);
});

test('inconclusive probes block dependent operations without excusing required gates', () => {
  const entry = read(ENTRY).replace(/\s+/g, ' ');
  const control = read(MOLECULE).replace(/\s+/g, ' ');
  assert.match(entry, /pre-readiness timeout is `inconclusive`/i);
  for (const requirement of [
    /Before a probe, name the capability, the operations that require it/i,
    /Exercise the behavior only after observing that handshake/i,
    /startup timeout or cancellation before the tested boundary is reached is `inconclusive`, not `unsupported`/i,
    /cancellation acknowledgement is not proof of termination/i,
    /root-session observation does not prove descendant coverage/i,
    /Failed or unproven required prerequisites block that operation and its dependent operations/i,
    /mandatory global gate still blocks every operation it governs/i,
    /Continue independent work only when its own prerequisites are satisfied/i,
    /Unknown dependency or authority is not evidence of independence/i,
    /do not treat uncertainty as permission/i,
    /Preserve the unresolved condition in every partial result and handoff/i,
  ]) assert.match(control, requirement);
});
