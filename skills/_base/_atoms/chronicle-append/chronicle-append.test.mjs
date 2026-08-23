/**
 * Seam tests for the chronicle-append atom.
 *
 * These cover the atom's own contract boundary: the command interface, its exit
 * codes, its stable failure categories, and the one record it appends. The
 * shared validation and bounds live in the chronicler molecule and are tested
 * there, not duplicated here.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { run as runAppend } from './chronicle-append.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-append-'));
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

function logPathIn(root) {
  return path.join(root, '.skill-log', 'ship-with-squadron.2026-08-20.run-1.jsonl');
}

test('appends one record and reports success on standard output', (t) => {
  const logPath = logPathIn(workspace(t));
  const streams = captureStreams();

  const code = runAppend(
    [
      '--log', logPath,
      '--run', 'run-1',
      '--root-skill', 'ship-with-squadron',
      '--event', 'run',
      '--phase', 'before',
      '--summary', 'Run started.',
    ],
    streams,
  );

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(streams.output()), { recorded: true });

  const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.event, 'run');
  assert.equal(record.phase, 'before');
  assert.equal(record.summary, 'Run started.');
  assert.equal(record.skill, 'ship-with-squadron');
});

test('a nested participant names itself without changing the run', (t) => {
  const logPath = logPathIn(workspace(t));
  const streams = captureStreams();

  assert.equal(
    runAppend(
      [
        '--log', logPath,
        '--run', 'run-1',
        '--root-skill', 'ship-with-squadron',
        '--skill', 'shepherd',
        '--event', 'delegation',
        '--phase', 'observation',
        '--summary', 'Shepherd took the pull request.',
        '--evidence', 'PR-42',
      ],
      streams,
    ),
    0,
  );

  const record = JSON.parse(fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean)[0]);
  assert.equal(record.skill, 'shepherd');
  assert.equal(record.root_skill, 'ship-with-squadron');
  assert.deepEqual(record.evidence, ['PR-42']);
});

test('reports usage and recording failures on standard error', (t) => {
  const logPath = logPathIn(workspace(t));

  const missing = captureStreams();
  assert.equal(runAppend(['--log', logPath], missing), 1);
  assert.match(missing.errors(), /usage: missing required argument/);

  const unknown = captureStreams();
  assert.equal(runAppend(['--nope', 'x'], unknown), 1);
  assert.match(unknown.errors(), /unknown argument: --nope/);

  const invalid = captureStreams();
  assert.equal(
    runAppend(
      [
        '--log', logPath,
        '--run', 'run-1',
        '--root-skill', 'ship-with-squadron',
        '--event', 'run',
        '--phase', 'nowhere',
        '--summary', 'Bad phase.',
      ],
      invalid,
    ),
    1,
  );
  assert.match(invalid.errors(), /invalid_input: phase must be one of/);
});

test('rejects a flag used as a value', (t) => {
  const logPath = logPathIn(workspace(t));
  const streams = captureStreams();
  assert.equal(
    runAppend(
      ['--log', logPath, '--run', 'run-1', '--root-skill', 'ship-with-squadron', '--summary', '--event'],
      streams,
    ),
    1,
  );
  assert.match(streams.errors(), /--summary requires a value/);
});

test('probe reports availability without touching the log', (t) => {
  const logPath = logPathIn(workspace(t));
  const streams = captureStreams();
  assert.equal(runAppend(['--probe'], streams), 0);
  assert.match(streams.output(), /chronicle: available/);
  assert.equal(fs.existsSync(path.dirname(logPath)), false);
});
