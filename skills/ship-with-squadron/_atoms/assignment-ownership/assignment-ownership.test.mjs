import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  createFleetState,
  fleetStatePath,
  persistFleetState,
  recordSourceRevisionObservation,
} from '../fleet-state/fleet-state.mjs';
import {
  FORBIDDEN_AUTHORITIES,
  assignFreshWorker,
  assignFreshWorkerPersisted,
  createSchedulerLease,
  continueWithFreshWorker,
  validateContinuationArtifact,
} from './assignment-ownership.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SANDBOX = path.join(ROOT, '.test-sandbox', 'ship-with-squadron-handoff');
const SAFE_FD_SUPPORTED = Number.isInteger(fs.constants.O_NOFOLLOW) && fs.constants.O_NOFOLLOW !== 0;

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
  const current = state();
  return assignFreshWorker(current, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: '/work/a',
    workerContext: 'worker-1',
    baseSha: 'base',
    headSha: 'head',
    packet: packet('a', 'issue-a', '/work/a'),
    schedulerLease: createSchedulerLease(current, manifest, 'a'),
    startedAt: '2026-08-30T00:02:00Z',
  });
}

function handoffPayload(target = 'worker-2') {
  const inputs = [
    ['issue', 'a'],
    ['prior_generation', '1'],
    ['branch', 'issue-a'],
    ['worktree', '/work/a'],
    ['base_sha', 'base'],
    ['head_sha', 'head'],
    ['manifest_digest', manifest.digest],
    ['state_revision', '0'],
  ].map(([name, value]) => ({ name, value, source: 'fleet-state' }));
  return {
    schema_version: 1,
    run_identity: { run_id: 'run', root_skill: 'ship-with-squadron' },
    source_agent: { id: 'worker-1', role: 'implementation worker' },
    target_agent: { id: target, role: 'continuation worker', invocation_reason: 'stalled' },
    task_contract: {
      goal: 'finish', scope: 'issue a', context: 'verified prior artifacts',
      verify: 'tests', timebox: 'bounded', forbidden: 'remote mutation',
      report: 'changes', standing: 'continue',
    },
    inputs,
    constraints: ['no remote mutation'],
    assumptions: [],
    artifacts_and_references: [],
    acceptance_criteria: ['done'],
    open_questions: [],
  };
}

function handoffContent(payload = handoffPayload()) {
  return [
    '# Orchestration Handoff',
    '## Goal',
    'Create a safe orchestration handoff.',
    'GOAL', payload.task_contract.goal,
    'SCOPE', 'issue a',
    'CONTEXT', 'verified prior artifacts',
    'ACCEPTANCE', 'done',
    'VERIFY', 'tests',
    'TIMEBOX', 'bounded',
    'FORBIDDEN', 'remote mutation',
    'REPORT', 'changes',
    'STANDING', 'continue',
    '## Current Progress',
    '- run_id: run',
    '- id: worker-1',
    `- id: ${payload.target_agent.id}`,
    ...payload.inputs.map((entry) => `- ${entry.name}: ${entry.value} (source: ${entry.source})`),
    '## Decisions and Constraints',
    'bounded',
    '## Artifacts and References',
    'No confirmed information yet.',
    '## What Worked',
    'captured',
    '## What Did Not Work',
    'No confirmed information yet.',
    '## Next Steps',
    'continue',
    '',
  ].join('\n');
}

function handoff(file, content) {
  return {
    path: file,
    directory: path.dirname(file),
    name: path.basename(file),
    bytes: Buffer.byteLength(content),
    headings: [
      'Goal', 'Current Progress', 'Decisions and Constraints',
      'Artifacts and References', 'What Worked', 'What Did Not Work', 'Next Steps',
    ],
    redactions: [],
    suggested_skills_included: false,
  };
}

function setRuntimeTemp(t) {
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = SANDBOX;
  t.after(() => {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  });
  const root = path.join(SANDBOX, 'handoffs');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

test('assigns only pending unowned issues with a complete manifest-bound packet', () => {
  const current = assigned();
  assert.equal(current.issues.a.status, 'active');
  assert.equal(current.issues.a.assignment.generation, 1);
  assert.throws(() => assignFreshWorker(current, manifest, {
    issue: 'b', branch: 'issue-a', worktree: '/work/b', workerContext: 'worker-2',
    baseSha: 'base', headSha: 'head', packet: packet('b', 'issue-a', '/work/b'),
    schedulerLease: createSchedulerLease(current, manifest, 'b'),
  }), /branch already owned/);
  const fresh = state();
  assert.throws(() => assignFreshWorker(fresh, manifest, {
    issue: 'a', branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-1',
    baseSha: 'base', headSha: 'head',
    packet: { ...packet('a', 'issue-a', '/work/a'), forbiddenAuthorities: ['merge'] },
    schedulerLease: createSchedulerLease(fresh, manifest, 'a'),
  }), /forbidden authorities/);
  const stale = state();
  const staleLease = createSchedulerLease(stale, manifest, 'a');
  stale.revision += 1;
  assert.throws(() => assignFreshWorker(stale, manifest, {
    issue: 'a', branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-1',
    baseSha: 'base', headSha: 'head', packet: packet('a', 'issue-a', '/work/a'),
    schedulerLease: staleLease,
  }), /scheduler lease/);
});

test('continues only after rereading a real safe bound handoff artifact', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const root = setRuntimeTemp(t);
  const file = path.join(root, 'handoff.md');
  const payload = handoffPayload();
  const content = handoffContent(payload);
  fs.writeFileSync(file, content);
  if (!SAFE_FD_SUPPORTED) {
    assert.throws(() => continueWithFreshWorker(assigned(), manifest, {
      issue: 'a', reason: 'stalled', handoff: handoff(file, content), handoffPayload: payload,
      branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-2',
      packet: packet('a', 'issue-a', '/work/a'),
    }), /cannot establish O_NOFOLLOW/);
    return;
  }
  const continued = continueWithFreshWorker(assigned(), manifest, {
    issue: 'a',
    reason: 'stalled',
    handoff: handoff(file, content),
    handoffPayload: payload,
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
  assert.equal(validateContinuationArtifact(handoff(file, content), payload, {
    runId: 'run', issue: 'a', priorGeneration: 1, branch: 'issue-a', worktree: '/work/a',
    sourceAgent: 'worker-1', targetAgent: 'worker-2', baseSha: 'base', headSha: 'head',
    manifestDigest: manifest.digest, stateRevision: 0, acceptanceCriteria: ['done'],
  }).valid, true);
});

test('rejects symlink/path escape, stale bindings, and fabricated paths', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const root = setRuntimeTemp(t);
  const outside = path.join(SANDBOX, 'outside.md');
  const payload = handoffPayload();
  const content = handoffContent(payload);
  fs.writeFileSync(outside, content);
  const link = path.join(root, 'link.md');
  fs.symlinkSync(outside, link);
  assert.equal(validateContinuationArtifact(handoff(link, content), payload).valid, false);
  assert.throws(() => continueWithFreshWorker(assigned(), manifest, {
    issue: 'a', reason: 'stalled',
    handoff: handoff(outside, content),
    handoffPayload: payload,
    branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-2',
    packet: packet('a', 'issue-a', '/work/a'),
  }), /runtime-trusted handoff directory/);
  assert.throws(() => continueWithFreshWorker(assigned(), manifest, {
    issue: 'a', reason: 'stalled',
    handoff: handoff(path.join(root, 'missing.md'), content),
    handoffPayload: payload,
    branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-2',
    packet: packet('a', 'issue-a', '/work/a'),
  }), /artifact/);
  if (SAFE_FD_SUPPORTED) {
    const swap = path.join(root, 'swap.md');
    fs.writeFileSync(swap, content);
    assert.equal(validateContinuationArtifact(
      handoff(swap, content),
      payload,
      null,
      {
        afterOpen() {
          fs.renameSync(swap, `${swap}.old`);
          fs.writeFileSync(swap, content);
        },
      },
    ).valid, false);
  }
});

test('fleet stop preserves handoff obligation but dispatches no continuation', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const root = setRuntimeTemp(t);
  const file = path.join(root, 'handoff.md');
  const payload = handoffPayload();
  const content = handoffContent(payload);
  fs.writeFileSync(file, content);
  const stopped = assigned();
  stopped.control.cancelled = true;
  assert.throws(() => continueWithFreshWorker(stopped, manifest, {
    issue: 'a', reason: 'stalled', handoff: handoff(file, content),
    handoffPayload: payload,
    branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-2',
    packet: packet('a', 'issue-a', '/work/a'),
  }), /continuation dispatch is forbidden/);
});

test('persisted assignment consumes a serialized revision-bound scheduler lease', (t) => {
  const root = path.join(SANDBOX, 'persisted-assignment');
  fs.rmSync(root, { recursive: true, force: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = fleetStatePath(root, 'run');
  persistFleetState(file, state(), 0, manifest, { now: '2026-08-30T00:02:00Z' });
  const assignedState = assignFreshWorkerPersisted(file, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: '/work/a',
    workerContext: 'worker-persisted',
    baseSha: 'base',
    headSha: 'head',
    packet: packet('a', 'issue-a', '/work/a'),
    startedAt: '2026-08-30T00:03:00Z',
  }, { now: '2026-08-30T00:03:01Z' });
  assert.equal(assignedState.revision, 2);
  assert.equal(assignedState.activeCapacity, 1);
  assert.throws(() => assignFreshWorkerPersisted(file, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: '/work/a',
    workerContext: 'worker-race-loser',
    baseSha: 'base',
    headSha: 'head',
    packet: packet('a', 'issue-a', '/work/a'),
  }), /not in current capacity.dispatch|not pending/);
});
