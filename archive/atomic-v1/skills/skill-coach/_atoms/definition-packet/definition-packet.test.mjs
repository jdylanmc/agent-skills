/**
 * The packet contract as a caller experiences it: a well-shaped packet is
 * accepted, an unsettled one is accepted as unsettled, and every entry point
 * reports the same result.
 *
 * The refusals live in the adversarial suite beside this one.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { QUOTE_FLOOR, run, validatePacket } from './definition-packet.mjs';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t, prefix = 'definition-packet-') {
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

/** A packet a real coaching session would produce for a settled idea. */
function readyPacket(overrides = {}) {
  return {
    schemaVersion: 1,
    skill: 'release-notes',
    status: 'ready',
    coaching: 'coached',
    persona: { status: 'adopted', path: 'agents/skill-coach.agent.md', digest: 'a'.repeat(64) },
    definition: {
      interaction: 'The author asks for release notes for a tag and answers two questions.',
      outcome: 'A draft the author edits, never one that is published for them.',
      agreement: 'in-conversation',
      quote: 'I want it to draft the notes and then get out of my way.',
    },
    explored: [
      {
        subject: 'failure behaviour',
        finding: 'A missing tag stops the run and says which tag was missing.',
        source: 'human',
        quote: 'if the tag is not there I would rather it just told me',
      },
      {
        subject: 'nearby capabilities',
        finding: 'The existing changelog tool overlaps on commit parsing only.',
        source: 'coach',
      },
    ],
    decisions: [
      {
        decision: 'It drafts and never publishes.',
        reasoning: 'Publishing is irreversible and the author wants to read it first.',
        quote: 'nothing goes out without me reading it first',
      },
    ],
    recommendations: [
      {
        recommendation: 'Split the changelog parsing into its own skill.',
        disposition: 'rejected',
        humanReasoning: 'One job today; splitting before a second consumer exists is premature.',
      },
      { recommendation: 'Add a dry-run mode.', disposition: 'open' },
    ],
    examples: [
      {
        situation: 'The tag exists and has twelve commits.',
        behavior: 'A grouped draft is returned and nothing is written.',
      },
    ],
    unsettled: [
      {
        question: 'Should it read closed issues as well as commits?',
        whyItMatters: 'It changes what the skill is allowed to reach.',
        blocking: false,
      },
    ],
    ...overrides,
  };
}

test('a coached packet for a settled idea is accepted', () => {
  assert.deepEqual(validatePacket(readyPacket()), { status: 'valid', defects: [] });
});

test('an idea with a blocking open question is accepted as unsettled', () => {
  const packet = readyPacket({
    status: 'unsettled',
    unsettled: [
      {
        question: 'What may it publish to?',
        whyItMatters: 'Nobody can grant a permission nobody has named.',
        blocking: true,
      },
    ],
  });
  assert.equal(validatePacket(packet).status, 'valid');
});

test('a run whose persona never resolved is accepted as degraded and unsettled', () => {
  const packet = readyPacket({
    status: 'unsettled',
    coaching: 'degraded',
    persona: { status: 'unavailable', reason: 'agents/skill-coach.agent.md is missing a required heading' },
  });
  assert.deepEqual(validatePacket(packet), { status: 'valid', defects: [] });
});

test('a conversation that settled no name is accepted', () => {
  assert.equal(validatePacket(readyPacket({ skill: null })).status, 'valid');
});

test('empty sections are accepted when the idea is unsettled', () => {
  const packet = readyPacket({
    status: 'unsettled',
    explored: [],
    decisions: [],
    recommendations: [],
    examples: [],
    unsettled: [],
  });
  assert.equal(validatePacket(packet).status, 'valid');
});

test('a quote exactly at the floor is evidence and one character below it is not', () => {
  const atFloor = readyPacket();
  atFloor.definition.quote = 'x'.repeat(QUOTE_FLOOR);
  assert.equal(validatePacket(atFloor).status, 'valid');

  const belowFloor = readyPacket();
  belowFloor.definition.quote = 'x'.repeat(QUOTE_FLOOR - 1);
  assert.equal(validatePacket(belowFloor).status, 'refused');
});

test('standard input accepts a valid packet and reports it', () => {
  const streams = captureStreams();
  const code = run(['--stdin'], streams, () => JSON.stringify(readyPacket()));
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(streams.output()), { status: 'valid', defects: [] });
});

test('a packet file reaches the same verdict as the same bytes on standard input', (t) => {
  const root = workspace(t);
  const file = path.join(root, 'packet.json');
  const bytes = JSON.stringify(readyPacket());
  fs.writeFileSync(file, bytes);

  const fromFile = captureStreams();
  const fromStdin = captureStreams();
  assert.equal(run(['--packet', file], fromFile), 0);
  assert.equal(run(['--stdin'], fromStdin, () => bytes), 0);
  assert.deepEqual(JSON.parse(fromFile.output()), JSON.parse(fromStdin.output()));
});

test('probe reports availability without any input', () => {
  const streams = captureStreams();
  assert.equal(run(['--probe'], streams), 0);
  assert.match(streams.output(), /definition-packet: available/);
});

test('the two input modes are mutually exclusive and one is required', () => {
  for (const argv of [[], ['--stdin', '--packet', path.join(SANDBOX_ROOT, 'unused.json')]]) {
    const streams = captureStreams();
    assert.equal(run(argv, streams, () => '{}'), 1);
    assert.match(streams.errors(), /exactly one of --stdin or --packet/);
  }
});

test('an unusable packet path fails as a path failure rather than a refusal', (t) => {
  const root = workspace(t);
  for (const [argv, expected] of [
    [['--packet', 'packet.json'], /must be absolute/],
    [['--packet', path.join(root, 'absent.json')], /does not exist/],
    [['--packet', root], /must be a regular file/],
    [['--unknown'], /unknown argument/],
  ]) {
    const streams = captureStreams();
    assert.equal(run(argv, streams), 1, `${argv.join(' ')} must be a usage failure, not a verdict`);
    assert.match(streams.errors(), expected);
  }
});

test('malformed JSON is a path-level failure and never a silently valid packet', () => {
  const streams = captureStreams();
  assert.equal(run(['--stdin'], streams, () => '{ not json'), 1);
  assert.match(streams.errors(), /invalid_json/);
});
