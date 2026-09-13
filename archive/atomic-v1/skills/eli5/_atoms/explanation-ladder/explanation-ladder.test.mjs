/**
 * Behavioral tests for the eli5 explanation-ladder checker.
 *
 * These assert what the checker promises through its public exports: a
 * well-formed three-level response is accepted, and each named defect is
 * produced by an input that exhibits it. They never reach into private
 * helpers, so the checker can be rewritten as long as the behavior holds.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LADDER_LEVELS,
  LINE_WORD_LIMIT,
  MINIMUM_BULLETS,
  SECTION_WORD_LIMIT,
  checkLadder,
  ladderAccepted,
  parseLadder,
} from './explanation-ladder.mjs';

function section(id, bullets) {
  const level = LADDER_LEVELS.find((entry) => entry.id === id);
  return [`### ${level.heading}`, ...bullets.map((line) => `- ${line}`)].join('\n');
}

/** A well-formed ladder. Individual tests spoil exactly one property of it. */
function wellFormed(overrides = {}) {
  const levels = {
    'five-year-old': ['A helper that runs errands.', 'You ask, it fetches.'],
    junior: ['A tool that dispatches jobs.', 'Reads config then schedules.', 'Reports results back.'],
    expert: ['Scheduler with backpressure.', 'Trades exactly-once for at-least-once.', 'Blocks under heavy fan-out.'],
    ...overrides,
  };
  return LADDER_LEVELS.map((level) => section(level.id, levels[level.id])).join('\n\n');
}

test('a well-formed three-level response is accepted', () => {
  const result = checkLadder(wellFormed());

  assert.equal(result.verdict, 'ladder-ok');
  assert.deepEqual(result.defects, []);
  assert.ok(ladderAccepted(result));
});

test('a preamble before the first level does not defeat a well-formed ladder', () => {
  const response = `Subject: maestro. Evidence basis: repository.\n\n${wellFormed()}`;

  assert.ok(ladderAccepted(checkLadder(response)));
});

test('the right headings with empty bodies is rejected, not accepted', () => {
  // The accepted case must not pass for the wrong reason: three correct
  // headings and nothing under them is the emptiest possible imposter.
  const response = LADDER_LEVELS.map((level) => `### ${level.heading}`).join('\n\n');
  const result = checkLadder(response);

  assert.ok(!ladderAccepted(result));
  assert.equal(result.defects.filter((defect) => defect.code === 'section-empty').length, 3);
});

test('a missing level is reported as section-missing', () => {
  const response = [section('five-year-old', ['a', 'b']), section('expert', ['c', 'd'])].join('\n\n');
  const codes = checkLadder(response).defects.map((defect) => defect.code);

  assert.ok(codes.includes('section-missing'));
});

test('an unknown heading is reported as section-unexpected', () => {
  const response = `${wellFormed()}\n\n### Explain like I am a wizard\n- extra bullet.\n- another.`;
  const result = checkLadder(response);

  assert.ok(result.defects.some((defect) => defect.code === 'section-unexpected'));
});

test('levels in the wrong order are reported as section-out-of-order', () => {
  const response = [
    section('expert', ['Scheduler with backpressure.', 'Trades one guarantee for another.']),
    section('junior', ['Dispatches jobs.', 'Schedules work.']),
    section('five-year-old', ['A helper.', 'It fetches.']),
  ].join('\n\n');

  assert.ok(checkLadder(response).defects.some((defect) => defect.code === 'section-out-of-order'));
});

test('a repeated level is reported as section-duplicated', () => {
  const response = [
    section('five-year-old', ['A helper.', 'It fetches.']),
    section('five-year-old', ['Another take.', 'Still a helper.']),
    section('junior', ['Dispatches jobs.', 'Schedules work.']),
    section('expert', ['Scheduler.', 'Backpressure.']),
  ].join('\n\n');

  assert.ok(checkLadder(response).defects.some((defect) => defect.code === 'section-duplicated'));
});

test('an empty level is reported as section-empty', () => {
  const response = [
    '### Explain like I am five',
    '',
    section('junior', ['Dispatches jobs.', 'Schedules work.']),
    section('expert', ['Scheduler.', 'Backpressure.']),
  ].join('\n\n');

  assert.ok(checkLadder(response).defects.some((defect) => defect.code === 'section-empty'));
});

test('a level over the word budget is reported as section-too-long', () => {
  const filler = Array.from({ length: SECTION_WORD_LIMIT + 10 }, (_, index) => `word${index}`).join(' ');
  const response = wellFormed({ 'five-year-old': [`${filler}`, 'A short second bullet.'] });
  const result = checkLadder(response);

  assert.ok(result.defects.some((defect) => defect.code === 'section-too-long'));
});

test('a single over-long line is reported as line-too-long', () => {
  const longLine = Array.from({ length: LINE_WORD_LIMIT + 5 }, () => 'word').join(' ');
  const response = wellFormed({ junior: [longLine, 'short bullet', 'another short bullet'] });
  const result = checkLadder(response);

  assert.ok(result.defects.some((defect) => defect.code === 'line-too-long'));
});

test('a level with too few bullets is reported as section-not-bulleted', () => {
  assert.ok(MINIMUM_BULLETS >= 2);
  const response = [
    section('five-year-old', ['Only one bullet.']),
    section('junior', ['Dispatches jobs.', 'Schedules work.']),
    section('expert', ['Scheduler.', 'Backpressure.']),
  ].join('\n\n');

  assert.ok(checkLadder(response).defects.some((defect) => defect.code === 'section-not-bulleted'));
});

test('a later level restating an earlier line is reported as content-repeated', () => {
  const shared = 'The scheduler dispatches jobs to workers.';
  const response = [
    section('five-year-old', [shared, 'It helps you.']),
    section('junior', ['A queue of tasks.', 'Runs them in turn.']),
    section('expert', [shared, 'Backpressure under fan-out.']),
  ].join('\n\n');
  const result = checkLadder(response);

  assert.ok(result.defects.some((defect) => defect.code === 'content-repeated'));
});

test('parseLadder separates preamble from ordered sections', () => {
  const { preamble, sections } = parseLadder(`intro line\n\n${wellFormed()}`);

  assert.ok(preamble.join(' ').includes('intro line'));
  assert.deepEqual(
    sections.map((entry) => entry.id),
    LADDER_LEVELS.map((level) => level.id),
  );
});
