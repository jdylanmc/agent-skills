/**
 * Behavioural tests for the intent elicitation step.
 *
 * Each test is named for the behaviour it protects. The behaviours pull in
 * opposite directions on purpose: the opening must stay unstructured enough
 * that the operator will actually talk, and the closing must stay strict enough
 * that silence is never mistaken for an answer.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  COVERAGE_TOPICS,
  ELICITATION_PROMPT,
  ElicitationError,
  TRIVIAL_EVIDENCE_PROBES,
  parseArguments,
  readRecordFile,
  reviewElicitation,
  run as runElicitation,
} from './intent-elicitation.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t, prefix = 'intent-elicitation-') {
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

/**
 * A deliberately disorganised answer: no headings, no order, a contradiction,
 * and a tangent. This is the shape the step exists to accept.
 */
const WORD_VOMIT = `ok so the thing I want is something that takes a folder of screenshots and
files them by the game they came from, that is the whole job really. I would
reach for it after a capture session, not while I am playing, and definitely not
for video, video is a different problem and I do not want it pretending it can
do both. It should refuse to touch anything outside the capture folder because
the one time I let a tidier loose on my whole pictures directory I lost a year
of stuff and no I did not have a backup, so it gets to read whatever it likes
but it only ever writes inside that folder. Actually - it should stop and show
me what it is about to move before it moves anything, deleting is the part that
cannot be taken back. I already tried doing this with the file dates and it was
useless, two games in one session look identical by timestamp, so it has to go
on what is in the picture or the name.`;

function coveredFrom(quote) {
  return { covered: true, evidence: quote };
}

/** A complete record built from the vomit above, each topic quoting it. */
function completeRecord(overrides = {}) {
  return {
    transcript: WORD_VOMIT,
    topics: [
      { topic: 'one-job', ...coveredFrom('files them by the game they came from') },
      { topic: 'triggers', ...coveredFrom('after a capture session, not while I am playing') },
      { topic: 'refusals', ...coveredFrom('refuse to touch anything outside the capture folder') },
      { topic: 'permissions', ...coveredFrom('it gets to read whatever it likes') },
      { topic: 'gates', ...coveredFrom('stop and show\nme what it is about to move') },
      { topic: 'rationale', ...coveredFrom('two games in one session look identical by timestamp') },
    ],
    followUps: [],
    ...overrides,
  };
}

function uncover(record, topic, question) {
  const topics = record.topics.map((entry) =>
    entry.topic === topic ? { topic, covered: false } : entry,
  );
  const followUps = question ? [...(record.followUps ?? []), { topic, question }] : record.followUps;
  return { ...record, topics, followUps };
}

function refusal(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ElicitationError, `expected a refusal, got ${error}`);
    return error;
  }
  return assert.fail('expected a refusal, but the call succeeded');
}

test('the opening ask demands no template and no form', () => {
  assert.match(ELICITATION_PROMPT, /There is no form here and nothing to fill in/);
  assert.match(ELICITATION_PROMPT, /Unstructured is fine/);
  assert.match(ELICITATION_PROMPT, /worth skipping if they do\s+not/);
  assert.doesNotMatch(
    ELICITATION_PROMPT,
    /^\s*\d+[.)]\s/m,
    'a numbered list of questions is the intake form this step exists to avoid',
  );
  assert.doesNotMatch(ELICITATION_PROMPT, /^\s*[-*]\s/m, 'a bullet list of fields is still a form');
  assert.ok(
    (ELICITATION_PROMPT.match(/\?/g) ?? []).length <= 1,
    'the opening is one ask, not an interrogation',
  );
});

test('the opening ask states the confirmation gate before the operator speaks', () => {
  assert.match(ELICITATION_PROMPT, /Nothing is stored until you say so/);
  assert.match(ELICITATION_PROMPT, /You correct it until it is right/);
});

test('the opening ask names every topic a regeneration needs without making one required', () => {
  assert.match(ELICITATION_PROMPT, /the one job it does/);
  assert.match(ELICITATION_PROMPT, /when you would reach for it and when you would not/);
  assert.match(ELICITATION_PROMPT, /refuse to do, and why refusing is the right answer/);
  assert.match(ELICITATION_PROMPT, /allowed to touch and why you would trust it/);
  assert.match(ELICITATION_PROMPT, /stop\s+and ask you about before doing/);
  assert.match(ELICITATION_PROMPT, /already tried that did\s+not\s+work/);
});

test('unstructured rambling input is accepted as given', () => {
  const result = reviewElicitation(completeRecord());
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.gaps, []);
  assert.deepEqual(result.questions, []);
  assert.equal(Object.keys(result.evidence).length, COVERAGE_TOPICS.length);
});

test('intent is requested before anything else: an empty transcript is refused', () => {
  const error = refusal(() => reviewElicitation({ transcript: '   ', topics: [] }));
  assert.equal(error.code, 'missing_transcript');
});

test('a topic nobody assessed is not a covered topic', () => {
  const record = completeRecord();
  const error = refusal(() =>
    reviewElicitation({ ...record, topics: record.topics.filter((entry) => entry.topic !== 'gates') }),
  );
  assert.equal(error.code, 'missing_topic');
  assert.match(error.message, /gates/);
});

test('coverage claimed without evidence is refused', () => {
  const record = completeRecord();
  const error = refusal(() =>
    reviewElicitation({
      ...record,
      topics: record.topics.map((entry) =>
        entry.topic === 'rationale' ? { topic: 'rationale', covered: true } : entry,
      ),
    }),
  );
  assert.equal(error.code, 'unsupported_coverage');
});

test('coverage citing words the operator never said is refused', () => {  const record = completeRecord();
  const error = refusal(() =>
    reviewElicitation({
      ...record,
      topics: record.topics.map((entry) =>
        entry.topic === 'permissions'
          ? { topic: 'permissions', covered: true, evidence: 'he agreed it could write anywhere' }
          : entry,
      ),
    }),
  );
  assert.equal(error.code, 'unsupported_coverage');
  assert.match(error.message, /does not appear in what the operator said/);
});

test('a fragment too short to be a quote is refused as evidence', () => {
  const record = completeRecord();
  const unrefused = TRIVIAL_EVIDENCE_PROBES.filter((probe) => {
    try {
      reviewElicitation({
        ...record,
        transcript: `${WORD_VOMIT}\n${probe}`,
        topics: record.topics.map((entry) =>
          entry.topic === 'one-job' ? { topic: 'one-job', covered: true, evidence: probe } : entry,
        ),
      });
      return true;
    } catch (error) {
      return error.code !== 'unsupported_coverage';
    }
  });
  assert.deepEqual(
    unrefused,
    [],
    'a fragment that appears in every transcript proves nothing, and accepting one collapses coverage into a bare assertion',
  );
});

test('a follow-up is asked only for a genuinely missing topic', () => {
  const record = uncover(completeRecord(), 'rationale', 'What did you try before this that did not work?');
  const result = reviewElicitation(record);
  assert.equal(result.status, 'questions-pending');
  assert.deepEqual(result.gaps, ['rationale']);
  assert.deepEqual(result.questions, [
    { topic: 'rationale', question: 'What did you try before this that did not work?' },
  ]);
});

test('a follow-up about something already answered is refused', () => {
  const record = completeRecord({
    followUps: [{ topic: 'one-job', question: 'What is the one job?' }],
  });
  const error = refusal(() => reviewElicitation(record));
  assert.equal(error.code, 'redundant_question');
});

test('a second question about the same gap is refused', () => {
  const record = uncover(completeRecord(), 'gates', 'Where should it stop and ask you?');
  record.followUps.push({ topic: 'gates', question: 'And what is irreversible?' });
  const error = refusal(() => reviewElicitation(record));
  assert.equal(error.code, 'duplicate_question');
});

test('a gap nobody asked about is refused rather than passed over', () => {
  const error = refusal(() => reviewElicitation(uncover(completeRecord(), 'refusals', null)));
  assert.equal(error.code, 'unasked_gap');
  assert.match(error.message, /refusals/);
});

test('an unknown topic is refused rather than ignored', () => {
  const record = completeRecord();
  const error = refusal(() =>
    reviewElicitation({
      ...record,
      topics: [...record.topics, { topic: 'deployment-cadence', covered: true, evidence: 'ok so' }],
    }),
  );
  assert.equal(error.code, 'unknown_topic');
});

test('an unknown record field is refused rather than silently dropped', () => {
  const error = refusal(() => reviewElicitation({ ...completeRecord(), template: 'the form' }));
  assert.equal(error.code, 'unknown_field');
});

test('a non-boolean coverage assessment is refused rather than read as truthy', () => {
  const record = completeRecord();
  for (const value of ['yes', 1, null]) {
    const error = refusal(() =>
      reviewElicitation({
        ...record,
        topics: record.topics.map((entry) =>
          entry.topic === 'triggers' ? { topic: 'triggers', covered: value, evidence: 'ok so' } : entry,
        ),
      }),
    );
    assert.ok(['invalid_input', 'unsupported_coverage'].includes(error.code));
  }
});

test('an unknown command-line argument is refused rather than ignored', () => {
  const error = refusal(() => parseArguments(['--prompt', '--force']));
  assert.equal(error.code, 'usage');
  assert.match(error.message, /unknown argument: --force/);
});

test('the two modes are separate and one of them is required', () => {
  assert.equal(refusal(() => parseArguments([])).code, 'usage');
  assert.equal(refusal(() => parseArguments(['--prompt', '--review', '/tmpless/x.json'])).code, 'usage');
  assert.deepEqual(parseArguments(['--prompt']), { mode: 'prompt' });
});

test('the command prints the opening ask verbatim', () => {
  const streams = captureStreams();
  assert.equal(runElicitation(['--prompt'], streams), 0);
  assert.equal(streams.output(), `${ELICITATION_PROMPT}\n`);
});

test('the command exits 2 on a refused record and 1 on a usage failure', (t) => {
  const root = workspace(t);
  const good = path.join(root, 'good.json');
  const bad = path.join(root, 'bad.json');
  fs.writeFileSync(good, JSON.stringify(completeRecord()));
  fs.writeFileSync(bad, JSON.stringify(uncover(completeRecord(), 'gates', null)));

  const ok = captureStreams();
  assert.equal(runElicitation(['--review', good], ok), 0);
  assert.match(ok.output(), /"status": "complete"/);

  const refused = captureStreams();
  assert.equal(runElicitation(['--review', bad], refused), 2);
  assert.match(refused.errors(), /unasked_gap/);

  const usage = captureStreams();
  assert.equal(runElicitation(['--review'], usage), 1);
});

test('a record path outside a regular file is refused', (t) => {
  const root = workspace(t);
  assert.equal(refusal(() => readRecordFile('relative.json')).code, 'unsafe_path');
  assert.equal(refusal(() => readRecordFile(path.join(root, '..', 'x.json'))).code, 'unsafe_path');
  assert.equal(refusal(() => readRecordFile(root)).code, 'unsafe_path');
});
