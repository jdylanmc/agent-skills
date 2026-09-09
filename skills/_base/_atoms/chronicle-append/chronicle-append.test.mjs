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
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.writeFileSync(
    path.join(root, 'scripts', 'compaction-rehydration-register.mjs'),
    "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('{\"tracked\":true}\\n'));\n",
  );
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

test('records the harness and session the run belongs to when they are supplied', (t) => {
  const logPath = logPathIn(workspace(t));
  const streams = captureStreams();

  assert.equal(
    runAppend(
      [
        '--log', logPath,
        '--run', 'run-1',
        '--root-skill', 'ship-with-squadron',
        '--harness', 'copilot-cli',
        '--session', '4749a42e-fa4c-4c52-82f0-479483ddabe0',
        '--event', 'run',
        '--phase', 'before',
        '--summary', 'Run started.',
      ],
      streams,
    ),
    0,
    streams.errors(),
  );

  const record = JSON.parse(fs.readFileSync(logPath, 'utf8').split('\n')[0]);
  assert.equal(record.harness, 'copilot-cli');
  assert.equal(record.session_id, '4749a42e-fa4c-4c52-82f0-479483ddabe0');
});

test('omitting the correlation flags records no correlation fields at all', (t) => {
  const logPath = logPathIn(workspace(t));
  const streams = captureStreams();

  assert.equal(
    runAppend(
      [
        '--log', logPath,
        '--run', 'run-1',
        '--root-skill', 'ship-with-squadron',
        '--event', 'run',
        '--phase', 'before',
        '--summary', 'Run started.',
      ],
      streams,
    ),
    0,
    streams.errors(),
  );

  const record = JSON.parse(fs.readFileSync(logPath, 'utf8').split('\n')[0]);
  assert.equal('harness' in record, false);
  assert.equal('session_id' in record, false);
});

test('refuses a session identity that is a path rather than an opaque identifier', (t) => {
  const logPath = logPathIn(workspace(t));
  const streams = captureStreams();

  assert.equal(
    runAppend(
      [
        '--log', logPath,
        '--run', 'run-1',
        '--root-skill', 'ship-with-squadron',
        '--session', '/Users/someone/.copilot/session-state/abc/events.jsonl',
        '--event', 'run',
        '--phase', 'before',
        '--summary', 'Run started.',
      ],
      streams,
    ),
    1,
  );
  assert.match(streams.errors(), /invalid_input: session_id must be a non-empty identifier/);
  assert.equal(fs.existsSync(logPath), false);
});

test('required initial registration fails closed when the tracker is missing', (t) => {
  const root = workspace(t);
  fs.rmSync(path.join(root, 'scripts', 'compaction-rehydration-register.mjs'));
  const logPath = logPathIn(root);
  const streams = captureStreams();

  const code = runAppend([
    '--log', logPath,
    '--run', 'run-1',
    '--root-skill', 'ship-with-squadron',
    '--event', 'run',
    '--phase', 'before',
    '--summary', 'Run started.',
  ], streams);

  assert.equal(code, 2);
  assert.deepEqual(JSON.parse(streams.output()), {
    recorded: true,
    rehydrationTracked: false,
  });
  assert.match(streams.errors(), /rehydration_registration_failed: Chronicle event recorded/);
  assert.equal(fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length, 1);
});

test('required initial registration fails closed on tracker crash and explicit nonzero', (t) => {
  for (const [name, source] of [
    ['crash', "throw new Error('tracker crashed');\n"],
    ['nonzero', "process.stderr.write('tracker refused\\n'); process.exitCode = 7;\n"],
  ]) {
    const root = workspace(t);
    fs.writeFileSync(path.join(root, 'scripts', 'compaction-rehydration-register.mjs'), source);
    const streams = captureStreams();
    const code = runAppend([
      '--log', logPathIn(root),
      '--run', `run-${name}`,
      '--root-skill', 'ship-with-squadron',
      '--event', 'run',
      '--phase', 'before',
      '--summary', 'Run started.',
    ], streams);

    assert.equal(code, 2, name);
    assert.match(streams.errors(), /rehydration_registration_failed/, name);
  }
});

test('an actual registration timeout is explicit and fail-open', (t) => {
  const logPath = logPathIn(workspace(t));
  const streams = captureStreams();
  const timeout = Object.assign(new Error('spawnSync timed out'), { code: 'ETIMEDOUT' });

  const code = runAppend([
    '--log', logPath,
    '--run', 'run-timeout',
    '--root-skill', 'ship-with-squadron',
    '--event', 'run',
    '--phase', 'before',
    '--summary', 'Run started.',
  ], streams, {
    spawnSync: () => ({ status: null, signal: 'SIGTERM', error: timeout, stderr: '' }),
  });

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(streams.output()), {
    recorded: true,
    rehydrationTracked: false,
    registrationTimeout: true,
  });
  assert.match(streams.errors(), /rehydration_registration_timeout: .*continuing fail-open/);
});

test('non-lifecycle tracker failure remains separate best-effort checkpoint recording', (t) => {
  const root = workspace(t);
  fs.rmSync(path.join(root, 'scripts', 'compaction-rehydration-register.mjs'));
  const streams = captureStreams();

  const code = runAppend([
    '--log', logPathIn(root),
    '--run', 'run-observation',
    '--root-skill', 'ship-with-squadron',
    '--event', 'delegation',
    '--phase', 'observation',
    '--summary', 'Observed.',
  ], streams);

  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(streams.output()), { recorded: true });
  assert.match(streams.errors(), /rehydration_tracking_failed/);
  assert.doesNotMatch(streams.errors(), /rehydration_registration_failed/);
});
