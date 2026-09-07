import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'tdd-squadron/SKILL.md';
const PINNED_TOOLS = ['execute', 'read', 'search', 'task'];

function read(relative) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relative.split('/')), 'utf8');
}

function frontmatter(relative) {
  return readFrontmatter(read(relative), relative);
}

function flat(relative) {
  return read(relative).replace(/\s+/g, ' ');
}

function markdownSection(source, heading, nextHeading = null) {
  const start = source.indexOf(heading);
  assert.notEqual(start, -1, `missing ${heading}`);
  const end = nextHeading === null ? source.length : source.indexOf(nextHeading, start + heading.length);
  assert.notEqual(end, -1, `missing ${nextHeading}`);
  return source.slice(start, end);
}

function markdownTable(source, lead) {
  const start = source.indexOf(lead);
  assert.notEqual(start, -1, `missing table lead: ${lead}`);
  const lines = source.slice(start + lead.length).trimStart().split('\n');
  const table = [];
  for (const line of lines) {
    if (!line.startsWith('|')) {
      if (table.length > 0) break;
      continue;
    }
    table.push(line.split('|').slice(1, -1).map((cell) => cell.trim()));
  }
  assert.ok(table.length >= 3, `incomplete table after: ${lead}`);
  return table.slice(2);
}

test('is an explicit, model-disabled, narrowly granted experiment', () => {
  const entry = frontmatter(ENTRY);
  assert.equal(entry.disableModelInvocation, true);
  assert.equal(entry.userInvocable, true);
  assert.deepEqual(entry.allowedTools, PINNED_TOOLS);
  assert.ok(!entry.allowedTools.includes('*'));
  assert.ok(!entry.allowedTools.includes('edit'));
  assert.deepEqual(entry.requiresSkills, [{ id: 'slop-sniper', source: 'local', required: true }]);
});

test('composes Chronicler, shared atomic transition, and the local TDD molecule', () => {
  const entry = frontmatter(ENTRY);
  assert.deepEqual(entry.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md',
  ]);
  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  assert.ok(closure.includes('tdd-squadron/_atoms/tdd-lifecycle/tdd-lifecycle.md'));
  assert.ok(closure.includes('tdd-squadron/_atoms/doctrine-lenses/doctrine-lenses.md'));
  assert.ok(closure.includes('_base/_atoms/atomic-transition/atomic-transition.md'));
  assert.ok(!closure.some((unit) => unit.startsWith('ship-with-squadron/')));
});

test('uses the shared atomic transition contract', () => {
  const entry = frontmatter(ENTRY);
  const source = flat(ENTRY);
  const molecule = flat('tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md');
  const adapter = read('tdd-squadron/_atoms/atomic-proposal/atomic-proposal.mjs');
  assert.match(source, /atomic-transition/);
  assert.ok(entry.includes.includes('tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md'));
  assert.ok(frontmatter('tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md').composes
    .includes('tdd-squadron/_atoms/atomic-proposal/atomic-proposal.md'));
  assert.match(adapter, /applyFleetStateTransition/);
  assert.match(adapter, /state\.strategyState/);
  assert.match(molecule, /shared compare-and-swap/);
});

test('pins TDD choreography, authority, full-text doctrine, and advisory audit boundaries', () => {
  const entry = flat(ENTRY);
  const lenses = flat('tdd-squadron/_atoms/doctrine-lenses/doctrine-lenses.md');
  const advisory = flat('tdd-squadron/_atoms/slop-sniper-advisory/slop-sniper-advisory.md');
  assert.match(entry, /two-seat reservation for two distinct people: `red` and `green`/);
  assert.match(entry, /alternate complete vertical slices, starting with Red and then Green/);
  assert.match(entry, /There is no per-slice Roast/);
  assert.match(entry, /one `roastmaster` and three distinct `roaster` agents/);
  assert.match(entry, /leaving the fifth delivery seat available/);
  assert.match(entry, /Any candidate mutation invalidates every prior Roast claim and returns the candidate to TDD/);
  assert.match(entry, /Only the configured trusted publication-agent identity may publish a review-ready change request/);
  assert.match(lenses, /complete, unabridged text/);
  assert.match(lenses, /canonical doctrine manifest and record its revision and digest/);
  assert.match(advisory, /asynchronously/);
  assert.match(advisory, /only at a later safe transition/);
});

test('assigns current eligible full-strength models without weakening TDD choreography', () => {
  const source = read('tdd-squadron/_atoms/doctrine-lenses/doctrine-lenses.md');
  const lenses = flat('tdd-squadron/_atoms/doctrine-lenses/doctrine-lenses.md');
  const policy = markdownSection(source, '## Model Assignment');
  const expectedModels = ['gpt-5.6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra'];
  const eligibleBlock = markdownSection(
    policy,
    'For the current runtime, the proven eligible IDs\nare:',
    'Treat model IDs and generation labels as opaque runtime facts.',
  );
  const eligibleModels = [...eligibleBlock.matchAll(/`(gpt-[^`]+)`/g)].map((match) => match[1]).sort();
  assert.deepEqual(eligibleModels, expectedModels);
  const allPolicyModels = [...new Set(
    [...policy.matchAll(/`(gpt-[^`]+)`/g)].map((match) => match[1]),
  )].sort();
  assert.deepEqual(allPolicyModels, expectedModels, 'the policy section contains only the closed eligible set');

  const assignmentRows = markdownTable(
    policy,
    'Use this current illustrative default assignment only while those exact IDs\nremain advertised, eligible, and suitable:',
  );
  assert.deepEqual(assignmentRows, [
    ['Red', '`gpt-5.6-sol`', '`high`', '`default`'],
    ['Green', '`gpt-6-astra`', '`high`', '`default`'],
    ['Roastmaster', '`gpt-6-astra`', '`xhigh`', '`default`'],
    ['Roaster 1', '`gpt-5.6-sol`', '`xhigh`', '`default`'],
    ['Roaster 2', '`gpt-5.6-terra`', '`xhigh`', '`default`'],
    ['Roaster 3', '`gpt-5.6-luna`', '`xhigh`', '`default`'],
    ['Publication agent', '`gpt-6-astra`', '`high`', '`default`'],
    ['Slop Sniper', '`gpt-6-astra`', '`xhigh`', '`default`'],
  ]);

  const fallbackRows = markdownTable(
    policy,
    'For the current eligible set, apply these ordered choices per role:',
  );
  assert.deepEqual(fallbackRows, [
    ['Red', '`gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna` -> `gpt-6-astra`'],
    ['Green', '`gpt-6-astra` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna`'],
    ['Roastmaster', '`gpt-6-astra` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna`'],
    ['Roaster 1', '`gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna` -> `gpt-6-astra`'],
    ['Roaster 2', '`gpt-5.6-terra` -> `gpt-5.6-luna` -> `gpt-5.6-sol` -> `gpt-6-astra`'],
    ['Roaster 3', '`gpt-5.6-luna` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-6-astra`'],
    ['Publication agent', '`gpt-6-astra` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna`'],
    ['Slop Sniper', '`gpt-6-astra` -> `gpt-5.6-sol` -> `gpt-5.6-terra` -> `gpt-5.6-luna`'],
  ]);

  assert.match(lenses, /inspect the exact model IDs the current runtime advertises/i);
  assert.match(lenses, /resolve the latest two supported major generations that the operator has confirmed/i);
  assert.match(lenses, /not a runtime resolver or a permanent model catalog/i);
  assert.match(lenses, /one persistent two-person Red\/Green pair and one four-seat Roast/i);
  assert.match(lenses, /three GPT-5\.6 aliases do not prove three independent model families/i);
  assert.match(lenses, /preferred ID and ordered eligible choices/i);
  assert.match(lenses, /actual chosen ID, or `none`/i);
  assert.match(lenses, /degraded_model_variety: true\|false/i);
  assert.match(lenses, /run-level comparison record retains those role receipts/i);
  assert.match(lenses, /Never silently use a mini, flash, older-generation, runtime-default, or otherwise unproven model/i);
  assert.match(lenses, /stop before dispatch, and return the observed IDs and the exact human choice required/i);
  assert.match(lenses, /ordinary context tier by default/i);
  assert.match(lenses, /Never truncate, summarize, or omit a lens/i);
  assert.match(lenses, /fixed pair, the fixed four-seat Roast, and one-shot audits/i);
  assert.match(lenses, /future integration seam is the recorded runtime inventory and per-role selection/i);
});

test('derived unit fields and skill grant remain valid', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual([...required].sort(), PINNED_TOOLS);
  assert.deepEqual(derived.grantViolations, []);
});

test('intent remains inert plain-language source', () => {
  const intent = read('tdd-squadron/intent.md');
  assert.match(intent, /^# Intent: tdd-squadron$/m);
  assert.ok(!intent.startsWith('---'));
});
