export function assertDispatchAllowed({ targetSurfaceId, targetWorkspaceId, callerWorkspaceId, ownedSurfaceIds, allowCrossWorkspace = false }) {
  if (!targetSurfaceId) return { ok: false, category: 'cmux_target_missing' };
  if (!allowCrossWorkspace && targetWorkspaceId !== callerWorkspaceId) {
    return { ok: false, category: 'cmux_cross_workspace_refused', targetWorkspaceId };
  }
  const owned = new Set(ownedSurfaceIds || []);
  if (!owned.has(targetSurfaceId)) {
    return { ok: false, category: 'cmux_unowned_surface_refused', targetSurfaceId };
  }
  return { ok: true, targetSurfaceId, targetWorkspaceId };
}
