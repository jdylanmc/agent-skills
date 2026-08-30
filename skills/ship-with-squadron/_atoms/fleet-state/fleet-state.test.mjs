import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cancelFleet,
  consumeBudget,
  createFleetState,
  fleetStatePath,
  loadFleetState,
  persistFleetState,
  transitionIssue,
} from './fleet-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SANDBOX = path.join(ROOT, '.test-sandbox', 'ship-with-squadron-state');
const manifest = {
  digest: 'digest',
  issues: [{ identity: '1', sourceRevision: 'r1', acceptanceCriteria: ['done'], status: 'pending' }],
};

test('persists, rereads, and compare-and-swaps versioned run state', (t) => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  t.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));
  const file = fleetStatePath(SANDBOX, 'run-1');
  const initial = createFleetState(manifest, 'run-1', '2026-08-30T00:00:00Z');
  const written = persistFleetState(file, initial, 0);
  assert.equal(written.revision, 1);
  assert.equal(loadFleetState(file, manifest).issues['1'].sourceRevision, 'r1');
  assert.throws(() => persistFleetState(file, initial, 0), /revision conflict/);
});

test('rejects traversal and manifest/source revision drift', () => {
  assert.throws(() => fleetStatePath(SANDBOX, '../escape'), /path-safe/);
  const state = createFleetState(manifest, 'run-2');
  assert.throws(
    () => loadFleetState(path.join(SANDBOX, 'absent'), manifest),
    /ENOENT/,
  );
  assert.equal(state.manifestDigest, 'digest');
});

test('enforces transitions, budget exhaustion, and cancellation handoff state', () => {
  const initial = createFleetState(manifest, 'run-3');
  const active = transitionIssue(initial, '1', 'active', { reason: 'assigned' });
  assert.throws(() => transitionIssue(active, '1', 'active'), /invalid issue transition/);
  const budget = consumeBudget(active, {
    budget: { cost: 1, timeMinutes: 1, retries: 0 },
  }, { cost: 2 });
  assert.deepEqual(budget.exhausted, ['cost']);
  assert.equal(budget.state.fleetDisposition, 'budget-exhausted');
  const cancelled = cancelFleet(active, 'operator requested stop');
  assert.equal(cancelled.fleetDisposition, 'cancelled');
  assert.equal(cancelled.issues['1'].nextAction, 'capture-validated-orchestration-handoff');
});
