/**
 * Behavioural tests for the self-roast remediation ledger.
 *
 * Each test is named for the rule it protects. These rules are the damper on a
 * loop where the thing being reviewed and the thing doing the reviewing come
 * from the same place, so every one of them is stated here as something the
 * machine refuses rather than something the caller is asked to remember.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DUCKED_PRIORITIES,
  LedgerError,
  MANDATORY_PRIORITIES,
  PRIORITIES,
  ROUNDS_BEFORE_RECONFIRMATION,
  applyEvent,
  assertGateIntegrity,
  createLedger,
  isProtectedGatePath,
  ledgerReport,
  parseArguments,
  roastStatus,
  run as runLedger,
  stopReport,
  waysForward,
} from './roast-round-ledger.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t, prefix = 'roast-round-ledger-') {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(SANDBOX_ROOT, prefix));
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

function finding(id, priority, overrides = {}) {
  return {
    id,
    priority,
    location: 'skills/demo/SKILL.md:12',
    evidence: 'the description carries no negative trigger',
    consequence: 'a router cannot tell this skill from its neighbour',
    recommendation: 'add a "Do not use ..." clause to the description',
    validation: 're-read the description and confirm the clause is present',
    ...overrides,
  };
}

/** A ledger holding one finding of each priority, roasted at head `h0`. */
function seeded() {
  const state = createLedger({ packagePath: 'skills/demo', head: 'h0' });
  applyEvent(state, {
    type: 'roast-recorded',
    head: 'h0',
    findings: [
      finding('F-1', 'Must fix'),
      finding('F-2', 'Should fix'),
      finding('F-3', 'Consider'),
    ],
  });
  return state;
}

function refusal(t, run) {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof LedgerError, `expected a LedgerError, got ${error}`);
    return error;
  }
  assert.fail('the ledger accepted an event it must refuse');
  return null;
}

test('a Must fix finding is resolved and can never be rubber-ducked away', () => {
  for (const closing of ['duck-verdict', 'finding-declined', 'finding-deferred']) {
    const state = seeded();
    const error = refusal({}, () =>
      applyEvent(state, {
        type: closing,
        findingId: 'F-1',
        verdict: 'decline',
        reasoning: 'the rule does not apply here',
      }));
    assert.equal(error.code, 'mandatory_finding_not_duckable', `${closing} must be refused`);
    assert.equal(state.dispositions['F-1'].state, 'open');
    assert.equal(state.dispositions['F-1'].verdict, null);
  }
});

test('a Must fix finding closes only on a correction that moves the head', () => {
  const state = seeded();
  refusal({}, () => applyEvent(state, { type: 'finding-resolved', findingId: 'F-1', head: 'h0' }));
  applyEvent(state, { type: 'finding-resolved', findingId: 'F-1', head: 'h1' });
  assert.equal(state.dispositions['F-1'].state, 'resolved');
  assert.equal(state.head, 'h1');
});

test('a Should fix finding is never applied without a rubber-duck verdict', () => {
  const state = seeded();
  const error = refusal({}, () =>
    applyEvent(state, { type: 'finding-resolved', findingId: 'F-2', head: 'h1' }));
  assert.equal(error.code, 'verdict_required');
  assert.equal(state.head, 'h0', 'a refused application must not move the head');

  applyEvent(state, {
    type: 'duck-verdict',
    findingId: 'F-2',
    verdict: 'apply',
    reasoning: 'the cited rule says what the finding claims and the evidence shows it',
  });
  applyEvent(state, { type: 'finding-resolved', findingId: 'F-2', head: 'h1' });
  assert.equal(state.dispositions['F-2'].state, 'resolved');
});

test('a Consider finding is never dismissed without a rubber-duck verdict', () => {
  const state = seeded();
  const error = refusal({}, () => applyEvent(state, { type: 'finding-declined', findingId: 'F-3' }));
  assert.equal(error.code, 'verdict_required');

  applyEvent(state, {
    type: 'duck-verdict',
    findingId: 'F-3',
    verdict: 'decline',
    reasoning: 'the locator is real but the cited rule governs a different section',
  });
  applyEvent(state, { type: 'finding-declined', findingId: 'F-3' });
  assert.equal(state.dispositions['F-3'].state, 'declined');
});

test('a declined finding keeps the duck reasoning in the report', () => {
  const state = seeded();
  applyEvent(state, {
    type: 'duck-verdict',
    findingId: 'F-3',
    verdict: 'decline',
    reasoning: 'the cited rule governs a different section',
  });
  applyEvent(state, { type: 'finding-declined', findingId: 'F-3' });
  const report = ledgerReport(state);
  assert.equal(report.declined[0].id, 'F-3');
  assert.equal(report.declined[0].verdict, 'decline');
  assert.match(report.declined[0].verdictReasoning, /different section/);
});

test('a verdict without reasoning is refused', () => {
  const state = seeded();
  const error = refusal({}, () =>
    applyEvent(state, { type: 'duck-verdict', findingId: 'F-2', verdict: 'apply', reasoning: '  ' }));
  assert.equal(error.code, 'missing_verdict_reasoning');
});

test('an unrecognised verdict is refused rather than defaulted', () => {
  const state = seeded();
  const error = refusal({}, () =>
    applyEvent(state, { type: 'duck-verdict', findingId: 'F-2', verdict: 'maybe', reasoning: 'x' }));
  assert.equal(error.code, 'invalid_verdict');
});

test('a correction invalidates the prior roast and forces a re-roast', () => {
  const state = seeded();
  assert.equal(roastStatus(state), 'fresh');

  applyEvent(state, { type: 'finding-resolved', findingId: 'F-1', head: 'h1' });
  assert.equal(roastStatus(state), 'stale', 'a moved head supersedes the roast that reviewed it');

  for (const event of [
    { type: 'finding-resolved', findingId: 'F-2', head: 'h2' },
    { type: 'finding-declined', findingId: 'F-3' },
    { type: 'duck-verdict', findingId: 'F-2', verdict: 'apply', reasoning: 'sound' },
  ]) {
    assert.equal(refusal({}, () => applyEvent(state, event)).code, 'stale_roast');
  }

  applyEvent(state, { type: 'roast-recorded', head: 'h1', findings: [finding('G-1', 'Should fix')] });
  assert.equal(roastStatus(state), 'fresh');
});

test('a roast of a superseded head is refused as stale evidence', () => {
  const state = seeded();
  applyEvent(state, { type: 'correction', head: 'h1', note: 'reworded the description' });
  const error = refusal({}, () =>
    applyEvent(state, { type: 'roast-recorded', head: 'h0', findings: [] }));
  assert.equal(error.code, 'stale_roast');
});

test('the round counter stops at three and refuses every event but the operator answer', () => {
  const state = seeded();
  assert.equal(ROUNDS_BEFORE_RECONFIRMATION, 3);

  let outcome = null;
  for (let round = 0; round < ROUNDS_BEFORE_RECONFIRMATION; round += 1) {
    outcome = applyEvent(state, { type: 'round-closed' });
  }
  assert.equal(outcome.status, 'awaiting-operator');
  assert.equal(state.gate, 'awaiting-operator');

  for (const event of [
    { type: 'round-closed' },
    { type: 'roast-recorded', head: 'h0', findings: [] },
    { type: 'duck-verdict', findingId: 'F-2', verdict: 'apply', reasoning: 'sound' },
    { type: 'correction', head: 'h9' },
  ]) {
    assert.equal(
      refusal({}, () => applyEvent(state, event)).code,
      'awaiting_operator_reconfirmation',
      `${event.type} must not slip past the stop`,
    );
  }
  assert.equal(state.round, ROUNDS_BEFORE_RECONFIRMATION, 'the stop cannot silently continue');
});

test('the loop reopens only on an explicit operator reconfirmation', () => {
  const state = seeded();
  for (let round = 0; round < ROUNDS_BEFORE_RECONFIRMATION; round += 1) {
    applyEvent(state, { type: 'round-closed' });
  }
  applyEvent(state, { type: 'operator-reconfirmation', confirmed: true, note: 'two more rounds' });
  assert.equal(state.gate, 'open');
  assert.equal(state.roundsSinceReconfirmation, 0);
  applyEvent(state, { type: 'round-closed' });
  assert.equal(state.gate, 'open', 'the counter restarts after a reconfirmation');
});

test('an operator declining to continue halts the ledger permanently', () => {
  const state = seeded();
  for (let round = 0; round < ROUNDS_BEFORE_RECONFIRMATION; round += 1) {
    applyEvent(state, { type: 'round-closed' });
  }
  applyEvent(state, { type: 'operator-reconfirmation', confirmed: false });
  assert.equal(state.gate, 'halted');
  assert.equal(refusal({}, () => applyEvent(state, { type: 'round-closed' })).code, 'halted');
});

test('a reconfirmation is refused when no stop is pending', () => {
  const state = seeded();
  assert.equal(
    refusal({}, () => applyEvent(state, { type: 'operator-reconfirmation', confirmed: true })).code,
    'no_reconfirmation_pending',
  );
});

test('non-convergence produces bounded ways forward rather than a bare failure', () => {
  const state = seeded();
  for (let round = 0; round < ROUNDS_BEFORE_RECONFIRMATION; round += 1) {
    applyEvent(state, { type: 'round-closed' });
  }
  const stop = stopReport(state);
  assert.ok(stop.unresolved.length, 'the stop must name what is unresolved');
  const options = stop.waysForward.map((entry) => entry.option);
  assert.ok(options.includes('further-review-rounds'));
  assert.ok(options.includes('simplify-feature'));
  for (const entry of stop.waysForward) {
    assert.ok(entry.because.trim(), `${entry.option} must say why it is offered`);
    assert.ok(entry.action.trim(), `${entry.option} must carry an action`);
  }
});

test('a needs-human verdict surfaces an operator decision as a way forward', () => {
  const state = seeded();
  applyEvent(state, {
    type: 'duck-verdict',
    findingId: 'F-2',
    verdict: 'needs-human',
    reasoning: 'the evidence does not settle whether the rule reaches this case',
  });
  applyEvent(state, { type: 'finding-deferred', findingId: 'F-2' });
  const options = waysForward(state).map((entry) => entry.option);
  assert.ok(options.includes('operator-decision'));
  assert.equal(ledgerReport(state).deferred[0].id, 'F-2');
});

test('ways forward are never empty for an unresolved ledger', () => {
  const empty = createLedger({ packagePath: 'skills/demo', head: 'h0' });
  const options = waysForward(empty).map((entry) => entry.option);
  assert.deepEqual(options, ['roast-the-package']);

  const stale = seeded();
  applyEvent(stale, { type: 'correction', head: 'h1' });
  assert.ok(waysForward(stale).some((entry) => entry.option === 're-roast-current-head'));
});

test('a converged ledger reports clean with no ways forward', () => {
  const state = createLedger({ packagePath: 'skills/demo', head: 'h0' });
  applyEvent(state, { type: 'roast-recorded', head: 'h0', findings: [] });
  const report = ledgerReport(state);
  assert.equal(report.status, 'clean');
  assert.deepEqual(report.waysForward, []);
});

test('no remediation path weakens a repository gate', () => {
  for (const gate of [
    'scripts/validate-skill-graph.mjs',
    'scripts/derive-skill-graph.mjs',
    'AGENTS.md',
    'doctrine/testing.doctrine.md',
    'doctrine/manifest.md',
    './scripts/derive-skill-graph.mjs',
  ]) {
    assert.equal(isProtectedGatePath(gate), true, `${gate} must be protected`);
    const error = refusal({}, () => assertGateIntegrity([gate]));
    assert.equal(error.code, 'gate_weakened');
  }

  const state = seeded();
  const error = refusal({}, () =>
    applyEvent(state, {
      type: 'finding-resolved',
      findingId: 'F-1',
      head: 'h1',
      changedPaths: ['skills/demo/SKILL.md', 'scripts/validate-skill-graph.mjs'],
    }));
  assert.equal(error.code, 'gate_weakened');
  assert.equal(state.head, 'h0', 'a refused correction must not move the head');

  assert.deepEqual(
    assertGateIntegrity(['skills/demo/SKILL.md', '.github/workflows/validate-skills.yml']),
    { status: 'intact', checked: 2 },
    'registering a test and editing the package stay allowed',
  );
});

test('a finding fixed in an earlier round survives into the final account', () => {
  const state = seeded();
  applyEvent(state, { type: 'finding-resolved', findingId: 'F-1', head: 'h1' });
  applyEvent(state, { type: 'round-closed' });
  applyEvent(state, { type: 'roast-recorded', head: 'h1', findings: [finding('G-1', 'Consider')] });

  const report = ledgerReport(state);
  assert.deepEqual(
    report.fixed,
    [],
    'the current roast is the only evidence about the current head',
  );
  assert.deepEqual(
    report.acrossRun.resolved,
    [{ id: 'F-1', round: 0 }],
    'a fix must not vanish from the account because a later round roasted a package without it',
  );
});

test('a correction with no change set is reported unverified, never as verified', () => {
  const state = seeded();
  const omitted = applyEvent(state, { type: 'correction', head: 'h1' });
  assert.equal(omitted.gateCheck, 'not-supplied', 'a check that never ran must not report intact');

  applyEvent(state, { type: 'roast-recorded', head: 'h1', findings: [finding('G-1', 'Must fix')] });
  const supplied = applyEvent(state, {
    type: 'finding-resolved',
    findingId: 'G-1',
    head: 'h2',
    changedPaths: ['skills/demo/SKILL.md'],
  });
  assert.equal(supplied.gateCheck, 'verified');

  applyEvent(state, { type: 'roast-recorded', head: 'h2', findings: [] });
  assert.deepEqual(ledgerReport(state).gateChecks, { verified: 1, unverified: 1 });
});

test('a Windows-shaped gate path is still recognised as a gate', () => {
  assert.equal(isProtectedGatePath('scripts\\validate-skill-graph.mjs'.replace(/\\/g, path.sep)), true);
});

test('an unrecognised priority is refused rather than routed by guess', () => {
  const state = createLedger({ packagePath: 'skills/demo', head: 'h0' });
  const error = refusal({}, () =>
    applyEvent(state, {
      type: 'roast-recorded',
      head: 'h0',
      findings: [finding('F-1', 'Nit')],
    }));
  assert.equal(error.code, 'unknown_priority');
  assert.match(error.message, /Must fix, Should fix, Consider/);
  assert.equal(state.roast, null, 'a refused roast leaves no half-recorded state');
});

test('every recognised priority routes to exactly one lane', () => {
  assert.deepEqual([...MANDATORY_PRIORITIES, ...DUCKED_PRIORITIES].sort(), [...PRIORITIES].sort());
  for (const priority of PRIORITIES) {
    const mandatory = MANDATORY_PRIORITIES.includes(priority);
    const ducked = DUCKED_PRIORITIES.includes(priority);
    assert.notEqual(mandatory, ducked, `${priority} must belong to exactly one lane`);
  }
});

test('an unknown event type is refused rather than ignored', () => {
  const state = seeded();
  const error = refusal({}, () => applyEvent(state, { type: 'finding-forgiven' }));
  assert.equal(error.code, 'unknown_event');
});

test('an unknown finding field is refused rather than silently dropped', () => {
  const state = createLedger({ packagePath: 'skills/demo', head: 'h0' });
  const error = refusal({}, () =>
    applyEvent(state, {
      type: 'roast-recorded',
      head: 'h0',
      findings: [finding('F-1', 'Should fix', { rebuttal: 'the author disagrees' })],
    }));
  assert.equal(error.code, 'invalid_finding');
  assert.match(error.message, /rebuttal/);
});

test('a finding with no bounded recommendation is refused', () => {
  const state = createLedger({ packagePath: 'skills/demo', head: 'h0' });
  const error = refusal({}, () =>
    applyEvent(state, {
      type: 'roast-recorded',
      head: 'h0',
      findings: [finding('F-1', 'Must fix', { recommendation: '' })],
    }));
  assert.equal(error.code, 'invalid_finding');
});

test('an unknown command-line argument is refused rather than ignored', () => {
  assert.throws(() => parseArguments(['--state', '/tmp/x', '--stat']), /unknown argument: --stat/);
  assert.throws(() => parseArguments(['--report']), /missing required argument for --state/);
  assert.throws(() => parseArguments(['--state', '/a', '--state', '/b']), /more than once/);
  assert.throws(() => parseArguments(['--state', '/a']), /nothing to do/);
  assert.deepEqual(parseArguments(['--probe']), { probe: true });
});

test('an unknown ledger state field is refused rather than trusted', (t) => {
  const root = workspace(t);
  const statePath = path.join(root, 'ledger.json');
  const eventPath = path.join(root, 'event.json');
  const state = createLedger({ packagePath: 'skills/demo', head: 'h0' });
  fs.writeFileSync(statePath, JSON.stringify({ ...state, gateOverride: 'open' }));
  fs.writeFileSync(eventPath, JSON.stringify({ type: 'round-closed' }));

  const streams = captureStreams();
  assert.equal(runLedger(['--state', statePath, '--event', eventPath], streams), 2);
  assert.match(streams.errors(), /invalid_state: unknown ledger field\(s\): gateOverride/);
});

test('the command line drives one full round through a state file', (t) => {
  const root = workspace(t);
  const statePath = path.join(root, 'ledger.json');
  const write = (name, payload) => {
    const target = path.join(root, `${name}.json`);
    fs.writeFileSync(target, JSON.stringify(payload));
    return target;
  };

  const invoke = (eventPath, expected) => {
    const streams = captureStreams();
    const code = runLedger(['--state', statePath, '--event', eventPath, '--report'], streams);
    assert.equal(code, expected, streams.errors() || streams.output());
    return { streams, code };
  };

  invoke(write('create', { type: 'create', packagePath: 'skills/demo', head: 'h0' }), 0);
  invoke(
    write('roast', {
      type: 'roast-recorded',
      head: 'h0',
      findings: [finding('F-1', 'Must fix'), finding('F-2', 'Consider')],
    }),
    0,
  );

  const refused = invoke(write('early', { type: 'finding-declined', findingId: 'F-2' }), 2);
  assert.match(refused.streams.errors(), /verdict_required/);

  invoke(write('resolve', { type: 'finding-resolved', findingId: 'F-1', head: 'h1' }), 0);
  const stale = invoke(write('stale', { type: 'finding-declined', findingId: 'F-2' }), 2);
  assert.match(stale.streams.errors(), /stale_roast/);

  const final = invoke(write('reroast', { type: 'roast-recorded', head: 'h1', findings: [] }), 0);
  const payload = JSON.parse(final.streams.output());
  assert.equal(payload.report.status, 'clean');
  assert.equal(payload.report.fixed.length, 0, 'a fresh roast replaces the prior dispositions');
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).head, 'h1');
});

test('the probe reports availability without touching a state file', () => {
  const streams = captureStreams();
  assert.equal(runLedger(['--probe'], streams), 0);
  assert.match(streams.output(), /roast-round-ledger: available/);
});
