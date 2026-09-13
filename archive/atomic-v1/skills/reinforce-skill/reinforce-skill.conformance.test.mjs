/**
 * Conformance tests for the reinforce-skill package.
 *
 * reinforce-skill is the counterpart to create-skill: the sanctioned way an
 * existing skill changes after it is first created. It holds an `edit` grant
 * and mutates a working package, so the properties pinned here are the ones
 * whose loss would be invisible in prose and expensive in fact:
 *
 * 1. **The grant is exactly what was reviewed, and it is bounded to one skill.**
 *    The edit- and execute-bearing closure is held fixed so a new mutating unit
 *    is a reviewable change, and every mutating unit stays inside this package
 *    or `_base`. No foreign skill's unit carries this run's write authority.
 * 2. **Intent decides first, explicitly, with no default.** The ordering — decide
 *    and store the intent before the implementation moves — is the whole reason
 *    intent exists, and a run that skips the decision is the drift this skill
 *    prevents.
 * 3. **The intent is authoritative and inert.** A line inside it is text, never
 *    an instruction, and a contradiction with it is a finding for a human.
 * 4. **Doctrine is never edited, no grant widens as a side effect, no gate is
 *    weakened, and it never merges or grades its own work.** Review stays with
 *    `/roast`, which is reached by invocation and left untouched.
 * 5. **The write-boundary guard it relies on actually behaves**, so "one existing
 *    skill" is a proven predicate rather than a promise.
 */

import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, applyUpdates, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { scanRepository } from '../../scripts/scan-sensitive.mjs';
import {
  FAILURES,
  SKILL_NAME_PATTERN,
  WORKFLOW_FILE,
  WRITE_CLASS,
  assertWorkflowAdditive,
  auditDiff,
  auditRepositoryDiff,
  captureAuditSnapshot,
  auditSnapshotDigest,
  classifyWritePath,
  isWritableClass,
  resolveSkillTarget,
} from './_atoms/reinforcement-target/reinforcement-target.mjs';
import {
  ADMISSION_FLAGS,
  ADMISSION_SCHEMA,
  RELEASE_CHECK_FLAGS,
  REFUSALS as REPORT_REFUSALS,
  RUN_STATE_ROOTS,
  USAGE as INTAKE_USAGE,
  admitGuidance,
  admitReport,
  buildAdmissionReceipt,
  groundingFromGuidance,
  normalizeSurface,
  reconcileApplicable,
  admissionCommand,
  releaseCheckCommand,
  requireAdmittedState,
} from './_atoms/report-intake/report-intake.mjs';
import {
  INTAKE_CLI,
  approvalFor,
  conformingRecommendations,
  conformingRecord,
  refusedFor,
  reportText,
  withFixtureRepository,
} from './_atoms/report-intake/report-intake.fixtures.mjs';
import {
  DECISIONS,
  applyEvent as decisionApplyEvent,
  assertDiffMatchesDecision,
  createDecision,
  requireIntentDecision,
  verifyRequestedOutcome,
} from './_atoms/intent-decision/intent-decision.mjs';
import { digestOf } from '../create-skill/_atoms/intent-storage-gate/intent-storage-gate.mjs';
import * as reinforceRoast from './_atoms/reinforce-roast/reinforce-roast.mjs';
import * as sharedLedger from '../create-skill/_atoms/roast-round-ledger/roast-round-ledger.mjs';

const DECISION_CLI = path.join(
  fileURLToPath(new URL('./_atoms/intent-decision/intent-decision.mjs', import.meta.url)),
);
const TARGET_CLI = path.join(
  fileURLToPath(new URL('./_atoms/reinforcement-target/reinforcement-target.mjs', import.meta.url)),
);

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'reinforce-skill/SKILL.md';
const CREATE_ENTRY = 'create-skill/SKILL.md';
const ROAST_ENTRY = 'roast/SKILL.md';
const TARGET = 'reinforce-skill/_atoms/reinforcement-target/reinforcement-target.md';
const DECISION = 'reinforce-skill/_atoms/intent-decision/intent-decision.md';
const ROAST_ATOM = 'reinforce-skill/_atoms/reinforce-roast/reinforce-roast.md';
const INTAKE = 'reinforce-skill/_atoms/report-intake/report-intake.md';

/** The grant reinforce-skill was reviewed with. Nothing in the closure may widen it. */
const PINNED_TOOLS = ['read', 'search', 'edit', 'execute', 'task'];
/** The grant `/roast` declared, pinned from the other side. */
const PINNED_ROAST_TOOLS = ['read', 'search', 'execute', 'task'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

/** Whitespace-normalised, so a reflow of the source does not fail an assertion. */
function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

/** The first error code a thunk throws, or null when it does not throw. */
function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.code ?? null;
  }
  return null;
}

const FIXTURE_SKILL = 'existing-skill';
const FIXTURE_INTENT = `# Intent: ${FIXTURE_SKILL}

## What this is for

Do one job well, and say plainly what that job is.
`;
const FIXTURE_REVISED = `${FIXTURE_INTENT}
## What it must refuse

Anything that belongs to a different job.
`;

/**
 * A throwaway repository skeleton under the repository root — never in a shared
 * temporary directory — with one skill carrying an intent. Cleaned up always.
 */
function withDecisionFixture(run) {
  const root = fs.mkdtempSync(path.join(REPOSITORY_ROOT, '.reinforce-conformance-'));
  try {
    const skillDirectory = path.join(root, 'skills', FIXTURE_SKILL);
    fs.mkdirSync(skillDirectory, { recursive: true });
    fs.writeFileSync(path.join(skillDirectory, 'SKILL.md'), '# skill\n');
    const intentPath = path.join(skillDirectory, 'intent.md');
    fs.writeFileSync(intentPath, FIXTURE_INTENT);
    run(root, intentPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** Drive a decision through the gate to a stored `changes-intent` revision. */
function storedDecision(root) {
  const opened = createDecision({ skill: FIXTURE_SKILL, priorIntent: FIXTURE_INTENT });
  const decided = decisionApplyEvent(opened, {
    type: 'decide',
    decision: 'changes-intent',
    reasoning: 'the change adds a refusal the skill did not previously make',
  });
  const presented = decisionApplyEvent(decided, { type: 'draft-presented', draft: FIXTURE_REVISED });
  const confirmed = decisionApplyEvent(presented, {
    type: 'operator-confirmed',
    digest: digestOf(FIXTURE_REVISED),
  });
  return decisionApplyEvent(confirmed, { type: 'store', draft: FIXTURE_REVISED }, { repositoryRoot: root });
}

test('reinforce-skill is a high-ceremony, human-invoked, single-skill workflow', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'reinforce-skill');
  // Mutating a working, reviewed package is high blast radius. A model must not
  // route to it opportunistically; a human invokes it, or post-mortem invokes
  // it after human approval.
  assert.equal(parsed.disableModelInvocation, true);
  assert.equal(parsed.userInvocable, true);
});

test('roast is required and changelog is optional', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.requiresSkills, [
    { id: 'roast', source: 'local', required: true },
    { id: 'changelog', source: 'local', required: false },
  ]);
  const roastEdge = parsed.requiresSkills.find((edge) => edge.id === 'roast');
  const changelogEdge = parsed.requiresSkills.find((edge) => edge.id === 'changelog');
  assert.equal(roastEdge.required, true, 'the roast may never become optional');
  assert.equal(changelogEdge.required, false, 'changelog is an optional entry, per the issue');
});

test('reinforce-skill and create-skill name each other so routing is unambiguous', () => {
  const reinforce = frontmatter(ENTRY).description;
  const create = frontmatter(CREATE_ENTRY).description;

  assert.match(reinforce, /counterpart to create-skill/);
  assert.match(reinforce, /do not use to create a new skill/i);
  assert.match(create, /counterpart to reinforce-skill/);
  assert.match(create, /editing existing skills, which belongs to reinforce-skill/);
});

test('the routing description scopes to changing one existing skill and refuses the rest', () => {
  const { description } = frontmatter(ENTRY);
  assert.match(description, /Change one existing skill/);
  assert.match(description, /decide explicitly whether the intent changes/);
  assert.match(description, /record the change in the changelog/);
  assert.match(description, /open a pull request and stop/);
  assert.match(description, /do not use to create a new skill, run a skill, refactor the library, edit doctrine, approve a report, or widen another skill's permissions/i);
});

test('the routing description names both ways a change arrives', () => {
  // Discoverability, not decoration: a model routing an approved post-mortem
  // recommendation to this skill has to see that it accepts one, and see in the
  // same sentence that approving it is not this skill's job.
  const { description } = frontmatter(ENTRY);
  assert.match(description, /human-approved post-mortem recommendation report/);
  assert.match(description, /the operator's own words/);
  assert.match(description, /approve a report/i);
});

test('the grant is exactly what was reviewed, and nothing in the closure widens it', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('*'));

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

test('the edit grant is bounded to this package: no foreign unit carries write authority', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const closure = closureFor(result, ENTRY);

  const editBearing = closure
    .filter((unit) => (readFrontmatter(read(unit), unit).allowedTools ?? []).includes('edit'))
    .sort();
  const executeBearing = closure
    .filter((unit) => (readFrontmatter(read(unit), unit).allowedTools ?? []).includes('execute'))
    .sort();

  // Every mutating unit lives in this package or in shared _base infrastructure.
  for (const unit of [...editBearing, ...executeBearing]) {
    assert.ok(
      unit.startsWith('reinforce-skill/') || unit.startsWith('_base/'),
      `${unit} carries mutation authority but is not part of this package or _base`,
    );
  }

  // Pinned so a later revision acquiring mutation elsewhere is a reviewed change.
  assert.deepEqual(editBearing, [
    'reinforce-skill/SKILL.md',
    DECISION,
  ].sort());
  assert.deepEqual(executeBearing, [
    '_base/_atoms/chronicle-append/chronicle-append.md',
    '_base/_atoms/chronicle-replay/chronicle-replay.md',
    '_base/_molecules/chronicler/chronicler.md',
    'reinforce-skill/SKILL.md',
    DECISION,
    INTAKE,
    ROAST_ATOM,
    TARGET,
  ].sort());
});

test('the edit boundary is publication, held by mechanism, not by a promise', () => {
  // The mechanism is asserted by behaviour elsewhere (auditDiff refuses an
  // out-of-target diff; the deriver reports no grant violation). Here, only a
  // short stable anchor for the section, plus the load-bearing lesson that lives
  // in the intent — the standard this is judged against.
  assert.match(read(ENTRY), /## Permissions/);
  assert.equal(
    auditDiff(REPOSITORY_ROOT, 'roast', ['skills/create-skill/SKILL.md']).clean,
    false,
    'publication is bounded by the audit, not by a promise to behave',
  );
  assert.match(flat('reinforce-skill/intent.md'), /permission defended only by a promise is not\s+a boundary/);
});

test('the pull request is a defined, mutating deliverable, not a read-only afterthought', () => {
  const entry = flat(ENTRY);
  // The contradiction the adversarial round caught must stay fixed: `execute`
  // performs the git commands, so it is never described as read-only.
  assert.doesNotMatch(entry, /read-only git and pull-request commands/);
  // A short stable anchor that the workflow's mutating step exists.
  assert.match(entry, /create the review branch/);
});

test('the diff audit is the completeness the single-path classifier lacks', () => {
  // The property, not its phrasing: a single-path classify call proves nothing
  // about paths the model never handed it, while the diff audit classifies the
  // whole enumerable change set and refuses any path out of class.
  const single = classifyWritePath(REPOSITORY_ROOT, 'roast', 'skills/roast/SKILL.md');
  assert.equal(single, WRITE_CLASS.inTarget);

  const audited = auditDiff(REPOSITORY_ROOT, 'roast', [
    'skills/roast/SKILL.md',
    'skills/create-skill/SKILL.md',
  ]);
  assert.equal(audited.clean, false, 'the audit sees the foreign path the classifier was never handed');
  assert.deepEqual(
    audited.refused.map((entry) => entry.path),
    ['skills/create-skill/SKILL.md'],
  );

  // A short, stable heading anchor documents the guard's honest boundary.
  assert.match(read(TARGET), /## What This Guard Does and Does Not Do/);
});

test('the workflow edit is additive-only, proven by the function that enforces it', () => {
  // Registration is line-preserving. The property is enforced by
  // assertWorkflowAdditive and folded into auditDiff, so it is asserted over the
  // function rather than over a sentence that could be reflowed away.
  const previous = [
    'jobs:',
    '  test:',
    '    run: node scripts/run-registered-tests.mjs',
    '      skills/roast/roast.conformance.test.mjs',
    '',
  ].join('\n');
  const appended = `${previous}      skills/existing-skill/existing-skill.conformance.test.mjs\n`;
  const removed = previous.replace('      skills/roast/roast.conformance.test.mjs\n', '');

  assert.deepEqual(assertWorkflowAdditive(previous, appended), { status: 'additive', removed: [], added: [] });
  assert.equal(
    codeOf(() => assertWorkflowAdditive(previous, removed)),
    FAILURES.workflowNotAdditive,
    'removing an existing registration is refused',
  );
  // Weakening by pure addition removes nothing yet is still refused: the check
  // is bounded positively, so an added non-registration line fails it.
  const disabled = previous.replace('  test:\n', '  test:\n    if: false\n');
  assert.equal(
    codeOf(() => assertWorkflowAdditive(previous, disabled)),
    FAILURES.workflowNotAdditive,
    'adding if: false is refused even though it removes nothing',
  );

  // And auditDiff carries that refusal: a workflow diff that drops a test line
  // is unclean, an append-only one is clean.
  const dropped = auditDiff(REPOSITORY_ROOT, 'existing-skill', ['skills/existing-skill/SKILL.md', WORKFLOW_FILE], {
    workflow: { previous, next: removed },
  });
  assert.equal(dropped.clean, false);
  assert.ok(dropped.workflowViolation, 'the removed registration is surfaced');

  const grew = auditDiff(REPOSITORY_ROOT, 'existing-skill', ['skills/existing-skill/SKILL.md', WORKFLOW_FILE], {
    workflow: { previous, next: appended },
  });
  assert.equal(grew.clean, true);
});

test('the final status has a defined mapping from run outcomes', () => {
  const entry = flat(ENTRY);
  // Stable anchors only: the heading and each fenced status identifier. The
  // prose describing when each applies may be reflowed freely.
  assert.match(entry, /### Status Mapping/);
  for (const status of ['reinforced', 'needs-confirmation', 'blocked', 'halted']) {
    assert.match(entry, new RegExp(`\`${status}\``), `the status mapping must define ${status}`);
  }
});

test('the missing-intent bug fix has an honest branch, not a false "still accurate"', () => {
  const decision = flat(DECISION);
  assert.match(decision, /an ordinary bug fix on an intent-less skill/);
  assert.match(decision, /no intent existed to review and this change does not create one/i);
  assert.match(decision, /rather than\s+claiming a nonexistent intent "remains\s+accurate/);
});

test('the pull request evidence is written for a human reviewer, decision first', () => {
  // A stable heading anchor; the paragraph beneath it may be reflowed freely.
  assert.match(read(ENTRY), /### Pull Request Evidence, for a Human Reviewer/);
});

test('the root directly reaches the four substantive boundaries without forwarding units', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    TARGET, INTAKE, DECISION, ROAST_ATOM,
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [TARGET, INTAKE, DECISION, ROAST_ATOM]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
  assert.ok(!closure.some((unit) => /skill-reinforcement|change-grounding|narrow-change/.test(unit)));
});

test('roast is reached by invocation, not composition, and is left untouched', () => {
  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of closure) {
    assert.ok(!unit.startsWith('roast/'), `${ENTRY} must reach /roast by invocation, not by composing ${unit}`);
  }
  const roast = frontmatter(ROAST_ENTRY);
  assert.equal(roast.disableModelInvocation, false, '/roast must be loadable as a required dependency');
  assert.equal(roast.userInvocable, true);
  assert.deepEqual(roast.allowedTools, PINNED_ROAST_TOOLS, '/roast keeps its own grant');
  assert.deepEqual(roast.requiresSkills, []);

  assert.match(flat(ROAST_ATOM), /Never change `\/roast`, including its `disable-model-invocation` flag/);
});

test('intent decides first: the decision precedes implementation and has no default', () => {
  // "Intent first" is proven by the gate, not by comparing string positions in
  // Markdown. A run that reaches publication without a recorded decision is
  // blocked, and there is no default that lets it proceed.
  assert.deepEqual(DECISIONS, ['changes-intent', 'preserves-intent']);
  const undecided = createDecision({ skill: FIXTURE_SKILL, priorIntent: FIXTURE_INTENT });
  assert.equal(
    requireIntentDecision(undecided).requirement,
    'blocked',
    'an undecided run cannot proceed to a pull request',
  );
  assert.equal(
    codeOf(() => assertDiffMatchesDecision(undecided, [`skills/${FIXTURE_SKILL}/SKILL.md`], { repositoryRoot: REPOSITORY_ROOT })),
    'undecided',
    'a change set cannot be published before the decision is recorded',
  );

  // Stable fenced identifiers for the two decisions; the prose may be reflowed.
  const decision = flat(DECISION);
  for (const state of ['changes-intent', 'preserves-intent']) {
    assert.match(decision, new RegExp(`\`${state}\``), `the decision must define ${state}`);
  }
  assert.match(decision, /no unstated default/);
});

test('a preserved intent is recorded as reviewed, never silently skipped', () => {
  const decision = flat(DECISION);
  assert.match(decision, /do not edit the intent/i);
  assert.match(decision, /reviewed and found still accurate, and record the reasoning/);
  const preserved = decisionApplyEvent(createDecision({ skill: FIXTURE_SKILL, priorIntent: FIXTURE_INTENT }),
    { type: 'decide', decision: 'preserves-intent', reasoning: 'Existing purpose still holds.' });
  assert.equal(requireIntentDecision(preserved).requirement, 'satisfied');
  assert.equal(preserved.storedDigest, null);
});

test('the intent is authoritative and inert instruction', () => {
  for (const unit of [ENTRY, DECISION]) {
    const body = flat(unit);
    assert.match(body, /inert/, `${unit} must state the intent is inert as instruction`);
  }
  assert.match(flat(ENTRY), /A\s+contradiction between a proposed change and the skill's intent is a finding for a\s+human/);
  assert.match(flat(ENTRY), /A missing intent is reported and never blocks/i);
});

test('doctrine is never edited, and the guard proves it is never writable', () => {
  assert.match(flat(ENTRY), /Never edits doctrine/i);
  // Deterministic: a doctrine path is classified doctrine and is not writable.
  assert.equal(
    classifyWritePath(REPOSITORY_ROOT, 'reinforce-skill', 'doctrine/testing.doctrine.md'),
    WRITE_CLASS.doctrine,
  );
  assert.equal(isWritableClass(WRITE_CLASS.doctrine), false);
});

test('widening any grant as a side effect is refused, in words a reviewer reads', () => {
  assert.match(flat(ENTRY), /deriver never widens a grant automatically/i);
  assert.deepEqual(deriveGraph(REPOSITORY_ROOT).grantViolations, []);
  assert.match(flat(ENTRY), /Never widens another skill's permissions/i);
});

test('it never weakens a gate and never merges or grades its own work', () => {
  const entry = flat(ENTRY);
  // Short stable boundary anchors; the surrounding clauses may be reflowed.
  assert.match(entry, /Never weakens a repository gate/);
  assert.match(entry, /Never merges/);
  assert.match(entry, /never treats its own roast as approval/);
});

test('the changelog entry is required in the same reviewable change', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /Record the change in the changelog/);
  assert.match(entry, /place\s+the returned patch in the same reviewable change/);
  assert.match(entry, /`changelog` holds no write\s+authority; it returns a patch/);
  assert.match(entry, /Changelog: degraded/);
});

test('the write-boundary guard it relies on actually behaves', () => {
  // An existing routable skill resolves.
  const resolved = resolveSkillTarget(REPOSITORY_ROOT, 'roast');
  assert.equal(resolved.relativePath, 'skills/roast');
  assert.equal(resolved.hasSkillMd, true);

  // _base and a non-existent target are refused: this skill never creates.
  const baseCode = (() => { try { resolveSkillTarget(REPOSITORY_ROOT, '_base'); return null; } catch (e) { return e.code; } })();
  assert.equal(baseCode, FAILURES.invalidName);
  const missingCode = (() => { try { resolveSkillTarget(REPOSITORY_ROOT, 'no-such-skill-xyz'); return null; } catch (e) { return e.code; } })();
  assert.equal(missingCode, FAILURES.notASkill);

  // Only in-target and the workflow file are writable.
  assert.equal(classifyWritePath(REPOSITORY_ROOT, 'roast', 'skills/roast/SKILL.md'), WRITE_CLASS.inTarget);
  assert.equal(classifyWritePath(REPOSITORY_ROOT, 'roast', 'skills/create-skill/SKILL.md'), WRITE_CLASS.foreignSkill);
  assert.equal(isWritableClass(WRITE_CLASS.foreignSkill), false);

  // The diff audit over an actual change set refuses any out-of-target path.
  const dirty = auditDiff(REPOSITORY_ROOT, 'roast', [
    'skills/roast/SKILL.md',
    'doctrine/manifest.md',
    'skills/create-skill/SKILL.md',
  ]);
  assert.equal(dirty.clean, false);
  assert.equal(dirty.refused.length, 2, 'the doctrine and foreign-skill paths are refused');
  const clean = auditDiff(REPOSITORY_ROOT, 'roast', ['skills/roast/SKILL.md']);
  assert.equal(clean.clean, true);
});

test('the intent decision is a gate that refuses, not a step that can be skipped', () => {
  // The two rules that decide whether "intent first" is real: a run cannot
  // reach a pull request undecided, and a preserves-intent run owns no write.
  const undecided = createDecision({ skill: 'reinforce-skill', priorIntent: '# Intent: x\n' });
  assert.equal(requireIntentDecision(undecided).requirement, 'blocked');
  assert.equal(requireIntentDecision(null).requirement, 'blocked');
  assert.deepEqual(DECISIONS, ['changes-intent', 'preserves-intent']);

  const preserved = decisionApplyEvent(undecided, {
    type: 'decide',
    decision: 'preserves-intent',
    reasoning: 'a bug fix that does not change what the skill is for',
  });
  let refusal = null;
  try {
    assertDiffMatchesDecision(preserved, ['skills/reinforce-skill/intent.md'], { repositoryRoot: REPOSITORY_ROOT });
  } catch (error) {
    refusal = error.code;
  }
  assert.equal(refusal, 'undisclosed_intent_edit', 'a narrow change may not widen into an intent edit');

  assert.match(flat(DECISION), /Required Files/);
  assert.match(flat(DECISION), /state machine that refuses/);
  assert.match(flat(DECISION), /A Narrow Change May Not Widen Into an Intent Edit/);
});

test('the release check refuses a changes-intent run that hand-wrote the intent (finding 1)', () => {
  // A run records changes-intent and edits intent.md, but the revised intent
  // never went through the gate: the state is still awaiting-draft. The release
  // check must refuse it rather than reporting it consistent.
  const decided = decisionApplyEvent(
    createDecision({ skill: FIXTURE_SKILL, priorIntent: FIXTURE_INTENT }),
    { type: 'decide', decision: 'changes-intent', reasoning: 'the change alters what the skill is for' },
  );
  assert.equal(
    codeOf(() => assertDiffMatchesDecision(decided, [`skills/${FIXTURE_SKILL}/intent.md`], { repositoryRoot: REPOSITORY_ROOT })),
    'unstored_intent_change',
    'a changes-intent diff that never reached stored is refused',
  );
});

test('the release check refuses a stored intent whose bytes were changed on disk (finding 1)', () => {
  withDecisionFixture((root, intentPath) => {
    const stored = storedDecision(root);
    // The gate stored the confirmed bytes; now the file is tampered afterwards.
    fs.writeFileSync(intentPath, `${FIXTURE_REVISED}\n<!-- slipped in after confirmation -->\n`);
    assert.equal(
      codeOf(() => assertDiffMatchesDecision(stored, [`skills/${FIXTURE_SKILL}/intent.md`], {
        repositoryRoot: root,
      })),
      'undisclosed_intent_edit',
      'a stored intent that no longer matches the confirmed digest is refused',
    );
  });
});

test('the release check passes a properly stored changes-intent run (finding 1)', () => {
  withDecisionFixture((root) => {
    const stored = storedDecision(root);
    const result = assertDiffMatchesDecision(stored, [`skills/${FIXTURE_SKILL}/intent.md`], {
      repositoryRoot: root,
    });
    assert.equal(result.status, 'consistent');
    assert.equal(requireIntentDecision(stored).requirement, 'satisfied');
  });
});

test('the release-check CLI exits 2 when blocked and 0 when satisfied (finding 1)', () => {
  withDecisionFixture((root) => {
    const statePath = path.join(root, 'decision.json');

    const blocked = createDecision({ skill: FIXTURE_SKILL, priorIntent: FIXTURE_INTENT });
    fs.writeFileSync(statePath, JSON.stringify(blocked));
    const blockedRun = spawnSync(process.execPath, [DECISION_CLI, '--state', statePath, '--require-decision'], {
      encoding: 'utf8',
    });
    assert.equal(blockedRun.status, 2, 'an undecided record blocks with exit 2');
    assert.match(blockedRun.stdout, /"requirement": "blocked"/);

    const satisfied = decisionApplyEvent(blocked, {
      type: 'decide',
      decision: 'preserves-intent',
      reasoning: 'a bug fix that does not change what the skill is for',
    });
    fs.writeFileSync(statePath, JSON.stringify(satisfied));
    const okRun = spawnSync(process.execPath, [DECISION_CLI, '--state', statePath, '--require-decision'], {
      encoding: 'utf8',
    });
    assert.equal(okRun.status, 0, 'a recorded, reasoned decision is satisfied with exit 0');
    assert.match(okRun.stdout, /"requirement": "satisfied"/);
  });
});

test('assertDiffMatchesDecision agrees on absolute and relative intent paths (finding 2)', () => {
  withDecisionFixture((root) => {
    const preserved = decisionApplyEvent(
      createDecision({ skill: FIXTURE_SKILL, priorIntent: FIXTURE_INTENT }),
      { type: 'decide', decision: 'preserves-intent', reasoning: 'a bug fix' },
    );
    const relative = `skills/${FIXTURE_SKILL}/intent.md`;
    const absolute = path.join(root, 'skills', FIXTURE_SKILL, 'intent.md');

    // An absolute path to the intent file must be caught, exactly as a relative
    // one is — a lexical compare used to let it slip past as "does not touch".
    assert.equal(
      codeOf(() => assertDiffMatchesDecision(preserved, [absolute], { repositoryRoot: root })),
      'undisclosed_intent_edit',
    );
    assert.equal(
      codeOf(() => assertDiffMatchesDecision(preserved, [relative], { repositoryRoot: root })),
      'undisclosed_intent_edit',
    );
    // And a path that genuinely does not touch the intent still passes.
    assert.equal(
      assertDiffMatchesDecision(preserved, [`skills/${FIXTURE_SKILL}/SKILL.md`], { repositoryRoot: root }).touchesIntent,
      false,
    );
  });
});

test('the reinforcement-target CLI refuses an unknown flag instead of exiting success (finding 4)', () => {
  const typo = spawnSync(
    process.execPath,
    [TARGET_CLI, '--root', REPOSITORY_ROOT, '--skill', 'roast', '--audits', 'skills/roast/SKILL.md'],
    { encoding: 'utf8' },
  );
  assert.notEqual(typo.status, 0, 'a typo\'d flag must not exit success-shaped');
  assert.match(typo.stderr, /unknown argument: --audits/);
});

test('the roast gate drives create-skill\'s validated machine, not a second copy of its prose', () => {
  // Issue 47 says a reinforcement resolves findings under the same rules
  // create-skill uses. Here those rules are the same functions, not similar
  // sentences, so "the same rules" is checkable.
  const local = reinforceRoast.createLedger({ packagePath: 'skills/reinforce-skill', head: 'h1' });
  const shared = structuredClone(local);
  const event = { type: 'roast-recorded', head: 'h1', findings: [] };
  assert.deepEqual(reinforceRoast.applyEvent(local, event), sharedLedger.applyEvent(shared, event));
  assert.deepEqual(local, shared);
  assert.equal(reinforceRoast.createLedger, sharedLedger.createLedger);
  assert.deepEqual(reinforceRoast.MANDATORY_PRIORITIES, ['Must fix']);
  assert.equal(reinforceRoast.ROUNDS_BEFORE_RECONFIRMATION, 3);

  assert.match(flat(ROAST_ATOM), /Required Files/);
  assert.match(flat(ROAST_ATOM), /reuses\*\*\s+`create-skill`'s validated remediation ledger rather than restating it/);
});

test('a remediation correction may not wander into a neighbouring skill or a shared unit', () => {
  const code = (fn) => {
    try {
      fn();
    } catch (error) {
      return error.code;
    }
    return null;
  };

  // The shared gate permits these; the reinforcement layer is what refuses them.
  assert.equal(sharedLedger.assertGateIntegrity(['skills/roast/SKILL.md']).status, 'intact');
  assert.equal(
    code(() => reinforceRoast.assertReinforcementChangeSet(REPOSITORY_ROOT, 'reinforce-skill', [
      'skills/roast/SKILL.md',
    ])),
    'out_of_target',
  );
  assert.equal(
    code(() => reinforceRoast.assertReinforcementChangeSet(REPOSITORY_ROOT, 'reinforce-skill', [
      'skills/_base/_molecules/chronicler/chronicler.md',
    ])),
    'out_of_target',
  );
  assert.equal(
    code(() => reinforceRoast.assertReinforcementChangeSet(REPOSITORY_ROOT, 'reinforce-skill', [
      'skills/reinforce-skill/SKILL.md',
      'AGENTS.md',
    ])),
    'gate_weakened',
  );
  // A workflow path with no before/after content cannot be proven a bare
  // registration, so it fails closed rather than being assumed intact.
  assert.equal(
    code(() => reinforceRoast.assertReinforcementChangeSet(REPOSITORY_ROOT, 'reinforce-skill', [
      'skills/reinforce-skill/SKILL.md',
      '.github/workflows/validate-skills.yml',
    ])),
    'out_of_target',
    'an unproven workflow edit is refused',
  );
  // Supplied with an additive before/after, the same change set is intact.
  const previous = [
    'run: node scripts/run-registered-tests.mjs',
    '  skills/reinforce-skill/reinforce-skill.conformance.test.mjs',
    '',
  ].join('\n');
  assert.equal(
    reinforceRoast.assertReinforcementChangeSet(REPOSITORY_ROOT, 'reinforce-skill', [
      'skills/reinforce-skill/SKILL.md',
      '.github/workflows/validate-skills.yml',
    ], {
      workflow: {
        previous,
        next: `${previous}  skills/reinforce-skill/added.test.mjs\n`,
      },
    }).status,
    'intact',
  );
});

test('a reinforcement is never complete on a roast that did not happen', () => {
  const ledger = reinforceRoast.createLedger({ packagePath: 'skills/reinforce-skill', head: 'h1' });
  const never = reinforceRoast.assertRoastComplete(ledger);
  assert.equal(never.remediation, 'blocked');
  assert.equal(never.roast, 'none');

  reinforceRoast.applyEvent(ledger, { type: 'roast-recorded', head: 'h1', findings: [] });
  assert.equal(reinforceRoast.assertRoastComplete(ledger).remediation, 'clean');

  reinforceRoast.applyEvent(ledger, {
    type: 'correction',
    head: 'h2',
    changedPaths: ['skills/reinforce-skill/SKILL.md'],
  });
  assert.equal(
    reinforceRoast.assertRoastComplete(ledger).remediation,
    'blocked',
    'a correction that moves the head forces a re-roast before completion',
  );
});

test('agent-whisperer is declared as the writing component, and why the edge is not frontmatter yet', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /## The Writing Component/);
  assert.match(entry, /That component is `agent-whisperer`/);
  assert.match(entry, /It is invoked,\s+never composed/);

  // The seam is prose because the validator refuses an unresolved local skill
  // dependency, required or not. Pinning the reason keeps a later revision from
  // "fixing" it by inventing an edge that fails the build.
  assert.match(entry, /not yet in `requires-skills`, on\s+purpose/);
  assert.match(entry, /refuses an unresolved one whether it is required or\s+optional/);
  assert.match(entry, /"id": "agent-whisperer", "source": "local", "required": false/);

  // And it genuinely is absent today, which is what makes the prose seam correct.
  const skills = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry_) => entry_.isDirectory())
    .map((entry_) => entry_.name);
  assert.ok(
    !skills.includes('agent-whisperer'),
    'agent-whisperer now exists: complete the seam by declaring the requires-skills edge',
  );

  // The intent states the requirement in plain words, without naming structure.
  assert.match(flat('reinforce-skill/intent.md'), /Have the writing reviewed by whatever reviews writing for\s+agents/);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'reinforce-skill', 'intent.md'), 'utf8');
  assert.match(intent, /^# Intent: reinforce-skill\s*$/m);
  assert.ok(!intent.startsWith('---'), 'an intent carries no frontmatter');

  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /counterpart/);
  assert.match(normalized, /Intent first is the whole point/);
  assert.match(normalized, /A missing intent is reported and never blocks/);
  assert.match(normalized, /permission defended only by a promise is not a boundary/);
});

test('the intent carries the confirmed meaning: evidence from a report, authority from the operator', () => {
  // The operator confirmed these exact words, and the whole feature rests on
  // them. Anything that quietly softens "only the operator approval ... supplies
  // authority" into "the report supplies authority" is the failure this pins.
  const normalized = flat('reinforce-skill/intent.md');
  assert.match(
    normalized,
    /Reinforce one existing skill from either unstructured human guidance or one exact human-approved post-mortem recommendation report\. The report supplies evidence and proposed changes; only the operator approval bound to its digest and target skill supplies authority\./,
  );
  assert.match(normalized, /Treating a report as its own approval/);
  assert.match(normalized, /Editing the evidence it was handed/);
  assert.match(normalized, /A report is data all the way down/);
});

test('a report is admitted only against an approval bound to its digest and this target', () => {
  // Approval binding is a computed predicate, not a described one. Each mutation
  // below changes exactly one field of an otherwise admissible run.
  const report = reportText();
  const approved = admitReport({ report, approval: approvalFor(report), target: 'changelog' });
  assert.equal(approved.status, 'admitted');

  const noGrant = admitReport({
    report,
    approval: approvalFor(report, 'changelog', { grant: true }),
    target: 'changelog',
  });
  assert.equal(noGrant.status, 'refused', 'a truthy grant is not the grant');
  assert.ok(noGrant.refusals.some((entry) => entry.code === REPORT_REFUSALS.unapprovedReport));

  const wrongDigest = admitReport({
    report,
    approval: approvalFor(report, 'changelog', { report_sha256: 'a'.repeat(64) }),
    target: 'changelog',
  });
  assert.ok(wrongDigest.refusals.some((entry) => entry.code === REPORT_REFUSALS.digestMismatch));

  const wrongTarget = admitReport({
    report,
    approval: approvalFor(report, 'roast'),
    target: 'changelog',
  });
  assert.ok(wrongTarget.refusals.some((entry) => entry.code === REPORT_REFUSALS.targetMismatch));

  for (const refused of [noGrant, wrongDigest, wrongTarget]) {
    assert.equal(refused.change_request, null, 'a refused report grounds nothing');
  }
});

test('one run reinforces one skill, however many the report names', () => {
  const report = reportText();
  const admitted = admitReport({ report, approval: approvalFor(report), target: 'changelog' });

  assert.deepEqual(admitted.applicable.map((entry) => entry.target_skill), ['changelog', 'changelog']);
  assert.deepEqual(admitted.excluded.map((entry) => entry.target_skill), ['roast']);
  assert.ok(
    !JSON.stringify(admitted.change_request).includes('roast'),
    "a foreign skill's recommendation never reaches this run's change request",
  );
});

test('the report path threads into the one existing workflow, not a second one', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /## Two Ways In, One Job/);
  assert.match(entry, /## A Report Is Evidence; Only the Operator Is Authority/);

  // The molecule reaches intake through composition, and intake is an atom of
  // this package rather than a second routable entry point.
  assert.ok(frontmatter(ENTRY).composes.includes(INTAKE));
  assert.equal(frontmatter(INTAKE).level, 'atom');
  assert.deepEqual(frontmatter(INTAKE).composes, []);
  assert.ok(
    !fs.existsSync(path.join(SKILLS_ROOT, 'reinforce-skill', '_atoms', 'report-intake', 'SKILL.md')),
    'report intake is a unit of this skill, never a second routable workflow',
  );
});

test('reading a report widened no grant', () => {
  // A second input source that needed a new permission would be a worse design
  // than one that does not. The pinned grant is the proof.
  assert.deepEqual(frontmatter(ENTRY).allowedTools, PINNED_TOOLS);
  assert.deepEqual(frontmatter(INTAKE).allowedTools, ['read', 'execute']);
  assert.match(flat(ENTRY), /The grant did not widen to read a report/);
});

test('the pull request preserves the whole lineage from report to reviewed head', () => {
  const entry = flat(ENTRY);
  for (const link of [
    'report digest',
    'post-mortem evidence anchors',
    'applied recommendation IDs',
    'approval receipt',
    'intent decision',
    'changed files',
    'validation',
    'roast',
    'reviewed head',
  ]) {
    assert.ok(entry.includes(link), `the pull-request lineage must name ${link}`);
  }

  // And the lineage is produced, not merely described.
  const report = reportText();
  const { lineage } = admitReport({ report, approval: approvalFor(report), target: 'changelog' });
  assert.deepEqual(Object.keys(lineage).sort(), [
    'applied_recommendation_ids',
    'approval_receipt',
    'change_request_sha256',
    'evidence_anchors',
    'excluded_recommendations',
    'quarantined_untrusted_directives',
    'report_sha256',
    'schema',
    'target_skill',
  ]);
  assert.deepEqual(lineage.evidence_anchors, ['U1', 'T3']);
  assert.ok(!('report_path' in lineage), 'the digest is the identity; a path is not');
});

test('the pull request quotes a machine receipt, rechecked rather than remembered', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /--require-admitted-state/);
  assert.match(entry, /\*\*The admission receipt is quoted verbatim\*\*/);
  assert.match(entry, /re-derives the admission rather than reading its label/);
  assert.match(entry, /A human-guidance run has no receipt to check/);

  // And the check is a computed precondition, not a described one.
  const report = reportText();
  const receipt = buildAdmissionReceipt(admitReport({
    report,
    approval: approvalFor(report),
    target: 'changelog',
  }));
  assert.equal(receipt.schema, ADMISSION_SCHEMA);
  assert.equal(
    requireAdmittedState({ state: receipt, report, target: 'changelog' }).requirement,
    'satisfied',
  );
  assert.equal(
    requireAdmittedState({ state: receipt, report: `${report} `, target: 'changelog' }).requirement,
    'blocked',
    'publication is blocked once the approved report has changed',
  );
  assert.equal(
    requireAdmittedState({ state: null, report, target: 'changelog' }).requirement,
    'blocked',
    'an unrecorded admission cannot publish',
  );
});

test('the admission receipt is run state the repository never publishes', () => {
  const gitignore = fs.readFileSync(path.join(REPOSITORY_ROOT, '.gitignore'), 'utf8');
  assert.deepEqual(RUN_STATE_ROOTS, ['.skill-log'], 'scratch space is not a place to keep authority');
  for (const root of RUN_STATE_ROOTS) {
    assert.match(
      gitignore,
      new RegExp(`^${root.replace('.', '\\.')}/$`, 'm'),
      `${root}/ must be git-ignored for a receipt written there to stay unpublished`,
    );
  }

  // The receipt is not a package file, so it never enters the diff the guard audits.
  assert.equal(
    classifyWritePath(REPOSITORY_ROOT, 'reinforce-skill', '.skill-log/run/admission.json'),
    WRITE_CLASS.outside,
  );
  assert.equal(isWritableClass(WRITE_CLASS.outside), false);
});

test('a report grounds a run only when its admission was recorded', () => {
  // The strongest form of the rule is that there is nothing to proceed with:
  // an unrecorded admission returns no change request, so a caller cannot
  // continue on one by accident.
  assert.match(flat(INTAKE), /\*\*`--report` requires `--state` and `--root`\.\*\*/);
  assert.match(flat(INTAKE), /an admission nobody wrote down cannot be re-derived/i);
  assert.match(flat(ENTRY), /A report must have its admission recorded outside published files/);
});

test('the root owns admission once and uses named steps rather than stale numeric references', () => {
  assert.match(flat(ENTRY), /Invoke report intake here, \*\*exactly once\*\*, for either source/);
  assert.match(flat(ENTRY), /On resume use the existing normalized intake/);
  assert.match(read(ENTRY), /--require-admitted-state/);
  assert.doesNotMatch(read(ENTRY), /\bstep \d/);
});

test('every reported status has exactly one row that defines it', () => {
  const table = read(ENTRY).split('### Status Mapping')[1].split('\n\n')[2];
  const rows = table.split('\n').filter((line) => line.startsWith('| `'));
  const statuses = rows.map((line) => line.split('`')[1]);

  assert.deepEqual(
    statuses,
    ['reinforced', 'already-satisfied', 'needs-confirmation', 'no-applicable-recommendations', 'blocked', 'halted'],
  );
  assert.equal(new Set(statuses).size, statuses.length, 'a status is defined once');

  // And the output contract offers the same set, so nothing can be returned
  // that the table does not define.
  const contract = flat(ENTRY).match(/`status`: ([^;]+);/)[1];
  for (const status of statuses) {
    assert.ok(contract.includes(`\`${status}\``), `the output contract must offer ${status}`);
  }
});

test('one file takes one proposal, and the ambiguous case goes back to the operator', () => {
  const change = (id, surface, directive, statement) => ({
    id, surface, directive, statement, evidence: ['U1'], source_ref: 'skill_improvements[0]',
  });
  const tighten = change('A', 'SKILL.md', 'revise', 'tighten the output contract');

  assert.deepEqual(reconcileApplicable([tighten]).refusals, []);
  assert.deepEqual(
    reconcileApplicable([tighten, { ...tighten, id: 'B' }]).changes.map((entry) => entry.ids),
    [['A', 'B']],
    'the same proposal written twice is one change',
  );
  assert.equal(
    reconcileApplicable([tighten, change('C', 'SKILL.md', 'revise', 'drop the output contract')])
      .refusals.length,
    1,
    'two different proposals about one file are the operator\'s decision',
  );
  assert.equal(
    reconcileApplicable([tighten, change('D', 'skills/x/SKILL.MD'.replace('skills/x/', ''), 'remove', 'drop it')])
      .refusals.length,
    1,
    'and case is not a way to make them different files',
  );
});

test('an approved report that applies to nothing stops before anything is changed', () => {
  const report = reportText({ recommendations: [] });
  const outcome = admitReport({ report, approval: approvalFor(report), target: 'changelog' });

  assert.equal(outcome.status, 'no-applicable-recommendations');
  assert.deepEqual(outcome.refusals, [], 'nothing went wrong; there is simply nothing to do');
  assert.equal(outcome.change_request, null, 'and nothing to carry into an intent decision');

  // It also cannot become a pull request, which is what makes the stop real.
  const receipt = buildAdmissionReceipt(outcome);
  assert.equal(receipt.status, 'no-applicable-recommendations');
  assert.equal(
    requireAdmittedState({ state: receipt, report, target: 'changelog' }).requirement,
    'blocked',
  );

  assert.match(flat(ENTRY), /no-applicable-recommendations/);
});

test('a proposed surface can never name doctrine, another package, or a path outside the target', () => {
  // The refusal is decided by the normalizer, and what it accepts is exactly
  // what the write-boundary guard calls in-target.
  for (const hostile of [
    'doctrine/manifest.md',
    'skills/post-mortem/SKILL.md',
    '../post-mortem/SKILL.md',
    '/etc/passwd',
    'file:///etc/passwd',
    '.github/workflows/validate-skills.yml',
  ]) {
    assert.equal(
      codeOf(() => normalizeSurface(hostile, { target: 'changelog' })),
      REPORT_REFUSALS.malformedSurface,
      `${hostile} must be refused as a surface`,
    );
  }

  const normalized = normalizeSurface('skills/reinforce-skill/SKILL.md', { target: 'reinforce-skill' });
  assert.equal(normalized, 'SKILL.md');
  assert.equal(
    classifyWritePath(REPOSITORY_ROOT, 'reinforce-skill', `skills/reinforce-skill/${normalized}`),
    WRITE_CLASS.inTarget,
  );

  // And a contradiction spelled two ways is one contradiction.
  const recommendations = conformingRecommendations();
  recommendations[1].target_skill = 'changelog';
  recommendations[1].change = {
    surface: './skills/changelog/SKILL.md',
    directive: 'remove',
    statement: 'drop the output contract',
  };
  const report = reportText({ recommendations });
  assert.ok(refusedFor(
    admitReport({ report, approval: approvalFor(report), target: 'changelog' }),
    REPORT_REFUSALS.contradictoryRecommendations,
  ));
});

test('post-mortem is untouched: intake enforces its record contract without composing it', () => {
  // The wrapped record is held to post-mortem's own contract. Proven by
  // behaviour: a record that only post-mortem's rules would reject is rejected
  // here, in post-mortem's own words.
  const relaxed = conformingRecord();
  relaxed.promotion_recommendations.ready_for_promotion = ['CS-1'];
  const report = reportText({ record: relaxed });
  const refused = admitReport({ report, approval: approvalFor(report), target: 'changelog' });

  assert.equal(refused.status, 'refused');
  assert.ok(refused.refusals.some((entry) => entry.code === REPORT_REFUSALS.malformedRecord));
  assert.match(refused.refusals[0].message, /ready_for_promotion must be an empty list/);

  // Composition still runs strictly downward: this is a code dependency, and no
  // post-mortem unit is composed by this skill.
  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of closure) {
    assert.ok(!unit.startsWith('post-mortem/'), `${ENTRY} must not compose ${unit}`);
  }
  assert.match(flat(INTAKE), /`skills\/post-mortem\/\*\*` is left exactly as it is/);
});

test('one owner normalizes both sources, invoked exactly once per run', () => {
  // The ambiguity worth removing: guidance does not bypass intake, it goes
  // through the same step. Only the report subflow - admission, approval,
  // receipt - is skipped, and every document has to say the same thing.
  for (const [name, body] of [['the skill', flat(ENTRY)], ['the unit', flat(INTAKE)]]) {
    assert.match(body, /exactly once/i, `${name} must say intake runs exactly once`);
    assert.match(body, /either source|for both|both sources/i, `${name} must say it serves both sources`);
    assert.match(body, /subflow/i, `${name} must call the report path a subflow, not a second path`);
  }
  assert.match(
    flat(ENTRY),
    /Consume\s+the normalized change request intake returned/,
    'change grounding consumes the normalized shape rather than re-reading a source',
  );

  // And behaviourally: both sources leave intake in one shape.
  const guided = admitGuidance({ target: 'changelog', guidance: 'tighten the output' });
  const report = reportText();
  const reported = admitReport({ report, approval: approvalFor(report), target: 'changelog' });
  assert.deepEqual(Object.keys(guided).sort(), Object.keys(reported).sort());
  assert.deepEqual(
    Object.keys(guided.change_request).sort(),
    Object.keys(reported.change_request).sort(),
  );
  assert.equal(guided.lineage, null, 'only the report subflow produces lineage');
});

test('the human-guidance path is unchanged and needs no report at all', () => {
  const request = groundingFromGuidance({
    target: 'changelog',
    guidance: 'the degraded path should say which reason applied',
  });

  assert.equal(request.source, 'human-guidance');
  assert.equal(request.report_sha256, null);
  assert.deepEqual(request.recommendation_ids, []);
  assert.equal(request.changes[0].statement, 'the degraded path should say which reason applied');

  // The same command grounds it, in the same shape, with no receipt.
  const guided = admitGuidance({ target: 'changelog', guidance: 'tighten the output' });
  const reported = admitReport({
    report: reportText(),
    approval: approvalFor(reportText()),
    target: 'changelog',
  });
  assert.deepEqual(Object.keys(guided).sort(), Object.keys(reported).sort());
  assert.equal(guided.status, 'admitted');
  assert.equal(guided.lineage, null, 'guidance carries no report lineage and needs no receipt');

  const entry = flat(ENTRY);
  assert.match(entry, /Human guidance stands alone/);
  assert.match(entry, /no synthetic report is ever manufactured/);
});

test('the report is never approved, validated, or edited here', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /Never approves, validates, or edits the evidence/);
  assert.match(entry, /never mark(s)? a report approved|does not mark a\s+report approved/);
  assert.match(entry, /anything under `skills\/post-mortem\//);
  assert.match(flat(INTAKE), /It never marks a report approved/);

  // The guard agrees: a post-mortem path is a foreign skill and is not writable.
  assert.equal(
    classifyWritePath(REPOSITORY_ROOT, 'reinforce-skill', 'skills/post-mortem/SKILL.md'),
    WRITE_CLASS.foreignSkill,
  );
  assert.equal(isWritableClass(WRITE_CLASS.foreignSkill), false);
});

test('both units agree on what a routable skill name is', () => {
  // Two definitions would eventually disagree, and the disagreement that
  // matters is intake admitting a target the write-boundary guard refuses.
  assert.ok(SKILL_NAME_PATTERN.test('changelog'));
  for (const rejected of ['_base', 'Changelog', 'a/b', '../roast', '']) {
    assert.ok(!SKILL_NAME_PATTERN.test(rejected), `${rejected} is not a routable name`);
    assert.equal(
      admitReport({
        report: reportText(),
        approval: approvalFor(reportText(), 'changelog'),
        target: rejected,
      }).status,
      'refused',
    );
  }
});

test('every suite this package ships runs in continuous integration', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join('/'));
      }
    }
  };
  walk(path.join(SKILLS_ROOT, 'reinforce-skill'));

  assert.ok(found.length >= 2, 'the walk found fewer suites than shipped');
  const unregistered = found.filter((file) => !workflow.includes(file)).sort();
  assert.deepEqual(unregistered, [], `never run in continuous integration: ${unregistered.join(', ')}`);
});

/**
 * Every release-check command any document spells, as its flag list.
 *
 * Extracted rather than restated: the failure this guards against is a document
 * that omits a required flag, and a test that restates the command would agree
 * with itself while the document was wrong.
 */
function documentedCommands(marker, { excluding = [] } = {}) {
  const sources = [
    ['SKILL.md', read(ENTRY)],
    ['report-intake.md', read(INTAKE)],
    ['report-intake.mjs usage', INTAKE_USAGE],
  ];
  const found = [];
  for (const [name, body] of sources) {
    // A command may be wrapped over several lines with a trailing backslash.
    const joined = body.replace(/\\\n\s*/g, ' ');
    for (const line of joined.split('\n')) {
      // A command, not prose about one: it invokes the script.
      if (!line.includes(marker) || !line.includes('report-intake.mjs')) {
        continue;
      }
      const flags = [...line.matchAll(/(--[a-z-]+)/g)].map((match) => match[1]);
      if (excluding.some((flag) => flags.includes(flag))) {
        continue;
      }
      found.push({ name, flags });
    }
  }
  return found;
}

const documentedReleaseCommands = () => documentedCommands('--require-admitted-state');
const documentedAdmissionCommands = () => documentedCommands('--approval', {
  excluding: ['--require-admitted-state', '--guidance'],
});

test('every documented command spells every flag it requires', () => {
  const documented = documentedReleaseCommands();
  assert.ok(documented.length >= 3, 'the command is documented in the skill, the unit, and the usage text');

  for (const { name, flags } of documented) {
    assert.deepEqual(
      [...flags].sort(),
      [...RELEASE_CHECK_FLAGS].sort(),
      `${name} spells a release check that would exit 1 on usage rather than checking anything`,
    );
  }

  const admissions = documentedAdmissionCommands();
  assert.ok(admissions.length >= 2, 'the admission command is documented in the unit and the usage text');
  for (const { name, flags } of admissions) {
    assert.deepEqual(
      [...flags].sort(),
      [...ADMISSION_FLAGS].sort(),
      `${name} spells an admission that would return no change request`,
    );
  }
  assert.deepEqual(
    admissionCommand({ report: 'r', target: 't', approval: 'a', root: 'x', state: 's' })
      .filter((token) => token.startsWith('--')),
    ADMISSION_FLAGS,
  );

  // The builder is the single definition the documents are checked against.
  assert.deepEqual(
    releaseCheckCommand({ state: 's', report: 'r', target: 't', root: 'x' }),
    ['--require-admitted-state', 's', '--report', 'r', '--target', 't', '--root', 'x'],
  );
  assert.deepEqual(
    releaseCheckCommand({ state: 's', report: 'r', target: 't', root: 'x' })
      .filter((token) => token.startsWith('--')),
    RELEASE_CHECK_FLAGS,
  );
});

test('the documented release check actually runs, and satisfies only a real admission', () => {
  withFixtureRepository((fixture) => {
    const report = reportText();
    const reportPath = path.join(fixture.outside, 'report.json');
    const approvalPath = path.join(fixture.outside, 'approval.json');
    const statePath = path.join(fixture.repository, '.skill-log', 'admission.json');
    fs.writeFileSync(reportPath, report);
    fs.writeFileSync(approvalPath, JSON.stringify(approvalFor(report)));

    const admitted = spawnSync(process.execPath, [
      INTAKE_CLI, '--report', reportPath, '--target', 'changelog', '--approval', approvalPath,
      '--root', fixture.repository, '--state', statePath,
    ], { encoding: 'utf8' });
    assert.equal(admitted.status, 0);

    // Run each documented flag list with real values substituted in order, so a
    // document that drifts fails here rather than at publication time.
    const values = {
      '--require-admitted-state': statePath,
      '--report': reportPath,
      '--target': 'changelog',
      '--root': fixture.repository,
    };
    for (const { name, flags } of documentedReleaseCommands()) {
      const argv = flags.flatMap((flag) => [flag, values[flag]]);
      const run = spawnSync(process.execPath, [INTAKE_CLI, ...argv], { encoding: 'utf8' });
      assert.equal(run.status, 0, `${name}'s command must run and pass, not exit on usage`);
      assert.equal(JSON.parse(run.stdout).requirement, 'satisfied');
    }

    // And the documented admission command, which produced that receipt in the
    // first place, is run the same way.
    values['--approval'] = approvalPath;
    values['--state'] = path.join(fixture.repository, '.skill-log', 'redone.json');
    for (const { name, flags } of documentedAdmissionCommands()) {
      const argv = flags.flatMap((flag) => [flag, values[flag]]);
      const run = spawnSync(process.execPath, [INTAKE_CLI, ...argv], { encoding: 'utf8' });
      assert.equal(run.status, 0, `${name}'s admission command must run and admit`);
      const parsed = JSON.parse(run.stdout);
      assert.equal(parsed.status, 'admitted');
      assert.equal(parsed.admission_state, 'recorded');
    }

    // And the builder's own spelling agrees with the documents.
    const built = spawnSync(process.execPath, [
      INTAKE_CLI,
      ...releaseCheckCommand({
        state: statePath, report: reportPath, target: 'changelog', root: fixture.repository,
      }),
    ], { encoding: 'utf8' });
    assert.equal(built.status, 0);
  });
});

test('exit 1 is a stop, and the skill says so where publication depends on it', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /\*\*Exit `1` is also a stop, never a pass:\*\*/);
  assert.match(entry, /Only exit `0` permits publication/);
  assert.match(flat(INTAKE), /a usage error is a stop, never a pass/i);

  // Behaviour, not just the sentence: a release check missing a required flag
  // exits 1 and reports nothing a caller could mistake for a result.
  withFixtureRepository((fixture) => {
    const report = reportText();
    const reportPath = path.join(fixture.outside, 'report.json');
    fs.writeFileSync(reportPath, report);
    const statePath = path.join(fixture.repository, '.skill-log', 'admission.json');

    for (const omitted of RELEASE_CHECK_FLAGS) {
      const argv = releaseCheckCommand({
        state: statePath, report: reportPath, target: 'changelog', root: fixture.repository,
      });
      const at = argv.indexOf(omitted);
      const short = [...argv.slice(0, at), ...argv.slice(at + 2)];
      const run = spawnSync(process.execPath, [INTAKE_CLI, ...short], { encoding: 'utf8' });
      assert.notEqual(run.status, 0, `omitting ${omitted} must never exit 0`);
      assert.ok(!run.stdout.includes('"requirement": "satisfied"'),
        `omitting ${omitted} must never look like a release check that passed`);
      if (omitted === '--require-admitted-state') {
        assert.match(run.stdout, /"admitted-unrecorded"|"refused"/);
      } else {
        assert.equal(run.stdout, '', 'a usage failure reports no result at all');
      }
    }
  });
});

function scanDocumentedCandidate({ root, git, write }, base, head) {
  const validation = read(ENTRY).split('**Validate.**')[1].split('**Roast exact candidate.**')[0];
  const template = validation.match(/```json\n([\s\S]*?)\n\s*```/)?.[1];
  assert.ok(template, 'the root supplies the supported cumulative scan event, not hidden fixture instructions');
  const event = JSON.parse(template.replaceAll('<original-base>', base).replaceAll('<candidate-head>', head));
  const binding = validation.match(/([A-Z_]+)="<absolute-candidate-event.json>" node skills\/run-ci\/_atoms\/ci-runner\/ci-runner.mjs --run --json/);
  assert.ok(binding, 'the root wires the event into the existing declared CI invocation');
  const eventPath = path.join(root, '.skill-log', 'candidate-event.json');
  write('.skill-log/candidate-event.json', JSON.stringify(event));
  const before = { head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') };
  const command = [fileURLToPath(new URL('../../scripts/scan-sensitive.mjs', import.meta.url)), '--repository', root];
  const execution = spawnSync(process.execPath, command, {
    encoding: 'utf8',
    env: { ...process.env, [binding[1]]: eventPath,
      REDACT_SENSITIVE_CONFIG_JSON: JSON.stringify({ version: 1, identifiers: [] }),
      REDACT_SENSITIVE_CONFIG_REQUIRED: 'false' },
  });
  assert.equal(execution.error, undefined);
  assert.equal(execution.signal, null);
  const result = JSON.parse(execution.stdout);
  assert.ok(Array.isArray(result.findings) && Array.isArray(result.unscanned),
    'missing output is not complete coverage');
  assert.deepEqual({ head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}') }, before);
  return { base, head, tree: before.tree, event, command, exitCode: execution.status, result };
}

test('actual scanner misses precommit and last-commit-only content but catches the documented cumulative candidate', async () => {
  await withWorkflowFixture(async (fixture) => {
    const { root, git, write } = fixture;
    git('commit', '--allow-empty', '-qm', 'safe baseline predecessor');
    const base = git('rev-parse', 'HEAD');
    const first = 'skills/changelog/first.txt';
    const retained = 'skills/changelog/retained.txt';
    const content = `${['author', 'example.test'].join('@')}\n`;
    write(first, content);
    write(retained, content);
    git('add', '.');
    const precommit = scanRepository({ repository: root });
    assert.deepEqual(precommit.findings, [], 'the old committed range misses even a staged candidate');
    assert.deepEqual(precommit.unscanned, []);
    git('commit', '-qm', 'candidate with data-bearing fixture');
    const candidate = git('rev-parse', 'HEAD');
    const firstScan = scanDocumentedCandidate(fixture, base, candidate);
    assert.equal(firstScan.exitCode, 1);
    assert.deepEqual(firstScan.result.unscanned, []);
    const emailPaths = (result) => result.findings
      .filter((finding) => finding.evidenceType === 'email' && finding.anchor.source === 'added-content')
      .map((finding) => finding.anchor.path).sort();
    assert.deepEqual(emailPaths(firstScan.result), [first, retained]);

    write(first, 'corrected\n');
    git('add', '.');
    git('commit', '-qm', 'partial correction');
    const correction = git('rev-parse', 'HEAD');
    const lastCommitOnly = scanRepository({ repository: root });
    assert.deepEqual(lastCommitOnly.findings, [], 'the latest commit alone misses retained earlier additions');
    assert.deepEqual(lastCommitOnly.unscanned, []);
    const cumulative = scanDocumentedCandidate(fixture, base, correction);
    assert.equal(cumulative.exitCode, 1);
    assert.deepEqual(emailPaths(cumulative.result), [retained]);
    assert.deepEqual(cumulative.result.unscanned, []);
    assert.equal(cumulative.event.pull_request.base.sha, base);
    assert.equal(cumulative.event.pull_request.head.sha, correction);

    write(retained, 'corrected too\n');
    git('add', '.');
    git('commit', '-qm', 'complete correction');
    const corrected = scanDocumentedCandidate(fixture, base, git('rev-parse', 'HEAD'));
    assert.equal(corrected.exitCode, 0);
    assert.deepEqual(corrected.result.findings, []);
    assert.deepEqual(corrected.result.unscanned, []);
    assert.equal(git('status', '--porcelain'), '');
  });
});

test('root blocks a committed scanner finding before review or publication', async () => {
  await withWorkflowFixture(async (fixture) => {
    const result = await driveRoot(fixture, {
      afterImplement: ({ write }) => {
        write('skills/changelog/data.txt', `${['author', 'example.test'].join('@')}\n`);
      },
      review: () => assert.fail('a failed candidate must not reach independent review'),
      publish: () => assert.fail('a failed candidate cannot publish'),
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.trace.at(-1), 'validate');
    assert.ok(result.trace.indexOf('commit candidate') < result.trace.indexOf('validate'));
    assert.equal(result.validations[0].head, result.head);
    assert.equal(result.validations[0].exitCode, 1);
    assert.ok(result.validations[0].result.findings.some((finding) => finding.evidenceType === 'email'));
    assert.deepEqual(result.validations[0].result.unscanned, []);
    assert.equal(result.gitStatus, '');
  });
});

const OUTCOME_PROGRAM = `const unavailable = process.argv.includes('--unavailable');
console.log(JSON.stringify(unavailable
  ? { status: 'degraded', reason: 'tool unavailable' }
  : { status: 'ambiguous', paths: ['CHANGELOG.md', 'nested/CHANGELOG.md'] }));
`;

async function withWorkflowFixture(action, { satisfied = false } = {}) {
  const root = fs.mkdtempSync(path.join(REPOSITORY_ROOT, '.reinforce-workflow-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const write = (relative, text) => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  };
  try {
    write('.gitignore', '.skill-log/\n');
    write('CHANGELOG.md', '# Changelog\n');
    write('skills/changelog/intent.md', FIXTURE_INTENT.replaceAll(FIXTURE_SKILL, 'changelog'));
    write('skills/changelog/SKILL.md', `---
name: changelog
description: Name ambiguous changelog targets and explain unavailable tooling.
allowed-tools: ["read","execute"]
includes: ["changelog/_atoms/outcome/outcome.md"]
composes: ["changelog/_atoms/outcome/outcome.md"]
disable-model-invocation: true
user-invocable: true
---

# Changelog

## Required References

1. [Outcome](./_atoms/outcome/outcome.md)
`);
    write('skills/changelog/_atoms/outcome/outcome.md', `---
name: outcome
description: Report the target or degradation.
level: atom
allowed-tools: ["execute"]
includes: ["changelog/_atoms/outcome/outcome.mjs"]
composes: []
used-by: ["changelog/SKILL.md"]
---

# Outcome

## Required Files

1. [Implementation](./outcome.mjs)
`);
    write('skills/changelog/_atoms/outcome/outcome.mjs',
      satisfied ? OUTCOME_PROGRAM : "console.log(JSON.stringify({ status: 'silent' }));\n");
    git('init', '-q');
    git('config', 'user.name', 'Workflow Fixture');
    git('config', 'user.email', 'test-identity');
    git('config', 'commit.gpgsign', 'false');
    git('add', '.');
    git('commit', '-qm', 'fixture baseline');
    await action({ root, git, write });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// Execute the sequence extracted from the real root, not a second production
// orchestrator. Effects are local Git/files/checks or explicitly injected review
// and publication callbacks; no provider or agent is invoked by these fixtures.
async function driveRoot(fixture, {
  source = 'human-guidance', probe = false, verify, review, publish, beforeAudit, beforeSnapshot,
  report = reportText(), approval, beforeVerify, afterVerify, afterImplement,
} = {}) {
  const { root, git, write } = fixture;
  const stages = read(ENTRY).match(/```text\n([^\n]+)\n```/)[1].split(' -> ');
  const trace = [];
  let base, target, intake, state, prior, head, snapshot, audit, ledger;
  let status, verification, admissions = 0, validationHead;
  const validations = [];
  const reportPath = path.join(root, '.skill-log', 'report.json');
  const receiptPath = path.join(root, '.skill-log', 'receipt.json');
  const program = 'skills/changelog/_atoms/outcome/outcome.mjs';
  const check = (unavailable = false) => execFileSync(process.execPath,
    [path.join(root, program), ...(unavailable ? ['--unavailable'] : [])], { encoding: 'utf8' });
  const handlers = {
    'isolate branch and record base': () => {
      assert.equal(git('status', '--porcelain'), '');
      base = git('rev-parse', 'HEAD');
      git('switch', '-qc', 'reinforce/fixture');
    },
    'resolve the target': () => { target = resolveSkillTarget(root, 'changelog'); },
    'admit the evidence': () => {
      admissions += 1;
      intake = source === 'human-guidance'
        ? admitGuidance({ target: target.skillName, guidance: 'Name both ambiguous paths and explain unavailable tooling.' })
        : admitReport({ report, approval: approval ?? approvalFor(report), target: target.skillName });
      if (intake.status !== 'admitted') { status = intake.status; return; }
      if (source !== 'human-guidance') {
        write('.skill-log/report.json', report);
        write('.skill-log/receipt.json', JSON.stringify(buildAdmissionReceipt(intake)));
      }
    },
    'ground on its intent': () => {
      prior = fs.readFileSync(path.join(root, 'skills/changelog/intent.md'), 'utf8');
      assert.ok(fs.readFileSync(path.join(root, 'skills/changelog/SKILL.md'), 'utf8'));
      assert.ok(check());
    },
    'decide the intent': () => {
      state = decisionApplyEvent(createDecision({ skill: target.skillName, priorIntent: prior }),
        { type: 'decide', decision: 'preserves-intent', reasoning: 'The existing purpose includes explicit outcomes.' });
    },
    'verify requested outcome': async () => {
      if (!probe) { assert.equal(JSON.parse(check()).status, 'silent'); return; }
      beforeVerify?.({ intake, write, state });
      verification = await verifyRequestedOutcome({
        state, intake, repositoryRoot: root, base, reportPath, receiptPath,
        verify: async (context) => {
          const observed = verify ? await verify({ ...context, check, write, git }) : (() => {
            const normal = check();
            const unavailable = check(true);
            const satisfied = JSON.parse(normal).status === 'ambiguous'
              && JSON.parse(normal).paths.length === 2
              && JSON.parse(unavailable).status === 'degraded'
              && JSON.parse(unavailable).reason === 'tool unavailable';
            return { status: satisfied ? 'satisfied' : 'change-needed',
              reasoning: 'Both target ambiguity and unavailable-tool behavior were exercised; no silent selection or silent degradation.',
              evidence: `node ${program}\n${normal}node ${program} --unavailable\n${unavailable}` };
          })();
          afterVerify?.({ write });
          return observed;
        },
      });
      if (verification.status !== 'change-needed') status = verification.status;
    },
    'implement and derive': () => {
      assert.equal(requireIntentDecision(state).requirement, 'satisfied');
      assert.equal(classifyWritePath(root, target.skillName, program), WRITE_CLASS.inTarget);
      write(program, OUTCOME_PROGRAM);
      if (ledger) fs.appendFileSync(path.join(root, 'skills/changelog/SKILL.md'), '\nReport both outcomes explicitly.\n');
      applyUpdates(deriveGraph(root));
      afterImplement?.({ root, git, write });
    },
    'include changelog': () => {
      fs.appendFileSync(path.join(root, 'CHANGELOG.md'), ledger
        ? '\nClarify the changelog outcome explanation.\n' : '\nReport ambiguous paths and unavailable tooling.\n');
    },
    'validate': () => {
      assert.equal(head, git('rev-parse', 'HEAD'), 'validation requires the complete committed candidate');
      assert.equal(git('status', '--porcelain'), '', 'working-copy checks must read exactly that candidate');
      assert.deepEqual(JSON.parse(check()), { status: 'ambiguous', paths: ['CHANGELOG.md', 'nested/CHANGELOG.md'] });
      assert.deepEqual(JSON.parse(check(true)), { status: 'degraded', reason: 'tool unavailable' });
      assert.ok(git('show', `${head}:CHANGELOG.md`).includes('ambiguous'));
      const scan = scanDocumentedCandidate(fixture, base, head);
      validations.push(scan);
      if (scan.exitCode !== 0 || scan.result.findings.length || scan.result.unscanned.length
        || scan.result.configuration.blocking) { status = 'blocked'; return; }
      validationHead = head;
    },
    'commit candidate': () => {
      validationHead = null;
      git('add', '.');
      git('commit', '-qm', ledger ? 'fixture correction' : 'fixture candidate');
      head = git('rev-parse', 'HEAD');
      if (ledger) {
        const mandatory = reinforceRoast.unresolvedFindings(ledger).find((entry) => entry.priority === 'Must fix');
        reinforceRoast.applyEvent(ledger, mandatory
          ? { type: 'finding-resolved', findingId: mandatory.id, head, changedPaths: ['skills/changelog/SKILL.md'] }
          : { type: 'correction', head, changedPaths: [program] });
      } else ledger = reinforceRoast.createLedger({ packagePath: target.relativePath, head });
      assert.equal(git('status', '--porcelain'), '');
    },
    'roast exact candidate': async () => {
      assert.equal(validationHead, head, 'only the validated committed revision reaches review');
      assert.equal(git('rev-parse', 'HEAD'), validationHead);
      assert.equal(git('status', '--porcelain'), '');
      const reviewed = await (review ?? (async ({ head: revision }) => ({
        revision, status: 'Complete', coverage: true, findings: [],
      })))({ head, base, git, check, round: ledger.round });
      assert.equal(reviewed.revision, head, 'review must bind the immutable candidate');
      assert.equal(reviewed.status, 'Complete');
      assert.equal(reviewed.coverage, true);
      assert.ok(git('show', `${head}:CHANGELOG.md`).includes('ambiguous'));
      reinforceRoast.applyEvent(ledger, { type: 'roast-recorded', head, findings: reviewed.findings });
      reinforceRoast.applyEvent(ledger, { type: 'round-closed' });
    },
    'final audit and release checks': () => {
      assert.equal(reinforceRoast.assertRoastComplete(ledger).remediation, 'clean');
      beforeSnapshot?.({ git, write });
      snapshot = captureAuditSnapshot(root, target.skillName, base);
      assert.equal(snapshot.head, head, 'snapshot must bind the reviewed head, not a later HEAD');
      assert.equal(snapshot.tree, git('rev-parse', `${head}^{tree}`));
      const snapshotDigest = auditSnapshotDigest(snapshot);
      const companions = [{
        path: 'CHANGELOG.md', kind: 'changelog', reason: 'Record this target change.',
        relationship: 'The same reinforcement requires an entry.',
        previous_sha256: digestOf(`${git('show', `${base}:CHANGELOG.md`)}\n`),
        next_sha256: digestOf(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')),
      }];
      beforeAudit?.({ git, write, snapshot, head });
      audit = auditRepositoryDiff(root, target.skillName, base, { snapshot, snapshotDigest, companions });
      if (!audit.clean) { status = 'blocked'; return; }
      assertDiffMatchesDecision(state, audit.classified.map((entry) => entry.path), { repositoryRoot: root });
      assert.equal(requireIntentDecision(state).requirement, 'satisfied');
      if (source !== 'human-guidance') assert.equal(requireAdmittedState({
        state: JSON.parse(fs.readFileSync(receiptPath)), report: fs.readFileSync(reportPath, 'utf8'), target: target.skillName,
      }).requirement, 'satisfied');
    },
    publish: async () => { await publish?.({ head, audit }); status = 'reinforced'; },
  };
  for (let index = 0; index < stages.length; index += 1) {
    const stage = stages[index];
    trace.push(stage);
    assert.equal(typeof handlers[stage], 'function', `unrecognized root stage: ${stage}`);
    await handlers[stage]();
    if (status) break;
    if (stage === 'roast exact candidate' && reinforceRoast.unresolvedFindings(ledger).length) {
      assert.ok(ledger.round < 3, 'fixture never auto-confirms a human pause');
      index = stages.indexOf('implement and derive') - 1;
    }
  }
  return { status, trace, admissions, verification, validations, base, head, audit, ledger, gitStatus: git('status', '--porcelain') };
}

test('root commits the complete candidate before cumulative validation and repeats that binding for corrections', async () => {
  await withWorkflowFixture(async (fixture) => {
    const reviews = [];
    let publications = 0;
    const result = await driveRoot(fixture, {
      review: async ({ head, git }) => {
        reviews.push(head);
        assert.ok(git('show', `${head}:CHANGELOG.md`).includes('ambiguous'));
        return { revision: head, status: 'Complete', coverage: true,
          findings: reviews.length === 1 ? [{
            id: 'explanation', priority: 'Must fix', location: 'skills/changelog/SKILL.md',
            evidence: 'The explanation omits outcomes.', consequence: 'Readers miss the result.',
            recommendation: 'Describe both outcomes.',
          }] : [] };
      },
      publish: async ({ head, audit }) => { assert.equal(head, reviews.at(-1)); assert.ok(audit.clean); publications += 1; },
    });
    assert.equal(result.status, 'reinforced');
    assert.equal(result.admissions, 1);
    assert.equal(reviews.length, 2);
    assert.notEqual(reviews[0], reviews[1]);
    assert.equal(result.trace.filter((stage) => stage === 'validate').length, 2);
    assert.deepEqual(result.validations.map((entry) => entry.head), reviews);
    assert.ok(result.validations.every((entry) => entry.base === result.base
      && entry.event.pull_request.base.sha === result.base
      && entry.event.pull_request.head.sha === entry.head
      && entry.exitCode === 0));
    assert.equal(fixture.git('rev-list', '--count', `${result.base}..${result.head}`), '2',
      'one complete commit per candidate, not provisional plus final commits');
    assert.equal(result.trace.filter((stage) => stage === 'final audit and release checks').length, 1);
    assert.equal(result.audit.head, reviews[1]);
    assert.deepEqual(reinforceRoast.ledgerReport(result.ledger).acrossRun.resolved.map((entry) => entry.id), ['explanation']);
    assert.equal(result.gitStatus, '');
    assert.equal(publications, 1);
  });
});

test('root publication refuses candidate drift after review, even when changed paths are in target', async () => {
  for (const committed of [false, true]) {
    await withWorkflowFixture(async (fixture) => {
      const attempt = driveRoot(fixture, {
        beforeAudit: ({ write, git }) => {
          write('skills/changelog/drift.txt', 'unreviewed\n');
          if (committed) { git('add', '.'); git('commit', '-qm', 'unreviewed drift'); }
        },
        publish: () => assert.fail('drift must prevent publication'),
      });
      if (committed) {
        await assert.rejects(attempt, { code: 'invalid_snapshot' });
      } else {
        const result = await attempt;
        assert.equal(result.status, 'blocked');
        assert.equal(result.audit.clean, false);
      }
    });
  }
});

test('already-satisfied traverses the real root through grounding and verification, with no mutation or publication', async () => {
  for (const source of ['human-guidance', 'post-mortem-report']) {
    await withWorkflowFixture(async (fixture) => {
      const before = fixture.git('rev-parse', 'HEAD');
      const result = await driveRoot(fixture, { source, probe: true,
        review: () => assert.fail('no synthetic review'), publish: () => assert.fail('no synthetic publication') });
      assert.equal(result.status, 'already-satisfied', JSON.stringify(result.verification));
      assert.equal(result.admissions, 1);
      assert.equal(fixture.git('rev-parse', 'HEAD'), before);
      assert.equal(result.gitStatus, '');
      assert.equal(result.trace.at(-1), 'verify requested outcome');
      assert.ok(!result.trace.includes('implement and derive'));
      assert.equal(fs.readFileSync(path.join(fixture.root, 'CHANGELOG.md'), 'utf8'), '# Changelog\n');
      assert.ok(result.verification.evidence.every((entry) => entry.evidence.includes('tool unavailable')));
      assert.equal(result.verification.admission.requirement,
        source === 'human-guidance' ? 'not-applicable' : 'satisfied');
    }, { satisfied: true });
  }
});

test('no-change cannot be inferred from incomplete evidence, altered grounding, stale approval or no applicable recommendations', async () => {
  const cases = [
    { verify: async () => ({ status: 'satisfied' }) },
    { verify: async () => ({ status: 'incomplete', reasoning: 'Required independent trial missing.', evidence: 'Only one example exists.' }) },
    { source: 'post-mortem-report', beforeVerify: ({ intake }) => { intake.change_request.changes[0].statement = 'An unrelated requirement.'; } },
    { source: 'post-mortem-report', beforeVerify: ({ intake }) => { intake.change_request.source = 'human-guidance'; } },
    { source: 'post-mortem-report', beforeVerify: ({ write }) => { write('.skill-log/report.json', `${reportText()} `); } },
    { source: 'post-mortem-report', afterVerify: ({ write }) => { write('.skill-log/report.json', `${reportText()} `); } },
    { beforeVerify: ({ state }) => { state.decision = null; state.status = 'undecided'; } },
    { verify: async ({ write }) => { write('skills/changelog/unasked.txt', 'mutation'); return { status: 'satisfied', reasoning: 'Claim', evidence: 'Output' }; } },
  ];
  for (const options of cases) {
    await withWorkflowFixture(async (fixture) => {
      const result = await driveRoot(fixture, { ...options, probe: true,
        publish: () => assert.fail('insufficient evidence cannot publish') });
      assert.equal(result.status, 'blocked');
      assert.ok(!result.trace.includes('include changelog'));
    }, { satisfied: true });
  }
  await withWorkflowFixture(async (fixture) => {
    const result = await driveRoot(fixture, { source: 'post-mortem-report', probe: true,
      report: reportText({ recommendations: [] }) });
    assert.equal(result.status, 'no-applicable-recommendations');
    assert.ok(!result.trace.includes('decide the intent'));
  }, { satisfied: true });
});

test('root rejects drift before snapshot capture and incomplete or wrong-revision review callbacks', async () => {
  for (const options of [
    { beforeSnapshot: ({ git, write }) => {
      write('skills/changelog/later.txt', 'not reviewed\n');
      git('add', '.'); git('commit', '-qm', 'later candidate');
    } },
    { review: async ({ base }) => ({ revision: base, status: 'Complete', coverage: true, findings: [] }) },
    { review: async ({ head }) => ({ revision: head, status: 'Partial', coverage: true, findings: [] }) },
    { review: async ({ head }) => ({ revision: head, status: 'Complete', coverage: false, findings: [] }) },
  ]) {
    await withWorkflowFixture(async (fixture) => {
      await assert.rejects(driveRoot(fixture, {
        ...options, publish: () => assert.fail('unreviewed content cannot publish'),
      }), { code: 'ERR_ASSERTION' });
    });
  }
});
