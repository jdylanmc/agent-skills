import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
  releaseAfterValidatedHandoff,
  validateContinuationArtifact,
  validateContinuationHandoff,
} from './assignment-ownership.mjs';
import {
  persistOrchestrationHandoff,
} from '../../../_base/_molecules/persist-orchestration-handoff/persist-orchestration-handoff.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SANDBOX = path.join(ROOT, '.test-sandbox', 'ship-with-squadron-handoff');
const REPOSITORY = path.join(SANDBOX, 'repository');
const WORKTREE_A = path.join(SANDBOX, 'worktrees', 'a');
const WORKTREE_B = path.join(SANDBOX, 'worktrees', 'b');
let revisionSha = null;

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
  repository: { id: 'owner/repo', root: REPOSITORY, baseBranch: 'main' },
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

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function ensureGitWorktrees() {
  if (fs.existsSync(path.join(REPOSITORY, '.git'))) {
    revisionSha ??= git(REPOSITORY, 'rev-parse', 'main');
    return;
  }
  fs.mkdirSync(REPOSITORY, { recursive: true });
  git(REPOSITORY, 'init', '-b', 'main');
  fs.writeFileSync(path.join(REPOSITORY, 'seed.txt'), 'seed\n');
  git(REPOSITORY, '-c', 'user.name=Test', '-c', 'user.email=test-identity', 'add', 'seed.txt');
  git(REPOSITORY, '-c', 'user.name=Test', '-c', 'user.email=test-identity', 'commit', '-m', 'seed');
  fs.mkdirSync(path.dirname(WORKTREE_A), { recursive: true });
  git(REPOSITORY, 'worktree', 'add', '-b', 'issue-a', WORKTREE_A);
  git(REPOSITORY, 'worktree', 'add', '-b', 'issue-b', WORKTREE_B);
  revisionSha = git(REPOSITORY, 'rev-parse', 'main');
}

function currentRevision() {
  ensureGitWorktrees();
  return revisionSha;
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
    baseSha: currentRevision(),
    headSha: currentRevision(),
  };
}

function assigned() {
  ensureGitWorktrees();
  const current = state();
  return assignFreshWorker(current, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: WORKTREE_A,
    workerContext: 'worker-1',
    baseSha: currentRevision(),
    headSha: currentRevision(),
    packet: packet('a', 'issue-a', WORKTREE_A),
    schedulerLease: createSchedulerLease(current, manifest, 'a'),
    startedAt: '2026-08-30T00:02:00Z',
  });
}

function handoffPayload(target = 'worker-2') {
  const original = packet('a', 'issue-a', WORKTREE_A);
  const inputs = [
    ['issue', 'a'],
    ['prior_generation', '1'],
    ['branch', 'issue-a'],
    ['worktree', WORKTREE_A],
    ['base_sha', currentRevision()],
    ['head_sha', currentRevision()],
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
  ensureGitWorktrees();
  const current = assigned();
  assert.equal(current.issues.a.status, 'active');
  assert.equal(current.issues.a.assignment.generation, 1);
  assert.throws(() => assignFreshWorker(current, manifest, {
    issue: 'b', branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-2',
    baseSha: currentRevision(), headSha: currentRevision(), packet: packet('b', 'issue-a', WORKTREE_A),
    schedulerLease: createSchedulerLease(current, manifest, 'b'),
  }), /branch already owned/);
  const fresh = state();
  const forgedRevisionPacket = {
    ...packet('a', 'issue-a', WORKTREE_A),
    headSha: 'f'.repeat(40),
  };
  assert.throws(() => assignFreshWorker(fresh, manifest, {
    issue: 'a', branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-sha',
    baseSha: currentRevision(), headSha: 'f'.repeat(40),
    packet: forgedRevisionPacket,
    schedulerLease: createSchedulerLease(fresh, manifest, 'a'),
  }), /head revision does not match/);
  assert.throws(() => assignFreshWorker(fresh, manifest, {
    issue: 'a', branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-1',
    baseSha: currentRevision(), headSha: currentRevision(),
    packet: { ...packet('a', 'issue-a', WORKTREE_A), forbiddenAuthorities: ['merge'] },
    schedulerLease: createSchedulerLease(fresh, manifest, 'a'),
  }), /forbidden authorities/);
  assert.throws(() => assignFreshWorker(fresh, manifest, {
    issue: 'a', branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-1',
    baseSha: currentRevision(), headSha: currentRevision(),
    packet: {
      ...packet('a', 'issue-a', WORKTREE_A),
      verification: ['run-ci'],
    },
    schedulerLease: createSchedulerLease(fresh, manifest, 'a'),
  }), /exactly match confirmed validation policy/);
  assert.throws(() => assignFreshWorker(fresh, manifest, {
    issue: 'a', branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-1',
    baseSha: currentRevision(), headSha: currentRevision(),
    packet: { ...packet('a', 'issue-a', WORKTREE_A), extraAuthority: 'publish-anywhere' },
    schedulerLease: createSchedulerLease(fresh, manifest, 'a'),
  }), /schema is not exact/);
  const stale = state();
  const staleLease = createSchedulerLease(stale, manifest, 'a');
  stale.revision += 1;
  assert.throws(() => assignFreshWorker(stale, manifest, {
    issue: 'a', branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-1',
    baseSha: currentRevision(), headSha: currentRevision(), packet: packet('a', 'issue-a', WORKTREE_A),
    schedulerLease: staleLease,
  }), /scheduler lease/);
  const mutatedManifest = structuredClone(manifest);
  mutatedManifest.goal = 'retained digest with mutated authority';
  assert.throws(() => assignFreshWorker(fresh, mutatedManifest, {
    issue: 'a', branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-1',
    baseSha: currentRevision(), headSha: currentRevision(), packet: packet('a', 'issue-a', WORKTREE_A),
    schedulerLease: createSchedulerLease(fresh, manifest, 'a'),
  }), /manifest digest does not match authority fields/);
});

test('uses canonical filesystem identity for worktrees and rejects aliases', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  ensureGitWorktrees();
  const current = state();
  const dotAlias = `${path.dirname(WORKTREE_A)}${path.sep}.${path.sep}${path.basename(WORKTREE_A)}`;
  assert.throws(() => assignFreshWorker(current, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: dotAlias,
    workerContext: 'worker-dot',
    baseSha: currentRevision(),
    headSha: currentRevision(),
    packet: packet('a', 'issue-a', dotAlias),
    schedulerLease: createSchedulerLease(current, manifest, 'a'),
  }), /dot segments/);

  const linked = path.join(SANDBOX, 'worktrees', 'linked-a');
  try {
    fs.symlinkSync(WORKTREE_A, linked, 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.diagnostic('runner cannot create directory symlinks');
    } else {
      throw error;
    }
  }
  if (fs.existsSync(linked)) {
    assert.throws(() => assignFreshWorker(current, manifest, {
      issue: 'a',
      branch: 'issue-a',
      worktree: linked,
      workerContext: 'worker-link',
      baseSha: currentRevision(),
      headSha: currentRevision(),
      packet: packet('a', 'issue-a', linked),
      schedulerLease: createSchedulerLease(current, manifest, 'a'),
    }), /symbolic link/);
  }

  const caseAlias = path.join(path.dirname(WORKTREE_A), path.basename(WORKTREE_A).toUpperCase());
  try {
    const original = fs.statSync(WORKTREE_A);
    const alternate = fs.statSync(caseAlias);
    if (original.dev === alternate.dev && original.ino === alternate.ino && caseAlias !== WORKTREE_A) {
      assert.throws(() => assignFreshWorker(current, manifest, {
        issue: 'a',
        branch: 'issue-a',
        worktree: caseAlias,
        workerContext: 'worker-case',
        baseSha: currentRevision(),
        headSha: currentRevision(),
        packet: packet('a', 'issue-a', caseAlias),
        schedulerLease: createSchedulerLease(current, manifest, 'a'),
      }), /canonical path spelling/);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  assert.throws(() => assignFreshWorker(current, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: REPOSITORY,
    workerContext: 'worker-new',
    baseSha: currentRevision(),
    headSha: currentRevision(),
    packet: packet('a', 'issue-a', REPOSITORY),
    schedulerLease: createSchedulerLease(current, manifest, 'a'),
  }), /manifest repository root|primary checkout/);
  const notYetCreated = path.join(SANDBOX, 'worktrees', 'not-yet-created');
  assert.throws(() => assignFreshWorker(current, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: notYetCreated,
    workerContext: 'worker-reserved',
    baseSha: currentRevision(),
    headSha: currentRevision(),
    packet: packet('a', 'issue-a', notYetCreated),
    schedulerLease: createSchedulerLease(current, manifest, 'a'),
  }), /does not exist/);
  const regularFile = path.join(SANDBOX, 'regular-file');
  fs.writeFileSync(regularFile, 'not a worktree');
  assert.throws(() => assignFreshWorker(current, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: regularFile,
    workerContext: 'worker-file',
    baseSha: currentRevision(),
    headSha: currentRevision(),
    packet: packet('a', 'issue-a', regularFile),
    schedulerLease: createSchedulerLease(current, manifest, 'a'),
  }), /real directory/);
});

test('rejects delete-and-recreate of an assigned worktree at the same path', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const current = assigned();
  git(REPOSITORY, 'worktree', 'remove', '--force', WORKTREE_A);
  git(REPOSITORY, 'worktree', 'add', WORKTREE_A, 'issue-a');
  assert.throws(
    () => assertFleetState(current, manifest),
    /persisted worktree filesystem or Git identity changed/,
  );
});

test('rejects continuation and release after the assigned Git HEAD moves', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const current = assigned();
  fs.writeFileSync(path.join(WORKTREE_A, 'worker-change.txt'), 'changed\n');
  git(WORKTREE_A, 'add', 'worker-change.txt');
  git(WORKTREE_A, '-c', 'user.name=Test', '-c', 'user.email=test-identity',
    'commit', '-m', 'worker changed head');
  const continuation = {
    issue: 'a',
    reason: 'stalled',
    branch: 'issue-a',
    worktree: WORKTREE_A,
    workerContext: 'worker-2',
    packet: packet('a', 'issue-a', WORKTREE_A),
    handoff: null,
    handoffPayload: null,
  };
  assert.throws(
    () => continueWithFreshWorker(current, manifest, continuation),
    /head revision no longer matches/,
  );
  assert.throws(() => releaseAfterValidatedHandoff(current, manifest, {
    issue: 'a',
    reason: 'stalled',
    targetAgent: 'fleet-owner',
    handoff: null,
    handoffPayload: null,
  }), /head revision no longer matches/);
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
    worktree: WORKTREE_A,
    workerContext: 'worker-2',
    packet: packet('a', 'issue-a', WORKTREE_A),
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
    runId: 'run', issue: 'a', priorGeneration: 1, branch: 'issue-a', worktree: WORKTREE_A,
    sourceAgent: 'worker-1', targetAgent: 'worker-2',
    baseSha: currentRevision(), headSha: currentRevision(),
    manifestDigest: manifest.digest, sourceRevision: 'r-a',
    allowedPaths: JSON.stringify(['src/a/**']),
    stateRevision: 0, acceptanceCriteria: ['done'],
    taskContract: packet('a', 'issue-a', WORKTREE_A).taskContract,
  }).valid, true);
  const expectedContinuation = {
    runId: 'run', issue: 'a', priorGeneration: 1, branch: 'issue-a', worktree: WORKTREE_A,
    sourceAgent: 'worker-1', targetAgent: 'worker-2',
    baseSha: currentRevision(), headSha: currentRevision(),
    manifestDigest: manifest.digest, sourceRevision: 'r-a',
    allowedPaths: JSON.stringify(['src/a/**']),
    stateRevision: 0, acceptanceCriteria: ['done'],
    taskContract: packet('a', 'issue-a', WORKTREE_A).taskContract,
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
  const originalContent = fs.readFileSync(persisted.path, 'utf8');
  const tamperedContent = originalContent.replace('deliver', 'altered');
  assert.equal(Buffer.byteLength(tamperedContent), Buffer.byteLength(originalContent));
  fs.writeFileSync(persisted.path, tamperedContent);
  assert.equal(
    validateContinuationArtifact(persisted, payload, expectedContinuation).valid,
    false,
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

test('releases ownership only through a reread validated orchestration handoff', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  setRuntimeTemp(t);
  const payload = handoffPayload('fleet-owner');
  const persisted = persistOrchestrationHandoff(payload, {
    now: new Date('2026-08-30T00:02:30Z'),
  });
  const released = releaseAfterValidatedHandoff(assigned(), manifest, {
    issue: 'a',
    reason: 'stalled',
    targetAgent: 'fleet-owner',
    handoff: persisted,
    handoffPayload: payload,
    endedAt: '2026-08-30T00:02:59Z',
  });
  assert.equal(released.issues.a.status, 'blocked');
  assert.equal(released.issues.a.assignment, null);
  assert.equal(released.issues.a.handoffObligation, null);
  assert.equal(released.issues.a.continuationChain.at(-1).endReason, 'stalled');
  assert.equal(
    released.issues.a.continuationChain.at(-1).handoff.identity.targetAgent,
    'fleet-owner',
  );
  assert.doesNotThrow(() => assertFleetState(released, manifest));

  const timedOutState = assigned();
  timedOutState.reShepherdQueue.push({
    issue: 'a',
    action: 'await-safe-ownership-transition',
    blocker: 'active-assignment-revision-transition-required',
    revisionObservation: { baseSha: 'new-base', headSha: 'new-head' },
  });
  const timedOut = releaseAfterValidatedHandoff(timedOutState, manifest, {
    issue: 'a',
    reason: 'timed-out',
    targetAgent: 'fleet-owner',
    handoff: persisted,
    handoffPayload: payload,
    endedAt: '2026-08-30T00:03:00Z',
  });
  assert.equal(timedOut.issues.a.status, 'timed-out');
  assert.equal(timedOut.issues.a.terminalDisposition, 'timed-out-with-handoff');
  assert.equal(timedOut.issues.a.checkActivity, null);
  assert.equal(timedOut.reShepherdQueue.some((entry) => entry.issue === 'a'), false);

  const forged = structuredClone(persisted);
  forged.bytes += 1;
  assert.throws(() => releaseAfterValidatedHandoff(assigned(), manifest, {
    issue: 'a',
    reason: 'timed-out',
    targetAgent: 'fleet-owner',
    handoff: forged,
    handoffPayload: payload,
  }), /invalid orchestration handoff artifact/);
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
    branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-2',
    packet: packet('a', 'issue-a', WORKTREE_A),
  }), /runtime-trusted handoff directory/);
  assert.throws(() => continueWithFreshWorker(assigned(), manifest, {
    issue: 'a', reason: 'stalled',
    handoff: handoff(path.join(root, 'missing.md'), content),
    handoffPayload: payload,
    branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-2',
    packet: packet('a', 'issue-a', WORKTREE_A),
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
    branch: 'issue-a', worktree: WORKTREE_A, workerContext: 'worker-2',
    packet: packet('a', 'issue-a', WORKTREE_A),
  }), /continuation dispatch is forbidden/);
});

test('persisted assignment consumes a serialized revision-bound scheduler lease', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  ensureGitWorktrees();
  const file = fleetStatePath(REPOSITORY, 'run');
  persistFleetState(file, state(), 0, manifest, { now: '2026-08-30T00:02:00Z' });
  const persistedState = loadFleetState(file, manifest);
  const schedulerLease = createSchedulerLease(persistedState, manifest, 'a');
  const assignedState = assignFreshWorkerPersisted(file, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: WORKTREE_A,
    workerContext: 'worker-persisted',
    baseSha: currentRevision(),
    headSha: currentRevision(),
    packet: packet('a', 'issue-a', WORKTREE_A),
    schedulerLease,
    startedAt: '2026-08-30T00:03:00Z',
  }, { now: '2026-08-30T00:03:01Z' });
  assert.equal(assignedState.revision, 2);
  assert.equal(assignedState.activeCapacity, 1);
  assert.throws(() => assignFreshWorkerPersisted(file, manifest, {
    issue: 'b',
    branch: 'issue-b',
    worktree: WORKTREE_B,
    workerContext: 'worker-without-lease',
    baseSha: currentRevision(),
    headSha: currentRevision(),
    packet: packet('b', 'issue-b', WORKTREE_B),
  }), /requires a state-revision-bound scheduler lease/);
  assert.throws(() => assignFreshWorkerPersisted(file, manifest, {
    issue: 'a',
    branch: 'issue-a',
    worktree: WORKTREE_A,
    workerContext: 'worker-race-loser',
    baseSha: currentRevision(),
    headSha: currentRevision(),
    packet: packet('a', 'issue-a', WORKTREE_A),
    schedulerLease,
  }), /state revision conflict|not in current capacity.dispatch|not pending/);
});
