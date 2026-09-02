import crypto from 'node:crypto';
import path from 'node:path';

import {
  acknowledgeRead,
  agentStopFallback,
  arm,
  correlateSession,
  expectedRead,
  noteEnforcement,
  readState,
  resumeSession,
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

function withGeneration(output, repositoryRoot, payload, generation) {
  const value = generation ?? readState(repositoryRoot, sessionId(payload))?.generation;
  if (Number.isSafeInteger(value)) {
    Object.defineProperty(output, '_rehydrationGeneration', { value });
  }
  return output;
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

function modelResultEvidence(payload) {
  const result = Object.hasOwn(payload, 'toolResult')
    ? payload.toolResult
    : payload.tool_result;
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { status: 'malformed' };
  }
  const resultType = Object.hasOwn(result, 'resultType')
    ? result.resultType
    : result.result_type;
  const text = Object.hasOwn(result, 'textResultForLlm')
    ? result.textResultForLlm
    : result.text_result_for_llm;
  if (typeof resultType !== 'string') return { status: 'malformed' };
  if (resultType !== 'success') return { status: 'not-success' };
  if (typeof text !== 'string') return { status: 'malformed' };
  const bytes = Buffer.from(text, 'utf8');
  return {
    status: 'success',
    bytes: bytes.length,
    digest: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

export function preCompact(repositoryRoot, payload) {
  const correlation = correlateSession(repositoryRoot, sessionId(payload));
  if (correlation.status === STATES.degraded) {
    return withGeneration(correlation, repositoryRoot, payload, correlation.generation);
  }
  const result = arm({
    repositoryRoot,
    sessionId: sessionId(payload),
    trigger: payload.trigger,
    timestamp: payload.timestamp,
  });
  return withGeneration(result, repositoryRoot, payload, result.generation);
}

export function sessionStart(repositoryRoot, payload) {
  if (payload.source !== 'resume') return {};
  const result = resumeSession({
    repositoryRoot,
    sessionId: sessionId(payload),
    timestamp: payload.timestamp,
  });
  if (result.status === STATES.degraded) {
    return withGeneration({
      additionalContext: `Compaction rehydration is blocked: ${result.reason}. Stop material work.`,
    }, repositoryRoot, payload, result.generation);
  }
  if (result.status === 'inactive') return {};
  return withGeneration({
    additionalContext: `An active skill run resumed and requires canonical rehydration before material work. Next read: ${result.files[0]}`,
  }, repositoryRoot, payload, result.generation);
}

export function preToolUse(repositoryRoot, payload) {
  const expected = expectedRead(repositoryRoot, sessionId(payload));
  if (expected.status === 'inactive') return {};
  if (expected.status === STATES.degraded) {
    return {
      permissionDecision: 'deny',
      permissionDecisionReason:
        `Compaction rehydration is blocked: ${expected.reason}. Material work is not allowed.`,
    };
  }
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
  return withGeneration(output, repositoryRoot, payload, expected.generation);
}

export function postToolUse(repositoryRoot, payload) {
  const expected = expectedRead(repositoryRoot, sessionId(payload));
  if (expected.status === 'inactive') return {};
  if (expected.status === STATES.degraded) {
    return {
      additionalContext: `Compaction rehydration degraded: ${expected.reason}. Stop material work.`,
    };
  }
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
    resultEvidence: modelResultEvidence(payload),
  });
  if (result.status === STATES.rehydrated) {
    const output = { additionalContext: result.checkpoint };
    Object.defineProperty(output, '_rehydrationStatus', { value: STATES.rehydrated });
    return withGeneration(output, repositoryRoot, payload, expected.generation);
  }
  if (result.status === STATES.degraded) {
    const output = { additionalContext: `Compaction rehydration degraded: ${result.reason}. Stop material work.` };
    Object.defineProperty(output, '_rehydrationStatus', { value: STATES.degraded });
    return withGeneration(output, repositoryRoot, payload, expected.generation);
  }
  return {
    additionalContext: `Canonical rehydration read accepted. Read next: ${result.next.path}`,
  };
}

export function agentStop(repositoryRoot, payload) {
  const generation = readState(repositoryRoot, sessionId(payload))?.generation;
  return withGeneration(agentStopFallback(
    repositoryRoot,
    sessionId(payload),
    payload.stop_hook_active === true,
  ), repositoryRoot, payload, generation);
}

export function classifyDisposition({ policy = false, gate = false, warning = false } = {}) {
  if (policy && gate) return 'policy-enforced';
  if (gate) return 'hook-enforced-but-disableable';
  if (warning) return 'warn-only';
  return 'unsupported';
}
