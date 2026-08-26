/**
 * Conformance tests for the ship package, stage two.
 *
 * Ship now holds real authority, so the properties pinned here are the ones
 * whose loss would be invisible in prose:
 *
 * Assertions here pin contracts — vocabulary, ordering, permissions,
 * composition — rather than the wording of the paragraph that explains them.
 * A test that fails when a sentence is reflowed protects prose, not behavior.
 *
 * 1. **Its authority is pinned to what was reviewed.** Stage two dispatches a
 *    worker and opens a change request, so it grants `task` — deliberately, as
 *    an edit somebody read, not as a side effect of composing a new unit. It
 *    still grants no `edit`, and the set of units carrying `execute` and `task`
 *    is fixed so a new one is a reviewable change.
 * 2. **Scope creep is refused structurally.** This is the documented failure
 *    mode of every delivery run in this repository so far, and "be careful" is
 *    not a control. The control is the deterministic reconciler.
 * 3. **The merge is granted, never defaulted.** Withheld is the starting state.
 * 4. **It never merges and never grades its own work.** Validation and review
 *    stay with `run-ci`, `roast`, and `shepherd`.
 * 5. **The shepherd question is asked first.** Asked last, it stops being a
 *    decision and becomes an assumption.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { classifyTerminalDisposition } from '../shepherd/_atoms/shepherd-disposition/shepherd-disposition.mjs';
import { MERGE_GRANT_TOKEN, evaluateMergeGate, mayMerge } from './_atoms/merge-gate/merge-gate.mjs';
import { reconcile as reconcileDiff } from './_atoms/diff-reconciliation/diff-reconciliation.mjs';
import {
  NESTED_INVOCATION,
  evaluateHandoff,
  handoffSatisfied,
  publicationSucceeded,
} from './_atoms/shepherd-handoff/shepherd-handoff.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'ship/SKILL.md';
const MOLECULE = 'ship/_molecules/delivery-grounding/delivery-grounding.md';
const GROUNDING = 'ship/_atoms/issue-grounding/issue-grounding.md';
const LAZINESS = 'ship/_atoms/laziness-lens/laziness-lens.md';
const SCOPE = 'ship/_atoms/scope-boundary/scope-boundary.md';
const CYCLE = 'ship/_molecules/delivery-cycle/delivery-cycle.md';
const ISOLATION = 'ship/_atoms/run-isolation/run-isolation.md';
const DISPATCH = 'ship/_atoms/worker-dispatch/worker-dispatch.md';
const RECONCILE = 'ship/_atoms/diff-reconciliation/diff-reconciliation.md';
const CRITERION = 'ship/_atoms/criterion-verdict/criterion-verdict.md';
const MERGE_GATE = 'ship/_atoms/merge-gate/merge-gate.md';
const PUBLISH = 'ship/_atoms/change-request/change-request.md';
const HANDOFF = 'ship/_atoms/shepherd-handoff/shepherd-handoff.md';
const LANDABILITY = '_base/_atoms/landability/landability.md';

/** The grant stage two was reviewed with. Nothing here may widen it. */
const PINNED_TOOLS = ['execute', 'read', 'search', 'task'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

/**
 * Normalize a support script for prose assertions.
 *
 * Block-comment continuation markers are stripped first, so an assertion pins
 * what the comment says rather than where the author happened to wrap the
 * line. Without this, reflowing a paragraph breaks a test that has no opinion
 * about line width.
 */
function flatSource(...segments) {
  return fs
    .readFileSync(path.join(SKILLS_ROOT, ...segments), 'utf8')
    .replace(/^\s*\*[ \t]?/gm, '')
    .replace(/\s+/g, ' ');
}

test('ship is a routable single-issue delivery skill a human invokes deliberately', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'ship');
  assert.equal(parsed.userInvocable, true);

  // Stage one read an issue and returned a plan. Stage two dispatches a worker
  // that writes code and opens a change request on a shared remote, so it
  // begins because a person asked for it by name.
  assert.equal(parsed.disableModelInvocation, true);
});

test('the routing description promises review-ready, not merged', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /Take one tracker issue to review-ready/);
  assert.match(description, /reconcile every hunk against the confirmed ledger/);
  assert.match(description, /gate the merge/);
  assert.match(description, /Do not use to work a whole backlog or fleet/);
  assert.match(description, /ship-with-squadron/);
  assert.match(description, /do not use to merge, approve, accept risk/);
  assert.match(description, /drive an existing change request, which belongs to shepherd/);

  // Stage two delivers to review. Advertising that it lands the change would
  // route merge expectations here, and routing metadata is read before any
  // in-body disclaimer.
  assert.doesNotMatch(description, /merge the change|land the change/);
});

test('ship writes nothing itself, and says plainly that this is a narrow claim', () => {
  const parsed = frontmatter(ENTRY);

  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'), 'ship dispatches the writing; it does not author');
  assert.ok(!parsed.allowedTools.includes('*'));

  const entry = flat(ENTRY);

  // The honesty requirement. "No edit grant" is close to a safety argument
  // dressed up as a permission argument, because ship dispatches a worker that
  // does hold edit. The package must not be allowed to trade on the narrower
  // reading.
  assert.match(entry, /There is still no `edit` grant, and that is a narrower claim than it looks/);

  const dispatch = flat(DISPATCH);
  assert.match(dispatch, /Dispatching Is Not A Loophole/);

  const result = validateRepository(REPOSITORY_ROOT);
  for (const unit of closureFor(result, ENTRY)) {
    const tools = readFrontmatter(read(unit), unit).allowedTools ?? [];
    assert.ok(!tools.includes('edit') && !tools.includes('*'), `${unit} reaches write authority`);
  }
});

test('the task grant is new, deliberate, and justified in the body', () => {
  const entry = flat(ENTRY);

  assert.ok(frontmatter(ENTRY).allowedTools.includes('task'));
  assert.match(entry, /`task` is new in this stage, and it is the widest grant here/);

  // The set of units carrying `task` is pinned, so dispatch authority spreads
  // only when somebody decides it should. The handoff atom is here because a
  // handoff is a nested invocation in a separate worker, and narrating one
  // instead is the failure it exists to prevent.
  const result = validateRepository(REPOSITORY_ROOT);
  const taskBearing = closureFor(result, ENTRY)
    .filter((unit) => (readFrontmatter(read(unit), unit).allowedTools ?? []).includes('task'))
    .sort();

  assert.deepEqual(taskBearing, [DISPATCH, CYCLE, HANDOFF, ENTRY].sort());
});

test('the execute-bearing closure is pinned, because execute can mutate', () => {
  // `execute` runs arbitrary commands, so "no edit grant" is not proof that
  // nothing is written. The honest control is holding the set of units that
  // carry execute fixed, so a new one is a reviewable change rather than a
  // detail. This is the assertion that would catch a later stage acquiring
  // mutation quietly.
  const result = validateRepository(REPOSITORY_ROOT);
  const executeBearing = closureFor(result, ENTRY)
    .filter((unit) => (readFrontmatter(read(unit), unit).allowedTools ?? []).includes('execute'))
    .sort();

  assert.deepEqual(executeBearing, [
    '_base/_atoms/chronicle-append/chronicle-append.md',
    '_base/_atoms/chronicle-replay/chronicle-replay.md',
    '_base/_molecules/chronicler/chronicler.md',
    'ship/SKILL.md',
    'ship/_atoms/change-request/change-request.md',
    'ship/_atoms/diff-reconciliation/diff-reconciliation.md',
    'ship/_atoms/issue-grounding/issue-grounding.md',
    'ship/_atoms/run-isolation/run-isolation.md',
    'ship/_atoms/shepherd-handoff/shepherd-handoff.md',
    'ship/_molecules/delivery-cycle/delivery-cycle.md',
    'ship/_molecules/delivery-grounding/delivery-grounding.md',
  ]);
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

test('the skill composes chronicler, the grounding units, the merge gate, and publication', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    MOLECULE,
    CYCLE,
    MERGE_GATE,
    PUBLISH,
    HANDOFF,
    LANDABILITY,
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    MOLECULE, GROUNDING, LAZINESS, SCOPE,
    CYCLE, ISOLATION, DISPATCH, RECONCILE, CRITERION,
    MERGE_GATE, PUBLISH, HANDOFF,
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('the shepherd question has exactly one owner and is asked before grounding', () => {
  const entry = read(ENTRY);
  const molecule = read(MOLECULE);
  const grounding = read(GROUNDING);

  const askIndex = entry.indexOf('Ask whether to shepherd on completion');
  const groundIndex = entry.indexOf('Run [Delivery grounding]');
  assert.ok(askIndex > 0 && groundIndex > 0);
  assert.ok(askIndex < groundIndex, 'the shepherd question precedes grounding');
  assert.match(flat(ENTRY), /This skill is the only place\s+the question is asked/);

  // Structural: only the root may ask. A second asker could return a second
  // answer, and nothing defines which one wins.
  assert.match(flat(MOLECULE), /Do not ask\s+again\. The question has one owner/);
  assert.match(flat(MOLECULE), /The shepherd question is not asked here; it arrives already answered/);
  assert.match(flat(GROUNDING), /This atom records it and never\s+re-asks/);

  for (const [label, body] of [['molecule', molecule], ['grounding atom', grounding]]) {
    assert.ok(
      !/\bAsk whether\b/.test(body),
      `the ${label} must not ask the shepherd question itself`,
    );
  }
});

test('a packet is grounded only when the operator confirmed it', () => {
  const entry = flat(ENTRY);
  const molecule = flat(MOLECULE);

  for (const state of ['confirmed', 'corrected', 'not-aligned']) {
    assert.match(molecule, new RegExp(`\`${state}\``), `the alignment gate must define ${state}`);
  }
  assert.match(molecule, /A packet is `grounded` \*\*only\*\* when alignment is `confirmed`/);
  assert.match(molecule, /Otherwise the\s+run returns `needs-alignment` and stops/);
  assert.match(molecule, /No packet is `grounded` without explicit operator confirmation/);

  assert.match(entry, /A packet is `grounded` \*\*only\*\* when the operator explicitly confirmed/);
  assert.match(
    entry,
    /Silence, a status question, an unrelated reply, or a caller asserting that\s+someone already agreed are none of them confirmation/,
  );
  assert.match(entry, /an unconfirmed\s+packet must never become fixed scope/);

  // `needs-alignment` must be reachable as a terminal status, not just prose.
  assert.match(entry, /`needs-alignment`, `blocked`/);
});

test('the laziness lens cannot be used to route around the scope boundary', () => {
  const laziness = flat(LAZINESS);

  assert.match(laziness, /Leaks, and Whose They Are/);
  assert.match(
    laziness,
    /A leak counts here only when the \*\*planned change introduces it\*\*/,
  );
  assert.match(laziness, /A leak that already existed is \*\*adjacent\*\*/);
  assert.match(laziness, /it does not count against the laziness verdict/);
  assert.match(laziness, /Where this lens and the scope boundary appear\s+to disagree, the scope boundary wins/);

  // The original wording made leaving any known rough edge a failing answer,
  // which directly contradicted the scope boundary.
  assert.doesNotMatch(laziness, /A known rough edge is left because it is not strictly in scope/);
});

test('an enabling change must be justified rather than asserted', () => {
  const scope = flat(SCOPE);

  assert.match(scope, /`enabling` is the class that leaks, because necessity is easy to assert/);
  assert.match(scope, /evidence the criterion is \*\*impossible\*\* without it/);
  assert.match(scope, /the in-scope alternatives considered, and why each fails/);
  assert.match(scope, /the smallest bounded version of the change/);
  assert.match(scope, /explicit operator confirmation/);
  assert.match(scope, /Without all five it is `adjacent`/);
});

test('the change ledger is exhaustive so a later stage can match every diff unit', () => {
  const scope = flat(SCOPE);
  const molecule = flat(MOLECULE);
  const entry = flat(ENTRY);

  assert.match(scope, /Classification is exhaustive, not sampled/);
  assert.match(scope, /a stable identifier, so a later stage can map each unit of the eventual\s+diff back to exactly one confirmed `in-scope` or `enabling` entry/);
  assert.match(scope, /A change appearing in the diff with no matching ledger entry is an\s+undisclosed\s+change, and it stops the run/);
  assert.match(molecule, /the exhaustive change ledger with each\s+entry's classification and identifier/);

  // The ledger is what the diff is reconciled against, so ship must surface it
  // alongside the verdict rather than only inside the packet.
  assert.match(entry, /the exhaustive change ledger, and the reconciliation verdict/);
});

test('a dependency blocks when it prevents landing, not only when it changes requirements', () => {
  const grounding = flat(GROUNDING);
  const entry = flat(ENTRY);

  assert.match(grounding, /prevents safely\s+implementing, validating, integrating, or landing this issue/);
  assert.match(grounding, /an unavailable upstream interface, an unmerged prerequisite change/);
  for (const cls of ['blocking', 'changes-requirements', 'informational']) {
    assert.match(grounding, new RegExp(`\`${cls}\``), `dependency classes must include ${cls}`);
    assert.match(entry, new RegExp(`\`${cls}\``), `the output contract must surface ${cls}`);
  }
});

test('a blocked issue stops the run and names the blocker', () => {
  const grounding = flat(GROUNDING);
  const entry = flat(ENTRY);

  assert.match(grounding, /`blocked` \| A dependency prevents starting\. Name the blocker and why it blocks\. \|/);
  assert.match(grounding, /A blocked issue stops the run/);
  assert.match(entry, /refuses a blocked issue and names the blocker/);
  assert.match(entry, /with any blocker named and why it blocks/);
});

test('acceptance criteria are the definition of done and are numbered', () => {
  const grounding = flat(GROUNDING);
  const entry = flat(ENTRY);

  assert.match(grounding, /Extract the acceptance criteria as a numbered list/);
  assert.match(grounding, /ask for them rather than inferring a definition\s+of done from the title/);
  assert.match(entry, /definition of done as numbered acceptance criteria/);
});

test('adjacent findings are reported and never acted on', () => {
  const scope = flat(SCOPE);
  const entry = flat(ENTRY);

  for (const cls of ['in-scope', 'enabling', 'adjacent', 'out-of-scope', 'blocking-defect']) {
    assert.match(scope, new RegExp(`\`${cls}\``), `the classification must cover ${cls}`);
  }
  assert.match(scope, /`adjacent` \| A real improvement the issue did not ask for\. \| Report it\. Do not do it\. \|/);
  assert.match(scope, /The tempting case is a one-line fix in a file already being edited/);
  assert.match(scope, /It is still adjacent/);
  assert.match(entry, /Adjacent findings are reported and never\s+acted on, including a one-line fix in a file already being edited/);
});

test('validation and review are invoked as separate skills, never absorbed', () => {
  // If ship absorbs run-ci's or roast's job instead of invoking it, the "does
  // not grade its own work" boundary becomes prose only. Composing their units
  // would do exactly that, quietly.
  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  const foreign = closure.filter(
    (unit) => !unit.startsWith('ship/') && !unit.startsWith('_base/'),
  );
  assert.deepEqual(foreign, [], `ship must not reach another skill's units: ${foreign.join(', ')}`);

  const required = frontmatter(ENTRY).requiresSkills;
  const byId = new Map(required.map((entry) => [entry.id, entry]));

  // run-ci and roast are REQUIRED. Optional would let a run silently skip
  // validation or review and still report a status.
  assert.equal(byId.get('run-ci')?.required, true, 'validation may not be optional');
  assert.equal(byId.get('roast')?.required, true, 'adversarial review may not be optional');

  // shepherd is optional, because handover happens only on recorded intent.
  assert.equal(byId.get('shepherd')?.required, false);
});

test('the laziness lens is applied before implementation and names concrete reductions', () => {
  const laziness = flat(LAZINESS);
  const molecule = flat(MOLECULE);

  assert.match(laziness, /Borrow the fatigue of whoever maintains this next/);
  for (const verdict of ['lean', 'trim', 'over-engineered', 'under-specified']) {
    assert.match(laziness, new RegExp(`\`${verdict}\``), `the lens must define ${verdict}`);
  }
  assert.match(laziness, /"Simplify this" is not actionable/);
  assert.match(laziness, /It is not an argument against structure/);
  assert.match(
    molecule,
    /reductions are cheap now and\s+expensive after code exists/,
  );
});

test('ship never merges and does not grade its own work', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /\*\*Never merges, approves, or accepts risk\.\*\*/);
  assert.match(entry, /Merge authority belongs to a\s+person/);
  assert.match(entry, /\*\*Does not grade its own work\.\*\*/);
  assert.match(entry, /Validation is `run-ci`'s job and adversarial\s+review is `roast`'s/);
  assert.match(entry, /a workflow that both writes the change and\s+judges the change is grading its own work/i);
});

test('grounding still builds nothing, and the cycle refuses an unconfirmed packet', () => {
  const entry = flat(ENTRY);
  const molecule = flat(MOLECULE);
  const cycle = flat(CYCLE);

  assert.match(molecule, /No branch, no edit, no commit, no tracker mutation/);
  assert.match(entry, /\*\*Stop here unless alignment is `confirmed`\.\*\*/);
  assert.match(entry, /an unconfirmed packet has no boundary to enforce/);
  assert.match(cycle, /This cycle runs \*\*only\*\* on a packet whose alignment state is `confirmed`/);
  assert.match(cycle, /An\s+unconfirmed ledger is not an authority boundary/);
});

test('reconciliation runs before validation, so green cannot excuse undisclosed', () => {
  const cycle = flat(CYCLE);
  const entry = flat(ENTRY);

  const reconcileIndex = cycle.indexOf('**Reconcile.**');
  const validateIndex = cycle.indexOf('**Validate.**');
  const reviewIndex = cycle.indexOf('**Review.**');
  assert.ok(reconcileIndex > 0 && validateIndex > 0 && reviewIndex > 0);
  assert.ok(reconcileIndex < validateIndex, 'reconciliation precedes validation');
  assert.ok(validateIndex < reviewIndex, 'validation precedes review');

  assert.match(cycle, /\*\*This gate runs before\s+validation, not after\.\*\*/);
  assert.match(entry, /Reconciliation runs \*\*before\*\* validation/);
});

test('an undisclosed change stops the run and is never remediated by amending the ledger', () => {
  const reconcile = flat(RECONCILE);
  const cycle = flat(CYCLE);
  const entry = flat(ENTRY);

  for (const verdict of ['reconciled', 'undisclosed-change', 'ambiguous-mapping', 'unfulfilled-entry']) {
    assert.match(reconcile, new RegExp(`\`${verdict}\``), `the reconciler must define ${verdict}`);
  }

  assert.match(reconcile, /\*\*Never amends the ledger to make the diff reconcile\.\*\*/);
  assert.match(
    reconcile,
    /\*\*Never downgrades `undisclosed-change` to a warning\*\* because the change is\s+small, obviously correct, or already validated/,
  );
  assert.match(cycle, /\*\*Never continues past `undisclosed-change`\*\*/);

  // Both reconciliation stops are reachable as terminal statuses, not merely
  // described. `ambiguous-mapping` stopping the run with nowhere to report it
  // would leave the operator with a halted run and no name for why.
  assert.match(entry, /`undisclosed-change`, `ambiguous-mapping`, `isolation-refused`/);
  assert.match(cycle, /\| `ambiguous-mapping` \|/);
  assert.match(flat(PUBLISH), /\| `ambiguous-mapping` \| No\. \|/);
  assert.match(
    entry,
    /Do not open one on an `undisclosed-change`, `ambiguous-mapping`, or\s+`isolation-refused` outcome/,
  );
});

test('reconciliation is at hunk granularity, and says why file granularity fails', () => {
  const reconcile = flat(RECONCILE);

  assert.match(reconcile, /Reconciliation is at \*\*hunk\*\* granularity, not file granularity/);
  assert.match(
    reconcile,
    /a ledger entry naming a\s+file would vouch for every change made anywhere in that file/,
  );
  assert.match(reconcile, /A hunk claimed by two entries is\s+ambiguous/);
});

test('a change carrying no hunk is still addressable, so metadata cannot ride along', () => {
  // The blind spot: a rename, a mode change, or an emptied file reaches the
  // diff with no `@@` line, so a hunk-walking reconciler sees nothing to claim
  // and reconciles a change nobody agreed to.
  const reconcile = flat(RECONCILE);

  assert.match(reconcile, /A Change With No Hunks Is Still A Change/);
  for (const change of ['rename', 'copy', 'mode-change', 'add', 'delete', 'binary', 'unknown']) {
    assert.match(reconcile, new RegExp(`\`${change}\``), `the metadata reasons must include ${change}`);
  }
  assert.match(reconcile, /every changed file carries at least one addressable unit/);
  assert.match(reconcile, /addressed once\s+per file as `metadata`/);

  // Behavior, not prose: the implementation is exercised directly.
  const rename = `diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n`;
  const unclaimed = reconcileDiff({
    ledger: [{ id: 'L1', classification: 'in-scope' }],
    diff: rename,
    mapping: [],
  });
  assert.equal(unclaimed.verdict, 'undisclosed-change');
  assert.equal(unclaimed.undisclosed[0].change, 'rename');
});

test('reconciliation names its base and includes uncommitted residue', () => {
  // "It was not committed" is not a reason a reviewer will ever see, and an
  // untracked file is invisible to a plain `git diff`.
  const reconcile = flat(RECONCILE);
  const cycle = flat(CYCLE);

  assert.match(reconcile, /What Is Reconciled, And Against What/);
  assert.match(reconcile, /including staged, unstaged, and untracked files/);
  assert.match(reconcile, /git -C <worktree> add --intent-to-add --all/);
  assert.match(reconcile, /git -C <worktree> diff --find-renames --find-copies <base-sha>/);
  assert.match(reconcile, /The commit the isolation branch was created from/);
  assert.match(cycle, /including staged, unstaged, and untracked residue/);
});

test('the worker brief refuses the authority a file list does not bound', () => {
  // A ledger names files. Pushing, commenting on the tracker, merging, and
  // reading credentials are none of them file changes, so a brief that lists
  // only what to edit has said nothing about any of them.
  const dispatch = flat(DISPATCH);

  assert.match(dispatch, /What The Ledger Does Not Bound/);
  assert.match(dispatch, /Writing outside the isolation worktree/);
  assert.match(dispatch, /Pushing, or any write to a remote/);
  assert.match(dispatch, /Mutating the tracker/);
  assert.match(dispatch, /Merging, approving, or requesting review/);
  assert.match(dispatch, /credentials, tokens, or secrets/);
  assert.match(dispatch, /Rewriting history, or touching another run's worktree or branch/);
  assert.match(dispatch, /\*\*Never dispatches a brief without the refusals\.\*\*/);
});

test('roast severities map explicitly, and clearing a blocker is not the run\'s call alone', () => {
  // `roast` returns a severity and gates nothing. The merge gate consumes
  // blockers, so the translation has to be written down somewhere or every run
  // invents it.
  const cycle = flat(CYCLE);
  const gate = flat(MERGE_GATE);

  for (const severity of ['Must fix', 'Should fix', 'Consider']) {
    assert.match(cycle, new RegExp(`\`${severity}\``), `the mapping must cover ${severity}`);
  }
  assert.match(cycle, /`roast` gates nothing and approves nothing/);
  assert.match(cycle, /\| `Must fix` \| A \*\*blocker\*\*/);
  assert.match(gate, /A \*\*blocker\*\* is a `roast` finding at `Must fix`/);

  // Remediated, disputed, or descoped — and only the first is this run's to do.
  assert.match(cycle, /\*\*Remediated\*\*/);
  assert.match(cycle, /\*\*Disputed\*\* — the operator/);
  assert.match(cycle, /\*\*Descoped\*\* — the operator/);
  assert.match(cycle, /The cycle never disputes a finding on\s+its own behalf/);
});

test('the reconciler is honest about what it cannot verify', () => {
  // A deterministic control that overclaims is the same failure as prose that
  // overclaims, with more authority behind it.
  const source = flatSource('ship', '_atoms', 'diff-reconciliation', 'diff-reconciliation.mjs');

  assert.match(source, /It does NOT verify that a hunk \*semantically belongs\*/);

  const reconcile = flat(RECONCILE);
  assert.match(reconcile, /\*\*It checks coverage and uniqueness, not meaning\.\*\*/);
  assert.match(reconcile, /The semantic\s+judgement stays with the reviewer/);
});

test('every run is isolated, and absent isolation is named rather than implied', () => {
  const isolation = flat(ISOLATION);
  const entry = flat(ENTRY);

  for (const state of ['worktree', 'none', 'refused']) {
    assert.match(isolation, new RegExp(`\`${state}\``), `isolation must define ${state}`);
  }
  assert.match(
    isolation,
    /every run works in a \*\*dedicated worktree\s+on its own branch\*\* — always, explicitly/,
  );
  assert.match(isolation, /never the repository's primary\s+checkout and never a worktree belonging to another run/);
  assert.match(isolation, /`none` is a decision for a person, not a detail to proceed past/);

  // Reusing a worktree looks like isolation and is not.
  assert.match(isolation, /Reuse Is Not Isolation/);

  assert.match(entry, /isolation state, with worktree path and branch, or the recorded reason it is\s+absent/);
});

test('remediation is bounded and re-reconciles, because a fix is a change', () => {
  const cycle = flat(CYCLE);
  const dispatch = flat(DISPATCH);

  assert.match(cycle, /Remediate, within a limit/);
  assert.match(cycle, /Record the\s+attempt count and its declared limit before the first attempt/);
  assert.match(cycle, /After each remediation, return to step 3/);
  assert.match(dispatch, /Remediation Is A Dispatch, Not A Correction/);
});

test('the worker brief carries the ledger as its authority boundary', () => {
  const dispatch = flat(DISPATCH);

  assert.match(dispatch, /The confirmed change ledger — every `in-scope` and `enabling` entry with its\s+stable identifier/);
  assert.match(dispatch, /\*\*This is the authority boundary\.\*\*/);
  assert.match(dispatch, /marked explicitly as \*\*reportable and\s+not actionable\*\*/);
  assert.match(dispatch, /A brief that omits the ledger has dispatched an unbounded worker/);

  // A worker's self-report is the thing reconciliation exists to check.
  assert.match(dispatch, /A Worker's Report Is A Claim/);
  assert.match(
    dispatch,
    /asking it more\s+firmly would not find that case/,
  );
  assert.match(dispatch, /\*\*Never treats the worker's report as verification\.\*\*/);
});

test('completion is reported per criterion with evidence, never as a summary', () => {
  const criterion = flat(CRITERION);
  const entry = flat(ENTRY);

  for (const verdict of ['satisfied', 'partial', 'not-satisfied', 'not-verifiable', 'descoped']) {
    assert.match(criterion, new RegExp(`\`${verdict}\``), `the verdict set must include ${verdict}`);
  }

  assert.match(criterion, /"The implementation handles this" is not evidence/);
  assert.match(criterion, /The Aggregate Is Derived, Never Asserted/);
  assert.match(criterion, /`descoped` requires the operator's explicit confirmation, recorded/);
  assert.match(criterion, /\*\*Never reports an aggregate verdict without the per-criterion rows\.\*\*/);

  assert.match(entry, /\*\*a verdict per criterion with its evidence\*\*, then the derived aggregate/);
});

test('the merge is a deliberate grant and never a default', () => {
  const gate = flat(MERGE_GATE);
  const entry = flat(ENTRY);

  for (const disposition of ['withheld', 'eligible', 'granted']) {
    assert.match(gate, new RegExp(`\`${disposition}\``), `the gate must define ${disposition}`);
  }

  assert.match(gate, /Merging is a grant\. Absence of an objection is not one/);
  assert.match(gate, /`eligible` is deliberately not `granted`/);
  assert.match(gate, /The Grant Is A Distinct Token/);
  assert.match(gate, /A Grant Does Not Override A Precondition/);
  assert.match(gate, /\*\*Never defaults to `granted` or to `eligible`\.\*\*/);
  assert.match(gate, /\*\*Never accepts a truthy value as the grant\.\*\*/);
  assert.match(gate, /`intermittent` is not `passed`/);

  assert.match(entry, /Whether the change may merge at all is a \*\*deliberate grant, not a default\*\*/);
  assert.match(entry, /Missing evidence is unmet evidence/);
  assert.match(entry, /The preconditions and the grant are \*\*conjunctive\*\*/);

  // The disposition must reach the reader of the change request, not stay in
  // the run's own report where nobody deciding a merge would see it.
  assert.match(entry, /the merge disposition — `withheld`, `eligible`, or `granted` — with every\s+unmet precondition named/);
  assert.match(entry, /The criterion verdicts and the merge disposition go in the body/);
  assert.match(flat(PUBLISH), /The merge disposition, with every unmet precondition named/);

  // The grant is asked for about a published artifact, so the disposition in
  // the body at publication time is the evaluated one, and a later grant is
  // recorded rather than assumed.
  assert.match(flat(PUBLISH), /Recording The Grant Afterwards/);
  assert.match(flat(MERGE_GATE), /When The Grant Is Asked For/);
  assert.match(flat(MERGE_GATE), /After the change request exists, never before/);
});

test('the merge gate is deterministic, and withholding is its resting state', () => {
  // The gate's whole claim is about what happens when nobody says anything.
  // Prose asserting that is exactly the kind of promise this repository has
  // already been burned by, so the behavior is exercised here directly.
  assert.equal(evaluateMergeGate().disposition, 'withheld');
  assert.equal(evaluateMergeGate({}).disposition, 'withheld');
  assert.equal(mayMerge(evaluateMergeGate()), false);

  const complete = {
    criteria: [{ id: '1', verdict: 'satisfied' }],
    reconciliation: { verdict: 'reconciled' },
    validation: { status: 'passed' },
    review: { blockers: [] },
    isolation: { state: 'worktree' },
  };

  // Everything green, nobody asked: still not permission.
  assert.equal(evaluateMergeGate(complete).disposition, 'eligible');
  assert.equal(mayMerge(evaluateMergeGate(complete)), false);
  assert.equal(evaluateMergeGate({ ...complete, grant: true }).disposition, 'eligible');
  assert.equal(evaluateMergeGate({ ...complete, grant: MERGE_GRANT_TOKEN }).disposition, 'granted');

  // A grant cannot buy an unmet precondition.
  const unmet = evaluateMergeGate({
    ...complete,
    validation: { status: 'intermittent' },
    grant: MERGE_GRANT_TOKEN,
  });
  assert.equal(unmet.disposition, 'withheld');
  assert.ok(!mayMerge(unmet));

  assert.match(
    flatSource('ship', '_atoms', 'merge-gate', 'merge-gate.mjs'),
    /Nothing here merges and nothing here approves/,
  );
});

test('the merge gate holds no authority beyond reading', () => {
  // A gate that could act on its own verdict would be deciding the merge
  // rather than reporting whether one was granted.
  assert.deepEqual(frontmatter(MERGE_GATE).allowedTools, ['read']);
  assert.match(flat(MERGE_GATE), /\*\*Never merges, approves, or enables auto-merge\.\*\*/);
});

test('the change request opens only after reconciliation, validation, and review', () => {
  const entry = flat(ENTRY);

  const cycleIndex = entry.indexOf('Run [Delivery cycle]');
  const evaluateIndex = entry.indexOf('**Evaluate the merge gate**');
  const openIndex = entry.indexOf('**Open the change request**');
  const askIndex = entry.indexOf('**Ask for the merge grant**');
  const handoverIndex = entry.indexOf('**Invoke `shepherd` and wait for it**');
  assert.ok(cycleIndex > 0 && evaluateIndex > 0 && openIndex > 0 && askIndex > 0 && handoverIndex > 0);
  assert.ok(cycleIndex < openIndex, 'the cycle runs before the change request opens');
  assert.ok(evaluateIndex < openIndex, 'the disposition is evaluated before it goes in the body');

  // The grant is asked for about a published artifact. Asked earlier, the only
  // thing available to judge is the run's own account of its own work.
  assert.ok(openIndex < askIndex, 'the change request exists before anyone is asked to grant');
  assert.ok(askIndex < handoverIndex, 'handover follows the grant question');
  assert.ok(openIndex < handoverIndex, 'handover follows publication');

  assert.match(entry, /Opening a change request \*\*mutates a shared remote\*\*/);
});

test('publication distinguishes an opened change request from every way of not opening one', () => {
  const publish = flat(PUBLISH);
  const entry = flat(ENTRY);

  for (const outcome of [
    'published',
    'withheld-by-outcome',
    'provider-unsupported',
    'provider-tool-missing',
    'provider-tool-unauthenticated',
    'publication-failed',
  ]) {
    assert.match(publish, new RegExp(`\`${outcome}\``), `publication must define ${outcome}`);
    assert.match(entry, new RegExp(`\`${outcome}\``), `the output contract must surface ${outcome}`);
  }

  // One run reports a merge disposition and a publication outcome. Sharing the
  // token `withheld` across both would make a report ambiguous exactly where it
  // says nothing was handed over.
  assert.match(
    publish,
    /`withheld-by-outcome` is deliberately not called `withheld`/,
  );

  // An adapter's vocabulary is wider than these six and will grow. Mapping an
  // unfamiliar condition onto the nearest familiar one sends somebody to fix
  // the wrong thing.
  assert.match(publish, /`provider-tool-unsupported`/);
  assert.match(publish, /`provider-tool-unobserved`/);
  assert.match(publish, /\*\*passed through under the adapter's own name\*\*/);
  assert.match(publish, /Do not map an unfamiliar condition onto the nearest familiar one/);
  assert.match(entry, /or a condition the\s+provider adapter named/);

  // The failure this separates is a run that pushed a branch, failed to open
  // anything, and reported the branch as though it were the handover.
  assert.match(publish, /\*\*A pushed branch is not a publication\.\*\*/);
  assert.match(publish, /\*\*Never reports `published` without the returned identifier\.\*\*/);
  assert.match(
    publish,
    /An identifier the run\s+constructed, predicted, or inferred from a branch name is not evidence/,
  );
  assert.match(entry, /a pushed branch\s+is not offered in place of one/);
});

test('an unfinished run is published marked as such, and a stopped run is not published', () => {
  const publish = flat(PUBLISH);

  assert.match(publish, /\| `incomplete` \| Yes, \*\*marked incomplete\*\*/);
  assert.match(publish, /\| `handed-back` \| Yes, \*\*marked handed back\*\*/);
  for (const stopped of ['undisclosed-change', 'ambiguous-mapping', 'isolation-refused']) {
    assert.match(
      publish,
      new RegExp(`\\| \`${stopped}\` \\| No\\. \\|`),
      `${stopped} must not be publishable`,
    );
  }

  assert.match(publish, /An unfinished change is published rather than hidden/);
  assert.match(
    publish,
    /the diff was never bounded by anything the operator agreed to/,
  );
  assert.match(publish, /\*\*Never publishes past a stopped run\*\*, however complete the change looks/);
});

test('the change request body leads with the criterion table, not a summary', () => {
  const publish = flat(PUBLISH);

  assert.match(publish, /\*\*The criterion table first\*\*/);
  assert.match(publish, /Before any narrative summary of the work/);
  assert.match(
    publish,
    /A summary of the work in place of the criterion table is the exact substitution\s+the criterion table exists to prevent/,
  );
  assert.match(publish, /\*\*Never softens the criterion table, the merge disposition, or the outstanding\s+defects\*\*/);

  // The reviewer decides the merge, so the disposition has to reach them.
  assert.match(publish, /The merge disposition, with every unmet precondition named/);
});

test('the provider seam is narrow, uses the official tool, and never fakes a clean read', () => {
  const publish = flat(PUBLISH);
  const entry = flat(ENTRY);

  assert.match(publish, /\*\*official command-line tool\*\* — `gh` for GitHub, `az` for\s+Azure DevOps — never a hand-rolled call against a REST endpoint/);
  assert.match(publish, /Detection accounts for \*\*tool availability, not only the remote URL\*\*/);
  assert.match(publish, /do not imply a clean state/);

  // A wider seam is how shepherd's job, and the review-thread work that has
  // its own issue, would arrive here by convenience rather than by decision.
  assert.match(
    publish,
    /It does not resolve merge state, read review threads, or watch\s+checks/,
  );
  assert.match(entry, /those belong to\s+`shepherd`/);
  assert.match(
    publish,
    /When a shared provider adapter exists, this atom composes it instead of carrying\s+its own detection/,
  );
  assert.match(
    publish,
    /A run whose isolation state is `none` reaches the third condition/,
  );

  // Publication writes to a shared remote and holds nothing else. No `task`,
  // so it cannot dispatch, and no `edit`, so it cannot amend what it publishes.
  assert.deepEqual(frontmatter(PUBLISH).allowedTools, ['execute', 'read']);
  assert.match(publish, /\*\*Never merges, approves, enables auto-merge, or requests a review decision\.\*\*/);
  assert.match(publish, /\*\*Never pushes anything but the run's own isolation branch\*\*, and never with\s+force/);
  assert.match(entry, /\*\*Pushes only its own isolation branch, and never with force\.\*\*/);
  assert.match(publish, /\*\*Never reproduces a token or credential\.\*\*/);
});

test('handover happens only on recorded intent, and ship never merges', () => {
  const entry = flat(ENTRY);

  assert.match(entry, /when, and only when, the shepherd intent recorded\s+in step 2 said so/);
  assert.match(entry, /ship does not follow it there and does not merge it/);
  assert.match(entry, /The absence of an instruction\s+is not permission to continue/);

  // Handing a change request identifier to shepherd when publication never
  // produced one turns a visible failure into an invented target.
  assert.match(entry, /Handover also needs something to hand over/);
  assert.match(
    entry,
    /When publication returned\s+anything but `published`, report that outcome and stop/,
  );
});

test('the handoff is a nested invocation the run waits for, not a described one', () => {
  const entry = flat(ENTRY);
  const handoff = flat(HANDOFF);

  // Structural: the step dispatches and blocks on a result, and the atom that
  // classifies it is composed rather than described.
  assert.match(entry, /\*\*Invoke `shepherd` and wait for it\*\*/);
  assert.match(entry, /nested one in a separate worker\*\*, dispatched with\s+`task`/);
  assert.match(
    entry,
    /\*\*This run does not report its own completion until shepherd returns a\s+terminal disposition\.\*\*/,
  );
  assert.match(entry, /`shipped-to-review` is never reported as though a handoff occurred/);
  assert.match(handoff, /A Handoff Is An Invocation/);
  assert.match(handoff, /a handoff that did\s+not leave this context did not happen/);

  // Behavioral: the vocabulary a narrated handoff would report with cannot
  // reach a completed handoff.
  const described = evaluateHandoff({
    intent: 'yes',
    publication: { outcome: 'published', identifier: '#1' },
    target: {
      changeRequest: '#1',
      headBranch: 'issue-1',
      headSha: 'head',
      baseBranch: 'main',
      baseSha: 'base',
      upToDatePolicy: 'unobserved',
      receipt: { observedAt: '2026-08-25T20:35:56Z', baseSha: 'base', headSha: 'head' },
    },
    invocation: { mode: 'narrated', status: 'returned' },
    result: { disposition: 'mergeable-and-green' },
  });
  assert.equal(described.handoff, 'not-performed');
  assert.equal(described.shipStatus, 'blocked');
  assert.ok(!handoffSatisfied(described));
  assert.match(described.humanAction, /#1 \(branch issue-1\)/);

  const invoked = evaluateHandoff({
    intent: 'yes',
    publication: { outcome: 'published', identifier: '#1' },
    target: {
      changeRequest: '#1',
      headBranch: 'issue-1',
      headSha: 'head',
      baseBranch: 'main',
      baseSha: 'base',
      upToDatePolicy: 'required',
      receipt: { observedAt: '2026-08-25T20:35:56Z', baseSha: 'base', headSha: 'head' },
    },
    invocation: { mode: NESTED_INVOCATION, status: 'returned' },
    result: {
      disposition: 'mergeable-and-green',
      receipt: {
        observedAt: '2026-08-25T20:36:00Z',
        baseSha: 'base',
        headSha: 'head',
        upToDatePolicy: 'required',
        provider: 'supported-provider',
        complete: true,
      },
    },
    observedBase: { observedAt: '2026-08-25T20:36:01Z', baseSha: 'base', headSha: 'head' },
  });
  assert.equal(invoked.handoff, 'completed');
  assert.ok(handoffSatisfied(invoked));
  assert.ok(publicationSucceeded({
    outcome: 'published',
    identifier: '#1',
  }));
});

test('ship accepts the actual terminal result shape shepherd produces', () => {
  const signals = {
    observedAt: '2026-08-25T20:36:00Z',
    provider: { status: 'supported-provider', provider: 'github' },
    preflight: { status: 'ok' },
    rebase: { status: 'completed', baseSha: 'base' },
    regeneration: { status: 'not-applicable' },
    localValidation: { status: 'passed', evidenceComplete: true },
    push: { status: 'pushed-with-lease', headSha: 'head' },
    basePolicy: { upToDate: 'required' },
    mergeability: {
      state: 'mergeable',
      isDraft: false,
      baseSha: 'base',
      headSha: 'head',
      behind: false,
    },
    remoteChecks: { checks: [{ name: 'validate', status: 'passed' }] },
  };

  for (const [remoteChecks, disposition] of [
    [{ checks: [{ name: 'validate', status: 'passed' }] }, 'mergeable-and-green'],
    [{ checks: [{ name: 'validate', status: 'failed' }] }, 'failing'],
  ]) {
    const shepherdResult = classifyTerminalDisposition({ ...signals, remoteChecks });
    const evaluation = evaluateHandoff({
      intent: 'yes',
      publication: { outcome: 'published', identifier: '#1' },
      target: {
        changeRequest: '#1',
        headBranch: 'issue-1',
        headSha: 'published-head',
        baseBranch: 'main',
        baseSha: 'published-base',
        upToDatePolicy: 'unobserved',
        receipt: {
          observedAt: '2026-08-25T20:35:56Z',
          baseSha: 'published-base',
          headSha: 'published-head',
        },
      },
      invocation: { mode: NESTED_INVOCATION, status: 'returned' },
      result: shepherdResult,
      observedBase: {
        observedAt: '2026-08-25T20:36:01Z',
        baseSha: 'base',
        headSha: 'head',
      },
    });

    assert.equal(evaluation.handoff, 'completed');
    assert.equal(evaluation.state, `shepherd-${disposition}`);
    assert.ok(handoffSatisfied(evaluation));
  }
});

test('a declined handoff stays optional and an unrecorded one does not', () => {
  const declined = evaluateHandoff({
    intent: 'no',
    publication: { outcome: 'published', identifier: '#1' },
  });
  assert.equal(declined.handoff, 'not-required');
  assert.ok(handoffSatisfied(declined));

  // `shepherd` stays an optional dependency precisely because `no` is a real
  // answer. An unasked question is not that answer.
  assert.equal(frontmatter(ENTRY).requiresSkills.find((entry) => entry.id === 'shepherd')?.required, false);
  assert.equal(evaluateHandoff({
    intent: undefined,
    publication: { outcome: 'published', identifier: '#1' },
  }).shipStatus, 'blocked');
});

test('handoff ownership is explicit, and a result is bound to the base it saw', () => {
  const handoff = flat(HANDOFF);
  const entry = flat(ENTRY);

  assert.match(handoff, /Ownership Is Explicit Or Absent/);
  for (const field of ['changeRequest', 'headBranch', 'headSha', 'baseBranch', 'baseSha', 'upToDatePolicy', 'receipt']) {
    assert.match(handoff, new RegExp(`\`${field}\``), `the target must name ${field}`);
  }
  assert.match(handoff, /`unobserved` is never reported as `not-required`/);
  assert.match(handoff, /\*\*It is not durable permission\.\*\*/);
  assert.match(entry, /A shepherd result is snapshot-bound/);

  const complete = {
    intent: 'yes',
    publication: { outcome: 'published', identifier: '#1' },
    target: {
      changeRequest: '#1',
      headBranch: 'issue-1',
      headSha: 'head',
      baseBranch: 'main',
      baseSha: 'base',
      upToDatePolicy: 'unobserved',
      receipt: { observedAt: '2026-08-25T20:35:56Z', baseSha: 'base', headSha: 'head' },
    },
    invocation: { mode: NESTED_INVOCATION, status: 'returned' },
    result: {
      disposition: 'mergeable-and-green',
      receipt: {
        observedAt: '2026-08-25T20:36:00Z',
        baseSha: 'base',
        headSha: 'head',
        upToDatePolicy: 'required',
        provider: 'supported-provider',
        complete: true,
      },
    },
  };

  // A target missing any ownership field is refused rather than handed over.
  const anonymous = evaluateHandoff({
    ...complete,
    target: { ...complete.target, baseSha: undefined, receipt: { observedAt: '2026-08-25T20:35:56Z' } },
  });
  assert.equal(anonymous.state, 'target-incomplete');
  assert.equal(anonymous.shipStatus, 'blocked');

  // The incident, reduced: a sibling merged into the same base after shepherd
  // observed it, so the disposition describes a state that no longer exists.
  const stale = evaluateHandoff({
    ...complete,
    observedBase: {
      observedAt: '2026-08-25T20:37:00Z',
      baseSha: 'base-after-sibling-merge',
      headSha: 'head',
    },
  });
  assert.equal(stale.state, 'stale-disposition');
  assert.equal(stale.requiresReinvocation, true);
  assert.ok(!handoffSatisfied(stale));
});

test('the set of open change requests is somebody else, and it is named', () => {
  const handoff = flat(HANDOFF);
  const entry = flat(ENTRY);

  // The rule has to be recorded somewhere it will be inherited. A single-issue
  // run cannot see a set, and shepherd is deliberately not made to wait.
  assert.match(handoff, /After A Sibling Merges/);
  assert.match(handoff, /must re-shepherd every still-open change\s+request whose readiness it previously reported/);
  assert.match(handoff, /issue\s+#65/);
  assert.match(handoff, /It does not and cannot watch a\s+set/);
  assert.match(handoff, /a skill\s+that waits for events is a daemon/);
  assert.match(entry, /\*\*What this run cannot own is the set\.\*\*/);
  assert.match(entry, /\*\*Never watches a change request after handing it over\*\*/);

  // The handoff atom can dispatch and make the read-only freshness observation,
  // but it cannot edit the branch it hands over.
  assert.deepEqual(frontmatter(HANDOFF).allowedTools, ['task', 'read', 'execute']);
  assert.match(handoff, /\*\*Never merges, approves, rebases, or pushes\.\*\*/);
});
test('an incomplete outcome is not quietly reported as success', () => {
  const cycle = flat(CYCLE);

  for (const outcome of [
    'verified',
    'incomplete',
    'handed-back',
    'undisclosed-change',
    'ambiguous-mapping',
    'isolation-refused',
  ]) {
    assert.match(cycle, new RegExp(`\`${outcome}\``), `the cycle must define ${outcome}`);
  }
  assert.match(
    cycle,
    /`incomplete` is a real and expected outcome, not a polite way of saying\s+`verified`/,
  );
  assert.match(cycle, /\*\*Never weakens, skips, or narrows a test to reach green\.\*\*/);
  assert.match(cycle, /A failing test is\s+evidence, and deleting evidence is not remediation/);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'ship', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: ship\s*$/m);
  assert.ok(!intent.startsWith('---'), 'an intent carries no frontmatter');

  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /Taking one issue to done/);
  assert.match(normalized, /grading its own work/);
  assert.match(normalized, /success at the wrong\s*thing/);
  assert.match(normalized, /Merge authority stays with a person/);
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
  walk(path.join(SKILLS_ROOT, 'ship'));

  assert.ok(found.length >= 1, 'the walk found no suites, which would make this assertion vacuous');
  const unregistered = found.filter((file) => !workflow.includes(file)).sort();
  assert.deepEqual(unregistered, [], `never run in continuous integration: ${unregistered.join(', ')}`);
});
