import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDispatchAllowed } from './cmux-dispatch.mjs';

test('refuses unowned surfaces before dispatch', () => {
  const result = assertDispatchAllowed({
    targetSurfaceId: 'surface-other',
    targetWorkspaceId: 'workspace-a',
    callerWorkspaceId: 'workspace-a',
    ownedSurfaceIds: ['surface-owned'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.category, 'cmux_unowned_surface_refused');
});

test('refuses cross-workspace dispatch unless explicitly authorized', () => {
  const refused = assertDispatchAllowed({
    targetSurfaceId: 'surface-owned',
    targetWorkspaceId: 'workspace-b',
    callerWorkspaceId: 'workspace-a',
    ownedSurfaceIds: ['surface-owned'],
  });
  assert.equal(refused.category, 'cmux_cross_workspace_refused');

  const allowed = assertDispatchAllowed({
    targetSurfaceId: 'surface-owned',
    targetWorkspaceId: 'workspace-b',
    callerWorkspaceId: 'workspace-a',
    ownedSurfaceIds: ['surface-owned'],
    allowCrossWorkspace: true,
  });
  assert.equal(allowed.ok, true);
});
