export function chooseHelperPane({ panes, callerPaneId }) {
  const existing = (panes || []).find((pane) => pane?.id && pane.id !== callerPaneId && pane.role === 'cmux-orchestrate-helper');
  if (existing) return { action: 'reuse', paneId: existing.id };
  return { action: 'create', argv: ['new-pane', '--type', 'terminal', '--direction', 'right', '--focus', 'false'] };
}
