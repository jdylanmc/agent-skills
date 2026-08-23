import assert from 'node:assert/strict';
import test from 'node:test';

import { SOCKET_CONTROL_MODES, detectCmux } from './cmux-detect.mjs';

test('outside cmux degrades without error and explains socket control modes', () => {
  const result = detectCmux({});

  assert.equal(result.present, false);
  assert.equal(result.category, 'cmux_absent');
  for (const mode of SOCKET_CONTROL_MODES) {
    assert.match(result.degradation, new RegExp(`\\b${mode}\\b`));
  }
  assert.match(result.degradation, /cmuxOnly is the default/);
});

test('inside cmux reports socket and caller context from environment', () => {
  const result = detectCmux({
    CMUX_SOCKET_PATH: '/Users/example/Library/Application Support/cmux/socket',
    CMUX_WORKSPACE_ID: 'workspace-123',
    CMUX_PANE_ID: 'pane-456',
    CMUX_SURFACE_ID: 'surface-789',
  });

  assert.deepEqual(result, {
    present: true,
    socketPath: '/Users/example/Library/Application Support/cmux/socket',
    workspaceId: 'workspace-123',
    paneId: 'pane-456',
    surfaceId: 'surface-789',
    category: 'cmux_present',
  });
});
