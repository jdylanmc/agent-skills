import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { EVIDENCE_KINDS } from './_atoms/traceability-map/traceability-map.mjs';
import { PRODUCER_KINDS } from './_atoms/execution-constraints/execution-constraints.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'qa-design/SKILL.md';
const PINNED_TOOLS = ['execute', 'read', 'search'];
const ATOMS = [
  'qa-design/_atoms/behavior-rules/behavior-rules.md',
  'qa-design/_atoms/gherkin-design/gherkin-design.md',
  'qa-design/_atoms/procedure-design/procedure-design.md',
  'qa-design/_atoms/deterministic-checks/deterministic-checks.md',
  'qa-design/_atoms/execution-constraints/execution-constraints.md',
  'qa-design/_atoms/traceability-map/traceability-map.md',
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

function firstColumnValues(relativePath) {
  return read(relativePath)
    .split('\n')
    .filter((line) => /^\| `[^`]+` \|/.test(line))
    .map((line) => line.match(/^\| `([^`]+)` \|/)[1]);
}

test('qa-design is discoverable, user-invocable, and pinned to a read-only grant', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'qa-design');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description names the design job and refuses the execution jobs', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /Design how a specified feature will be proven, before it is built/);
  assert.match(description, /acceptance criteria/);
  assert.match(description, /Gherkin scenarios/);
  assert.match(description, /system-test procedures/);
  assert.match(description, /traceability map/);
  assert.match(description, /known verification gaps/);
  assert.match(description, /Do not use to implement code/);
  assert.match(description, /execute scenarios or procedures/);
  assert.match(description, /decide whether a delivered system passes/);
});

test('the skill composes chronicler and the QA contract molecule', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'qa-design/_molecules/qa-contract/qa-contract.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of ['qa-design/_molecules/qa-contract/qa-contract.md', ...ATOMS]) {
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

test('the package composes no unit owned by another skill', () => {
  const foreign = [];
  for (const relativePath of [ENTRY, 'qa-design/_molecules/qa-contract/qa-contract.md', ...ATOMS]) {
    for (const target of frontmatter(relativePath).composes ?? []) {
      if (!target.startsWith('qa-design/') && !target.startsWith('_base/')) {
        foreign.push(`${relativePath} -> ${target}`);
      }
    }
  }

  assert.deepEqual(foreign, []);
});

test('the output contract reports a status, the design, and what it could not prove', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /`status`: `designed`, `gaps`, `inconsistent`, or `underspecified`/);
  assert.match(entry, /the verification level selected for each rule, and why a larger level was rejected/);
  assert.match(entry, /executable coverage explicitly `unknown`/);
  assert.match(entry, /marked authorization-required actions/);
  assert.match(entry, /the pairs that must never run concurrently and why/);
  assert.match(entry, /the report identities each producer must later carry/);
  assert.match(entry, /known verification gaps, each with a reason and what would make it provable/);
  assert.match(entry, /unresolved specification questions and testability findings/);
});

test('the contract reports designed only when its parts reconcile', () => {
  const molecule = flat('qa-design/_molecules/qa-contract/qa-contract.md');

  assert.match(molecule, /A contract never reports `designed` because its parts were produced\. It reports `designed` because its parts reconcile/);
  assert.match(molecule, /Stop here when the specification does not state decidable behavior/);
  assert.match(molecule, /Return `underspecified` with the exact questions/);
});

test('the package refuses implementation, execution, adjudication, and scheduling', () => {
  const entry = flat(ENTRY);
  const molecule = flat('qa-design/_molecules/qa-contract/qa-contract.md');

  assert.match(entry, /\*\*Designs proof, never produces it\.\*\*/);
  assert.match(entry, /No production code, step definitions, fixtures, adapters, user-interface automation, or runner configuration/);
  assert.match(entry, /\*\*Does not adjudicate quality\.\*\* Whether a delivered system passes is decided after implementation/);
  assert.match(entry, /This skill does not review a candidate, weigh competing verdicts, or issue a pass/);
  assert.match(entry, /\*\*Does not schedule\.\*\*/);
  assert.match(entry, /\*\*Does not invent a threshold\.\*\*/);
  assert.match(entry, /\*\*Does not force a level\.\*\*/);
  assert.match(entry, /\*\*Does not treat linkage as coverage\.\*\*/);
  assert.match(entry, /it does not rewrite the requirement to make it easier to prove/);
  assert.match(molecule, /It does not judge quality/);
  assert.match(molecule, /It does not schedule/);
});

test('the downstream handoff names each consumer and what this skill still refuses', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /\| Implementation \| Rules, acceptance criteria, scenarios, procedures, traceability \| Write production code, step definitions, fixtures, or automation \|/);
  assert.match(entry, /\| Cucumber execution \| Gherkin feature text, scenario identities, execution constraints \| Run scenarios, bind steps, or configure a runner \|/);
  assert.match(entry, /\| QA procedure execution \| Procedures, authorization marks, constraints, report identities \| Open the application, select an adapter, or capture evidence \|/);
  assert.match(entry, /\| QA analysis \| Traceability map, deterministic checks, gaps, report identities \| Interpret evidence or decide what a result means \|/);
  assert.match(entry, /evidence from two builds is never merged by accident/);
  assert.match(entry, /This skill hands the contract back to its caller and invokes none of them/);
  assert.match(entry, /does not assume a Cucumber, QA procedure, or QA analysis skill exists in this repository yet/);
});

test('the verification levels stay aligned with the evidence kinds the helpers accept', () => {
  const levels = firstColumnValues('qa-design/_atoms/behavior-rules/behavior-rules.md')
    .filter((value) => EVIDENCE_KINDS.includes(value));

  assert.deepEqual([...levels].sort(), [...EVIDENCE_KINDS].sort());
  assert.deepEqual(
    PRODUCER_KINDS,
    EVIDENCE_KINDS.filter((kind) => kind !== 'example-rule'),
  );
  assert.match(
    flat('qa-design/_atoms/execution-constraints/execution-constraints.md'),
    /An `example-rule` is not one/,
  );
});

test('the example classes required of every rule are all present', () => {
  const classes = firstColumnValues('qa-design/_atoms/behavior-rules/behavior-rules.md');

  for (const example of ['success', 'failure', 'boundary', 'permission', 'recovery', 'state-transition']) {
    assert.ok(classes.includes(example), `behavior-rules must enumerate the ${example} example class`);
  }
  assert.match(
    flat('qa-design/_atoms/behavior-rules/behavior-rules.md'),
    /A class that does not apply is recorded as `not-applicable` with a reason/,
  );
});

test('Gherkin design keeps parsing separate from executable coverage', () => {
  const atom = flat('qa-design/_atoms/gherkin-design/gherkin-design.md');

  assert.match(atom, /Parsing Is Not Coverage/);
  assert.match(atom, /Every report carries `coverage.executable: unknown`/);
  assert.match(atom, /executing them belongs to the Cucumber capability after implementation/);
  assert.match(atom, /It does not write step definitions, fixtures, runner configuration, or product code/);
});

test('procedure design stays black box and separates authoring from execution', () => {
  const atom = flat('qa-design/_atoms/procedure-design/procedure-design.md');
  const sections = firstColumnValues('qa-design/_atoms/procedure-design/procedure-design.md');

  assert.match(atom, /Do not write a step that reads internal state, calls a private interface, edits storage directly, or flips a hidden switch/);
  assert.match(atom, /Authoring Is Not Execution/);
  assert.match(atom, /Execution belongs to the QA procedure capability/);
  assert.match(atom, /destructive, externally visible, production-affecting, purchasing, notifying, or account-changing/);
  for (const section of ['identity', 'target-surface', 'prerequisites', 'required-data', 'actions', 'checkpoints', 'expected-results', 'cleanup', 'pass-fail']) {
    assert.ok(sections.includes(section), `procedure-design must require the ${section} section`);
  }
});

test('deterministic checks are adopted, never invented', () => {
  const atom = flat('qa-design/_atoms/deterministic-checks/deterministic-checks.md');
  const dispositions = firstColumnValues('qa-design/_atoms/deterministic-checks/deterministic-checks.md');

  assert.match(atom, /Never Invent a Threshold/);
  assert.match(atom, /A number that nobody adopted is worse than no number/);
  for (const disposition of ['adopted', 'adopted-without-threshold', 'stated-for-this-feature', 'not-adopted']) {
    assert.ok(dispositions.includes(disposition), `deterministic-checks must define the ${disposition} disposition`);
  }
});

test('execution constraints are declared for an orchestrator and never scheduled here', () => {
  const atom = flat('qa-design/_atoms/execution-constraints/execution-constraints.md');

  assert.match(atom, /Constraints, Not a Schedule/);
  assert.match(atom, /`scheduling.schedule` is always null/);
  assert.match(atom, /cannot parallelize two state-conflicting proofs merely because it had the capacity to/);
  assert.match(atom, /An empty list is a declaration\. An absent field is an omission/);
  assert.match(atom, /This atom does not schedule, dispatch, parallelize, execute, cancel, or budget anything/);
});

test('the traceability map never passes itself off as coverage', () => {
  const atom = flat('qa-design/_atoms/traceability-map/traceability-map.md');

  assert.match(atom, /A Row Is Not Proof/);
  assert.match(atom, /It is not evidence that the check was written, that it runs, that it binds to anything, or that it passes/);
  assert.match(atom, /An uncovered requirement with no declared gap raises `undeclared-gap`/);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'qa-design', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: qa-design\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /how the required behavior will be proven/);
  assert.match(normalized, /without inventing thresholds nobody agreed to/);
  assert.match(normalized, /a scenario that parses is not a scenario that runs/);
  assert.match(normalized, /Writing a procedure and running one are separate jobs/);
  assert.match(normalized, /a row is linkage, and linkage is not evidence that the thing it points at exists or passes/);
  assert.match(normalized, /Nor is it the arbiter of whether a delivered system is good enough/);
});

test('the workflow registers every qa-design test file explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  for (const testFile of [
    'skills/qa-design/qa-design.conformance.test.mjs',
    'skills/qa-design/_atoms/gherkin-design/gherkin-design.test.mjs',
    'skills/qa-design/_atoms/traceability-map/traceability-map.test.mjs',
    'skills/qa-design/_atoms/execution-constraints/execution-constraints.test.mjs',
  ]) {
    assert.ok(workflow.includes(testFile), `missing from validate-skills.yml: ${testFile}`);
  }
});
