/**
 * Adversarial tests for the ship merge gate.
 *
 * These hunt for the one failure the gate exists to prevent: a merge becoming
 * permitted because nothing objected. Each test is written so that it fails if
 * the gate were implemented the obvious, wrong way — defaulting to permitted,
 * checking the grant for truthiness, or letting a grant paper over an unmet
 * precondition.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { MERGE_GRANT_TOKEN, evaluateMergeGate, mayMerge } from './merge-gate.mjs';

/** Every precondition met. Individual tests spoil exactly one of them. */
function metPreconditions(overrides = {}) {
  return {
    criteria: [
      { id: '1', verdict: 'satisfied' },
      { id: '2', verdict: 'descoped' },
    ],
    reconciliation: { verdict: 'reconciled' },
    validation: { status: 'passed' },
    review: { blockers: [] },
    isolation: { state: 'worktree', branch: 'issue-1' },
    ...overrides,
  };
}

test('the default disposition is withheld, and no input is not consent', () => {
  // THE central property. A gate that starts anywhere else is not a gate.
  for (const input of [undefined, {}, { criteria: [] }]) {
    const result = evaluateMergeGate(input);
    assert.equal(result.disposition, 'withheld');
    assert.ok(result.unmet.length > 0, 'withholding must say why');
    assert.ok(!mayMerge(result));
  }
});

test('every precondition met without a grant is eligible, and eligible is not permission', () => {
  const result = evaluateMergeGate(metPreconditions());

  assert.equal(result.disposition, 'eligible');
  assert.deepEqual(result.unmet, []);
  assert.equal(result.granted, false);
  assert.ok(!mayMerge(result), 'eligible must never be treated as permission');
});

test('the grant moves eligible to granted', () => {
  const result = evaluateMergeGate(metPreconditions({ grant: MERGE_GRANT_TOKEN }));

  assert.equal(result.disposition, 'granted');
  assert.ok(mayMerge(result));
});

test('a truthy value is not a grant', () => {
  // A boolean default, a config flag, or an optimistic caller supplies these
  // by accident. None of them supplies the token by accident.
  for (const grant of [true, 1, 'yes', 'y', 'granted', 'GRANTED', 'operator-Granted', {}, [], ' operator-granted ']) {
    const result = evaluateMergeGate(metPreconditions({ grant }));
    assert.equal(
      result.disposition,
      'eligible',
      `${JSON.stringify(grant)} must not grant a merge`,
    );
    assert.ok(!mayMerge(result));
  }
});

test('a grant does not override an unmet precondition', () => {
  // Overriding an unmet criterion is accepting a risk. That is a person's
  // decision taken with the criterion table in front of them, not a
  // disposition that reads as clean.
  const result = evaluateMergeGate(
    metPreconditions({
      criteria: [
        { id: '1', verdict: 'satisfied' },
        { id: '2', verdict: 'not-satisfied' },
      ],
      grant: MERGE_GRANT_TOKEN,
    }),
  );

  assert.equal(result.disposition, 'withheld');
  assert.equal(result.granted, true, 'the grant is still recorded, and still insufficient');
  assert.ok(result.unmet.some((reason) => reason.includes('2=not-satisfied')));
  assert.ok(!mayMerge(result));
});

test('an unfinished criterion verdict withholds, whichever kind it is', () => {
  for (const verdict of ['partial', 'not-satisfied', 'not-verifiable']) {
    const result = evaluateMergeGate(
      metPreconditions({ criteria: [{ id: '1', verdict }], grant: MERGE_GRANT_TOKEN }),
    );
    assert.equal(result.disposition, 'withheld', `${verdict} must not satisfy the gate`);
  }
});

test('an unrecognised criterion verdict is unmet rather than assumed benign', () => {
  // Inventing a verdict must not be a way through. `looks-fine` is not in the
  // vocabulary, so it counts as outstanding.
  const result = evaluateMergeGate(
    metPreconditions({ criteria: [{ id: '1', verdict: 'looks-fine' }], grant: MERGE_GRANT_TOKEN }),
  );

  assert.equal(result.disposition, 'withheld');
  assert.ok(result.unmet.some((reason) => reason.includes('1=looks-fine')));
});

test('an empty criteria list is unmet, not vacuously met', () => {
  const result = evaluateMergeGate(metPreconditions({ criteria: [], grant: MERGE_GRANT_TOKEN }));

  assert.equal(result.disposition, 'withheld');
  assert.ok(result.unmet.some((reason) => reason.startsWith('criteria:')));
});

test('intermittent validation is not passed', () => {
  // A failure that passed on retry is a failure with a second data point.
  const result = evaluateMergeGate(
    metPreconditions({ validation: { status: 'intermittent' }, grant: MERGE_GRANT_TOKEN }),
  );

  assert.equal(result.disposition, 'withheld');
  assert.ok(result.unmet.some((reason) => reason.includes('run-ci status is intermittent')));
});

test('no validation status at all is withheld, not waved through', () => {
  for (const validation of [undefined, {}, { status: 'incomplete' }, { status: 'unsupported-provider' }]) {
    const result = evaluateMergeGate(metPreconditions({ validation, grant: MERGE_GRANT_TOKEN }));
    assert.equal(result.disposition, 'withheld', `${JSON.stringify(validation)} must not pass`);
  }
});

test('a stopped reconciliation withholds the merge', () => {
  for (const verdict of ['undisclosed-change', 'ambiguous-mapping', undefined]) {
    const result = evaluateMergeGate(
      metPreconditions({ reconciliation: { verdict }, grant: MERGE_GRANT_TOKEN }),
    );
    assert.equal(result.disposition, 'withheld', `${verdict} must not reach a grant`);
  }
});

test('an unfulfilled entry does not withhold, because a smaller diff is the safe direction', () => {
  const result = evaluateMergeGate(
    metPreconditions({ reconciliation: { verdict: 'unfulfilled-entry' }, grant: MERGE_GRANT_TOKEN }),
  );

  assert.equal(result.disposition, 'granted');
});

test('an unresolved review blocker withholds, and an unreported review is not a clear one', () => {
  const blocked = evaluateMergeGate(
    metPreconditions({ review: { blockers: [{ id: 'R1' }] }, grant: MERGE_GRANT_TOKEN }),
  );
  assert.equal(blocked.disposition, 'withheld');
  assert.ok(blocked.unmet.some((reason) => reason.includes('1 unresolved blocker')));

  // Never having run review must not look like review finding nothing.
  for (const review of [undefined, {}, { blockers: null }]) {
    const missing = evaluateMergeGate(metPreconditions({ review, grant: MERGE_GRANT_TOKEN }));
    assert.equal(missing.disposition, 'withheld', 'an absent review is not a clean review');
    assert.ok(missing.unmet.some((reason) => reason.startsWith('review:')));
  }
});

test('unisolated work withholds unless the operator consented to it', () => {
  const refused = evaluateMergeGate(
    metPreconditions({ isolation: { state: 'refused' }, grant: MERGE_GRANT_TOKEN }),
  );
  assert.equal(refused.disposition, 'withheld');

  const unconsented = evaluateMergeGate(
    metPreconditions({ isolation: { state: 'none' }, grant: MERGE_GRANT_TOKEN }),
  );
  assert.equal(unconsented.disposition, 'withheld');

  // Consent must be the recorded boolean, not any truthy stand-in.
  const truthy = evaluateMergeGate(
    metPreconditions({ isolation: { state: 'none', consent: 'sure' }, grant: MERGE_GRANT_TOKEN }),
  );
  assert.equal(truthy.disposition, 'withheld');

  const consented = evaluateMergeGate(
    metPreconditions({ isolation: { state: 'none', consent: true }, grant: MERGE_GRANT_TOKEN }),
  );
  assert.equal(consented.disposition, 'granted');
});

test('every unmet precondition is reported, not just the first one found', () => {
  // A gate that stops at the first problem hides the rest, and the operator
  // fixes one thing at a time without ever seeing the shape of the run.
  const result = evaluateMergeGate({
    criteria: [{ id: '1', verdict: 'partial' }],
    reconciliation: { verdict: 'undisclosed-change' },
    validation: { status: 'failed' },
    review: { blockers: [{ id: 'R1' }, { id: 'R2' }] },
    isolation: { state: 'refused' },
    grant: MERGE_GRANT_TOKEN,
  });

  assert.equal(result.disposition, 'withheld');
  assert.equal(result.unmet.length, 5);
  for (const prefix of ['criteria:', 'reconciliation:', 'validation:', 'review:', 'isolation:']) {
    assert.ok(
      result.unmet.some((reason) => reason.startsWith(prefix)),
      `${prefix} must be reported`,
    );
  }
});

test('mayMerge is true for granted alone', () => {
  assert.equal(mayMerge({ disposition: 'granted' }), true);
  assert.equal(mayMerge({ disposition: 'eligible' }), false);
  assert.equal(mayMerge({ disposition: 'withheld' }), false);
  assert.equal(mayMerge(undefined), false);
  assert.equal(mayMerge({}), false);
});

test('malformed input is rejected rather than silently granting', () => {
  assert.throws(() => evaluateMergeGate(null), TypeError);
  assert.throws(() => evaluateMergeGate('operator-granted'), TypeError);
});
