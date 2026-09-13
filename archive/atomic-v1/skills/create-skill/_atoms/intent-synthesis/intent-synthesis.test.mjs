/**
 * Behavioural tests for the structural screen on a synthesized intent.
 *
 * The screen has two ways to fail, and only one of them is noisy. A screen that
 * flags ordinary prose gets switched off; a screen that flags nothing reports
 * every draft as clean while structural detail accumulates in the one artifact
 * that is supposed to survive a rewrite. Both directions are asserted here, and
 * the second is asserted with probes rather than by inspection.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PLAIN_PROBES,
  STRUCTURAL_PROBES,
  SynthesisError,
  parseArguments,
  reviewIntentDraft,
  run as runSynthesis,
  screenIntentProse,
} from './intent-synthesis.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t, prefix = 'intent-synthesis-') {
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

/** A plain-requirements intent of the shape the existing intent files take. */
const PLAIN_INTENT = `# Intent: capture-sort

## What this is for

Take a folder of screenshots and file them by the game they came from. That is
the whole job.

## Why it exists

Screenshots pile up unsorted until sorting them is a weekend, and by then
nobody remembers which session was which.

## What it must do

- **Work out which game a picture came from** from what is in the picture and
  what the picture is called.
- **Show what it is about to move before it moves anything.** Moving is the part
  that cannot be taken back.

## What it must refuse

- **Touching anything outside the capture folder.** A tidier let loose on
  everything once cost a year of pictures, and there was no backup.
- **Sorting video.** That is a different problem, and something that does both
  will do the wrong one.

## The judgement worth preserving

Sorting by the time a picture was taken was tried first and was useless: two
games in one sitting look identical by that measure. Whatever replaces this
should not reach for the clock again.
`;

function refusal(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof SynthesisError, `expected a refusal, got ${error}`);
    return error;
  }
  return assert.fail('expected a refusal, but the call succeeded');
}

test('plain requirements prose passes the screen', () => {
  const result = screenIntentProse(PLAIN_INTENT);
  assert.equal(result.status, 'plain', JSON.stringify(result.findings, null, 2));
});

test('a synthesized intent is well-formed without following a template', () => {
  const result = reviewIntentDraft(PLAIN_INTENT, 'capture-sort');
  assert.equal(result.shape, 'well-formed');
  assert.equal(result.status, 'plain');
  assert.deepEqual(result.problems, []);
});

test('the screen flags every structural probe, so it can never match nothing', () => {
  assert.ok(STRUCTURAL_PROBES.length >= 15, 'too few probes to trust the screen');
  const unflagged = STRUCTURAL_PROBES.filter(
    (probe) => screenIntentProse(probe).status !== 'structural',
  );
  assert.deepEqual(
    unflagged,
    [],
    'a screen that reports these as plain reports every draft as plain',
  );
});

test('the screen leaves ordinary problem prose alone, so it stays usable', () => {
  const flagged = PLAIN_PROBES.filter((probe) => screenIntentProse(probe).status !== 'plain');
  assert.deepEqual(flagged, [], 'a screen that flags ordinary prose is a screen nobody runs');
});

test('a stored intent carries no frontmatter', () => {
  const result = screenIntentProse(`---\nname: capture-sort\n---\n\n${PLAIN_INTENT}`);
  assert.equal(result.status, 'structural');
  assert.ok(result.findings.some((finding) => finding.kind === 'frontmatter-block'));
});

test('a stored intent carries no schema table or machine-facing heading', () => {
  const table = screenIntentProse(`${PLAIN_INTENT}\n| Field | Meaning |\n| --- | --- |\n`);
  assert.ok(table.findings.some((finding) => finding.kind === 'schema-table'));

  const heading = screenIntentProse(`${PLAIN_INTENT}\n## Required References\n`);
  assert.ok(heading.findings.some((finding) => finding.kind === 'schema-heading'));

  const inputs = screenIntentProse(`${PLAIN_INTENT}\n## Inputs\n`);
  assert.ok(inputs.findings.some((finding) => finding.kind === 'schema-heading'));
});

test('a stored intent carries no structural implementation terms', () => {
  const cases = [
    ['it grants allowed-tools of read and execute', 'frontmatter-field'],
    ['the used-by list is generated', 'frontmatter-field'],
    ['it composes two smaller pieces', 'frontmatter-field'],
    ['the work splits into two atoms and a molecule', 'composition-shape'],
    ['anything shared lives under _base', 'composition-shape'],
    ['the workflow lives in SKILL.md', 'repository-path'],
    ['a refusal returns exit code 2', 'tooling'],
    ['the record is passed as JSON', 'tooling'],
  ];
  for (const [line, kind] of cases) {
    const result = screenIntentProse(`${PLAIN_INTENT}\n${line}\n`);
    assert.equal(result.status, 'structural', `unflagged: ${line}`);
    assert.ok(
      result.findings.some((finding) => finding.kind === kind),
      `${line} should be flagged as ${kind}, got ${JSON.stringify(result.findings)}`,
    );
  }
});

test('structural detail inside a fenced block is still refused', () => {
  const fenced = `${PLAIN_INTENT}\n\`\`\`text\nallowed-tools: ["read"]\n\`\`\`\n`;
  const result = screenIntentProse(fenced);
  assert.equal(
    result.status,
    'structural',
    'a fenced block is where structural detail accumulates most naturally',
  );
});

test('a draft that names the wrong skill is refused', () => {
  const result = reviewIntentDraft(PLAIN_INTENT, 'something-else');
  assert.equal(result.shape, 'malformed');
  assert.match(result.problems.join(' '), /names capture-sort but the intent is for something-else/);
});

test('a draft with no title or no sections is refused', () => {
  assert.equal(reviewIntentDraft('Some words about a thing.\n', 'capture-sort').shape, 'malformed');
  assert.equal(reviewIntentDraft('# Intent: capture-sort\n\nOne paragraph.\n', 'capture-sort').shape, 'malformed');
});

test('an empty draft is refused rather than reported clean', () => {
  assert.equal(refusal(() => screenIntentProse('   \n')).code, 'empty_draft');
  assert.equal(refusal(() => screenIntentProse(null)).code, 'invalid_input');
});

test('an unknown command-line argument is refused rather than ignored', () => {
  assert.equal(refusal(() => parseArguments(['--screen', '/a/b', '--skill', 'x', '--lenient'])).code, 'usage');
  assert.equal(refusal(() => parseArguments([])).code, 'usage');
});

test('a review with no skill name is refused rather than skipping the title check', () => {
  assert.equal(refusal(() => parseArguments(['--screen', '/a/b'])).code, 'usage');
  for (const skill of [undefined, '', '   ', 7]) {
    assert.equal(refusal(() => reviewIntentDraft(PLAIN_INTENT, skill)).code, 'missing_skill');
  }
});

test('the command exits 2 on a structural draft and 0 on a plain one', (t) => {
  const root = workspace(t);
  const plain = path.join(root, 'plain.md');
  const structural = path.join(root, 'structural.md');
  fs.writeFileSync(plain, PLAIN_INTENT);
  fs.writeFileSync(structural, `${PLAIN_INTENT}\nIt declares allowed-tools of read.\n`);

  const ok = captureStreams();
  assert.equal(runSynthesis(['--screen', plain, '--skill', 'capture-sort'], ok), 0);
  assert.match(ok.output(), /"status": "plain"/);

  const refused = captureStreams();
  assert.equal(runSynthesis(['--screen', structural, '--skill', 'capture-sort'], refused), 2);
  assert.match(refused.output(), /frontmatter-field/);

  const usage = captureStreams();
  assert.equal(runSynthesis(['--screen'], usage), 1);
});
