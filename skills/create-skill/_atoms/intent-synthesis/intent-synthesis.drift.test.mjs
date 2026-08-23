/**
 * Drift guard between the screened vocabulary and the document that owns it.
 *
 * The terms this screen refuses are not its own invention: `AGENTS.md` defines
 * this repository's frontmatter fields, its composition shapes, and its
 * canonical paths. If a term is renamed there and the screen keeps refusing the
 * old spelling, the screen quietly stops catching the thing it exists to catch
 * while continuing to report every draft as clean.
 *
 * The check runs in both directions. Every screened term must still appear in
 * `AGENTS.md`, and the terms that matter most must still be screened, so
 * neither side can be edited alone.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { STRUCTURAL_TERMS, screenIntentProse } from './intent-synthesis.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');

/**
 * Terms `AGENTS.md` must still spell this way, each with the line the screen
 * must refuse it in. `includes` is screened only in its field spelling, because
 * "includes" is an ordinary English verb and a screen that refused it would be
 * turned off within a week.
 */
const OWNED_BY_AGENTS = [
  { term: 'allowed-tools', probe: 'It is granted allowed-tools of read.' },
  { term: 'used-by', probe: 'The used-by list is generated.' },
  { term: 'disable-model-invocation', probe: 'It sets disable-model-invocation.' },
  { term: 'user-invocable', probe: 'It stays user-invocable.' },
  { term: 'requires-skills', probe: 'It names the other one in requires-skills.' },
  { term: 'composes', probe: 'It composes two smaller pieces.' },
  { term: 'includes', probe: 'Its `includes` list mirrors the links.' },
  { term: 'frontmatter', probe: 'The frontmatter records that.' },
  { term: '_atoms', probe: 'The parts live under _atoms.' },
  { term: '_molecules', probe: 'The larger parts live under _molecules.' },
  { term: '_base', probe: 'Shared parts live under _base.' },
  { term: 'SKILL.md', probe: 'The workflow lives in SKILL.md.' },
];

function agentsDocument() {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, 'AGENTS.md'), 'utf8');
}

test('every term the screen owns is still spelled that way in AGENTS.md', () => {
  const document = agentsDocument();
  assert.ok(document.length > 1000, 'AGENTS.md did not load; this suite would otherwise pass vacuously');
  const missing = OWNED_BY_AGENTS.filter(({ term }) => !document.includes(term)).map(
    ({ term }) => term,
  );
  assert.deepEqual(
    missing,
    [],
    'AGENTS.md renamed a term the intent screen refuses; update both deliberately',
  );
});

test('every term AGENTS.md owns is still refused by the screen', () => {
  const unscreened = OWNED_BY_AGENTS.filter(
    ({ probe }) => screenIntentProse(probe).status !== 'structural',
  ).map(({ term }) => term);
  assert.deepEqual(
    unscreened,
    [],
    'a term named in AGENTS.md is no longer refused in a stored intent',
  );
});

test('the screened vocabulary is not empty and every entry is a live pattern', () => {
  assert.ok(STRUCTURAL_TERMS.length >= 20, 'the vocabulary shrank below anything worth running');
  for (const { kind, pattern } of STRUCTURAL_TERMS) {
    assert.ok(typeof kind === 'string' && kind, 'every screened term declares a kind');
    assert.ok(pattern instanceof RegExp, `${kind} declares no pattern`);
  }
});
