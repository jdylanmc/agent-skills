import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  assertFleetState,
  cancelFleet,
  consumeBudget,
  createFleetState,
  fleetStatePath,
  loadFleetState,
  persistFleetState,
  recordSourceRevisionObservation,
  transitionIssue,
} from './fleet-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SANDBOX = path.join(ROOT, '.test-sandbox', 'ship-with-squadron-state');
const MODULE = pathToFileURL(fileURLToPath(new URL('./fleet-state.mjs', import.meta.url))).href;
const WORKTREE = path.join(SANDBOX, 'worktrees', 'issue-1');

function receipt(observedAt = '2026-08-30T00:00:00Z') {
  return {
    invocation: { id: `read-${observedAt}`, operation: 'read-issue' },
    provider: 'github', repository: 'owner/repo', issue: '1', revision: 'r1',
    issueStatus: 'pending', status: 'observed', terminal: true, complete: true, observedAt,
  };
}

const manifest = normalizeFleetManifest({
  confirmation: 'confirmed',
  goal: 'deliver',
  acceptedScope: [],
  exclusions: [],
  humanDecisions: [],
  issues: [{
    identity: '1',
    sourceRevision: 'r1',
    sourceReceipt: receipt(),
    acceptanceCriteria: ['done'],
    scope: [],
    allowedPaths: ['src/**'],
  }],
  dependencies: [],
  concurrency: 1,
  budget: { cost: 1, timeMinutes: 10, retries: 2 },
  repository: { id: 'owner/repo', root: SANDBOX, baseBranch: 'main' },
  provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge', 'observe-change-request-revision'] },
  validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
  stopConditions: ['cancelled'],
  humanBoundaries: ['human merge'],
  shepherdIntent: 'yes',
});

function activeState(runId) {
  const current = createFleetState(manifest, runId, '2026-08-30T00:00:00Z');
  const issue = manifest.issues[0];
  const verification = [...manifest.validationPolicy];
  const reportContract = {
    summary: 'return confirmed validation evidence',
    requiredEvidence: verification,
  };
  const packet = {
    schemaVersion: 1,
    manifestDigest: manifest.digest,
    issue: issue.identity,
    sourceRevision: issue.sourceRevision,
    acceptanceCriteria: issue.acceptanceCriteria,
    scope: issue.scope,
    exclusions: manifest.exclusions,
    allowedPaths: issue.allowedPaths,
    verification,
    reportContract,
    forbiddenAuthorities: [
      'merge', 'approve', 'enable-auto-merge', 'accept-risk', 'force-push',
      'close-tracker-work', 'select-adjacent-work',
    ],
    taskContract: {
      goal: manifest.goal,
      scope: JSON.stringify(issue.scope),
      context: JSON.stringify({
        acceptedScope: manifest.acceptedScope,
        humanBoundaries: manifest.humanBoundaries,
        issue: issue.identity,
        repository: manifest.repository.id,
        sourceRevision: issue.sourceRevision,
      }),
      acceptance: issue.acceptanceCriteria.map((entry) => entry.description),
      verify: verification.join('\n'),
      timebox: JSON.stringify({ cost: 1, retries: 2, timeMinutes: 10 }),
      forbidden: [
        'merge', 'approve', 'enable-auto-merge', 'accept-risk', 'force-push',
        'close-tracker-work', 'select-adjacent-work',
      ].join('\n'),
      report: JSON.stringify({
        requiredEvidence: verification,
        summary: reportContract.summary,
      }),
      standing: 'one-issue-one-branch-one-worktree-no-adjacent-work',
    },
    branch: 'issue-1',
    worktree: WORKTREE,
    baseSha: 'base',
    headSha: 'head',
  };
  Object.assign(current.issues['1'], {
    dependencyState: 'active',
    assignment: {
      generation: 1,
      workerContext: 'worker-1',
      branch: 'issue-1',
      worktree: WORKTREE,
      baseSha: 'base',
      headSha: 'head',
      packet,
      active: true,
      startedAt: '2026-08-30T00:01:00Z',
    },
    branch: 'issue-1',
    worktree: WORKTREE,
    baseSha: 'base',
    headSha: 'head',
    status: 'active',
  });
  current.activeCapacity = 1;
  return current;
}

function writeLock(lockDirectory, metadata, modifiedAt = null) {
  fs.mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const owner = path.join(lockDirectory, `owner-${metadata.token}.json`);
  fs.writeFileSync(owner, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
  if (modifiedAt) fs.utimesSync(owner, modifiedAt, modifiedAt);
  return owner;
}

function readLock(lockDirectory) {
  const owner = fs.readdirSync(lockDirectory).find((entry) => entry.startsWith('owner-'));
  return JSON.parse(fs.readFileSync(path.join(lockDirectory, owner), 'utf8'));
}

test('persists, rereads, validates schema, and compare-and-swaps run state', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(SANDBOX, 'run-1');
  const initial = createFleetState(manifest, 'run-1', '2026-08-30T00:00:00Z');
  const written = persistFleetState(file, initial, 0, manifest, { now: '2026-08-30T00:00:01Z' });
  assert.equal(written.revision, 1);
  assert.equal(loadFleetState(file, manifest).issues['1'].sourceRevision, 'r1');
  assert.throws(() => persistFleetState(file, initial, 0, manifest), /revision conflict/);
  assert.throws(() => persistFleetState(file, written, 1), /manifest is required/);
});

test('serializes a multiprocess revision race so only one writer wins', async (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  fs.mkdirSync(SANDBOX, { recursive: true });
  const file = fleetStatePath(SANDBOX, 'race');
  const manifestFile = path.join(SANDBOX, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  persistFleetState(file, createFleetState(manifest, 'race'), 0, manifest);
  const go = path.join(SANDBOX, 'go');
  const script = `
    import fs from 'node:fs';
    import { loadFleetState, persistFleetState } from ${JSON.stringify(MODULE)};
    const [file, manifestFile, ready, go] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const state = loadFleetState(file, manifest);
    fs.writeFileSync(ready, 'ready');
    while (!fs.existsSync(go)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    try {
      persistFleetState(file, state, state.revision, manifest);
      process.stdout.write('won');
    } catch (error) {
      process.stdout.write('lost:' + error.message);
    }
  `;
  const run = (name) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script, file, manifestFile, path.join(SANDBOX, name), go], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
  const first = run('ready-1');
  const second = run('ready-2');
  while (!fs.existsSync(path.join(SANDBOX, 'ready-1')) || !fs.existsSync(path.join(SANDBOX, 'ready-2'))) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  fs.writeFileSync(go, 'go');
  const outcomes = await Promise.all([first, second]);
  assert.equal(outcomes.filter((value) => value === 'won').length, 1);
  assert.equal(outcomes.filter((value) => value.startsWith('lost:state revision conflict')).length, 1);
  assert.equal(loadFleetState(file, manifest).revision, 2);
});

test('recovers a crash-stale ownership-bound lock before the exclusive revision recheck', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(SANDBOX, 'stale-lock');
  const initial = createFleetState(manifest, 'stale-lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = new Date('2020-01-01T00:00:00Z');
  writeLock(`${file}.lock`, {
    pid: 99999999,
    token: 'a'.repeat(48),
    expectedRevision: 0,
    createdAt: '2020-01-01T00:00:00Z',
  }, old);
  const written = persistFleetState(file, initial, 0, manifest, { staleLockMs: 0 });
  assert.equal(written.revision, 1);
  assert.equal(fs.existsSync(`${file}.lock`), false);
});

test('recovers stale ownerless and malformed locks without deleting a live replacement', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const old = new Date('2020-01-01T00:00:00Z');
  for (const kind of ['ownerless', 'malformed']) {
    const file = fleetStatePath(SANDBOX, `${kind}-lock`);
    const lock = `${file}.lock`;
    fs.mkdirSync(lock, { recursive: true, mode: 0o700 });
    if (kind === 'malformed') {
      fs.writeFileSync(path.join(lock, `owner-${'9'.repeat(48)}.json`), '{broken-json', {
        mode: 0o600,
      });
    }
    fs.utimesSync(lock, old, old);
    const written = persistFleetState(file, createFleetState(manifest, `${kind}-lock`), 0, manifest, {
      staleLockMs: 0,
    });
    assert.equal(written.revision, 1);
    assert.equal(fs.existsSync(lock), false);
  }

  const raceFile = fleetStatePath(SANDBOX, 'malformed-race');
  const raceLock = `${raceFile}.lock`;
  fs.mkdirSync(raceLock, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(raceLock, `owner-${'7'.repeat(48)}.json`), '{broken-json', {
    mode: 0o600,
  });
  fs.utimesSync(raceLock, old, old);
  const replacement = {
    pid: process.pid,
    token: '8'.repeat(48),
    expectedRevision: 0,
    createdAt: new Date().toISOString(),
  };
  assert.throws(() => persistFleetState(
    raceFile,
    createFleetState(manifest, 'malformed-race'),
    0,
    manifest,
    {
      staleLockMs: 0,
      lockAttempts: 1,
      beforeMalformedLockClaim() {
        fs.rmSync(raceLock, { recursive: true });
        writeLock(raceLock, replacement);
      },
    },
  ), /write lock is busy/);
  assert.deepEqual(readLock(raceLock), replacement);
});

test('never deletes a replacement lock during stale cleanup or release races', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const staleFile = fleetStatePath(SANDBOX, 'stale-race');
  fs.mkdirSync(path.dirname(staleFile), { recursive: true });
  const old = new Date('2020-01-01T00:00:00Z');
  writeLock(`${staleFile}.lock`, {
    pid: 99999999,
    token: 'b'.repeat(48),
    expectedRevision: 0,
    createdAt: '2020-01-01T00:00:00Z',
  }, old);
  const replacement = {
    pid: process.pid,
    token: 'c'.repeat(48),
    expectedRevision: 0,
    createdAt: new Date().toISOString(),
  };
  assert.throws(() => persistFleetState(
    staleFile,
    createFleetState(manifest, 'stale-race'),
    0,
    manifest,
    {
      staleLockMs: 0,
      lockAttempts: 1,
      beforeStaleLockClaim() {
        fs.rmSync(`${staleFile}.lock`, { recursive: true });
        writeLock(`${staleFile}.lock`, replacement);
      },
    },
  ), /write lock is busy/);
  assert.deepEqual(readLock(`${staleFile}.lock`), replacement);

  const releaseFile = fleetStatePath(SANDBOX, 'release-race');
  const releaseReplacement = {
    pid: process.pid,
    token: 'd'.repeat(48),
    expectedRevision: 1,
    createdAt: new Date().toISOString(),
  };
  persistFleetState(
    releaseFile,
    createFleetState(manifest, 'release-race'),
    0,
    manifest,
    {
      beforeReleaseLockClaim() {
        fs.rmSync(`${releaseFile}.lock`, { recursive: true });
        writeLock(`${releaseFile}.lock`, releaseReplacement);
      },
    },
  );
  assert.deepEqual(readLock(`${releaseFile}.lock`), releaseReplacement);
});

test('multiprocess stale reclamation never removes a replacement live lock', async (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(SANDBOX, 'stale-multiprocess');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = new Date('2020-01-01T00:00:00Z');
  writeLock(`${file}.lock`, {
    pid: 99999999,
    token: 'e'.repeat(48),
    expectedRevision: 0,
    createdAt: old.toISOString(),
  }, old);
  const manifestFile = path.join(SANDBOX, 'stale-manifest.json');
  const ready = path.join(SANDBOX, 'stale-ready');
  const proceed = path.join(SANDBOX, 'stale-proceed');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const script = `
    import fs from 'node:fs';
    import { createFleetState, persistFleetState } from ${JSON.stringify(MODULE)};
    const [file, manifestFile, ready, proceed] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    try {
      persistFleetState(file, createFleetState(manifest, 'stale-multiprocess'), 0, manifest, {
        staleLockMs: 0,
        lockAttempts: 1,
        beforeStaleLockClaim() {
          fs.writeFileSync(ready, 'ready');
          while (!fs.existsSync(proceed)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
        },
      });
      process.stdout.write('unexpected-success');
    } catch (error) {
      process.stdout.write(error.message);
    }
  `;
  const childResult = new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--input-type=module', '-e', script, file, manifestFile, ready, proceed,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });
  while (!fs.existsSync(ready)) await new Promise((resolve) => setTimeout(resolve, 5));
  fs.rmSync(`${file}.lock`, { recursive: true });
  const replacement = {
    pid: process.pid,
    token: 'f'.repeat(48),
    expectedRevision: 0,
    createdAt: new Date().toISOString(),
  };
  writeLock(`${file}.lock`, replacement);
  fs.writeFileSync(proceed, 'proceed');
  assert.match(await childResult, /write lock is busy/);
  assert.deepEqual(readLock(`${file}.lock`), replacement);
});

test('rejects symlinks anywhere in the fleet-state directory ancestry', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const real = path.join(SANDBOX, 'real');
  const linked = path.join(SANDBOX, 'linked');
  fs.mkdirSync(real, { recursive: true });
  try {
    fs.symlinkSync(real, linked, 'dir');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('runner cannot create directory symlinks');
      return;
    }
    throw error;
  }
  const file = fleetStatePath(linked, 'symlink-run');
  const linkedManifest = normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: manifest.goal,
    acceptedScope: manifest.acceptedScope,
    exclusions: manifest.exclusions,
    dependencies: manifest.dependencies,
    concurrency: manifest.concurrency,
    budget: manifest.budget,
    repository: { ...manifest.repository, root: linked },
    provider: manifest.provider,
    validationPolicy: manifest.validationPolicy,
    stopConditions: manifest.stopConditions,
    humanBoundaries: manifest.humanBoundaries,
    shepherdIntent: manifest.shepherdIntent,
    issues: manifest.issues.map((issue) => ({
      identity: issue.identity,
      sourceRevision: issue.sourceRevision,
      sourceReceipt: issue.sourceReceipt,
      acceptanceCriteria: issue.acceptanceCriteria,
      scope: issue.scope,
      allowedPaths: issue.allowedPaths,
      status: issue.status,
    })),
    humanDecisions: [],
  });
  assert.throws(
    () => persistFleetState(
      file,
      createFleetState(linkedManifest, 'symlink-run'),
      0,
      linkedManifest,
    ),
    /directory ancestry is unsafe/,
  );
});

test('wrong repository or run path is rejected before creating directories', () => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  const wrongRepository = path.join(ROOT, '.test-sandbox', 'wrong-squadron-root');
  fs.rmSync(wrongRepository, { recursive: true, force: true });
  const state = createFleetState(manifest, 'bound-run');
  assert.throws(
    () => persistFleetState(fleetStatePath(wrongRepository, 'bound-run'), state, 0, manifest),
    /not bound to the manifest repository and run/,
  );
  assert.equal(fs.existsSync(wrongRepository), false);
  assert.throws(
    () => persistFleetState(fleetStatePath(SANDBOX, 'wrong-run'), state, 0, manifest),
    /not bound to the manifest repository and run/,
  );
  assert.equal(fs.existsSync(path.join(SANDBOX, '.ship-with-squadron', 'wrong-run')), false);
});

test('reobserves the exact source revision and rejects closed-set or ownership forgery', () => {
  const initial = createFleetState(manifest, 'run-2');
  const observed = recordSourceRevisionObservation(
    initial,
    manifest,
    '1',
    receipt('2026-08-30T00:01:00Z'),
    '2026-08-30T00:01:01Z',
  );
  assert.equal(observed.issues['1'].sourceObservation.manifestDigest, manifest.digest);
  assert.throws(() => recordSourceRevisionObservation(
    initial,
    manifest,
    '1',
    { ...receipt(), revision: 'drift' },
  ), /renewed manifest|does not match/);

  const extra = structuredClone(initial);
  extra.issues.extra = structuredClone(extra.issues['1']);
  extra.issues.extra.identity = 'extra';
  assert.throws(() => assertFleetState(extra, manifest), /exactly equal/);
  const forged = structuredClone(initial);
  forged.issues['1'].status = 'active';
  assert.throws(() => assertFleetState(forged, manifest), /assignment/);
  const publication = structuredClone(initial);
  publication.issues['1'].changeRequest = { identifier: 'PR-1' };
  assert.throws(() => assertFleetState(publication, manifest), /change request keys differ|confirmed publication/);
});

test('uses at-ceiling budget semantics, stops dispatch, and preserves cancellation obligations', () => {
  const initial = createFleetState(manifest, 'run-3');
  const budget = consumeBudget(initial, manifest, { cost: 1 });
  assert.deepEqual(budget.exhausted, ['cost']);
  assert.equal(budget.state.control.budgetExhausted, true);
  assert.equal(budget.state.issues['1'].terminalDisposition, 'not-reached');
  assert.equal(budget.state.issues['1'].nextAction, 'await-renewed-human-confirmation');

  const cancelled = cancelFleet(initial, manifest, 'operator requested stop');
  assert.equal(cancelled.control.cancelled, true);
  assert.equal(cancelled.fleetDisposition, 'cancelled');
  assert.equal(cancelled.issues['1'].nextAction, 'await-new-human-invocation');
  assert.throws(
    () => transitionIssue(initial, manifest, '1', 'active'),
    /only be entered through validated assignment/,
  );
  assert.throws(
    () => transitionIssue(initial, manifest, '1', 'pending'),
    /validated handoff replacement/,
  );
  assert.throws(
    () => transitionIssue(initial, manifest, '1', 'failed', {
      terminalDisposition: 'blocked',
    }),
    /contradicts status failed/,
  );
  assert.throws(
    () => transitionIssue(initial, manifest, '1', 'completed', {
      terminalDisposition: 'blocked',
    }),
    /semantic publication\/readiness pipeline/,
  );
});

test('state invariants rederive semantic evidence and enforce active capacity', () => {
  const forgedCapacity = createFleetState(manifest, 'run-4');
  forgedCapacity.activeCapacity = 1;
  assert.throws(() => assertFleetState(forgedCapacity, manifest), /active owner count violates/);

  const failedCi = createFleetState(manifest, 'run-5');
  const record = failedCi.issues['1'];
  record.baseSha = 'base';
  record.headSha = 'head';
  const common = {
    baseSha: 'base', headSha: 'head', complete: true, terminal: true,
    completedAt: '2026-08-30T00:02:00Z',
  };
  record.pipeline = [
    { stage: 'implementation', evidence: { ...common, status: 'completed' } },
    { stage: 'diff-reconciliation', evidence: { ...common, verdict: 'reconciled' } },
    {
      stage: 'run-ci',
      evidence: {
        ...common,
        invocation: { skill: 'run-ci', id: 'ci-failed', runId: 'run-5', issue: '1' },
        status: 'failed',
        evidenceComplete: true,
        steps: [{ name: 'tests', status: 'failed' }],
      },
    },
  ];
  assert.throws(() => assertFleetState(failedCi, manifest), /forged run-ci evidence/);

  const forgedReady = createFleetState(manifest, 'run-forged-ready');
  forgedReady.issues['1'].status = 'completed';
  forgedReady.issues['1'].terminalDisposition = 'ready-for-human-merge';
  forgedReady.issues['1'].nextAction = 'await-human-merge';
  assert.throws(
    () => assertFleetState(forgedReady, manifest),
    /ready disposition lacks effective pipeline readiness/,
  );
});

test('does not claim timed-out-with-handoff without archived validated handoff evidence', () => {
  const timedOutIssue = {
    ...manifest.issues[0],
    status: 'timed-out',
    sourceReceipt: {
      ...manifest.issues[0].sourceReceipt,
      issueStatus: 'timed-out',
    },
  };
  const timedOutManifest = normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: manifest.goal,
    acceptedScope: manifest.acceptedScope,
    exclusions: manifest.exclusions,
    humanDecisions: [],
    issues: [{
      identity: timedOutIssue.identity,
      sourceRevision: timedOutIssue.sourceRevision,
      sourceReceipt: timedOutIssue.sourceReceipt,
      acceptanceCriteria: timedOutIssue.acceptanceCriteria,
      scope: manifest.issues[0].scope,
      allowedPaths: manifest.issues[0].allowedPaths,
      status: 'timed-out',
    }],
    dependencies: [],
    concurrency: manifest.concurrency,
    budget: manifest.budget,
    repository: manifest.repository,
    provider: manifest.provider,
    validationPolicy: manifest.validationPolicy,
    stopConditions: manifest.stopConditions,
    humanBoundaries: manifest.humanBoundaries,
    shepherdIntent: manifest.shepherdIntent,
  });

  const state = createFleetState(timedOutManifest, 'timed-out');
  assert.equal(state.issues['1'].terminalDisposition, 'failed');
  state.issues['1'].terminalDisposition = 'timed-out-with-handoff';
  assert.throws(
    () => assertFleetState(state, timedOutManifest),
    /lacks a validated archived handoff/,
  );
});

test('timeout crash stall and exhaustion retain ownership until a validated handoff exists', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  for (const condition of ['timed-out', 'crashed', 'stalled', 'exhausted']) {
    const runId = `handoff-${condition}`;
    const initial = activeState(runId);
    const requestedStatus = condition === 'timed-out' ? 'timed-out' : 'blocked';
    const blocked = transitionIssue(initial, manifest, '1', requestedStatus, {
      ...(condition === 'crashed' ? { handoff: { fabricated: true } } : {}),
      assignmentEnd: {
        generation: 1,
        workerContext: 'worker-1',
        reason: condition,
        endedAt: '2026-08-30T00:02:00Z',
      },
    });
    assert.equal(blocked.issues['1'].status, 'active');
    assert.equal(blocked.issues['1'].assignment.active, true);
    assert.equal(blocked.issues['1'].terminalDisposition, null);
    assert.equal(blocked.issues['1'].handoffObligation.reason, 'handoff-required');
    assert.equal(blocked.issues['1'].handoffObligation.condition, condition);
    assert.doesNotThrow(() => assertFleetState(blocked, manifest));
    const persisted = persistFleetState(
      fleetStatePath(SANDBOX, runId),
      blocked,
      0,
      manifest,
    );
    assert.equal(persisted.issues['1'].assignment.workerContext, 'worker-1');
    assert.equal(persisted.issues['1'].handoffObligation.condition, condition);
  }
});
