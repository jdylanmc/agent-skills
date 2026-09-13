import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'next-step-selection/SKILL.md';
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

function backtickValues(value) {
  return [...value.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

function skillDispositionSet() {
  const match = flat(ENTRY).match(/terminal disposition: ([^;]+);/);
  assert.ok(match, 'SKILL.md must enumerate terminal dispositions');
  return new Set(backtickValues(match[1]));
}

function selectionBriefDispositionSet() {
  const rows = read('next-step-selection/_atoms/selection-brief/selection-brief.md')
    .split('\n')
    .filter((line) => /^\| `[^`]+` \|/.test(line));
  return new Set(rows.map((line) => line.match(/^\| `([^`]+)` \|/)?.[1]).filter(Boolean));
}

function candidateRows() {
  return read('next-step-selection/_atoms/candidate-frontier/candidate-frontier.md')
    .split('\n')
    .filter((line) => /^\| `[^`]+` \|/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

test('next-step-selection is user-invocable and read-only', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'next-step-selection');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description names stale-session and parent-workflow triggers', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /Reconstruct the current work state/);
  assert.match(description, /exactly one tactical next action/);
  assert.match(description, /terminal disposition/);
  assert.match(description, /conditional worker brief/);
  assert.match(description, /returns to a stale session/);
  assert.match(description, /parent workflow/);
  assert.match(description, /Do not use/);
  assert.match(description, /spawn agents/);
  assert.match(description, /mutate trackers/);
});

test('the skill composes chronicler and local frontier units', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'next-step-selection/_molecules/frontier-selection/frontier-selection.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'next-step-selection/_molecules/frontier-selection/frontier-selection.md',
    'next-step-selection/_atoms/state-reconstruction/state-reconstruction.md',
    'next-step-selection/_atoms/candidate-frontier/candidate-frontier.md',
    'next-step-selection/_atoms/selection-brief/selection-brief.md',
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

test('the output contract requires one action plus decision evidence', () => {
  const entry = flat(ENTRY);
  const brief = flat('next-step-selection/_atoms/selection-brief/selection-brief.md');

  assert.match(entry, /exactly one selected next action/);
  assert.match(entry, /route rationale/);
  assert.match(entry, /rejected alternatives/);
  assert.match(entry, /authority check/);
  assert.match(entry, /budget, stop condition, and human gate/);
  assert.match(entry, /worker brief, present only when the terminal disposition is\s+`ready-to-dispatch`/);
  assert.match(brief, /selected next action/);
  assert.match(brief, /Worker Brief/);
  assert.match(brief, /When the terminal disposition is `ready-to-dispatch`, include a worker brief/);
});

test('the package refuses dispatch and mutation authority', () => {
  const entry = flat(ENTRY);
  const molecule = flat('next-step-selection/_molecules/frontier-selection/frontier-selection.md');
  const candidate = flat('next-step-selection/_atoms/candidate-frontier/candidate-frontier.md');
  const brief = flat('next-step-selection/_atoms/selection-brief/selection-brief.md');

  assert.match(entry, /No dispatch authority/);
  assert.match(entry, /does not spawn subagents/);
  assert.match(entry, /It does not edit files, create branches,\s+commit, push, merge, close issues, update work items, send messages, or deploy/);
  assert.match(entry, /it does not assume\s+a `chart-a-course` skill exists or invoke one/);
  assert.match(entry, /It may select `discover` as the recommended next action/);
  assert.match(entry, /does not invoke discovery/);
  assert.match(molecule, /Do not invoke the chosen worker/);
  assert.match(candidate, /Do not dispatch the selected candidate/);
  assert.match(brief, /The worker brief is not an invocation/);
});

test('execute is constrained to chronicler and not state probing', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /`execute` is for Chronicler\s+recording only/);
  assert.doesNotMatch(entry, /bounded state probes/);
  assert.doesNotMatch(entry, /reading the current branch or pull\s+request metadata/);
});

test('candidate classes map to terminal dispositions', () => {
  const candidate = flat('next-step-selection/_atoms/candidate-frontier/candidate-frontier.md');
  const expectedDispositions = skillDispositionSet();
  const rows = candidateRows();

  assert.deepEqual(rows.map(([candidateClass]) => candidateClass), [
    '`merge-or-finish-review`',
    '`rebase-or-unblock`',
    '`implement-next-slice`',
    '`run-validation`',
    '`run-roast-or-review`',
    '`discover`',
    '`chart-course`',
    '`ask-human`',
    '`stop`',
  ]);

  for (const [candidateClass, , dispositionCell] of rows) {
    const dispositions = backtickValues(dispositionCell);
    assert.ok(dispositions.length > 0, `${candidateClass} must declare at least one terminal disposition`);
    for (const disposition of dispositions) {
      assert.ok(expectedDispositions.has(disposition), `${candidateClass} maps to unknown disposition ${disposition}`);
    }
  }

  assert.match(candidate, /Default terminal disposition/);
  assert.match(candidate, /terminal disposition derived from the table above/);
  assert.match(rows.find(([candidateClass]) => candidateClass === '`ask-human`')[2], /`needs-human-choice`/);
  assert.match(rows.find(([candidateClass]) => candidateClass === '`stop`')[2], /`stop`/);
  assert.match(rows.find(([candidateClass]) => candidateClass === '`chart-course`')[2], /generic backlog-planning workflow/);
});

test('terminal disposition sets stay aligned across package files', () => {
  const skillDispositions = [...skillDispositionSet()].sort();
  const selectionDispositions = [...selectionBriefDispositionSet()].sort();
  const candidateDispositions = [
    ...new Set(candidateRows().flatMap(([, , dispositionCell]) => backtickValues(dispositionCell))),
  ].sort();

  assert.deepEqual(selectionDispositions, skillDispositions);
  assert.deepEqual(
    candidateDispositions.filter((disposition) => !skillDispositions.includes(disposition)),
    [],
  );
});

test('state reconstruction prefers compact current sources before broad scans', () => {
  const state = flat('next-step-selection/_atoms/state-reconstruction/state-reconstruction.md');

  assert.match(state, /Prefer compact, current sources before large raw sources/);
  assert.match(state, /current session summary, handoff, or Chronicler replay/);
  assert.match(state, /broader repository or tracker searches only when the frontier cannot be\s+selected from the compact sources/);
  assert.match(state, /Keep reconstruction small enough to support one decision/);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'next-step-selection', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: next-step-selection\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /returns to an ongoing body of work/);
  assert.match(normalized, /one next step/);
  assert.match(normalized, /must stay read-only/);
});

test('the workflow registers the next-step-selection conformance suite explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/next-step-selection\/next-step-selection\.conformance\.test\.mjs/);
});
