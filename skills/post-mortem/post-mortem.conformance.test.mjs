import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'post-mortem/SKILL.md';
const PINNED_TOOLS = ['execute', 'read', 'search'];

const MOLECULES = [
  'post-mortem/_molecules/evidence-assemble/evidence-assemble.md',
  'post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md',
  'post-mortem/_molecules/postmortem-diagnose-session/postmortem-diagnose-session.md',
  'post-mortem/_molecules/postmortem-propose-reinforcement/postmortem-propose-reinforcement.md',
];

const ATOMS = [
  'post-mortem/_atoms/evidence-scope-session/evidence-scope-session.md',
  'post-mortem/_atoms/copilot-session-events/copilot-session-events.md',
  'post-mortem/_atoms/evidence-redact-untrusted/evidence-redact-untrusted.md',
  'post-mortem/_atoms/evidence-anchor-ledger/evidence-anchor-ledger.md',
  'post-mortem/_atoms/session-classify-outcome/session-classify-outcome.md',
  'post-mortem/_atoms/friction-detect-signals/friction-detect-signals.md',
  'post-mortem/_atoms/gap-classify-taxonomy/gap-classify-taxonomy.md',
  'post-mortem/_atoms/hypothesis-form-root-cause/hypothesis-form-root-cause.md',
  'post-mortem/_atoms/candidate-gate-retention/candidate-gate-retention.md',
  'post-mortem/_atoms/lesson-propose-testable/lesson-propose-testable.md',
  'post-mortem/_atoms/reinforcement-assign-state/reinforcement-assign-state.md',
  'post-mortem/_atoms/postmortem-render-record/postmortem-render-record.md',
  'post-mortem/_atoms/postmortem-regression-check/postmortem-regression-check.md',
];

/**
 * The record schema is a contract, not a preference. Two post-mortems are only
 * comparable when they carry the same keys in the same order, so the schema is
 * pinned here and a revision that reorders or drops a key has to say so.
 */
const SCHEMA_KEYS = [
  'evidence_ledger',
  'session_summary',
  'session_metrics',
  'root_cause_hypotheses',
  'friction_signals',
  'identified_gaps',
  'candidate_skills',
  'skill_improvements',
  'candidate_lessons',
  'reinforcement_opportunities',
  'validation_requirements',
  'promotion_recommendations',
  'positive_patterns_to_preserve',
  'limitations',
  'changes_applied',
  'learning_recorded',
];

const REGRESSION_SCENARIOS = [
  '1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.', '8a.', '8b.', '9.', '10.',
];

const FINAL_QUESTION =
  'What should be reinforced, what should be measured, and what should become a reusable capability?';

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

function schemaBlock() {
  const body = read('post-mortem/_atoms/postmortem-render-record/postmortem-render-record.md');
  const match = /```yaml\n([\s\S]*?)```/.exec(body);
  assert.ok(match, 'the record atom must carry one fenced YAML schema');
  return match[1];
}

test('post-mortem is discoverable, user-invocable, and pinned to a read-only grant', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'post-mortem');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description names the retrospective job and refuses the adjacent ones', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /read-only, evidence-anchored post-mortem/);
  assert.match(description, /Copilot session event log/);
  assert.match(description, /Skill Run Log/);
  assert.match(description, /explicitly selects/);
  assert.match(description, /Do not use for incident, outage, or production-failure reviews/);
  assert.match(description, /team or sprint retrospectives/);
  assert.match(description, /unsolicited cross-session analytics/);
  assert.match(description, /apply skill, memory, or instruction changes/);
});

test('the skill composes chronicler and reaches every unit in the package', () => {
  const parsed = frontmatter(ENTRY);
  assert.ok(parsed.composes.includes('_base/_molecules/chronicler/chronicler.md'));

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [...MOLECULES, ...ATOMS]) {
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
  for (const relativePath of [ENTRY, ...MOLECULES, ...ATOMS]) {
    for (const target of frontmatter(relativePath).composes ?? []) {
      if (!target.startsWith('post-mortem/') && !target.startsWith('_base/')) {
        foreign.push(`${relativePath} -> ${target}`);
      }
    }
  }

  assert.deepEqual(foreign, []);
});

test('the fixed record schema keeps every key, in order', () => {
  const schema = schemaBlock();
  const keys = schema
    .split('\n')
    .filter((line) => /^[a-z_]+:/.test(line))
    .map((line) => line.split(':')[0]);

  assert.deepEqual(keys, SCHEMA_KEYS);
});

test('the record can never carry a promotion, an applied change, or recorded learning', () => {
  const schema = schemaBlock();

  assert.match(schema, /ready_for_promotion: \[\]/);
  assert.match(schema, /changes_applied: false/);
  assert.match(schema, /learning_recorded: false/);
  assert.match(schema, /status: PROPOSED \| OBSERVED/);
  assert.doesNotMatch(schema, /VALIDATED/);
  assert.doesNotMatch(schema, /PROMOTED/);
});

test('the record ends with the required question, verbatim', () => {
  const body = read('post-mortem/_atoms/postmortem-render-record/postmortem-render-record.md');

  assert.ok(body.includes(`\`${FINAL_QUESTION}\``));
  assert.match(body, /Do not add content after the question\./);
});

test('all twelve regression scenarios survive, including 8a and 8b', () => {
  const body = read('post-mortem/_atoms/postmortem-regression-check/postmortem-regression-check.md');
  const numbered = [...body.matchAll(/^(\d+[ab]?)\.\s/gm)].map((match) => `${match[1]}.`);

  assert.deepEqual(numbered, REGRESSION_SCENARIOS);

  const flattened = body.replace(/\s+/g, ' ');
  assert.match(flattened, /no_material_finding: true/);
  assert.match(flattened, /evidence_completeness: compacted/);
  assert.match(flattened, /quarantined_untrusted_directives/);
  assert.match(
    flattened,
    /A single selected Skill Run Log, or no selected log at all, must leave every candidate `PROPOSED`/,
  );
  assert.match(flattened, /Repetition inside one run is never recurrence/);
});

test('the lifecycle stops at OBSERVED and never writes anything durable', () => {
  const lifecycle = flat('post-mortem/_atoms/reinforcement-assign-state/reinforcement-assign-state.md');

  assert.match(lifecycle, /It can never mark a candidate `VALIDATED` or `PROMOTED`/);
  assert.match(lifecycle, /`promotion_recommendations.ready_for_promotion` is \*\*always\*\* empty/);
  assert.match(lifecycle, /human_approval_required: true/);
  assert.match(lifecycle, /Nothing durable is written, applied, or promoted/);
});

test('the skill states its read-only boundary and invokes nothing afterwards', () => {
  const skill = flat(ENTRY);

  assert.match(skill, /No file is edited, no memory is written, no instruction is changed/);
  assert.match(skill, /no follow-up skill or agent is invoked/);
  assert.match(skill, /`ready_for_promotion` is always empty/);
  assert.match(skill, /the package grants no `edit` and no `task`/);
});

test('every evidence source beyond the visible session is explicitly selected', () => {
  const skill = flat(ENTRY);
  const reader = flat('post-mortem/_atoms/copilot-session-events/copilot-session-events.md');
  const runlog = flat('post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md');
  const scope = flat('post-mortem/_atoms/evidence-scope-session/evidence-scope-session.md');

  assert.match(skill, /Prior sessions are never searched, the newest log is never inferred/);
  assert.match(reader, /It does not list a directory, expand a pattern, sort by modification time/);
  assert.match(runlog, /Never infer a run from the newest file/);
  assert.match(scope, /Never search for a log, never resolve the newest file/);
});

test('raw and curated evidence compose without either inheriting the other authority', () => {
  const skill = flat(ENTRY);
  const runlog = flat('post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md');
  const reader = flat('post-mortem/_atoms/copilot-session-events/copilot-session-events.md');

  assert.match(skill, /Two Evidence Sources, One Ledger/);
  assert.match(skill, /Authoritative about/);
  assert.match(skill, /Absence never becomes evidence/);
  assert.match(runlog, /neither is derived from the other/);
  assert.match(
    runlog,
    /The absence of a Skill Run Log is not evidence of a missing invocation/,
  );
  assert.match(
    reader,
    /it is not evidence that a skill failed to run/,
  );
});

test('each evidence source owns a distinct anchor series', () => {
  const ledger = flat('post-mortem/_atoms/evidence-anchor-ledger/evidence-anchor-ledger.md');

  assert.match(ledger, /`E12`/);
  assert.match(ledger, /`L1:12`/);
  assert.match(ledger, /never collide with session or Skill Run Log anchors/);
});

test('the session-event reader is composed by the evidence molecule and grants only execute', () => {
  const assemble = frontmatter('post-mortem/_molecules/evidence-assemble/evidence-assemble.md');
  const reader = frontmatter('post-mortem/_atoms/copilot-session-events/copilot-session-events.md');

  assert.ok(
    assemble.composes.includes('post-mortem/_atoms/copilot-session-events/copilot-session-events.md'),
  );
  assert.deepEqual(reader.allowedTools, ['execute']);
  assert.deepEqual(reader.composes, []);
  assert.deepEqual(reader.includes, [
    'post-mortem/_atoms/copilot-session-events/copilot-session-events.mjs',
  ]);
});

test('the package intent states the analyze-recommend-apply-nothing boundary', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'post-mortem', 'intent.md'), 'utf8');

  assert.ok(!intent.startsWith('---'));
  assert.match(intent, /^# Intent: post-mortem$/m);
  assert.match(intent, /Analyze the logs,\s*make recommendations, apply nothing/);
  assert.match(intent, /It cannot be declared\s*validated or adopted here, ever/);
});
