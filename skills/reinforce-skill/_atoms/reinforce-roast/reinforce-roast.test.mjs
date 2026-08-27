/**
 * Behavioural tests for the reinforce-skill remediation gate.
 *
 * Two things are proven here. First, that a reinforcement is held to the *same*
 * rules a creation is — not similar prose, the same machine — so the tests
 * drive the re-exported ledger and assert its refusals arrive through this
 * atom. Second, that the gap the shared gate leaves for a *reinforcement* is
 * closed: a correction made to silence a finding may not wander into a
 * neighbouring skill or a shared unit, which `assertGateIntegrity` alone
 * permits.
 *
 * The drift test at the end fails if the shared ledger's guarantees change out
 * from under this skill, which is the price of reusing another unit's script
 * instead of copying it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DUCKED_PRIORITIES,
  MANDATORY_PRIORITIES,
  PRIORITIES,
  ROUNDS_BEFORE_RECONFIRMATION,
  VERDICTS,
  applyEvent,
  assertReinforcementChangeSet,
  assertRoastComplete,
  createLedger,
  roastStatus,
} from './reinforce-roast.mjs';
import * as sharedLedger from '../../../create-skill/_atoms/roast-round-ledger/roast-round-ledger.mjs';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
);

const SKILL = 'existing-skill';
const WORKFLOW_FILE = '.github/workflows/validate-skills.yml';

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(REPOSITORY_ROOT, '.reinforce-roast-fixture-'));
  try {
    fs.mkdirSync(path.join(root, 'skills', SKILL), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', SKILL, 'SKILL.md'), '# skill\n');
    fs.mkdirSync(path.join(root, 'skills', 'other-skill'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', '_base', '_atoms'), { recursive: true });
    fs.mkdirSync(path.join(root, 'doctrine'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function code(fn) {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

function finding(id, priority) {
  return {
    id,
    priority,
    location: 'skills/existing-skill/SKILL.md',
    evidence: 'the routing description does not name what it refuses',
    consequence: 'a model routes to it for a job it should decline',
    recommendation: 'name the refused jobs in the description',
  };
}

/** A ledger with one roast of the current head recorded. */
function roasted(findings) {
  const state = createLedger({ packagePath: `skills/${SKILL}`, head: 'head-1' });
  applyEvent(state, { type: 'roast-recorded', head: 'head-1', findings });
  return state;
}

test('a remediation change set that leaves the target skill is refused', () => {
  withFixture((root) => {
    assert.equal(
      code(() => assertReinforcementChangeSet(root, SKILL, [
        `skills/${SKILL}/SKILL.md`,
        'skills/other-skill/SKILL.md',
      ])),
      'out_of_target',
      'a correction may not reach into a neighbouring skill',
    );

    assert.equal(
      code(() => assertReinforcementChangeSet(root, SKILL, [
        `skills/${SKILL}/SKILL.md`,
        'skills/_base/_atoms/shared/shared.md',
      ])),
      'out_of_target',
      'a correction may not reach into a shared unit',
    );
  });
});

test('the neighbour and shared-unit refusals are the gap the shared gate leaves open', () => {
  withFixture((root) => {
    // The shared create-skill gate accepts both of these without complaint,
    // which is why the reinforcement layer exists at all. If this assertion
    // ever fails, the layering is redundant and should be reconsidered.
    assert.deepEqual(
      sharedLedger.assertGateIntegrity(['skills/other-skill/SKILL.md']),
      { status: 'intact', checked: 1 },
    );
    assert.deepEqual(
      sharedLedger.assertGateIntegrity(['skills/_base/_atoms/shared/shared.md']),
      { status: 'intact', checked: 1 },
    );
    assert.equal(
      code(() => assertReinforcementChangeSet(root, SKILL, ['skills/other-skill/SKILL.md'])),
      'out_of_target',
    );
  });
});

test('a remediation change set that weakens a repository gate is refused', () => {
  withFixture((root) => {
    for (const gatePath of ['scripts/validate-skill-graph.mjs', 'AGENTS.md', 'doctrine/testing.doctrine.md']) {
      assert.equal(
        code(() => assertReinforcementChangeSet(root, SKILL, [`skills/${SKILL}/SKILL.md`, gatePath])),
        'gate_weakened',
        `${gatePath} must be refused as a gate`,
      );
    }
  });
});

test('an in-target change set plus the additive test registration is intact', () => {
  withFixture((root) => {
    const verdict = assertReinforcementChangeSet(root, SKILL, [
      `skills/${SKILL}/SKILL.md`,
      `skills/${SKILL}/intent.md`,
      WORKFLOW_FILE,
    ]);
    assert.equal(verdict.status, 'intact');
    assert.equal(verdict.checked, 3);
    assert.deepEqual(verdict.workflow, [WORKFLOW_FILE], 'the shared workflow edit is surfaced, never hidden');
  });
});

test('a non-array change set is refused rather than treated as empty', () => {
  withFixture((root) => {
    assert.equal(
      code(() => assertReinforcementChangeSet(root, SKILL, 'skills/existing-skill/SKILL.md')),
      'invalid_change_set',
    );
  });
});

test('a Must fix finding is never routed to the rubber duck', () => {
  const state = roasted([finding('f1', 'Must fix')]);
  assert.equal(
    code(() => applyEvent(state, {
      type: 'duck-verdict',
      findingId: 'f1',
      verdict: 'decline',
      reasoning: 'it seems fine to me',
    })),
    'mandatory_finding_not_duckable',
  );
});

test('a Should fix finding is never applied without a recorded duck verdict', () => {
  const state = roasted([finding('f1', 'Should fix')]);
  assert.equal(
    code(() => applyEvent(state, { type: 'finding-resolved', findingId: 'f1', changedPaths: [] })),
    'verdict_required',
  );
});

test('a roast of a superseded head is stale evidence and closes nothing', () => {
  const state = roasted([finding('f1', 'Must fix')]);
  assert.equal(roastStatus(state), 'fresh');

  applyEvent(state, { type: 'correction', head: 'head-2', changedPaths: [`skills/${SKILL}/SKILL.md`] });
  assert.equal(roastStatus(state), 'stale', 'a correction that moves the head invalidates the roast');

  assert.equal(
    code(() => applyEvent(state, { type: 'finding-resolved', findingId: 'f1', changedPaths: [] })),
    'stale_roast',
  );
  assert.equal(
    assertRoastComplete(state).remediation,
    'blocked',
    'a stale roast never yields a complete remediation',
  );
});

test('the loop stops for the operator and refuses every other event', () => {
  const state = roasted([finding('f1', 'Consider')]);
  for (let round = 0; round < ROUNDS_BEFORE_RECONFIRMATION; round += 1) {
    applyEvent(state, { type: 'round-closed' });
  }
  assert.equal(state.gate, 'awaiting-operator');
  assert.equal(
    code(() => applyEvent(state, { type: 'round-closed' })),
    'awaiting_operator_reconfirmation',
    'the stop is a state the machine is in, not a paragraph asking politely',
  );
  assert.equal(assertRoastComplete(state).remediation, 'blocked');
});

test('a reinforcement is not complete without a roast that actually happened', () => {
  const never = createLedger({ packagePath: `skills/${SKILL}`, head: 'head-1' });
  const verdict = assertRoastComplete(never);
  assert.equal(verdict.remediation, 'blocked');
  assert.equal(verdict.roast, 'none');
  assert.match(verdict.problems.join(' '), /no roast was recorded/);
});

test('an open finding blocks completion, and only a fresh clean roast clears it', () => {
  const state = roasted([finding('f1', 'Must fix')]);
  const open = assertRoastComplete(state);
  assert.equal(open.remediation, 'blocked');
  assert.equal(open.unresolved.length, 1);

  // Resolving a finding moves the head, which is exactly why the prior roast
  // stops counting: the reviewed package no longer exists.
  applyEvent(state, {
    type: 'finding-resolved',
    findingId: 'f1',
    head: 'head-2',
    note: 'named the refused jobs in the description',
    changedPaths: [`skills/${SKILL}/SKILL.md`],
  });
  const stale = assertRoastComplete(state);
  assert.equal(stale.remediation, 'blocked', 'a fix alone does not finish the loop');
  assert.equal(stale.roast, 'stale');

  // Only a roast of the corrected head, finding nothing, completes it.
  applyEvent(state, { type: 'roast-recorded', head: 'head-2', findings: [] });
  const closed = assertRoastComplete(state);
  assert.equal(closed.remediation, 'clean', `still blocked: ${closed.problems.join(', ')}`);
  assert.equal(closed.roast, 'fresh');
  assert.deepEqual(closed.unresolved, []);
});

test('a correction that wandered out of the target is refused by the ledger itself', () => {
  const state = roasted([finding('f1', 'Must fix')]);
  assert.equal(
    code(() => applyEvent(state, {
      type: 'finding-resolved',
      findingId: 'f1',
      head: 'head-2',
      note: 'silenced the finding by editing the rule',
      changedPaths: [`skills/${SKILL}/SKILL.md`, 'AGENTS.md'],
    })),
    'gate_weakened',
    'a correction may not edit the standard it is measured by',
  );
});

test('the reinforcement gate drives the same machine a creation does', () => {
  // Re-exported, not re-implemented. If these diverge, two copies exist and one
  // of them is weaker.
  assert.equal(applyEvent, sharedLedger.applyEvent);
  assert.equal(createLedger, sharedLedger.createLedger);
  assert.equal(roastStatus, sharedLedger.roastStatus);

  assert.deepEqual(PRIORITIES, sharedLedger.PRIORITIES);
  assert.deepEqual(MANDATORY_PRIORITIES, sharedLedger.MANDATORY_PRIORITIES);
  assert.deepEqual(DUCKED_PRIORITIES, sharedLedger.DUCKED_PRIORITIES);
  assert.deepEqual(VERDICTS, sharedLedger.VERDICTS);
  assert.equal(ROUNDS_BEFORE_RECONFIRMATION, sharedLedger.ROUNDS_BEFORE_RECONFIRMATION);
});

test('the shared guarantees this skill depends on are pinned against drift', () => {
  // These are the create-skill rules issue 47 says a reinforcement reuses. A
  // change to any of them changes what a reinforcement is held to, so it fails
  // here and is read by a human rather than taking effect silently.
  assert.deepEqual(PRIORITIES, ['Must fix', 'Should fix', 'Consider']);
  assert.deepEqual(MANDATORY_PRIORITIES, ['Must fix']);
  assert.deepEqual(DUCKED_PRIORITIES, ['Should fix', 'Consider']);
  assert.deepEqual(VERDICTS, ['apply', 'decline', 'needs-human']);
  assert.equal(ROUNDS_BEFORE_RECONFIRMATION, 3);
  assert.deepEqual(sharedLedger.PROTECTED_GATE_PATHS, ['scripts/', 'AGENTS.md', 'doctrine/']);
});
