import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MAX_SCANNED_SESSIONS,
  defaultProcessLineage,
  defaultIsAlive,
  publishedLogId,
  readSelectedSession,
  resolveSessionSelection,
} from './copilot-session-events.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const READER = path.join(HERE, 'copilot-session-events.mjs');

const SESSION_LOG = `${JSON.stringify({
  type: 'session.start',
  data: { sessionId: 'fixture' },
  id: 'a',
  timestamp: '2026-01-01T00:00:00.000Z',
})}\n`;

function withRoot(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-session-selection-'));
  try {
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/** A session directory as the runtime lays one out: a log, and a lock per holder. */
function makeSession(root, sessionId, { pids = [], log = true } = {}) {
  const directory = path.join(root, sessionId);
  fs.mkdirSync(directory, { recursive: true });
  if (log) {
    fs.writeFileSync(path.join(directory, 'events.jsonl'), SESSION_LOG);
  }
  for (const pid of pids) {
    fs.writeFileSync(path.join(directory, `inuse.${pid}.lock`), '');
  }
  return path.join(directory, 'events.jsonl');
}

const alive = (living) => (pid) => living.includes(pid);
/** A lineage the platform could actually walk. */
const lineage = (pids) => () => ({ pids, status: 'walked', reason: null });
/** A platform that cannot report a lineage at all, as Windows does. */
const noLineage = (pids = [1234]) => () => ({
  pids,
  status: 'unavailable',
  reason: 'process lineage is not read on Windows',
});

test('an operator-named path is the strongest identity and needs nothing else', () => {
  withRoot((root) => {
    const logPath = makeSession(root, 'session-a');
    const resolution = resolveSessionSelection({ explicitPath: logPath, environment: {} });

    assert.equal(resolution.status, 'selected');
    assert.equal(resolution.path, logPath);
    assert.deepEqual(resolution.identity, { kind: 'explicit-path', session_id: null, pid: null });
    assert.deepEqual(resolution.notes, []);
  });
});

test('a named path is checked the same way a runtime transcript is', () => {
  withRoot((root) => {
    makeSession(root, 'session-a');

    const absent = resolveSessionSelection({
      explicitPath: path.join(root, 'session-a', 'absent.jsonl'),
      environment: {},
    });
    assert.equal(absent.status, 'unavailable');
    assert.equal(absent.reason.code, 'unreadable_selection');

    const directory = resolveSessionSelection({
      explicitPath: path.join(root, 'session-a'),
      environment: {},
    });
    assert.equal(directory.status, 'unavailable');
    assert.equal(directory.reason.code, 'unreadable_selection');
  });
});

test('an exact runtime transcript is accepted, and a missing one is refused rather than searched', () => {
  withRoot((root) => {
    const transcript = makeSession(root, 'session-a');

    const found = resolveSessionSelection({ transcriptPath: transcript, environment: {} });
    assert.equal(found.status, 'selected');
    assert.equal(found.identity.kind, 'runtime-transcript');

    const absent = resolveSessionSelection({
      transcriptPath: path.join(root, 'gone', 'events.jsonl'),
      stateRoot: root,
      environment: {},
      isAlive: alive([]),
    });
    assert.equal(absent.status, 'unavailable');
    assert.equal(absent.reason.code, 'runtime_transcript_missing');
  });
});

test('a named session identifier resolves under the root, and an unknown one is refused', () => {
  withRoot((root) => {
    makeSession(root, 'session-a');

    const found = resolveSessionSelection({ sessionId: 'session-a', stateRoot: root, environment: {} });
    assert.equal(found.status, 'selected');
    assert.equal(found.path, path.join(root, 'session-a', 'events.jsonl'));
    assert.deepEqual(found.identity, { kind: 'session-id', session_id: 'session-a', pid: null });

    const missing = resolveSessionSelection({
      sessionId: 'session-b',
      stateRoot: root,
      environment: {},
    });
    assert.equal(missing.status, 'unavailable');
    assert.equal(missing.reason.code, 'session_id_not_found');
  });
});

test('a session identifier that tries to leave its root is refused', () => {
  withRoot((root) => {
    makeSession(root, 'session-a');

    for (const hostile of ['../session-a', 'nested/session-a', '..']) {
      const resolution = resolveSessionSelection({
        sessionId: hostile,
        stateRoot: root,
        environment: {},
      });
      assert.equal(resolution.status, 'unavailable');
      assert.equal(resolution.reason.code, 'session_id_invalid');
    }
  });
});

test('discovery selects the one live session this process lineage holds', () => {
  withRoot((root) => {
    makeSession(root, 'session-mine', { pids: [4242] });
    makeSession(root, 'session-other', { pids: [5150] });

    const resolution = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242, 5150]),
      processLineage: lineage([99, 4242]),
    });

    assert.equal(resolution.status, 'selected');
    assert.equal(resolution.path, path.join(root, 'session-mine', 'events.jsonl'));
    assert.deepEqual(resolution.identity, {
      kind: 'live-process-lock',
      session_id: 'session-mine',
      pid: 4242,
    });
    assert.deepEqual(resolution.notes.map((note) => note.code), ['identity_rests_on_process_id']);
  });
});

test('discovery selects a sole live session, and says the identity rests on that', () => {
  withRoot((root) => {
    makeSession(root, 'session-live', { pids: [4242] });
    makeSession(root, 'session-finished', { pids: [909] });
    makeSession(root, 'session-idle');

    const resolution = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242]),
      processLineage: lineage([31337]),
    });

    assert.equal(resolution.status, 'selected');
    assert.equal(resolution.identity.kind, 'sole-live-session');
    assert.deepEqual(
      resolution.notes.map((note) => note.code),
      ['session_identity_from_sole_live_session', 'identity_rests_on_process_id'],
    );
    assert.match(resolution.notes[0].detail, /only running session/);
  });
});

test('two live sessions with no lineage match are ambiguous, and nothing is read', () => {
  withRoot((root) => {
    makeSession(root, 'session-a', { pids: [4242] });
    makeSession(root, 'session-b', { pids: [5150] });

    const resolution = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242, 5150]),
      processLineage: lineage([31337]),
    });

    assert.equal(resolution.status, 'unavailable');
    assert.equal(resolution.reason.code, 'session_identity_ambiguous');
    assert.equal(resolution.candidates, 2);
    assert.equal(resolution.path, undefined);
  });
});

test('a lineage holding two live sessions is ambiguous rather than resolved to either', () => {
  withRoot((root) => {
    makeSession(root, 'session-a', { pids: [4242] });
    makeSession(root, 'session-b', { pids: [4243] });

    const resolution = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242, 4243]),
      processLineage: lineage([4242, 4243]),
    });

    assert.equal(resolution.status, 'unavailable');
    assert.equal(resolution.reason.code, 'session_identity_ambiguous');
    assert.equal(resolution.candidates, 2);
  });
});

test('a stale lock is not a candidate, so a dead session never resolves', () => {
  withRoot((root) => {
    makeSession(root, 'session-dead', { pids: [909] });

    const resolution = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([]),
      processLineage: lineage([31337]),
    });

    assert.equal(resolution.status, 'unavailable');
    assert.equal(resolution.reason.code, 'session_identity_unavailable');
    assert.equal(resolution.candidates, 0);
  });
});

test('a live session with no log is not a candidate', () => {
  withRoot((root) => {
    makeSession(root, 'session-live-no-log', { pids: [4242], log: false });

    const resolution = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242]),
      processLineage: lineage([4242]),
    });

    assert.equal(resolution.status, 'unavailable');
    assert.equal(resolution.reason.code, 'session_identity_unavailable');
  });
});

test('the newest session is never the answer', () => {
  withRoot((root) => {
    const older = makeSession(root, 'session-older', { pids: [4242] });
    const newer = makeSession(root, 'session-newer', { pids: [5150] });
    fs.utimesSync(older, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
    fs.utimesSync(newer, new Date(), new Date());

    const resolution = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242, 5150]),
      processLineage: lineage([31337]),
    });

    assert.equal(resolution.status, 'unavailable');
    assert.equal(resolution.reason.code, 'session_identity_ambiguous');
  });
});

test('an unreadable or unknown session root refuses instead of widening the search', () => {
  withRoot((root) => {
    const unreadable = resolveSessionSelection({
      stateRoot: path.join(root, 'absent'),
      environment: {},
      isAlive: alive([]),
      processLineage: lineage([]),
    });
    assert.equal(unreadable.reason.code, 'session_root_unreadable');

    const unknown = resolveSessionSelection({ environment: {}, isAlive: alive([]) });
    assert.equal(unknown.reason.code, 'session_root_unknown');

    const namedWithoutRoot = resolveSessionSelection({ sessionId: 'session-a', environment: {} });
    assert.equal(namedWithoutRoot.reason.code, 'session_root_unknown');
  });
});

test('the session root comes from the runtime environment, never from a guess at the home directory', () => {
  withRoot((root) => {
    makeSession(root, 'session-a', { pids: [4242] });
    const home = path.dirname(root);

    const configured = resolveSessionSelection({
      environment: { COPILOT_SESSION_STATE_ROOT: root },
      isAlive: alive([4242]),
      processLineage: lineage([4242]),
    });
    assert.equal(configured.identity.session_id, 'session-a');

    const fromHome = resolveSessionSelection({
      environment: { COPILOT_HOME: home },
      isAlive: alive([4242]),
      processLineage: lineage([4242]),
    });
    assert.equal(fromHome.status, 'unavailable');
    assert.equal(fromHome.reason.code, 'session_root_unreadable');

    const named = resolveSessionSelection({
      environment: { COPILOT_HOME: home },
      stateRoot: root,
      isAlive: alive([4242]),
      processLineage: lineage([4242]),
    });
    assert.equal(named.identity.kind, 'live-process-lock');
  });
});

test('a session root larger than the scan bound refuses rather than scanning without limit', () => {
  withRoot((root) => {
    for (let index = 0; index < 3; index += 1) {
      makeSession(root, `session-${index}`, { pids: [4242] });
    }

    const resolution = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242]),
      processLineage: lineage([4242]),
      maxSessions: 2,
    });

    assert.equal(resolution.status, 'unavailable');
    assert.equal(resolution.reason.code, 'session_root_too_large');
    assert.match(resolution.reason.detail, /more than 2 sessions \(3\)/);
    assert.ok(MAX_SCANNED_SESSIONS > 2, 'the shipped bound is far larger than this fixture');
  });
});

test('the liveness probe treats a process it may not signal as alive', () => {
  assert.equal(defaultIsAlive(process.pid), true);
  assert.equal(defaultIsAlive(2 ** 30), false);

  if (process.platform !== 'win32') {
    // Process 1 exists and refuses the signal, which is still evidence it is
    // running. Windows has no equivalent guaranteed process id.
    assert.equal(defaultIsAlive(1), true);
  }
});

test('the process lineage starts at this process, never loops, and states whether it was read', () => {
  const lineageResult = defaultProcessLineage();

  assert.equal(lineageResult.pids[0], process.pid);
  assert.equal(new Set(lineageResult.pids).size, lineageResult.pids.length);
  assert.ok(lineageResult.pids.every((pid) => Number.isInteger(pid) && pid > 0));
  assert.ok(['walked', 'unavailable'].includes(lineageResult.status));

  if (process.platform === 'win32') {
    assert.equal(lineageResult.status, 'unavailable', 'Windows exposes no lineage to this reader');
    assert.match(lineageResult.reason, /Windows/);
  } else {
    assert.equal(lineageResult.status, 'walked');
    assert.ok(lineageResult.pids.length >= 1);
  }
});

test('a platform with no readable lineage degrades honestly rather than guessing', () => {
  withRoot((root) => {
    // One running session: still selectable, but the claim is weaker and says so.
    makeSession(root, 'session-only', { pids: [4242] });
    const sole = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242]),
      processLineage: noLineage(),
    });

    assert.equal(sole.status, 'selected');
    assert.equal(sole.identity.kind, 'sole-live-session');
    assert.deepEqual(
      sole.notes.map((note) => note.code).sort(),
      ['identity_rests_on_process_id', 'process_lineage_unavailable', 'session_identity_from_sole_live_session'],
    );

    // Two running sessions: on this platform neither can be proved, and the
    // refusal says the platform is why.
    makeSession(root, 'session-rival', { pids: [5150] });
    const ambiguous = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242, 5150]),
      processLineage: noLineage(),
    });

    assert.equal(ambiguous.status, 'unavailable');
    assert.equal(ambiguous.reason.code, 'session_identity_ambiguous');
    assert.match(ambiguous.reason.detail, /this platform cannot prove which is this one/);
    assert.deepEqual(ambiguous.notes.map((note) => note.code), ['process_lineage_unavailable']);
  });
});

test('a lineage-backed identity still says it rests on a process id', () => {
  withRoot((root) => {
    makeSession(root, 'session-mine', { pids: [4242] });

    const resolution = resolveSessionSelection({
      stateRoot: root,
      environment: {},
      isAlive: alive([4242]),
      processLineage: lineage([99, 4242]),
    });

    assert.equal(resolution.identity.kind, 'live-process-lock');
    assert.deepEqual(resolution.notes.map((note) => note.code), ['identity_rests_on_process_id']);
  });
});

test('a published log identity is never an absolute path', () => {
  assert.equal(
    publishedLogId({ sessionId: 'session-1', sourcePath: '/home/someone/events.jsonl' }),
    'session:session-1',
  );
  assert.match(
    publishedLogId({ sessionId: null, sourcePath: '/home/someone/events.jsonl' }),
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.equal(publishedLogId({ requestedLogId: 'run-7', sessionId: 'session-1' }), 'run-7');
  // A caller that hands in a path as its "opaque" identity does not get to
  // publish it, whatever it was called.
  assert.match(
    publishedLogId({ requestedLogId: '/home/someone/events.jsonl', sessionId: null }),
    /^sha256:[0-9a-f]{64}$/,
  );
  assert.match(
    publishedLogId({ requestedLogId: 'C:\\Users\\someone\\events.jsonl', sessionId: null }),
    /^sha256:[0-9a-f]{64}$/,
  );
  // The digest is stable for one path and different for another.
  assert.equal(
    publishedLogId({ sourcePath: '/a/events.jsonl' }),
    publishedLogId({ sourcePath: '/a/events.jsonl' }),
  );
  assert.notEqual(
    publishedLogId({ sourcePath: '/a/events.jsonl' }),
    publishedLogId({ sourcePath: '/b/events.jsonl' }),
  );
});

test('reading a selected log publishes a session identity, never the path it came from', () => {
  withRoot((root) => {
    const identified = makeSession(root, 'session-a');
    const withSession = readSelectedSession(identified);
    assert.equal(withSession.log_id, 'session:fixture');
    assert.ok(!JSON.stringify(withSession).includes(root));

    const anonymousDirectory = path.join(root, 'anonymous');
    fs.mkdirSync(anonymousDirectory, { recursive: true });
    const anonymous = path.join(anonymousDirectory, 'events.jsonl');
    fs.writeFileSync(anonymous, `${JSON.stringify({
      type: 'assistant.turn_start',
      data: { turnId: 't1' },
      timestamp: '2026-01-01T00:00:00.000Z',
    })}\n`);

    const unidentified = readSelectedSession(anonymous);
    assert.match(unidentified.log_id, /^sha256:[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(unidentified).includes(anonymousDirectory));
  });
});

test('the command line resolves a proved session and refuses an ambiguous root', () => {
  withRoot((root) => {
    makeSession(root, 'session-only', { pids: [process.pid] });

    const resolved = JSON.parse(execFileSync(
      'node',
      [READER, '--session-root', root, '--resolve'],
      { encoding: 'utf8' },
    ));
    assert.equal(resolved.status, 'selected');
    assert.equal(resolved.identity.session_id, 'session-only');

    const read = JSON.parse(execFileSync('node', [READER, '--session-root', root], {
      encoding: 'utf8',
    }));
    assert.equal(read.log_id, 'session:session-only');
    // Which kind of proof is available is a property of the platform: a lineage
    // walk on POSIX, and the sole-running-session rule where no lineage can be
    // read. Both are legitimate identities; only the strength differs.
    assert.ok(['live-process-lock', 'sole-live-session'].includes(read.identity.kind));
    if (process.platform !== 'win32') {
      assert.equal(read.identity.kind, 'live-process-lock');
    }
    assert.equal(read.session_id, 'fixture');

    makeSession(root, 'session-rival', { pids: [process.ppid] });
    const refusal = (() => {
      try {
        execFileSync('node', [READER, '--session-root', root], { encoding: 'utf8', stdio: 'pipe' });
        return null;
      } catch (error) {
        return JSON.parse(error.stderr);
      }
    })();

    assert.equal(refusal.error.code, 'session_identity_ambiguous');
  });
});

test('a named session identifier still wins over a root that would be ambiguous', () => {
  withRoot((root) => {
    makeSession(root, 'session-a', { pids: [4242] });
    makeSession(root, 'session-b', { pids: [5150] });

    const resolution = resolveSessionSelection({
      sessionId: 'session-b',
      stateRoot: root,
      environment: {},
      isAlive: alive([4242, 5150]),
      processLineage: lineage([31337]),
    });

    assert.equal(resolution.status, 'selected');
    assert.equal(resolution.identity.kind, 'session-id');
  });
});
