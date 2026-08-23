export const SOCKET_CONTROL_MODES = ['off', 'cmuxOnly', 'automation', 'password', 'allowAll'];

export function detectCmux(env = process.env) {
  const socketPath = env.CMUX_SOCKET_PATH || '';
  if (!socketPath) {
    return {
      present: false,
      category: 'cmux_absent',
      degradation: 'Continue without cmux orchestration. If an external process cannot connect, check automation.socketControlMode: off, cmuxOnly, automation, password, or allowAll; cmuxOnly is the default.',
    };
  }
  return {
    present: true,
    socketPath,
    workspaceId: env.CMUX_WORKSPACE_ID || null,
    paneId: env.CMUX_PANE_ID || null,
    surfaceId: env.CMUX_SURFACE_ID || null,
    category: 'cmux_present',
  };
}
