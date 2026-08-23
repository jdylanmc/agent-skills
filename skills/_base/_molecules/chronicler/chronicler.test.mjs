import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ChronicleError,
  MAX_EVENT_BYTES,
  MAX_EVIDENCE_ITEMS,
  MAX_IDENTIFIER_BYTES,
  MAX_SUMMARY_BYTES,
  buildEvent,
  emitEvent,
  replayLog,
} from './chronicler.mjs';
import { run as runEmit } from '../../_atoms/chronicle-append/chronicle-append.mjs';
import { run as runReplay } from '../../_atoms/chronicle-replay/chronicle-replay.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function contextFor(root) {
  return {
    run_id: '20260820T120000Z-abc',
    root_skill: 'ship-with-squadron',
    log_path: path.join(root, '.skill-log', 'ship-with-squadron.2026-08-20.20260820T120000Z-abc.jsonl'),
  };
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

test('injects attribution, timestamp, and schema for the caller', (t) => {
  const context = contextFor(workspace(t));
  const event = emitEvent(
    { event: 'run', phase: 'before', summary: 'Start the delivery run.' },
    context,
  );

  assert.equal(event.schema_version, 2);
  assert.equal(event.run_id, context.run_id);
  assert.equal(event.root_skill, 'ship-with-squadron');
  assert.equal(event.skill, 'ship-with-squadron');
  assert.equal('sequence' in event, false, 'no writer-assigned sequence is persisted');
  assert.match(event.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(event.event, 'run');
  assert.equal(event.phase, 'before');
});

test('a nested skill inherits the run and shares one log with explicit attribution', (t) => {
  const context = contextFor(workspace(t));

  emitEvent({ event: 'run', phase: 'before', summary: 'Root begins.' }, context);
  emitEvent(
    { skill: 'shepherd', event: 'pull_request_review', phase: 'observation', summary: 'Nested skill observed a review.' },
    context,
  );

  const state = replayLog(context.log_path);
  assert.equal(state.complete, true);
  assert.equal(state.event_count, 2);
  assert.equal(state.run_id, context.run_id);
  assert.deepEqual(state.skills, ['shepherd', 'ship-with-squadron']);
  assert.deepEqual(state.events.map((event) => event.anchor), ['L1', 'L2']);
  assert.deepEqual(state.events.map((event) => event.sequence), [1, 2]);
});

test('rejects caller input that does not satisfy the contract', (t) => {
  const context = contextFor(workspace(t));
  const invalid = [
    { event: 'run', phase: 'sideways', summary: 'Bad phase.' },
    { event: 'run', phase: 'before', summary: '   ' },
    { event: '', phase: 'before', summary: 'Missing event name.' },
    { event: 'run', phase: 'before', summary: 'Control\u0007character.' },
    { event: 'run', phase: 'before', summary: 'Bad evidence.', evidence: 'not-an-array' },
  ];

  for (const input of invalid) {
    assert.throws(() => emitEvent(input, context), ChronicleError, JSON.stringify(input));
  }
  assert.equal(fs.existsSync(context.log_path), false, 'an invalid event must not create a log');
});

test('rejects a run context that is not usable', (t) => {
  const root = workspace(t);
  assert.throws(
    () => emitEvent({ event: 'run', phase: 'before', summary: 'No path.' }, { run_id: 'r', root_skill: 's' }),
    /log_path must be an absolute path/,
  );
  assert.throws(
    () => emitEvent(
      { event: 'run', phase: 'before', summary: 'Relative path.' },
      { run_id: 'r', root_skill: 's', log_path: '.skill-log/run.jsonl' },
    ),
    /log_path must be an absolute path/,
  );
  assert.throws(
    () => emitEvent(
      { event: 'run', phase: 'before', summary: 'Bad run id.' },
      { run_id: 'not valid', root_skill: 's', log_path: path.join(root, 'log.jsonl') },
    ),
    /run_id must be a non-empty identifier/,
  );
});

test('bounds an over-long summary and evidence and marks the event truncated', (t) => {
  const context = contextFor(workspace(t));
  const event = emitEvent(
    {
      event: 'run',
      phase: 'observation',
      summary: 'x'.repeat(MAX_SUMMARY_BYTES + 250),
      evidence: Array.from({ length: MAX_EVIDENCE_ITEMS + 5 }, (_, index) => `PR-${index}`),
    },
    context,
  );

  assert.equal(Buffer.byteLength(event.summary, 'utf8'), MAX_SUMMARY_BYTES);
  assert.equal(event.evidence.length, MAX_EVIDENCE_ITEMS);
  assert.equal(event.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(event), 'utf8') <= MAX_EVENT_BYTES);
});

test('truncates a multi-byte summary on a character boundary', (t) => {
  const context = contextFor(workspace(t));
  const event = emitEvent(
    { event: 'run', phase: 'observation', summary: 'é'.repeat(MAX_SUMMARY_BYTES) },
    context,
  );

  assert.equal(event.truncated, true);
  assert.ok(Buffer.byteLength(event.summary, 'utf8') <= MAX_SUMMARY_BYTES);
  assert.equal(event.summary.includes('\uFFFD'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(event)).summary, event.summary);
});

test('rejects an identifier that is not bounded', () => {
  assert.throws(
    () => buildEvent(
      { event: 'e'.repeat(MAX_IDENTIFIER_BYTES + 1), phase: 'observation', summary: 'ok' },
      { run_id: 'r1', root_skill: 's1' },
    ),
    /event must not exceed 100 bytes/,
  );
});

test('a worst-case bounded event stays inside the total event limit', () => {
  const event = buildEvent(
    {
      skill: 's'.repeat(MAX_IDENTIFIER_BYTES),
      event: 'e'.repeat(MAX_IDENTIFIER_BYTES),
      operation: 'o'.repeat(MAX_IDENTIFIER_BYTES),
      outcome: 'x'.repeat(MAX_IDENTIFIER_BYTES),
      phase: 'after',
      summary: 'y'.repeat(MAX_SUMMARY_BYTES * 2),
      evidence: Array.from({ length: MAX_EVIDENCE_ITEMS * 2 }, () => 'z'.repeat(400)),
    },
    { run_id: 'r'.repeat(MAX_IDENTIFIER_BYTES), root_skill: 'b'.repeat(MAX_IDENTIFIER_BYTES) },
  );

  assert.equal(event.truncated, true);
  assert.ok(
    Buffer.byteLength(JSON.stringify(event), 'utf8') <= MAX_EVENT_BYTES,
    'every field bound is chosen so a valid event cannot exceed the total limit',
  );
});

test('reports an unusable log without stopping the caller', (t) => {
  const root = workspace(t);
  const blocker = path.join(root, 'blocker');
  fs.writeFileSync(blocker, 'not a directory\n');

  let reported = null;
  try {
    emitEvent(
      { event: 'run', phase: 'before', summary: 'Recording is unavailable.' },
      { run_id: 'r1', root_skill: 's1', log_path: path.join(blocker, 'nested', 'run.jsonl') },
    );
  } catch (error) {
    reported = error;
  }

  assert.ok(reported instanceof ChronicleError);
  assert.equal(reported.code, 'log_unavailable');
});

test('replays operations and pairs intent with outcome', (t) => {
  const context = contextFor(workspace(t));
  emitEvent({ event: 'run', phase: 'before', summary: 'Run starts.' }, context);
  emitEvent({ event: 'ticket', phase: 'before', summary: 'Claim ticket 7.', operation: 'ticket-7' }, context);
  emitEvent(
    {
      event: 'ticket',
      phase: 'after',
      summary: 'Ticket 7 merged.',
      operation: 'ticket-7',
      outcome: 'succeeded',
      evidence: ['PR-42'],
    },
    context,
  );

  const state = replayLog(context.log_path, { logId: 'run-under-test' });
  assert.equal(state.complete, true);
  assert.equal(state.log_id, 'run-under-test');
  assert.deepEqual(state.operations, [
    { operation: 'ticket-7', skill: 'ship-with-squadron', started: 'L2', completed: 'L3', outcome: 'succeeded' },
  ]);
});

test('reports an operation that records intent with no outcome', (t) => {
  const context = contextFor(workspace(t));
  emitEvent({ event: 'ticket', phase: 'before', summary: 'Claim ticket 9.', operation: 'ticket-9' }, context);

  const state = replayLog(context.log_path);
  assert.equal(state.complete, false);
  assert.deepEqual(
    state.defects.map((defect) => [defect.type, defect.anchor]),
    [['incomplete_operation', 'L1']],
  );
});

test('reports an outcome with no recorded intent', (t) => {
  const context = contextFor(workspace(t));
  emitEvent(
    { event: 'ticket', phase: 'after', summary: 'Ticket 9 merged.', operation: 'ticket-9', outcome: 'succeeded' },
    context,
  );

  const state = replayLog(context.log_path);
  assert.deepEqual(
    state.defects.map((defect) => defect.type),
    ['unmatched_outcome'],
  );
});

test('keeps valid records usable after a malformed record and never repairs it', (t) => {
  const context = contextFor(workspace(t));
  emitEvent({ event: 'run', phase: 'before', summary: 'Run starts.' }, context);
  fs.appendFileSync(context.log_path, '{ this is not json\n');
  fs.appendFileSync(context.log_path, `${JSON.stringify({ schema_version: 99, run_id: 'x' })}\n`);
  emitEvent({ event: 'run', phase: 'after', summary: 'Run ends.', outcome: 'succeeded' }, context);

  const state = replayLog(context.log_path);
  assert.equal(state.event_count, 2);
  assert.equal(state.complete, false);
  const types = state.defects.map((defect) => defect.type);
  assert.ok(types.includes('malformed_record'));
  assert.ok(types.includes('invalid_record'));
  assert.deepEqual(state.events.map((event) => event.anchor), ['L1', 'L4']);

  const persisted = fs.readFileSync(context.log_path, 'utf8');
  assert.ok(persisted.includes('{ this is not json'), 'replay must not rewrite the log');
});

test('reports a record that belongs to a different run', (t) => {
  const context = contextFor(workspace(t));
  emitEvent({ event: 'run', phase: 'before', summary: 'Run starts.' }, context);
  const foreign = { ...contextFor(path.dirname(path.dirname(context.log_path))), run_id: 'other-run' };
  foreign.log_path = context.log_path;
  emitEvent({ event: 'run', phase: 'observation', summary: 'Foreign record.' }, foreign);

  const state = replayLog(context.log_path);
  assert.equal(state.run_id, context.run_id);
  assert.equal(state.event_count, 1);
  assert.deepEqual(
    state.defects.map((defect) => [defect.type, defect.anchor]),
    [['foreign_run', 'L2']],
  );
});

test('rejects a record that carries a writer-assigned sequence', (t) => {
  const context = contextFor(workspace(t));
  emitEvent({ event: 'run', phase: 'before', summary: 'Run starts.' }, context);
  const first = JSON.parse(fs.readFileSync(context.log_path, 'utf8').trim());
  fs.appendFileSync(context.log_path, `${JSON.stringify({ ...first, sequence: 9 })}\n`);

  const state = replayLog(context.log_path);
  assert.deepEqual(
    state.defects.map((defect) => [defect.type, defect.anchor]),
    [['invalid_record', 'L2']],
  );
  // Replay assigns position, so the surviving record is still sequence 1.
  assert.deepEqual(state.events.map((event) => event.sequence), [1]);
});

test('reports an empty log rather than inventing state', (t) => {
  const root = workspace(t);
  const logPath = path.join(root, 'empty.jsonl');
  fs.writeFileSync(logPath, '');

  const state = replayLog(logPath);
  assert.equal(state.complete, false);
  assert.equal(state.run_id, null);
  assert.deepEqual(state.defects.map((defect) => defect.type), ['no_usable_records']);
});

test('reports a log that cannot be read at all', (t) => {
  const root = workspace(t);
  assert.throws(() => replayLog(path.join(root, 'missing.jsonl')), /cannot read the selected Skill Run Log/);
});

test('emit and replay commands round-trip through the documented entry points', (t) => {
  const context = contextFor(workspace(t));
  const emitStreams = captureStreams();

  const emitCode = runEmit(
    [
      '--log', context.log_path,
      '--run', context.run_id,
      '--root-skill', context.root_skill,
      '--skill', 'shepherd',
      '--event', 'pull_request',
      '--phase', 'after',
      '--summary', 'Merged pull request 42.',
      '--operation', 'pr-42',
      '--outcome', 'succeeded',
      '--evidence', 'PR-42',
    ],
    emitStreams,
  );

  assert.equal(emitCode, 0, emitStreams.errors());
  assert.deepEqual(JSON.parse(emitStreams.output()), { recorded: true });

  const replayStreams = captureStreams();
  const replayCode = runReplay([context.log_path, '--log-id', 'selected-run'], replayStreams);
  assert.equal(replayCode, 0, replayStreams.errors());

  const state = JSON.parse(replayStreams.output());
  assert.equal(state.log_id, 'selected-run');
  assert.equal(state.events[0].skill, 'shepherd');
  assert.deepEqual(state.events[0].evidence, ['PR-42']);
});

test('reports an operation that records intent more than once', (t) => {
  const context = contextFor(workspace(t));
  emitEvent({ event: 'ticket', phase: 'before', summary: 'Claim ticket 3.', operation: 'ticket-3' }, context);
  emitEvent({ event: 'ticket', phase: 'before', summary: 'Claim ticket 3 again.', operation: 'ticket-3' }, context);
  emitEvent(
    { event: 'ticket', phase: 'after', summary: 'Ticket 3 merged.', operation: 'ticket-3', outcome: 'succeeded' },
    context,
  );

  const state = replayLog(context.log_path);
  assert.deepEqual(
    state.defects.map((defect) => [defect.type, defect.anchor]),
    [['duplicate_operation_start', 'L2']],
  );
  assert.equal(state.operations[0].started, 'L1');
  assert.equal(state.operations[0].completed, 'L3');
});

test('an observation that references an operation creates no operation entry', (t) => {
  const context = contextFor(workspace(t));
  emitEvent(
    { event: 'degradation', phase: 'observation', summary: 'Provider was unavailable.', operation: 'ticket-5' },
    context,
  );

  const state = replayLog(context.log_path);
  assert.deepEqual(state.operations, []);
  assert.equal(state.complete, true);
});

test('anchors the run to the first usable record even when it is unexpected', (t) => {
  const context = contextFor(workspace(t));
  const foreign = { ...context, run_id: 'stale-run' };
  emitEvent({ event: 'run', phase: 'observation', summary: 'Stale record first.' }, foreign);
  emitEvent({ event: 'run', phase: 'observation', summary: 'Intended record second.' }, context);

  const state = replayLog(context.log_path);
  assert.equal(state.run_id, 'stale-run');
  assert.equal(state.event_count, 1);
  assert.deepEqual(
    state.defects.map((defect) => [defect.type, defect.anchor]),
    [['foreign_run', 'L2']],
  );
});

test('rejects a log id that is unbounded or carries control characters', (t) => {
  const context = contextFor(workspace(t));
  emitEvent({ event: 'run', phase: 'observation', summary: 'Run observed.' }, context);

  assert.throws(() => replayLog(context.log_path, { logId: 'x'.repeat(400) }), /log id must be clean text/);
  assert.throws(() => replayLog(context.log_path, { logId: 'bad\u0007id' }), /log id must be clean text/);
});

test('an invalid event leaves no log directory behind', (t) => {
  const root = workspace(t);
  const logPath = path.join(root, '.skill-log', 'demo.jsonl');
  assert.throws(
    () => emitEvent(
      { event: 'run', phase: 'sideways', summary: 'Bad phase.' },
      { run_id: 'r1', root_skill: 's1', log_path: logPath },
    ),
    ChronicleError,
  );
  assert.equal(fs.existsSync(path.dirname(logPath)), false);
});
