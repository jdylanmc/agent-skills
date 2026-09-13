/**
 * Adversarial tests for Chronicle.
 *
 * Every defect fixed in issue #31 was invisible to review and surfaced within
 * seconds of hostile input. This suite exists so that class of defect fails
 * here instead of shipping: torn records, unsafe log targets, semantically
 * corrupt histories, concurrent writers, and malformed bytes.
 */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  ChronicleError,
  MAX_IDENTIFIER_BYTES,
  MAX_REFERENCE_BYTES,
  MAX_SUMMARY_BYTES,
  emitEvent,
  replayLog,
} from './chronicler.mjs';

const execFileAsync = promisify(execFile);
const EMIT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '_atoms',
  'chronicle-append',
  'chronicle-append.mjs',
);

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-adversarial-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function contextIn(root, name = 'run.jsonl') {
  return { run_id: 'r1', root_skill: 'demo', log_path: path.join(root, '.skill-log', name) };
}

function persist(logPath, records) {
  const base = {
    schema_version: 2,
    run_id: 'r1',
    root_skill: 'demo',
    skill: 'demo',
    timestamp: '2026-08-20T12:00:00.000Z',
  };
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, `${records.map((r) => JSON.stringify({ ...base, ...r })).join('\n')}\n`);
}

test('a torn final record cannot swallow the next event', (t) => {
  const context = contextIn(workspace(t));
  emitEvent({ event: 'run', phase: 'before', summary: 'first' }, context);
  // A writer that stopped mid-record leaves no trailing newline.
  fs.appendFileSync(context.log_path, '{"schema_version":2,"run_id":"r1"');
  emitEvent({ event: 'run', phase: 'after', summary: 'second', outcome: 'ok' }, context);

  const state = replayLog(context.log_path);
  assert.equal(state.event_count, 2, 'the event after a torn record must survive');
  assert.deepEqual(state.defects.map((d) => d.type), ['malformed_record']);
});

test('emit refuses a target that is not a Skill Run Log', (t) => {
  const root = workspace(t);
  const event = { event: 'run', phase: 'before', summary: 'x' };

  const plain = path.join(root, 'precious.txt');
  fs.writeFileSync(plain, 'important user data\n');
  assert.throws(() => emitEvent(event, { run_id: 'r1', root_skill: 'd', log_path: plain }), /\.jsonl/);
  assert.equal(fs.readFileSync(plain, 'utf8'), 'important user data\n');

  const decoy = path.join(root, 'decoy.jsonl');
  fs.writeFileSync(decoy, 'not a log\n');
  assert.throws(
    () => emitEvent(event, { run_id: 'r1', root_skill: 'd', log_path: decoy }),
    /not a Skill Run Log/,
  );
  assert.equal(fs.readFileSync(decoy, 'utf8'), 'not a log\n');

  const directory = path.join(root, 'dir.jsonl');
  fs.mkdirSync(directory);
  assert.throws(
    () => emitEvent(event, { run_id: 'r1', root_skill: 'd', log_path: directory }),
    /regular file/,
  );
});

test('emit refuses to write through a symbolic link', { skip: process.platform === 'win32' }, (t) => {
  const root = workspace(t);
  const target = path.join(root, 'target.txt');
  const link = path.join(root, 'link.jsonl');
  fs.writeFileSync(target, 'target\n');
  fs.symlinkSync(target, link);

  assert.throws(
    () => emitEvent({ event: 'run', phase: 'before', summary: 'x' }, { run_id: 'r1', root_skill: 'd', log_path: link }),
    /symbolic link/,
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'target\n');
});

test('replay reports semantically corrupt histories rather than passing them', (t) => {
  const root = workspace(t);
  const cases = [
    ['operation_out_of_order', [
      { event: 't', phase: 'after', operation: 'op1', outcome: 'ok', summary: 'done' },
      { event: 't', phase: 'before', operation: 'op1', summary: 'start' },
    ]],
    ['duplicate_operation_outcome', [
      { event: 't', phase: 'before', operation: 'op1', summary: 's' },
      { event: 't', phase: 'after', operation: 'op1', outcome: 'ok', summary: 'd' },
      { event: 't', phase: 'after', operation: 'op1', outcome: 'failed', summary: 'd2' },
    ]],
    ['duplicate_operation_start', [
      { event: 't', phase: 'before', operation: 'op1', summary: 's' },
      { event: 't', phase: 'before', operation: 'op1', summary: 's again' },
      { event: 't', phase: 'after', operation: 'op1', outcome: 'ok', summary: 'd' },
    ]],
    ['run_identity_drift', [
      { event: 't', phase: 'observation', summary: 'a' },
      { event: 't', phase: 'observation', summary: 'b', root_skill: 'other' },
    ]],
  ];

  for (const [expected, records] of cases) {
    const logPath = path.join(root, `${expected}.jsonl`);
    persist(logPath, records);
    const state = replayLog(logPath);
    assert.equal(state.complete, false, expected);
    assert.ok(state.defects.some((d) => d.type === expected), `${expected} not reported`);
  }
});

test('replay revalidates persisted bounds instead of trusting the writer', (t) => {
  const root = workspace(t);
  const oversized = [
    ['summary', { event: 't', phase: 'observation', summary: 'x'.repeat(MAX_SUMMARY_BYTES + 1) }],
    ['identifier', { event: 'e'.repeat(MAX_IDENTIFIER_BYTES + 1), phase: 'observation', summary: 's' }],
    ['evidence', {
      event: 't',
      phase: 'observation',
      summary: 's',
      evidence: ['y'.repeat(MAX_REFERENCE_BYTES + 1)],
    }],
    ['control characters', { event: 't', phase: 'observation', summary: 'line\nbreak' }],
  ];

  for (const [label, record] of oversized) {
    const logPath = path.join(root, `${label.replace(/\s/g, '-')}.jsonl`);
    persist(logPath, [record]);
    const state = replayLog(logPath);
    assert.equal(state.complete, false, label);
    assert.ok(state.defects.some((d) => d.type === 'invalid_record'), `${label} not reported`);
  }
});

test('ordinary concurrent writers produce a clean log', async (t) => {
  const context = contextIn(workspace(t));
  const writers = 40;

  await Promise.all(
    Array.from({ length: writers }, (_, index) => execFileAsync(process.execPath, [
      EMIT,
      '--log', context.log_path,
      '--run', context.run_id,
      '--root-skill', context.root_skill,
      '--skill', `worker-${index}`,
      '--event', 'ticket',
      '--phase', 'observation',
      '--summary', `worker ${index} reported progress`,
    ])),
  );

  const state = replayLog(context.log_path);
  assert.equal(state.event_count, writers, 'every concurrent record must survive');
  assert.deepEqual(state.defects, [], 'concurrency must not manufacture defects');
  assert.deepEqual(
    state.events.map((event) => event.sequence),
    Array.from({ length: writers }, (_, index) => index + 1),
    'replay assigns a contiguous sequence from log position',
  );
});

test('emit rejects hostile caller input without creating anything', (t) => {
  const root = workspace(t);
  const context = contextIn(root);
  const hostile = [
    { event: 'run', phase: 'before', summary: 'tab\there' },
    { event: 'run', phase: 'before', summary: 'newline\nhere' },
    { event: 'run', phase: 'before', summary: 'carriage\rreturn' },
    { event: 'run', phase: 'before', summary: 'null\u0000byte' },
    { event: '../../escape', phase: 'before', summary: 's' },
    { event: 'run', phase: 'before', summary: 's', operation: 'has space' },
    { event: 'run', phase: 'before', summary: 's', evidence: [{ nested: true }] },
    { event: 'run', phase: 'before', summary: 's', unexpected: 'field' },
  ];

  for (const input of hostile) {
    assert.throws(() => emitEvent(input, context), ChronicleError, JSON.stringify(input));
  }
  assert.equal(fs.existsSync(path.dirname(context.log_path)), false);
});

test('replay never throws on arbitrary bytes and never rewrites the log', (t) => {
  const root = workspace(t);
  const logPath = path.join(root, 'fuzz.jsonl');
  const lines = [];
  let seed = 7;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  for (let index = 0; index < 200; index += 1) {
    const length = Math.floor(random() * 60);
    let line = '';
    for (let position = 0; position < length; position += 1) {
      line += String.fromCharCode(32 + Math.floor(random() * 200));
    }
    lines.push(line);
  }
  fs.writeFileSync(logPath, `${lines.join('\n')}\n`);
  const before = fs.readFileSync(logPath);

  const state = replayLog(logPath);
  assert.equal(state.complete, false);
  assert.ok(state.defects.length > 0);
  assert.deepEqual(fs.readFileSync(logPath), before, 'replay must never rewrite the log');
});

test('truncation lands on a codepoint boundary and preserves valid trailing characters', (t) => {
  const context = contextIn(workspace(t));

  const multibyte = emitEvent(
    { event: 'run', phase: 'observation', summary: 'é'.repeat(MAX_SUMMARY_BYTES) },
    context,
  );
  assert.equal(multibyte.truncated, true);
  assert.ok(Buffer.byteLength(multibyte.summary, 'utf8') <= MAX_SUMMARY_BYTES);
  assert.equal(multibyte.summary.includes('\uFFFD'), false);
  assert.equal(multibyte.summary, 'é'.repeat(MAX_SUMMARY_BYTES / 2));

  // A summary that legitimately ends in a replacement character must keep it.
  const withinBounds = emitEvent(
    { event: 'run', phase: 'observation', summary: `${'a'.repeat(10)}\uFFFD` },
    context,
  );
  assert.equal(withinBounds.truncated, undefined);
  assert.ok(withinBounds.summary.endsWith('\uFFFD'));

  const state = replayLog(context.log_path);
  assert.equal(state.complete, true, 'bounded records must replay cleanly');
});
