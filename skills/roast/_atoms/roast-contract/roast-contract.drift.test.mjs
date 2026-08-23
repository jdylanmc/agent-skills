/**
 * Drift guard between the checker's recognised headings and the headings the
 * emitting documents actually write.
 *
 * The defect this file exists to prevent was real and shipped: the checker
 * recognised `Findings`, `Must Fix`, `Should Fix`, and `Consider`, while the
 * bundled Roastmaster directive emits `## Accepted Findings`. Given a report
 * written the way the lens actually writes one, the checker reported
 * `"status": "Valid", "findings": 0` — it saw nothing and called that success,
 * which is worse than having no checker, because the envelope checklist now
 * points at it.
 *
 * The root cause was a hardcoded vocabulary in `.mjs` that a Markdown document
 * owned, with nothing tying the two together. That is the same class of problem
 * the artifact profile solved for the three drifted references. So rather than
 * hand-syncing the list, this suite **derives** the findings-bearing headings
 * from the emitting documents and asserts the checker recognises every one.
 *
 * A heading is findings-bearing when its section contains an entry carrying a
 * `Recommendation` field, or declares it repeats a finding shape. That is a
 * structural test, not a name match, so renaming a section does not evade it
 * and adding a new findings section fails the build until the checker knows it.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ACCEPTED_FINDING_SECTIONS,
  EXEMPT_FINDING_SECTIONS,
  validateFindingSchema,
} from './roast-contract.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');

/**
 * Every document that writes a findings section a roast will later check.
 * The coordinator serves the artifact branch; the directive serves the code
 * branch. Both must be covered, because both feed the same checker.
 */
const EMITTING_DOCUMENTS = {
  'the artifact-branch coordinator': 'agents/artifact-roastmaster.agent.md',
  'the code-branch roastmaster directive':
    'skills/roast/references/bundled-roasters/the-roastmaster/directive.md',
};

function read(relativePath) {
  return fs.readFileSync(path.join(REPOSITORY_ROOT, ...relativePath.split('/')), 'utf8');
}

/**
 * Splits a document into `##` sections. Fenced blocks are deliberately **not**
 * skipped: the templates a coordinator is told to emit live inside fences, and
 * those templates are exactly what a real report will look like.
 */
function sectionsOf(document) {
  const sections = new Map();
  let current = null;
  for (const line of document.replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading && !line.startsWith('###')) {
      current = heading[1];
      if (!sections.has(current)) {
        sections.set(current, []);
      }
      continue;
    }
    if (current !== null) {
      sections.get(current).push(line);
    }
  }
  return sections;
}

function findingsBearingHeadings(document) {
  const found = [];
  for (const [heading, body] of sectionsOf(document)) {
    const text = body.join('\n');
    const hasEntryWithRecommendation =
      /^###\s+\S/m.test(text) && /^\s*-\s+`?Recommendation`?\s*:/m.test(text);
    const repeatsAFindingShape = /same finding shape/i.test(text);
    if (hasEntryWithRecommendation || repeatsAFindingShape) {
      found.push(heading);
    }
  }
  return found;
}

test('the checker recognises every findings-bearing heading the lens documents emit', () => {
  for (const [label, relativePath] of Object.entries(EMITTING_DOCUMENTS)) {
    const emitted = findingsBearingHeadings(read(relativePath));
    assert.ok(emitted.length > 0, `${label} emits no findings section; the detector is broken`);

    const unrecognised = emitted.filter((heading) => !ACCEPTED_FINDING_SECTIONS.includes(heading));
    assert.deepEqual(
      unrecognised,
      [],
      `${label} (${relativePath}) emits ${unrecognised.join(', ')}, which the checker does not check`,
    );
  }
});

test('the emitting documents together cover the canonical heading vocabulary', () => {
  // The specific heading whose absence caused the shipped defect, named so a
  // regression is unmistakable rather than merely counted.
  const directive = findingsBearingHeadings(read(EMITTING_DOCUMENTS['the code-branch roastmaster directive']));
  assert.ok(directive.includes('Accepted Findings'));

  const coordinator = findingsBearingHeadings(read(EMITTING_DOCUMENTS['the artifact-branch coordinator']));
  for (const heading of ['Findings', 'Must Fix', 'Should Fix', 'Consider']) {
    assert.ok(coordinator.includes(heading), `the coordinator no longer emits ${heading}`);
  }
});

test('a disposition section carries no recommendation and is deliberately exempt', () => {
  // The decision, held as a test rather than left implicit. A rejected, merged,
  // or downgraded finding is not an accepted finding: its content is why the
  // council declined it. Demanding a fix for a problem the council decided is
  // not a problem would manufacture advice.
  for (const [label, relativePath] of Object.entries(EMITTING_DOCUMENTS)) {
    const emitted = findingsBearingHeadings(read(relativePath));
    for (const heading of EXEMPT_FINDING_SECTIONS) {
      assert.ok(
        !emitted.includes(heading),
        `${label} gives ${heading} a Recommendation field, so it is no longer a disposition section`,
      );
    }
  }

  const overlap = ACCEPTED_FINDING_SECTIONS.filter((heading) =>
    EXEMPT_FINDING_SECTIONS.includes(heading),
  );
  assert.deepEqual(overlap, [], `a heading cannot be both checked and exempt: ${overlap.join(', ')}`);
});

test('a report shaped the way the lens actually writes one is checked', () => {
  // End to end, using the Roastmaster's real heading vocabulary rather than a
  // heading chosen to suit the checker. This is the fixture whose absence let
  // the defect ship.
  const realistic = [
    '# Roastmaster Recommendation',
    '',
    'Schema version: 1',
    '',
    '## Council Summary',
    '',
    'three roasters, doctrine loaded, no evidence gaps',
    '',
    '## Scope and Revision',
    '',
    'skills/roast at revision bf07888',
    '',
    '## Accepted Findings',
    '',
    '### RF-001',
    '- Priority: Must fix',
    '- Confidence: High',
    '- Location: skills/roast/SKILL.md:12',
    '- Evidence: the grant names a tool no step uses',
    '- Consequence: the skill can do more than its workflow needs',
    '- Root cause: the grant was copied from a predecessor',
    '- Validation: rerun the deriver and see no grant violation',
    '- Contributing reviewer IDs: solid-yagni-kiss-roaster',
    '',
    '### RF-002',
    '- Priority: Should fix',
    '- Confidence: Medium',
    '- Location: skills/roast/README.md:40',
    '- Evidence: the maintenance command is stale',
    '- Consequence: a maintainer runs the wrong command',
    '- Recommendation:',
    '',
    '````text',
    '- Recommendation: update the command',
    '````',
    '',
    '- Validation: run the documented command and compare output',
    '',
    '## Rejected, Merged, or Downgraded Findings',
    '',
    '### RF-003',
    '- Disposition: merged into RF-001',
    '- Reason: the same root cause',
    '',
    'END ROASTMASTER RECOMMENDATION',
  ].join('\n');

  const result = validateFindingSchema(realistic);

  // The two real violations are seen, and the count is not zero.
  assert.equal(result.findings, 2);
  assert.equal(result.status, 'Invalid');
  assert.deepEqual(
    result.defects.map((defect) => [defect.finding, defect.field]),
    [
      ['RF-001', 'Recommendation'],
      ['RF-002', 'Recommendation'],
    ],
  );
  assert.match(result.defects[0].message, /missing the required field Recommendation/);
  assert.match(result.defects[1].message, /no content outside a fenced block/);

  // The disposition entry is exempt, not a defect and not a finding.
  assert.equal(result.exempt, 1);
  assert.equal(result.unrecognised, 0);
});

test('a finding under an unrecognised heading fails closed instead of vanishing', () => {
  const report = [
    '# Artifact Roast',
    '',
    '## Critical Problems',
    '',
    '### AR-001',
    '- Priority: Must fix',
    '- Location: skills/roast/SKILL.md:1',
    '- Evidence: something',
    '- Consequence: something else',
    '',
    '## Must Fix',
    '',
    'none',
  ].join('\n');

  const result = validateFindingSchema(report);
  assert.equal(result.status, 'Invalid');
  assert.equal(result.unrecognised, 1);
  assert.equal(result.defects[0].category, 'Unrecognised findings section');
  assert.match(result.defects[0].message, /unrecognised heading "Critical Problems"/);
  assert.match(result.defects[0].message, /never checked/);
});

test('a finding before any heading fails closed instead of vanishing', () => {
  const report = [
    '### AR-001',
    '- Priority: Must fix',
    '- Location: skills/roast/SKILL.md:1',
    '- Consequence: unreviewed',
    '',
    '## Must Fix',
    '',
    'none',
  ].join('\n');

  const result = validateFindingSchema(report);
  assert.equal(result.status, 'Invalid');
  assert.equal(result.unrecognised, 1);
  assert.equal(result.defects[0].category, 'Unrecognised findings section');
  assert.equal(result.defects[0].section, null);
  assert.match(result.defects[0].message, /before any heading/);
});

test('an ordinary subheading carrying no schema field is not mistaken for a finding', () => {
  const report = [
    '# Artifact Roast',
    '',
    '## Council Summary',
    '',
    '### Model routing',
    '',
    'every roaster ran on the requested model',
    '',
    '## Must Fix',
    '',
    'none',
  ].join('\n');

  const result = validateFindingSchema(report);
  assert.equal(result.status, 'Valid');
  assert.equal(result.findings, 0);
  assert.equal(result.unrecognised, 0);
});

test('the coordinator emits every envelope heading the checklist requires', () => {
  // Item 4 of the Envelope Schema 1 Checklist names four headings the
  // coordinator must produce. Those names live in the contract while the
  // coordinator owns what it writes, which is the same split that let the
  // findings-section list drift.
  const template = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'skills', 'roast', '_atoms', 'roast-contract', 'roast-contract.md'),
    'utf8',
  );
  const coordinator = read(EMITTING_DOCUMENTS['the artifact-branch coordinator']);

  const item4 = /4\. These headings each appear exactly once[\s\S]*?(?=\n5\. )/.exec(template);
  assert.ok(item4, 'the envelope checklist no longer states item 4');
  const required = [...item4[0].matchAll(/`(## [A-Z][A-Za-z -]*)`/g)].map((match) => match[1]);
  assert.equal(required.length, 4, `item 4 names ${required.length} headings, expected 4`);

  const missing = required.filter(
    (heading) => !new RegExp(`^${heading}\\s*$`, 'm').test(coordinator),
  );
  assert.deepEqual(
    missing,
    [],
    `the checklist requires ${missing.join(', ')}, which the coordinator does not emit`,
  );
});

test('a report that visibly contains findings can never report zero findings and pass', () => {
  // The invariant, stated directly. Every heading either checks its entries or
  // fails closed on them; nothing is silently skipped.
  for (const heading of ['Accepted Findings', 'Findings', 'Must Fix', 'Invented Heading']) {
    const report = [
      '# Report',
      '',
      `## ${heading}`,
      '',
      '### X-01',
      '- Priority: Must fix',
      '- Location: a',
      '- Evidence: b',
      '- Consequence: c',
    ].join('\n');

    const result = validateFindingSchema(report);
    assert.equal(result.status, 'Invalid', `${heading} passed a finding with no recommendation`);
    assert.ok(
      result.findings + result.unrecognised > 0,
      `${heading} produced a zero count for a report that visibly contains a finding`,
    );
  }
});
