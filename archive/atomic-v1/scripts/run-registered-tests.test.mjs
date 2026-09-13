import assert from 'node:assert/strict';
import test from 'node:test';

import { readCancelledCount } from './run-registered-tests.mjs';

test('reads a zero cancelled count from TAP output', () => {
  assert.equal(readCancelledCount('TAP version 13\n1..2\n# cancelled 0\n'), 0);
});

test('reports a non-zero cancelled count', () => {
  assert.equal(readCancelledCount('TAP version 13\n1..2\n# cancelled 2\n'), 2);
});

test('rejects output without a cancelled summary', () => {
  assert.throws(
    () => readCancelledCount('TAP version 13\n1..2\n'),
    /expected one TAP cancelled summary, found 0/,
  );
});

test('rejects ambiguous output with multiple cancelled summaries', () => {
  assert.throws(
    () => readCancelledCount('# cancelled 0\n# cancelled 1\n'),
    /expected one TAP cancelled summary, found 2/,
  );
});
