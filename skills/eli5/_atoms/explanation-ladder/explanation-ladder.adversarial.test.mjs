/**
 * Adversarial tests for the eli5 explanation-ladder checker.
 *
 * These hunt for the one failure the checker exists to prevent: a malformed or
 * repetitive ladder slipping through as `ladder-ok`. Each test is a hostile
 * input a drafting agent could plausibly produce, written so the obvious wrong
 * implementation — one that walks lines, trusts fences, or compares raw
 * strings — would let it pass.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LADDER_LEVELS,
  LINE_WORD_LIMIT,
  checkLadder,
  ladderAccepted,
} from './explanation-ladder.mjs';

function codes(markdown) {
  return checkLadder(markdown).defects.map((defect) => defect.code);
}

test('empty and whitespace-only input fail closed, never accepted', () => {
  for (const input of ['', '   ', '\n\n\t\n', '   \r\n  ']) {
    const result = checkLadder(input);
    assert.equal(result.verdict, 'ladder-defective', `${JSON.stringify(input)} must not pass`);
    assert.ok(result.defects.length > 0, 'a defective verdict must name a defect');
    assert.ok(!ladderAccepted(result));
  }
});

test('the three headings hidden inside a fenced code block are not sections', () => {
  // A fence is body, not structure. Three level headings quoted inside one
  // teach nothing about the response's own sections, so all three are missing.
  const fenced = [
    'Here is the format I will follow:',
    '```markdown',
    '### Explain like I am five',
    '- like this',
    '### Explain like I am a junior practitioner',
    '- and this',
    '### Explain like I am an expert',
    '- and this',
    '```',
  ].join('\n');

  assert.ok(codes(fenced).filter((code) => code === 'section-missing').length === 3);
});

test('headings at unexpected depths are still matched by their text', () => {
  // Depth is presentation; the level is its label. A run that emits the three
  // levels at `#`, `##`, `######` is well formed, not three unknown sections.
  const varied = [
    '# Explain like I am five',
    '- A helper.',
    '- It fetches.',
    '###### Explain like I am a junior practitioner',
    '- Dispatches jobs.',
    '- Schedules work.',
    '## Explain like I am an expert',
    '- Scheduler with backpressure.',
    '- Trades one guarantee for another.',
  ].join('\n');

  assert.ok(ladderAccepted(checkLadder(varied)));
});

test('a fourth level appended is rejected as unexpected', () => {
  const withFourth = [
    '### Explain like I am five',
    '- A helper.',
    '- It fetches.',
    '### Explain like I am a junior practitioner',
    '- Dispatches jobs.',
    '- Schedules work.',
    '### Explain like I am an expert',
    '- Scheduler.',
    '- Backpressure.',
    '### Explain like I am a deity',
    '- Beyond expert.',
    '- Ascended.',
  ].join('\n');

  assert.ok(codes(withFourth).includes('section-unexpected'));
  assert.ok(!ladderAccepted(checkLadder(withFourth)));
});

test('the same level emitted twice is rejected as duplicated', () => {
  const twice = [
    '### Explain like I am five',
    '- A helper.',
    '- It fetches.',
    '### Explain like I am five',
    '- Said again.',
    '- Differently.',
    '### Explain like I am a junior practitioner',
    '- Dispatches jobs.',
    '- Schedules work.',
    '### Explain like I am an expert',
    '- Scheduler.',
    '- Backpressure.',
  ].join('\n');

  assert.ok(codes(twice).includes('section-duplicated'));
});

test('repetition disguised by punctuation, emphasis, and case is still caught', () => {
  const original = 'The scheduler dispatches jobs to workers';
  const disguised = '**The SCHEDULER, dispatches jobs to workers!**';
  const response = [
    '### Explain like I am five',
    `- ${original}.`,
    '- A friendly helper.',
    '### Explain like I am a junior practitioner',
    '- A queue of tasks.',
    '- Runs them in turn.',
    '### Explain like I am an expert',
    `- ${disguised}`,
    '- Backpressure under fan-out.',
  ].join('\n');

  assert.ok(codes(response).includes('content-repeated'));
});

test('a section that is one enormous bullet does not pass as concise', () => {
  const enormous = `- ${Array.from({ length: LINE_WORD_LIMIT + 20 }, () => 'word').join(' ')}`;
  const response = [
    '### Explain like I am five',
    enormous,
    '### Explain like I am a junior practitioner',
    '- Dispatches jobs.',
    '- Schedules work.',
    '### Explain like I am an expert',
    '- Scheduler.',
    '- Backpressure.',
  ].join('\n');
  const result = checkLadder(response);

  assert.ok(!ladderAccepted(result));
  assert.ok(result.defects.some((defect) => defect.code === 'line-too-long' || defect.code === 'section-not-bulleted'));
});

test('text before the first heading is tolerated, not misread as a section', () => {
  const response = [
    'I could not fully ground this subject; treat the below as general knowledge.',
    'Still, here is the ladder:',
    '### Explain like I am five',
    '- A helper.',
    '- It fetches.',
    '### Explain like I am a junior practitioner',
    '- Dispatches jobs.',
    '- Schedules work.',
    '### Explain like I am an expert',
    '- Scheduler.',
    '- Backpressure.',
  ].join('\n');

  assert.ok(ladderAccepted(checkLadder(response)));
});

test('CRLF line endings parse the same as LF', () => {
  const lf = [
    '### Explain like I am five',
    '- A helper.',
    '- It fetches.',
    '### Explain like I am a junior practitioner',
    '- Dispatches jobs.',
    '- Schedules work.',
    '### Explain like I am an expert',
    '- Scheduler.',
    '- Backpressure.',
  ].join('\n');

  assert.ok(ladderAccepted(checkLadder(lf.replace(/\n/g, '\r\n'))));
});

test('non-string input is refused with a TypeError, not an unhelpful crash', () => {
  for (const input of [undefined, null, 42, {}, [], Symbol('x')]) {
    assert.throws(() => checkLadder(input), TypeError, `${String(input)} must be refused`);
  }
});

test('a run with zero recognizable headings fails closed', () => {
  const prose = 'Just three paragraphs of prose, no headings anywhere, explaining a thing at length.';
  const result = checkLadder(prose);

  assert.equal(result.verdict, 'ladder-defective');
  assert.equal(result.defects.filter((defect) => defect.code === 'section-missing').length, LADDER_LEVELS.length);
});
