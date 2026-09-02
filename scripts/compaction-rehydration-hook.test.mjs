import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { run } from './compaction-rehydration-hook.mjs';
import { run as runAppend } from '../skills/_base/_atoms/chronicle-append/chronicle-append.mjs';
import { replayLog } from '../skills/_base/_molecules/chronicler/chronicler.mjs';
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

function invokeHookProcess(kind, input) {
  const script = path.join(REPOSITORY_ROOT, 'scripts', 'compaction-rehydration-hook.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, kind], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
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

test('normal Chronicle entry without correlation is claimed by the hook session', () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'skills', 'root'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, '.skill-log'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'intent.md'), '# fixture\n');
  fs.writeFileSync(
    path.join(ROOT, 'skills', 'root', 'SKILL.md'),
    '---\nname: root\nincludes: []\ncomposes: []\n---\ninstructions\n',
  );
  const tracker = path.join(REPOSITORY_ROOT, 'scripts', 'compaction-rehydration-register.mjs');
  fs.writeFileSync(
    path.join(ROOT, 'scripts', 'compaction-rehydration-register.mjs'),
    `import { run } from ${JSON.stringify(`file://${tracker}`)};\nlet s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{process.exitCode=run(JSON.parse(s));});\n`,
  );
  const log = path.join(ROOT, '.skill-log', 'root.jsonl');
  assert.equal(runAppend([
    '--log', log, '--run', 'run-1', '--root-skill', 'root',
    '--event', 'run', '--phase', 'before', '--summary', 'Start.',
  ], streams()), 0);

  const io = streams();
  assert.equal(run('preCompact', {
    sessionId: 'hook-session', cwd: ROOT, trigger: 'auto', timestamp: Date.now(),
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

test('hook entry point requires exact successful model-facing result bytes', () => {
  fixture();
  const relativePath = 'skills/root/SKILL.md';
  run('preCompact', {
    sessionId: 'session-1',
    cwd: ROOT,
    trigger: 'auto',
    timestamp: Date.now(),
  }, streams());
  const io = streams();
  assert.equal(run('postToolUse', {
    sessionId: 'session-1',
    cwd: ROOT,
    toolName: 'view',
    toolArgs: { path: path.join(ROOT, relativePath) },
    toolResult: {
      resultType: 'success',
      textResultForLlm: fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
    },
  }, io), 0);
  assert.match(JSON.parse(io.output()).additionalContext, /compaction-rehydration-checkpoint/);
});

test('repeated hook notifications record one lifecycle start and outcome per generation', () => {
  fixture();
  const resume = {
    sessionId: 'session-1',
    cwd: ROOT,
    source: 'resume',
    timestamp: Date.now(),
  };
  run('sessionStart', resume, streams());
  run('sessionStart', resume, streams());
  const relativePath = 'skills/root/SKILL.md';
  run('postToolUse', {
    sessionId: 'session-1',
    cwd: ROOT,
    toolName: 'view',
    toolArgs: { path: path.join(ROOT, relativePath) },
    toolResult: {
      resultType: 'success',
      textResultForLlm: fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
    },
  }, streams());
  run('agentStop', {
    sessionId: 'session-1',
    cwd: ROOT,
    stop_hook_active: false,
  }, streams());

  const replay = replayLog(path.join(ROOT, '.skill-log', 'root.jsonl'));
  const lifecycle = replay.events.filter((event) => event.operation === 'rehydration-1');
  assert.deepEqual(lifecycle.map((event) => event.phase), ['before', 'after']);
  assert.deepEqual(replay.defects, []);
});

test('concurrent hook processes atomically append one lifecycle record per phase', async () => {
  fixture();
  const resume = {
    sessionId: 'session-1',
    cwd: ROOT,
    source: 'resume',
    timestamp: Date.now(),
  };
  const starts = await Promise.all(
    Array.from({ length: 12 }, () => invokeHookProcess('sessionStart', resume)),
  );
  assert.deepEqual(
    starts.filter((result) => result.status !== 0),
    [],
  );

  const relativePath = 'skills/root/SKILL.md';
  const finish = await invokeHookProcess('postToolUse', {
    sessionId: 'session-1',
    cwd: ROOT,
    toolName: 'view',
    toolArgs: { path: path.join(ROOT, relativePath) },
    toolResult: {
      resultType: 'success',
      textResultForLlm: fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
    },
  });
  assert.equal(finish.status, 0, finish.stderr);

  const replay = replayLog(path.join(ROOT, '.skill-log', 'root.jsonl'));
  const lifecycle = replay.events.filter((event) => event.operation === 'rehydration-1');
  assert.deepEqual(lifecycle.map((event) => event.phase), ['before', 'after']);
  assert.deepEqual(replay.defects, []);
});

test('a failed lifecycle append is retried before any outcome is recorded', () => {
  fixture();
  const log = path.join(ROOT, '.skill-log', 'root.jsonl');
  fs.writeFileSync(log, 'not-json\n');
  const resume = {
    sessionId: 'session-1',
    cwd: ROOT,
    source: 'resume',
    timestamp: Date.now(),
  };
  run('sessionStart', resume, streams());
  fs.writeFileSync(log, '');
  run('sessionStart', resume, streams());

  const relativePath = 'skills/root/SKILL.md';
  run('postToolUse', {
    sessionId: 'session-1',
    cwd: ROOT,
    toolName: 'view',
    toolArgs: { path: path.join(ROOT, relativePath) },
    toolResult: {
      resultType: 'success',
      textResultForLlm: fs.readFileSync(path.join(ROOT, relativePath), 'utf8'),
    },
  }, streams());

  const replay = replayLog(log);
  const lifecycle = replay.events.filter((event) => event.operation === 'rehydration-1');
  assert.deepEqual(lifecycle.map((event) => event.phase), ['before', 'after']);
  assert.deepEqual(replay.defects, []);
});

test('final-frame degradation records against the immutable lifecycle owner', () => {
  fixture();
  run('preCompact', {
    sessionId: 'session-1',
    cwd: ROOT,
    trigger: 'auto',
    timestamp: Date.now(),
  }, streams());
  registerRun({
    repositoryRoot: ROOT,
    sessionId: 'session-1',
    runId: 'run-1',
    rootSkill: 'root',
    skill: 'root',
    logPath: path.join(ROOT, '.skill-log', 'root.jsonl'),
    phase: 'after',
  });
  run('agentStop', {
    sessionId: 'session-1',
    cwd: ROOT,
    stop_hook_active: false,
  }, streams());

  const replay = replayLog(path.join(ROOT, '.skill-log', 'root.jsonl'));
  const lifecycle = replay.events.filter((event) => event.operation === 'rehydration-1');
  assert.deepEqual(lifecycle.map((event) => event.phase), ['before', 'after']);
  assert.deepEqual(replay.defects, []);
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
