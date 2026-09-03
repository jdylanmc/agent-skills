import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import {
  CORRECTION_STRATEGIES,
  HUMAN_DECISIONS,
  PARENT_DIRECTIVES,
  RELATIONAL_RULES,
  REPORT_STATUSES,
  SEVERITIES,
  SLOP_CATEGORIES,
} from './_atoms/report-contract/report-contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = path.join(ROOT, 'skills');
const ENTRY = 'slop-sniper/SKILL.md';
const MOLECULE = 'slop-sniper/_molecules/orchestration-audit/orchestration-audit.md';
const AGENT = path.join(ROOT, 'agents', 'slop-sniper.agent.md');
const PINNED_TOOLS = ['execute', 'read', 'task'];

function read(relative) {
  return fs.readFileSync(path.join(SKILLS, ...relative.split('/')), 'utf8');
}

function frontmatter(relative) {
  return readFrontmatter(read(relative), relative);
}

function flatFile(file) {
  return fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ');
}

test('is human-routable, model-disabled, and specific to bounded orchestration audits', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'slop-sniper');
  assert.equal(parsed.disableModelInvocation, true);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.match(parsed.description, /one bounded snapshot/);
  assert.match(parsed.description, /explicitly invoked orchestrator/);
  assert.match(parsed.description, /Do not use for code review/);
  assert.match(parsed.description, /continuous monitoring/);
});

test('grants only validation, fixed-agent read, fresh dispatch, and chronicling tools', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('search'));
  assert.ok(!parsed.allowedTools.includes('*'));

  const derived = deriveGraph(ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual([...required].sort(), ['execute', 'task']);
  assert.ok(
    PINNED_TOOLS.includes('read'),
    'the wrapper deliberately grants read for the two fixed prompt materials',
  );
  assert.deepEqual(derived.grantViolations, []);
});

test('keeps one thin wrapper and one focused local molecule over two trust-boundary atoms', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'slop-sniper/_molecules/orchestration-audit/orchestration-audit.md',
  ]);
  assert.deepEqual(frontmatter(MOLECULE).composes, [
    '_base/_atoms/agent-spawn/agent-spawn.md',
    'slop-sniper/_atoms/snapshot-contract/snapshot-contract.md',
    'slop-sniper/_atoms/report-contract/report-contract.md',
  ]);

  const closure = closureFor(validateRepository(ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    '_base/_atoms/agent-spawn/agent-spawn.md',
    'slop-sniper/_atoms/snapshot-contract/snapshot-contract.md',
    'slop-sniper/_atoms/report-contract/report-contract.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
  assert.ok(!closure.some((unit) => unit.startsWith('ship-with-squadron/')));
  assert.ok(!closure.some((unit) => unit.startsWith('post-mortem/')));
  assert.ok(!closure.some((unit) => unit.startsWith('ship/')));
});

test('the dedicated specialist is no-tools, non-routable, read-only, and parent-owned', () => {
  const agent = fs.readFileSync(AGENT, 'utf8');
  assert.match(agent, /^tools: \[\]$/m);
  assert.match(agent, /^disable-model-invocation: true$/m);
  assert.match(agent, /^user-invocable: false$/m);
  const flat = agent.replace(/\s+/g, ' ');
  assert.match(flat, /You have no tools and take no action/);
  assert.match(flat, /All directives are addressed to the parent/);
  assert.match(flat, /No direct or automatic remediation/);
  assert.match(flat, /No second-fleet ownership/);
});

test('the closed taxonomy and correction strategies are fully taught without a catch-all', () => {
  const reportContractPath = path.join(
    SKILLS,
    'slop-sniper',
    '_atoms',
    'report-contract',
    'report-contract.md',
  );
  const schemaPath = path.join(
    SKILLS,
    'slop-sniper',
    '_atoms',
    'report-contract',
    'report-contract.schema.json',
  );
  const reportContract = flatFile(reportContractPath);
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const agent = flatFile(AGENT);
  assert.deepEqual(schema.$defs.category.enum, SLOP_CATEGORIES);
  assert.deepEqual(schema.$defs.correctionStrategy.enum, CORRECTION_STRATEGIES);
  assert.deepEqual(schema.$defs.parentDirectiveAction.enum, PARENT_DIRECTIVES);
  assert.deepEqual(schema.$defs.humanDecision.enum, HUMAN_DECISIONS);
  assert.deepEqual(schema.$defs.severity.enum, SEVERITIES);
  assert.deepEqual(schema.$defs.reportStatus.enum, REPORT_STATUSES);
  assert.equal(schema['x-maxUtf8Bytes'], 512 * 1024);
  assert.deepEqual(Object.keys(schema['x-categoryEvidenceRules']), SLOP_CATEGORIES);
  assert.ok(schema['x-outcomeRules'].strategyStatuses);
  assert.ok(schema['x-outcomeRules'].humanDecisions);
  assert.doesNotMatch(reportContract, /other-observed-process-defect/);
  assert.match(reportContract, /catch-all category was deliberately removed/);
  assert.match(reportContract, /remains a non-finding until a human revises the taxonomy/);
  assert.match(agent, /canonical report schema verbatim/);
  assert.match(agent, /unsupported concern is a non-finding/);
  assert.match(agent, /mandatory `x-/);
});

test('the authoritative prompt supplies exact bound materials and sealed snapshot', () => {
  const entry = read(ENTRY).replace(/\s+/g, ' ');
  const molecule = read(MOLECULE).replace(/\s+/g, ' ');
  assert.match(entry, /At the wrapper boundary, read the exact UTF-8 bytes/);
  assert.match(entry, /Stop as `invalid-specialist-materials` on any mismatch/);
  assert.match(molecule, /Do not read a repository path/);
  assert.match(molecule, /entire sealed snapshot JSON, unchanged/);
  assert.match(molecule, /entire canonical report schema JSON, unchanged and verbatim/);
  assert.match(molecule, /never summarizes, reconstructs, or supplies only a link/);
  assert.match(
    molecule,
    /every standard keyword, conditional, `\$comment`, description, and `x-` annotation.*binding/,
  );
  assert.match(molecule, /same prompt-material binding used at dispatch/);
});

test('the supplied schema discloses every remaining relational rejection rule', () => {
  const schemaPath = path.join(
    SKILLS,
    'slop-sniper',
    '_atoms',
    'report-contract',
    'report-contract.schema.json',
  );
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  assert.equal(RELATIONAL_RULES.highConfidenceEvidenceCompleteness, 'complete');
  assert.equal(RELATIONAL_RULES.correctionFindingIds, 'exactly-all-findings');
  assert.deepEqual(RELATIONAL_RULES.directiveTargetSources, [
    'referenced-finding-affected-work',
    'current-work-inventory',
  ]);
  assert.match(schema.$defs.finding.$comment, /high.*complete/i);
  assert.match(schema.$defs.correction.properties.findingIds.$comment, /all and only/i);
  assert.match(schema.$defs.parentDirective.properties.targets.$comment, /work identity/i);
  assert.equal(
    schema.$defs.finding.allOf[0].else.properties.privacyHandling.const,
    'not-applicable',
  );
});

test('the audit is event-driven and cannot become a polling daemon', () => {
  const entry = read(ENTRY).replace(/\s+/g, ' ');
  const molecule = read(MOLECULE).replace(/\s+/g, ' ');
  assert.match(entry, /documented event or checkpoint/);
  assert.match(entry, /never model-routed automatically, resident, scheduled, or polling/);
  assert.match(molecule, /One event produces one snapshot and one audit/);
  assert.match(molecule, /Do not run after every tool call, sleep, watch, schedule a recurrence, or poll/);
});

test('the specialist distinguishes evidence-backed slop from legitimate work', () => {
  const agent = flatFile(AGENT);
  for (const phrase of [
    'Parallel work is legitimate',
    'activity intervals do not overlap',
    'began before and remained active after',
    'resource-specific observation kind',
    'evidence-producing retry',
    'Necessary architecture',
    'Unobservable claims are unverified',
    'second concrete consumer',
    'measured baseline',
    'human-owned',
    'private-context values',
  ]) {
    assert.match(agent, new RegExp(phrase));
  }
});

test('every new suite is registered in the validation workflow', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'validate-skills.yml'), 'utf8');
  const expected = [
    'skills/slop-sniper/_atoms/snapshot-contract/snapshot-contract.test.mjs',
    'skills/slop-sniper/_atoms/snapshot-contract/snapshot-contract.adversarial.test.mjs',
    'skills/slop-sniper/_atoms/report-contract/report-contract.test.mjs',
    'skills/slop-sniper/_atoms/report-contract/report-contract.adversarial.test.mjs',
    'skills/slop-sniper/slop-sniper.conformance.test.mjs',
  ];
  for (const file of expected) assert.match(workflow, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
