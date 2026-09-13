import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONFIRMING_ACTOR,
  GATE_FAILURES,
  GATE_SUBJECTS,
  NON_CONFIRMING_ACTORS,
  applyEvent,
  applyEvents,
  createState,
  digestOf,
  replay,
  requireConfirmed,
  verifyState,
} from './adoption-gate.mjs';

const GATE = fileURLToPath(new URL('./adoption-gate.mjs', import.meta.url));

const DRAFT = 'The skill turns a rough note into one bounded checklist.\n';

function confirmedFlow(subject = 'adoption-intent', text = DRAFT) {
  return applyEvents([
    { type: 'open', subject },
    { type: 'presented', text },
    { type: 'confirmed', actor: CONFIRMING_ACTOR, digest: digestOf(text) },
    { type: 'release' },
  ]);
}

function refusal(run) {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

test('the same gate governs the synthesized intent and an authoring answer', () => {
  assert.deepEqual(GATE_SUBJECTS, ['adoption-intent', 'authoring-answer']);
  for (const subject of GATE_SUBJECTS) {
    const state = confirmedFlow(subject);
    assert.equal(state.status, 'released');
    assert.equal(requireConfirmed(state, DRAFT).requirement, 'satisfied');
    assert.equal(requireConfirmed(state, DRAFT).subject, subject);
  }
  assert.equal(
    refusal(() => applyEvent(createState(), { type: 'open', subject: 'anything-else' })).code,
    GATE_FAILURES.unknownSubject,
  );
});

test('nothing proceeds until the operator has confirmed the exact words presented', () => {
  const opened = applyEvent(createState(), { type: 'open', subject: 'adoption-intent' });
  assert.equal(refusal(() => applyEvent(opened, { type: 'release' })).code, GATE_FAILURES.unconfirmed);

  const presented = applyEvent(opened, { type: 'presented', text: DRAFT });
  assert.equal(
    refusal(() => applyEvent(presented, { type: 'release' })).code,
    GATE_FAILURES.unconfirmed,
  );
  assert.equal(presented.confirmedDigest, null);
});

test('a confirmation of anything but the presented text is stale and refused', () => {
  const presented = applyEvents([
    { type: 'open', subject: 'adoption-intent' },
    { type: 'presented', text: DRAFT },
  ]);
  assert.equal(
    refusal(() =>
      applyEvent(presented, {
        type: 'confirmed',
        actor: CONFIRMING_ACTOR,
        digest: digestOf('a shorter summary of the draft'),
      }),
    ).code,
    GATE_FAILURES.staleConfirmation,
  );
});

test('a correction clears the presentation and any yes given to it', () => {
  const corrected = applyEvents([
    { type: 'open', subject: 'adoption-intent' },
    { type: 'presented', text: DRAFT },
    { type: 'confirmed', actor: CONFIRMING_ACTOR, digest: digestOf(DRAFT) },
    { type: 'corrected', actor: CONFIRMING_ACTOR, words: 'It is a checklist, not a report.' },
  ]);
  assert.equal(corrected.status, 'corrected');
  assert.equal(corrected.presentedDigest, null);
  assert.equal(corrected.confirmedDigest, null);
  assert.deepEqual(corrected.corrections, ['It is a checklist, not a report.']);
  assert.equal(
    refusal(() =>
      applyEvent(corrected, { type: 'confirmed', actor: CONFIRMING_ACTOR, digest: digestOf(DRAFT) }),
    ).code,
    GATE_FAILURES.outOfOrder,
  );
});

const REFUSED_ACTORS = ['source', 'agent', 'authoring-context', 'synthesize'];

test('the published actor vocabulary is what this atom promises', () => {
  assert.equal(CONFIRMING_ACTOR, 'human');
  assert.deepEqual(NON_CONFIRMING_ACTORS, REFUSED_ACTORS);
});

test('source evidence and the authoring context cannot answer on the operator behalf', () => {
  const presented = applyEvents([
    { type: 'open', subject: 'authoring-answer' },
    { type: 'presented', text: DRAFT },
  ]);
  for (const actor of REFUSED_ACTORS) {
    assert.equal(
      refusal(() => applyEvent(presented, { type: 'confirmed', actor, digest: digestOf(DRAFT) })).code,
      GATE_FAILURES.nonHumanConfirmation,
    );
    assert.equal(
      refusal(() => applyEvent(presented, { type: 'corrected', actor, words: 'change it' })).code,
      GATE_FAILURES.nonHumanConfirmation,
    );
  }
  assert.equal(
    refusal(() =>
      applyEvent(presented, { type: 'confirmed', actor: 'operator', digest: digestOf(DRAFT) }),
    ).code,
    GATE_FAILURES.nonHumanConfirmation,
  );
});

test('a summary is not a presentation, and an unknown event or field is a refusal', () => {
  const opened = applyEvent(createState(), { type: 'open', subject: 'adoption-intent' });
  assert.equal(refusal(() => applyEvent(opened, { type: 'presented', text: '  ' })).code, GATE_FAILURES.usage);
  assert.equal(refusal(() => applyEvent(opened, { type: 'approve' })).code, GATE_FAILURES.unknownEvent);
  assert.equal(
    refusal(() => applyEvent(opened, { type: 'presented', text: DRAFT, force: true })).code,
    GATE_FAILURES.unknownField,
  );
  assert.equal(
    refusal(() => applyEvent(createState(), { type: 'presented', text: DRAFT })).code,
    GATE_FAILURES.outOfOrder,
  );
  assert.equal(
    refusal(() => applyEvent(confirmedFlow(), { type: 'open', subject: 'adoption-intent' })).code,
    GATE_FAILURES.outOfOrder,
  );
});

test('text that changed after the yes is refused at the point of use', () => {
  const state = confirmedFlow();
  const drifted = requireConfirmed(state, `${DRAFT}And one more thing.\n`);
  assert.equal(drifted.requirement, 'blocked');
  assert.equal(drifted.reasons.length, 1);

  const unreleased = applyEvents([
    { type: 'open', subject: 'adoption-intent' },
    { type: 'presented', text: DRAFT },
    { type: 'confirmed', actor: CONFIRMING_ACTOR, digest: digestOf(DRAFT) },
  ]);
  assert.equal(requireConfirmed(unreleased, DRAFT).requirement, 'blocked');
  assert.equal(requireConfirmed({ status: 'invented' }, DRAFT).requirement, 'blocked');
});

test('a state that does not reduce from its own event log is refused, not trusted', () => {
  const digest = digestOf(DRAFT);
  const forged = {
    subject: 'adoption-intent',
    status: 'confirmed',
    presentedDigest: digest,
    confirmedDigest: digest,
    corrections: [],
    released: false,
    events: [],
  };
  assert.equal(refusal(() => applyEvent(forged, { type: 'release' })).code, GATE_FAILURES.forgedState);
  assert.equal(
    requireConfirmed({ ...forged, released: true, status: 'released' }, DRAFT).requirement,
    'blocked',
  );
  assert.equal(refusal(() => verifyState({ status: 'released' })).code, GATE_FAILURES.forgedState);
  assert.equal(
    refusal(() => verifyState({ ...createState(), events: [{ type: 'approve' }] })).code,
    GATE_FAILURES.forgedState,
  );
  assert.equal(
    refusal(() => verifyState({ ...createState(), events: [{ type: 'open', subject: 'adoption-intent', extra: 1 }] })).code,
    GATE_FAILURES.forgedState,
  );
  assert.equal(
    refusal(() => verifyState({ ...createState(), events: [{ type: 'presented', digest: 'short' }] })).code,
    GATE_FAILURES.forgedState,
  );
  assert.equal(refusal(() => verifyState('released')).code, GATE_FAILURES.usage);
});

test('the recorded log keeps the declared actor and digest of every event', () => {
  const state = confirmedFlow();
  assert.deepEqual(state.events.map((event) => event.type), [
    'open',
    'presented',
    'confirmed',
    'release',
  ]);
  assert.equal(state.events[1].digest, digestOf(DRAFT));
  assert.equal(state.events[2].actor, CONFIRMING_ACTOR);
  assert.equal(state.events[2].digest, digestOf(DRAFT));
  assert.ok(!('text' in state.events[1]), 'the log keeps the digest, never the presented text');
  assert.deepEqual(replay(state.events), state);
});

test('a released episode is terminal, so a later confirmation needs its own episode', () => {
  const released = confirmedFlow();
  for (const event of [
    { type: 'open', subject: 'authoring-answer' },
    { type: 'presented', text: 'a different proposal' },
    { type: 'corrected', actor: CONFIRMING_ACTOR, words: 'no' },
    { type: 'release' },
  ]) {
    assert.equal(refusal(() => applyEvent(released, event)).code, GATE_FAILURES.outOfOrder);
  }
  const second = confirmedFlow('authoring-answer', 'The answer is the second option.\n');
  assert.equal(second.status, 'released');
  assert.equal(second.subject, 'authoring-answer');
});

test('the documented command line applies events, persists state, and maps exit codes', (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'adoption-gate-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));

  const statePath = path.join(workspace, 'state.json');
  const textPath = path.join(workspace, 'draft.txt');
  fs.writeFileSync(textPath, DRAFT);

  const run = (args) => {
    try {
      return {
        code: 0,
        stdout: execFileSync(process.execPath, [GATE, ...args], { encoding: 'utf8' }),
      };
    } catch (error) {
      return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
    }
  };
  const event = (value) => {
    const file = path.join(workspace, 'event.json');
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  };

  assert.equal(run(['--state', statePath, '--event', event({ type: 'open', subject: 'adoption-intent' })]).code, 0);
  assert.equal(run(['--state', statePath, '--event', event({ type: 'presented', text: DRAFT })]).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).status, 'presented');

  // Not confirmed yet: the use check refuses and exits 2.
  assert.equal(run(['--state', statePath, '--confirmed', textPath]).code, 2);
  assert.equal(run(['--state', statePath, '--event', event({ type: 'release' })]).code, 2);

  assert.equal(
    run([
      '--state',
      statePath,
      '--event',
      event({ type: 'confirmed', actor: 'agent', digest: digestOf(DRAFT) }),
    ]).code,
    2,
  );
  assert.equal(
    run([
      '--state',
      statePath,
      '--event',
      event({ type: 'confirmed', actor: CONFIRMING_ACTOR, digest: digestOf(DRAFT) }),
    ]).code,
    0,
  );
  assert.equal(run(['--state', statePath, '--event', event({ type: 'release' }), '--report']).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(statePath, 'utf8')).released, true);

  const satisfied = run(['--state', statePath, '--confirmed', textPath]);
  assert.equal(satisfied.code, 0);
  assert.match(satisfied.stdout, /"requirement": "satisfied"/);

  // Drifted text is refused at the point of use.
  fs.writeFileSync(textPath, `${DRAFT}and one more thing\n`);
  assert.equal(run(['--state', statePath, '--confirmed', textPath]).code, 2);

  // Usage failures exit 1; a malformed or forged state exits 2.
  assert.equal(run(['--state', statePath]).code, 1);
  assert.equal(run(['--state', statePath, '--event', event({ type: 'release' }), '--wat']).code, 1);
  const brokenState = path.join(workspace, 'broken.json');
  fs.writeFileSync(brokenState, '{not json');
  assert.equal(run(['--state', brokenState, '--event', event({ type: 'release' })]).code, 2);
});
