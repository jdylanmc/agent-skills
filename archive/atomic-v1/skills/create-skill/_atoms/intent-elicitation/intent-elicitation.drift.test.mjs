/**
 * Drift guard between the coverage topics the elicitation code enforces and the
 * document that owns them.
 *
 * `COVERAGE_TOPICS` decides which gaps get a follow-up question. If the atom's
 * own "What Regeneration Needs" table gained a topic and the list did not, the
 * step would stop asking about it — and, because a topic that is never assessed
 * is never reported as missing either, the record would come back `complete`
 * with a hole in it. That is this repository's recurring defect exactly: a
 * guard that silently matches nothing while reporting success.
 *
 * So the list is not hand-synced. This suite derives it from the table and
 * fails the build when the two disagree, and it refuses to pass on an empty
 * parse.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { COVERAGE_TOPICS } from './intent-elicitation.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOCUMENT = path.join(UNIT_ROOT, 'intent-elicitation.md');

/** The first column of the `## What Regeneration Needs` table. */
function topicsFromDocument() {
  const document = fs.readFileSync(DOCUMENT, 'utf8').replace(/\r\n/g, '\n');
  const heading = /^## What Regeneration Needs$/m.exec(document);
  assert.ok(heading, 'the atom no longer declares a What Regeneration Needs section');
  const body = document.slice(heading.index + heading[0].length).split(/^## /m)[0];

  const topics = [];
  for (const line of body.split('\n')) {
    const row = /^\|\s*`([a-z][a-z-]*)`\s*\|/.exec(line);
    if (row) {
      topics.push(row[1]);
    }
  }
  return topics;
}

test('the parse of the topic table is not vacuous', () => {
  const topics = topicsFromDocument();
  assert.ok(
    topics.length >= 6,
    `the topic table produced ${topics.length} rows, which is too few to be trusted`,
  );
  assert.equal(new Set(topics).size, topics.length, 'the topic table lists a topic twice');
});

test('the code enforces exactly the topics the document says regeneration needs', () => {
  assert.deepEqual(
    [...COVERAGE_TOPICS].sort(),
    [...topicsFromDocument()].sort(),
    'the topic table and COVERAGE_TOPICS disagree; change both deliberately',
  );
});

test('the document still states that an unassessed topic is not a covered one', () => {
  const document = fs.readFileSync(DOCUMENT, 'utf8').replace(/\s+/g, ' ');
  assert.match(document, /An unassessed topic is never a covered one/);
  assert.match(document, /Never infer it from the request and proceed/);
});
