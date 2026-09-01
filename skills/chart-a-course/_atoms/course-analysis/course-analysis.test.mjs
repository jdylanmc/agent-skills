import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { chartCourse } from './course-analysis.mjs';

const fixtures = JSON.parse(
  fs.readFileSync(new URL('./course-analysis.fixtures.json', import.meta.url), 'utf8'),
);

test('accepts one goal and a mixed bounded set while keeping irrelevant work visible', () => {
  const result = chartCourse(fixtures.mixedRequirementsTickets);

  assert.equal(result.goal, 'REQ-1');
  assert.equal(result.revision, 'rev-7');
  assert.deepEqual(
    result.gatingSubgraph.value.records.map(({ id, kind }) => [id, kind]),
    [['REQ-1', 'requirement'], ['T-1', 'ticket'], ['T-2', 'ticket']],
  );
  assert.deepEqual(result.outsideWork.value.map(({ id }) => id), ['NOTE-1']);
  assert.ok(result.pathResult.chains.every((chain) => !chain.includes('NOTE-1')));
});

test('refuses unsafe conclusions for cycles and ambiguous edge direction', () => {
  const cycle = chartCourse(fixtures.cycle);
  const ambiguous = chartCourse(fixtures.missingEdgesAndAmbiguousDirection);

  assert.equal(cycle.completeness.safeToConclude, false);
  assert.equal(cycle.pathResult.mode, 'refused');
  assert.deepEqual(cycle.cycles, [['A', 'B']]);
  assert.equal(ambiguous.completeness.safeToConclude, false);
  assert.equal(ambiguous.pathResult.mode, 'refused');
  assert.equal(ambiguous.unresolvedEdges.length, 2);
  assert.deepEqual(ambiguous.readyFrontier.value, []);
});

test('uses weighted longest paths only with reliable same-unit estimates and preserves ties', () => {
  const result = chartCourse(fixtures.tiedWeightedPaths);

  assert.equal(result.pathResult.mode, 'weighted');
  assert.equal(result.pathResult.value, 3);
  assert.equal(result.pathResult.unit, 'days');
  assert.deepEqual(result.pathResult.chains, [['A', 'G'], ['B', 'G']]);
  assert.ok(result.reorderingUnknowns.value.includes('tied-longest-chains'));
});

test('without estimates reports a structural chain that is not a time schedule', () => {
  const result = chartCourse(fixtures.absentEstimates);

  assert.equal(result.pathResult.mode, 'structural');
  assert.match(result.pathResult.label, /not a calendar or time critical path/);
  assert.equal(result.pathResult.value, 3);
  assert.deepEqual(result.pathResult.chains, [['A', 'B', 'G']]);
  assert.ok(result.reorderingUnknowns.value.includes('A:estimate-missing'));
});

test('completed prerequisites satisfy readiness, remain in topology, and have zero remaining weight', () => {
  const result = chartCourse(fixtures.completedPrerequisites);

  assert.deepEqual(result.completed.value.map(({ id }) => id), ['A']);
  assert.deepEqual(result.readyFrontier.value.map(({ id }) => id), ['G']);
  assert.deepEqual(result.pathResult.chains, [['A', 'G']]);
  assert.equal(result.pathResult.value, 1);
  assert.equal(result.pathResult.unit, 'remaining-records');
});

test('blocked work lists real incomplete blockers', () => {
  const result = chartCourse(fixtures.blockedWork);
  const byId = new Map(result.blocked.value.map((entry) => [entry.id, entry]));

  assert.deepEqual(result.readyFrontier.value.map(({ id }) => id), ['A']);
  assert.deepEqual(byId.get('B').blockers, ['A']);
  assert.equal(byId.get('B').explicitlyBlocked, true);
  assert.deepEqual(byId.get('G').blockers, ['B']);
});

test('irrelevant work cannot change gating readiness, blockers, or paths', () => {
  const result = chartCourse(fixtures.irrelevantWork);

  assert.deepEqual(result.outsideWork.value.map(({ id }) => id), ['X', 'Y']);
  assert.deepEqual(result.readyFrontier.value.map(({ id }) => id), ['A']);
  assert.deepEqual(result.blocked.value.map(({ id }) => id), ['G']);
  assert.deepEqual(result.pathResult.chains, [['A', 'G']]);
});

test('stale state affecting the goal refuses path, frontier, and blocker conclusions', () => {
  const result = chartCourse(fixtures.staleStatus);

  assert.equal(result.completeness.safeToConclude, false);
  assert.equal(result.pathResult.mode, 'refused');
  assert.ok(result.reorderingUnknowns.value.includes('A:status-stale'));
  assert.deepEqual(result.completed.value, []);
  assert.deepEqual(result.readyFrontier.value, []);
  assert.deepEqual(result.blocked.value, []);
});

test('stale or unknown gating completion that can change the longest path refuses unsafe conclusions', () => {
  for (const uncertainRecord of [
    {
      id: 'A',
      status: 'done',
      statusObservedAt: '2026-08-29T00:00:00Z',
      estimate: { value: 100, unit: 'points', reliable: true },
    },
    {
      id: 'A',
      status: 'mystery',
      statusObservedAt: '2026-08-30T00:00:00Z',
      estimate: { value: 100, unit: 'points', reliable: true },
    },
  ]) {
    const result = chartCourse({
      goal: 'G',
      observationTime: '2026-08-30T00:00:00Z',
      freshness: { maxStatusAgeSeconds: 60 },
      records: [
        uncertainRecord,
        {
          id: 'B',
          status: 'open',
          statusObservedAt: '2026-08-30T00:00:00Z',
          estimate: { value: 5, unit: 'points', reliable: true },
        },
        {
          id: 'G',
          status: 'open',
          statusObservedAt: '2026-08-30T00:00:00Z',
          estimate: { value: 1, unit: 'points', reliable: true },
        },
      ],
      edges: [
        { prerequisite: 'A', dependent: 'G' },
        { prerequisite: 'B', dependent: 'G' },
      ],
    });

    assert.equal(result.completeness.safeToConclude, false);
    assert.equal(result.pathResult.mode, 'refused');
    assert.deepEqual(result.pathResult.chains, []);
    assert.deepEqual(result.readyFrontier.value, []);
    assert.deepEqual(result.blocked.value, []);
    assert.deepEqual(
      result.gatingSubgraph.value.records.map(({ id }) => id),
      ['A', 'B', 'G'],
    );
  }
});

test('duplicate identities and absent goals are refused without guessing', () => {
  const duplicate = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [{ id: 'G', status: 'open' }, { id: 'G', status: 'done' }],
    edges: [],
  });
  const absent = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [{ id: 'A', status: 'open' }],
    edges: [],
  });

  assert.equal(duplicate.pathResult.mode, 'refused');
  assert.equal(absent.pathResult.mode, 'refused');
  assert.deepEqual(duplicate.gatingSubgraph.value.records, []);
  assert.deepEqual(absent.gatingSubgraph.value.records, []);
});

test('missing identities and absent endpoints refuse unsafe conclusions', () => {
  const missingIdentity = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [{ id: 'G', status: 'open' }, { status: 'open' }],
    edges: [],
  });
  const absentEndpoint = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [{ id: 'G', status: 'open' }],
    edges: [{ prerequisite: 'MISSING', dependent: 'G' }],
  });

  assert.equal(missingIdentity.completeness.safeToConclude, true);
  assert.equal(missingIdentity.pathResult.mode, 'structural');
  assert.equal(missingIdentity.pathResult.confidence, 'medium');
  assert.equal(absentEndpoint.completeness.safeToConclude, false);
  assert.equal(absentEndpoint.pathResult.mode, 'refused');
  assert.deepEqual(absentEndpoint.readyFrontier.value, []);
});

test('completed intermediary nodes remain in structural and weighted path topology', () => {
  const base = {
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [
      { id: 'A', status: 'open' },
      { id: 'B', status: 'done' },
      { id: 'G', status: 'open' },
    ],
    edges: [
      { prerequisite: 'A', dependent: 'B' },
      { prerequisite: 'B', dependent: 'G' },
    ],
  };
  const structural = chartCourse(base);
  assert.deepEqual(structural.pathResult.chains, [['A', 'B', 'G']]);
  assert.equal(structural.pathResult.value, 2);

  const weighted = chartCourse({
    ...base,
    records: [
      { id: 'A', status: 'open', estimate: { value: 2, unit: 'points', reliable: true } },
      { id: 'B', status: 'done' },
      { id: 'G', status: 'open', estimate: { value: 3, unit: 'points', reliable: true } },
    ],
  });
  assert.equal(weighted.pathResult.mode, 'weighted');
  assert.deepEqual(weighted.pathResult.chains, [['A', 'B', 'G']]);
  assert.equal(weighted.pathResult.value, 5);
  assert.deepEqual(weighted.completed.value.map(({ id }) => id), ['B']);
});

test('clearly unrelated malformed, cyclic, and absent-endpoint evidence qualifies but does not suppress a clean goal', () => {
  const result = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [
      { id: 'A', status: 'open' },
      { id: 'G', status: 'open' },
      { id: 'X', status: 'open' },
      { id: 'Y', status: 'open' },
      { status: 'open' },
    ],
    edges: [
      { prerequisite: 'A', dependent: 'G' },
      { prerequisite: 'X', dependent: 'Y' },
      { prerequisite: 'Y', dependent: 'X' },
      { prerequisite: 'X', dependent: 'ABSENT' },
      { source: 'X', target: 'Y' },
    ],
  });

  assert.equal(result.completeness.complete, false);
  assert.equal(result.completeness.safeToConclude, true);
  assert.equal(result.pathResult.mode, 'structural');
  assert.equal(result.pathResult.confidence, 'medium');
  assert.deepEqual(result.pathResult.chains, [['A', 'G']]);
  assert.deepEqual(result.readyFrontier.value.map(({ id }) => id), ['A']);
  assert.ok(result.reorderingUnknowns.value.includes('outside-defects-excluded-from-course'));
  assert.ok(result.reorderingUnknowns.value.includes('outside-cycle-excluded-from-course'));
});

test('unresolved evidence refuses only when it can change goal membership', () => {
  const result = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [{ id: 'G', status: 'open' }, { id: 'X', status: 'open' }],
    edges: [
      { prerequisite: 'MISSING', dependent: 'G' },
      { source: 'X', target: 'G' },
    ],
  });

  assert.equal(result.completeness.safeToConclude, false);
  assert.equal(result.pathResult.mode, 'refused');
  assert.deepEqual(
    result.completeness.affectingDefects.map(({ code }) => code),
    ['absent-edge-endpoint', 'ambiguous-edge-direction'],
  );
});

test('fractional estimates are unusable and force structural mode without floating tie loss', () => {
  const result = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [
      { id: 'A', status: 'open', estimate: { value: 0.1, unit: 'days', reliable: true } },
      { id: 'B', status: 'open', estimate: { value: 0.3, unit: 'days', reliable: true } },
      { id: 'C', status: 'open', estimate: { value: 0.2, unit: 'days', reliable: true } },
      { id: 'G', status: 'open', estimate: { value: 1, unit: 'days', reliable: true } },
    ],
    edges: [
      { prerequisite: 'A', dependent: 'C' },
      { prerequisite: 'C', dependent: 'G' },
      { prerequisite: 'B', dependent: 'G' },
    ],
  });

  assert.equal(result.pathResult.mode, 'structural');
  assert.equal(result.pathResult.confidence, 'medium');
  assert.deepEqual(result.pathResult.chains, [['A', 'C', 'G']]);
  assert.ok(result.reorderingUnknowns.value.includes('A:estimate-non-integer'));
  assert.ok(result.reorderingUnknowns.value.includes('B:estimate-non-integer'));
  assert.ok(result.reorderingUnknowns.value.includes('C:estimate-non-integer'));
});

test('uses exact integer path sums beyond Number safe range with JSON-safe output', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const unequal = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [
      { id: 'A', status: 'open', estimate: { value: max, unit: 'points', reliable: true } },
      { id: 'B', status: 'open', estimate: { value: max - 1, unit: 'points', reliable: true } },
      { id: 'G', status: 'open', estimate: { value: 2, unit: 'points', reliable: true } },
    ],
    edges: [
      { prerequisite: 'A', dependent: 'G' },
      { prerequisite: 'B', dependent: 'G' },
    ],
  });
  assert.deepEqual(unequal.pathResult.chains, [['A', 'G']]);
  assert.equal(unequal.pathResult.value, '9007199254740993');
  assert.equal(unequal.pathResult.valueEncoding, 'decimal-string');
  assert.doesNotThrow(() => JSON.stringify(unequal));

  const equal = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [
      { id: 'A', status: 'open', estimate: { value: max, unit: 'points', reliable: true } },
      { id: 'B', status: 'open', estimate: { value: max, unit: 'points', reliable: true } },
      { id: 'G', status: 'open', estimate: { value: 1, unit: 'points', reliable: true } },
    ],
    edges: [
      { prerequisite: 'A', dependent: 'G' },
      { prerequisite: 'B', dependent: 'G' },
    ],
  });
  assert.deepEqual(equal.pathResult.chains, [['A', 'G'], ['B', 'G']]);
  assert.equal(equal.pathResult.value, '9007199254740992');
  assert.equal(equal.pathResult.valueEncoding, 'decimal-string');
  assert.doesNotThrow(() => JSON.stringify(equal));
});

test('safe path totals retain numeric JSON encoding', () => {
  const result = chartCourse(fixtures.tiedWeightedPaths);
  assert.equal(result.pathResult.value, 3);
  assert.equal(result.pathResult.valueEncoding, 'number');
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('malformed required structure and future gating timestamps refuse affected conclusions', () => {
  const malformed = chartCourse({
    goal: 'G',
    observationTime: 'bad',
    records: {},
    edges: [],
  });
  assert.equal(malformed.completeness.safeToConclude, false);
  assert.equal(malformed.pathResult.mode, 'refused');

  const future = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [
      { id: 'G', status: 'done', statusObservedAt: '2026-08-30T00:00:01Z' },
    ],
    edges: [],
  });
  assert.equal(future.completeness.safeToConclude, false);
  assert.equal(future.pathResult.mode, 'refused');
  assert.deepEqual(future.completed.value, []);
});

test('material confidence cites status time, freshness, estimate reliability, value, and unit evidence', () => {
  const result = chartCourse({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    freshness: { maxStatusAgeSeconds: 3600 },
    records: [
      {
        id: 'A',
        status: 'done',
        statusObservedAt: '2026-08-29T23:30:00Z',
        estimate: { value: 2, unit: 'points', reliable: true },
      },
      {
        id: 'G',
        status: 'open',
        statusObservedAt: '2026-08-30T00:00:00Z',
        estimate: { value: 3, unit: 'points', reliable: true },
      },
    ],
    edges: [{ prerequisite: 'A', dependent: 'G' }],
  });
  const evidence = result.pathResult.evidence.join('\n');
  assert.match(evidence, /record:A:status=done/);
  assert.match(evidence, /record:A:statusObservedAt=2026-08-29T23:30:00Z/);
  assert.match(evidence, /policy:observationTime=2026-08-30T00:00:00Z/);
  assert.match(evidence, /policy:maxStatusAgeSeconds=3600/);
  assert.match(evidence, /record:G:estimateValue=3/);
  assert.match(evidence, /record:G:estimateUnit=points/);
  assert.match(evidence, /record:G:estimateReliable=true/);
  assert.ok(result.readyFrontier.evidence.some((item) => item === 'record:A:status=done'));
  assert.ok(result.reorderingUnknowns.evidence.every((item) => !item.startsWith('unknown:')));
});

test('every result contains evidence-bearing conclusions and exactly one planning action', () => {
  for (const fixture of Object.values(fixtures)) {
    const result = chartCourse(fixture);
    assert.equal(typeof result.planningAction.action, 'string');
    assert.equal(result.planningAction.authority, 'planning-only');
    assert.equal(result.planningAction.confidence, 'high');
    assert.ok(Array.isArray(result.planningAction.evidence));
    for (const key of [
      'gatingSubgraph',
      'readyFrontier',
      'blocked',
      'completed',
      'outsideWork',
      'reorderingUnknowns',
    ]) {
      assert.ok(['high', 'medium', 'low', 'none'].includes(result[key].confidence));
      assert.ok(Array.isArray(result[key].evidence));
    }
    assert.ok(Array.isArray(result.pathResult.evidence));
  }
});

test('an unborn repository blocks implementation readiness without inventing a dependency edge', () => {
  const result = chartCourse(fixtures.unbornRepositoryWithFoundationIssue);
  const foundation = 'dylanmccurry_microsoft/agent-skills#1';
  const goal = 'dylanmccurry_microsoft/agent-skills#25';

  assert.deepEqual(result.gatingSubgraph.value.edges, []);
  assert.deepEqual(result.gatingSubgraph.value.records.map(({ id }) => id), [goal]);
  assert.deepEqual(result.outsideWork.value.map(({ id }) => id), [foundation]);
  assert.equal(result.readiness.dependency.value.status, 'ready');
  assert.equal(result.readiness.operational.value.status, 'blocked');
  assert.equal(result.readiness.implementation.value.status, 'operationally-blocked');
  assert.equal(result.readiness.implementation.value.readyForImplementation, false);

  const [prerequisite] = result.readiness.operational.value.prerequisites;
  assert.equal(prerequisite.state, 'unsatisfied');
  assert.equal(prerequisite.matchingRecord.id, foundation);
  assert.equal(
    prerequisite.matchingRecord.url,
    'https://github.com/dylanmccurry_microsoft/agent-skills/issues/1',
  );
  assert.deepEqual(prerequisite.dependencyEdge, {
    prerequisite: foundation,
    dependent: goal,
    explicit: false,
    confirmationRequired: true,
    status: 'human-confirmation-required',
  });
  assert.ok(result.readiness.operational.evidence.includes(
    `readiness:repository-default-branch-baseline:matchingRecord=${foundation}`,
  ));
});

test('an explicit confirmed foundation edge remains the only route into dependency topology', () => {
  const input = structuredClone(fixtures.unbornRepositoryWithFoundationIssue);
  input.edges.push({
    prerequisite: 'dylanmccurry_microsoft/agent-skills#1',
    dependent: 'dylanmccurry_microsoft/agent-skills#25',
  });

  const result = chartCourse(input);
  const [prerequisite] = result.readiness.operational.value.prerequisites;

  assert.deepEqual(result.gatingSubgraph.value.edges, input.edges);
  assert.equal(result.readiness.dependency.value.status, 'blocked');
  assert.equal(prerequisite.dependencyEdge.explicit, true);
  assert.equal(prerequisite.dependencyEdge.confirmationRequired, false);
  assert.equal(prerequisite.dependencyEdge.status, 'explicit-edge-present');
});

test('malformed readiness evidence leaves dependency conclusions intact but readiness uncertain', () => {
  const result = chartCourse({
    goal: 'G',
    observationTime: '2026-08-31T22:20:52Z',
    records: [{ id: 'G', status: 'open' }],
    edges: [],
    readinessObservations: {},
  });

  assert.equal(result.completeness.safeToConclude, true);
  assert.equal(result.pathResult.mode, 'structural');
  assert.equal(result.readiness.dependency.value.status, 'ready');
  assert.equal(result.readiness.operational.value.status, 'uncertain');
  assert.equal(result.readiness.implementation.value.status, 'uncertain');
  assert.equal(result.readiness.implementation.value.readyForImplementation, null);
});

test('operational readiness requires declared complete prerequisite coverage', () => {
  const base = {
    goal: 'G',
    revision: 'revision-1',
    observationTime: '2026-08-31T22:20:52Z',
    records: [{ id: 'G', status: 'open' }],
    edges: [],
    readinessFreshness: { maxObservationAgeSeconds: 3600 },
    readinessObservations: [
      {
        id: 'repository-baseline',
        kind: 'repository-baseline',
        state: 'satisfied',
        detail: 'The repository has a committed baseline.',
        source: 'repository-provider',
        sourceRevision: {
          algorithm: 'sha256',
          digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        observedAt: '2026-08-31T22:20:52Z',
        evidence: ['provider:commits=1'],
      },
    ],
  };

  const undeclared = chartCourse(base);
  const missing = chartCourse({
    ...base,
    readinessRequirementIds: ['repository-baseline', 'required-configuration'],
  });
  const complete = chartCourse({
    ...base,
    readinessRequirementIds: ['repository-baseline'],
  });

  assert.equal(undeclared.readiness.operational.value.status, 'uncertain');
  assert.equal(undeclared.readiness.implementation.value.readyForImplementation, null);
  assert.equal(undeclared.completeness.complete, false);
  assert.equal(undeclared.completeness.operational.complete, false);
  assert.equal(undeclared.readiness.operational.value.coverage.declared, false);
  assert.equal(missing.readiness.operational.value.status, 'uncertain');
  assert.ok(missing.readiness.operational.evidence.includes(
    'readiness:missing-required=required-configuration',
  ));
  assert.equal(complete.readiness.operational.value.status, 'ready');
  assert.equal(complete.readiness.implementation.value.status, 'ready');
  assert.equal(complete.readiness.implementation.value.readyForImplementation, true);
});

test('a supported operational blocker survives unrelated malformed readiness evidence', () => {
  const input = structuredClone(fixtures.unbornRepositoryWithFoundationIssue);
  input.readinessObservations.push({
    id: 'required-configuration',
    kind: 'repository-configuration',
    state: 'unknown',
    detail: 'Configuration could not be observed.',
    source: 'repository-provider',
    sourceRevision: {
      algorithm: 'sha256',
      digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
    observedAt: '2026-08-31T22:20:52Z',
    evidence: [],
  });

  const result = chartCourse(input);

  assert.equal(result.readiness.operational.value.status, 'blocked');
  assert.equal(result.readiness.operational.confidence, 'high');
  assert.equal(result.readiness.implementation.value.status, 'operationally-blocked');
  assert.equal(result.readiness.implementation.value.readyForImplementation, false);
  assert.equal(result.readiness.implementation.confidence, 'high');
  assert.equal(result.completeness.complete, false);
  assert.equal(result.completeness.operational.complete, false);
  assert.ok(result.readiness.operational.value.defects.some(
    ({ code }) => code === 'missing-readiness-observation-evidence',
  ));
});

test('dependency readiness cites the blocker edge and prerequisite status', () => {
  const result = chartCourse({
    goal: 'G',
    revision: 'revision-1',
    observationTime: '2026-08-31T22:20:52Z',
    records: [
      { id: 'A', status: 'open' },
      { id: 'G', status: 'open' },
    ],
    edges: [{ prerequisite: 'A', dependent: 'G' }],
  });

  assert.equal(result.readiness.dependency.value.status, 'blocked');
  assert.ok(result.readiness.dependency.evidence.includes('edge:A->G'));
  assert.ok(result.readiness.dependency.evidence.includes('record:A:status=open'));
});

test('missing source revision lowers confidence without inventing a revision', () => {
  const result = chartCourse({
    goal: 'G',
    observationTime: '2026-08-31T22:20:52Z',
    records: [{ id: 'G', status: 'open' }],
    edges: [],
  });

  assert.equal(result.sourceRevision.available, false);
  assert.equal(result.pathResult.confidence, 'medium');
  assert.ok(result.pathResult.evidence.includes('revision:unavailable'));
});

test('supplemental readiness observations remain visible without changing the declared gate', () => {
  const result = chartCourse({
    goal: 'G',
    revision: 'revision-1',
    observationTime: '2026-08-31T22:20:52Z',
    records: [{ id: 'G', status: 'open' }],
    edges: [],
    readinessRequirementIds: ['repository-baseline'],
    readinessFreshness: { maxObservationAgeSeconds: 3600 },
    readinessObservations: [
      {
        id: 'repository-baseline',
        kind: 'repository-baseline',
        state: 'satisfied',
        detail: 'The repository has a committed baseline.',
        source: 'repository-provider',
        sourceRevision: {
          algorithm: 'sha256',
          digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        observedAt: '2026-08-31T22:20:52Z',
        evidence: ['provider:commits=1'],
      },
      {
        id: 'optional-advisory',
        kind: 'repository-advisory',
        state: 'unsatisfied',
        detail: 'An optional advisory is unresolved.',
        source: 'repository-provider',
        sourceRevision: {
          algorithm: 'sha256',
          digest: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        },
        observedAt: '2026-08-31T20:00:00Z',
        evidence: ['provider:advisory=open'],
        matchingRecord: {
          id: 'OPTIONAL',
          url: 'not-a-url',
        },
      },
    ],
  });

  assert.equal(result.readiness.operational.value.status, 'ready');
  assert.equal(result.readiness.implementation.value.readyForImplementation, true);
  assert.equal(result.readiness.operational.value.gatingDefects.length, 0);
  assert.deepEqual(
    result.readiness.operational.value.supplementalDefects.map(({ code }) => code),
    ['invalid-readiness-matching-record-url', 'readiness-observation-stale'],
  );
  assert.equal(
    result.readiness.operational.value.prerequisites.find(
      ({ id }) => id === 'optional-advisory',
    ).required,
    false,
  );
});

test('a malformed foundation citation cannot erase a supported operational blocker', () => {
  const input = structuredClone(fixtures.unbornRepositoryWithFoundationIssue);
  input.readinessObservations[0].matchingRecord.title = '';
  input.readinessObservations[0].matchingRecord.url = 'not-a-url';

  const result = chartCourse(input);
  const [prerequisite] = result.readiness.operational.value.prerequisites;

  assert.equal(result.readiness.operational.value.status, 'blocked');
  assert.equal(result.readiness.operational.confidence, 'medium');
  assert.equal(result.readiness.implementation.value.readyForImplementation, false);
  assert.equal(prerequisite.matchingRecord.id, 'dylanmccurry_microsoft/agent-skills#1');
  assert.equal(prerequisite.matchingRecord.title, null);
  assert.equal(prerequisite.matchingRecord.url, null);
  assert.equal(prerequisite.dependencyEdge.confirmationRequired, true);
  assert.deepEqual(
    result.readiness.operational.value.nonGatingDefects.map(({ code }) => code),
    ['invalid-readiness-matching-record-title', 'invalid-readiness-matching-record-url'],
  );
});

test('stale or future provider observations cannot support operational readiness', () => {
  const stale = structuredClone(fixtures.unbornRepositoryWithFoundationIssue);
  stale.readinessObservations[0].observedAt = '2026-08-31T20:00:00Z';
  const staleResult = chartCourse(stale);
  assert.equal(staleResult.readiness.operational.value.status, 'uncertain');
  assert.equal(staleResult.readiness.implementation.value.readyForImplementation, null);
  assert.ok(staleResult.readiness.operational.value.defects.some(
    ({ code }) => code === 'readiness-observation-stale',
  ));

  const future = structuredClone(fixtures.unbornRepositoryWithFoundationIssue);
  future.readinessObservations[0].observedAt = '2026-08-31T22:20:53Z';
  const futureResult = chartCourse(future);
  assert.equal(futureResult.readiness.operational.value.status, 'uncertain');
  assert.ok(futureResult.readiness.operational.value.defects.some(
    ({ code }) => code === 'readiness-observation-from-future',
  ));
});

test('a decisive operational blocker keeps its own confidence despite dependency uncertainty', () => {
  const input = structuredClone(fixtures.unbornRepositoryWithFoundationIssue);
  delete input.revision;

  const result = chartCourse(input);

  assert.equal(result.readiness.dependency.confidence, 'medium');
  assert.equal(result.readiness.operational.confidence, 'high');
  assert.equal(result.readiness.implementation.confidence, 'high');
});

test('caller evidence cannot spoof structured readiness completeness', () => {
  const input = structuredClone(fixtures.unbornRepositoryWithFoundationIssue);
  input.readinessObservations[0].state = 'satisfied';
  input.readinessObservations[0].evidence.push(
    'readiness:missing-required=spoofed-by-provider-evidence',
  );

  const result = chartCourse(input);

  assert.equal(result.readiness.operational.value.status, 'ready');
  assert.deepEqual(result.readiness.operational.value.coverage.missingRequirementIds, []);
  assert.equal(result.completeness.complete, true);
  assert.equal(result.completeness.operational.complete, true);
  assert.ok(!result.readiness.operational.evidence.includes(
    'readiness:missing-required=spoofed-by-provider-evidence',
  ));
  assert.ok(result.readiness.operational.evidence.includes(
    'provider-evidence:"readiness:missing-required=spoofed-by-provider-evidence"',
  ));
});

test('no readiness assessment is distinct from complete declared empty coverage', () => {
  const base = {
    goal: 'G',
    revision: 'revision-1',
    observationTime: '2026-08-31T22:20:52Z',
    records: [{ id: 'G', status: 'open' }],
    edges: [],
  };
  const unassessed = chartCourse(base);
  const declaredEmpty = chartCourse({
    ...base,
    readinessRequirementIds: [],
  });

  assert.equal(unassessed.readiness.operational.value.status, 'not-assessed');
  assert.equal(unassessed.completeness.operational.complete, false);
  assert.equal(unassessed.completeness.complete, false);
  assert.equal(declaredEmpty.readiness.operational.value.status, 'ready');
  assert.equal(declaredEmpty.completeness.operational.complete, true);
  assert.equal(declaredEmpty.completeness.complete, true);
});

test('only full SHA-256 provider snapshot identities can support readiness', () => {
  for (const sourceRevision of [
    'latest',
    'origin/main',
    'refs/remotes/origin/main',
    'abc1234',
    { algorithm: 'sha256', digest: 'abc1234' },
    { algorithm: 'sha1', digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
  ]) {
    const input = structuredClone(fixtures.unbornRepositoryWithFoundationIssue);
    input.readinessObservations[0].sourceRevision = sourceRevision;
    const result = chartCourse(input);

    assert.equal(
      result.readiness.operational.value.status,
      'uncertain',
      JSON.stringify(sourceRevision),
    );
    assert.ok(result.readiness.operational.value.defects.some(
      ({ code }) => code === 'invalid-readiness-observation-source-revision',
    ));
  }
});

test('supplemental-only freshness defects do not gate declared empty readiness', () => {
  const result = chartCourse({
    goal: 'G',
    revision: 'revision-1',
    observationTime: '2026-08-31T22:20:52Z',
    records: [{ id: 'G', status: 'open' }],
    edges: [],
    readinessRequirementIds: [],
    readinessFreshness: { maxObservationAgeSeconds: 'invalid' },
    readinessObservations: [
      {
        id: 'optional-advisory',
        kind: 'repository-advisory',
        state: 'unknown',
        detail: 'An optional advisory was observed.',
        source: 'repository-provider',
        sourceRevision: {
          algorithm: 'sha256',
          digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
        observedAt: '2026-08-31T22:20:52Z',
        evidence: ['provider:advisory=open'],
      },
    ],
  });

  assert.equal(result.readiness.operational.value.status, 'ready');
  assert.deepEqual(result.readiness.operational.value.gatingDefects, []);
  assert.equal(result.completeness.operational.complete, false);
  assert.ok(result.readiness.operational.value.supplementalDefects.length === 0);
  assert.ok(result.readiness.operational.value.nonGatingDefects.some(
    ({ code }) => code === 'invalid-readiness-freshness-limit',
  ));
});

test('a known operational blocker survives dependency uncertainty in the combined result', () => {
  const input = structuredClone(fixtures.unbornRepositoryWithFoundationIssue);
  input.edges.push({
    source: 'dylanmccurry_microsoft/agent-skills#1',
    target: 'dylanmccurry_microsoft/agent-skills#25',
  });

  const result = chartCourse(input);

  assert.equal(result.readiness.dependency.value.status, 'uncertain');
  assert.equal(result.readiness.operational.value.status, 'blocked');
  assert.equal(
    result.readiness.implementation.value.status,
    'operationally-blocked-with-dependency-uncertainty',
  );
  assert.equal(result.readiness.implementation.value.readyForImplementation, false);
  assert.ok(result.readiness.implementation.evidence.includes(
    'provider-evidence:\"provider:repository:dylanmccurry_microsoft/agent-skills:commits=0\"',
  ));
});
