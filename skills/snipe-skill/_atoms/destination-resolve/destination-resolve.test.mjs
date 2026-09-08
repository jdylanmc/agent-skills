import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANDIDATE_ORIGINS,
  DESTINATION_FAILURES,
  SCAN_ORIGINS,
  assertNoFallback,
  publicSummary,
  resolveDestination,
} from './destination-resolve.mjs';

const PUBLIC = { id: 'public-library', boundary: 'public', private: false, origin: 'instruction' };
const PRIVATE = { id: 'private-library', boundary: 'private', private: true, origin: 'instruction' };

function refusal(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

test('an explicitly named declared destination resolves to exactly that destination', () => {
  const resolution = resolveDestination({ explicit: 'public-library', candidates: [PUBLIC, PRIVATE] });
  assert.equal(resolution.status, 'resolved');
  assert.equal(resolution.destination.id, 'public-library');
  assert.equal(resolution.destination.boundary, 'public');
  assert.equal(resolution.destination.disclosure, 'plain');
  assert.equal(resolution.destination.publicIdentity, 'public-library');
});

test('silence is not a selection, even when exactly one destination is declared', () => {
  const single = resolveDestination({ candidates: [PRIVATE] });
  assert.equal(single.status, 'ambiguous');
  assert.equal(single.reason, 'no-explicit-destination');
  assert.equal(single.declaredCount, 1);
  assert.ok(single.question.length > 0);
  assert.equal(single.destination, undefined);

  const several = resolveDestination({ explicit: '   ', candidates: [PUBLIC, PRIVATE] });
  assert.equal(several.status, 'ambiguous');
  assert.equal(several.declaredCount, 2);
});

test('no declared destination at all is unresolved rather than defaulted', () => {
  const resolution = resolveDestination({ candidates: [] });
  assert.equal(resolution.status, 'unresolved');
  assert.equal(resolution.reason, 'no-declared-destination');
  assert.equal(resolution.declaredCount, 0);
});

test('an undeclared named destination names no alternative to slide into', () => {
  const resolution = resolveDestination({ explicit: 'private-library', candidates: [PUBLIC] });
  assert.equal(resolution.status, 'unresolved');
  assert.equal(resolution.reason, 'explicit-destination-not-declared');
  assert.equal(resolution.requested, 'private-library');
  assert.equal(resolution.declaredCount, 1);
  assert.equal(resolution.alternatives, undefined);
  assert.doesNotMatch(JSON.stringify(resolution), /public-library/);
});

test('a failed resolution is never continued into another destination', () => {
  const failed = resolveDestination({ explicit: 'private-library', candidates: [PUBLIC] });
  assert.equal(
    refusal(() => assertNoFallback(failed, PUBLIC)).code,
    DESTINATION_FAILURES.crossBoundaryFallback,
  );
  const ambiguous = resolveDestination({ candidates: [PUBLIC, PRIVATE] });
  assert.equal(
    refusal(() => assertNoFallback(ambiguous, PUBLIC)).code,
    DESTINATION_FAILURES.crossBoundaryFallback,
  );
  const resolved = resolveDestination({ explicit: 'public-library', candidates: [PUBLIC] });
  assert.equal(assertNoFallback(resolved).permitted, true);
});

const DECLARED_ORIGINS = ['operator', 'instruction'];
const SWEPT_ORIGINS = ['scan', 'discovery', 'search', 'glob', 'filesystem'];

test('the published origin vocabularies are what this atom promises', () => {
  // Literals, not the exported constants the guard itself reads, so the oracle
  // stays independent of the thing it is judging.
  assert.deepEqual(CANDIDATE_ORIGINS, DECLARED_ORIGINS);
  assert.deepEqual(SCAN_ORIGINS, SWEPT_ORIGINS);
});

test('a candidate that was swept for is refused by shape', () => {
  for (const origin of SWEPT_ORIGINS) {
    assert.equal(
      refusal(() => resolveDestination({ explicit: 'x', candidates: [{ ...PUBLIC, origin }] })).code,
      DESTINATION_FAILURES.scanAttempted,
    );
  }
  for (const origin of DECLARED_ORIGINS) {
    assert.equal(
      resolveDestination({ explicit: PUBLIC.id, candidates: [{ ...PUBLIC, origin }] }).status,
      'resolved',
    );
  }
});

test('a malformed, extended, or duplicated candidate is refused rather than normalized', () => {
  const cases = [
    [{ ...PUBLIC, origin: 'vibes' }, DESTINATION_FAILURES.invalidCandidate],
    [{ ...PUBLIC, extra: 'field' }, DESTINATION_FAILURES.invalidCandidate],
    [{ id: 'a', boundary: 'b', private: true }, DESTINATION_FAILURES.invalidCandidate],
    [{ ...PUBLIC, id: '  ' }, DESTINATION_FAILURES.invalidCandidate],
    [{ ...PUBLIC, boundary: '' }, DESTINATION_FAILURES.invalidCandidate],
    [{ ...PUBLIC, id: ' padded ' }, DESTINATION_FAILURES.invalidCandidate],
    [{ ...PUBLIC, boundary: 'public ' }, DESTINATION_FAILURES.invalidCandidate],
    [{ ...PUBLIC, private: 'no' }, DESTINATION_FAILURES.invalidCandidate],
  ];
  for (const [candidate, code] of cases) {
    assert.equal(refusal(() => resolveDestination({ explicit: 'a', candidates: [candidate] })).code, code);
  }
  assert.equal(
    refusal(() => resolveDestination({ explicit: 'a', candidates: [PUBLIC, { ...PUBLIC }] })).code,
    DESTINATION_FAILURES.duplicateCandidate,
  );
  assert.equal(refusal(() => resolveDestination({ candidates: 'all of them' })).code, DESTINATION_FAILURES.usage);
});

test('a declared identity nothing could ever name is refused at declaration time', () => {
  // The operator's choice is trimmed before matching, so a padded identity would
  // be accepted and then be permanently unselectable.
  assert.equal(
    refusal(() =>
      resolveDestination({ explicit: 'padded', candidates: [{ ...PUBLIC, id: ' padded ' }] }),
    ).code,
    DESTINATION_FAILURES.invalidCandidate,
  );
});

test('a private destination reports a stable correlation handle outside its boundary', () => {
  const resolution = resolveDestination({ explicit: 'private-library', candidates: [PRIVATE] });
  assert.equal(resolution.destination.disclosure, 'opaque');
  assert.match(resolution.destination.publicIdentity, /^destination-[0-9a-f]{8}$/);

  const summary = publicSummary(resolution);
  assert.equal(summary.status, 'resolved');
  assert.equal(summary.destination.identity, resolution.destination.publicIdentity);
  assert.doesNotMatch(JSON.stringify(summary), /private-library/);
  assert.equal(
    publicSummary(resolveDestination({ explicit: 'private-library', candidates: [PRIVATE] }))
      .destination.identity,
    summary.destination.identity,
  );
  assert.notEqual(
    summary.destination.identity,
    publicSummary(
      resolveDestination({
        explicit: 'private-library',
        candidates: [{ ...PRIVATE, boundary: 'other' }],
      }),
    ).destination.identity,
  );
});

test('an unresolved public summary carries the reason and no destination', () => {
  const summary = publicSummary(resolveDestination({ candidates: [] }));
  assert.deepEqual(summary, {
    status: 'unresolved',
    reason: 'no-declared-destination',
    destination: null,
  });
});
