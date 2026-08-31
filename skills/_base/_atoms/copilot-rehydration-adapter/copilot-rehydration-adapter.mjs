import path from 'node:path';

import {
  acknowledgeRead,
  agentStopFallback,
  arm,
  expectedRead,
  noteEnforcement,
  readState,
  STATES,
} from '../rehydration-state/rehydration-state.mjs';

export const DISPOSITIONS = Object.freeze([
  'policy-enforced',
  'hook-enforced-but-disableable',
  'warn-only',
  'unsupported',
]);
export const REPOSITORY_HOOK_DISPOSITION = 'hook-enforced-but-disableable';

function sessionId(payload) {
  return payload.sessionId ?? payload.session_id;
}

function absoluteToolPath(payload) {
  const args = payload.toolArgs ?? payload.tool_input;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  return typeof args.path === 'string' ? path.resolve(payload.cwd, args.path) : null;
}

function isFullView(payload, expected) {
  const name = payload.toolName ?? payload.tool_name;
  const args = payload.toolArgs ?? payload.tool_input;
  if (name !== 'view' && name !== 'Read') return false;
  if (!args || typeof args !== 'object' || Array.isArray(args) || args.view_range !== undefined) return false;
  if (expected.bytes > 20_000 && args.forceReadLargeFiles !== true) return false;
  return true;
}

export function preCompact(repositoryRoot, payload) {
  return arm({
    repositoryRoot,
    sessionId: sessionId(payload),
    trigger: payload.trigger,
    timestamp: payload.timestamp,
  });
}

export function sessionStart(repositoryRoot, payload) {
  if (payload.source !== 'resume') return {};
  const state = readState(repositoryRoot, sessionId(payload));
  if (!state || state.stack.length === 0) return {};
  const result = arm({
    repositoryRoot,
    sessionId: sessionId(payload),
    trigger: 'resume',
    timestamp: payload.timestamp,
  });
  return {
    additionalContext: `An active skill run resumed and requires canonical rehydration before material work. Next read: ${result.files[0]}`,
  };
}

export function preToolUse(repositoryRoot, payload) {
  const expected = expectedRead(repositoryRoot, sessionId(payload));
  if (expected.status === 'inactive') return {};
  const absolute = absoluteToolPath(payload);
  const canonical = path.join(repositoryRoot, expected.file.path);
  if (absolute === canonical && isFullView(payload, expected.file)) {
    return { permissionDecision: 'allow' };
  }
  const firstEnforcement = noteEnforcement(repositoryRoot, sessionId(payload));
  const largeFileHint = expected.file.bytes > 20_000
    ? ' The file exceeds 20KB; use forceReadLargeFiles: true.'
    : '';
  const output = {
    permissionDecision: 'deny',
    permissionDecisionReason:
      `Compaction rehydration is armed. Only the exact full canonical read is allowed: ${expected.file.path}.${largeFileHint}`,
  };
  Object.defineProperty(output, '_recordEnforcement', { value: firstEnforcement });
  return output;
}

export function postToolUse(repositoryRoot, payload) {
  const expected = expectedRead(repositoryRoot, sessionId(payload));
  if (expected.status === 'inactive') return {};
  const absolute = absoluteToolPath(payload);
  const canonical = path.join(repositoryRoot, expected.file.path);
  if (absolute !== canonical || !isFullView(payload, expected.file)) return {};
  const result = acknowledgeRead({
    repositoryRoot,
    sessionId: sessionId(payload),
    generation: expected.generation,
    relativePath: expected.file.path,
    runId: expected.file.runId,
    skill: expected.file.skill,
  });
  if (result.status === STATES.rehydrated) {
    const output = { additionalContext: result.checkpoint };
    Object.defineProperty(output, '_rehydrationStatus', { value: STATES.rehydrated });
    return output;
  }
  if (result.status === STATES.degraded) {
    const output = { additionalContext: `Compaction rehydration degraded: ${result.reason}. Stop material work.` };
    Object.defineProperty(output, '_rehydrationStatus', { value: STATES.degraded });
    return output;
  }
  return {
    additionalContext: `Canonical rehydration read accepted. Read next: ${result.next.path}`,
  };
}

export function agentStop(repositoryRoot, payload) {
  return agentStopFallback(
    repositoryRoot,
    sessionId(payload),
    payload.stop_hook_active === true,
  );
}

export function classifyDisposition({ policy = false, gate = false, warning = false } = {}) {
  if (policy && gate) return 'policy-enforced';
  if (gate) return 'hook-enforced-but-disableable';
  if (warning) return 'warn-only';
  return 'unsupported';
}
