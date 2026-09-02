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

function pendingFixture(name) {
  const root = fixture(name);
  fs.rmSync(path.join(root, '.skill-log', 'rehydration'), { recursive: true, force: true });
  registerRun({
    repositoryRoot: root,
    runId: 'run-pending',
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

function successfulResult(root, relativePath, snakeCase = false) {
  const text = fs.readFileSync(path.join(root, relativePath), 'utf8');
  return snakeCase
    ? { tool_result: { result_type: 'success', text_result_for_llm: text } }
    : { toolResult: { resultType: 'success', textResultForLlm: text } };
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

test('malformed pending correlation persists a fail-closed session marker', () => {
  for (const [name, corrupt] of [
    ['invalid-json', (target) => fs.writeFileSync(target, '{')],
    ['invalid-frame', (target) => fs.writeFileSync(target, '[{"runId":"run-pending"}]\n')],
  ]) {
    const root = pendingFixture(`pending-${name}`);
    const target = path.join(root, '.skill-log', 'rehydration', 'pending.json');
    corrupt(target);

    assert.deepEqual(
      preCompact(root, { sessionId: 'session-new', trigger: 'auto', timestamp: Date.now() }),
      { status: STATES.degraded, reason: 'pending-registry-invalid' },
    );
    const denied = preToolUse(root, {
      sessionId: 'session-new',
      cwd: root,
      toolName: 'bash',
      toolArgs: { command: 'git status' },
    });
    assert.equal(denied.permissionDecision, 'deny');
    assert.match(denied.permissionDecisionReason, /pending-registry-invalid/);
  }
});

test('pending corruption invalidates an existing latch without reopening material work', () => {
  const root = fixture('pending-existing-latch');
  preCompact(root, { sessionId: 'session-1', trigger: 'auto', timestamp: Date.now() });
  fs.writeFileSync(path.join(root, '.skill-log', 'rehydration', 'pending.json'), '{');

  assert.deepEqual(
    preCompact(root, { sessionId: 'session-1', trigger: 'auto', timestamp: Date.now() }),
    { status: STATES.degraded, reason: 'pending-registry-invalid' },
  );
  for (const [toolName, toolArgs] of [
    ['view', { path: path.join(root, 'skills', 'root', 'SKILL.md') }],
    ['bash', { command: 'git status' }],
  ]) {
    const denied = preToolUse(root, payload(root, toolName, toolArgs));
    assert.equal(denied.permissionDecision, 'deny');
    assert.match(denied.permissionDecisionReason, /pending-registry-invalid/);
  }
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
  const relativePath = 'skills/root/SKILL.md';
  preCompact(root, { sessionId: 'session-1', trigger: 'auto', timestamp: Date.now() });
  assert.deepEqual(postToolUse(root, payload(root, 'bash', { command: 'echo acknowledged' })), {});
  assert.equal(readState(root, 'session-1').status, STATES.required);
  const accepted = postToolUse(root, {
    ...payload(root, 'view', { path: path.join(root, relativePath) }),
    ...successfulResult(root, relativePath),
  });
  assert.match(accepted.additionalContext, /compaction-rehydration-checkpoint/);
  assert.equal(readState(root, 'session-1').status, STATES.rehydrated);
});

test('postToolUse accepts the documented snake_case successful result', () => {
  const root = fixture('snake-case');
  const relativePath = 'skills/root/SKILL.md';
  preCompact(root, { sessionId: 'session-1', trigger: 'auto', timestamp: Date.now() });
  const accepted = postToolUse(root, {
    ...payload(root, 'view', { path: path.join(root, relativePath) }),
    ...successfulResult(root, relativePath, true),
  });
  assert.match(accepted.additionalContext, /compaction-rehydration-checkpoint/);
  assert.equal(readState(root, 'session-1').status, STATES.rehydrated);
});

test('postToolUse ignores a non-full read even when its result contains canonical content', () => {
  const root = fixture('partial-result');
  const relativePath = 'skills/root/SKILL.md';
  preCompact(root, { sessionId: 'session-1', trigger: 'auto', timestamp: Date.now() });
  const result = postToolUse(root, {
    ...payload(root, 'view', {
      path: path.join(root, relativePath),
      view_range: [1, 2],
    }),
    ...successfulResult(root, relativePath),
  });
  assert.deepEqual(result, {});
  assert.equal(readState(root, 'session-1').status, STATES.required);
});

test('restore race cannot acknowledge content that was shown to the model', () => {
  const root = fixture('restore-race');
  const relativePath = 'skills/root/SKILL.md';
  const absolutePath = path.join(root, relativePath);
  const canonical = fs.readFileSync(absolutePath, 'utf8');
  preCompact(root, { sessionId: 'session-1', trigger: 'auto', timestamp: Date.now() });
  fs.writeFileSync(absolutePath, `${canonical}\nconcurrent content B\n`);
  const contentShownToModel = fs.readFileSync(absolutePath, 'utf8');
  fs.writeFileSync(absolutePath, canonical);
  const result = postToolUse(root, {
    ...payload(root, 'view', { path: path.join(root, relativePath) }),
    toolResult: {
      resultType: 'success',
      textResultForLlm: contentShownToModel,
    },
  });
  assert.match(result.additionalContext, /tool-result-content-mismatch/);
  assert.doesNotMatch(result.additionalContext, /compaction-rehydration-checkpoint/);
  assert.equal(readState(root, 'session-1').degradedReason, 'tool-result-content-mismatch');
});

test('missing, malformed, and unsuccessful tool results never clear the latch', () => {
  const cases = [
    ['missing', {}, 'tool-result-malformed'],
    ['missing-type', { toolResult: {} }, 'tool-result-malformed'],
    ['malformed', { toolResult: { resultType: 'success' } }, 'tool-result-malformed'],
    ['unsuccessful', {
      toolResult: { resultType: 'failure', textResultForLlm: 'failed' },
    }, 'tool-result-not-success'],
  ];
  for (const [name, toolResult, reason] of cases) {
    const root = fixture(`result-${name}`);
    const relativePath = 'skills/root/SKILL.md';
    preCompact(root, { sessionId: 'session-1', trigger: 'auto', timestamp: Date.now() });
    const result = postToolUse(root, {
      ...payload(root, 'view', { path: path.join(root, relativePath) }),
      ...toolResult,
    });
    assert.match(result.additionalContext, new RegExp(reason));
    assert.doesNotMatch(result.additionalContext, /compaction-rehydration-checkpoint/);
    assert.equal(readState(root, 'session-1').degradedReason, reason);
  }
});

test('large exact full result acknowledges only with the full-read request and bytes', () => {
  const root = fixture('large-result');
  const relativePath = 'skills/root/SKILL.md';
  fs.appendFileSync(path.join(root, relativePath), 'x'.repeat(21_000));
  registerRun({
    repositoryRoot: root,
    sessionId: 'session-large-result',
    runId: 'run-large-result',
    rootSkill: 'root',
    skill: 'root',
    logPath: path.join(root, '.skill-log', 'root.jsonl'),
    phase: 'before',
  });
  preCompact(root, {
    sessionId: 'session-large-result',
    trigger: 'auto',
    timestamp: Date.now(),
  });
  const result = postToolUse(root, {
    sessionId: 'session-large-result',
    cwd: root,
    toolName: 'view',
    toolArgs: {
      path: path.join(root, relativePath),
      forceReadLargeFiles: true,
    },
    ...successfulResult(root, relativePath),
  });
  assert.match(result.additionalContext, /compaction-rehydration-checkpoint/);
  assert.equal(readState(root, 'session-large-result').status, STATES.rehydrated);
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
  postToolUse(root, {
    ...payload(root, 'view', { path: path.join(root, 'skills', 'root', 'SKILL.md') }),
    ...successfulResult(root, 'skills/root/SKILL.md'),
  });
  assert.equal(readState(root, 'session-1').stack.length, before);
});

test('resume atomically claims an uncorrelated pending run and gates material work', () => {
  const root = fixture('resume-pending');
  registerRun({
    repositoryRoot: root,
    runId: 'pending-resume',
    rootSkill: 'root',
    skill: 'root',
    logPath: path.join(root, '.skill-log', 'root.jsonl'),
    phase: 'before',
  });

  const resumed = sessionStart(root, {
    sessionId: 'resumed-session',
    source: 'resume',
    timestamp: Date.now(),
  });
  assert.match(resumed.additionalContext, /requires canonical rehydration/);
  assert.equal(readState(root, 'resumed-session').status, STATES.required);
  const denied = preToolUse(root, {
    sessionId: 'resumed-session',
    cwd: root,
    toolName: 'bash',
    toolArgs: { command: 'git status' },
  });
  assert.equal(denied.permissionDecision, 'deny');
});

test('ambiguous pending roots on resume persist and surface a material-work block', () => {
  const root = fixture('resume-ambiguous');
  for (const runId of ['pending-a', 'pending-b']) {
    registerRun({
      repositoryRoot: root,
      runId,
      rootSkill: 'root',
      skill: 'root',
      logPath: path.join(root, '.skill-log', 'root.jsonl'),
      phase: 'before',
    });
  }

  const resumed = sessionStart(root, {
    sessionId: 'ambiguous-resume-session',
    source: 'resume',
    timestamp: Date.now(),
  });
  assert.match(resumed.additionalContext, /ambiguous-active-runs/);
  assert.equal(
    readState(root, 'ambiguous-resume-session').degradedReason,
    'ambiguous-active-runs',
  );
  const denied = preToolUse(root, {
    sessionId: 'ambiguous-resume-session',
    cwd: root,
    toolName: 'bash',
    toolArgs: { command: 'git status' },
  });
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /ambiguous-active-runs/);
});

test('repeated resume preserves the armed generation and remaining read', () => {
  const root = fixture('resume-repeat');
  sessionStart(root, {
    sessionId: 'session-1',
    source: 'resume',
    timestamp: Date.now(),
  });
  const first = readState(root, 'session-1');
  const repeated = sessionStart(root, {
    sessionId: 'session-1',
    source: 'resume',
    timestamp: Date.now() + 1,
  });
  const second = readState(root, 'session-1');
  assert.match(repeated.additionalContext, new RegExp(first.latch.remaining[0].path));
  assert.equal(second.generation, first.generation);
  assert.deepEqual(second.latch.remaining, first.latch.remaining);
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
