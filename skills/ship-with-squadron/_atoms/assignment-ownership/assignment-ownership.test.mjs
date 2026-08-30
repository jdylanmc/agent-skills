import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import { createFleetState, recordSourceRevisionObservation } from '../fleet-state/fleet-state.mjs';
import {
  FORBIDDEN_AUTHORITIES,
  assignFreshWorker,
  continueWithFreshWorker,
  validateContinuationArtifact,
} from './assignment-ownership.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SANDBOX = path.join(ROOT, '.test-sandbox', 'ship-with-squadron-handoff');

function source(issue, observedAt = '2026-08-30T00:00:00Z') {
  return {
    invocation: { id: `read-${issue}-${observedAt}`, operation: 'read-issue' },
    provider: 'github', repository: 'owner/repo', issue, revision: `r-${issue}`,
    status: 'observed', terminal: true, complete: true, observedAt,
  };
}

const manifest = normalizeFleetManifest({
  confirmation: 'confirmed',
  goal: 'deliver',
  acceptedScope: [],
  exclusions: ['unrelated files'],
  humanDecisions: [],
  issues: ['a', 'b'].map((identity) => ({
    identity,
    sourceRevision: `r-${identity}`,
    sourceReceipt: source(identity),
    acceptanceCriteria: ['done'],
    scope: [`issue ${identity}`],
    allowedPaths: [`src/${identity}/**`],
  })),
  dependencies: [],
  concurrency: 2,
  budget: { cost: 10, timeMinutes: 60, retries: 2 },
  repository: { id: 'owner/repo', root: '/repo', baseBranch: 'main' },
  provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge'] },
  validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
  stopConditions: ['cancelled'],
  humanBoundaries: ['human merge'],
  shepherdIntent: 'yes',
});

function state() {
  let current = createFleetState(manifest, 'run');
  for (const issue of manifest.issues) {
    current = recordSourceRevisionObservation(
      current,
      manifest,
      issue.identity,
      source(issue.identity, '2026-08-30T00:01:00Z'),
      '2026-08-30T00:01:01Z',
    );
  }
  return current;
}

function packet(issue, branch, worktree) {
  const record = manifest.issues.find((entry) => entry.identity === issue);
  return {
    manifestDigest: manifest.digest,
    issue,
    sourceRevision: record.sourceRevision,
    acceptanceCriteria: record.acceptanceCriteria,
    scope: record.scope,
    exclusions: manifest.exclusions,
    allowedPaths: record.allowedPaths,
    verification: ['run declared tests'],
    reportContract: { summary: 'return changes', requiredEvidence: ['tests', 'diff'] },
    forbiddenAuthorities: [...FORBIDDEN_AUTHORITIES],
    branch,
    worktree,
  };
}

function assigned() {
  return assignFreshWorker(state(), manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: '/work/a',
    workerContext: 'worker-1',
    baseSha: 'base',
    headSha: 'head',
    packet: packet('a', 'issue-a', '/work/a'),
    startedAt: '2026-08-30T00:02:00Z',
  });
}

function handoffContent(target = 'worker-2') {
  return [
    '# Orchestration Handoff',
    'GOAL', 'finish',
    'SCOPE', 'issue a',
    'CONTEXT', 'evidence',
    'ACCEPTANCE', 'done',
    'VERIFY', 'tests',
    'TIMEBOX', 'bounded',
    'FORBIDDEN', 'remote mutation',
    'REPORT', 'changes',
    'STANDING', 'continue',
    '- run_id: run',
    '- issue: a',
    '- prior_generation: 1',
    '- branch: issue-a',
    '- worktree: /work/a',
    '- base_sha: base',
    '- head_sha: head',
    '- id: worker-1',
    `- id: ${target}`,
  ].join('\n');
}

function handoff(file, content, target = 'worker-2') {
  return {
    invocation_skill: 'orchestration-handoff',
    persistence_status: 'created',
    schema_version: 1,
    run_identity: { run_id: 'run' },
    source_agent: { id: 'worker-1' },
    target_agent: { id: target },
    task_contract: {},
    inputs: [],
    constraints: [],
    assumptions: [],
    artifacts_and_references: [],
    acceptance_criteria: ['done'],
    open_questions: [],
    path: file,
    artifact_sha256: crypto.createHash('sha256').update(content).digest('hex'),
    fresh_consolidated_brief: [
      'GOAL: finish', 'SCOPE: issue a', 'CONTEXT: evidence', 'ACCEPTANCE: done',
      'VERIFY: tests', 'TIMEBOX: bounded', 'FORBIDDEN: remote mutation',
      'REPORT: changes', 'STANDING: continue',
    ].join('\n'),
    bindings: {
      runId: 'run', issue: 'a', priorGeneration: 1,
      branch: 'issue-a', worktree: '/work/a',
      sourceAgent: 'worker-1', targetAgent: target,
      baseSha: 'base', headSha: 'head',
    },
  };
}

test('assigns only pending unowned issues with a complete manifest-bound packet', () => {
  const current = assigned();
  assert.equal(current.issues.a.status, 'active');
  assert.equal(current.issues.a.assignment.generation, 1);
  assert.throws(() => assignFreshWorker(current, manifest, {
    issue: 'b', branch: 'issue-a', worktree: '/work/b', workerContext: 'worker-2',
    baseSha: 'base', headSha: 'head', packet: packet('b', 'issue-a', '/work/b'),
  }), /branch already owned/);
  assert.throws(() => assignFreshWorker(state(), manifest, {
    issue: 'a', branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-1',
    baseSha: 'base', headSha: 'head',
    packet: { ...packet('a', 'issue-a', '/work/a'), forbiddenAuthorities: ['merge'] },
  }), /forbidden authorities/);
});

test('continues only after rereading a real safe bound handoff artifact', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  fs.mkdirSync(SANDBOX, { recursive: true });
  const file = path.join(SANDBOX, 'handoff.md');
  const content = handoffContent();
  fs.writeFileSync(file, content);
  const continued = continueWithFreshWorker(assigned(), manifest, {
    issue: 'a',
    reason: 'stalled',
    handoff: handoff(file, content),
    allowedHandoffRoot: SANDBOX,
    branch: 'issue-a',
    worktree: '/work/a',
    workerContext: 'worker-2',
    packet: packet('a', 'issue-a', '/work/a'),
    startedAt: '2026-08-30T00:03:00Z',
    endedAt: '2026-08-30T00:02:59Z',
  });
  assert.equal(continued.issues.a.status, 'active');
  assert.equal(continued.issues.a.assignment.generation, 2);
  assert.equal(continued.issues.a.continuationChain[0].endReason, 'stalled');
  assert.equal(validateContinuationArtifact(file, handoff(file, content), SANDBOX).valid, true);
});

test('rejects symlink/path escape, stale bindings, and fabricated paths', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const root = path.join(SANDBOX, 'allowed');
  const outside = path.join(SANDBOX, 'outside.md');
  fs.mkdirSync(root, { recursive: true });
  const content = handoffContent();
  fs.writeFileSync(outside, content);
  const link = path.join(root, 'link.md');
  fs.symlinkSync(outside, link);
  assert.equal(validateContinuationArtifact(link, handoff(link, content), root).valid, false);
  assert.throws(() => continueWithFreshWorker(assigned(), manifest, {
    issue: 'a', reason: 'stalled',
    handoff: handoff(outside, content),
    allowedHandoffRoot: root,
    branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-2',
    packet: packet('a', 'issue-a', '/work/a'),
  }), /escapes the allowed root/);
  assert.throws(() => continueWithFreshWorker(assigned(), manifest, {
    issue: 'a', reason: 'stalled',
    handoff: { ...handoff(outside, content), path: path.join(root, 'missing.md') },
    allowedHandoffRoot: root,
    branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-2',
    packet: packet('a', 'issue-a', '/work/a'),
  }), /artifact/);
});

test('fleet stop preserves handoff obligation but dispatches no continuation', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  fs.mkdirSync(SANDBOX, { recursive: true });
  const file = path.join(SANDBOX, 'handoff.md');
  const content = handoffContent();
  fs.writeFileSync(file, content);
  const stopped = assigned();
  stopped.control.cancelled = true;
  assert.throws(() => continueWithFreshWorker(stopped, manifest, {
    issue: 'a', reason: 'stalled', handoff: handoff(file, content),
    allowedHandoffRoot: SANDBOX,
    branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-2',
    packet: packet('a', 'issue-a', '/work/a'),
  }), /continuation dispatch is forbidden/);
});
