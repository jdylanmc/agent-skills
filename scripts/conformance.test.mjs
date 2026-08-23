/**
 * Chronicle conformance: the caller contract exercised exactly as a consuming
 * skill exercises it, by running the documented commands as child processes.
 *
 * This suite is intentionally black box. It never imports Chronicle internals,
 * so it proves the contract a skill author actually depends on, on every
 * supported operating system.
 *
 * Out of scope by design: power loss, disaster recovery, platform-native
 * append behavior, and any global cross-writer ordering guarantee.
 */

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { closureFor, readFrontmatter, validateRepository } from './validate-skill-graph.mjs';

const execFileAsync = promisify(execFile);

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ATOMS = path.join(REPOSITORY_ROOT, 'skills', '_base', '_atoms');
const EMIT = path.join(ATOMS, 'chronicle-append', 'chronicle-append.mjs');
const REPLAY = path.join(ATOMS, 'chronicle-replay', 'chronicle-replay.mjs');
const VALIDATOR = path.join(REPOSITORY_ROOT, 'scripts', 'validate-skill-graph.mjs');
const VALIDATE_WORKFLOW = path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml');

const RUN_ID = '20260820T120000Z-conformance';
const ROOT_SKILL = 'ship-with-squadron';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chronicle-conformance-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function logPathIn(root) {
  return path.join(root, '.skill-log', `${ROOT_SKILL}.2026-08-20.${RUN_ID}.jsonl`);
}

/** Runs a command the way a consuming skill does, without a shell. */
function runCommand(scriptPath, args) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      code: typeof error.status === 'number' ? error.status : 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    };
  }
}

function emitArgs(logPath, overrides = {}) {
  const values = {
    '--log': logPath,
    '--run': RUN_ID,
    '--root-skill': ROOT_SKILL,
    '--event': 'run',
    '--phase': 'before',
    '--summary': 'The run starts.',
    ...overrides,
  };
  return Object.entries(values).flatMap(([flag, value]) => (value === undefined ? [] : [flag, value]));
}

function readRecords(logPath) {
  return fs
    .readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function discoverTests(relativeRoot) {
  const absoluteRoot = path.join(REPOSITORY_ROOT, relativeRoot);
  const found = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
        found.push(path.relative(REPOSITORY_ROOT, absolute).split(path.sep).join('/'));
      }
    }
  };
  visit(absoluteRoot);
  return found;
}

function workflowTests() {
  const workflow = fs.readFileSync(VALIDATE_WORKFLOW, 'utf8');
  return [...workflow.matchAll(/(?:^|\s)((?:scripts|skills)\/\S+\.test\.mjs)(?=\s|$)/g)]
    .map((match) => match[1]);
}

test('the validation workflow runs every committed test file', () => {
  const discovered = [...discoverTests('scripts'), ...discoverTests('skills')].sort();
  const listed = new Set(workflowTests());
  const missing = discovered.filter((testFile) => !listed.has(testFile));

  assert.deepEqual(missing, [], `missing from .github/workflows/validate-skills.yml: ${missing.join(', ')}`);
});

test('the emit entry point is available on this platform', () => {
  const probe = runCommand(EMIT, ['--probe']);
  assert.equal(probe.code, 0, probe.stderr);
  assert.match(probe.stdout, /chronicle: available/);

  const replayProbe = runCommand(REPLAY, ['--probe']);
  assert.equal(replayProbe.code, 0, replayProbe.stderr);
  assert.match(replayProbe.stdout, /chronicle: available/);
});

test('a root skill records one event with injected attribution', (t) => {
  const logPath = logPathIn(workspace(t));
  const result = runCommand(EMIT, emitArgs(logPath));

  assert.equal(result.code, 0, result.stderr);
  const records = readRecords(logPath);
  assert.equal(records.length, 1);
  assert.equal(records[0].run_id, RUN_ID);
  assert.equal(records[0].root_skill, ROOT_SKILL);
  assert.equal(records[0].skill, ROOT_SKILL);
  assert.equal(records[0].schema_version, 2);
  assert.equal('sequence' in records[0], false, 'no writer-assigned sequence is persisted');
  assert.ok(Date.parse(records[0].timestamp) > 0);
});

test('a nested skill inherits the run context and shares the same log', (t) => {
  const logPath = logPathIn(workspace(t));

  assert.equal(runCommand(EMIT, emitArgs(logPath)).code, 0);
  assert.equal(
    runCommand(EMIT, emitArgs(logPath, {
      '--skill': 'shepherd',
      '--event': 'pull_request',
      '--phase': 'after',
      '--summary': 'Shepherd merged the pull request.',
      '--outcome': 'succeeded',
    })).code,
    0,
  );

  const replay = runCommand(REPLAY, [logPath, '--log-id', 'conformance-run']);
  assert.equal(replay.code, 0, replay.stderr);
  const state = JSON.parse(replay.stdout);

  assert.equal(state.run_id, RUN_ID);
  assert.equal(state.root_skill, ROOT_SKILL);
  assert.deepEqual(state.skills, ['shepherd', 'ship-with-squadron']);
  assert.equal(state.log_id, 'conformance-run');
});

test('invalid caller input is rejected with a stable category and records nothing', (t) => {
  const logPath = logPathIn(workspace(t));

  const badPhase = runCommand(EMIT, emitArgs(logPath, { '--phase': 'sideways' }));
  assert.equal(badPhase.code, 1);
  assert.match(badPhase.stderr, /^invalid_input:/m);

  const missing = runCommand(EMIT, ['--log', logPath]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^usage:/m);

  assert.equal(fs.existsSync(logPath), false, 'a rejected event must not create a log');
});

test('an over-long summary is bounded and marked truncated', (t) => {
  const logPath = logPathIn(workspace(t));
  const result = runCommand(EMIT, emitArgs(logPath, {
    '--phase': 'observation',
    '--summary': 'y'.repeat(2000),
  }));

  assert.equal(result.code, 0, result.stderr);
  const [record] = readRecords(logPath);
  assert.equal(record.truncated, true);
  assert.ok(Buffer.byteLength(record.summary, 'utf8') <= 500);
  assert.ok(Buffer.byteLength(JSON.stringify(record), 'utf8') <= 4096);
});

test('ordinary concurrent writers all land in the log and remain readable', async (t) => {
  const logPath = logPathIn(workspace(t));
  const writers = 12;

  await Promise.all(
    Array.from({ length: writers }, (_, index) => execFileAsync(process.execPath, [
      EMIT,
      ...emitArgs(logPath, {
        '--skill': `worker-${index}`,
        '--event': 'ticket',
        '--phase': 'observation',
        '--summary': `Worker ${index} reported progress.`,
      }),
    ])),
  );

  const records = readRecords(logPath);
  assert.equal(records.length, writers, 'every concurrent record must survive');
  assert.deepEqual(
    [...new Set(records.map((record) => record.run_id))],
    [RUN_ID],
    'concurrent writers must not corrupt run identity',
  );
  assert.deepEqual(
    records.map((record) => record.skill).sort(),
    Array.from({ length: writers }, (_, index) => `worker-${index}`).sort(),
  );

  // Replay assigns order from log position, so ordinary concurrency is clean
  // rather than merely tolerated.
  const replay = runCommand(REPLAY, [logPath, '--log-id', 'concurrent']);
  assert.equal(replay.code, 0, replay.stderr);
  const state = JSON.parse(replay.stdout);
  assert.equal(state.event_count, writers);
  assert.deepEqual(state.defects, [], 'concurrency must not manufacture defects');
  assert.equal(state.complete, true);
});

test('an unusable log is reported and the caller can continue', (t) => {
  const root = workspace(t);
  const blocker = path.join(root, 'blocker');
  fs.writeFileSync(blocker, 'not a directory\n');

  const failed = runCommand(EMIT, emitArgs(path.join(blocker, 'nested', 'run.jsonl')));
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /^log_unavailable:/m);

  // Delivery continues: a later event to a usable log still records.
  const recovered = runCommand(EMIT, emitArgs(logPathIn(root)));
  assert.equal(recovered.code, 0, recovered.stderr);
});

test('replay of the same selected log is deterministic', (t) => {
  const logPath = logPathIn(workspace(t));
  const start = runCommand(EMIT, emitArgs(logPath, { '--operation': 'ticket-1' }));
  assert.equal(start.code, 0, start.stderr);
  const finish = runCommand(EMIT, emitArgs(logPath, {
    '--phase': 'after',
    '--summary': 'The run finished.',
    '--operation': 'ticket-1',
    '--outcome': 'succeeded',
    '--evidence': 'PR-42',
  }));
  assert.equal(finish.code, 0, finish.stderr);

  const first = runCommand(REPLAY, [logPath, '--log-id', 'deterministic']);
  const second = runCommand(REPLAY, [logPath, '--log-id', 'deterministic']);

  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stdout, second.stdout);

  const state = JSON.parse(first.stdout);
  assert.equal(state.complete, true);
  assert.deepEqual(state.operations, [
    { operation: 'ticket-1', skill: ROOT_SKILL, started: 'L1', completed: 'L2', outcome: 'succeeded' },
  ]);
});

test('a malformed record is reported and never repaired', (t) => {
  const logPath = logPathIn(workspace(t));
  const first = runCommand(EMIT, emitArgs(logPath));
  assert.equal(first.code, 0, first.stderr);
  fs.appendFileSync(logPath, 'this line is not json\n');
  const second = runCommand(EMIT, emitArgs(logPath, { '--phase': 'after', '--summary': 'The run finished.' }));
  assert.equal(second.code, 0, second.stderr);

  const before = fs.readFileSync(logPath, 'utf8');
  const replay = runCommand(REPLAY, [logPath, '--log-id', 'malformed']);
  assert.equal(replay.code, 0, replay.stderr);

  const state = JSON.parse(replay.stdout);
  assert.equal(state.complete, false);
  assert.equal(state.event_count, 2);
  assert.ok(state.defects.some((defect) => defect.type === 'malformed_record' && defect.anchor === 'L2'));
  assert.equal(fs.readFileSync(logPath, 'utf8'), before, 'replay must not rewrite the selected log');
});

test('replay reports a selection it cannot read at all', (t) => {
  const missing = runCommand(REPLAY, [path.join(workspace(t), 'absent.jsonl')]);
  assert.equal(missing.code, 1);
  assert.match(missing.stderr, /^log_unavailable:/m);
});

test('the Chronicle units stay out of skill routing and keep a complete dependency closure', () => {
  const validation = runCommand(VALIDATOR, []);
  assert.equal(validation.code, 0, validation.stderr);
  assert.match(validation.stdout, /Validated \d+ participating Markdown files/);

  const baseRoot = path.join(REPOSITORY_ROOT, 'skills', '_base');
  const routableEntryPoints = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'SKILL.md') {
        routableEntryPoints.push(path.relative(REPOSITORY_ROOT, full));
      }
    }
  };
  walk(baseRoot);
  assert.deepEqual(routableEntryPoints, [], 'nothing under _base may contain SKILL.md at any depth');

  const routable = fs
    .readdirSync(path.join(REPOSITORY_ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(REPOSITORY_ROOT, 'skills', entry.name, 'SKILL.md')))
    .map((entry) => entry.name);

  assert.equal(routable.includes('_base'), false, '_base must not appear in the routable inventory');
});

test('the log path convention documented for consumers is what consumers can use', (t) => {
  const root = workspace(t);
  const logPath = logPathIn(root);
  assert.equal(runCommand(EMIT, emitArgs(logPath)).code, 0);

  assert.equal(path.basename(path.dirname(logPath)), '.skill-log');
  assert.match(path.basename(logPath), /^ship-with-squadron\.\d{4}-\d{2}-\d{2}\..+\.jsonl$/);
  assert.ok(fs.existsSync(logPath));
});

test('Ship with Squadron composes Chronicle through a complete dependency closure', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const closure = closureFor(result, 'ship-with-squadron/SKILL.md');

  assert.ok(closure.includes('_base/_molecules/chronicler/chronicler.md'), 'the consumer must reach the Chronicler molecule');
  assert.ok(
    closure.includes('_base/_atoms/chronicle-append/chronicle-append.md'),
    'the consumer must reach the append atom through the molecule',
  );
  assert.ok(
    closure.includes('_base/_atoms/chronicle-replay/chronicle-replay.md'),
    'the consumer must reach the replay atom through the molecule',
  );
  assert.ok(closure.includes('ship-with-squadron/references/25-run-recording.md'));
  assert.ok(
    result.routableSkills.includes('ship-with-squadron'),
    'the consumer stays routable while its base does not',
  );
});


test('Ship with Squadron uses local bounded timeout handoff composition without external handoff', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const skillPath = path.join(REPOSITORY_ROOT, 'skills', 'ship-with-squadron', 'SKILL.md');
  const adapterPath = path.join(
    REPOSITORY_ROOT,
    'skills',
    'ship-with-squadron',
    '_atoms',
    'timeout-handoff-context-adapter',
    'timeout-handoff-context-adapter.md',
  );
  const skillRaw = fs.readFileSync(skillPath, 'utf8');
  const adapterRaw = fs.readFileSync(adapterPath, 'utf8');
  const skillFrontmatter = readFrontmatter(skillRaw, 'ship-with-squadron/SKILL.md');
  const adapterFrontmatter = readFrontmatter(
    adapterRaw,
    'ship-with-squadron/_atoms/timeout-handoff-context-adapter/timeout-handoff-context-adapter.md',
  );

  assert.equal(skillFrontmatter.composes, null);
  assert.equal(skillFrontmatter.disableModelInvocation, null);
  assert.equal(skillFrontmatter.userInvocable, null);
  assert.deepEqual(skillFrontmatter.allowedTools, ['*']);
  assert.deepEqual(skillFrontmatter.requiresSkills, [
    { id: 'roast-this-code', source: 'local', required: true },
    { id: 'shepherd', source: 'local', required: true },
  ]);
  assert.deepEqual(adapterFrontmatter.includes, []);
  assert.deepEqual(adapterFrontmatter.composes, []);

  const closure = closureFor(result, 'ship-with-squadron/SKILL.md');
  assert.ok(closure.includes('ship-with-squadron/_atoms/timeout-handoff-context-adapter/timeout-handoff-context-adapter.md'));
  assert.ok(closure.includes('_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md'));
  assert.ok(skillFrontmatter.includes.includes('_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.md'));
  assert.doesNotMatch(skillRaw, /## External Prerequisite/);
  // Match against whitespace-normalized text: these assertions must survive a
  // reflow of the source and a CRLF checkout on Windows.
  const adapterText = reflowed(adapterRaw);
  assert.ok(adapterText.includes(
    'The handoff is human-readable continuation context and never substituted by '
      + 'the timeout envelope.',
  ));
  assert.ok(adapterText.includes(
    'The verified handoff path is recorded in control state and in the timeout '
      + 'envelope before worker termination.',
  ));
  assert.ok(adapterText.includes(
    'Recovery slices are based only on verified evidence, and a timed-out worker is '
      + 'never reactivated.',
  ));
});

test('every routable skill directly composes Chronicle through a complete dependency closure', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const chronicler = '_base/_molecules/chronicler/chronicler.md';
  const append = '_base/_atoms/chronicle-append/chronicle-append.md';
  const replay = '_base/_atoms/chronicle-replay/chronicle-replay.md';

  for (const skill of result.routableSkills) {
    const entry = `${skill}/SKILL.md`;
    assert.ok(
      result.graph.get(entry)?.includes(chronicler),
      `${entry} must directly compose the Chronicler molecule`,
    );
    const closure = closureFor(result, entry);
    assert.ok(closure.includes(chronicler), `${entry} must reach Chronicler`);
    assert.ok(closure.includes(append), `${entry} must reach Chronicle append`);
    assert.ok(closure.includes(replay), `${entry} must reach Chronicle replay`);
  }
});

test('the universal Chronicle contract requires complete best-effort shared-run lifecycle recording', () => {
  const chronicler = fs.readFileSync(
    path.join(
      REPOSITORY_ROOT,
      'skills/_base/_molecules/chronicler/chronicler.md',
    ),
    'utf8',
  );
  const contract = sectionBody(chronicler, '## Invocation Contract');

  assert.match(contract, /Before the skill's core workflow/);
  assert.match(contract, /reuse a caller-supplied run context or\s+create the root context once/);
  assert.match(contract, /paired `before` and `after` event for each material operation/);
  assert.match(contract, /Pass `run_id`, `root_skill`, and `log_path` unchanged/);
  assert.match(contract, /Before every terminal return/);
  assert.match(contract, /continue the skill/);
  assert.match(contract, /Do not\s+retry in a loop/);
});

test('Squadron Control State holds current state only, not a duplicate history', () => {
  const controlState = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/ship-with-squadron/references/20-control-state-and-state-machine.md'),
    'utf8',
  );

  assert.match(controlState, /`control\.json`/);
  assert.doesNotMatch(controlState, /events\.jsonl|snapshots\//);
});

// Assertions about prose must survive a routine reflow of the source file, so
// they match against whitespace-normalized text rather than a specific wrap.
function reflowed(contents) {
  return contents.replace(/\s+/g, ' ');
}

function sectionBody(contents, heading) {
  const lines = contents.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  assert.notEqual(start, -1, `expected a ${heading} section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

test('control-state failure and recording failure keep opposite delivery semantics', () => {
  const controlState = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/ship-with-squadron/references/20-control-state-and-state-machine.md'),
    'utf8',
  );
  const recording = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/ship-with-squadron/references/25-run-recording.md'),
    'utf8',
  );

  // Structural, not prose matching: the control-state failure procedure must
  // stop delivery, and the recording failure procedure must continue it.
  const controlFailure = sectionBody(controlState, '## Control-State Failure');
  assert.match(controlFailure, /\bstop\b/i);
  assert.doesNotMatch(controlFailure, /\bcontinue claiming\b/i);

  const recordingFailure = sectionBody(recording, '## Recording Failure');
  assert.match(recordingFailure, /\bcontinue\b/i);
  assert.doesNotMatch(recordingFailure, /\bblock\w* delivery\b/i);

  assert.match(sectionBody(recording, '## Boundary'), /never authorizes/i);
});

test('run recording pairs exactly one intent and one outcome per ticket', () => {
  const recording = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/ship-with-squadron/references/25-run-recording.md'),
    'utf8',
  );
  const rows = recording
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.includes('---') && !line.includes('| Phase |'));

  const afterRows = rows.filter((row) => row.includes('`after`') && row.includes('the attempt ID'));
  const beforeRows = rows.filter((row) => row.includes('`before`') && row.includes('the attempt ID'));

  assert.equal(beforeRows.length, 1, 'an attempt must record exactly one intent');
  assert.equal(afterRows.length, 1, 'an attempt must record exactly one outcome');
  // Retries must stay distinguishable, so the identifier is attempt-qualified.
  assert.match(recording, /attempt ID is `<ticket-key>\.<attempt>`/);
});

test('consumer instructions expose no Chronicle storage or platform mechanics', () => {
  const consumerFiles = [
    path.join(REPOSITORY_ROOT, 'skills/ship-with-squadron/SKILL.md'),
    ...fs
      .readdirSync(path.join(REPOSITORY_ROOT, 'skills/ship-with-squadron/references'))
      .map((name) => path.join(REPOSITORY_ROOT, 'skills/ship-with-squadron/references', name)),
  ];

  const forbidden = /fsync|O_APPEND|power.?loss|disaster recovery|native append|stream_closed|parent_stream|hash chain|retention engine/i;
  for (const file of consumerFiles) {
    const contents = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(contents, forbidden, `${path.basename(file)} must not expose recording internals`);
  }
});

test('Post-Mortem composes Chronicle and keeps its selected-log evidence reference', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const closure = closureFor(result, 'post-mortem/SKILL.md');

  assert.ok(closure.includes('_base/_molecules/chronicler/chronicler.md'));
  assert.ok(closure.includes('_base/_atoms/chronicle-append/chronicle-append.md'));
  assert.ok(closure.includes('_base/_atoms/chronicle-replay/chronicle-replay.md'));
  assert.ok(closure.includes('post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md'));
  assert.ok(result.routableSkills.includes('post-mortem'));
});

test('Post-Mortem log anchors cannot collide with its session anchors', () => {
  const contract = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/post-mortem/_atoms/evidence-anchor-ledger/evidence-anchor-ledger.md'),
    'utf8',
  );
  const evidence = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md'),
    'utf8',
  );

  // Session anchors already claim R for artifacts, so a log anchor must be
  // qualified rather than reusing a bare session letter.
  assert.match(contract, /`R1`, `R2`: generated or inspected artifacts/);
  assert.match(evidence, /`L1:12`/);
  assert.match(contract, /`L1:12`/);
});

test('Post-Mortem stays read-only and bounded to operator-selected runs', () => {
  const skill = fs.readFileSync(path.join(REPOSITORY_ROOT, 'skills/post-mortem/SKILL.md'), 'utf8');
  const evidence = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md'),
    'utf8',
  );

  const allowed = /^allowed-tools: (\[.*\])$/m.exec(skill);
  assert.ok(allowed, 'the skill must declare allowed tools');
  assert.deepEqual(JSON.parse(allowed[1]), ['read', 'search', 'execute']);
  assert.doesNotMatch(skill, /"edit"|"task"|"\*"/);

  assert.match(sectionBody(evidence, '## Boundaries'), /read only/i);
  assert.match(sectionBody(evidence, '## Selection'), /exactly one run by default/i);
});

test('Post-Mortem may reach OBSERVED only across independent selected runs', () => {
  const output = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/post-mortem/_atoms/reinforcement-assign-state/reinforcement-assign-state.md'),
    'utf8',
  );
  const evidence = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md'),
    'utf8',
  );

  // The gate is "two or more independent selected runs". Matching the bare
  // word "independent" would pass even if the gate were deleted, because the
  // surrounding prose already uses it.
  const lifecycle = reflowed(sectionBody(output, '## Operation'));
  assert.match(lifecycle, /two or more independent Skill Run Logs/i);
  assert.match(lifecycle, /can never mark a candidate `VALIDATED` or `PROMOTED`/i);

  const recurrence = reflowed(sectionBody(evidence, '## Recurrence'));
  assert.match(recurrence, /Two or more independently selected runs/i);
  assert.match(recurrence, /Repetition inside one run is not recurrence/i);

  // The required output schema must permit the state the lifecycle allows.
  const record = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/post-mortem/_atoms/postmortem-render-record/postmortem-render-record.md'),
    'utf8',
  );
  assert.match(record, /status: PROPOSED \| OBSERVED/);

  const regression = reflowed(
    sectionBody(
      fs.readFileSync(
        path.join(REPOSITORY_ROOT, 'skills/post-mortem/_atoms/postmortem-regression-check/postmortem-regression-check.md'),
        'utf8',
      ),
      '## Operation',
    ),
  );
  // Bounded and lazy so the match cannot run past scenario 8a into 8b.
  assert.match(regression, /single selected Skill Run Log[\s\S]{0,120}?`PROPOSED`/i);
  assert.match(regression, /two attempts at the same work/i);
});

test('Post-Mortem never offers log evidence merely because the session is incomplete', () => {
  const skill = fs.readFileSync(path.join(REPOSITORY_ROOT, 'skills/post-mortem/SKILL.md'), 'utf8');
  const evidence = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills/post-mortem/_molecules/runlog-obtain-evidence/runlog-obtain-evidence.md'),
    'utf8',
  );

  assert.match(skill, /Never offer this source merely because session evidence is incomplete/i);
  assert.match(sectionBody(evidence, '## Selection'), /Never offer it unprompted/i);
  assert.match(sectionBody(evidence, '## Selection'), /Never search the filesystem for logs/i);
  assert.match(sectionBody(evidence, '## Replay'), /no usable event/i);
});
