import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADOPTION_DECISIONS,
  CAPABILITY_FAILURES,
  OVERLAP_LEVELS,
  decideAdoptions,
} from './duplicate-capability.mjs';

const CAPABILITIES = [
  { id: 'existing-one', job: 'Summarize a change set.' },
  { id: 'existing-two', job: 'Open a change request.' },
];

function job(id, overlaps) {
  return {
    id,
    statement: `Do ${id}.`,
    assessments: CAPABILITIES.map((capability, index) => ({
      capabilityId: capability.id,
      overlap: overlaps[index],
      evidence: overlaps[index] === 'none' ? undefined : `${id} vs ${capability.id}: compared jobs.`,
    })),
  };
}

function refusal(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

test('a job no existing capability covers is created', () => {
  const result = decideAdoptions({
    jobs: [job('new-job', ['none', 'none'])],
    capabilities: CAPABILITIES,
    capabilitiesEnumerated: true,
  });
  assert.equal(result.decisions[0].decision, 'create');
  assert.equal(result.decisions[0].reason, 'no-existing-capability-for-this-job');
  assert.deepEqual(result.summary, { create: 1, 'route-existing': 0, stop: 0 });
  assert.deepEqual(result.creatable, ['new-job']);
  assert.deepEqual(result.blocking, []);
});

test('a job the destination already does routes truthfully instead of being created', () => {
  const result = decideAdoptions({
    jobs: [job('duplicate-job', ['same-job', 'none'])],
    capabilities: CAPABILITIES,
    capabilitiesEnumerated: true,
  });
  const [decision] = result.decisions;
  assert.equal(decision.decision, 'route-existing');
  assert.equal(decision.existing, 'existing-one');
  assert.equal(decision.evidence.length, 1);
  assert.ok(decision.waysForward.length >= 1);
  assert.deepEqual(result.creatable, []);
});

test('two capabilities claiming the same job is a question, not a coin flip', () => {
  const result = decideAdoptions({
    jobs: [job('duplicate-job', ['same-job', 'same-job'])],
    capabilities: CAPABILITIES,
    capabilitiesEnumerated: true,
  });
  const [decision] = result.decisions;
  assert.equal(decision.decision, 'stop');
  assert.equal(decision.reason, 'ambiguous-existing-capability');
  assert.deepEqual(decision.existing, ['existing-one', 'existing-two']);
});

test('a partial overlap stops for a human rather than forcing creation', () => {
  const result = decideAdoptions({
    jobs: [job('overlapping-job', ['partial', 'none'])],
    capabilities: CAPABILITIES,
    capabilitiesEnumerated: true,
  });
  const [decision] = result.decisions;
  assert.equal(decision.decision, 'stop');
  assert.equal(decision.reason, 'undecided-overlap');
  assert.ok(decision.waysForward.length >= 2);
  assert.deepEqual(result.blocking, ['overlapping-job']);
});

test('an unenumerated inventory cannot establish that a job is absent', () => {
  const result = decideAdoptions({
    jobs: [job('new-job', ['none', 'none'])],
    capabilities: CAPABILITIES,
    capabilitiesEnumerated: false,
  });
  assert.equal(result.decisions[0].decision, 'stop');
  assert.equal(result.decisions[0].reason, 'capability-inventory-unavailable');
  assert.equal(
    decideAdoptions({ jobs: [job('new-job', ['none', 'none'])], capabilities: CAPABILITIES })
      .decisions[0].reason,
    'capability-inventory-unavailable',
  );
});

test('a destination with no declared capabilities still creates only when enumeration happened', () => {
  const bare = { id: 'solo', statement: 'Do solo.', assessments: [] };
  assert.equal(
    decideAdoptions({ jobs: [bare], capabilities: [], capabilitiesEnumerated: true }).decisions[0]
      .decision,
    'create',
  );
  assert.equal(
    decideAdoptions({ jobs: [bare], capabilities: [], capabilitiesEnumerated: false }).decisions[0]
      .decision,
    'stop',
  );
});

test('a confirmed synthesis may warrant several destination skills at once', () => {
  const result = decideAdoptions({
    jobs: [
      job('first-job', ['none', 'none']),
      job('second-job', ['none', 'none']),
      job('third-job', ['same-job', 'none']),
    ],
    capabilities: CAPABILITIES,
    capabilitiesEnumerated: true,
  });
  assert.deepEqual(result.summary, { create: 2, 'route-existing': 1, stop: 0 });
  assert.deepEqual(result.creatable, ['first-job', 'second-job']);
  assert.deepEqual(
    result.decisions.map((decision) => decision.decision),
    ['create', 'create', 'route-existing'],
  );
});

test('the published decision and overlap vocabularies are what this atom promises', () => {
  assert.deepEqual(ADOPTION_DECISIONS, ['create', 'route-existing', 'stop']);
});

test('an incomplete, unknown, unevidenced, or unrecognized assessment is refused', () => {
  const enumerated = true;
  const cases = [
    [
      { id: 'a', statement: 'a', assessments: [{ capabilityId: 'existing-one', overlap: 'none' }] },
      CAPABILITY_FAILURES.incompleteAssessment,
    ],
    [
      {
        id: 'a',
        statement: 'a',
        assessments: [{ capabilityId: 'ghost', overlap: 'none' }],
      },
      CAPABILITY_FAILURES.unknownCapability,
    ],
    [
      {
        id: 'a',
        statement: 'a',
        assessments: CAPABILITIES.map((capability) => ({
          capabilityId: capability.id,
          overlap: 'probably',
        })),
      },
      CAPABILITY_FAILURES.invalidOverlap,
    ],
    [
      {
        id: 'a',
        statement: 'a',
        assessments: [
          { capabilityId: 'existing-one', overlap: 'same-job' },
          { capabilityId: 'existing-two', overlap: 'none' },
        ],
      },
      CAPABILITY_FAILURES.missingEvidence,
    ],
  ];
  for (const [candidate, code] of cases) {
    assert.equal(
      refusal(() =>
        decideAdoptions({
          jobs: [candidate],
          capabilities: CAPABILITIES,
          capabilitiesEnumerated: enumerated,
        }),
      ).code,
      code,
    );
  }
  assert.equal(
    refusal(() => decideAdoptions({ jobs: [], capabilities: CAPABILITIES })).code,
    CAPABILITY_FAILURES.noJobs,
  );
  assert.equal(
    refusal(() =>
      decideAdoptions({
        jobs: [job('same', ['none', 'none']), job('same', ['none', 'none'])],
        capabilities: CAPABILITIES,
        capabilitiesEnumerated: true,
      }),
    ).code,
    CAPABILITY_FAILURES.usage,
  );
});

test('the published decision and overlap vocabularies are what this atom promises', () => {
  // Pinned as literals rather than looped from the exported constants, so a
  // vocabulary and the guard that reads it cannot shrink together unnoticed.
  assert.deepEqual(ADOPTION_DECISIONS, ['create', 'route-existing', 'stop']);
  assert.deepEqual(OVERLAP_LEVELS, ['same-job', 'partial', 'none']);
});
