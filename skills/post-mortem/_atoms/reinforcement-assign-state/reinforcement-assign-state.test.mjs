import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORBIDDEN_STATES,
  LIFECYCLE_STATES,
  assessRecurrence,
  assignLifecycleState,
} from './reinforcement-assign-state.mjs';

function run(overrides = {}) {
  return {
    run_id: 'run-1',
    session_id: 'session-1',
    correlation: 'same-session',
    ...overrides,
  };
}

function stateFor(runs) {
  return assignLifecycleState({ recurrence: assessRecurrence(runs) });
}

/** Regression scenario 8a, executable. */
test('one selected run, or none at all, leaves a candidate PROPOSED', () => {
  const none = stateFor([]);
  assert.equal(none.status, 'PROPOSED');
  assert.match(none.reason, /no run log was selected/);

  const single = stateFor([run()]);
  assert.equal(single.status, 'PROPOSED');
  assert.match(single.reason, /one run cannot corroborate itself/);

  // Repetition inside one run is not recurrence, however many times it appears.
  const repeated = stateFor([run(), run(), run()]);
  assert.equal(repeated.status, 'PROPOSED');
  assert.match(repeated.reason, /the same run/);
});

/** Regression scenario 8b, executable. */
test('two runs that are two attempts at the same work leave a candidate PROPOSED', () => {
  const sameSession = stateFor([
    run({ run_id: 'run-1' }),
    run({ run_id: 'run-2' }),
  ]);
  assert.equal(sameSession.status, 'PROPOSED');
  assert.match(sameSession.reason, /one session, which is two attempts at the same work/);

  const unidentified = stateFor([
    run({ run_id: 'run-1', session_id: null }),
    run({ run_id: 'run-2', session_id: 'session-2' }),
  ]);
  assert.equal(unidentified.status, 'PROPOSED');
  assert.match(unidentified.reason, /records no session, so independence cannot be established/);

  const foreign = stateFor([
    run({ run_id: 'run-1', correlation: 'different-session' }),
    run({ run_id: 'run-2', session_id: 'session-2' }),
  ]);
  assert.equal(foreign.status, 'PROPOSED');
  assert.match(foreign.reason, /fewer than two selected runs/);
});

test('two genuinely independent runs support OBSERVED, and nothing further', () => {
  const observed = stateFor([
    run({ run_id: 'run-1', session_id: 'session-1' }),
    run({ run_id: 'run-2', session_id: 'session-2' }),
  ]);

  assert.equal(observed.status, 'OBSERVED');
  assert.match(observed.reason, /independent of each other/);
  assert.equal(observed.ready_for_promotion, false);
  assert.equal(observed.validation_requirements.human_approval_required, true);
});

test('no input reaches VALIDATED or PROMOTED', () => {
  const attempts = [
    [],
    [run()],
    Array.from({ length: 12 }, (_, index) => run({ run_id: `run-${index}`, session_id: `session-${index}` })),
  ];

  for (const runs of attempts) {
    const state = stateFor(runs);
    assert.ok(LIFECYCLE_STATES.includes(state.status));
    assert.ok(!FORBIDDEN_STATES.includes(state.status));
    assert.equal(state.ready_for_promotion, false);
  }

  // Even a caller that hands in a fabricated recurrence verdict gets a state
  // from the allowed set, never one of the two this skill may not assign.
  const forced = assignLifecycleState({ recurrence: { recurrence: true, reason: 'asserted by a caller' } });
  assert.equal(forced.status, 'OBSERVED');
  assert.equal(forced.ready_for_promotion, false);
});

test('a missing assessment is PROPOSED with the absence stated', () => {
  const state = assignLifecycleState({});

  assert.equal(state.status, 'PROPOSED');
  assert.match(state.reason, /no recurrence assessment was supplied/);
});

test('malformed input is refused rather than counted as corroboration', () => {
  assert.equal(assessRecurrence(null).recurrence, false);
  assert.equal(assessRecurrence(undefined).recurrence, false);
  assert.equal(assessRecurrence([{}, {}]).recurrence, false);
});
