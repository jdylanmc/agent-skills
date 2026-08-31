import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  agentStop,
  classifyDisposition,
  postToolUse,
  preCompact,
  preToolUse,
  REPOSITORY_HOOK_DISPOSITION,
  sessionStart,
} from './copilot-rehydration-adapter.mjs';
import { readState, registerRun, STATES } from '../rehydration-state/rehydration-state.mjs';

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
  '.test-sandbox',
  'copilot-rehydration-adapter',
);

function fixture(name) {
  const root = path.join(ROOT, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'skills', 'root'), { recursive: true });
  fs.mkdirSync(path.join(root, '.skill-log'), { recursive: true });
  fs.writeFileSync(path.join(root, 'intent.md'), '# fixture\n');
  fs.writeFileSync(
    path.join(root, 'skills', 'root', 'SKILL.md'),
    '---\nname: root\nincludes: []\ncomposes: []\n---\ninstructions\n',
  );
  fs.writeFileSync(path.join(root, '.skill-log', 'root.jsonl'), '');
  registerRun({
    repositoryRoot: root,
    sessionId: 'session-1',
    runId: 'run-1',
    rootSkill: 'root',
    skill: 'root',
    logPath: path.join(root, '.skill-log', 'root.jsonl'),
    phase: 'before',
  });
  return root;
}

function payload(root, toolName, toolArgs) {
  return { sessionId: 'session-1', cwd: root, toolName, toolArgs, timestamp: Date.now() };
}

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('preToolUse denies material work and permits only the exact full canonical read', () => {
  const root = fixture('gate');
  preCompact(root, { sessionId: 'session-1', trigger: 'auto', timestamp: Date.now() });
  assert.equal(preToolUse(root, payload(root, 'bash', { command: 'git status' })).permissionDecision, 'deny');
  assert.equal(preToolUse(root, payload(root, 'view', {
    path: path.join(root, 'skills', 'root', 'SKILL.md'),
    view_range: [1, 2],
  })).permissionDecision, 'deny');
  assert.equal(preToolUse(root, payload(root, 'view', {
    path: path.join(root, 'skills', 'root', 'SKILL.md'),
  })).permissionDecision, 'allow');
});

test('large canonical reads receive the exact full-read recovery hint', () => {
  const root = fixture('large');
  fs.appendFileSync(path.join(root, 'skills', 'root', 'SKILL.md'), 'x'.repeat(21_000));
  registerRun({
    repositoryRoot: root,
    sessionId: 'session-large',
    runId: 'run-large',
    rootSkill: 'root',
    skill: 'root',
    logPath: path.join(root, '.skill-log', 'root.jsonl'),
    phase: 'before',
  });
  preCompact(root, { sessionId: 'session-large', trigger: 'auto', timestamp: Date.now() });
  const denied = preToolUse(root, {
    sessionId: 'session-large',
    cwd: root,
    toolName: 'view',
    toolArgs: { path: path.join(root, 'skills', 'root', 'SKILL.md') },
  });
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /forceReadLargeFiles: true/);
});

test('postToolUse observes the read; a forged acknowledgement does not clear the latch', () => {
  const root = fixture('ack');
  preCompact(root, { sessionId: 'session-1', trigger: 'auto', timestamp: Date.now() });
  assert.deepEqual(postToolUse(root, payload(root, 'bash', { command: 'echo acknowledged' })), {});
  assert.equal(readState(root, 'session-1').status, STATES.required);
  const accepted = postToolUse(root, payload(root, 'view', {
    path: path.join(root, 'skills', 'root', 'SKILL.md'),
  }));
  assert.match(accepted.additionalContext, /compaction-rehydration-checkpoint/);
  assert.equal(readState(root, 'session-1').status, STATES.rehydrated);
});

test('resume arms active persisted runs and rehydration does not register recursively', () => {
  const root = fixture('resume');
  const before = readState(root, 'session-1').stack.length;
  const result = sessionStart(root, {
    sessionId: 'session-1',
    source: 'resume',
    timestamp: Date.now(),
  });
  assert.match(result.additionalContext, /requires canonical rehydration/);
  postToolUse(root, payload(root, 'view', {
    path: path.join(root, 'skills', 'root', 'SKILL.md'),
  }));
  assert.equal(readState(root, 'session-1').stack.length, before);
});

test('agentStop fallback is bounded and all enforcement dispositions are distinct', () => {
  const root = fixture('stop');
  preCompact(root, { sessionId: 'session-1', trigger: 'manual', timestamp: Date.now() });
  assert.equal(agentStop(root, { sessionId: 'session-1', stop_hook_active: false }).decision, 'block');
  assert.equal(agentStop(root, { sessionId: 'session-1', stop_hook_active: true }).decision, 'allow');
  assert.equal(REPOSITORY_HOOK_DISPOSITION, 'hook-enforced-but-disableable');
  assert.equal(classifyDisposition({ policy: true, gate: true }), 'policy-enforced');
  assert.equal(classifyDisposition({ gate: true }), 'hook-enforced-but-disableable');
  assert.equal(classifyDisposition({ warning: true }), 'warn-only');
  assert.equal(classifyDisposition(), 'unsupported');
});

test('ambiguous preCompact persists a marker surfaced by tool and stop hooks', () => {
  const root = fixture('ambiguous');
  registerRun({
    repositoryRoot: root,
    runId: 'pending-a',
    rootSkill: 'root',
    skill: 'root',
    logPath: path.join(root, '.skill-log', 'root.jsonl'),
    phase: 'before',
  });
  registerRun({
    repositoryRoot: root,
    runId: 'pending-b',
    rootSkill: 'root',
    skill: 'root',
    logPath: path.join(root, '.skill-log', 'root.jsonl'),
    phase: 'before',
  });

  const compact = preCompact(root, {
    sessionId: 'ambiguous-session',
    trigger: 'auto',
    timestamp: Date.now(),
  });
  assert.equal(compact.status, STATES.degraded);
  const denied = preToolUse(root, {
    sessionId: 'ambiguous-session',
    cwd: root,
    toolName: 'bash',
    toolArgs: { command: 'git status' },
  });
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /ambiguous-active-runs/);
  const stopped = agentStop(root, {
    sessionId: 'ambiguous-session',
    stop_hook_active: false,
  });
  assert.equal(stopped.decision, 'block');
  assert.equal(stopped.degraded, true);
  assert.match(stopped.reason, /ambiguous-active-runs/);
  assert.equal(agentStop(root, {
    sessionId: 'ambiguous-session',
    stop_hook_active: false,
  }).decision, 'allow');
});

test('hook configuration states the local gate and timeout without a fictional postCompact hook', () => {
  const hook = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '.github', 'hooks', 'compaction-rehydration.json'),
    'utf8',
  );
  assert.match(hook, /"preCompact"/);
  assert.match(hook, /"preToolUse"/);
  assert.match(hook, /"postToolUse"/);
  assert.match(hook, /"agentStop"/);
  assert.match(hook, /"timeoutSec": 3/);
  assert.doesNotMatch(hook, /postCompact/);
});
