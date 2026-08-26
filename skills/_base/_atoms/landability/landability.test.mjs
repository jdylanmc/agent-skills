/**
 * Tests for the shared landability vocabulary.
 *
 * The failures hunted here are the ones a shared unit exists to prevent: a
 * terminal disposition missing from the list, two callers disagreeing about
 * what a boolean policy means, an incomplete receipt believed because it said
 * it was complete, and a comparison nobody could make reported as agreement.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TERMINAL_DISPOSITIONS,
  UP_TO_DATE_POLICIES,
  buildFreshnessReceipt,
  compareObservation,
  isTerminalDisposition,
  normalizeUpToDatePolicy,
  requiresUpToDateBranch,
  validateFreshnessReceipt,
} from './landability.mjs';

test('the terminal set covers every provider condition an adapter can reach', () => {
  // `provider-tool-unsupported` is the one that went missing from a consumer's
  // copy: a known host family with no adapter yet is a real ending, and a
  // consumer that does not know it reads it as no ending at all.
  assert.deepEqual([...TERMINAL_DISPOSITIONS], [
    'mergeable-and-green',
    'no-op-mergeable-and-green',
    'provider-unsupported',
    'provider-tool-unsupported',
    'provider-tool-missing',
    'provider-tool-unauthenticated',
    'needs-human',
    'blocked',
    'failing',
  ]);

  for (const disposition of TERMINAL_DISPOSITIONS) {
    assert.ok(isTerminalDisposition(disposition));
  }
  for (const value of ['shepherd-required', 'watch-or-report', 'in-progress', '', undefined, null, true]) {
    assert.equal(isTerminalDisposition(value), false, `${String(value)} is not an ending`);
  }

  assert.throws(() => TERMINAL_DISPOSITIONS.push('anything'), TypeError);
});

test('a boolean policy normalizes one way, and anything unreadable is unobserved', () => {
  assert.deepEqual([...UP_TO_DATE_POLICIES], ['required', 'not-required', 'unobserved']);

  assert.equal(normalizeUpToDatePolicy(true), 'required');
  assert.equal(normalizeUpToDatePolicy(false), 'not-required');
  assert.equal(requiresUpToDateBranch(true), true);
  assert.equal(requiresUpToDateBranch(false), false);

  for (const value of [undefined, null, '', 'strict', 'Required', 0, 1, {}]) {
    assert.equal(normalizeUpToDatePolicy(value), 'unobserved', `${String(value)} must not resolve a policy`);
    assert.equal(requiresUpToDateBranch(value), false);
  }

  for (const value of UP_TO_DATE_POLICIES) {
    assert.equal(normalizeUpToDatePolicy(value), value);
  }
});

test('a receipt is complete only when all three observations are non-empty strings', () => {
  const complete = buildFreshnessReceipt({
    observedAt: '2026-08-25T20:35:56Z',
    baseSha: 'eb0ce00',
    headSha: '57d9d26',
    upToDatePolicy: true,
    provider: 'supported-provider',
  });
  assert.deepEqual(complete, {
    observedAt: '2026-08-25T20:35:56Z',
    baseSha: 'eb0ce00',
    headSha: '57d9d26',
    upToDatePolicy: 'required',
    provider: 'supported-provider',
    complete: true,
  });

  for (const spoiled of [{ observedAt: undefined }, { baseSha: '  ' }, { headSha: 42 }, { baseSha: null }]) {
    const receipt = buildFreshnessReceipt({ ...complete, ...spoiled });
    assert.equal(receipt.complete, false, `${JSON.stringify(spoiled)} must not be complete`);
  }

  assert.equal(buildFreshnessReceipt().provider, 'unobserved');
  assert.equal(buildFreshnessReceipt().upToDatePolicy, 'unobserved');
});

test('a receipt somebody else produced is checked rather than believed', () => {
  const valid = validateFreshnessReceipt({
    observedAt: '2026-08-25T20:35:56Z',
    baseSha: 'eb0ce00',
    headSha: '57d9d26',
    complete: true,
  });
  assert.deepEqual(valid, { valid: true, defects: [] });

  for (const absent of [undefined, null, 'receipt', 7]) {
    const result = validateFreshnessReceipt(absent);
    assert.equal(result.valid, false);
    assert.equal(result.defects.length, 1);
  }

  const wrongTypes = validateFreshnessReceipt({ observedAt: 1, baseSha: '', headSha: {} });
  assert.equal(wrongTypes.valid, false);
  assert.deepEqual(wrongTypes.defects.map((defect) => defect.split(':')[0]), [
    'receipt.baseSha',
    'receipt.headSha',
    'receipt.observedAt',
  ]);

  // A producer that says complete while omitting fields is reporting twice as
  // wrong, and the claim is named rather than accepted.
  const lying = validateFreshnessReceipt({ baseSha: 'eb0ce00', headSha: '57d9d26', complete: true });
  assert.equal(lying.valid, false);
  assert.ok(lying.defects.some((defect) => defect.startsWith('receipt.complete')));

  // A producer that admits incompleteness is believed about that.
  const admitted = validateFreshnessReceipt({
    observedAt: '2026-08-25T20:35:56Z',
    baseSha: 'eb0ce00',
    headSha: '57d9d26',
    complete: false,
  });
  assert.equal(admitted.valid, false);

  const invalidTime = validateFreshnessReceipt({
    observedAt: 'later',
    baseSha: 'eb0ce00',
    headSha: '57d9d26',
    complete: true,
  });
  assert.equal(invalidTime.valid, false);
  assert.ok(invalidTime.defects.some((defect) => defect.startsWith('receipt.observedAt')));
});

test('comparison needs both commits and a later observation time', () => {
  const receipt = {
    observedAt: '2026-08-25T22:05:00Z',
    baseSha: 'fdd15de',
    headSha: '3f78428',
  };

  assert.deepEqual(compareObservation(receipt, {
    observedAt: '2026-08-25T22:06:00Z',
    baseSha: 'fdd15de',
    headSha: '3f78428',
  }), {
    freshness: 'fresh',
    drifted: [],
  });

  const movedBase = compareObservation(receipt, {
    observedAt: '2026-08-25T22:06:00Z',
    baseSha: '9d5e4f7',
    headSha: '3f78428',
  });
  assert.equal(movedBase.freshness, 'stale');
  assert.deepEqual(movedBase.drifted, ['base fdd15de -> 9d5e4f7']);

  const movedHead = compareObservation(receipt, {
    observedAt: '2026-08-25T22:06:00Z',
    baseSha: 'fdd15de',
    headSha: 'abc1234',
  });
  assert.equal(movedHead.freshness, 'stale');
  assert.deepEqual(movedHead.drifted, ['head 3f78428 -> abc1234']);

  const movedBoth = compareObservation(receipt, {
    observedAt: '2026-08-25T22:06:00Z',
    baseSha: '9d5e4f7',
    headSha: 'abc1234',
  });
  assert.equal(movedBoth.drifted.length, 2);

  for (const observation of [
    undefined,
    {},
    { baseSha: 'fdd15de' },
    { baseSha: '', headSha: '3f78428' },
    { observedAt: 'not-a-time', baseSha: 'fdd15de', headSha: '3f78428' },
    { observedAt: receipt.observedAt, baseSha: 'fdd15de', headSha: '3f78428' },
    { observedAt: '2026-08-25T22:04:00Z', baseSha: 'fdd15de', headSha: '3f78428' },
  ]) {
    assert.equal(compareObservation(receipt, observation).freshness, 'unobserved');
  }
  assert.equal(compareObservation({}, {
    observedAt: '2026-08-25T22:06:00Z',
    baseSha: 'fdd15de',
    headSha: '3f78428',
  }).freshness, 'unobserved');
});
