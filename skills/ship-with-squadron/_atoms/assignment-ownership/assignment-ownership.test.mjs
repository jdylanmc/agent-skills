import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  assertFleetState,
  createFleetState,
  fleetStatePath,
  loadFleetState,
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
  validateContinuationHandoff,
} from './assignment-ownership.mjs';
import {
  persistOrchestrationHandoff,
} from '../../../_base/_molecules/persist-orchestration-handoff/persist-orchestration-handoff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SANDBOX = path.join(ROOT, '.test-sandbox', 'ship-with-squadron-handoff');

function source(issue, observedAt = '2026-08-30T00:00:00Z') {
  return {
    invocation: { id: `read-${issue}-${observedAt}`, operation: 'read-issue' },
    provider: 'github', repository: 'owner/repo', issue, revision: `r-${issue}`,
    issueStatus: 'pending', status: 'observed', terminal: true, complete: true, observedAt,
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
  repository: { id: 'owner/repo', root: SANDBOX, baseBranch: 'main' },
  provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge', 'observe-change-request-revision'] },
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
  const verification = [...manifest.validationPolicy];
  const reportContract = {
    summary: 'return confirmed validation evidence',
    requiredEvidence: [...manifest.validationPolicy],
  };
  return {
    schemaVersion: 1,
    manifestDigest: manifest.digest,
    issue,
    sourceRevision: record.sourceRevision,
    acceptanceCriteria: record.acceptanceCriteria,
    scope: record.scope,
    exclusions: manifest.exclusions,
    allowedPaths: record.allowedPaths,
    verification,
    reportContract,
    forbiddenAuthorities: [...FORBIDDEN_AUTHORITIES],
    taskContract: {
      goal: manifest.goal,
      scope: JSON.stringify(record.scope),
      context: JSON.stringify({
        acceptedScope: manifest.acceptedScope,
        humanBoundaries: manifest.humanBoundaries,
        issue,
        repository: manifest.repository.id,
        sourceRevision: record.sourceRevision,
      }),
      acceptance: record.acceptanceCriteria.map((entry) => entry.description),
      verify: verification.join('\n'),
      timebox: JSON.stringify({ cost: 10, retries: 2, timeMinutes: 60 }),
      forbidden: FORBIDDEN_AUTHORITIES.join('\n'),
      report: JSON.stringify({
        requiredEvidence: reportContract.requiredEvidence,
        summary: reportContract.summary,
      }),
      standing: 'one-issue-one-branch-one-worktree-no-adjacent-work',
    },
    branch,
    worktree,
    baseSha: 'base',
    headSha: 'head',
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
  const original = packet('a', 'issue-a', '/work/a');
  const inputs = [
    ['issue', 'a'],
    ['prior_generation', '1'],
    ['branch', 'issue-a'],
    ['worktree', '/work/a'],
    ['base_sha', 'base'],
    ['head_sha', 'head'],
    ['manifest_digest', manifest.digest],
    ['source_revision', 'r-a'],
    ['allowed_paths', JSON.stringify(['src/a/**'])],
    ['state_revision', '0'],
  ].map(([name, value]) => ({ name, value, source: 'fleet-state' }));
  return {
    schema_version: 1,
    run_identity: { run_id: 'run', root_skill: 'ship-with-squadron' },
    source_agent: { id: 'worker-1', role: 'implementation worker' },
    target_agent: { id: target, role: 'continuation worker', invocation_reason: 'stalled' },
    task_contract: {
      goal: original.taskContract.goal,
      scope: original.taskContract.scope,
      context: original.taskContract.context,
      verify: original.taskContract.verify,
      timebox: original.taskContract.timebox,
      forbidden: original.taskContract.forbidden,
      report: original.taskContract.report,
      standing: original.taskContract.standing,
    },
    inputs,
    constraints: ['no remote mutation'],
    assumptions: [],
    artifacts_and_references: [],
    acceptance_criteria: original.taskContract.acceptance,
    open_questions: [],
  };
}

function handoffContent(payload = handoffPayload()) {
  return [
    '# Orchestration Handoff',
    '## Goal',
    'Create a safe orchestration handoff.',
    'GOAL', payload.task_contract.goal,
    'SCOPE', payload.task_contract.scope,
    'CONTEXT', payload.task_contract.context,
    'ACCEPTANCE', payload.acceptance_criteria.join('\n'),
    'VERIFY', payload.task_contract.verify,
    'TIMEBOX', payload.task_contract.timebox,
    'FORBIDDEN', payload.task_contract.forbidden,
    'REPORT', payload.task_contract.report,
    'STANDING', payload.task_contract.standing,
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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
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
  assert.throws(() => assignFreshWorker(fresh, manifest, {
    issue: 'a', branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-1',
    baseSha: 'base', headSha: 'head',
    packet: {
      ...packet('a', 'issue-a', '/work/a'),
      verification: ['run-ci'],
    },
    schedulerLease: createSchedulerLease(fresh, manifest, 'a'),
  }), /exactly match confirmed validation policy/);
  assert.throws(() => assignFreshWorker(fresh, manifest, {
    issue: 'a', branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-1',
    baseSha: 'base', headSha: 'head',
    packet: { ...packet('a', 'issue-a', '/work/a'), extraAuthority: 'publish-anywhere' },
    schedulerLease: createSchedulerLease(fresh, manifest, 'a'),
  }), /schema is not exact/);
  const stale = state();
  const staleLease = createSchedulerLease(stale, manifest, 'a');
  stale.revision += 1;
  assert.throws(() => assignFreshWorker(stale, manifest, {
    issue: 'a', branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-1',
    baseSha: 'base', headSha: 'head', packet: packet('a', 'issue-a', '/work/a'),
    schedulerLease: staleLease,
  }), /scheduler lease/);
  const mutatedManifest = structuredClone(manifest);
  mutatedManifest.goal = 'retained digest with mutated authority';
  assert.throws(() => assignFreshWorker(fresh, mutatedManifest, {
    issue: 'a', branch: 'issue-a', worktree: '/work/a', workerContext: 'worker-1',
    baseSha: 'base', headSha: 'head', packet: packet('a', 'issue-a', '/work/a'),
    schedulerLease: createSchedulerLease(fresh, manifest, 'a'),
  }), /manifest digest does not match authority fields/);
});

test('continues only after rereading actual orchestration-handoff persistence output', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const root = setRuntimeTemp(t);
  const payload = handoffPayload();
  const persisted = persistOrchestrationHandoff(payload, {
    now: new Date('2026-08-30T00:02:30Z'),
  });
  const continued = continueWithFreshWorker(assigned(), manifest, {
    issue: 'a',
    reason: 'stalled',
    handoff: persisted,
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
  assert.equal(
    continued.issues.a.continuationChain[0].handoff.identity.targetAgent,
    'worker-2',
  );
  assert.match(
    continued.issues.a.continuationChain[0].handoff.artifactSha256,
    /^[a-f0-9]{64}$/,
  );
  assert.doesNotThrow(() => assertFleetState(continued, manifest));
  const forgedBinding = structuredClone(continued);
  const archivedHandoff = forgedBinding.issues.a.continuationChain[0].handoff;
  archivedHandoff.bindingRecord.inputs[0].value = 'b';
  archivedHandoff.bindingsSha256 = crypto.createHash('sha256')
    .update(JSON.stringify(stable(archivedHandoff.bindingRecord)))
    .digest('hex');
  assert.throws(
    () => assertFleetState(forgedBinding, manifest),
    /handoff binding inputs are invalid/,
  );
  assert.equal(validateContinuationArtifact(persisted, payload, {
    runId: 'run', issue: 'a', priorGeneration: 1, branch: 'issue-a', worktree: '/work/a',
    sourceAgent: 'worker-1', targetAgent: 'worker-2', baseSha: 'base', headSha: 'head',
    manifestDigest: manifest.digest, sourceRevision: 'r-a',
    allowedPaths: JSON.stringify(['src/a/**']),
    stateRevision: 0, acceptanceCriteria: ['done'],
    taskContract: packet('a', 'issue-a', '/work/a').taskContract,
  }).valid, true);
  const expectedContinuation = {
    runId: 'run', issue: 'a', priorGeneration: 1, branch: 'issue-a', worktree: '/work/a',
    sourceAgent: 'worker-1', targetAgent: 'worker-2', baseSha: 'base', headSha: 'head',
    manifestDigest: manifest.digest, sourceRevision: 'r-a',
    allowedPaths: JSON.stringify(['src/a/**']),
    stateRevision: 0, acceptanceCriteria: ['done'],
    taskContract: packet('a', 'issue-a', '/work/a').taskContract,
  };
  assert.equal(
    validateContinuationArtifact(
      persisted,
      payload,
      expectedContinuation,
      { forcePortableFallback: true },
    ).valid,
    true,
  );
  const expandedScope = structuredClone(payload);
  expandedScope.task_contract.scope = JSON.stringify(['issue a', 'adjacent issue']);
  assert.equal(
    validateContinuationHandoff(persisted, expandedScope, expectedContinuation).valid,
    false,
  );
  const expandedAuthority = structuredClone(payload);
  expandedAuthority.task_contract.forbidden = 'merge permitted';
  assert.equal(
    validateContinuationHandoff(persisted, expandedAuthority, expectedContinuation).valid,
    false,
  );
  assert.equal(validateContinuationArtifact(
    persisted,
    { ...payload, synthetic_result_fields: true },
  ).valid, false);
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
  const swap = path.join(root, 'swap.md');
  fs.writeFileSync(swap, content);
  assert.equal(validateContinuationArtifact(
    handoff(swap, content),
    payload,
    null,
    {
      afterOpen() {
        fs.writeFileSync(swap, `${content}changed`);
      },
    },
  ).valid, false);
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
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(SANDBOX, 'run');
  persistFleetState(file, state(), 0, manifest, { now: '2026-08-30T00:02:00Z' });
  const persistedState = loadFleetState(file, manifest);
  const schedulerLease = createSchedulerLease(persistedState, manifest, 'a');
  const assignedState = assignFreshWorkerPersisted(file, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: '/work/a',
    workerContext: 'worker-persisted',
    baseSha: 'base',
    headSha: 'head',
    packet: packet('a', 'issue-a', '/work/a'),
    schedulerLease,
    startedAt: '2026-08-30T00:03:00Z',
  }, { now: '2026-08-30T00:03:01Z' });
  assert.equal(assignedState.revision, 2);
  assert.equal(assignedState.activeCapacity, 1);
  assert.throws(() => assignFreshWorkerPersisted(file, manifest, {
    issue: 'b',
    branch: 'issue-b',
    worktree: '/work/b',
    workerContext: 'worker-without-lease',
    baseSha: 'base',
    headSha: 'head',
    packet: packet('b', 'issue-b', '/work/b'),
  }), /requires a state-revision-bound scheduler lease/);
  assert.throws(() => assignFreshWorkerPersisted(file, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: '/work/a',
    workerContext: 'worker-race-loser',
    baseSha: 'base',
    headSha: 'head',
    packet: packet('a', 'issue-a', '/work/a'),
    schedulerLease,
  }), /state revision conflict|not in current capacity.dispatch|not pending/);
});
