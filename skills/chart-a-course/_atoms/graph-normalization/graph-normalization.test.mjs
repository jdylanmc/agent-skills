import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeGraph } from './graph-normalization.mjs';

test('normalizes records and explicit edges deterministically', () => {
  const input = {
    goal: 'G',
    revision: 'r1',
    observationTime: '2026-08-30T00:00:00Z',
    records: [
      { id: 'G', status: 'open' },
      { id: 'A', status: 'done' },
      { id: 'B', status: 'in_progress' },
    ],
    edges: [
      { prerequisite: 'B', dependent: 'G' },
      { prerequisite: 'A', dependent: 'B' },
    ],
  };

  const first = normalizeGraph(input);
  const second = normalizeGraph({
    ...input,
    records: [...input.records].reverse(),
    edges: [...input.edges].reverse(),
  });

  assert.deepEqual(first.records.map(({ id }) => id), ['A', 'B', 'G']);
  assert.deepEqual(first.edges, [
    { prerequisite: 'A', dependent: 'B' },
    { prerequisite: 'B', dependent: 'G' },
  ]);
  assert.deepEqual(
    first.records.map(({ id, status }) => [id, status.canonical]),
    [['A', 'completed'], ['B', 'active'], ['G', 'pending']],
  );
  assert.deepEqual(
    first.records.map(({ id, status }) => [id, status.canonical]),
    second.records.map(({ id, status }) => [id, status.canonical]),
  );
  assert.deepEqual(first.edges, second.edges);
});

test('reports missing and duplicate identities without choosing a winner', () => {
  const result = normalizeGraph({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [{ id: 'G', status: 'open' }, { id: 'G', status: 'done' }, { status: 'open' }],
    edges: [],
  });

  assert.deepEqual(result.duplicateIds, ['G']);
  assert.deepEqual(result.records, []);
  assert.deepEqual(
    result.defects.map(({ code }) => code),
    ['duplicate-id', 'missing-id'],
  );
});

test('preserves absent endpoints and ambiguous direction as unresolved edges', () => {
  const result = normalizeGraph({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    records: [{ id: 'A', status: 'done' }, { id: 'G', status: 'open' }],
    edges: [
      { prerequisite: 'MISSING', dependent: 'G' },
      { source: 'A', target: 'G' },
    ],
  });

  assert.deepEqual(result.edges, []);
  assert.deepEqual(result.unresolvedEdges.map(({ reason }) => reason), [
    'absent-endpoint',
    'ambiguous-direction',
  ]);
  assert.deepEqual(
    result.defects.map(({ code }) => code),
    ['absent-edge-endpoint', 'ambiguous-edge-direction'],
  );
});

test('detects cycles and stale or unavailable status', () => {
  const result = normalizeGraph({
    goal: 'B',
    observationTime: '2026-08-30T00:00:00Z',
    freshness: { maxStatusAgeSeconds: 60 },
    records: [
      { id: 'A', status: 'open', statusObservedAt: '2026-08-29T00:00:00Z' },
      { id: 'B' },
    ],
    edges: [
      { prerequisite: 'A', dependent: 'B' },
      { prerequisite: 'B', dependent: 'A' },
    ],
  });

  assert.deepEqual(result.cycles, [['A', 'B']]);
  assert.deepEqual(
    result.defects.map(({ code }) => code),
    ['cycle', 'missing-status-observation-time', 'status-stale', 'status-unavailable'],
  );
});

test('rejects malformed top-level collections and temporal policy instead of defaulting them', () => {
  const malformed = normalizeGraph(null);
  assert.deepEqual(
    malformed.defects.map(({ code }) => code),
    ['invalid-edges-collection', 'invalid-input', 'invalid-observation-time', 'invalid-records-collection'],
  );
  assert.equal(malformed.complete, false);

  const collections = normalizeGraph({
    goal: 'G',
    observationTime: 'not-a-time',
    freshness: [],
    records: {},
    edges: 'A->G',
  });
  assert.deepEqual(
    collections.defects.map(({ code }) => code),
    [
      'invalid-edges-collection',
      'invalid-freshness-policy',
      'invalid-observation-time',
      'invalid-records-collection',
    ],
  );

  const limit = normalizeGraph({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    freshness: { maxStatusAgeSeconds: 0.5 },
    records: [],
    edges: [],
  });
  assert.deepEqual(limit.defects.map(({ code }) => code), ['invalid-freshness-limit']);
});

test('invalid, missing, and future status observations cannot look current', () => {
  const result = normalizeGraph({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    freshness: { maxStatusAgeSeconds: 60 },
    records: [
      { id: 'F', status: 'done', statusObservedAt: '2026-08-30T00:00:01Z' },
      { id: 'G', status: 'open' },
      { id: 'I', status: 'open', statusObservedAt: 'invalid' },
    ],
    edges: [],
  });

  assert.deepEqual(
    result.records.map(({ id, status }) => [id, status.freshness]),
    [['F', 'unavailable'], ['G', 'unavailable'], ['I', 'unavailable']],
  );
  assert.deepEqual(
    result.defects.map(({ code }) => code),
    [
      'invalid-status-observation-time',
      'missing-status-observation-time',
      'status-from-future',
      'status-unavailable',
      'status-unavailable',
      'status-unavailable',
    ],
  );
});

test('accepts only the documented complete ISO-8601 timestamp grammar', () => {
  for (const observationTime of [
    '2026-08-30T00:00:00Z',
    '2026-08-30T00:00:00.1Z',
    '2026-08-30T00:00:00.123+05:30',
    '2024-02-29T23:59:59-04:00',
  ]) {
    const result = normalizeGraph({ goal: 'G', observationTime, records: [], edges: [] });
    assert.ok(!result.defects.some(({ code }) => code === 'invalid-observation-time'), observationTime);
  }

  for (const observationTime of [
    'August 30, 2026 00:00:00 UTC',
    '2026-08-30T00:00:00',
    '2026-08-30 00:00:00Z',
    '2026-08-30T00:00Z',
    '2026-08-30T00:00:00.1234Z',
    '2026-08-30T00:00:00+24:00',
    '2026-08-30T00:00:00+01:60',
    ' 2026-08-30T00:00:00Z',
    '2026-08-30T00:00:00Z ',
    '2026-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z',
  ]) {
    const result = normalizeGraph({ goal: 'G', observationTime, records: [], edges: [] });
    assert.ok(result.defects.some(({ code }) => code === 'invalid-observation-time'), observationTime);
  }
});

test('freshness conversion uses validated offsets without date rollover', () => {
  const result = normalizeGraph({
    goal: 'G',
    observationTime: '2026-08-30T00:00:00Z',
    freshness: { maxStatusAgeSeconds: 60 },
    records: [
      { id: 'G', status: 'open', statusObservedAt: '2026-08-30T01:00:00+01:00' },
      { id: 'X', status: 'done', statusObservedAt: '2026-02-30T00:00:00Z' },
    ],
    edges: [],
  });

  assert.equal(result.records.find(({ id }) => id === 'G').status.ageSeconds, 0);
  assert.equal(result.records.find(({ id }) => id === 'G').status.freshness, 'current');
  assert.equal(result.records.find(({ id }) => id === 'X').status.freshness, 'unavailable');
  assert.ok(result.defects.some(({ code, affectedIds }) =>
    code === 'invalid-status-observation-time' && affectedIds.includes('X')));
});
