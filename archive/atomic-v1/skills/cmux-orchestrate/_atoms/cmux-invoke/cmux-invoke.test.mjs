import assert from 'node:assert/strict';
import test from 'node:test';

import { VERIFIED_COMMANDS, buildCmuxInvocation, validateCmuxCommand } from './cmux-invoke.mjs';

test('verified verbs are accepted before invocation is built', () => {
  for (const command of VERIFIED_COMMANDS) {
    assert.equal(validateCmuxCommand([command]).ok, true, command);
  }
});

test('unknown verbs fail with a stable category before invocation', () => {
  for (const command of ['list-surfaces', 'send-surface', 'send-key-surface']) {
    const result = buildCmuxInvocation([command, '--help']);
    assert.equal(result.ok, false);
    assert.equal(result.category, 'cmux_unknown_verb');
    assert.equal(result.command, command);
  }
});

test('missing command fails without process details', () => {
  assert.deepEqual(validateCmuxCommand([]), { ok: false, category: 'cmux_command_missing' });
});
