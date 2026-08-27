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
  'post-mortem/_atoms/session-evidence-adapter/session-evidence-adapter.md',
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

/** Adapters are implementations behind the seam, not steps in the workflow. */
const PROVIDER_ADAPTERS = ['post-mortem/_atoms/copilot-session-events/copilot-session-events.md'];

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

/** The body of one `##` section, so a scoped rule can be checked in isolation. */
function sectionOf(relativePath, heading) {
  const body = read(relativePath);
  const start = body.indexOf(`## ${heading}\n`);
  assert.notEqual(start, -1, `${relativePath} must have a "${heading}" section`);
  const rest = body.slice(start + heading.length + 4);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
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
  assert.match(description, /the runtime's own session log/);
  assert.match(description, /when the harness is supported/);
  assert.match(description, /its identity can be proved/);
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

test('no evidence source beyond the visible session is admitted without proved identity', () => {
  const skill = flat(ENTRY);
  const reader = flat('post-mortem/_atoms/copilot-session-events/copilot-session-events.md');
  const runlog = flat('post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md');
  const scope = flat('post-mortem/_atoms/evidence-scope-session/evidence-scope-session.md');

  assert.match(skill, /Identity is proved, never inferred/);
  assert.match(skill, /Identity before evidence, and failure is closed/);
  assert.match(reader, /Identity Is Proved, and Failure Is Closed/);
  assert.match(reader, /the newest file is never the answer/);
  assert.match(runlog, /Never infer a run from the newest file/);
  assert.match(scope, /Never resolve the newest file, never break a tie between two possible sessions/);
});

test('the identity ladder and its refusals are documented as a fail-closed rule', () => {
  const reader = flat('post-mortem/_atoms/copilot-session-events/copilot-session-events.md');
  const assemble = flat('post-mortem/_molecules/evidence-assemble/evidence-assemble.md');

  for (const kind of [
    'explicit-path',
    'runtime-transcript',
    'session-id',
    'live-process-lock',
    'sole-live-session',
  ]) {
    assert.match(reader, new RegExp(`\`${kind}\``));
  }
  for (const refusal of [
    'session_identity_ambiguous',
    'session_identity_unavailable',
    'session_root_unknown',
    'session_id_not_found',
    'runtime_transcript_missing',
  ]) {
    assert.match(reader, new RegExp(`\`${refusal}\``));
  }

  assert.match(reader, /Ambiguity refuses\. Two possible current sessions produce no reading at all/);
  assert.match(
    assemble,
    /A refused identity - ambiguous, absent, or unreadable - and an unsupported harness are recorded under limitations/,
  );
  assert.match(assemble, /continues on the visible session alone rather than settling the ambiguity/);
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
  const seam = frontmatter('post-mortem/_atoms/session-evidence-adapter/session-evidence-adapter.md');

  assert.ok(
    assemble.composes.includes('post-mortem/_atoms/session-evidence-adapter/session-evidence-adapter.md'),
  );
  // The workflow composes the seam and nothing behind it. An adapter is reached
  // through the seam's own registry, so registering another one changes no
  // molecule and widens no skill.
  assert.ok(
    !assemble.composes.some((target) => PROVIDER_ADAPTERS.includes(target)),
    'no molecule composes a provider adapter directly',
  );
  assert.deepEqual(reader.usedBy, [], 'an adapter is used by the seam in code, not in the unit graph');
  assert.deepEqual(reader.allowedTools, ['execute']);
  assert.deepEqual(reader.composes, []);
  assert.deepEqual(reader.includes, [
    'post-mortem/_atoms/copilot-session-events/copilot-session-events.mjs',
  ]);
  assert.deepEqual(seam.allowedTools, ['execute']);
  assert.deepEqual(seam.composes, []);

  const seamSource = fs.readFileSync(
    path.join(SKILLS_ROOT, 'post-mortem', '_atoms', 'session-evidence-adapter', 'session-evidence-adapter.mjs'),
    'utf8',
  );
  assert.match(seamSource, /DEFAULT_ADAPTERS = \[COPILOT_ADAPTER\]/, 'registration lives in the seam');
});

test('the package is provider-neutral: one seam, one neutral vocabulary downstream', () => {
  const skill = flat(ENTRY);
  const seam = flat('post-mortem/_atoms/session-evidence-adapter/session-evidence-adapter.md');

  assert.match(skill, /One Post-Mortem, Any Harness/);
  assert.match(skill, /A harness's own event names never reach the analysis/);
  assert.match(seam, /The Common Evidence Ledger/);
  assert.match(seam, /Nothing downstream reads `provider_native`/);

  // No harness name or harness event vocabulary appears anywhere in the package
  // except inside a provider adapter, which is the one place it belongs. The
  // sweep is over the whole documentation surface rather than a hand-listed
  // subset, so a new unit cannot quietly reintroduce a vendor name.
  // The adapter itself, and the seam's registry section, are the two places a
  // harness may be named. Everywhere else in the package is neutral.
  // The adapter implementation and the seam's registry are the two places a
  // harness may be named; the sweep covers documents and implementation code
  // alike, so a vendor name cannot slip in through a module either.
  const adapterDirectories = ['_atoms/copilot-session-events'];
  const registryFile = '_atoms/session-evidence-adapter/session-evidence-adapter.md';
  const registryModule = '_atoms/session-evidence-adapter/session-evidence-adapter.mjs';
  const harnessTerms = ['Copilot', 'copilot', 'skill.invoked', 'tool.execution', 'events.jsonl', 'COPILOT_'];
  const packageRoot = path.join(SKILLS_ROOT, 'post-mortem');
  const offenders = [];
  const sweep = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(packageRoot, absolute).split(path.sep).join('/');
      if (adapterDirectories.some((adapter) => relative === adapter || relative.startsWith(`${adapter}/`))) {
        continue;
      }
      if (entry.isDirectory()) {
        sweep(absolute);
      } else if (
        (entry.name.endsWith('.md') || (entry.name.endsWith('.mjs') && !entry.name.includes('.test.')))
        && relative !== registryFile
      ) {
        let body = fs.readFileSync(absolute, 'utf8');
        if (relative === registryModule) {
          // The seam registers adapters, so its import and registry lines name
          // them. Every other line of it must be neutral.
          body = body
            .split('\n')
            .filter((line) => !/copilot-session-events|COPILOT_ADAPTER/.test(line))
            .join('\n');
        }
        for (const term of harnessTerms) {
          if (body.includes(term)) {
            offenders.push(`${relative}: ${term}`);
          }
        }
      }
    }
  };
  sweep(packageRoot);

  assert.deepEqual(offenders, [], `a harness name escaped its adapter: ${offenders.join(', ')}`);

  // And the seam names a harness only where it registers one.
  const registryUnit = `post-mortem/${registryFile}`;
  const registrySection = sectionOf(registryUnit, 'Provider Selection');
  const outsideRegistry = read(registryUnit).split(registrySection).join('');
  for (const term of harnessTerms) {
    assert.ok(
      !outsideRegistry.includes(term),
      `the seam may name ${term} only in its registry section`,
    );
  }
});

test('the lifecycle gate is executable, and stops at OBSERVED by construction', () => {
  const lifecycle = frontmatter('post-mortem/_atoms/reinforcement-assign-state/reinforcement-assign-state.md');

  assert.deepEqual(lifecycle.includes, [
    'post-mortem/_atoms/reinforcement-assign-state/reinforcement-assign-state.mjs',
  ]);
  assert.deepEqual(lifecycle.allowedTools, ['execute']);

  const source = fs.readFileSync(
    path.join(SKILLS_ROOT, 'post-mortem', '_atoms', 'reinforcement-assign-state', 'reinforcement-assign-state.mjs'),
    'utf8',
  );
  assert.match(source, /LIFECYCLE_STATES = \['PROPOSED', 'OBSERVED'\]/);
  assert.ok(!/status:\s*'(VALIDATED|PROMOTED)'/.test(source));
});

test('the run log records the session it ran inside, or says it could not', () => {
  const skill = flat(ENTRY);

  assert.match(skill, /Correlate the run log with the session it runs inside/);
  assert.match(skill, /`--harness <adapter identity>` and `--session <session identifier>`/);
  assert.match(skill, /report `Correlation: absent` with the reason from the seam/);
});

test('an unreadable harness becomes a PROPOSED adapter recommendation, applied by nobody', () => {
  const skill = flat(ENTRY);
  const seam = flat('post-mortem/_atoms/session-evidence-adapter/session-evidence-adapter.md');
  const propose = flat('post-mortem/_molecules/postmortem-propose-reinforcement/postmortem-propose-reinforcement.md');

  assert.match(skill, /An unrecognized harness is a stated gap, not a best effort/);
  assert.match(skill, /`unsupported_provider` limitation/);
  assert.match(skill, /a separate `reinforce-skill` run adds the adapter/);
  assert.match(skill, /never edits itself, never adds its own adapter, and never invokes reinforcement/);
  assert.match(seam, /There is no generic fallback parser, deliberately/);
  assert.match(seam, /`human_approval_required: true`/);
  assert.match(seam, /Self-modification is not a shortcut this seam is permitted to take/);
  assert.match(propose, /never adds a capability the analysis found missing/);
});

test('a Skill Run Log is correlated to session evidence by recorded identity', () => {
  const runlog = flat('post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md');
  const skill = flat(ENTRY);

  assert.match(runlog, /Correlate by recorded identity, never by proximity/);
  assert.match(runlog, /Two logs written around the same time are not thereby the same session/);
  assert.match(skill, /correlated by those identities, not by timestamps/);
});

test('the package intent states the analyze-recommend-apply-nothing boundary', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'post-mortem', 'intent.md'), 'utf8');

  assert.ok(!intent.startsWith('---'));
  assert.match(intent, /^# Intent: post-mortem$/m);
  assert.match(intent, /Analyze the logs,\s*make recommendations, apply nothing/);
  assert.match(intent, /It cannot be declared\s*validated or adopted here, ever/);
  assert.match(intent, /Be certain which session it is, or use none/);
});
