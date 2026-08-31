import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { run } from './compaction-rehydration-hook.mjs';
import { registerRun } from '../skills/_base/_atoms/rehydration-state/rehydration-state.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox', 'compaction-rehydration-hook');

function fixture() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'skills', 'root'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, '.skill-log'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'intent.md'), '# fixture\n');
  fs.writeFileSync(
    path.join(ROOT, 'skills', 'root', 'SKILL.md'),
    '---\nname: root\nincludes: []\ncomposes: []\n---\ninstructions\n',
  );
  fs.writeFileSync(path.join(ROOT, '.skill-log', 'root.jsonl'), '');
  registerRun({
    repositoryRoot: ROOT,
    sessionId: 'session-1',
    runId: 'run-1',
    rootSkill: 'root',
    skill: 'root',
    logPath: path.join(ROOT, '.skill-log', 'root.jsonl'),
    phase: 'before',
  });
}

function streams() {
  let stdout = '';
  let stderr = '';
  return {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
    output: () => stdout,
    errors: () => stderr,
  };
}

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('hook entry point arms compaction and emits one JSON output', () => {
  fixture();
  const io = streams();
  assert.equal(run('preCompact', {
    sessionId: 'session-1',
    cwd: ROOT,
    trigger: 'auto',
    timestamp: Date.now(),
  }, io), 0);
  assert.equal(JSON.parse(io.output()).status, 'rehydration-required');
});

test('hook entry point returns a deny decision for non-canonical work', () => {
  fixture();
  run('preCompact', {
    sessionId: 'session-1',
    cwd: ROOT,
    trigger: 'auto',
    timestamp: Date.now(),
  }, streams());
  const io = streams();
  assert.equal(run('preToolUse', {
    sessionId: 'session-1',
    cwd: ROOT,
    toolName: 'bash',
    toolArgs: { command: 'git status' },
  }, io), 0);
  assert.equal(JSON.parse(io.output()).permissionDecision, 'deny');
});

test('unknown events and preToolUse crashes return fail-closed exit codes', () => {
  fixture();
  assert.equal(run('unknown', { cwd: ROOT }, streams()), 1);
  assert.equal(run('preToolUse', { sessionId: 'session-1', cwd: '/definitely-not-a-repository-131' }, streams()), 2);
});

test('CLI rejects malformed input with the event-specific exit code', () => {
  const script = path.join(REPOSITORY_ROOT, 'scripts', 'compaction-rehydration-hook.mjs');
  const result = spawnSync(process.execPath, [script, 'preToolUse'], {
    input: '{',
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /invalid hook input/);
});
