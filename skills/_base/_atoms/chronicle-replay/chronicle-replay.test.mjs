/**
 * Seam tests for the chronicle-replay atom.
 *
 * These cover the atom's own contract boundary: the command interface, its exit
 * codes, the shape of the state it prints, and the opaque log identity option.
 * Defect classification and bound revalidation belong to the chronicler
 * molecule and are tested there, not duplicated here.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run as runAppend } from '../chronicle-append/chronicle-append.mjs';
import { run as runReplay } from './chronicle-replay.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-replay-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function captureStreams() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (value) => out.push(value) },
    stderr: { write: (value) => err.push(value) },
    output: () => out.join(''),
    errors: () => err.join(''),
  };
}

function seededLog(t) {
  const logPath = path.join(workspace(t), '.skill-log', 'post-mortem.2026-08-20.run-7.jsonl');
  const append = (args) => {
    const streams = captureStreams();
    assert.equal(
      runAppend(['--log', logPath, '--run', 'run-7', '--root-skill', 'post-mortem', ...args], streams),
      0,
      streams.errors(),
    );
  };
  append(['--event', 'ticket', '--phase', 'before', '--summary', 'Claim ticket 3.', '--operation', 'ticket-3.1']);
  append([
    '--event', 'ticket', '--phase', 'after', '--summary', 'Ticket 3 merged.',
    '--operation', 'ticket-3.1', '--outcome', 'succeeded',
  ]);
  return logPath;
}

test('prints reconstructed state as JSON for a selected log', (t) => {
  const logPath = seededLog(t);
  const streams = captureStreams();

  assert.equal(runReplay([logPath], streams), 0, streams.errors());

  const state = JSON.parse(streams.output());
  assert.equal(state.log_id, logPath);
  assert.equal(state.run_id, 'run-7');
  assert.equal(state.root_skill, 'post-mortem');
  assert.equal(state.event_count, 2);
  assert.equal(state.complete, true);
  assert.deepEqual(state.defects, []);
  assert.equal(state.operations.length, 1);
  assert.equal(state.operations[0].started, 'L1');
  assert.equal(state.operations[0].completed, 'L2');
  assert.equal(state.operations[0].outcome, 'succeeded');
});

test('an opaque log id keeps the absolute path out of the result', (t) => {
  const logPath = seededLog(t);
  const streams = captureStreams();

  assert.equal(runReplay([logPath, '--log-id', 'selected-log-a'], streams), 0, streams.errors());

  const state = JSON.parse(streams.output());
  assert.equal(state.log_id, 'selected-log-a');
  assert.equal(streams.output().includes(logPath), false);
});

test('reports an unreadable selection and a missing selection on standard error', (t) => {
  const root = workspace(t);

  const unreadable = captureStreams();
  assert.equal(runReplay([path.join(root, 'missing.jsonl')], unreadable), 1);
  assert.match(unreadable.errors(), /log_unavailable:/);

  const usage = captureStreams();
  assert.equal(runReplay([], usage), 1);
  assert.match(usage.errors(), /a selected log path is required/);
});

test('rejects more than one selected log', (t) => {
  const logPath = seededLog(t);
  const streams = captureStreams();
  assert.equal(runReplay([logPath, logPath], streams), 1);
  assert.match(streams.errors(), /exactly one log path is accepted/);
});

test('probe reports availability without selecting a log', (t) => {
  const streams = captureStreams();
  assert.equal(runReplay(['--probe'], streams), 0);
  assert.match(streams.output(), /chronicle: available/);
});
