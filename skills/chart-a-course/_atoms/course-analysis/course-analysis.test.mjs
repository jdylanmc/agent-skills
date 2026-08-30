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
