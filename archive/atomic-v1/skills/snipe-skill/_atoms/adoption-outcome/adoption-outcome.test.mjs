import assert from 'node:assert/strict';
import test from 'node:test';

import {
  JOB_DECISIONS,
  OUTCOME_FAILURES,
  REVIEW_DISPOSITIONS,
  RUN_STATUSES,
  publicOutcome,
  resolveOutcome,
  stopWith,
} from './adoption-outcome.mjs';

const HEAD = 'a1b2c3d4';

function complete(skill, head = HEAD) {
  return {
    skill,
    job: `job-${skill}`,
    head,
    validation: {
      passed: true,
      commands: ['node scripts/validate-skill-graph.mjs', 'node scripts/run-registered-tests.mjs'],
      summary: '2853 pass, 0 fail, 0 cancelled',
      head,
    },
    review: { disposition: 'clean', account: 'every finding fixed or duck-declined', head },
    changeRequest: { locator: `change-request/${skill}`, head },
    merged: false,
    approved: false,
  };
}

/** The ledger the routing step produced, for the jobs these destinations serve. */
function creating(...skills) {
  return skills.map((skill) => ({ job: `job-${skill}`, decision: 'create' }));
}

/** A routing ledger entry names the skill the routing step actually selected. */
function routing(job, existing) {
  return { job, decision: 'route-existing', existing };
}

function resolve(input) {
  return resolveOutcome({
    decisions: input.decisions ?? creating(...(input.destinations ?? []).map((d) => d.skill)),
    ...input,
  });
}

function refusal(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

test('the closed vocabularies are what this atom publishes, pinned independently', () => {
  assert.deepEqual(RUN_STATUSES, [
    'adopted',
    'routed-existing',
    'awaiting-human',
    'refused',
    'blocked',
  ]);
  assert.deepEqual(REVIEW_DISPOSITIONS, [
    'clean',
    'unresolved',
    'awaiting-operator',
    'halted',
    'absent',
  ]);
  assert.deepEqual(JOB_DECISIONS, ['create', 'route-existing', 'stop']);
});

test('every confirmed job is accounted for, or the outcome is refused', () => {
  // The quiet drop: two jobs confirmed, one destination reported, and a report
  // that reads like a clean success.
  assert.equal(
    refusal(() =>
      resolveOutcome({
        decisions: creating('one', 'two'),
        destinations: [complete('one')],
      }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  // A destination for a job nobody decided, or for a job decided differently.
  assert.equal(
    refusal(() =>
      resolveOutcome({ decisions: creating('one'), destinations: [complete('ghost')] }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  assert.equal(
    refusal(() =>
      resolveOutcome({
        decisions: [{ job: 'job-one', decision: 'route-existing' }],
        destinations: [complete('one')],
      }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  // A ledger that names one job twice is refused before reconciliation.
  const shared = complete('one');
  assert.equal(
    refusal(() =>
      resolveOutcome({ decisions: creating('one', 'one'), destinations: [shared, shared] }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  // A routed result must match a route-existing decision.
  assert.equal(
    refusal(() =>
      resolveOutcome({
        decisions: creating('one'),
        destinations: [complete('one')],
        routed: [{ job: 'job-one', skill: 'existing' }],
      }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  // A route-existing decision with no route reported at all.
  assert.equal(
    refusal(() => resolveOutcome({ decisions: [routing('job-one', 'existing')] })).code,
    OUTCOME_FAILURES.usage,
  );
  assert.equal(refusal(() => resolveOutcome({ destinations: [complete('one')] })).code, OUTCOME_FAILURES.usage);
  assert.equal(
    refusal(() => resolveOutcome({ decisions: [{ job: 'a', decision: 'maybe' }] })).code,
    OUTCOME_FAILURES.usage,
  );
  assert.equal(
    refusal(() =>
      resolveOutcome({ decisions: [{ job: 'a', decision: 'stop' }, { job: 'a', decision: 'stop' }] }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
});

test('one created package cannot discharge two distinct confirmed jobs', () => {
  // Two jobs, one package, one review, one change request — and both would have
  // reported as adopted on evidence that only ever covered one of them.
  const first = complete('one');
  const second = { ...complete('one'), job: 'job-two' };
  assert.equal(
    refusal(() =>
      resolveOutcome({ decisions: creating('one', 'two'), destinations: [first, second] }),
    ).code,
    OUTCOME_FAILURES.usage,
  );

  // Distinct packages sharing one change request fail for the same reason.
  const sharedRequest = { ...complete('two'), changeRequest: first.changeRequest };
  assert.equal(
    refusal(() =>
      resolveOutcome({ decisions: creating('one', 'two'), destinations: [first, sharedRequest] }),
    ).code,
    OUTCOME_FAILURES.usage,
  );

  // Two properly distinct packages still adopt.
  assert.equal(
    resolveOutcome({
      decisions: creating('one', 'two'),
      destinations: [first, complete('two')],
    }).status,
    'adopted',
  );
});

test('a skill cannot be newly created for one job and already-existing for another', () => {
  // Keeping one identity set per collection let the same skill be reported as
  // built for one job and as an existing route for another, which claims a
  // package was simultaneously created and already there.
  assert.equal(
    refusal(() =>
      resolveOutcome({
        decisions: [
          { job: 'new-job', decision: 'create' },
          routing('existing-job', 'shared'),
        ],
        destinations: [{ ...complete('shared'), job: 'new-job' }],
        routed: [{ job: 'existing-job', skill: 'shared' }],
      }),
    ).code,
    OUTCOME_FAILURES.usage,
  );

  // Distinct identities across the two collections remain a valid mixed run.
  assert.equal(
    resolveOutcome({
      decisions: [{ job: 'new-job', decision: 'create' }, routing('existing-job', 'other')],
      destinations: [{ ...complete('one'), job: 'new-job' }],
      routed: [{ job: 'existing-job', skill: 'other' }],
    }).status,
    'adopted',
  );
});

test('a route must go to the skill the routing decision actually selected', () => {
  // Without this, the run reports that a job is already done somewhere the
  // routing step never assessed.
  assert.equal(
    refusal(() =>
      resolveOutcome({
        decisions: [routing('job-one', 'selected-skill')],
        routed: [{ job: 'job-one', skill: 'unassessed-skill' }],
      }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  // A routing decision that names no target cannot be reconciled at all.
  assert.equal(
    refusal(() =>
      resolveOutcome({
        decisions: [{ job: 'job-one', decision: 'route-existing' }],
        routed: [{ job: 'job-one', skill: 'anything' }],
      }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  // One existing skill cannot discharge two routed jobs.
  assert.equal(
    refusal(() =>
      resolveOutcome({
        decisions: [routing('job-one', 'shared'), routing('job-two', 'shared')],
        routed: [
          { job: 'job-one', skill: 'shared' },
          { job: 'job-two', skill: 'shared' },
        ],
      }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  // Two routed records claiming the same ledger job.
  assert.equal(
    refusal(() =>
      resolveOutcome({
        decisions: [routing('job-one', 'existing-one')],
        routed: [
          { job: 'job-one', skill: 'existing-one' },
          { job: 'job-one', skill: 'existing-one' },
        ],
      }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  // A routed record for a job the ledger never carried.
  assert.equal(
    refusal(() =>
      resolveOutcome({
        decisions: [routing('job-one', 'existing-one')],
        routed: [
          { job: 'job-one', skill: 'existing-one' },
          { job: 'job-ghost', skill: 'existing-two' },
        ],
      }),
    ).code,
    OUTCOME_FAILURES.usage,
  );
  assert.equal(
    resolveOutcome({
      decisions: [routing('job-one', 'selected-skill')],
      routed: [{ job: 'job-one', skill: 'selected-skill' }],
    }).status,
    'routed-existing',
  );
});

test('one unresolved job outranks everything that went well', () => {
  const outcome = resolveOutcome({
    decisions: [...creating('one'), { job: 'job-two', decision: 'stop' }],
    destinations: [complete('one')],
  });
  assert.equal(outcome.status, 'awaiting-human');
  assert.equal(outcome.reason, 'undecided-jobs');
  assert.deepEqual(outcome.created, ['one']);
  assert.deepEqual(outcome.unresolved, ['job-two']);
  assert.equal(outcome.merged, false);

  // And it still outranks a shortfall, which would otherwise report `blocked`
  // and bury the decision the operator is the only one who can make.
  const failing = complete('one');
  failing.validation = { ...failing.validation, passed: false };
  const both = resolveOutcome({
    decisions: [...creating('one'), { job: 'job-two', decision: 'stop' }],
    destinations: [failing],
  });
  assert.equal(both.status, 'awaiting-human');
  assert.equal(both.reason, 'undecided-jobs');
  assert.deepEqual(both.unresolved, ['job-two']);
  assert.deepEqual(both.shortfalls[0].shortfalls, ['validation did not pass']);
});

test('a destination with passing validation, a clean review, and a change request is adopted', () => {
  const outcome = resolve({ destinations: [complete('one')] });
  assert.equal(outcome.status, 'adopted');
  assert.deepEqual(outcome.created, ['one']);
  assert.deepEqual(outcome.changeRequests, ['change-request/one']);
  assert.deepEqual(outcome.shortfalls, []);
  assert.equal(outcome.validation[0].commands.length, 2);
  assert.equal(outcome.merged, false);
  assert.equal(outcome.approved, false);
});

test('one confirmed synthesis may adopt several destination skills at once', () => {
  const outcome = resolve({
    destinations: [complete('one'), complete('two'), complete('three')],
  });
  assert.equal(outcome.status, 'adopted');
  assert.deepEqual(outcome.created, ['one', 'two', 'three']);
  assert.equal(outcome.changeRequests.length, 3);
  assert.equal(publicOutcome(outcome).createdCount, 3);
});

test('evidence describing a different head than the package blocks the run', () => {
  // The stale review: a package corrected after review, reported with the
  // earlier verdict. Two labels could not express this; the head can.
  const stale = complete('one');
  stale.review = { ...stale.review, head: 'an-earlier-head' };
  const reviewed = resolve({ destinations: [stale] });
  assert.equal(reviewed.status, 'blocked');
  assert.deepEqual(reviewed.shortfalls[0].shortfalls, [
    'the review describes a different head than the package',
  ]);

  const revalidated = complete('one');
  revalidated.validation = { ...revalidated.validation, head: 'an-earlier-head' };
  assert.deepEqual(resolve({ destinations: [revalidated] }).shortfalls[0].shortfalls, [
    'validation describes a different head than the package',
  ]);

  const republished = complete('one');
  republished.changeRequest = { ...republished.changeRequest, head: 'an-earlier-head' };
  assert.deepEqual(resolve({ destinations: [republished] }).shortfalls[0].shortfalls, [
    'the change request describes a different head than the package',
  ]);
});

test('a destination missing validation, review, or a change request blocks the whole run', () => {
  const failed = complete('one');
  failed.validation = { ...failed.validation, passed: false };
  assert.deepEqual(resolve({ destinations: [failed] }).shortfalls[0].shortfalls, [
    'validation did not pass',
  ]);

  const unreviewed = complete('one');
  unreviewed.review = { ...unreviewed.review, disposition: 'absent' };
  assert.deepEqual(resolve({ destinations: [unreviewed] }).shortfalls[0].shortfalls, [
    'no review ran on the final head',
  ]);

  const unresolved = complete('one');
  unresolved.review = { ...unresolved.review, disposition: 'unresolved' };
  assert.deepEqual(resolve({ destinations: [unresolved] }).shortfalls[0].shortfalls, [
    'review is unresolved',
  ]);

  const unpublished = complete('one');
  unpublished.changeRequest = null;
  const blocked = resolve({ destinations: [unpublished] });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.reason, 'incomplete-destination-evidence');
  assert.deepEqual(blocked.shortfalls[0].shortfalls, ['no change request was opened']);

  const second = { ...complete('two'), review: { ...complete('two').review, disposition: 'absent' } };
  const mixed = resolveOutcome({
    decisions: creating('one', 'two'),
    destinations: [complete('one'), second],
  });
  assert.equal(mixed.status, 'blocked');
  assert.deepEqual(mixed.shortfalls.map((entry) => entry.skill), ['two']);
});

test('a run that claims a merge or an approval is refused, however complete it looks', () => {
  assert.equal(
    refusal(() => resolve({ destinations: [{ ...complete('one'), merged: true }] })).code,
    OUTCOME_FAILURES.authorityExceeded,
  );
  assert.equal(
    refusal(() => resolve({ destinations: [{ ...complete('one'), approved: true }] })).code,
    OUTCOME_FAILURES.authorityExceeded,
  );
});

test('evidence that cannot describe what it claims is a usage error, not a shortfall', () => {
  const base = complete('one');
  const cases = [
    { ...base, extra: 1 },
    { ...base, head: '   ' },
    { ...base, validation: { ...base.validation, commands: [] } },
    { ...base, validation: { ...base.validation, commands: ['  '] } },
    { ...base, validation: { ...base.validation, summary: '' } },
    { ...base, validation: { passed: true, commands: ['x'], head: HEAD } },
    { ...base, validation: true },
    { ...base, review: { ...base.review, disposition: 'fine' } },
    { ...base, review: { ...base.review, account: '' } },
    { ...base, review: 'clean' },
    { ...base, changeRequest: 'change-request/one' },
    { ...base, changeRequest: { locator: '  ', head: HEAD } },
    { ...base, merged: 'no' },
  ];
  for (const destination of cases) {
    assert.equal(
      refusal(() =>
        resolveOutcome({ decisions: creating('one'), destinations: [destination] }),
      ).code,
      OUTCOME_FAILURES.usage,
      JSON.stringify(destination).slice(0, 90),
    );
  }
});

test('a run where every job is already done routes, creates nothing, and needs no change request', () => {
  const outcome = resolveOutcome({
    decisions: [routing('job-one', 'existing-one')],
    routed: [{ job: 'job-one', skill: 'existing-one' }],
  });
  assert.equal(outcome.status, 'routed-existing');
  assert.deepEqual(outcome.created, []);
  assert.deepEqual(outcome.routed, ['existing-one']);
  assert.equal(outcome.changeRequests, undefined);
  assert.equal(publicOutcome(outcome).routedCount, 1);
});

test('a routed result names the job and the skill it routed to, or it is a usage error', () => {
  // Claiming the destination already does the job while naming nothing is worse
  // than an error, because it reads as a resolved run.
  const decisions = [routing('job-one', 'existing-one')];
  for (const routed of [
    [null],
    [{ job: 'job-one', skill: '  ' }],
    [{ job: 'job-one' }],
    [{ job: 'job-one', skill: 'x', extra: 1 }],
    'existing-one',
  ]) {
    assert.equal(
      refusal(() => resolveOutcome({ decisions, routed })).code,
      OUTCOME_FAILURES.usage,
    );
  }
  assert.deepEqual(
    resolveOutcome({ decisions, routed: [{ job: 'job-one', skill: ' existing-one ' }] }).routed,
    ['existing-one'],
  );
});

test('an outcome accounting for nothing is a usage error, not an empty success', () => {
  assert.equal(refusal(() => resolveOutcome({})).code, OUTCOME_FAILURES.usage);
  assert.equal(refusal(() => resolveOutcome({ decisions: [] })).code, OUTCOME_FAILURES.usage);
  assert.equal(
    refusal(() => resolveOutcome({ decisions: creating('one'), destinations: 'one' })).code,
    OUTCOME_FAILURES.usage,
  );
});

test('a stop names the unresolved decision and at least one bounded way forward', () => {
  const stop = stopWith({
    status: 'awaiting-human',
    decision: 'Whether the overlapping destination skill should be extended instead.',
    waysForward: ['Extend the existing skill.', 'Confirm a narrower job and create a new one.'],
    evidence: ['source: skills/example/SKILL.md@sha256'],
  });
  assert.equal(stop.status, 'awaiting-human');
  assert.equal(stop.waysForward.length, 2);
  assert.deepEqual(stop.created, []);
  assert.equal(stop.merged, false);

  assert.equal(
    refusal(() => stopWith({ status: 'awaiting-human', decision: 'x', waysForward: [] })).code,
    OUTCOME_FAILURES.noWayForward,
  );
  assert.equal(
    refusal(() => stopWith({ status: 'awaiting-human', decision: 'x', waysForward: ['  '] })).code,
    OUTCOME_FAILURES.noWayForward,
  );
  assert.equal(
    refusal(() => stopWith({ status: 'adopted', decision: 'x', waysForward: ['y'] })).code,
    OUTCOME_FAILURES.usage,
  );
  assert.equal(
    refusal(() => stopWith({ status: 'refused', decision: '  ', waysForward: ['y'] })).code,
    OUTCOME_FAILURES.usage,
  );
});

test('every reported status comes from the closed set, and never claims authority it lacks', () => {
  const outcomes = [
    resolve({ destinations: [complete('one')] }),
    resolveOutcome({
      decisions: [routing('job-one', 'existing')],
      routed: [{ job: 'job-one', skill: 'existing' }],
    }),
    stopWith({
      status: 'refused',
      decision: 'Source unreadable.',
      waysForward: ['Name a readable source.'],
    }),
  ];
  for (const outcome of outcomes) {
    assert.ok(RUN_STATUSES.includes(outcome.status));
    const summary = publicOutcome(outcome);
    assert.equal(summary.merged, false);
    assert.equal(summary.approved, false);
  }
  assert.equal(refusal(() => publicOutcome({ status: 'shipped' })).code, OUTCOME_FAILURES.usage);
});
