/**
 * Drift guard between the persona this atom adopts and the document that
 * supplies it.
 *
 * The atom names the headings a coach document must carry, and resolution
 * fails without them. If the agent is renamed, restructured, or has a heading
 * retitled, coaching stops resolving and every run silently degrades to the
 * caller's fallback - which looks exactly like a runtime with no coach agent
 * installed. Nothing would say the repository broke its own persona.
 *
 * The second half guards the split this package exists to make. Coaching
 * happens before a package is built and reviewing happens after, and the two
 * documents must not grow back into each other. The roast lens is the sharpest
 * case: if it resolved the coach instead of the reviewer, every skill roast in
 * this repository would be judged through a pre-creation coaching persona that
 * carries no review dimensions at all.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const COACH_AGENT = path.join(REPOSITORY_ROOT, 'agents', 'skill-coach.agent.md');
const REVIEWER_AGENT = path.join(REPOSITORY_ROOT, 'agents', 'skill-reviewer.agent.md');
const LENS_UNIT = path.join(
  REPOSITORY_ROOT,
  'skills',
  'roast',
  '_atoms',
  'roast-trusted-lenses',
  'roast-trusted-lenses.md',
);

function read(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

/** Strips fenced blocks, so a heading quoted as an example never counts. */
function outsideFences(document) {
  const kept = [];
  let fence = null;
  for (const line of document.split('\n')) {
    const match = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (match) {
      const marker = match[1];
      if (fence === null) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      continue;
    }
    if (fence === null) {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

/** The headings the atom requires, read from the atom rather than restated. */
function requiredHeadings() {
  const unit = read(path.join(UNIT_ROOT, 'coach-persona.md'));
  return [...new Set([...unit.matchAll(/`(#{1,2} [A-Z][A-Za-z ]*)`/g)].map((match) => match[1]))];
}

test('the atom still names a required-heading set worth checking', () => {
  const headings = requiredHeadings();
  assert.ok(
    headings.length >= 5,
    'the required-heading list changed shape, so this suite would pass on any coach document',
  );
  assert.ok(headings.includes('# Skill Coach'));
});

test('the coach agent carries every heading the atom requires of it', () => {
  const agent = outsideFences(read(COACH_AGENT));
  const missing = requiredHeadings().filter(
    (heading) => !new RegExp(`^${heading}\\s*$`, 'm').test(agent),
  );
  assert.deepEqual(
    missing,
    [],
    `agents/skill-coach.agent.md no longer emits ${missing.join(', ')}, so every adoption would fail and coaching would silently degrade`,
  );
});

test('the coach agent is a document the skill adopts, not an agent anything routes to', () => {
  const agent = read(COACH_AGENT);
  assert.match(agent, /^name: skill-coach$/m);
  assert.match(agent, /^disable-model-invocation: true$/m);
  assert.match(agent, /^user-invocable: false$/m);
  assert.ok(!fs.lstatSync(COACH_AGENT).isSymbolicLink());
});

test('the coach and the reviewer are two documents with two names', () => {
  assert.match(read(COACH_AGENT), /^name: skill-coach$/m);
  assert.match(read(REVIEWER_AGENT), /^name: skill-reviewer$/m);
  assert.ok(!fs.lstatSync(REVIEWER_AGENT).isSymbolicLink());
});

test('the coach does not restate the reviewer\'s standards', () => {
  const coach = read(COACH_AGENT);
  const reviewerOwned = [
    'Progressive disclosure',
    'progressive disclosure',
    '## Findings',
    '**Blocker**',
    'Output Contract',
    'Validation Plan',
    'No safe review',
  ];
  const duplicated = reviewerOwned.filter((marker) => coach.includes(marker));
  assert.deepEqual(
    duplicated,
    [],
    `the coach has grown a copy of the reviewer's standards: ${duplicated.join(', ')}`,
  );
});

test('the reviewer does not run the coach\'s conversation', () => {
  const reviewer = read(REVIEWER_AGENT);
  const coachOwned = ['## How the Conversation Works', '## Pushback', 'one real question'];
  const duplicated = coachOwned.filter((marker) => reviewer.includes(marker));
  assert.deepEqual(
    duplicated,
    [],
    `the reviewer has grown a copy of the coach's conversation: ${duplicated.join(', ')}`,
  );
});

test('each document hands the other job to the other document', () => {
  assert.match(
    read(COACH_AGENT),
    /agents\/skill-reviewer\.agent\.md/,
    'the coach must send a built package to the reviewer',
  );
  assert.match(
    read(REVIEWER_AGENT),
    /hand off to Skill Coach/,
    'the reviewer must send an unbuilt idea to the coach',
  );
});

test('the roast lens resolves the reviewer and never the coach', () => {
  const lens = read(LENS_UNIT);
  const named = [...lens.matchAll(/\| `([a-z0-9-]+\.agent\.md)` \|/g)].map((match) => match[1]);
  assert.ok(named.includes('skill-reviewer.agent.md'), 'the skill lens must be the reviewer');
  assert.ok(
    !named.includes('skill-coach.agent.md'),
    'a roast that loaded the coaching persona would review every package against no review dimensions at all',
  );
});
