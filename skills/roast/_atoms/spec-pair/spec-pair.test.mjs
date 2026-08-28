/**
 * Seam tests for the spec-pair atom.
 *
 * The contract a consumer depends on: the nano layer is always authority, an
 * incomplete pair still produces a record, a clean pair records nothing, and
 * every state issue #118 names - a missing sibling, a broken link, a
 * conflicting authority, and an unmatched full-spec requirement - is recorded
 * under a stable rule token rather than described in prose.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  INTENTION_TARGETS,
  OBSERVATION_RULES,
  PERMITTED_NANO_SECTIONS,
  PRECEDENCE_TERMS,
  REQUIREMENT_TERMS,
  SpecPairError,
  run as runSpecPair,
  stageSpecPair,
} from './spec-pair.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');
const DOCUMENT = fs.readFileSync(path.join(UNIT_ROOT, 'spec-pair.md'), 'utf8');

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'spec-pair-'));
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

const CLEAN_NANO = [
  '# Checkout hold',
  '',
  '## Source',
  '',
  '- Specification identifier: SPEC-CHECKOUT-HOLD',
  '- Discovery packet: discovery/checkout-hold.packet.md',
  '',
  '## Intention',
  '',
  'A shopper keeps a reserved basket while payment is confirmed.',
  '',
  '## Acceptance criteria',
  '',
  '- AC-1: A reserved basket stays reserved for fifteen minutes.',
  '- AC-2: An expired reservation releases every held item.',
  '',
  '## Non-goals',
  '',
  '- Partial reservations are out of scope.',
  '',
  '## Full specification',
  '',
  '[Full specification](./checkout-hold.full.md)',
  '',
].join('\n');

const CLEAN_FULL = [
  '# Checkout hold, in full',
  '',
  '## Reservation window',
  '',
  'Traces to: AC-1',
  '',
  'Fifteen minutes was chosen to sit inside the payment settlement window.',
  '',
  '## Release behaviour',
  '',
  'Elaborates: AC-2',
  '',
  'Every held item returns to available stock when the window closes.',
  '',
  '## Background',
  '',
  'Shoppers abandoned baskets during the previous checkout flow.',
  '',
].join('\n');

function writePair(root, { nano = CLEAN_NANO, full = CLEAN_FULL, stem = 'checkout-hold' } = {}) {
  const nanoPath = path.join(root, `${stem}.nano.md`);
  const fullPath = path.join(root, `${stem}.full.md`);
  if (nano !== null) {
    fs.writeFileSync(nanoPath, nano);
  }
  if (full !== null) {
    fs.writeFileSync(fullPath, full);
  }
  return { nanoPath, fullPath };
}

function rules(record) {
  return record.observations.map((entry) => entry.rule);
}

test('a clean pair is paired, linked, and records nothing', (t) => {
  const root = workspace(t);
  const { nanoPath } = writePair(root);

  const record = stageSpecPair({ specPath: nanoPath, repositoryRoot: root });

  assert.equal(record.status, 'Paired');
  assert.deepEqual(record.observations, []);
  assert.equal(record.link.status, 'Resolved');
  assert.equal(record.specId, 'SPEC-CHECKOUT-HOLD');
  assert.deepEqual(record.criteria.map((entry) => entry.id), ['AC-1', 'AC-2']);
  assert.deepEqual(record.traceability.referencedIds, ['AC-1', 'AC-2']);
  assert.match(record.observation, /every mechanical pair check passed/);
});

test('the canonical /spec nano shape stages its Spec ID identity', (t) => {
  const root = workspace(t);
  const nano = [
    '# Faster checkout',
    '',
    'Spec ID: SPEC-FASTER-CHECKOUT',
    'Source: docs/agent/discovery/faster-checkout.md',
    'Source revision: abc123',
    'Full specification: [Supporting context](./faster-checkout.full.md)',
    '',
    '## Intention',
    '',
    'A shopper completes checkout without waiting on duplicate validation.',
    '',
    '## Acceptance Criteria',
    '',
    '- AC-001: Duplicate validation is skipped when a fresh validation receipt exists.',
    '',
    '## Non-goals',
    '',
    '- Payment provider behavior is unchanged.',
    '',
  ].join('\n');
  const full = [
    '# Faster checkout - Full specification',
    '',
    'Spec ID: SPEC-FASTER-CHECKOUT',
    'Source: docs/agent/discovery/faster-checkout.md',
    'Source revision: abc123',
    'Nano authority: [Nano](./faster-checkout.nano.md)',
    '',
    '## Authority',
    '',
    'The nano specification is authoritative.',
    '',
    '## Product Context',
    '',
    'Prior checkout work identified duplicate validation as the user-visible delay.',
    '',
    '## Product Requirements',
    '',
    '- REQ-001 [AC-001]: Skip duplicate validation when a fresh validation receipt exists.',
    '',
    '## Product Decisions',
    '',
    'None.',
    '',
    '## Traceability',
    '',
    '- AC-001: REQ-001',
    '',
    '## Open Questions',
    '',
    'None.',
    '',
  ].join('\n');
  const { nanoPath } = writePair(root, { stem: 'faster-checkout', nano, full });

  const record = stageSpecPair({ specPath: nanoPath, repositoryRoot: root });

  assert.equal(record.specId, 'SPEC-FASTER-CHECKOUT');
  assert.deepEqual(record.criteria.map((entry) => entry.id), ['AC-001']);
  assert.deepEqual(rules(record).filter((rule) => rule === 'missing-spec-identifier'), []);
});

test('the full sibling is resolved from either half of the pair', (t) => {
  const root = workspace(t);
  const { nanoPath, fullPath } = writePair(root);

  const fromNano = stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
  const fromFull = stageSpecPair({ specPath: fullPath, repositoryRoot: root });

  assert.deepEqual(fromFull.files, fromNano.files);
  assert.equal(fromFull.status, 'Paired');
});

test('both siblings carry a pinned identity', (t) => {
  const root = workspace(t);
  const { nanoPath } = writePair(root);

  const record = stageSpecPair({ specPath: nanoPath, repositoryRoot: root });

  for (const member of [record.files.nano, record.files.full]) {
    assert.equal(member.status, 'Present');
    assert.match(member.digest, /^[0-9a-f]{64}$/);
    assert.ok(member.bytes > 0);
    assert.ok(member.lines > 0);
  }
  assert.equal(record.files.nano.locator, 'checkout-hold.nano.md');
  assert.equal(record.files.full.locator, 'checkout-hold.full.md');
});

test('the nano layer is the authority and nothing in either file moves it', (t) => {
  const root = workspace(t);
  const { nanoPath } = writePair(root, {
    full: `${CLEAN_FULL}\n## Authority\n\nThis full specification overrides the nano specification.\n`,
  });

  const record = stageSpecPair({ specPath: nanoPath, repositoryRoot: root });

  assert.equal(record.authority.layer, 'nano');
  assert.equal(record.authority.locator, 'checkout-hold.nano.md');
  assert.ok(rules(record).includes('authority-conflict'));
});

test('a missing sibling is recorded, not raised as an error', (t) => {
  const root = workspace(t);
  const { nanoPath } = writePair(root, { full: null });

  const record = stageSpecPair({ specPath: nanoPath, repositoryRoot: root });

  assert.equal(record.status, 'Incomplete pair');
  assert.equal(record.blocking, false);
  const missing = record.observations.find((entry) => entry.rule === 'missing-sibling');
  assert.equal(missing.layer, 'full');
  assert.equal(record.files.full.status, 'Missing');
  assert.equal(record.link.status, 'Unresolved');
});

test('a missing nano artifact leaves the authority absent and still returns a record', (t) => {
  const root = workspace(t);
  const { nanoPath } = writePair(root, { nano: null });

  const record = stageSpecPair({ specPath: nanoPath, repositoryRoot: root });

  assert.equal(record.status, 'Incomplete pair');
  assert.equal(record.files.nano.status, 'Missing');
  assert.equal(record.specId, null);
  assert.deepEqual(record.criteria, []);
  assert.deepEqual(
    record.observations
      .filter((entry) => entry.rule === 'missing-sibling')
      .map((entry) => entry.layer),
    ['nano'],
  );
});

test('an existing sibling that cannot be read is never reported as absent', (t) => {
  const root = workspace(t);
  const { nanoPath, fullPath } = writePair(root, { full: null });
  fs.symlinkSync(nanoPath, fullPath);

  const record = stageSpecPair({ specPath: nanoPath, repositoryRoot: root });

  assert.equal(record.status, 'Unreadable');
  assert.equal(record.files.full.status, 'Unreadable');
  assert.match(record.files.full.reason, /symbolic link/);
  assert.deepEqual(rules(record).filter((rule) => rule === 'missing-sibling'), []);
  assert.ok(rules(record).includes('unreadable-sibling'));
});

test('an absent link and a link that resolves elsewhere both break the pair', (t) => {
  const unlinkedRoot = workspace(t);
  writePair(unlinkedRoot, {
    nano: CLEAN_NANO.replace(
      '[Full specification](./checkout-hold.full.md)',
      'See the full specification.',
    ),
  });
  const unlinked = stageSpecPair({
    specPath: path.join(unlinkedRoot, 'checkout-hold.nano.md'),
    repositoryRoot: unlinkedRoot,
  });
  assert.equal(unlinked.link.status, 'Missing');
  assert.ok(rules(unlinked).includes('broken-full-link'));

  const brokenRoot = workspace(t);
  writePair(brokenRoot, {
    nano: CLEAN_NANO.replace('./checkout-hold.full.md', './archive/checkout-hold.full.md'),
  });
  const broken = stageSpecPair({
    specPath: path.join(brokenRoot, 'checkout-hold.nano.md'),
    repositoryRoot: brokenRoot,
  });
  assert.equal(broken.link.status, 'Broken');
  assert.equal(broken.link.declared, './archive/checkout-hold.full.md');
  assert.ok(rules(broken).includes('broken-full-link'));
});

test('a full specification that restates a criterion differently conflicts with the authority', (t) => {
  const root = workspace(t);
  writePair(root, {
    full: [
      '# Checkout hold, in full',
      '',
      '## Reservation window',
      '',
      '- AC-1: A reserved basket stays reserved for sixty minutes.',
      '',
    ].join('\n'),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  const conflict = record.observations.find((entry) => entry.rule === 'authority-conflict');
  assert.equal(conflict.criterionId, 'AC-1');
  assert.match(conflict.nanoText, /fifteen minutes/);
  assert.match(conflict.fullText, /sixty minutes/);
});

test('a conflicting restatement is caught without a list marker and across a wrapped item', (t) => {
  // The same contradiction in two shapes a full specification actually uses.
  // Recognising only the list form would let the plainest phrasing through.
  const bareRoot = workspace(t);
  writePair(bareRoot, {
    full: '# In full\n\n## Window\n\nAC-1: A reserved basket stays reserved for sixty minutes.\n',
  });
  const bare = stageSpecPair({
    specPath: path.join(bareRoot, 'checkout-hold.nano.md'),
    repositoryRoot: bareRoot,
  });
  assert.equal(
    bare.observations.find((entry) => entry.rule === 'authority-conflict').criterionId,
    'AC-1',
  );

  const wrappedRoot = workspace(t);
  writePair(wrappedRoot, {
    full: '# In full\n\n## Window\n\n- AC-1:\n  A reserved basket stays reserved for sixty minutes.\n',
  });
  const wrapped = stageSpecPair({
    specPath: path.join(wrappedRoot, 'checkout-hold.nano.md'),
    repositoryRoot: wrappedRoot,
  });
  assert.match(
    wrapped.observations.find((entry) => entry.rule === 'authority-conflict').fullText,
    /sixty minutes/,
  );
});

test('elaborating beneath a criterion is not a contradiction', (t) => {
  // The false positive the shallow comparison exists to avoid. A full
  // specification that adds detail under a criterion is doing its job.
  const root = workspace(t);
  writePair(root, {
    full: [
      '# In full',
      '',
      '## Window',
      '',
      '- AC-1: A reserved basket stays reserved for fifteen minutes.',
      '  The window was chosen to sit inside the settlement window, which is ten.',
      '  A shorter window loses baskets that would otherwise have converted.',
      '',
    ].join('\n'),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.deepEqual(rules(record).filter((rule) => rule === 'authority-conflict'), []);
});

test('a full specification that restates a criterion identically raises nothing', (t) => {
  const root = workspace(t);
  writePair(root, {
    full: [
      '# Checkout hold, in full',
      '',
      '## Reservation window',
      '',
      '- AC-1: A reserved basket stays reserved for fifteen minutes.',
      '',
    ].join('\n'),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.deepEqual(rules(record).filter((rule) => rule === 'authority-conflict'), []);
});

test('a full specification citing an undeclared identifier is recorded', (t) => {
  const root = workspace(t);
  writePair(root, {
    full: [
      '# Checkout hold, in full',
      '',
      '## Refunds',
      '',
      'This section elaborates AC-9.',
      '',
    ].join('\n'),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.deepEqual(record.traceability.unknownReferences.map((entry) => entry.id), ['AC-9']);
  assert.ok(rules(record).includes('unknown-criterion-reference'));
});

test('a trace to nothing is not a trace and never silences its section', (t) => {
  // The worst failure mode this atom has: reporting a clean pair for a pair
  // that is not clean. A mistyped trace label must not buy that.
  const root = workspace(t);
  writePair(root, {
    full: [
      '# In full',
      '',
      '## Fraud screening',
      '',
      'Traces to: bananas',
      '',
      'Every reservation must pass a fraud screen before it is confirmed.',
      '',
      '## Refunds',
      '',
      'Elaborates: AC-999',
      '',
      'A refund must be issued within one day.',
      '',
    ].join('\n'),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  const unresolved = record.observations.filter(
    (entry) => entry.rule === 'unresolved-trace-reference',
  );
  assert.deepEqual(unresolved.map((entry) => entry.targets), [['bananas'], ['AC-999']]);
  assert.deepEqual(
    record.traceability.untracedRequirements.map((entry) => entry.section).sort(),
    ['Fraud screening', 'Refunds'],
  );
});

test('a trace to the nano intention resolves without naming a criterion', (t) => {
  // #114 lets a full-spec section elaborate the intention rather than a
  // criterion. Refusing that would manufacture a finding for correct prose.
  const root = workspace(t);
  writePair(root, {
    full: '# In full\n\n## Why\n\nTraces to: intention\n\nThe basket must stay reserved while payment settles.\n',
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.deepEqual(record.observations, []);
  assert.ok(INTENTION_TARGETS.includes('intention'));
});

test('one specification identifier is never traced by another that shares its prefix', (t) => {
  const root = workspace(t);
  writePair(root, {
    nano: CLEAN_NANO.replace('SPEC-CHECKOUT-HOLD', 'SPEC-1'),
    full: '# In full\n\n## Fraud screening\n\nSee SPEC-10 for the fraud rules.\n\nEvery reservation must pass a fraud screen.\n',
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.equal(record.specId, 'SPEC-1');
  assert.deepEqual(
    record.traceability.untracedRequirements.map((entry) => entry.section),
    ['Fraud screening'],
  );
});

test('an undeclared identifier alone never marks a section traced', (t) => {
  const root = workspace(t);
  writePair(root, {
    full: '# In full\n\n## Refunds\n\nAC-999 covers this. A refund must be issued within one day.\n',
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.ok(rules(record).includes('unknown-criterion-reference'));
  assert.deepEqual(
    record.traceability.untracedRequirements.map((entry) => entry.section),
    ['Refunds'],
  );
});

test('an unmarked requirement cannot hide in a section with a traced requirement', (t) => {
  const root = workspace(t);
  writePair(root, {
    nano: CLEAN_NANO
      .replace('- AC-1:', '- AC-001:')
      .replace('- AC-2:', '- AC-002:'),
    full: [
      '# Checkout hold, in full',
      '',
      '## Product Requirements',
      '',
      '- REQ-001 [AC-001]: Keep the reserved basket available while payment settles.',
      '- REQ-003: Ask the shopper to restart checkout when fraud screening is delayed.',
      '',
    ].join('\n'),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  const untraced = record.traceability.untracedRequirements;
  assert.deepEqual(untraced.map((entry) => entry.line), [6]);
  assert.match(untraced[0].text, /REQ-003/);
  assert.ok(rules(record).includes('untraced-requirement'));
});

test('an untraced full-spec requirement is recorded and traced context is not', (t) => {
  const root = workspace(t);
  writePair(root, {
    full: [
      '# Checkout hold, in full',
      '',
      '## Reservation window',
      '',
      'Traces to: AC-1',
      '',
      'The basket must stay reserved for fifteen minutes.',
      '',
      '## Fraud screening',
      '',
      'Every reservation must pass a fraud screen before it is confirmed.',
      '',
      '## Background',
      '',
      'Shoppers abandoned baskets during the previous checkout flow.',
      '',
    ].join('\n'),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  const untraced = record.traceability.untracedRequirements;
  assert.deepEqual(untraced.map((entry) => entry.section), ['Fraud screening']);
  assert.match(untraced[0].text, /fraud screen/);
  assert.ok(rules(record).includes('untraced-requirement'));
});

test('a quoted requirement inside a fenced block is evidence, not a requirement', (t) => {
  const root = workspace(t);
  writePair(root, {
    full: [
      '# Checkout hold, in full',
      '',
      '## Rejected wording',
      '',
      'Traces to: AC-1',
      '',
      '```text',
      'The basket must never expire.',
      '- AC-9: A reserved basket stays reserved for sixty minutes.',
      '```',
      '',
    ].join('\n'),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.deepEqual(record.observations, []);
});

test('a shorter marker does not close a longer fenced block', (t) => {
  const root = workspace(t);
  writePair(root, {
    full: [
      '# Checkout hold, in full',
      '',
      '## Quoted example',
      '',
      '````markdown',
      '```text',
      'The basket must never expire.',
      '````',
      '',
      'Every reservation must pass a fraud screen before it is confirmed.',
      '',
    ].join('\n'),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.deepEqual(
    record.traceability.untracedRequirements.map((entry) => entry.text),
    ['Every reservation must pass a fraud screen before it is confirmed.'],
  );
  assert.deepEqual(
    record.observations
      .filter((entry) => entry.rule === 'untraced-requirement')
      .map((entry) => entry.excerpt),
    ['Every reservation must pass a fraud screen before it is confirmed.'],
  );
});

test('a nano artifact missing its identifier, criteria, or scope is recorded', (t) => {
  const root = workspace(t);
  writePair(root, {
    nano: [
      '# Checkout hold',
      '',
      '## Intention',
      '',
      'A shopper keeps a reserved basket while payment is confirmed.',
      '',
      '## Chosen architecture',
      '',
      'A key-value store holds the reservation.',
      '',
      '## Full specification',
      '',
      '[Full specification](./checkout-hold.full.md)',
      '',
    ].join('\n'),
    full: '# Checkout hold, in full\n',
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  const recorded = rules(record);
  assert.ok(recorded.includes('missing-spec-identifier'));
  assert.ok(recorded.includes('no-acceptance-criteria'));
  const widened = record.observations.find(
    (entry) => entry.rule === 'nano-section-outside-contract',
  );
  assert.equal(widened.section, 'Chosen architecture');
});

test('a repeated criterion identifier is recorded once and never declared twice', (t) => {
  const root = workspace(t);
  writePair(root, {
    nano: CLEAN_NANO.replace(
      '- AC-2: An expired reservation releases every held item.',
      '- AC-1: An expired reservation releases every held item.',
    ),
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  const duplicate = record.observations.find((entry) => entry.rule === 'duplicate-criterion-id');
  assert.equal(duplicate.criterionId, 'AC-1');
  assert.deepEqual(record.criteria.map((entry) => entry.id), ['AC-1']);
});

test('AC1 and AC-1 are the same stable identifier', (t) => {
  const root = workspace(t);
  writePair(root, {
    nano: CLEAN_NANO.replace('- AC-1:', '- [ ] **AC1** '),
    full: '# Checkout hold, in full\n\n## Window\n\nTraces to: AC-1\n',
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.deepEqual(record.criteria.map((entry) => entry.id), ['AC-1', 'AC-2']);
  assert.ok(record.traceability.referencedIds.includes('AC-1'));
});

test('a lowercase criterion identifier is the same stable identifier (Finding 9)', (t) => {
  const root = workspace(t);
  writePair(root, {
    nano: CLEAN_NANO.replace('- AC-1:', '- ac-1:'),
    full: '# Checkout hold, in full\n\n## Window\n\nTraces to: ac-1\n',
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.ok(record.criteria.map((entry) => entry.id).includes('AC-1'));
  assert.ok(record.traceability.referencedIds.includes('AC-1'));
});

test('a nano criterion the full specification never elaborates is data rather than a defect', (t) => {
  const root = workspace(t);
  writePair(root, {
    full: '# Checkout hold, in full\n\n## Window\n\nTraces to: AC-1\n\nFifteen minutes is the settlement window.\n',
  });

  const record = stageSpecPair({
    specPath: path.join(root, 'checkout-hold.nano.md'),
    repositoryRoot: root,
  });

  assert.deepEqual(record.traceability.uncitedCriteria, ['AC-2']);
  assert.deepEqual(record.observations, []);
});

test('an unsafe path, an escaped root, and an unknown flag all refuse', (t) => {
  const root = workspace(t);
  writePair(root);

  assert.throws(() => stageSpecPair({ specPath: 'checkout-hold.nano.md' }), (error) => {
    assert.ok(error instanceof SpecPairError);
    assert.equal(error.code, 'unsafe_path');
    return true;
  });

  assert.throws(
    () =>
      stageSpecPair({
        specPath: path.join(root, 'checkout-hold.nano.md'),
        repositoryRoot: path.join(root, 'nested'),
      }),
    (error) => {
      assert.equal(error.code, 'unsafe_path');
      return true;
    },
  );

  assert.throws(() => stageSpecPair({ specPath: path.join(root, 'checkout-hold.md') }), (error) => {
    assert.equal(error.code, 'usage');
    return true;
  });

  const unknownFlag = captureStreams();
  assert.equal(runSpecPair(['--nope', 'value'], unknownFlag), 1);
  assert.match(unknownFlag.errors(), /usage: unknown argument: --nope/);
});

test('a directory symbolic link inside the root cannot reach a pair outside it', (t) => {
  // Lexical containment passes here. Only canonicalizing the container catches
  // it, and the guarantee this atom states is about the declared root.
  const outside = workspace(t);
  writePair(outside);
  const root = workspace(t);
  fs.symlinkSync(outside, path.join(root, 'alias'));

  assert.throws(
    () =>
      stageSpecPair({
        specPath: path.join(root, 'alias', 'checkout-hold.nano.md'),
        repositoryRoot: root,
      }),
    (error) => {
      assert.ok(error instanceof SpecPairError);
      assert.equal(error.code, 'unsafe_path');
      return true;
    },
  );
});

test('a sibling that cannot be inspected is unreadable rather than missing', (t) => {
  if (typeof process.getuid !== 'function') {
    t.skip('POSIX ownership and permission bits are unavailable on this platform');
    return;
  }
  const root = workspace(t);
  const nested = path.join(root, 'specs');
  fs.mkdirSync(nested);
  writePair(nested, { full: null });

  let record;
  fs.chmodSync(nested, 0o000);
  try {
    record = stageSpecPair({
      specPath: path.join(nested, 'checkout-hold.nano.md'),
      repositoryRoot: root,
    });
  } finally {
    fs.chmodSync(nested, 0o755);
  }

  assert.equal(record.status, 'Unreadable');
  assert.equal(record.files.nano.status, 'Unreadable');
  assert.match(record.files.nano.reason, /EACCES/);
  assert.deepEqual(rules(record).filter((rule) => rule === 'missing-sibling'), []);
});

test('a single specification path and an explicit pair are mutually exclusive', (t) => {
  const root = workspace(t);
  const { nanoPath, fullPath } = writePair(root);

  for (const input of [
    { specPath: nanoPath, nanoPath },
    { specPath: fullPath, fullPath },
    { specPath: nanoPath, nanoPath, fullPath },
  ]) {
    assert.throws(() => stageSpecPair(input), (error) => {
      assert.equal(error.code, 'usage');
      assert.match(error.message, /never both/);
      return true;
    });
  }

  const streams = captureStreams();
  assert.equal(runSpecPair(['--spec', nanoPath, '--full', fullPath], streams), 1);
  assert.match(streams.errors(), /usage: .*never both/);
});

test('an explicit nano and full pair must be true siblings', (t) => {
  const root = workspace(t);
  const checkout = writePair(root, { stem: 'checkout' });
  const refunds = writePair(root, { stem: 'refunds' });
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested);
  const nestedPair = writePair(nested, { stem: 'checkout' });

  for (const [nanoPath, fullPath] of [
    [checkout.nanoPath, refunds.fullPath],
    [checkout.nanoPath, nestedPair.fullPath],
  ]) {
    assert.throws(() => stageSpecPair({ nanoPath, fullPath, repositoryRoot: root }), (error) => {
      assert.equal(error.code, 'usage');
      assert.match(error.message, /sibling mismatch/);
      return true;
    });
  }

  const streams = captureStreams();
  assert.equal(
    runSpecPair(
      ['--nano', checkout.nanoPath, '--full', refunds.fullPath, '--repository-root', root],
      streams,
    ),
    1,
  );
  assert.match(streams.errors(), /sibling mismatch/);
});

test('the command line emits the record, refuses without a target, and probes', (t) => {
  const root = workspace(t);
  const { nanoPath } = writePair(root);

  const staged = captureStreams();
  assert.equal(runSpecPair(['--spec', nanoPath, '--repository-root', root], staged), 0);
  assert.equal(JSON.parse(staged.output()).status, 'Paired');

  fs.rmSync(path.join(root, 'checkout-hold.full.md'));
  const incomplete = captureStreams();
  assert.equal(runSpecPair(['--spec', nanoPath, '--repository-root', root], incomplete), 0);
  assert.equal(JSON.parse(incomplete.output()).status, 'Incomplete pair');

  const missingTarget = captureStreams();
  assert.equal(runSpecPair([], missingTarget), 1);
  assert.match(missingTarget.errors(), /usage: spec-pair\.mjs/);

  const probe = captureStreams();
  assert.equal(runSpecPair(['--probe'], probe), 0);
  assert.match(probe.output(), /spec-pair: available/);
});

test('the command line requires a declared repository root (Finding 7)', (t) => {
  const root = workspace(t);
  const { nanoPath } = writePair(root);

  const noRoot = captureStreams();
  assert.equal(runSpecPair(['--spec', nanoPath], noRoot), 1);
  assert.match(noRoot.errors(), /repository-root is required/);

  // A conflicting combination is the more fundamental error and still wins.
  const conflicting = captureStreams();
  assert.equal(runSpecPair(['--spec', nanoPath, '--nano', nanoPath], conflicting), 1);
  assert.match(conflicting.errors(), /never both/);
});

test('a repeated flag refuses rather than taking the last value (Finding 8)', (t) => {
  const root = workspace(t);
  const { nanoPath } = writePair(root);
  const other = path.join(root, 'other.nano.md');
  fs.writeFileSync(other, CLEAN_NANO);

  const duplicate = captureStreams();
  assert.equal(
    runSpecPair(['--nano', nanoPath, '--nano', other, '--repository-root', root], duplicate),
    1,
  );
  assert.match(duplicate.errors(), /--nano was given more than once/);
});

/**
 * The vocabulary lives in two places on purpose: the document owns it for a
 * reader, and the resolver holds it so it never parses Markdown at run time.
 * Two copies with nothing tying them together is how a documented rule quietly
 * stops being the rule that runs.
 */

function bulletsUnder(heading) {
  const section = DOCUMENT.split(new RegExp(`^${heading}\\s*$`, 'm'))[1];
  assert.ok(section, `spec-pair.md no longer carries ${heading}`);
  const body = section.split(/^#{1,6} /m)[0];
  return [...body.matchAll(/^- `([^`]+)`$/gm)].map((match) => match[1]);
}

function tableRules() {
  const section = DOCUMENT.split(/^## Observations\s*$/m)[1].split(/^## /m)[0];
  return [...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
}

test('the documented vocabulary and the resolver vocabulary match in both directions', () => {
  assert.deepEqual(tableRules().sort(), [...OBSERVATION_RULES].sort());
  assert.deepEqual(
    bulletsUnder('### Permitted nano sections').sort(),
    [...PERMITTED_NANO_SECTIONS].sort(),
  );
  assert.deepEqual(bulletsUnder('### Trace references').sort(), [...INTENTION_TARGETS].sort());
  assert.deepEqual(bulletsUnder('### Requirement terms').sort(), [...REQUIREMENT_TERMS].sort());
  assert.deepEqual(bulletsUnder('### Precedence terms').sort(), [...PRECEDENCE_TERMS].sort());
});

test('every documented observation rule is reachable from some pair', () => {
  assert.equal(new Set(OBSERVATION_RULES).size, OBSERVATION_RULES.length);
  const cases = new Map([
    [
      'missing-sibling',
      (root) => {
        const { nanoPath } = writePair(root, { full: null });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'unreadable-sibling',
      (root) => {
        const { nanoPath, fullPath } = writePair(root, { full: null });
        fs.mkdirSync(fullPath);
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'broken-full-link',
      (root) => {
        const { nanoPath } = writePair(root, {
          nano: CLEAN_NANO.replace('[Full specification](./checkout-hold.full.md)', 'See full.'),
        });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'missing-spec-identifier',
      (root) => {
        const { nanoPath } = writePair(root, {
          nano: CLEAN_NANO.replace('- Specification identifier: SPEC-CHECKOUT-HOLD\n', ''),
        });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'no-acceptance-criteria',
      (root) => {
        const { nanoPath } = writePair(root, {
          nano: CLEAN_NANO.replace(
            '## Acceptance criteria\n\n- AC-1: A reserved basket stays reserved for fifteen minutes.\n- AC-2: An expired reservation releases every held item.\n\n',
            '',
          ),
        });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'duplicate-criterion-id',
      (root) => {
        const { nanoPath } = writePair(root, {
          nano: CLEAN_NANO.replace(
            '- AC-2: An expired reservation releases every held item.',
            '- AC-1: An expired reservation releases every held item.',
          ),
        });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'unknown-criterion-reference',
      (root) => {
        const { nanoPath } = writePair(root, {
          full: '# In full\n\n## Refunds\n\nThe refund path cites AC-999.\n',
        });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'unresolved-trace-reference',
      (root) => {
        const { nanoPath } = writePair(root, {
          full: '# In full\n\n## Refunds\n\nTraces to: bananas\n',
        });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'untraced-requirement',
      (root) => {
        const { nanoPath } = writePair(root, {
          full: '# In full\n\n## Refunds\n\nA refund must be issued within one day.\n',
        });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'authority-conflict',
      (root) => {
        const { nanoPath } = writePair(root, {
          full: '# In full\n\n## Window\n\n- AC-1: A reserved basket stays reserved for sixty minutes.\n',
        });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
    [
      'nano-section-outside-contract',
      (root) => {
        const { nanoPath } = writePair(root, {
          nano: CLEAN_NANO.replace(
            '## Full specification',
            '## Chosen architecture\n\nA cache holds reservations.\n\n## Full specification',
          ),
        });
        return stageSpecPair({ specPath: nanoPath, repositoryRoot: root });
      },
    ],
  ]);
  assert.deepEqual([...cases.keys()].sort(), [...OBSERVATION_RULES].sort());
  for (const [rule, build] of cases) {
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
    const tRoot = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'spec-pair-reachability-'));
    try {
      const record = build(tRoot);
      assert.ok(rules(record).includes(rule), `${rule} was not emitted`);
    } finally {
      fs.rmSync(tRoot, { recursive: true, force: true });
    }
  }
});
