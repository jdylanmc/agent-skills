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

function receipt(observedAt = '2026-08-30T00:00:00Z') {
  return {
    invocation: { id: `read-${observedAt}`, operation: 'read-issue' },
    provider: 'github', repository: 'owner/repo', issue: '1', revision: 'r1',
    status: 'observed', terminal: true, complete: true, observedAt,
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
  repository: { id: 'owner/repo', root: '/repo', baseBranch: 'main' },
  provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge'] },
  validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
  stopConditions: ['cancelled'],
  humanBoundaries: ['human merge'],
  shepherdIntent: 'yes',
});

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

test('recovers a crash-stale incomplete lock before the exclusive revision recheck', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(SANDBOX, 'stale-lock');
  const initial = createFleetState(manifest, 'stale-lock');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.lock`, '');
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(`${file}.lock`, old, old);
  const written = persistFleetState(file, initial, 0, manifest, { staleLockMs: 0 });
  assert.equal(written.revision, 1);
  assert.equal(fs.existsSync(`${file}.lock`), false);
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
  assert.throws(() => assertFleetState(publication, manifest), /confirmed publication/);
});

test('uses at-ceiling budget semantics, stops dispatch, and preserves cancellation obligations', () => {
  const initial = createFleetState(manifest, 'run-3');
  const budget = consumeBudget(initial, manifest, { cost: 1 });
  assert.deepEqual(budget.exhausted, ['cost']);
  assert.equal(budget.state.control.budgetExhausted, true);
  assert.equal(budget.state.issues['1'].terminalDisposition, 'not-reached');
  assert.equal(budget.state.issues['1'].nextAction, 'await-renewed-human-confirmation');

  const cancelled = cancelFleet(initial, 'operator requested stop');
  assert.equal(cancelled.control.cancelled, true);
  assert.equal(cancelled.fleetDisposition, 'cancelled');
  assert.equal(cancelled.issues['1'].nextAction, 'await-new-human-invocation');
  assert.throws(
    () => transitionIssue(initial, '1', 'active'),
    /only be entered through validated assignment/,
  );
  assert.throws(
    () => transitionIssue(initial, '1', 'pending'),
    /validated handoff replacement/,
  );
});
