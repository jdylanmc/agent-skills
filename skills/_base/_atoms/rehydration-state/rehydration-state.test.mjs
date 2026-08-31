import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  acknowledgeRead,
  agentStopFallback,
  arm,
  buildCanonicalManifest,
  MAX_AGENT_STOP_BLOCKS,
  readState,
  registerRun,
  STATES,
} from './rehydration-state.mjs';

const ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
  '.test-sandbox',
  'rehydration-state',
);

function repo(name) {
  const root = path.join(ROOT, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.join(root, 'skills', 'root'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(root, '.skill-log'), { recursive: true });
  fs.writeFileSync(path.join(root, 'intent.md'), '# fixture\n');
  fs.writeFileSync(
    path.join(root, 'skills', 'root', 'SKILL.md'),
    '---\nname: root\nincludes: ["root/ref.md"]\ncomposes: []\n---\nroot instructions\n',
  );
  fs.writeFileSync(
    path.join(root, 'skills', 'root', 'ref.md'),
    '---\nname: ref\nincludes: []\ncomposes: []\n---\nroot reference\n',
  );
  fs.writeFileSync(
    path.join(root, 'skills', 'nested', 'SKILL.md'),
    '---\nname: nested\nincludes: []\ncomposes: []\n---\nnested instructions\n',
  );
  fs.writeFileSync(path.join(root, '.skill-log', 'root.jsonl'), '');
  return root;
}

function register(root, skill = 'root', runId = 'run-1') {
  registerRun({
    repositoryRoot: root,
    sessionId: 'session-1',
    runId,
    rootSkill: 'root',
    skill,
    logPath: path.join(root, '.skill-log', 'root.jsonl'),
    phase: 'before',
  });
}

test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('root and nested runs arm one ordered canonical read set', () => {
  const root = repo('nested');
  register(root);
  register(root, 'nested', 'run-1');
  const result = arm({ repositoryRoot: root, sessionId: 'session-1', trigger: 'auto' });
  assert.equal(result.status, STATES.required);
  assert.deepEqual(result.files, [
    'skills/root/SKILL.md',
    'skills/root/ref.md',
    'skills/nested/SKILL.md',
  ]);
});

test('a nested run ending during recovery preserves the root latch', () => {
  const root = repo('nested-after');
  register(root);
  register(root, 'nested', 'run-1');
  arm({ repositoryRoot: root, sessionId: 'session-1', trigger: 'auto' });
  registerRun({
    repositoryRoot: root,
    sessionId: 'session-1',
    runId: 'run-1',
    rootSkill: 'root',
    skill: 'nested',
    logPath: path.join(root, '.skill-log', 'root.jsonl'),
    phase: 'after',
  });

  const state = readState(root, 'session-1');
  assert.equal(state.status, STATES.required);
  assert.ok(state.latch.remaining.every((file) => file.skill === 'root'));
});

test('a run starting during recovery cannot disable the armed latch', () => {
  const root = repo('nested-before');
  register(root);
  arm({ repositoryRoot: root, sessionId: 'session-1', trigger: 'auto' });
  register(root, 'nested', 'run-2');
  const state = readState(root, 'session-1');
  assert.equal(state.status, STATES.required);
  assert.ok(state.latch.remaining.length > 0);
});

test('a complete exact read sequence clears once and returns a bounded checkpoint', () => {
  const root = repo('complete');
  register(root);
  const armed = arm({ repositoryRoot: root, sessionId: 'session-1', trigger: 'manual' });
  let result;
  for (const relativePath of armed.files) {
    result = acknowledgeRead({
      repositoryRoot: root,
      sessionId: 'session-1',
      generation: armed.generation,
      relativePath,
    });
  }
  assert.equal(result.status, STATES.rehydrated);
  assert.match(result.checkpoint, /do not invoke those skills again/);
  assert.equal(acknowledgeRead({
    repositoryRoot: root,
    sessionId: 'session-1',
    generation: armed.generation,
    relativePath: armed.files.at(-1),
  }).status, 'inactive');
});

test('repeated compaction replaces the latch with a fresh generation', () => {
  const root = repo('repeat');
  register(root);
  const first = arm({ repositoryRoot: root, sessionId: 'session-1', trigger: 'auto' });
  const second = arm({ repositoryRoot: root, sessionId: 'session-1', trigger: 'auto' });
  assert.equal(second.generation, first.generation + 1);
  assert.deepEqual(second.files, first.files);
  const stale = acknowledgeRead({
    repositoryRoot: root,
    sessionId: 'session-1',
    generation: first.generation,
    relativePath: first.files[0],
  });
  assert.equal(stale.reason, 'stale-packet');
  assert.equal(readState(root, 'session-1').status, STATES.required);
});

test('wrong path identity and digest drift degrade explicitly', () => {
  const wrong = repo('wrong');
  register(wrong);
  const wrongArmed = arm({ repositoryRoot: wrong, sessionId: 'session-1', trigger: 'auto' });
  assert.equal(acknowledgeRead({
    repositoryRoot: wrong,
    sessionId: 'session-1',
    generation: wrongArmed.generation,
    relativePath: 'skills/nested/SKILL.md',
  }).reason, 'wrong-identity');

  const drift = repo('drift');
  register(drift);
  const driftArmed = arm({ repositoryRoot: drift, sessionId: 'session-1', trigger: 'auto' });
  fs.appendFileSync(path.join(drift, driftArmed.files[0]), '\ndrift\n');
  assert.equal(acknowledgeRead({
    repositoryRoot: drift,
    sessionId: 'session-1',
    generation: driftArmed.generation,
    relativePath: driftArmed.files[0],
  }).reason, 'digest-drift');
});

test('wrong run, skill, and session identities never acknowledge the packet', () => {
  const root = repo('identity');
  register(root);
  const armed = arm({ repositoryRoot: root, sessionId: 'session-1', trigger: 'auto' });
  assert.equal(acknowledgeRead({
    repositoryRoot: root,
    sessionId: 'other-session',
    generation: armed.generation,
    relativePath: armed.files[0],
  }).status, 'inactive');
  assert.equal(acknowledgeRead({
    repositoryRoot: root,
    sessionId: 'session-1',
    generation: armed.generation,
    relativePath: armed.files[0],
    runId: 'forged-run',
    skill: 'root',
  }).reason, 'wrong-identity');
});

test('persisted state survives restart without prompt, transcript, or content bytes', () => {
  const root = repo('restart');
  register(root);
  arm({ repositoryRoot: root, sessionId: 'session-1', trigger: 'auto' });
  const serialized = JSON.stringify(readState(root, 'session-1'));
  assert.doesNotMatch(serialized, /root instructions|root reference|prompt|transcript|secret/i);
  assert.equal(readState(root, 'session-1').status, STATES.required);
});

test('agent stop forces one turn then yields below the eight-block ceiling', () => {
  const root = repo('stop');
  register(root);
  arm({ repositoryRoot: root, sessionId: 'session-1', trigger: 'auto' });
  assert.equal(MAX_AGENT_STOP_BLOCKS, 1);
  assert.equal(agentStopFallback(root, 'session-1', false).decision, 'block');
  const second = agentStopFallback(root, 'session-1', true);
  assert.equal(second.decision, 'allow');
  assert.equal(second.degraded, true);
});

test('canonical manifests are bounded and reject symlinked instructions', () => {
  const root = repo('unsafe');
  const target = path.join(root, 'outside.md');
  fs.writeFileSync(target, 'outside');
  fs.rmSync(path.join(root, 'skills', 'root', 'ref.md'));
  fs.symlinkSync(target, path.join(root, 'skills', 'root', 'ref.md'));
  assert.throws(() => buildCanonicalManifest(root, 'root'), { code: 'unsafe-path' });
});

test('state storage refuses symlinked control directories', () => {
  const root = repo('state-symlink');
  const outside = path.join(root, 'outside-state');
  fs.mkdirSync(outside);
  fs.rmSync(path.join(root, '.skill-log'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, '.skill-log'));
  assert.throws(() => register(root), { code: 'invalid-state' });
});
