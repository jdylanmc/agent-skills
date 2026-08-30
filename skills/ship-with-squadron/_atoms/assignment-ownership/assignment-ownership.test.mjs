import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assignFreshWorker,
  continueWithFreshWorker,
  validateContinuationArtifact,
  validateContinuationHandoff,
} from './assignment-ownership.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SANDBOX = path.join(ROOT, '.test-sandbox', 'ship-with-squadron-handoff');

function state() {
  return {
    issues: {
      a: { status: 'pending', assignment: null, continuationChain: [] },
      b: { status: 'pending', assignment: null, continuationChain: [] },
    },
    events: [],
  };
}

function handoff() {
  return {
    invocation_skill: 'orchestration-handoff',
    persistence_status: 'created',
    schema_version: 1,
    run_identity: 'run',
    source_agent: 'old',
    target_agent: 'new',
    task_contract: {},
    inputs: {},
    constraints: [],
    assumptions: [],
    artifacts_and_references: [],
    acceptance_criteria: ['done'],
    open_questions: [],
    path: '/handoffs/run.md',
    artifact_sha256: 'a'.repeat(64),
    reread_verified: true,
    fresh_consolidated_brief: [
      'GOAL: finish', 'SCOPE: issue a', 'CONTEXT: evidence', 'ACCEPTANCE: done',
      'VERIFY: tests', 'TIMEBOX: bounded', 'FORBIDDEN: remote mutation',
      'REPORT: changes', 'STANDING: continue',
    ].join('\n'),
  };
}

test('enforces exclusive branch/worktree ownership and fresh contexts', () => {
  const assigned = assignFreshWorker(state(), {
    issue: 'a', branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-1',
  });
  assert.throws(() => assignFreshWorker(assigned, {
    issue: 'b', branch: 'issue-a', worktree: '/work/b', workerContext: 'worker-2',
  }), /branch already owned/);
  assert.throws(() => assignFreshWorker(assigned, {
    issue: 'b', branch: 'issue-b', worktree: '/work/b', workerContext: 'worker-1',
  }), /fresh/);
});

test('continues only from a validated handoff into a fresh generation', () => {
  const assigned = assignFreshWorker(state(), {
    issue: 'a', branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-1',
  });
  assert.equal(validateContinuationHandoff(handoff()).valid, true);
  const continued = continueWithFreshWorker(assigned, {
    issue: 'a',
    reason: 'stalled',
    handoff: handoff(),
    branch: 'issue-a',
    worktree: '/work/a',
    workerContext: 'worker-2',
  });
  assert.equal(continued.issues.a.assignment.generation, 2);
  assert.equal(continued.issues.a.continuationChain[0].endReason, 'stalled');
  assert.throws(() => continueWithFreshWorker(assigned, {
    issue: 'a',
    reason: 'stalled',
    handoff: { ...handoff(), reread_verified: false },
    branch: 'issue-a',
    worktree: '/work/a',
    workerContext: 'worker-3',
  }), /invalid orchestration handoff/);
});

test('rereads and hashes the actual orchestration handoff artifact', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  fs.mkdirSync(SANDBOX, { recursive: true });
  const file = path.join(SANDBOX, 'handoff.md');
  const content = [
    '# GOAL', '# SCOPE', '# CONTEXT', '# ACCEPTANCE', '# VERIFY',
    '# TIMEBOX', '# FORBIDDEN', '# REPORT', '# STANDING',
  ].join('\n');
  fs.writeFileSync(file, content);
  const packet = {
    ...handoff(),
    path: file,
    artifact_sha256: crypto.createHash('sha256').update(content).digest('hex'),
  };
  assert.equal(validateContinuationArtifact(file, packet).valid, true);
  assert.equal(validateContinuationArtifact(file, {
    ...packet,
    artifact_sha256: '0'.repeat(64),
  }).valid, false);
});
