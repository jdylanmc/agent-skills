/**
 * Seam tests for disclosure-ledger.
 *
 * The property worth holding: a clean ledger is a genuinely two-sided account —
 * nothing in the source is unaccounted for and nothing in the candidate is
 * unsourced — each named defect is detected, an anchor too short to fail is a
 * defect, and the ledger digest is deterministic regardless of entry or key
 * order.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CLASSIFICATIONS,
  DISPOSITIONS,
  DEFECT_CODES,
  DisclosureLedgerError,
  FENCE_INFO_STRING,
  KINDS,
  MIN_ANCHOR_CHARS,
  MIN_ANCHOR_WORDS,
  RELOCATION_PHRASES,
  STRUCTURAL_TOKEN_SHAPES,
  collectLedgerDefects,
  isDegenerateAnchor,
  ledgerDigest,
  validateLedger,
} from './disclosure-ledger.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOCUMENT = fs.readFileSync(path.join(UNIT_ROOT, 'disclosure-ledger.md'), 'utf8');

const SOURCE_PATH = 'docs/agent/specs/faster-checkout.full.md';
const CANDIDATE_PATH = 'docs/agent/specs/faster-checkout.nano.md';

const L = {
  spec: 'Spec identity is SPEC-FASTER-CHECKOUT for this bounded feature.',
  srcId: 'Discovery source is docs/agent/discovery/faster-checkout for this feature.',
  rev: 'Source revision is pinned to the recorded content digest value.',
  full: 'Full specification companion link is faster-checkout.full.md sibling document.',
  intent: 'Customers can select an eligible payment method without leaving the checkout flow.',
  ac1: 'An eligible customer can see the additional payment method during checkout today.',
  ac2: 'An ineligible customer sees the existing checkout experience left unchanged here.',
  nonGoal: 'Selecting a payment provider implementation is out of scope for this work item.',
};

// An acceptance-criterion line carries its identifier as part of the claim, so
// the anchor spans the identifier too. The identifier is no longer bare residue.
const AC1_LINE = `AC-001: ${L.ac1}`;
const AC2_LINE = `AC-002: ${L.ac2}`;

const SOURCE_TEXT = [
  L.spec,
  L.srcId,
  L.rev,
  L.full,
  L.intent,
  AC1_LINE,
  AC2_LINE,
  L.nonGoal,
].join('\n');

// The candidate carries list markers to exercise token-residue coverage: the
// whole-line anchor accounts for the criterion including its identifier, and the
// leading `- ` list marker is the only residue.
const VARIANT_TEXT = [
  L.spec,
  L.srcId,
  L.rev,
  L.full,
  L.intent,
  `- ${AC1_LINE}`,
  `- ${AC2_LINE}`,
  L.nonGoal,
].join('\n');

function baseEntries() {
  return [
    { id: 'spec-identity', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: L.spec, variantAnchor: L.spec, covers: ['spec-identity'] },
    { id: 'source-identity', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: L.srcId, variantAnchor: L.srcId, covers: ['source-identity'] },
    { id: 'source-revision', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: L.rev, variantAnchor: L.rev, covers: ['source-revision'] },
    { id: 'full-link', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: L.full, variantAnchor: L.full, covers: ['full-link'] },
    { id: 'intention', disposition: 'retained', kind: 'intention', classification: 'authoritative', sourceAnchor: L.intent, variantAnchor: L.intent, covers: ['intention'] },
    { id: 'ac-1', disposition: 'retained', kind: 'criterion', classification: 'authoritative', sourceAnchor: AC1_LINE, variantAnchor: AC1_LINE, covers: ['acceptance-criteria'] },
    { id: 'ac-2', disposition: 'retained', kind: 'criterion', classification: 'authoritative', sourceAnchor: AC2_LINE, variantAnchor: AC2_LINE, covers: [] },
    { id: 'non-goals', disposition: 'retained', kind: 'non-goal', classification: 'authoritative', sourceAnchor: L.nonGoal, variantAnchor: L.nonGoal, covers: ['non-goals'] },
  ];
}

function input(overrides = {}) {
  return {
    entries: overrides.entries ?? baseEntries(),
    sourceText: overrides.sourceText ?? SOURCE_TEXT,
    variantText: overrides.variantText ?? VARIANT_TEXT,
    profileId: overrides.profileId ?? 'spec-nano',
    sourcePath: overrides.sourcePath ?? SOURCE_PATH,
    candidatePath: overrides.candidatePath ?? CANDIDATE_PATH,
  };
}

function codes(overrides) {
  return collectLedgerDefects(input(overrides)).map((defect) => defect.code);
}

function thrownCode(overrides) {
  try {
    validateLedger(input(overrides));
  } catch (error) {
    return error.code;
  }
  return null;
}

test('a faithful ledger for a canonical spec-pair-shaped nano validates clean, not degenerate-anchor', () => {
  // The canonical nano's title and metadata lines are short by design. With the
  // whole-line rule they are faithful anchors, so an honest first-consumer
  // artifact resolves clean rather than refusing on degenerate-anchor.
  const N = {
    title: 'Faster checkout',
    specId: 'Spec ID: SPEC-CHECKOUT-1',
    source: 'Source: docs/agent/discovery/faster-checkout.md',
    rev: 'Source revision: 0123abcd4567ef89',
    full: 'Full specification: [faster-checkout.full.md](./faster-checkout.full.md)',
    intent: 'Customers can select an eligible payment method without leaving the checkout flow.',
    ac1: 'An eligible customer can see the additional payment method during checkout today.',
    nonGoal: 'Selecting a payment provider implementation is out of scope for this work item.',
  };
  const nano = [
    `# ${N.title}`,
    `- ${N.specId}`,
    `- ${N.source}`,
    `- ${N.rev}`,
    `- ${N.full}`,
    '## Intention',
    N.intent,
    '## Acceptance Criteria',
    `- AC-001: ${N.ac1}`,
    '## Non-goals',
    N.nonGoal,
  ].join('\n');
  const full = [
    N.title, N.specId, N.source, N.rev, N.full, N.intent, `AC-001: ${N.ac1}`, N.nonGoal,
  ].join('\n');
  const entries = [
    { id: 'title', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.title, variantAnchor: N.title, covers: [] },
    { id: 'spec-identity', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.specId, variantAnchor: N.specId, covers: ['spec-identity'] },
    { id: 'source-identity', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.source, variantAnchor: N.source, covers: ['source-identity'] },
    { id: 'source-revision', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.rev, variantAnchor: N.rev, covers: ['source-revision'] },
    { id: 'full-link', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: N.full, variantAnchor: N.full, covers: ['full-link'] },
    { id: 'intention', disposition: 'retained', kind: 'intention', classification: 'authoritative', sourceAnchor: N.intent, variantAnchor: N.intent, covers: ['intention'] },
    { id: 'ac-1', disposition: 'retained', kind: 'criterion', classification: 'authoritative', sourceAnchor: `AC-001: ${N.ac1}`, variantAnchor: `AC-001: ${N.ac1}`, covers: ['acceptance-criteria'] },
    { id: 'non-goals', disposition: 'retained', kind: 'non-goal', classification: 'authoritative', sourceAnchor: N.nonGoal, variantAnchor: N.nonGoal, covers: ['non-goals'] },
  ];
  const found = collectLedgerDefects({
    entries, sourceText: full, variantText: nano, profileId: 'spec-nano',
    sourcePath: SOURCE_PATH, candidatePath: CANDIDATE_PATH,
  }).map((d) => d.code);
  assert.deepEqual(found, []);
});

test('a clean ledger validates and carries the profile id and a digest', () => {
  assert.deepEqual(codes(), []);
  const result = validateLedger(input());
  assert.equal(result.status, 'clean');
  assert.equal(result.profileId, 'spec-nano');
  assert.equal(result.digest, ledgerDigest(baseEntries()));
  assert.equal(result.candidatePath, CANDIDATE_PATH);
  assert.equal(result.candidateDigest, createHash('sha256').update(VARIANT_TEXT).digest('hex'));
});

test('an unknown or absent profile id refuses with unknown-profile', () => {
  assert.equal(thrownCode({ profileId: 'spec-mini' }), 'unknown-profile');
  const absent = { entries: baseEntries(), sourceText: SOURCE_TEXT, variantText: VARIANT_TEXT };
  assert.throws(() => validateLedger(absent), (error) => error.code === 'unknown-profile');
});

test('a caller can no longer hand in a profile shape that checks nothing', () => {
  // The old hole: a `profile` object with empty rules. It is now ignored; only
  // the resolved `profileId` decides the rules, and the run still validates.
  const smuggled = input();
  smuggled.profile = { nonOmittableKinds: [], requiredContent: [] };
  assert.deepEqual(collectLedgerDefects(smuggled).map((d) => d.code), []);
});

test('a malformed or duplicate entry is invalid-entry', () => {
  const withMissing = baseEntries();
  withMissing.push({ id: 'broken', disposition: 'sideways', kind: 'context', classification: 'supporting', sourceAnchor: 'checkout' });
  assert.ok(codes({ entries: withMissing }).includes('invalid-entry'));

  const withDuplicate = baseEntries();
  withDuplicate.push({ ...baseEntries()[0] });
  assert.ok(codes({ entries: withDuplicate }).includes('invalid-entry'));
});

test('a sourceAnchor that is not exact source material is untraceable-claim', () => {
  const entries = baseEntries();
  entries[4] = { ...entries[4], sourceAnchor: 'a claim the source never made in any of its lines' };
  assert.equal(thrownCode({ entries }), 'untraceable-claim');
});

test('a degenerate anchor is degenerate-anchor even when it traces to the source', () => {
  // "checkout flow" is exact source material but only two words: short enough to
  // match by accident, so it proves nothing.
  const entries = baseEntries();
  entries[4] = { ...entries[4], sourceAnchor: 'checkout flow' };
  assert.ok(codes({ entries }).includes('degenerate-anchor'));
  assert.ok(!codes({ entries }).includes('untraceable-claim'));

  const shortVariant = baseEntries();
  shortVariant[4] = { ...shortVariant[4], variantAnchor: 'payment' };
  assert.ok(codes({ entries: shortVariant }).includes('degenerate-anchor'));
});

test('the documented anchor thresholds match the exported constants', () => {
  assert.match(DOCUMENT, new RegExp(`MIN_ANCHOR_CHARS\\s*=\\s*${MIN_ANCHOR_CHARS}\\b`));
  assert.match(DOCUMENT, new RegExp(`MIN_ANCHOR_WORDS\\s*=\\s*${MIN_ANCHOR_WORDS}\\b`));
});

test('seven retained source-only entries against an empty candidate refuse with unanchored-survival', () => {
  // The exact hole: retained entries claiming required content with no candidate
  // anchor validated against an empty variant.
  const entries = baseEntries().slice(0, 7).map((entry) => ({ ...entry, variantAnchor: undefined }));
  const found = codes({ entries, variantText: '' });
  assert.ok(found.includes('unanchored-survival'));
  assert.equal(thrownCode({ entries, variantText: '' }), 'unanchored-survival');
});

test('a surviving entry whose variantAnchor is absent from the candidate is variant-anchor-absent', () => {
  const entries = baseEntries();
  entries[4] = { ...entries[4], variantAnchor: 'a variant phrase that appears nowhere in the candidate text at all' };
  assert.ok(codes({ entries }).includes('variant-anchor-absent'));
});

test('an omitted entry may lack a variantAnchor without unanchored-survival', () => {
  const entries = baseEntries();
  // Drop the second acceptance criterion by omission and remove its candidate line.
  entries[6] = { ...entries[6], disposition: 'omitted', kind: 'context', classification: 'supporting', reason: 'left this supporting line out of the nano', variantAnchor: undefined, covers: [] };
  const variantText = VARIANT_TEXT.split('\n').filter((line) => !line.includes('AC-002')).join('\n');
  const found = codes({ entries, variantText });
  assert.ok(!found.includes('unanchored-survival'));
  assert.ok(!found.includes('variant-anchor-absent'));
});

test('isDegenerateAnchor holds at the boundary of both thresholds', () => {
  assert.equal(isDegenerateAnchor('one two three four'), false);
  assert.equal(isDegenerateAnchor('one two'), true); // too few words
  assert.equal(isDegenerateAnchor('a b c'), true); // too few characters
});

test('candidate prose no anchor accounts for is invented-claim', () => {
  const variantText = `${VARIANT_TEXT}\nAn invented promise the source never actually supplied here.`;
  assert.ok(codes({ variantText }).includes('invented-claim'));
  assert.equal(thrownCode({ variantText }), 'invented-claim');
});

test('a number borrowed from an unrelated sentence is invented-claim, not structural residue', () => {
  // The exact round-4 hole: the source mentions 500 in an unrelated roadmap
  // sentence, and an unrelated candidate latency claim borrows it. Gating per
  // document used to excuse it; gating per covering entry refuses it.
  const prefix = 'The eligible checkout latency requirement is measured in whole units';
  const sourceText = `${SOURCE_TEXT}\n${prefix}\nThe product roadmap lists 500 planned milestones for the coming year today.`;
  const variantText = `${VARIANT_TEXT}\n${prefix} 500`;
  const entries = [
    ...baseEntries(),
    { id: 'latency', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: prefix, variantAnchor: prefix, covers: [] },
    { id: 'roadmap', disposition: 'omitted', kind: 'context', classification: 'supporting', reason: 'the roadmap line is out of scope for the nano', sourceAnchor: 'The product roadmap lists 500 planned milestones for the coming year today.', covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText, variantText, entries })).map((d) => d.code);
  assert.ok(found.includes('invented-claim'));
});

for (const token of ['2.5', '-5', '99%', '500ms']) {
  test(`a residue ${token} the covering entry anchor does not carry is invented-claim`, () => {
    const prefix = 'The eligible checkout latency requirement is measured in whole units';
    const sourceText = `${SOURCE_TEXT}\n${prefix}`;
    const variantText = `${VARIANT_TEXT}\n${prefix} ${token}`;
    const entries = [
      ...baseEntries(),
      { id: 'latency', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: prefix, variantAnchor: prefix, covers: [] },
    ];
    const found = collectLedgerDefects(input({ sourceText, variantText, entries })).map((d) => d.code);
    assert.ok(found.includes('invented-claim'), `${token} should be invented-claim; got ${found}`);
  });
}

test('a compound number does not decompose into component digits present in the anchor', () => {
  // The anchor carries `2` and `5` as separate tokens but never `2.5`. Atomic
  // tokenization keeps `2.5` a single token, so it is not excused by its digits.
  const prefix = 'Between step 2 and step 5 the eligible checkout flow completes here';
  const sourceText = `${SOURCE_TEXT}\n${prefix}`;
  const variantText = `${VARIANT_TEXT}\n${prefix} 2.5`;
  const entries = [
    ...baseEntries(),
    { id: 'compound', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: prefix, variantAnchor: prefix, covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText, variantText, entries })).map((d) => d.code);
  assert.ok(found.includes('invented-claim'));
});

test('an invented identifier the source never named is invented-claim', () => {
  // `AC-999` matches no covering anchor, so the whole candidate line is unsourced.
  const variantText = `${VARIANT_TEXT}\n- AC-999: ${L.ac1}`;
  assert.ok(codes({ variantText }).includes('invented-claim'));
});

test('a number genuinely present in the covering entry sourceAnchor stays clean', () => {
  // The trailing 500 repeats a number the covering anchor already carries, so it
  // is structural residue beside the anchor rather than an invented threshold.
  const line = 'The eligible checkout latency budget is 500 ms (500)';
  const anchor = 'The eligible checkout latency budget is 500 ms';
  const sourceText = `${SOURCE_TEXT}\n${line}`;
  const variantText = `${VARIANT_TEXT}\n${line}`;
  const entries = [
    ...baseEntries(),
    { id: 'latency', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: anchor, variantAnchor: anchor, covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText, variantText, entries })).map((d) => d.code);
  assert.deepEqual(found, []);
});

// The round-5 numeric-compound holes: a compound is one token that must occur in
// the covering `sourceAnchor`. Absent, it is `invented-claim`; present, clean.
const COMPOUND_BASE = 'The eligible checkout compound residue example line here';
for (const token of ['$5', '5–10', '5-10', '5/10', '2026-08-29', '1e6', '0x1F', '5th', '5:1', '09:30', '2026.08.29', '1.2.3']) {
  test(`a numeric compound ${token} absent from the covering anchor is invented-claim`, () => {
    const sourceText = `${SOURCE_TEXT}\n${COMPOUND_BASE}`;
    const variantText = `${VARIANT_TEXT}\n${COMPOUND_BASE} ${token}`;
    const entries = [
      ...baseEntries(),
      { id: 'compound', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: COMPOUND_BASE, variantAnchor: COMPOUND_BASE, covers: [] },
    ];
    const found = collectLedgerDefects(input({ sourceText, variantText, entries })).map((d) => d.code);
    assert.ok(found.includes('invented-claim'), `${token} should be invented-claim; got ${found}`);
  });

  test(`a numeric compound ${token} present in the covering anchor is clean`, () => {
    const line = `${COMPOUND_BASE} ${token}`;
    const sourceText = `${SOURCE_TEXT}\n${line}`;
    const variantText = `${VARIANT_TEXT}\n${line}`;
    const entries = [
      ...baseEntries(),
      { id: 'compound', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: line, variantAnchor: COMPOUND_BASE, covers: [] },
    ];
    const found = collectLedgerDefects(input({ sourceText, variantText, entries })).map((d) => d.code);
    assert.deepEqual(found, [], `${token} should be clean; got ${found}`);
  });
}

test('a traced count reworded into a priced $5 acquires invented semantics: invented-claim', () => {
  // The exact round-5 exploit: source "a count of 5 items" reworded into
  // "a count of items for planning: $5." The bare count 5 is in the anchor; the
  // price compound $5 is a different token, absent from it, so invented-claim.
  const sourceLine = 'a count of 5 items';
  const variantLine = 'a count of items for planning: $5.';
  const entries = [
    ...baseEntries(),
    { id: 'count', disposition: 'reworded', kind: 'context', classification: 'supporting', meaningPreserved: true, reason: 'shortened the count line for the nano', sourceAnchor: sourceLine, variantAnchor: 'a count of items for planning', covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText: `${SOURCE_TEXT}\n${sourceLine}`, variantText: `${VARIANT_TEXT}\n${variantLine}`, entries })).map((d) => d.code);
  assert.ok(found.includes('invented-claim'), `expected invented-claim; got ${found}`);
});

test('a range invented from separate source 5 and 10 is invented-claim', () => {
  // Separate source numbers 5 and 10 do not license the invented compound 5–10.
  const sourceLine = 'the eligible checkout range covers 5 and 10';
  const variantLine = 'the eligible checkout range covers 5–10';
  const entries = [
    ...baseEntries(),
    { id: 'range', disposition: 'reworded', kind: 'context', classification: 'supporting', meaningPreserved: true, reason: 'compressed the range line for the nano', sourceAnchor: sourceLine, variantAnchor: 'the eligible checkout range covers', covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText: `${SOURCE_TEXT}\n${sourceLine}`, variantText: `${VARIANT_TEXT}\n${variantLine}`, entries })).map((d) => d.code);
  assert.ok(found.includes('invented-claim'), `expected invented-claim; got ${found}`);
});

test('a colon ratio invented from a separate source 5 and 1 is invented-claim', () => {
  // Finding B (round 6): the source says `5 and 1`; the candidate assembles the
  // ratio `5:1`. The colon compound is one token absent from the covering anchor.
  const sourceLine = 'the eligible checkout ratio compares 5 and 1';
  const variantLine = 'the eligible checkout ratio compares 5:1';
  const entries = [
    ...baseEntries(),
    { id: 'ratio', disposition: 'reworded', kind: 'context', classification: 'supporting', meaningPreserved: true, reason: 'compressed the ratio line for the nano', sourceAnchor: sourceLine, variantAnchor: 'the eligible checkout ratio compares', covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText: `${SOURCE_TEXT}\n${sourceLine}`, variantText: `${VARIANT_TEXT}\n${variantLine}`, entries })).map((d) => d.code);
  assert.ok(found.includes('invented-claim'), `expected invented-claim; got ${found}`);
});

test('a dotted date invented from a separate source 2026.08 and 29 is invented-claim', () => {
  // Finding B (round 6): the source carries `2026.08` and `29` separately; the
  // candidate assembles the dotted date `2026.08.29`, one token absent from the
  // covering anchor.
  const sourceLine = 'the eligible checkout window spans 2026.08 and 29';
  const variantLine = 'the eligible checkout window spans 2026.08.29';
  const entries = [
    ...baseEntries(),
    { id: 'date', disposition: 'reworded', kind: 'context', classification: 'supporting', meaningPreserved: true, reason: 'compressed the date line for the nano', sourceAnchor: sourceLine, variantAnchor: 'the eligible checkout window spans', covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText: `${SOURCE_TEXT}\n${sourceLine}`, variantText: `${VARIANT_TEXT}\n${variantLine}`, entries })).map((d) => d.code);
  assert.ok(found.includes('invented-claim'), `expected invented-claim; got ${found}`);
});

test('a sentence-final period does not glue onto a traced number', () => {
  // Finding B (round 6): `500.` at the end of a sentence must tokenize as `500`
  // beside a bare `.`, so a traced 500 stays clean rather than becoming an
  // invented `500.` compound.
  const line = 'The eligible checkout limit is 500.';
  const variantAnchor = 'The eligible checkout limit is 500';
  const entries = [
    ...baseEntries(),
    { id: 'limit', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: line, variantAnchor, covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText: `${SOURCE_TEXT}\n${line}`, variantText: `${VARIANT_TEXT}\n${line}`, entries })).map((d) => d.code);
  assert.deepEqual(found, []);
});

// Finding B (round 7): spaced and unit-/symbol-bearing range and ratio notation
// is still one atomic token. Each of these is invented from a source that
// carries the endpoints separately, so the compound is absent from the covering
// `sourceAnchor` and must be `invented-claim`.
const SPACED_COMPOUND_CASES = [
  { name: '5 – 10', source: 'the eligible checkout range covers 5 and 10', variant: 'the eligible checkout range covers 5 – 10', anchor: 'the eligible checkout range covers' },
  { name: '5 : 10', source: 'the eligible checkout ratio compares 5 and 10', variant: 'the eligible checkout ratio compares 5 : 10', anchor: 'the eligible checkout ratio compares' },
  { name: '5ms–10ms', source: 'the eligible checkout latency spans 5ms and 10ms', variant: 'the eligible checkout latency spans 5ms–10ms', anchor: 'the eligible checkout latency spans' },
  { name: '5%–10%', source: 'the eligible checkout share spans 5% and 10%', variant: 'the eligible checkout share spans 5%–10%', anchor: 'the eligible checkout share spans' },
  { name: '$5–$10', source: 'the eligible checkout price spans $5 and $10', variant: 'the eligible checkout price spans $5–$10', anchor: 'the eligible checkout price spans' },
];

for (const c of SPACED_COMPOUND_CASES) {
  test(`a spaced/affixed compound ${c.name} invented from separate endpoints is invented-claim`, () => {
    const entries = [
      ...baseEntries(),
      { id: 'compound', disposition: 'reworded', kind: 'context', classification: 'supporting', meaningPreserved: true, reason: 'compressed the compound line for the nano', sourceAnchor: c.source, variantAnchor: c.anchor, covers: [] },
    ];
    const found = collectLedgerDefects(input({ sourceText: `${SOURCE_TEXT}\n${c.source}`, variantText: `${VARIANT_TEXT}\n${c.variant}`, entries })).map((d) => d.code);
    assert.ok(found.includes('invented-claim'), `${c.name} should be invented-claim; got ${found}`);
  });

  test(`a spaced/affixed compound ${c.name} present in the covering anchor is clean`, () => {
    const line = c.variant;
    const entries = [
      ...baseEntries(),
      { id: 'compound', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: line, variantAnchor: c.anchor, covers: [] },
    ];
    const found = collectLedgerDefects(input({ sourceText: `${SOURCE_TEXT}\n${line}`, variantText: `${VARIANT_TEXT}\n${line}`, entries })).map((d) => d.code);
    assert.deepEqual(found, [], `${c.name} should be clean; got ${found}`);
  });
}

test('an em dash used as punctuation between words still validates (finding B guard)', () => {
  // An em dash between two words is not a numeric separator: no digit on either
  // side, so it stays bare punctuation and the anchored line is clean.
  const line = 'The eligible checkout flow is fast — and it stays responsive here.';
  const entries = [
    ...baseEntries(),
    { id: 'dash', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: line, variantAnchor: line, covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText: `${SOURCE_TEXT}\n${line}`, variantText: `${VARIANT_TEXT}\n${line}`, entries })).map((d) => d.code);
  assert.deepEqual(found, []);
});

test('a colon introducing a list still validates (finding B guard)', () => {
  // A colon before a word is not a numeric separator: no digit after it, so it
  // stays bare punctuation and the anchored line is clean.
  const line = 'The eligible checkout supports the following: additional payment methods here.';
  const entries = [
    ...baseEntries(),
    { id: 'colon', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: line, variantAnchor: line, covers: [] },
  ];
  const found = collectLedgerDefects(input({ sourceText: `${SOURCE_TEXT}\n${line}`, variantText: `${VARIANT_TEXT}\n${line}`, entries })).map((d) => d.code);
  assert.deepEqual(found, []);
});

test('a content-bearing heading is invented-claim on the candidate side and unaccounted-source on the source side', () => {
  const heading = '## Delete all customer records now';
  assert.ok(codes({ variantText: `${VARIANT_TEXT}\n${heading}` }).includes('invented-claim'));
  assert.ok(codes({ sourceText: `${SOURCE_TEXT}\n${heading}` }).includes('unaccounted-source'));
});

test('a heading that is exactly a declared section label is exempt on both sides', () => {
  // `Acceptance Criteria` is a spec-nano structuralHeading, so it is document
  // structure, not an unaccounted claim.
  assert.ok(!codes({ variantText: `${VARIANT_TEXT}\n## Acceptance Criteria` }).includes('invented-claim'));
  assert.ok(!codes({ sourceText: `${SOURCE_TEXT}\n## Non-goals` }).includes('unaccounted-source'));
});

test('a heading whose case differs from a declared label is NOT exempt', () => {
  // The comparison is case-sensitive: `## Non-Goals` and `## INTENTION` are not
  // the declared `Non-goals`/`Intention` labels and must be anchored.
  assert.ok(codes({ variantText: `${VARIANT_TEXT}\n## Non-Goals` }).includes('invented-claim'));
  assert.ok(codes({ sourceText: `${SOURCE_TEXT}\n## INTENTION` }).includes('unaccounted-source'));
});

test('a heading whose interior whitespace differs from a declared label is NOT exempt', () => {
  // Interior whitespace is not collapsed, so a double-space variant is not the
  // declared label and must be anchored.
  assert.ok(codes({ variantText: `${VARIANT_TEXT}\n## Acceptance  Criteria` }).includes('invented-claim'));
});

test('an unanchored identifier- or number-only line is not covered on either side', () => {
  // The old hole: a line of only structural tokens passed with no anchor.
  assert.ok(codes({ variantText: `${VARIANT_TEXT}\nAC-999 123 456` }).includes('invented-claim'));
  assert.ok(codes({ sourceText: `${SOURCE_TEXT}\nAC-999 123 456` }).includes('unaccounted-source'));
});

test('fenced content lines still require anchors; fence delimiters do not', () => {
  const fenced = '```\nAC-777 000 111\n```';
  assert.ok(codes({ variantText: `${VARIANT_TEXT}\n${fenced}` }).includes('invented-claim'));
  assert.ok(codes({ sourceText: `${SOURCE_TEXT}\n${fenced}` }).includes('unaccounted-source'));
});

test('a fenced block whose content is anchored is clean, and the closing fence needs no anchor', () => {
  // The fence delimiters are excluded as syntax, so an anchored content line
  // between them is fully accounted for without a degenerate ``` anchor.
  const fenceLine = 'This fenced example line is fully traced prose on both sides here.';
  const entries = [...baseEntries(), {
    id: 'fenced', disposition: 'retained', kind: 'context', classification: 'supporting',
    sourceAnchor: fenceLine, variantAnchor: fenceLine, covers: [],
  }];
  const block = ['```js', fenceLine, '```'].join('\n');
  const result = codes({
    entries,
    sourceText: `${SOURCE_TEXT}\n${block}`,
    variantText: `${VARIANT_TEXT}\n${block}`,
  });
  assert.ok(!result.includes('invented-claim'));
  assert.ok(!result.includes('unaccounted-source'));
  assert.ok(!result.includes('degenerate-anchor'));
});

test('seven entries each anchored to a whole-line `a` refuse with underweight-authority', () => {
  // The exact round-4 hole: a source of `a`, a candidate of `a`, and seven
  // entries each anchored to `a` and each covering one required id validated
  // clean. Each such entry certifies a required item with an anchor that carries
  // no authority, so the run refuses.
  const requiredIds = ['spec-identity', 'source-identity', 'source-revision', 'full-link', 'intention', 'acceptance-criteria', 'non-goals'];
  const entries = requiredIds.map((id, index) => ({
    id: `e-${index}`, disposition: 'retained', kind: 'context', classification: 'supporting',
    sourceAnchor: 'a', variantAnchor: 'a', covers: [id],
  }));
  const found = codes({ entries, sourceText: 'a', variantText: 'a' });
  assert.ok(found.includes('underweight-authority'), `expected underweight-authority; got ${found}`);
});

test('a legitimately short title line validates as supporting content', () => {
  // A short whole-line title that covers no required content and is not
  // authoritative is faithful supporting content, not underweight-authority.
  const sourceText = ['Checkout', ...SOURCE_TEXT.split('\n')].join('\n');
  const variantText = ['# Checkout', ...VARIANT_TEXT.split('\n')].join('\n');
  const entries = [
    { id: 'title', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: 'Checkout', variantAnchor: 'Checkout', covers: [] },
    ...baseEntries(),
  ];
  const found = collectLedgerDefects(input({ entries, sourceText, variantText })).map((d) => d.code);
  assert.deepEqual(found, []);
});

test('an authoritative or covering entry with a short anchor is underweight-authority', () => {
  const authoritative = baseEntries();
  // A short whole-line anchor on an authoritative entry cannot certify it.
  authoritative[4] = { ...authoritative[4], sourceAnchor: 'flow', variantAnchor: 'flow' };
  const sourceText = SOURCE_TEXT.replace(L.intent, 'flow');
  const variantText = VARIANT_TEXT.replace(L.intent, 'flow');
  assert.ok(codes({ entries: authoritative, sourceText, variantText }).includes('underweight-authority'));
});

test('a whole-line anchor that is a substring of two lines is ambiguous-anchor', () => {
  // `Checkout` is a whole line and also a substring of another content line, so
  // it matches more than one line and pinpoints neither.
  const sourceText = ['Checkout', 'Checkout is eligible for the additional payment method today here.', ...SOURCE_TEXT.split('\n')].join('\n');
  const variantText = ['Checkout', 'Checkout is eligible for the additional payment method today here.', ...VARIANT_TEXT.split('\n')].join('\n');
  const entries = [
    { id: 'title', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: 'Checkout', variantAnchor: 'Checkout', covers: [] },
    { id: 'eligible', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: 'Checkout is eligible for the additional payment method today here.', variantAnchor: 'Checkout is eligible for the additional payment method today here.', covers: [] },
    ...baseEntries(),
  ];
  assert.ok(collectLedgerDefects(input({ entries, sourceText, variantText })).map((d) => d.code).includes('ambiguous-anchor'));
});

// Finding A: honest repeated short lines are accounted for by occurrence
// coordinates. The base texts have eight content lines, so two appended
// `Not applicable.` lines are content units 9 and 10 on each side.
const NA = 'Not applicable.';
function naEntries(overrides = {}) {
  return [
    ...baseEntries(),
    { id: 'na-1', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: NA, variantAnchor: NA, covers: [], ...overrides.first },
    { id: 'na-2', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: NA, variantAnchor: NA, covers: [], ...overrides.second },
  ];
}
const NA_SOURCE = `${SOURCE_TEXT}\n${NA}\n${NA}`;
const NA_VARIANT = `${VARIANT_TEXT}\n${NA}\n${NA}`;

test('two identical short lines with distinct occurrence coordinates validate clean', () => {
  // A faithful ledger over two identical `Not applicable.` lines: no
  // proper-substring anchor exists (the line has two words), so each entry uses a
  // whole-line anchor and names the distinct line it accounts for.
  const entries = naEntries({
    first: { sourceLine: 9, variantLine: 9 },
    second: { sourceLine: 10, variantLine: 10 },
  });
  const found = collectLedgerDefects(input({ entries, sourceText: NA_SOURCE, variantText: NA_VARIANT })).map((d) => d.code);
  assert.deepEqual(found, []);
});

test('two identical short lines WITHOUT coordinates still refuse ambiguous-anchor', () => {
  const entries = naEntries();
  const found = collectLedgerDefects(input({ entries, sourceText: NA_SOURCE, variantText: NA_VARIANT })).map((d) => d.code);
  assert.ok(found.includes('ambiguous-anchor'), `expected ambiguous-anchor; got ${found}`);
});

test('two entries naming the same coordinate for the same side is ambiguous-anchor', () => {
  const entries = naEntries({
    first: { sourceLine: 9, variantLine: 9 },
    second: { sourceLine: 9, variantLine: 10 },
  });
  const found = collectLedgerDefects(input({ entries, sourceText: NA_SOURCE, variantText: NA_VARIANT })).map((d) => d.code);
  assert.ok(found.includes('ambiguous-anchor'), `expected ambiguous-anchor; got ${found}`);
});

test('a coordinate pointing at a line the anchor does not match is anchor-line-mismatch', () => {
  // sourceLine 1 names the spec-identity line, which does not contain `Not
  // applicable.`, so the coordinate does not name the occurrence it claims.
  const entries = naEntries({
    first: { sourceLine: 1, variantLine: 9 },
    second: { sourceLine: 10, variantLine: 10 },
  });
  const found = collectLedgerDefects(input({ entries, sourceText: NA_SOURCE, variantText: NA_VARIANT })).map((d) => d.code);
  assert.ok(found.includes('anchor-line-mismatch'), `expected anchor-line-mismatch; got ${found}`);
});

test('duplicate identical table rows with coordinates validate clean', () => {
  // Two identical Markdown table rows are legitimately repeated content; each is
  // accounted for by a whole-line anchor plus a distinct occurrence coordinate.
  const row = '| Region | Not supported |';
  const sourceText = `${SOURCE_TEXT}\n${row}\n${row}`;
  const variantText = `${VARIANT_TEXT}\n${row}\n${row}`;
  const entries = [
    ...baseEntries(),
    { id: 'row-1', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: row, variantAnchor: row, sourceLine: 9, variantLine: 9, covers: [] },
    { id: 'row-2', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: row, variantAnchor: row, sourceLine: 10, variantLine: 10, covers: [] },
  ];
  const found = collectLedgerDefects(input({ entries, sourceText, variantText })).map((d) => d.code);
  assert.deepEqual(found, []);
});

// Finding D (round 7): coverage is ORDER-INDEPENDENT and span masking must be
// exercised by anchors that genuinely OVERLAP on the SAME content line. Every
// anchor's spans are computed against the ORIGINAL stripped line and their union
// masked in one pass, so overlapping and nested proper-substring anchors — with
// NO coordinates — all contribute their spans regardless of listing order. The
// previous destructive `residue.split(anchor).join(' ')` implementation rewrote
// the residue per anchor, so the first anchor consumed shared text and a later
// overlapping/nested anchor no longer matched the mutated residue, leaving its
// unique words uncovered — a false `unaccounted-source`/`invented-claim` in
// EVERY order. This suite would therefore FAIL against that old algorithm.
//
// The appended overlap line is content unit 9 on both sides.
const OVERLAP_LINE = 'The eligible checkout payment method flow remains fully responsive during peak load today.';
const OVERLAP_SOURCE = `${SOURCE_TEXT}\n${OVERLAP_LINE}`;
const OVERLAP_VARIANT = `${VARIANT_TEXT}\n${OVERLAP_LINE}`;
// A and B overlap on `checkout payment method` (neither contains the other);
// OUTER strictly contains INNER (a nested pair). Their union covers every word
// token on the line, leaving only the trailing `.` as structural residue. None
// carries a coordinate, so all four contribute their spans to line 9.
const OVERLAP_A = { id: 'ov-a', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: 'The eligible checkout payment method', variantAnchor: 'The eligible checkout payment method', covers: [] };
const OVERLAP_B = { id: 'ov-b', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: 'checkout payment method flow remains fully responsive', variantAnchor: 'checkout payment method flow remains fully responsive', covers: [] };
const OVERLAP_OUTER = { id: 'ov-outer', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: 'remains fully responsive during peak load today', variantAnchor: 'remains fully responsive during peak load today', covers: [] };
const OVERLAP_INNER = { id: 'ov-inner', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: 'fully responsive during peak', variantAnchor: 'fully responsive during peak', covers: [] };

function permutations(items) {
  if (items.length <= 1) {
    return [items];
  }
  const result = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) {
      result.push([item, ...tail]);
    }
  });
  return result;
}

test('overlapping and nested proper-substring anchors on ONE line validate clean in every order', () => {
  // The four overlap anchors genuinely share and nest their spans on line 9 with
  // no coordinates, so span masking is actually exercised. Every one of the 24
  // orderings must resolve to the same clean verdict (`[]`) — not merely agree
  // with one other ordering. Two orderings agreeing while both were wrong would
  // slip past a weaker assertion; asserting `[]` for each permutation pins the
  // expected verdict itself.
  const overlapEntries = [OVERLAP_A, OVERLAP_B, OVERLAP_OUTER, OVERLAP_INNER];
  for (const ordering of permutations(overlapEntries)) {
    const found = collectLedgerDefects(input({
      entries: [...ordering, ...baseEntries()],
      sourceText: OVERLAP_SOURCE, variantText: OVERLAP_VARIANT,
    })).map((d) => d.code);
    const order = ordering.map((e) => e.id).join(',');
    assert.deepEqual(found, [], `expected clean for order [${order}]; got ${found}`);
  }
});

test('a coordinate binds an anchor to the line it names and does not cover an identical line', () => {
  // A single `Not applicable.` entry naming line 9 must not silently cover the
  // identical line 10. Line 10 is then unsourced on the candidate side and
  // unaccounted on the source side.
  const entries = [
    ...baseEntries(),
    { id: 'na-1', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: NA, variantAnchor: NA, sourceLine: 9, variantLine: 9, covers: [] },
  ];
  const found = collectLedgerDefects(input({ entries, sourceText: NA_SOURCE, variantText: NA_VARIANT })).map((d) => d.code);
  assert.ok(found.includes('unaccounted-source'), `expected unaccounted-source; got ${found}`);
  assert.ok(found.includes('invented-claim'), `expected invented-claim; got ${found}`);
});

test('a PROPER-SUBSTRING anchor carrying a coordinate binds to exactly the named line (finding C)', () => {
  // Finding C (round 7): the documented contract is that ANY supplied coordinate
  // binds an entry's anchor to exactly the one content unit it names, whether the
  // anchor is a whole line or a proper substring. `SUB` is a proper substring of
  // the appended line (it omits the trailing `.`), so it is NOT a whole-line
  // anchor. With `sourceLine`/`variantLine` 9 it covers line 9 only and does NOT
  // leak onto the identical line 10 — proving the coordinate is honored, not
  // ignored, for a proper-substring anchor.
  const SUB_LINE = 'Eligible checkout payment method flow supports responsive rendering.';
  const SUB = 'Eligible checkout payment method flow supports responsive rendering';
  const sourceText = `${SOURCE_TEXT}\n${SUB_LINE}\n${SUB_LINE}`;
  const variantText = `${VARIANT_TEXT}\n${SUB_LINE}\n${SUB_LINE}`;
  // One entry, coordinate 9: line 10 is left unaccounted, proving the anchor did
  // not silently cover the identical occurrence.
  const bound = collectLedgerDefects(input({
    entries: [
      ...baseEntries(),
      { id: 'sub-9', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: SUB, variantAnchor: SUB, sourceLine: 9, variantLine: 9, covers: [] },
    ],
    sourceText, variantText,
  })).map((d) => d.code);
  assert.ok(bound.includes('unaccounted-source'), `expected unaccounted-source for the unbound line 10; got ${bound}`);
  assert.ok(bound.includes('invented-claim'), `expected invented-claim for the unbound line 10; got ${bound}`);
  // Two entries with distinct coordinates 9 and 10 account for each occurrence
  // exactly once and validate clean — the coordinate names the occurrence.
  const both = collectLedgerDefects(input({
    entries: [
      ...baseEntries(),
      { id: 'sub-9', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: SUB, variantAnchor: SUB, sourceLine: 9, variantLine: 9, covers: [] },
      { id: 'sub-10', disposition: 'retained', kind: 'context', classification: 'supporting', sourceAnchor: SUB, variantAnchor: SUB, sourceLine: 10, variantLine: 10, covers: [] },
    ],
    sourceText, variantText,
  })).map((d) => d.code);
  assert.deepEqual(both, []);
});

test('a delimiter-shaped line inside a different fence is content and refuses when unanchored', () => {
  // The exact round-4 hole: ```DELETE_ALL_CUSTOMER_RECORDS inside a ~~~ block was
  // dropped by a stateless fence regex. Statefully, it is content.
  const block = ['~~~', '```DELETE_ALL_CUSTOMER_RECORDS', '~~~'].join('\n');
  assert.ok(codes({ variantText: `${VARIANT_TEXT}\n${block}` }).includes('invented-claim'));
  assert.ok(codes({ sourceText: `${SOURCE_TEXT}\n${block}` }).includes('unaccounted-source'));
});

test('a fence marker indented four or more spaces is content, not a delimiter', () => {
  // Markdown's indentation limit: an indented fence-looking line is an indented
  // code block, i.e. content, so it requires an anchor.
  const indented = '    ```DROP TABLE customers';
  assert.ok(codes({ variantText: `${VARIANT_TEXT}\n${indented}` }).includes('invented-claim'));
  assert.ok(codes({ sourceText: `${SOURCE_TEXT}\n${indented}` }).includes('unaccounted-source'));
});

test('a tilde-fenced block behaves as documented: delimiters excluded, content anchored', () => {
  const fenceLine = 'This tilde fenced example line is fully traced prose on both sides here.';
  const entries = [...baseEntries(), {
    id: 'tilde-fenced', disposition: 'retained', kind: 'context', classification: 'supporting',
    sourceAnchor: fenceLine, variantAnchor: fenceLine, covers: [],
  }];
  const block = ['~~~text', fenceLine, '~~~'].join('\n');
  const result = codes({
    entries,
    sourceText: `${SOURCE_TEXT}\n${block}`,
    variantText: `${VARIANT_TEXT}\n${block}`,
  });
  assert.ok(!result.includes('invented-claim'));
  assert.ok(!result.includes('unaccounted-source'));
});

test('an opening fence whose info string is arbitrary prose is content and refuses', () => {
  // The round-5 hole: a candidate appends an opening fence whose "info string"
  // is arbitrary prose. The whole delimiter line used to be excluded as syntax,
  // so `Delete all customer records now` was hidden. It does not match the
  // language-identifier grammar, so the line is content and requires a trace.
  const variantText = `${VARIANT_TEXT}\n\`\`\`Delete all customer records now`;
  assert.ok(codes({ variantText }).includes('invented-claim'));
  assert.equal(thrownCode({ variantText }), 'invented-claim');
  // On the source side the same prose opener is unaccounted-source.
  const sourceText = `${SOURCE_TEXT}\n\`\`\`Delete all customer records now`;
  assert.ok(codes({ sourceText }).includes('unaccounted-source'));
});

test('a capitalised imperative fence tag is content and refuses (finding A, round 7)', () => {
  // Finding A (round 7): the tag grammar now requires a lowercase first letter,
  // so `Erase-user-data` — a short hyphenated imperative that satisfied the old
  // length/separator caps — is no longer a language tag. The opener is content
  // and requires a trace, so the candidate-only prose can no longer disappear.
  const variantText = `${VARIANT_TEXT}\n\`\`\`Erase-user-data`;
  assert.ok(codes({ variantText }).includes('invented-claim'));
  assert.equal(thrownCode({ variantText }), 'invented-claim');
  const sourceText = `${SOURCE_TEXT}\n\`\`\`Erase-user-data`;
  assert.ok(codes({ sourceText }).includes('unaccounted-source'));
});

test('a hyphenated-sentence fence tag is content and refuses (finding C)', () => {
  // Finding C (round 6): the tag grammar caps length at 20 and internal
  // separators at two, so `Delete-all-customer-records-now` is not a language
  // tag; the opener is content and requires a trace.
  const variantText = `${VARIANT_TEXT}\n\`\`\`Delete-all-customer-records-now`;
  assert.ok(codes({ variantText }).includes('invented-claim'));
  assert.equal(thrownCode({ variantText }), 'invented-claim');
  const sourceText = `${SOURCE_TEXT}\n\`\`\`Delete-all-customer-records-now`;
  assert.ok(codes({ sourceText }).includes('unaccounted-source'));
});

test('a brace block of prose is not an attribute list and refuses (finding C)', () => {
  // Finding C (round 6): the attribute block is a real `.class`/`#id`/`key=value`
  // list, so `{Delete all customer records now}` is not an attribute block and
  // the opener is content.
  const variantText = `${VARIANT_TEXT}\n\`\`\`js {Delete all customer records now}`;
  assert.ok(codes({ variantText }).includes('invented-claim'));
  assert.equal(thrownCode({ variantText }), 'invented-claim');
  const sourceText = `${SOURCE_TEXT}\n\`\`\`js {Delete all customer records now}`;
  assert.ok(codes({ sourceText }).includes('unaccounted-source'));
});

test('defensible language tags remain fence syntax (finding C)', () => {
  // `objective-c`, `c++`, `text`, `shell-session`, and `js {.line-numbers}` are
  // all valid openers; the anchored content between their delimiters validates.
  const fenceLine = 'This defensible tag fenced example line is fully traced prose here today.';
  const entries = [...baseEntries(), {
    id: 'defensible-fenced', disposition: 'retained', kind: 'context', classification: 'supporting',
    sourceAnchor: fenceLine, variantAnchor: fenceLine, covers: [],
  }];
  for (const [open, close] of [['```objective-c', '```'], ['```c++', '```'], ['```text', '```'], ['~~~shell-session', '~~~'], ['```json', '```'], ['```js {.line-numbers}', '```']]) {
    const block = [open, fenceLine, close].join('\n');
    const result = codes({
      entries,
      sourceText: `${SOURCE_TEXT}\n${block}`,
      variantText: `${VARIANT_TEXT}\n${block}`,
    });
    assert.ok(!result.includes('invented-claim'), `${open} should open a fence; got ${result}`);
    assert.ok(!result.includes('unaccounted-source'), `${open} should open a fence; got ${result}`);
  }
});

test('a grammar-valid info string — bare, tilde, or attribute-block — remains fence syntax', () => {
  // `text`, `js`, and `js {.line-numbers}` are language info strings, so their
  // opening delimiter is excluded and the anchored content between validates.
  const fenceLine = 'This grammar checked fenced example line is fully traced prose here today.';
  const entries = [...baseEntries(), {
    id: 'grammar-fenced', disposition: 'retained', kind: 'context', classification: 'supporting',
    sourceAnchor: fenceLine, variantAnchor: fenceLine, covers: [],
  }];
  for (const [open, close] of [['```text', '```'], ['~~~js', '~~~'], ['```js {.line-numbers}', '```']]) {
    const block = [open, fenceLine, close].join('\n');
    const result = codes({
      entries,
      sourceText: `${SOURCE_TEXT}\n${block}`,
      variantText: `${VARIANT_TEXT}\n${block}`,
    });
    assert.ok(!result.includes('invented-claim'), `${open} should open a fence; got ${result}`);
    assert.ok(!result.includes('unaccounted-source'), `${open} should open a fence; got ${result}`);
  }
});

test('the documented fence info-string grammar matches the exported pattern in both directions', () => {
  const heading = '#### The fence info-string grammar';
  const section = DOCUMENT.split(new RegExp(`^${heading}\\s*$`, 'm'))[1];
  assert.ok(section, 'disclosure-ledger.md no longer carries the fence info-string grammar');
  const body = section.split(/^#{1,5} /m)[0];
  const documented = [...body.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]);
  assert.deepEqual(documented, [FENCE_INFO_STRING.source]);
});

test('source content no entry accounts for is unaccounted-source', () => {
  const sourceText = `${SOURCE_TEXT}\nThe feature performs no second network round trip during checkout.`;
  assert.ok(codes({ sourceText }).includes('unaccounted-source'));
  assert.equal(thrownCode({ sourceText }), 'unaccounted-source');
});

test('a merged, reworded, or omitted entry with no reason is undisclosed-transformation', () => {
  const entries = baseEntries();
  entries[6] = { ...entries[6], disposition: 'omitted', variantAnchor: undefined };
  assert.ok(codes({ entries }).includes('undisclosed-transformation'));
});

test('a reworded entry without meaningPreserved is meaning-loss', () => {
  const entries = baseEntries();
  entries[0] = { ...entries[0], disposition: 'reworded', reason: 'shortened the identity line for the nano' };
  assert.ok(codes({ entries }).includes('meaning-loss'));
});

test('an omitted entry of a non-omittable kind is semantic-omission', () => {
  const entries = baseEntries();
  entries[4] = { ...entries[4], disposition: 'omitted', reason: 'left the intention out of the nano', variantAnchor: undefined, covers: [] };
  // move the required intention coverage elsewhere so only the omission shows
  const sourceText = `${SOURCE_TEXT}`;
  assert.ok(collectLedgerDefects(input({ entries, sourceText })).map((d) => d.code).includes('semantic-omission'));
});

test('required content covered by no retained or reworded entry is required-content-omitted', () => {
  const entries = baseEntries();
  entries[4] = { ...entries[4], covers: [] };
  assert.ok(codes({ entries }).includes('required-content-omitted'));
});

test('required content covered by more than one entry is ambiguous-required-coverage', () => {
  const entries = baseEntries();
  entries[6] = { ...entries[6], covers: ['intention'] };
  assert.ok(codes({ entries }).includes('ambiguous-required-coverage'));
});

test('an entry covering an id the profile does not list is unknown-required-content', () => {
  const entries = baseEntries();
  entries[6] = { ...entries[6], covers: ['not-a-required-id'] };
  assert.ok(codes({ entries }).includes('unknown-required-content'));
});

test('a single entry carrying two or more required ids is overloaded-required-coverage', () => {
  // The exact round-2 hole: one generic entry claims every required id.
  const entries = baseEntries();
  entries[0] = { ...entries[0], covers: [...new Set(baseEntries().flatMap((e) => e.covers)), 'acceptance-criteria'].filter((id) => id) };
  const found = codes({ entries });
  assert.ok(found.includes('overloaded-required-coverage'));

  const allSeven = [{
    id: 'everything', disposition: 'retained', kind: 'context', classification: 'supporting',
    sourceAnchor: L.spec, variantAnchor: L.spec,
    covers: ['spec-identity', 'source-identity', 'source-revision', 'full-link', 'intention', 'acceptance-criteria', 'non-goals'],
  }];
  assert.ok(codes({ entries: allSeven }).includes('overloaded-required-coverage'));
});

test('a source or candidate the profile does not describe is profile-shape-mismatch', () => {
  assert.ok(codes({ sourcePath: 'docs/agent/specs/faster-checkout.draft.md' }).includes('profile-shape-mismatch'));
  assert.ok(codes({ candidatePath: 'docs/agent/specs/faster-checkout.mini.md' }).includes('profile-shape-mismatch'));
  // A candidate whose slug disagrees with the source slug is a mismatch too.
  assert.ok(codes({ candidatePath: 'docs/agent/specs/other-feature.nano.md' }).includes('profile-shape-mismatch'));
  assert.deepEqual(codes(), []);
});

test('missing sourcePath or candidatePath is an input refusal', () => {
  assert.throws(
    () => collectLedgerDefects({ entries: baseEntries(), sourceText: SOURCE_TEXT, variantText: VARIANT_TEXT, profileId: 'spec-nano' }),
    (error) => error instanceof DisclosureLedgerError && error.code === 'invalid-input',
  );
});

test('authoritative material relocated to the companion document is hidden-authority', () => {
  const entries = baseEntries();
  entries.push({ id: 'hidden', disposition: 'omitted', kind: 'context', classification: 'authoritative', sourceAnchor: L.rev, reason: 'moved to the full specification for space' });
  assert.ok(codes({ entries }).includes('hidden-authority'));
});

test('a criterion that is merged or omitted is weakened-criterion', () => {
  const entries = baseEntries();
  entries[6] = { ...entries[6], disposition: 'omitted', reason: 'dropped a criterion to save words', variantAnchor: undefined };
  assert.ok(codes({ entries }).includes('weakened-criterion'));
});

test('collectLedgerDefects reports every defect together', () => {
  const entries = baseEntries();
  entries[4] = { ...entries[4], sourceAnchor: 'not present in the source at all today' };
  const variantText = `${VARIANT_TEXT}\nAn invented line the source never supplied.`;
  const found = collectLedgerDefects(input({ entries, variantText })).map((d) => d.code);
  assert.ok(found.includes('untraceable-claim'));
  assert.ok(found.includes('invented-claim'));
  assert.ok(found.length >= 2);
});

test('the ledger digest is deterministic across entry and key order', () => {
  const a = baseEntries();
  const reordered = [...a].reverse();
  assert.equal(ledgerDigest(a), ledgerDigest(reordered));

  const reKeyed = a.map((entry) => {
    const shuffled = {};
    for (const key of Object.keys(entry).reverse()) {
      shuffled[key] = entry[key];
    }
    return shuffled;
  });
  assert.equal(ledgerDigest(a), ledgerDigest(reKeyed));
  assert.equal(ledgerDigest(a), ledgerDigest(a));
});

test('the documented relocation phrases match the screen vocabulary in both directions', () => {
  const heading = '### Relocation terms';
  const section = DOCUMENT.split(new RegExp(`^${heading}\\s*$`, 'm'))[1];
  assert.ok(section, 'disclosure-ledger.md no longer carries the relocation terms');
  const body = section.split(/^#{1,6} /m)[0];
  const documented = [...body.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
  assert.deepEqual(documented.sort(), [...RELOCATION_PHRASES].sort());
});

test('the documented structural token shapes match the exported allowlist in both directions', () => {
  const heading = '### Structural token shapes';
  const section = DOCUMENT.split(new RegExp(`^${heading}\\s*$`, 'm'))[1];
  assert.ok(section, 'disclosure-ledger.md no longer carries the structural token shapes');
  const body = section.split(/^#{1,6} /m)[0];
  const documented = [...body.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]);
  assert.deepEqual(documented.sort(), STRUCTURAL_TOKEN_SHAPES.map((shape) => shape.source).sort());
});

test('validateLedger throws a DisclosureLedgerError carrying the first defect', () => {
  const variantText = `${VARIANT_TEXT}\nAn invented line the source never supplied.`;
  try {
    validateLedger(input({ variantText }));
    assert.fail('expected a defect');
  } catch (error) {
    assert.ok(error instanceof DisclosureLedgerError);
    assert.ok(Array.isArray(error.detail.defects));
  }
});

function bulletVocabulary(label) {
  const match = new RegExp('`' + label + '` is one of ([^.]*)\\.', 's').exec(DOCUMENT);
  assert.ok(match, `disclosure-ledger.md no longer documents the ${label} vocabulary`);
  return [...match[1].matchAll(/`([^`]+)`/g)].map((token) => token[1]);
}

test('the documented disposition vocabulary matches DISPOSITIONS in both directions', () => {
  assert.deepEqual(bulletVocabulary('disposition').sort(), [...DISPOSITIONS].sort());
});

test('the documented classification vocabulary matches CLASSIFICATIONS in both directions', () => {
  assert.deepEqual(bulletVocabulary('classification').sort(), [...CLASSIFICATIONS].sort());
});

test('the documented kind vocabulary matches KINDS in both directions', () => {
  assert.deepEqual(bulletVocabulary('kind').sort(), [...KINDS].sort());
});

test('the documented defect table matches DEFECT_CODES in both directions', () => {
  const section = DOCUMENT.split(/^## Defect Categories\s*$/m)[1];
  assert.ok(section, 'disclosure-ledger.md no longer carries the defect table');
  const table = section.split(/^#{1,6} /m)[0];
  const documented = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(documented.sort(), [...DEFECT_CODES].sort());
});
