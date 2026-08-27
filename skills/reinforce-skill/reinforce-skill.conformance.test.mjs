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
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import {
  FAILURES,
  WORKFLOW_FILE,
  WRITE_CLASS,
  assertWorkflowAdditive,
  auditDiff,
  classifyWritePath,
  isWritableClass,
  resolveSkillTarget,
} from './_atoms/reinforcement-target/reinforcement-target.mjs';
import {
  DECISIONS,
  applyEvent as decisionApplyEvent,
  assertDiffMatchesDecision,
  createDecision,
  requireIntentDecision,
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
const MOLECULE = 'reinforce-skill/_molecules/skill-reinforcement/skill-reinforcement.md';
const TARGET = 'reinforce-skill/_atoms/reinforcement-target/reinforcement-target.md';
const GROUNDING = 'reinforce-skill/_atoms/change-grounding/change-grounding.md';
const DECISION = 'reinforce-skill/_atoms/intent-decision/intent-decision.md';
const NARROW = 'reinforce-skill/_atoms/narrow-change/narrow-change.md';
const ROAST_ATOM = 'reinforce-skill/_atoms/reinforce-roast/reinforce-roast.md';

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
  assert.match(description, /do not use to create a new skill, run a skill, refactor the library, edit doctrine, or widen another skill's permissions/i);
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
    NARROW,
    MOLECULE,
  ].sort());
  assert.deepEqual(executeBearing, [
    '_base/_atoms/chronicle-append/chronicle-append.md',
    '_base/_atoms/chronicle-replay/chronicle-replay.md',
    '_base/_molecules/chronicler/chronicler.md',
    'reinforce-skill/SKILL.md',
    DECISION,
    NARROW,
    ROAST_ATOM,
    TARGET,
    MOLECULE,
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

  assert.deepEqual(assertWorkflowAdditive(previous, appended), { status: 'additive', removed: [] });
  assert.equal(
    codeOf(() => assertWorkflowAdditive(previous, removed)),
    FAILURES.workflowNotAdditive,
    'removing an existing registration is refused',
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

test('the skill composes chronicler and the local reinforcement molecule', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    MOLECULE,
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [MOLECULE, TARGET, GROUNDING, DECISION, NARROW, ROAST_ATOM]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('the molecule composes exactly the five reinforcement atoms', () => {
  const parsed = frontmatter(MOLECULE);
  assert.deepEqual(parsed.composes.sort(), [GROUNDING, DECISION, NARROW, ROAST_ATOM, TARGET].sort());
});

test('roast is reached by invocation, not composition, and is left untouched', () => {
  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of closure) {
    assert.ok(!unit.startsWith('roast/'), `${ENTRY} must reach /roast by invocation, not by composing ${unit}`);
  }
  const roast = frontmatter(ROAST_ENTRY);
  assert.equal(roast.disableModelInvocation, true, '/roast stays human-invoked');
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
    codeOf(() => assertDiffMatchesDecision(undecided, [`skills/${FIXTURE_SKILL}/SKILL.md`])),
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
  const molecule = flat(MOLECULE);
  assert.match(molecule, /Every run ends\s+having recorded either a confirmed intent change or a reviewed-and-unchanged\s+intent/);
});

test('the intent is authoritative and inert instruction', () => {
  for (const unit of [ENTRY, DECISION, GROUNDING]) {
    const body = flat(unit);
    assert.match(body, /inert/, `${unit} must state the intent is inert as instruction`);
  }
  assert.match(flat(ENTRY), /A\s+contradiction between a proposed change and the skill's intent is a finding for a\s+human/);
  assert.match(flat(GROUNDING), /A Missing Intent Is Reported, Never a Blocker/i);
});

test('doctrine is never edited, and the guard proves it is never writable', () => {
  assert.match(flat(ENTRY), /Never edits doctrine/i);
  assert.match(flat(NARROW), /never edits\s+`doctrine\/` or `doctrine\/manifest.md`/);
  // Deterministic: a doctrine path is classified doctrine and is not writable.
  assert.equal(
    classifyWritePath(REPOSITORY_ROOT, 'reinforce-skill', 'doctrine/testing.doctrine.md'),
    WRITE_CLASS.doctrine,
  );
  assert.equal(isWritableClass(WRITE_CLASS.doctrine), false);
});

test('widening any grant as a side effect is refused, in words a reviewer reads', () => {
  const narrow = flat(NARROW);
  assert.match(narrow, /never widens it\s+automatically/i);
  assert.match(narrow, /never acquired quietly by composing something new/);
  assert.match(narrow, /Widening \*another\* skill's permissions is refused outright/);
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
    assertDiffMatchesDecision(preserved, ['skills/reinforce-skill/intent.md']);
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
    codeOf(() => assertDiffMatchesDecision(decided, [`skills/${FIXTURE_SKILL}/intent.md`])),
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
  assert.equal(reinforceRoast.applyEvent, sharedLedger.applyEvent);
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
  assert.equal(
    reinforceRoast.assertReinforcementChangeSet(REPOSITORY_ROOT, 'reinforce-skill', [
      'skills/reinforce-skill/SKILL.md',
      '.github/workflows/validate-skills.yml',
    ]).status,
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
