import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseHelperPane } from './cmux-helper-pane.mjs';

test('reuses an existing non-caller helper pane', () => {
  const result = chooseHelperPane({
    callerPaneId: 'pane-a',
    panes: [
      { id: 'pane-a', role: 'cmux-orchestrate-helper' },
      { id: 'pane-b', role: 'cmux-orchestrate-helper' },
    ],
  });

  assert.deepEqual(result, { action: 'reuse', paneId: 'pane-b' });
});

test('creates exactly one helper pane without focus when none exists', () => {
  const result = chooseHelperPane({ callerPaneId: 'pane-a', panes: [{ id: 'pane-a' }] });

  assert.equal(result.action, 'create');
  assert.deepEqual(result.argv, ['new-pane', '--type', 'terminal', '--direction', 'right', '--focus', 'false']);
});
