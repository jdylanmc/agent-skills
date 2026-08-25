import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import * as traceabilityHelper from './_atoms/traceability-map/traceability-map.mjs';
import * as constraintsHelper from './_atoms/execution-constraints/execution-constraints.mjs';
import * as gherkinHelper from './_atoms/gherkin-design/gherkin-design.mjs';
import * as contractHelper from './_molecules/qa-contract/qa-contract.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'qa-design/SKILL.md';
const MOLECULE = 'qa-design/_molecules/qa-contract/qa-contract.md';
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

function firstColumnValues(text) {
  return text
    .split('\n')
    .filter((line) => /^\| `[^`]+` \|/.test(line))
    .map((line) => line.match(/^\| `([^`]+)` \|/)[1]);
}

/** The rows of the tables under one `##` heading, so a drift check is scoped. */
function sectionOf(relativePath, heading) {
  const body = read(relativePath);
  const start = body.indexOf(`## ${heading}\n`);
  assert.notEqual(start, -1, `${relativePath} must have a "${heading}" section`);
  const rest = body.slice(start + heading.length + 4);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
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
  for (const unit of [MOLECULE, ...ATOMS]) {
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
  for (const relativePath of [ENTRY, MOLECULE, ...ATOMS]) {
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

  assert.match(entry, /`status`: `underspecified`, `inconsistent`, `unresolved`, `gaps`, or `designed`, resolved worst to best/);
  assert.match(entry, /the contract identity and revision/);
  assert.match(entry, /each applicable class worked into a concrete example with its own identity/);
  assert.match(entry, /the verification level selected for each rule, and why a larger level was rejected/);
  assert.match(entry, /executable coverage explicitly `unknown`/);
  assert.match(entry, /marked authorization-required actions/);
  assert.match(entry, /the pairs that must never run concurrently and why, producers that run alone/);
  assert.match(entry, /covered, partially covered, and uncovered requirements/);
  assert.match(entry, /the aspect it leaves unproven/);
  assert.match(entry, /unresolved specification questions and testability findings/);
});

test('the contract status is resolved from the parts, worst to best', () => {
  const molecule = flat(MOLECULE);
  const rows = firstColumnValues(sectionOf(MOLECULE, 'Status'));

  assert.deepEqual(rows, contractHelper.CONTRACT_STATUSES);
  assert.match(molecule, /A contract never reports `designed` because its parts were produced\. It reports `designed` because its parts reconcile/);
  assert.match(molecule, /A high Gherkin finding and an incomplete procedure are `unresolved` rather than `designed`/);
  assert.match(molecule, /Stop here when the specification does not state decidable behavior/);
  assert.match(molecule, /Return `underspecified` with the exact questions/);
});

test('a contract cannot report designed while a part is unfinished', () => {
  const parts = {
    contract: { id: 'refunds', revision: '3' },
    rules: [{ id: 'R1', decidable: true }],
    gherkin: { status: 'clean', findings: [], scenarios: [{ identity: 'refund-granted' }] },
    procedures: [{
      id: 'refund-through-the-app',
      revision: '1',
      sections: [...contractHelper.PROCEDURE_SECTIONS],
    }],
    traceability: {
      status: 'complete',
      findings: [],
      rows: [{ requirement: 'R1', evidence: ['refund-granted'] }],
    },
    constraints: {
      status: 'constrained',
      findings: [],
      producers: [
        { id: 'refund-granted', requirementIds: ['R1'], traceabilityIds: ['T1'] },
        { id: 'refund-through-the-app', requirementIds: ['R1'], traceabilityIds: ['T1'] },
      ],
    },
  };

  assert.equal(contractHelper.resolveContract(parts).status, 'designed');
  assert.equal(
    contractHelper.resolveContract({
      ...parts,
      gherkin: {
        ...parts.gherkin,
        status: 'findings',
        findings: [{ code: 'missing-then', severity: 'high', location: 'line 4', detail: 'no Then' }],
      },
    }).status,
    'unresolved',
  );
  assert.equal(
    contractHelper.resolveContract({
      ...parts,
      procedures: [{ ...parts.procedures[0], sections: ['identity'] }],
    }).status,
    'unresolved',
  );
});

test('every producer report identity carries the contract identity and revision', () => {
  const molecule = flat(MOLECULE);
  const entry = flat(ENTRY);

  assert.match(molecule, /Contract Identity/);
  assert.match(molecule, /the resolver refuses to run without both/);
  assert.match(entry, /alongside the contract identity and revision it was designed against/);
  assert.match(entry, /two contract revisions is never merged by accident/);
});

test('the package refuses implementation, execution, adjudication, and scheduling', () => {
  const entry = flat(ENTRY);
  const molecule = flat(MOLECULE);

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
  assert.match(entry, /This skill hands the contract back to its caller and invokes none of them/);
  assert.match(entry, /does not assume a Cucumber, QA procedure, or QA analysis skill exists in this repository yet/);
});

test('the verification levels stay aligned with the evidence kinds the helpers accept', () => {
  const levels = firstColumnValues(sectionOf('qa-design/_atoms/behavior-rules/behavior-rules.md', 'Verification Levels'));

  assert.deepEqual([...levels].sort(), [...traceabilityHelper.EVIDENCE_KINDS].sort());
  assert.deepEqual(
    constraintsHelper.PRODUCER_KINDS,
    traceabilityHelper.EVIDENCE_KINDS.filter((kind) => kind !== 'example-rule'),
  );
  assert.match(
    flat('qa-design/_atoms/execution-constraints/execution-constraints.md'),
    /An `example-rule` is not one/,
  );
});

test('every verification level has an owner, including example-rule', () => {
  const behaviorRules = flat('qa-design/_atoms/behavior-rules/behavior-rules.md');

  assert.match(behaviorRules, /This Atom Owns example-rule Evidence/);
  assert.match(behaviorRules, /the example's identity is the evidence identity the traceability map links/);
  assert.match(behaviorRules, /traced under the identity of the scenario or procedure that proves it instead/);
  assert.match(behaviorRules, /A level with no owner is worse than a missing level/);
});

test('every applicable example class is worked into a concrete example', () => {
  const classes = firstColumnValues(sectionOf('qa-design/_atoms/behavior-rules/behavior-rules.md', 'Example Classes'));
  const worked = firstColumnValues(sectionOf('qa-design/_atoms/behavior-rules/behavior-rules.md', 'Worked Examples'));
  const behaviorRules = flat('qa-design/_atoms/behavior-rules/behavior-rules.md');

  assert.deepEqual([...classes].sort(), [...traceabilityHelper.EXAMPLE_CLASSES].sort());
  assert.deepEqual(worked, ['identity', 'class', 'context', 'action', 'expected', 'level']);
  assert.match(behaviorRules, /A class name is not an example/);
  assert.match(behaviorRules, /A class that does not apply is recorded as `not-applicable` with a reason/);
});

test('Gherkin design keeps parsing separate from executable coverage', () => {
  const atom = flat('qa-design/_atoms/gherkin-design/gherkin-design.md');

  assert.match(atom, /Parsing Is Not Coverage/);
  assert.match(atom, /Every report carries `coverage.executable: unknown`/);
  assert.match(atom, /executing them belongs to the Cucumber capability after implementation/);
  assert.match(atom, /It does not write step definitions, fixtures, runner configuration, or product code/);
});

test('every scenario carries a name and a declared identity', () => {
  const atom = flat('qa-design/_atoms/gherkin-design/gherkin-design.md');

  assert.match(atom, /Scenario Identity/);
  assert.match(atom, /Declare the identity as an `@id:` tag/);
  assert.match(atom, /an identity that moved every time somebody improved a sentence would be no identity at all/);
  assert.match(atom, /`medium` when both carry distinct identities/);
  assert.match(atom, /matched on word boundaries rather than surrounding spaces/);
});

test('procedure design stays black box and separates authoring from execution', () => {
  const atom = flat('qa-design/_atoms/procedure-design/procedure-design.md');
  const sections = firstColumnValues(sectionOf('qa-design/_atoms/procedure-design/procedure-design.md', 'Required Sections'));

  assert.match(atom, /Do not write a step that reads internal state, calls a private interface, edits storage directly, or flips a hidden switch/);
  assert.match(atom, /Authoring Is Not Execution/);
  assert.match(atom, /Execution belongs to the QA procedure capability/);
  assert.match(atom, /destructive, externally visible, production-affecting, purchasing, notifying, or account-changing/);
  assert.deepEqual(sections, contractHelper.PROCEDURE_SECTIONS);
});

test('deterministic checks are adopted, never invented', () => {
  const atom = flat('qa-design/_atoms/deterministic-checks/deterministic-checks.md');
  const dispositions = firstColumnValues(sectionOf('qa-design/_atoms/deterministic-checks/deterministic-checks.md', 'Disposition'));

  assert.match(atom, /Never Invent a Threshold/);
  assert.match(atom, /A number that nobody adopted is worse than no number/);
  assert.deepEqual(dispositions, ['adopted', 'adopted-without-threshold', 'stated-for-this-feature', 'not-adopted']);
});

test('execution constraints are declared for an orchestrator and never scheduled here', () => {
  const atom = flat('qa-design/_atoms/execution-constraints/execution-constraints.md');

  assert.match(atom, /Constraints, Not a Schedule/);
  assert.match(atom, /`scheduling.schedule` is always null/);
  assert.match(atom, /cannot parallelize two state-conflicting proofs merely because it had the capacity to/);
  assert.match(atom, /An empty list is a declaration\. An absent field is an omission/);
  assert.match(atom, /This atom does not schedule, dispatch, parallelize, execute, cancel, or budget anything/);
});

test('running alone and needing an environment alone are documented as different declarations', () => {
  const atom = flat('qa-design/_atoms/execution-constraints/execution-constraints.md');

  assert.match(atom, /Isolation and Concurrency Are Different Questions/);
  assert.match(atom, /`concurrencySafe: false` \| Conflicts with every other producer, in any environment/);
  assert.match(atom, /never reports `parallel-safe` while any producer has declared itself serial or claimed an environment exclusively/);
  assert.match(atom, /a lone exclusive procedure still needs an environment held for it/);
});

test('the contract cross-checks its parts in both directions', () => {
  const molecule = flat(MOLECULE);
  const checks = firstColumnValues(sectionOf(MOLECULE, 'Cross-Checks'));

  assert.deepEqual(checks, [
    'rule-outside-map',
    'requirement-outside-rules',
    'producer-outside-contract',
    'scenario-without-producer',
    'procedure-without-producer',
  ]);
  assert.match(molecule, /compared in \*\*both\*\* directions, because one direction alone hides half of any disagreement/);
  assert.match(molecule, /Each is a contract that looks complete from whichever end you started at/);
});

test('a rule set and a map that disagree cannot resolve to designed', () => {
  const parts = {
    contract: { id: 'refunds', revision: '3' },
    rules: [{ id: 'R1', decidable: true }],
    gherkin: null,
    procedures: [],
    traceability: {
      status: 'complete',
      findings: [],
      rows: [{ requirement: 'R1', evidence: ['example-r1-success'] }],
    },
    constraints: { status: 'parallel-safe', findings: [], producers: [] },
  };

  assert.equal(contractHelper.resolveContract(parts).status, 'designed');
  assert.equal(
    contractHelper.resolveContract({
      ...parts,
      rules: [...parts.rules, { id: 'R2', decidable: true }],
    }).status,
    'inconsistent',
  );
  assert.equal(
    contractHelper.resolveContract({
      ...parts,
      traceability: {
        ...parts.traceability,
        rows: [...parts.traceability.rows, { requirement: 'R2', evidence: ['example-r2-success'] }],
      },
    }).status,
    'inconsistent',
  );
});

test('a parse code stops the Gherkin review, and tags are scoped where they are written', () => {
  const atom = flat('qa-design/_atoms/gherkin-design/gherkin-design.md');
  const rows = read('qa-design/_atoms/gherkin-design/gherkin-design.md')
    .split('\n')
    .find((line) => line.startsWith('| Parse |'));

  assert.ok(rows, 'the findings table must document the parse codes');
  assert.match(rows, /`malformed-tag-line`/);
  assert.match(atom, /A parse code stops the review/);
  assert.match(atom, /tags above the `Feature` belong to the feature, and tags above an `Examples` table belong to that table/);
});

test('the traceability map never passes itself off as coverage', () => {
  const atom = flat('qa-design/_atoms/traceability-map/traceability-map.md');

  assert.match(atom, /A Row Is Not Proof/);
  assert.match(atom, /It is not evidence that the check was written, that it runs, that it binds to anything, or that it passes/);
  assert.match(atom, /An uncovered requirement with no `whole-requirement` gap raises `undeclared-gap`/);
});

test('coverage is three-valued and a gap names the aspect it leaves unproven', () => {
  const atom = flat('qa-design/_atoms/traceability-map/traceability-map.md');
  const coverage = firstColumnValues(sectionOf('qa-design/_atoms/traceability-map/traceability-map.md', 'Coverage Is Three-Valued'));

  assert.deepEqual(coverage, ['covered', 'partiallyCovered', 'uncovered']);
  assert.match(atom, /Every gap names three things: the requirement, the \*\*aspect\*\* it leaves unproven, and the reason/);
  assert.match(atom, /Prefer the scoped forms/);
  assert.match(atom, /`whole-requirement` is the blunt instrument/);
});

test('every helper in the package uses the same exit-code contract', () => {
  const helpers = {
    'gherkin-design': gherkinHelper,
    'traceability-map': traceabilityHelper,
    'execution-constraints': constraintsHelper,
    'qa-contract': contractHelper,
  };

  for (const [name, helper] of Object.entries(helpers)) {
    assert.equal(helper.EXIT_ACCEPTED, 0, `${name} accepted code`);
    assert.equal(helper.EXIT_REFUSED, 1, `${name} refused code`);
    assert.equal(helper.EXIT_FINDINGS, 2, `${name} findings code`);
    assert.equal(helper.exitCodeFor({ findings: [] }), 0, `${name} exits 0 with no findings`);
    assert.equal(helper.exitCodeFor({ findings: [{ code: 'x' }] }), 2, `${name} exits 2 with findings`);
  }

  for (const atom of [
    'qa-design/_atoms/gherkin-design/gherkin-design.md',
    'qa-design/_atoms/traceability-map/traceability-map.md',
    'qa-design/_atoms/execution-constraints/execution-constraints.md',
  ]) {
    assert.match(flat(atom), /Every helper in this package uses the same three codes/, atom);
    assert.match(flat(atom), /The code reports findings, not disposition/, atom);
  }
});

/**
 * Structure only, deliberately.
 *
 * `intent.md` is human source in this repository, and the committed file is an
 * agent restatement of the issue awaiting the author's own words. Asserting its
 * phrasing here would quietly make an agent draft the standard a human rewrite
 * has to satisfy, which is the wrong way round. The repository-wide guards in
 * `scripts/skill-intent.test.mjs` and the roast intent screen still apply.
 */
test('the package carries a plain human-readable intent', () => {
  const intentPath = path.join(SKILLS_ROOT, 'qa-design', 'intent.md');
  const intent = fs.readFileSync(intentPath, 'utf8');

  assert.ok(!intent.startsWith('---'), 'an intent carries no frontmatter');
  assert.match(intent, /^# Intent: qa-design\s*$/m);
  assert.ok(
    intent.replace(/^# Intent: qa-design\s*$/m, '').trim().length > 0,
    'an intent says something',
  );
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
    'skills/qa-design/_molecules/qa-contract/qa-contract.test.mjs',
  ]) {
    assert.ok(workflow.includes(testFile), `missing from validate-skills.yml: ${testFile}`);
  }
});
