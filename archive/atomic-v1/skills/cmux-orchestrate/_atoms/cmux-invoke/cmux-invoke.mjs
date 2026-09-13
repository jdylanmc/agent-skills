export const VERIFIED_COMMANDS = new Set([
  'identify',
  'list-workspaces',
  'current-workspace',
  'tree',
  'list-panes',
  'list-pane-surfaces',
  'new-pane',
  'new-surface',
  'read-screen',
  'send',
  'send-key',
]);

export function validateCmuxCommand(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || typeof argv[0] !== 'string' || argv[0] === '') {
    return { ok: false, category: 'cmux_command_missing' };
  }
  const command = argv[0];
  if (!VERIFIED_COMMANDS.has(command)) {
    return { ok: false, category: 'cmux_unknown_verb', command };
  }
  return { ok: true, command, argv: [...argv] };
}

export function buildCmuxInvocation(argv, cmuxPath = '/opt/homebrew/bin/cmux') {
  const validation = validateCmuxCommand(argv);
  if (!validation.ok) return validation;
  return { ok: true, command: cmuxPath, args: validation.argv };
}
