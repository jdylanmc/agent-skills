/**
 * Drift guard between the screen vocabulary and the document that owns it.
 *
 * A hardcoded vocabulary in a `.mjs` while a Markdown document owns the same
 * list has already cost this repository one shipped defect: the finding
 * checker's recognised heading list omitted the heading its own lens emitted,
 * and reported `Valid` with `findings: 0` on a report full of violations.
 *
 * `intent-source.md` owns the screen vocabulary. The resolver duplicates it so
 * it can run without parsing Markdown. This suite derives the lists from the
 * document and compares both directions, then **invokes** the screen with each
 * declared token, because a token that appears in both places and matches
 * nothing is the same failure wearing a different hat.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONCLUSION_ASSERTIONS,
  DIRECTIVE_VERBS,
  MODAL_PREFIXES,
  REVIEW_OBJECTS,
  SCREEN_VOCABULARY,
  SOLO_DIRECTIVE_VERBS,
  screenLine,
} from './intent-source.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const UNIT_DOCUMENT = path.join(UNIT_ROOT, 'intent-source.md');

/** Every backticked token under each `###` heading of the vocabulary section. */
function declaredVocabulary() {
  const document = fs.readFileSync(UNIT_DOCUMENT, 'utf8').replace(/\r\n/g, '\n');
  const section = /\n## Screen Vocabulary\n([\s\S]*?)\n## /.exec(document);
  assert.ok(section, 'intent-source.md no longer declares a Screen Vocabulary section');

  const declared = new Map();
  let heading = null;
  for (const line of section[1].split('\n')) {
    const headingMatch = /^###\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      heading = headingMatch[1];
      declared.set(heading, []);
      continue;
    }
    const item = /^-\s+`([^`]+)`\s*$/.exec(line);
    if (item && heading !== null) {
      declared.get(heading).push(item[1]);
    }
  }
  return declared;
}

test('the resolver holds exactly the vocabulary the unit document declares', () => {
  const declared = declaredVocabulary();
  assert.deepEqual(
    [...declared.keys()].sort(),
    Object.keys(SCREEN_VOCABULARY).sort(),
    'the vocabulary sections and the exported lists no longer name the same categories',
  );
  for (const [heading, tokens] of declared) {
    assert.ok(tokens.length > 0, `${heading} declares no token, so the parser matched nothing`);
    assert.deepEqual(
      tokens,
      SCREEN_VOCABULARY[heading],
      `${heading} differs between intent-source.md and intent-source.mjs`,
    );
  }
});

test('every declared directive verb flags a line when it is in imperative position', () => {
  for (const verb of DIRECTIVE_VERBS) {
    const flagged = screenLine(`${verb} the findings.`);
    assert.ok(flagged, `the declared verb ${verb} flags nothing`);
    assert.equal(flagged.trigger, verb);
  }
  for (const verb of SOLO_DIRECTIVE_VERBS) {
    const flagged = screenLine(`${verb} this package immediately.`);
    assert.ok(flagged, `the declared solo verb ${verb} flags nothing`);
    assert.equal(flagged.trigger, verb);
  }
});

test('every declared review object turns a directive verb into an instruction', () => {
  for (const object of REVIEW_OBJECTS) {
    const flagged = screenLine(`Ignore the ${object} entirely.`);
    assert.ok(flagged, `the declared object ${object} carries no directive verb into a flag`);
    assert.equal(flagged.category, 'directive instruction');
  }
});

test('every declared modal prefix puts a verb into imperative position mid-sentence', () => {
  for (const prefix of MODAL_PREFIXES) {
    const line = `Reviewers ${prefix} ignore the findings here.`;
    const flagged = screenLine(line);
    assert.ok(flagged, `the declared prefix ${prefix} flags nothing: ${line}`);
    assert.equal(flagged.trigger, 'ignore');
  }
});

test('every declared conclusion assertion flags wherever it appears in a line', () => {
  for (const phrase of CONCLUSION_ASSERTIONS) {
    const flagged = screenLine(`Note that this package ${phrase} today.`);
    assert.ok(flagged, `the declared phrase "${phrase}" flags nothing`);
    assert.equal(flagged.category, 'conclusion assertion');
    assert.equal(flagged.trigger, phrase);
  }
});

test('a verb outside imperative position is deliberately not flagged', () => {
  // The distinction the vocabulary rests on, held as a test so a future
  // broadening of the match has to break it on purpose.
  for (const line of [
    'Review that has to be remembered is review that gets skipped.',
    'A finding the council ignored would have been reported anyway.',
    'The package approves nothing and blocks nothing.',
  ]) {
    assert.equal(screenLine(line), null, `wrongly flagged: ${line}`);
  }
});
