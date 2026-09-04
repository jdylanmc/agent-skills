import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  assertFleetState,
  cancelFleet,
  canonicalFilesystemIdentity,
  captureIsolatedGitWorktreeIdentity,
  consumeBudget,
  createFleetState,
  fleetStatePath,
  loadFleetState,
  mutateFleetState,
  persistFleetState,
  recordSourceRevisionObservation,
  serializeFilesystemIdentity,
  transitionIssue,
} from './fleet-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SANDBOX = path.join(
  ROOT,
  '.test-sandbox',
  `ship-with-squadron-state-${process.pid}-${randomUUID()}`,
);
const REPOSITORY = path.join(SANDBOX, 'repository');
const MODULE = pathToFileURL(fileURLToPath(new URL('./fleet-state.mjs', import.meta.url))).href;
const WORKTREE = path.join(SANDBOX, 'worktrees', 'issue-1');
const CHILD_TIMEOUT_MS = 5_000;
const CHILD_OUTPUT_LIMIT_BYTES = 64 * 1024;
const CHILD_MESSAGE_LIMIT_BYTES = 16 * 1024;
const CHILD_MESSAGE_LIMIT_COUNT = 16;

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
  repository: { id: 'owner/repo', root: REPOSITORY, baseBranch: 'main' },
  provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge', 'observe-change-request-revision'] },
  validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
  stopConditions: ['cancelled'],
  humanBoundaries: ['human merge'],
  shepherdIntent: 'yes',
});

function activeState(runId) {
  ensureGitWorktree();
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
      worktreeIdentity: captureIsolatedGitWorktreeIdentity(REPOSITORY, WORKTREE, 'issue-1'),
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

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function ensureGitWorktree() {
  if (fs.existsSync(path.join(REPOSITORY, '.git'))) return;
  fs.mkdirSync(REPOSITORY, { recursive: true });
  git(REPOSITORY, 'init', '-b', 'main');
  fs.writeFileSync(path.join(REPOSITORY, 'seed.txt'), 'seed\n');
  git(REPOSITORY, '-c', 'user.name=Test', '-c', 'user.email=test-identity', 'add', 'seed.txt');
  git(REPOSITORY, '-c', 'user.name=Test', '-c', 'user.email=test-identity', 'commit', '-m', 'seed');
  fs.mkdirSync(path.dirname(WORKTREE), { recursive: true });
  git(REPOSITORY, 'worktree', 'add', '-b', 'issue-1', WORKTREE);
}

function writeLock(lockDirectory, metadata, modifiedAt = null) {
  metadata = { processIdentity: null, ...metadata };
  fs.mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
  const owner = path.join(lockDirectory, `owner-${metadata.token}.json`);
  fs.writeFileSync(owner, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
  if (modifiedAt) fs.utimesSync(owner, modifiedAt, modifiedAt);
  return owner;
}

function captureLockIdentity(lockDirectory, expectedMetadata) {
  const ownerPath = path.join(lockDirectory, `owner-${expectedMetadata.token}.json`);
  try {
    const directoryBefore = fs.lstatSync(lockDirectory, { bigint: true });
    assert.equal(directoryBefore.isSymbolicLink(), false);
    assert.equal(directoryBefore.isDirectory(), true);
    const ownerHandle = fs.openSync(ownerPath, 'r');
    let owner;
    let metadata;
    try {
      owner = fs.fstatSync(ownerHandle, { bigint: true });
      metadata = JSON.parse(fs.readFileSync(ownerHandle, 'utf8'));
    } finally {
      fs.closeSync(ownerHandle);
    }
    const directoryAfter = fs.lstatSync(lockDirectory, { bigint: true });
    assert.deepEqual(
      serializeFilesystemIdentity(directoryAfter),
      serializeFilesystemIdentity(directoryBefore),
      'lock directory changed while its replacement identity was captured',
    );
    return {
      status: 'present',
      directory: serializeFilesystemIdentity(directoryAfter),
      owner: serializeFilesystemIdentity(owner),
      metadata,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        status: 'missing',
        lockDirectory,
      };
    }
    throw error;
  }
}

function spawnIpcChild(script, args, {
  readinessTimeoutMs = CHILD_TIMEOUT_MS,
  completionTimeoutMs = CHILD_TIMEOUT_MS,
  terminationGraceMs = 250,
  cleanupTimeoutMs = 1_000,
  outputLimitBytes = CHILD_OUTPUT_LIMIT_BYTES,
  messageLimitBytes = CHILD_MESSAGE_LIMIT_BYTES,
  messageLimitCount = CHILD_MESSAGE_LIMIT_COUNT,
} = {}) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, ...args], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  const output = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  let outputTruncated = false;
  let outcome = null;
  let spawnError = null;
  let timeoutStage = null;
  let forcedTermination = false;
  let terminationStarted = false;
  let completionTimer = null;
  let forceTimer = null;
  let hardKillTimer = null;
  let cleanupTimer = null;
  let readyResolve;
  let readyReject;
  let readySettled = false;
  let completedResolve;
  let completedReject;
  let completedSettled = false;
  let exited = false;
  let closed = false;
  let messageCount = 0;
  let messageBytes = 0;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const result = (code = child.exitCode, signal = child.signalCode) => ({
    code,
    signal,
    stdout: output.stdout.toString(),
    stderr: output.stderr.toString(),
    outputTruncated,
    timeoutStage,
    forcedTermination,
    closed,
    spawnError,
    outcome,
  });
  const settleCompleted = (code, signal) => {
    if (completedSettled) return;
    completedSettled = true;
    clearTimeout(readinessTimer);
    clearTimeout(completionTimer);
    clearTimeout(forceTimer);
    clearTimeout(hardKillTimer);
    clearTimeout(cleanupTimer);
    completedResolve(result(code, signal));
  };
  const terminate = (reason = 'requested') => {
    if (terminationStarted || completedSettled) return;
    terminationStarted = true;
    if (!child.stdin.destroyed) child.stdin.end();
    if (child.connected) {
      try {
        child.send({ type: 'shutdown' });
      } catch (error) {
        if (!['ERR_IPC_CHANNEL_CLOSED', 'ERR_IPC_DISCONNECTED'].includes(error.code)) throw error;
      }
    }
    forceTimer = setTimeout(() => {
      if (!exited) {
        forcedTermination = true;
        process.kill(child.pid, 'SIGTERM');
      }
    }, terminationGraceMs);
    hardKillTimer = setTimeout(() => {
      if (!exited) {
        process.kill(child.pid, 'SIGKILL');
        child.stdin.destroy();
      }
    }, terminationGraceMs * 2);
    cleanupTimer = setTimeout(() => {
      if (completedSettled) return;
      completedSettled = true;
      completedReject(new Error(
        `direct child cleanup expired without close after ${reason}; exited=${exited} pid=${child.pid} exitCode=${child.exitCode} signal=${child.signalCode}`,
      ));
    }, (terminationGraceMs * 2) + cleanupTimeoutMs);
  };
  const completed = new Promise((resolve, reject) => {
    completedResolve = resolve;
    completedReject = reject;
  });
  const appendOutput = (stream, chunk) => {
    const remaining = outputLimitBytes - output[stream].length;
    if (remaining > 0) {
      output[stream] = Buffer.concat([output[stream], chunk.subarray(0, remaining)]);
    }
    if (chunk.length > remaining) {
      outputTruncated = true;
      terminate('output-overflow');
    }
  };
  const readinessTimer = setTimeout(() => {
    timeoutStage = 'readiness';
    if (!readySettled) {
      readySettled = true;
      readyReject(new Error(
        `child did not reach its IPC barrier within ${readinessTimeoutMs}ms`,
      ));
    }
    terminate('readiness-timeout');
  }, readinessTimeoutMs);
  child.stdout.on('data', (chunk) => appendOutput('stdout', chunk));
  child.stderr.on('data', (chunk) => appendOutput('stderr', chunk));
  child.on('message', (message) => {
    messageCount += 1;
    messageBytes += Buffer.byteLength(JSON.stringify(message));
    if (messageCount > messageLimitCount || messageBytes > messageLimitBytes) {
      spawnError ??= new Error('child IPC message bounds exceeded');
      terminate('message-overflow');
      return;
    }
    if (message?.type === 'ready' && !readySettled) {
      readySettled = true;
      clearTimeout(readinessTimer);
      readyResolve(message);
      completionTimer = setTimeout(() => {
        timeoutStage = 'completion';
        terminate('completion-timeout');
      }, completionTimeoutMs);
    } else if (message?.type === 'outcome') {
      outcome = message;
    }
  });
  child.on('error', (error) => {
    spawnError = error;
    if (!readySettled) {
      readySettled = true;
      readyReject(error);
    }
    terminate('spawn-error');
  });
  child.on('exit', () => {
    exited = true;
  });
  child.on('close', (code, signal) => {
    closed = true;
    if (!readySettled) {
      readySettled = true;
      readyReject(new Error(`child exited before its IPC barrier: code=${code} signal=${signal}`));
    }
    settleCompleted(code, signal);
  });
  return {
    child,
    ready,
    completed,
    async terminate() {
      terminate();
      return completed;
    },
  };
}

function assertCleanChildExit(result) {
  assert.equal(result.timeoutStage, null, `child timed out\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.equal(result.outputTruncated, false);
  assert.equal(result.closed, true);
  assert.equal(result.spawnError, null);
  assert.equal(result.signal, null, `child terminated by ${result.signal}\nstderr: ${result.stderr}`);
  assert.equal(result.code, 0, `child exited ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  assert.equal(result.stderr, '');
  assert.ok(result.outcome, `child exited without an outcome\nstdout: ${result.stdout}`);
}

test('IPC child lifecycle bounds readiness, completion, output, and termination', async (t) => {
  const children = [];
  t.after(async () => Promise.all(children.map((child) => child.terminate())));

  const neverReady = spawnIpcChild(`
    setInterval(() => {}, 1_000);
  `, [], {
    readinessTimeoutMs: 500,
    terminationGraceMs: 250,
    cleanupTimeoutMs: 1_000,
  });
  children.push(neverReady);
  await assert.rejects(neverReady.ready, /did not reach its IPC barrier/);
  const neverReadyResult = await neverReady.completed;
  assert.equal(neverReadyResult.timeoutStage, 'readiness');
  assert.equal(neverReadyResult.forcedTermination, true);
  assert.equal(neverReadyResult.closed, true);

  const readyStalled = spawnIpcChild(`
    process.send({ type: 'ready', identity: 'ready-stalled' });
    setInterval(() => {}, 1_000);
  `, [], {
    readinessTimeoutMs: 500,
    completionTimeoutMs: 500,
    terminationGraceMs: 250,
    cleanupTimeoutMs: 1_000,
  });
  children.push(readyStalled);
  assert.equal((await readyStalled.ready).identity, 'ready-stalled');
  const readyStalledResult = await readyStalled.completed;
  assert.equal(readyStalledResult.timeoutStage, 'completion');
  assert.equal(readyStalledResult.forcedTermination, true);
  assert.equal(readyStalledResult.closed, true);

  const overflowing = spawnIpcChild(`
    process.stdout.write(Buffer.alloc(${CHILD_OUTPUT_LIMIT_BYTES * 2}, 120));
    setInterval(() => {}, 1_000);
  `, [], {
    readinessTimeoutMs: 500,
    terminationGraceMs: 100,
    cleanupTimeoutMs: 1_000,
  });
  children.push(overflowing);
  await assert.rejects(
    overflowing.ready,
    /exited before its IPC barrier|did not reach its IPC barrier/,
  );
  const overflowingResult = await overflowing.completed;
  assert.equal(overflowingResult.outputTruncated, true);
  assert.equal(Buffer.byteLength(overflowingResult.stdout), CHILD_OUTPUT_LIMIT_BYTES);
  assert.equal(overflowingResult.closed, true);

  for (const script of [
    `process.send({ type: 'ready', payload: 'x'.repeat(${CHILD_MESSAGE_LIMIT_BYTES}) }); setInterval(() => {}, 1_000);`,
    `for (let index = 0; index < ${CHILD_MESSAGE_LIMIT_COUNT + 1}; index += 1) process.send({ type: 'noise', index }); setInterval(() => {}, 1_000);`,
  ]) {
    const abusive = spawnIpcChild(script, [], {
      readinessTimeoutMs: 500,
      terminationGraceMs: 100,
      cleanupTimeoutMs: 1_000,
    });
    children.push(abusive);
    await assert.rejects(abusive.ready);
    const abusiveResult = await abusive.completed;
    assert.match(abusiveResult.spawnError?.message ?? '', /IPC message bounds exceeded/);
    assert.equal(abusiveResult.closed, true);
  }

  const softTermination = spawnIpcChild(`
    process.on('message', (message) => {
      if (message?.type === 'shutdown') {
        process.disconnect();
        process.exit(0);
      }
    });
    process.send({ type: 'ready', identity: 'soft-termination' });
    setInterval(() => {}, 1_000);
  `, [], {
    readinessTimeoutMs: 500,
    completionTimeoutMs: 1_000,
    terminationGraceMs: 500,
    cleanupTimeoutMs: 1_000,
  });
  children.push(softTermination);
  await softTermination.ready;
  const softTerminationResult = await softTermination.terminate();
  assert.equal(softTerminationResult.forcedTermination, false);
  assert.equal(softTerminationResult.closed, true);
  if (process.platform !== 'win32') assert.equal(softTerminationResult.code, 0);
});

test('persists, rereads, validates schema, and compare-and-swaps run state', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'run-1');
  const initial = createFleetState(manifest, 'run-1', '2026-08-30T00:00:00Z');
  const written = persistFleetState(file, initial, 0, manifest, { now: '2026-08-30T00:00:01Z' });
  assert.equal(written.revision, 1);
  assert.equal(loadFleetState(file, manifest).issues['1'].sourceRevision, 'r1');
  assert.throws(() => persistFleetState(file, initial, 0, manifest), /revision conflict/);
  assert.throws(() => persistFleetState(file, written, 1), /manifest is required/);
});

test('persists namespaced strategy state through locked compare-and-swap mutations', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'strategy-state');
  const initial = createFleetState(manifest, 'strategy-state', '2026-08-30T00:00:00Z');
  assert.equal(initial.strategyState, null);
  const written = persistFleetState(file, initial, 0, manifest, { now: '2026-08-30T00:00:01Z' });
  const strategyState = {
    namespace: 'example.strategy',
    value: { cursor: 3, completed: ['1'], options: { retry: false } },
  };
  const mutated = mutateFleetState(file, manifest, written.revision, (state) => ({
    ...state,
    strategyState,
  }), { now: '2026-08-30T00:00:02Z' });
  assert.equal(mutated.revision, 2);
  assert.deepEqual(loadFleetState(file, manifest).strategyState, strategyState);
  assert.throws(
    () => mutateFleetState(file, manifest, written.revision, (state) => state),
    /revision conflict/,
  );
});

test('rejects unknown and malformed strategy state extensions', () => {
  const unknown = createFleetState(manifest, 'unknown-strategy-state');
  unknown.unrecognizedStrategyState = null;
  assert.throws(() => assertFleetState(unknown, manifest), /fleet state keys differ/);

  const malformedEnvelope = createFleetState(manifest, 'malformed-strategy-state');
  malformedEnvelope.strategyState = { namespace: 'example.strategy', value: {}, extra: true };
  assert.throws(() => assertFleetState(malformedEnvelope, manifest), /strategy state keys differ/);

  const malformedValue = createFleetState(manifest, 'malformed-strategy-value');
  malformedValue.strategyState = { namespace: 'example.strategy', value: { missing: undefined } };
  assert.throws(() => assertFleetState(malformedValue, manifest), /JSON serializable/);
});

test('loads legacy canonical state until a strictly bound commit slot exists', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'legacy-state');
  const legacy = createFleetState(manifest, 'legacy-state');
  delete legacy.strategyState;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`);
  assert.equal(loadFleetState(file, manifest).revision, 0);
  assert.equal(persistFleetState(file, legacy, 0, manifest).revision, 1);
  assert.equal(fs.existsSync(`${file}.commit-r1`), true);
  fs.writeFileSync(`${file}.commit-invalid`, '{}');
  assert.throws(() => loadFleetState(file, manifest), /commit slot name is invalid/);
});

test('serializes a multiprocess revision race so only one writer wins', async (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  fs.mkdirSync(SANDBOX, { recursive: true });
  const file = fleetStatePath(REPOSITORY, 'race');
  const manifestFile = path.join(SANDBOX, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  persistFleetState(file, createFleetState(manifest, 'race'), 0, manifest);
  const script = `
    import fs from 'node:fs';
    import { loadFleetState, persistFleetState } from ${JSON.stringify(MODULE)};
    const [identity, marker, file, manifestFile] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const state = loadFleetState(file, manifest);
    process.once('message', (message) => {
      let outcome;
      if (message?.type !== 'go') {
        outcome = { type: 'outcome', identity, status: 'protocol-error', message: 'expected go' };
      } else {
        try {
          const committed = persistFleetState(
            file,
            state,
            state.revision,
            manifest,
            { now: marker },
          );
          outcome = {
            type: 'outcome',
            identity,
            marker,
            committedMarker: committed.updatedAt,
            status: 'won',
            message: null,
          };
        } catch (error) {
          outcome = {
            type: 'outcome',
            identity,
            marker,
            committedMarker: null,
            status: 'lost',
            message: error.message,
          };
        }
      }
      process.send(outcome, () => process.disconnect());
    });
    process.send({ type: 'ready', identity, revision: state.revision });
  `;
  const children = [
    spawnIpcChild(script, ['writer-1', '2026-08-30T00:00:01Z', file, manifestFile]),
    spawnIpcChild(script, ['writer-2', '2026-08-30T00:00:02Z', file, manifestFile]),
  ];
  t.after(async () => Promise.all(children.map((child) => child.terminate())));
  const ready = await Promise.all(children.map((child) => child.ready));
  assert.deepEqual(ready.map((message) => message.identity).sort(), ['writer-1', 'writer-2']);
  assert.deepEqual(ready.map((message) => message.revision), [1, 1]);
  for (const child of children) child.child.send({ type: 'go' });
  const results = await Promise.all(children.map((child) => child.completed));
  for (const result of results) assertCleanChildExit(result);
  const outcomes = results.map((result) => result.outcome);
  assert.deepEqual(outcomes.map((outcome) => outcome.identity).sort(), ['writer-1', 'writer-2']);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'won').length, 1);
  const losers = outcomes.filter((outcome) => outcome.status === 'lost');
  assert.equal(losers.length, 1);
  assert.match(losers[0].message, /^state revision conflict:/);
  const finalJson = JSON.parse(fs.readFileSync(file, 'utf8'));
  const committedJson = JSON.parse(fs.readFileSync(`${file}.commit-r2`, 'utf8'));
  const winner = outcomes.find((outcome) => outcome.status === 'won');
  assert.equal(finalJson.revision, 2);
  assert.equal(winner.committedMarker, winner.marker);
  assert.equal(finalJson.updatedAt, winner.marker);
  assert.equal(committedJson.updatedAt, winner.marker);
  assert.deepEqual(committedJson, finalJson);
});

test('recovers a crash-stale ownership-bound lock before the exclusive revision recheck', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'stale-lock');
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
  assert.equal(
    fs.readdirSync(path.dirname(file)).some((entry) => entry.includes('.quarantine-stale-')),
    true,
  );
});

test('recovers PID-reuse locks only from mismatched process-instance identity', (t) => {
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) {
    t.skip('portable process-instance proof is unavailable on this platform');
    return;
  }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'pid-reuse-lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const old = new Date('2020-01-01T00:00:00Z');
  writeLock(`${file}.lock`, {
    pid: process.pid,
    processIdentity: `${process.platform}:different-process-instance`,
    token: '6'.repeat(48),
    expectedRevision: 0,
    createdAt: old.toISOString(),
  }, old);
  const written = persistFleetState(
    file,
    createFleetState(manifest, 'pid-reuse-lock'),
    0,
    manifest,
    { staleLockMs: 0 },
  );
  assert.equal(written.revision, 1);
});

test('serializes filesystem identities without losing bigint precision', () => {
  const identity = serializeFilesystemIdentity({
    dev: BigInt(Number.MAX_SAFE_INTEGER) + 12345n,
    ino: BigInt(Number.MAX_SAFE_INTEGER) + 67890n,
  });
  assert.deepEqual(identity, {
    device: '9007199254753336',
    inode: '9007199254808881',
  });
});

test('Darwin live lock identity is stable across contender timezones', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Darwin-specific process identity check');
    return;
  }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  const previousTimezone = process.env.TZ;
  t.after(() => {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  });
  const file = fleetStatePath(REPOSITORY, 'timezone-lock');
  assert.throws(() => persistFleetState(
    file,
    createFleetState(manifest, 'timezone-lock'),
    0,
    manifest,
    {
      beforeReleaseLockClaim() {
        throw new Error('leave-live-lock-for-timezone-check');
      },
    },
  ), (error) => (
    error.code === 'FLEET_STATE_COMMITTED'
      && error.committedRevision === 1
      && error.cause?.message === 'leave-live-lock-for-timezone-check'
  ));
  const live = loadFleetState(file, manifest);
  process.env.TZ = previousTimezone === 'UTC' ? 'America/Los_Angeles' : 'UTC';
  assert.throws(() => persistFleetState(file, live, live.revision, manifest, {
    staleLockMs: 0,
    lockAttempts: 1,
  }), /write lock is busy/);
});

test('Darwin live lock identity is stable across process title changes', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Darwin-specific immutable process identity check');
    return;
  }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  const priorTitle = process.title;
  t.after(() => {
    process.title = priorTitle;
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  });
  const file = fleetStatePath(REPOSITORY, 'title-lock');
  assert.throws(() => persistFleetState(
    file,
    createFleetState(manifest, 'title-lock'),
    0,
    manifest,
    {
      beforeReleaseLockClaim() {
        throw new Error('leave-live-lock-for-title-check');
      },
    },
  ), (error) => (
    error.code === 'FLEET_STATE_COMMITTED'
      && error.committedRevision === 1
      && error.cause?.message === 'leave-live-lock-for-title-check'
  ));
  const live = loadFleetState(file, manifest);
  process.title = `${priorTitle}-changed`;
  assert.throws(() => persistFleetState(file, live, live.revision, manifest, {
    staleLockMs: 0,
    lockAttempts: 1,
  }), /write lock is busy/);
});

test('Windows live process creation identity prevents stale PID reclamation', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows-specific process creation identity check');
    return;
  }
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'windows-live-lock');
  assert.throws(() => persistFleetState(
    file,
    createFleetState(manifest, 'windows-live-lock'),
    0,
    manifest,
    {
      beforeReleaseLockClaim() {
        throw new Error('leave-live-windows-lock');
      },
    },
  ), (error) => (
    error.code === 'FLEET_STATE_COMMITTED'
      && error.committedRevision === 1
      && error.cause?.message === 'leave-live-windows-lock'
  ));
  const live = loadFleetState(file, manifest);
  assert.throws(() => persistFleetState(file, live, live.revision, manifest, {
    staleLockMs: 0,
    lockAttempts: 1,
  }), /write lock is busy/);
});

test('does not delete pending files that may belong to a deposed writer', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'pending-residue');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const residue = `${file}.next-${'a'.repeat(48)}-${'b'.repeat(32)}`;
  const unrelated = `${file}.next-untrusted`;
  fs.writeFileSync(residue, 'stale');
  fs.writeFileSync(unrelated, 'leave');
  const written = persistFleetState(
    file,
    createFleetState(manifest, 'pending-residue'),
    0,
    manifest,
  );
  assert.equal(written.revision, 1);
  assert.equal(fs.readFileSync(residue, 'utf8'), 'stale');
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'leave');
});

test('stale and malformed recovery quarantines the observed bytes without deleting them', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const old = new Date('2020-01-01T00:00:00Z');
  for (const kind of ['stale', 'malformed']) {
    const file = fleetStatePath(REPOSITORY, `${kind}-quarantine`);
    const lock = `${file}.lock`;
    let expectedEntries;
    if (kind === 'stale') {
      const owner = writeLock(lock, {
        pid: 99999999,
        token: 'a'.repeat(48),
        expectedRevision: 0,
        createdAt: old.toISOString(),
      }, old);
      expectedEntries = [[path.basename(owner), fs.readFileSync(owner)]];
    } else {
      fs.mkdirSync(lock, { recursive: true, mode: 0o700 });
      const owner = path.join(lock, `owner-${'b'.repeat(48)}.json`);
      fs.writeFileSync(owner, '{broken-json', { mode: 0o600 });
      fs.utimesSync(lock, old, old);
      expectedEntries = [[path.basename(owner), fs.readFileSync(owner)]];
    }
    const written = persistFleetState(
      file,
      createFleetState(manifest, `${kind}-quarantine`),
      0,
      manifest,
      { staleLockMs: 0 },
    );
    assert.equal(written.revision, 1);
    assert.equal(fs.existsSync(lock), false);
    const quarantineName = fs.readdirSync(path.dirname(file))
      .find((entry) => entry.startsWith(`${path.basename(lock)}.quarantine-${kind}-`));
    assert.ok(quarantineName);
    const quarantine = path.join(path.dirname(file), quarantineName);
    assert.deepEqual(fs.readdirSync(quarantine), expectedEntries.map(([name]) => name));
    for (const [name, bytes] of expectedEntries) {
      assert.deepEqual(fs.readFileSync(path.join(quarantine, name)), bytes);
    }
  }
});

test('stale, malformed, and release replacements remain byte-for-byte intact', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const old = new Date('2020-01-01T00:00:00Z');
  for (const kind of ['stale', 'malformed']) {
    const file = fleetStatePath(REPOSITORY, `${kind}-replacement`);
    const lock = `${file}.lock`;
    if (kind === 'stale') {
      writeLock(lock, {
        pid: 99999999,
        token: 'c'.repeat(48),
        expectedRevision: 0,
        createdAt: old.toISOString(),
      }, old);
    } else {
      fs.mkdirSync(lock, { recursive: true });
      fs.writeFileSync(path.join(lock, `owner-${'d'.repeat(48)}.json`), '{bad');
      fs.utimesSync(lock, old, old);
    }
    const replacement = {
      pid: process.pid,
      processIdentity: null,
      token: 'e'.repeat(48),
      expectedRevision: 0,
      createdAt: new Date().toISOString(),
    };
    let before;
    assert.throws(() => persistFleetState(
      file,
      createFleetState(manifest, `${kind}-replacement`),
      0,
      manifest,
      {
        staleLockMs: 0,
        lockAttempts: 1,
        [kind === 'stale' ? 'beforeStaleLockClaim' : 'beforeMalformedLockClaim']() {
          fs.rmSync(lock, { recursive: true });
          writeLock(lock, replacement);
          before = captureLockIdentity(lock, replacement);
        },
      },
    ), /write lock is busy/);
    assert.deepEqual(captureLockIdentity(lock, replacement), before);
  }

  const file = fleetStatePath(REPOSITORY, 'release-replacement');
  const lock = `${file}.lock`;
  const replacement = {
    pid: process.pid,
    processIdentity: null,
    token: 'f'.repeat(48),
    expectedRevision: 1,
    createdAt: new Date().toISOString(),
  };
  let before;
  const written = persistFleetState(file, createFleetState(manifest, 'release-replacement'), 0, manifest, {
    beforeReleaseLockClaim() {
      fs.rmSync(lock, { recursive: true });
      writeLock(lock, replacement);
      before = captureLockIdentity(lock, replacement);
    },
  });
  assert.equal(written.revision, 1);
  assert.deepEqual(captureLockIdentity(lock, replacement), before);
});

test('stage-specific unreadable owner failures preserve the canonical lock', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const old = new Date('2020-01-01T00:00:00Z');
  let sequence = 0;
  for (const stage of ['directory', 'entries', 'owner']) {
    for (const code of ['EACCES', 'EPERM', 'EBUSY', 'EIO']) {
      sequence += 1;
      const file = fleetStatePath(REPOSITORY, `unreadable-${stage}-${code.toLowerCase()}`);
      const lock = `${file}.lock`;
      const metadata = {
        pid: 99999999,
        processIdentity: null,
        token: sequence.toString(16).padStart(48, '0'),
        expectedRevision: 0,
        createdAt: old.toISOString(),
      };
      writeLock(lock, metadata, old);
      const before = captureLockIdentity(lock, metadata);
      assert.throws(() => persistFleetState(
        file,
        createFleetState(manifest, `unreadable-${stage}-${code.toLowerCase()}`),
        0,
        manifest,
        {
          staleLockMs: 0,
          lockAttempts: 1,
          testOnlyLockOwnerReadError: { stage, code },
        },
      ), (error) => error.code === code);
      assert.deepEqual(captureLockIdentity(lock, metadata), before);
    }
  }
});

test('unsafe lock targets are never mutated', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'unsafe-lock-substitution');
  const lock = `${file}.lock`;
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, `owner-${'1'.repeat(48)}.json`), '{broken');
  fs.utimesSync(lock, new Date(0), new Date(0));
  const target = path.join(SANDBOX, 'unsafe-target');
  fs.mkdirSync(target, { recursive: true });
  const sentinel = path.join(target, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'unchanged');
  assert.throws(() => persistFleetState(
    file,
    createFleetState(manifest, 'unsafe-lock-substitution'),
    0,
    manifest,
    {
      staleLockMs: 0,
      lockAttempts: 1,
      beforeMalformedLockClaim() {
        fs.rmSync(lock, { recursive: true });
        fs.symlinkSync(target, lock, process.platform === 'win32' ? 'junction' : 'dir');
      },
    },
  ), /lock path is unsafe/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
});

test('a deposed writer cannot overwrite the winner commit slot', async (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'deposed-writer');
  const manifestFile = path.join(SANDBOX, 'deposed-manifest.json');
  fs.mkdirSync(SANDBOX, { recursive: true });
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  persistFleetState(file, createFleetState(manifest, 'deposed-writer'), 0, manifest);
  const script = `
    import fs from 'node:fs';
    import { loadFleetState, persistFleetState } from ${JSON.stringify(MODULE)};
    const [file, manifestFile] = process.argv.slice(1);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const state = loadFleetState(file, manifest);
    try {
      persistFleetState(file, state, 1, manifest, {
        now: '2026-08-30T00:00:01Z',
        beforeStateCommit() {
          process.send({ type: 'ready', identity: 'writer-a' });
          const signal = Buffer.alloc(2);
          fs.readSync(0, signal, 0, 2, null);
        },
      });
      process.send({ type: 'outcome', status: 'unexpected-success' }, () => process.disconnect());
    } catch (error) {
      process.send({ type: 'outcome', status: 'lost', message: error.message }, () => process.disconnect());
    }
  `;
  const writerA = spawnIpcChild(script, [file, manifestFile]);
  t.after(async () => writerA.terminate());
  await writerA.ready;
  fs.renameSync(`${file}.lock`, `${file}.lock.deposed-by-test`);
  const winnerInput = loadFleetState(file, manifest);
  const winner = persistFleetState(file, winnerInput, 1, manifest, {
    now: '2026-08-30T00:00:02Z',
  });
  writerA.child.stdin.end('go');
  const result = await writerA.completed;
  assertCleanChildExit(result);
  assert.equal(result.outcome.status, 'lost');
  assert.match(result.outcome.message, /^state revision conflict:/);
  const slot = JSON.parse(fs.readFileSync(`${file}.commit-r2`, 'utf8'));
  const canonical = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(slot.updatedAt, winner.updatedAt);
  assert.equal(canonical.updatedAt, winner.updatedAt);
});

test('commit slots remain authoritative across projection and cleanup failures', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const projectionFile = fleetStatePath(REPOSITORY, 'projection-failure');
  const initial = persistFleetState(
    projectionFile,
    createFleetState(manifest, 'projection-failure'),
    0,
    manifest,
  );
  assert.throws(() => persistFleetState(projectionFile, initial, 1, manifest, {
    now: '2026-08-30T00:00:02Z',
    afterCommitSlot() {
      throw new Error('crash-after-slot');
    },
  }), (error) => (
    error.code === 'FLEET_STATE_COMMITTED'
      && error.committedRevision === 2
      && error.committedState.updatedAt === '2026-08-30T00:00:02Z'
      && fs.existsSync(error.commitPath)
  ));
  assert.equal(JSON.parse(fs.readFileSync(projectionFile, 'utf8')).revision, 1);
  assert.equal(loadFleetState(projectionFile, manifest).revision, 2);
  assert.throws(
    () => persistFleetState(projectionFile, initial, 1, manifest),
    /state revision conflict: disk is 2, expected 1/,
  );

  const releaseFile = fleetStatePath(REPOSITORY, 'release-failure');
  const releaseInput = createFleetState(manifest, 'release-failure');
  assert.throws(() => persistFleetState(
    releaseFile,
    releaseInput,
    0,
    manifest,
    {
      beforeReleaseLockClaim() {
        throw new Error('release-failed');
      },
    },
  ), (error) => (
    error.code === 'FLEET_STATE_COMMITTED'
      && error.committedRevision === 1
      && error.cause?.message === 'release-failed'
      && loadFleetState(releaseFile, manifest).revision === 1
  ));
  assert.throws(
    () => persistFleetState(releaseFile, releaseInput, 0, manifest, { lockAttempts: 1 }),
    /state revision conflict: disk is 1, expected 0/,
  );
});

test('revision conflict remains primary when release also fails', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'conflict-precedence');
  const current = persistFleetState(file, createFleetState(manifest, 'conflict-precedence'), 0, manifest);
  assert.throws(() => persistFleetState(file, current, 1, manifest, {
    beforeStateCommit() {
      const competitor = structuredClone(current);
      competitor.revision = 2;
      competitor.updatedAt = '2026-08-30T00:00:03Z';
      fs.writeFileSync(`${file}.commit-r2`, `${JSON.stringify(competitor, null, 2)}\n`);
    },
    beforeReleaseLockClaim() {
      throw new Error('secondary-release-failure');
    },
  }), (error) => (
    /^state revision conflict:/.test(error.message)
      && error.releaseError?.message === 'secondary-release-failure'
  ));
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
  const wrongRepository = path.join(SANDBOX, 'wrong-squadron-root');
  fs.rmSync(wrongRepository, { recursive: true, force: true });
  const state = createFleetState(manifest, 'bound-run');
  assert.throws(
    () => persistFleetState(fleetStatePath(wrongRepository, 'bound-run'), state, 0, manifest),
    /not bound to the manifest repository and run/,
  );
  assert.equal(fs.existsSync(wrongRepository), false);
  assert.throws(
    () => persistFleetState(fleetStatePath(REPOSITORY, 'wrong-run'), state, 0, manifest),
    /not bound to the manifest repository and run/,
  );
  assert.equal(fs.existsSync(path.join(REPOSITORY, '.ship-with-squadron', 'wrong-run')), false);
});

test('directory replacement before commit cannot overwrite replacement state', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(REPOSITORY, 'directory-swap');
  const written = persistFleetState(
    file,
    createFleetState(manifest, 'directory-swap'),
    0,
    manifest,
  );
  const runDirectory = path.dirname(file);
  const displaced = `${runDirectory}-displaced`;
  const replacement = '{"replacement":"must-remain-unchanged"}\n';
  assert.throws(() => persistFleetState(file, written, written.revision, manifest, {
    beforeStateCommit() {
      fs.renameSync(runDirectory, displaced);
      fs.mkdirSync(runDirectory, { recursive: true });
      fs.writeFileSync(file, replacement);
    },
  }), /directory.*changed|lock changed/i);
  assert.equal(fs.readFileSync(file, 'utf8'), replacement);
});

test('Windows case-sensitive directories require exact canonical spelling', (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows-specific per-directory case sensitivity check');
    return;
  }
  const root = path.join(SANDBOX, 'case-sensitive-root');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  try {
    execFileSync('fsutil.exe', ['file', 'setCaseSensitiveInfo', root, 'enable'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    t.skip('runner does not support per-directory case sensitivity');
    return;
  }
  const exact = path.join(root, 'ExactName');
  fs.mkdirSync(exact);
  assert.equal(canonicalFilesystemIdentity(exact, { requireExisting: true }).path, exact);
  assert.throws(
    () => canonicalFilesystemIdentity(path.join(root, 'exactName'), { requireExisting: true }),
    /does not exist|canonical path spelling/,
  );
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
  const exhaustedActive = consumeBudget(activeState('exhausted-active'), manifest, { cost: 1 }).state;
  assert.equal(exhaustedActive.issues['1'].handoffObligation.condition, 'exhausted');
  const exhaustedBypass = transitionIssue(exhaustedActive, manifest, '1', 'blocked', {
    assignmentEnd: {
      generation: 1,
      workerContext: 'worker-1',
      reason: 'blocked',
      endedAt: '2026-08-30T00:02:00Z',
    },
    terminalDisposition: 'blocked',
  });
  assert.equal(exhaustedBypass.issues['1'].status, 'active');
  assert.equal(exhaustedBypass.issues['1'].handoffObligation.condition, 'exhausted');

  const cancelled = cancelFleet(initial, manifest, 'operator requested stop');
  assert.equal(cancelled.control.cancelled, true);
  assert.equal(cancelled.fleetDisposition, 'cancelled');
  assert.equal(cancelled.issues['1'].nextAction, 'await-new-human-invocation');
  const active = activeState('cancelled-active');
  const cancelledActive = cancelFleet(active, manifest, 'operator requested stop');
  assert.equal(cancelledActive.issues['1'].handoffObligation.condition, 'cancelled');
  assert.doesNotThrow(() => assertFleetState(cancelledActive, manifest));
  const blockedBypass = transitionIssue(cancelledActive, manifest, '1', 'blocked', {
    assignmentEnd: {
      generation: 1,
      workerContext: 'worker-1',
      reason: 'blocked',
      endedAt: '2026-08-30T00:02:00Z',
    },
    terminalDisposition: 'blocked',
  });
  assert.equal(blockedBypass.issues['1'].status, 'active');
  assert.equal(blockedBypass.issues['1'].assignment.active, true);
  assert.equal(blockedBypass.issues['1'].handoffObligation.condition, 'cancelled');
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
  assert.throws(
    () => assertFleetState(forgedCapacity, manifest),
    /scheduler collections|active owner count violates/,
  );
  const forgedReasons = createFleetState(manifest, 'run-forged-frontier');
  forgedReasons.blockedSet[0].reason = 'caller-invented-reason';
  assert.throws(
    () => assertFleetState(forgedReasons, manifest),
    /scheduler collections/,
  );

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
      fleetStatePath(REPOSITORY, runId),
      blocked,
      0,
      manifest,
    );
    assert.equal(persisted.issues['1'].assignment.workerContext, 'worker-1');
    assert.equal(persisted.issues['1'].handoffObligation.condition, condition);
  }
});
