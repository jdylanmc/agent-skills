import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSlopSnapshot,
  normalizeSlopSnapshot,
  SNAPSHOT_COVERAGE_AREAS,
} from './snapshot-contract.mjs';
import { rawSnapshot, sealedSnapshot } from './snapshot-contract.fixtures.mjs';

test('rejects unknown fields and duplicate evidence identities', () => {
  assert.throws(
    () => normalizeSlopSnapshot({ ...rawSnapshot(), hiddenAuthority: true }),
    /unknown field/,
  );
  const duplicate = rawSnapshot();
  duplicate.observations.push({ ...duplicate.observations[0] });
  duplicate.coverage[0].sourceIds.push(duplicate.observations[0].id);
  assert.throws(() => normalizeSlopSnapshot(duplicate), /duplicate observation id/);
});

test('rejects sensitive snapshot identifiers before they can be echoed by a report', () => {
  const sensitive = rawSnapshot();
  sensitive.snapshotId = 'client_secret=Sup3rSecretValue';
  assert.throws(() => normalizeSlopSnapshot(sensitive), /contains sensitive content/);
});

test('rejects missing, duplicate, and imaginary coverage', () => {
  const missing = rawSnapshot();
  missing.coverage.pop();
  assert.throws(() => normalizeSlopSnapshot(missing), /declare exactly/);

  const duplicate = rawSnapshot();
  duplicate.coverage[1].area = duplicate.coverage[0].area;
  assert.throws(() => normalizeSlopSnapshot(duplicate), /duplicate coverage area/);

  const imaginary = rawSnapshot();
  imaginary.coverage[0].sourceIds = ['not-observed'];
  assert.throws(() => normalizeSlopSnapshot(imaginary), /unknown source/);
});

test('rejects uncovered observations and false completeness', () => {
  const uncovered = rawSnapshot();
  uncovered.observations.push({
    ...uncovered.observations[0],
    id: 'uncovered',
  });
  assert.throws(() => normalizeSlopSnapshot(uncovered), /outside declared coverage/);

  const falseComplete = rawSnapshot({ partial: true });
  falseComplete.observation.completeness = 'complete';
  assert.throws(() => normalizeSlopSnapshot(falseComplete), /must be partial/);
});

test('allows unavailable only as source-free coverage, never as an observation', () => {
  const unavailableObservation = rawSnapshot();
  unavailableObservation.observations[0].completeness = 'unavailable';
  unavailableObservation.coverage[0].status = 'partial';
  assert.throws(
    () => normalizeSlopSnapshot(unavailableObservation),
    /unsupported value: unavailable/,
  );

  const partialPlaceholder = rawSnapshot();
  partialPlaceholder.coverage[0].status = 'partial';
  partialPlaceholder.observations[0].completeness = 'unavailable';
  assert.throws(
    () => normalizeSlopSnapshot(partialPlaceholder),
    /unsupported value: unavailable/,
  );

  const unavailableWithSource = rawSnapshot();
  unavailableWithSource.coverage[0].status = 'unavailable';
  assert.throws(
    () => normalizeSlopSnapshot(unavailableWithSource),
    /unavailable but names sources/,
  );
});

test('rejects observations from after the snapshot and complete areas with partial sources', () => {
  const future = rawSnapshot();
  future.observations[0].observedAt = '2026-09-03T00:00:00Z';
  assert.throws(() => normalizeSlopSnapshot(future), /later than the snapshot/);

  const partialSource = rawSnapshot();
  partialSource.observations[0].completeness = 'partial';
  assert.throws(() => normalizeSlopSnapshot(partialSource), /source .* is not complete/);
});

test('rejects timezone-ambiguous timestamps and accepts explicit offsets', () => {
  const ambiguous = rawSnapshot();
  ambiguous.observation.observedAt = '2026-09-02T21:00:00';
  assert.throws(() => normalizeSlopSnapshot(ambiguous), /with Z or a numeric offset/);

  const offset = rawSnapshot();
  offset.observation.observedAt = '2026-09-02T17:00:00-04:00';
  assert.doesNotThrow(() => normalizeSlopSnapshot(offset));
});

test('rejects impossible calendar timestamps', () => {
  const impossible = rawSnapshot();
  impossible.observations[0].observedAt = '2026-02-31T20:00:00Z';
  assert.throws(() => normalizeSlopSnapshot(impossible), /real calendar instant/);
});

test('rejects failure and retry observations without fingerprints at intake', () => {
  for (const [area, kind] of [
    ['failure-fingerprints', 'failure'],
    ['remediation-and-retries', 'retry'],
  ]) {
    const input = rawSnapshot({
      extraObservations: [{
        area,
        id: `${kind}-without-fingerprint`,
        kind,
        sourceKind: 'runtime',
        observedAt: '2026-09-02T20:30:00Z',
        completeness: 'complete',
        subject: `${kind}-subject`,
        workIds: ['work-a'],
        revision: 'head-a',
        fingerprint: null,
        statement: `Observed ${kind}.`,
        locator: `runtime://${kind}`,
        sensitivity: 'public',
      }],
    });
    assert.throws(
      () => normalizeSlopSnapshot(input),
      new RegExp(`fingerprint is required for ${kind} observations`),
    );
  }
});

test('rejects impossible or contradictory activity intervals', () => {
  const missingStart = rawSnapshot();
  missingStart.observations[0].activeUntil = '2026-09-02T20:00:00Z';
  assert.throws(() => normalizeSlopSnapshot(missingStart), /activeUntil requires activeFrom/);

  const inverted = rawSnapshot();
  inverted.observations[0].activeFrom = '2026-09-02T19:30:00Z';
  inverted.observations[0].activeUntil = '2026-09-02T19:00:00Z';
  assert.throws(() => normalizeSlopSnapshot(inverted), /inverted activity interval/);

  const endedButActive = rawSnapshot();
  endedButActive.observations[2].activeFrom = '2026-09-02T19:00:00Z';
  endedButActive.observations[2].activeUntil = '2026-09-02T19:30:00Z';
  assert.throws(() => normalizeSlopSnapshot(endedButActive), /cannot be active/);
});

test('rejects evidence bound to the wrong coverage area or source kind', () => {
  const wrongArea = rawSnapshot();
  wrongArea.coverage[0].sourceIds = [wrongArea.observations[1].id];
  assert.throws(() => normalizeSlopSnapshot(wrongArea), /bound to dependency-frontier/);

  const wrongSource = rawSnapshot();
  wrongSource.observations[0].sourceKind = 'runtime';
  assert.throws(() => normalizeSlopSnapshot(wrongSource), /incompatible with coverage/);
});

test('rejects stale binding digests and unsealed assertions', () => {
  const sealed = sealedSnapshot();
  assert.throws(
    () => normalizeSlopSnapshot({ ...sealed, goal: { ...sealed.goal, revision: 'goal-r2' } }),
    /bindingDigest does not match/,
  );
  assert.throws(() => assertSlopSnapshot(rawSnapshot()), /requires bindingDigest/);
});

test('rejects unbounded observations and packets', () => {
  const tooMany = rawSnapshot();
  const template = tooMany.observations[0];
  tooMany.observations = Array.from({ length: 1001 }, (_, index) => ({
    ...template,
    id: `observation-${index}`,
  }));
  tooMany.coverage = SNAPSHOT_COVERAGE_AREAS.map((area, index) => ({
    area,
    status: 'complete',
    sourceIds: [tooMany.observations[index].id],
  }));
  assert.throws(() => normalizeSlopSnapshot(tooMany), /at most 1000/);

  const oversized = rawSnapshot();
  oversized.goal.statement = 'x'.repeat(1024 * 1024);
  assert.throws(() => normalizeSlopSnapshot(oversized), /exceeds 1048576 bytes/);
});
