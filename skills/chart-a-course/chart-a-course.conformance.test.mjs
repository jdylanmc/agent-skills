import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'chart-a-course/SKILL.md';
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

test('chart-a-course is routable and read-only', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'chart-a-course');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('routing metadata names positive graph triggers and negative authority boundaries', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /bounded mixed set/);
  assert.match(description, /one named goal/);
  assert.match(description, /chart a course/);
  assert.match(description, /ready frontier/);
  assert.match(description, /operational readiness prerequisites/);
  assert.match(description, /repository or provider state/);
  assert.match(description, /Do not use/);
  assert.match(description, /prioritize/);
  assert.match(description, /mutate trackers/);
  assert.match(description, /next tactical action/);
});

test('the skill composes chronicler and only local course units', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'chart-a-course/_molecules/course-chart/course-chart.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'chart-a-course/_molecules/course-chart/course-chart.md',
    'chart-a-course/_atoms/graph-normalization/graph-normalization.md',
    'chart-a-course/_atoms/course-analysis/course-analysis.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
  assert.ok(!closure.some((unit) => unit.startsWith('next-step-selection/')));
});

test('nothing in the closure widens the pinned grant', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }

  const excess = [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort();
  assert.deepEqual(excess, []);
  assert.deepEqual(derived.grantViolations, []);
});

test('the output and refusal contracts cover the complete course', () => {
  const entry = flat(ENTRY);
  const molecule = flat('chart-a-course/_molecules/course-chart/course-chart.md');

  for (const phrase of [
    'goal identity, graph revision, observation time',
    'gating subgraph',
    'all equally longest gating chains',
    'ready frontier',
    'blocked records with every explicit incomplete blocker',
    'completed gating records',
    'dependency, operational, and combined implementation readiness',
    'matching foundation record',
    'human confirmation required',
    'outside work',
    'cycles and unresolved edges',
    'reordering unknowns',
    'confidence and evidence',
    'exactly one read-only planning action',
  ]) {
    assert.match(entry, new RegExp(phrase));
  }
  assert.match(entry, /not a calendar or time\s+critical path/i);
  assert.match(molecule, /Goal outside graph/);
  assert.match(molecule, /duplicate identity/i);
  assert.match(molecule, /Ambiguous direction/);
  assert.match(molecule, /Absent endpoint/);
  assert.match(molecule, /Cycle/);
  assert.match(molecule, /Stale or unavailable status/);
});

test('the package refuses mutation, dispatch, priority, and next-step selection', () => {
  const entry = flat(ENTRY);
  const analysis = flat('chart-a-course/_atoms/course-analysis/course-analysis.md');

  assert.match(entry, /Read-only\./);
  assert.match(entry, /No dispatch or prioritization/);
  assert.match(entry, /Not next-step-selection/);
  assert.match(entry, /neither invokes nor composes\s+`next-step-selection`/);
  assert.match(entry, /No invented graph/);
  assert.match(entry, /No readiness promotion/);
  assert.match(entry, /No false implementation readiness/);
  assert.match(entry, /Local implementation only/);
  assert.match(analysis, /Dependency gating is not priority/);
  assert.match(analysis, /Operational readiness gating is not dependency topology/);
  assert.match(analysis, /matching foundation record is a citation/i);
  assert.match(analysis, /absent required repository baseline/i);
  assert.match(analysis, /does not invoke or duplicate next-step-selection/);
});

test('the package carries plain human intent and local implementation', () => {
  const intent = read('chart-a-course/intent.md');

  assert.match(intent, /^# Intent: chart-a-course\s*$/m);
  assert.ok(!intent.startsWith('---'));
  assert.match(intent.replace(/\s+/g, ' '), /bounded body of work/);
  assert.match(intent.replace(/\s+/g, ' '), /must not manufacture dependency edges/);
  assert.match(intent.replace(/\s+/g, ' '), /operational readiness prerequisites/);
  assert.match(intent.replace(/\s+/g, ' '), /requires human confirmation/);
  assert.match(intent.replace(/\s+/g, ' '), /does not invoke or reproduce next-step-selection/);
  assert.ok(fs.existsSync(path.join(
    SKILLS_ROOT,
    'chart-a-course',
    '_atoms',
    'course-analysis',
    'course-analysis.mjs',
  )));
  assert.ok(!fs.existsSync(path.join(SKILLS_ROOT, '_base', '_atoms', 'chart-a-course')));
});

test('the workflow registers all chart-a-course suites explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/chart-a-course\/chart-a-course\.conformance\.test\.mjs/);
  assert.match(workflow, /skills\/chart-a-course\/_atoms\/graph-normalization\/graph-normalization\.test\.mjs/);
  assert.match(workflow, /skills\/chart-a-course\/_atoms\/course-analysis\/course-analysis\.test\.mjs/);
});
