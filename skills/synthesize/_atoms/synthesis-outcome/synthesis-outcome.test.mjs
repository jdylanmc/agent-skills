/**
 * Seam tests for synthesis-outcome.
 *
 * The property worth holding: the resolver decides one status from STRUCTURAL
 * evidence, worst to best. A bare status stub carries no identity, path, count,
 * or digest, so it resolves blocked rather than complete, and one profile must
 * be named across the binding, budget, and ledger.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BLOCKED_REASONS,
  STATUSES,
  SynthesisOutcomeError,
  resolveOutcome,
} from './synthesis-outcome.mjs';
import { ledgerDigest } from '../disclosure-ledger/disclosure-ledger.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DOCUMENT = fs.readFileSync(path.join(UNIT_ROOT, 'synthesis-outcome.md'), 'utf8');

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);
const PROFILE = 'spec-nano';

const BINDING = {
  status: 'bound',
  sourcePath: 'docs/agent/specs/faster-checkout.full.md',
  revision: DIGEST,
  digest: DIGEST,
};
const WITHIN = { profileId: PROFILE, words: 320, budget: 500, status: 'within' };
const LEDGER_ENTRIES = [
  { id: 'intention', kind: 'intention' },
  { id: 'ac-1', kind: 'criterion' },
];
const LEDGER_DIGEST = ledgerDigest(LEDGER_ENTRIES);
const CLEAN = { status: 'clean', profileId: PROFILE, digest: LEDGER_DIGEST, entries: LEDGER_ENTRIES };
const OVER = { ...WITHIN, words: 620, status: 'over' };

// A COMPLETE proposal set is the shape `evaluateSplit` returns: at least two
// proposals, each carrying slug, title, boundary, rationale, and a non-empty
// units array.
function completeProposals() {
  return [
    { slug: 'first', title: 'First cohesive piece', boundary: 'Everything about the first concern here.', units: ['intention'], rationale: 'The first concern is cohesive here.' },
    { slug: 'second', title: 'Second cohesive piece', boundary: 'Everything about the second concern here.', units: ['ac-1'], rationale: 'The second concern is separate here.' },
  ];
}
const SPLIT = { status: 'needs-split', ledgerDigest: LEDGER_DIGEST, profileId: PROFILE, proposals: completeProposals() };

function evidence(overrides = {}) {
  return {
    profileId: PROFILE,
    candidatePath: 'docs/agent/specs/faster-checkout.nano.md',
    binding: BINDING,
    budget: WITHIN,
    ledger: CLEAN,
    ...overrides,
  };
}

test('a fresh bound source with complete budget and ledger evidence is complete', () => {
  assert.deepEqual(resolveOutcome(evidence()), { status: 'complete', reasons: [] });
  assert.equal(
    resolveOutcome(evidence({ budget: { ...WITHIN, words: 500, status: 'at-limit' } })).status,
    'complete',
  );
});

test('each status-only stub resolves blocked rather than complete', () => {
  // This is the exact hole: bare status stubs used to resolve complete.
  assert.equal(resolveOutcome({ binding: { status: 'bound' }, budget: { status: 'within' }, ledger: { status: 'clean' } }).status, 'blocked');
  assert.equal(resolveOutcome(evidence({ binding: { status: 'bound' } })).status, 'blocked');
  assert.equal(resolveOutcome(evidence({ budget: { status: 'within' } })).status, 'blocked');
  assert.equal(resolveOutcome(evidence({ ledger: { status: 'clean' } })).status, 'blocked');
});

test('a binding refusal that is not staleness is blocked', () => {
  assert.equal(resolveOutcome(evidence({ binding: { status: 'unbound-source' } })).status, 'blocked');
  assert.equal(resolveOutcome(evidence({ binding: { status: 'blocked', reason: 'unknown-profile' } })).status, 'blocked');
});

test('a stale source resolves stale-source without demanding candidate, budget, or ledger', () => {
  assert.equal(resolveOutcome({ binding: { status: 'stale-source' } }).status, 'stale-source');
});

test('a ledger defect resolves refused and carries the defect code', () => {
  const outcome = resolveOutcome(evidence({ ledger: { status: 'defect', code: 'unaccounted-source' } }));
  assert.equal(outcome.status, 'refused');
  assert.deepEqual(outcome.reasons, ['unaccounted-source']);
});

test('over budget with a valid split proposal is needs-split', () => {
  const outcome = resolveOutcome(evidence({
    budget: OVER,
    split: SPLIT,
  }));
  assert.equal(outcome.status, 'needs-split');
});

test('over budget with no valid split is blocked', () => {
  assert.equal(
    resolveOutcome(evidence({ budget: OVER, split: { status: 'not-required' } })).status,
    'blocked',
  );
  assert.equal(
    resolveOutcome(evidence({ budget: OVER })).status,
    'blocked',
  );
});

test('a bare needs-split status stub over budget resolves blocked, never needs-split', () => {
  // The exact hole: `{status: 'needs-split'}` with no ledger digest, profile, or
  // proposals used to satisfy the outcome.
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { status: 'needs-split' } })),
    { status: 'blocked', reasons: ['split-ledger-mismatch'] },
  );
});

test('each missing piece of split evidence has its own named blocked reason', () => {
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { status: 'not-required' } })),
    { status: 'blocked', reasons: ['split-not-proposed'] },
  );
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { ...SPLIT, ledgerDigest: OTHER_DIGEST } })),
    { status: 'blocked', reasons: ['split-ledger-mismatch'] },
  );
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { ...SPLIT, profileId: 'spec-mini' } })),
    { status: 'blocked', reasons: ['split-profile-mismatch'] },
  );
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { ...SPLIT, proposals: [] } })),
    { status: 'blocked', reasons: ['split-proposals-incomplete'] },
  );
});

test('a structurally empty or single split proposal over budget resolves blocked, not needs-split', () => {
  // The exact round-4 hole: `proposals: [{}]` reached needs-split, and a single
  // complete proposal is the original problem renamed.
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { ...SPLIT, proposals: [{}] } })),
    { status: 'blocked', reasons: ['split-proposals-incomplete'] },
  );
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { ...SPLIT, proposals: [completeProposals()[0]] } })),
    { status: 'blocked', reasons: ['split-proposals-incomplete'] },
  );
  // A proposal missing any required field is incomplete even with two of them.
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { ...SPLIT, proposals: [completeProposals()[0], { slug: 'second', title: 'Second cohesive piece', boundary: 'Everything else here.', rationale: 'Separate concern here.', units: [] }] } })),
    { status: 'blocked', reasons: ['split-proposals-incomplete'] },
  );
  // Two complete proposals resolve needs-split.
  assert.equal(resolveOutcome(evidence({ budget: OVER, split: SPLIT })).status, 'needs-split');
});

test('two proposals whose units array carries a null member over budget resolves blocked', () => {
  // The round-5 hole: two otherwise substantive proposals with `units: [null]`
  // resolved needs-split. `evaluateSplit` never returns `[null]` — it rejects a
  // malformed unit — so the resolver must reject the malformed sibling evidence.
  const proposals = [
    { slug: 'first', title: 'First cohesive piece', boundary: 'Everything about the first concern here.', rationale: 'The first concern is cohesive here.', units: [null] },
    { slug: 'second', title: 'Second cohesive piece', boundary: 'Everything about the second concern here.', rationale: 'The second concern is separate here.', units: [null] },
  ];
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { ...SPLIT, proposals } })),
    { status: 'blocked', reasons: ['split-proposals-incomplete'] },
  );
});

test('two proposals whose units array is a sparse Array(1) over budget resolves blocked', () => {
  // Finding D (round 6): `Array(1)` has length 1 but no own property at index 0,
  // so `Array.prototype.every` skips the hole and vacuously accepts it. The
  // resolver checks every index as an own property holding a non-empty string,
  // so a sparse units array names no cohesive unit and is incomplete.
  const proposals = [
    { slug: 'first', title: 'First cohesive piece', boundary: 'Everything about the first concern here.', rationale: 'The first concern is cohesive here.', units: Array(1) },
    { slug: 'second', title: 'Second cohesive piece', boundary: 'Everything about the second concern here.', rationale: 'The second concern is separate here.', units: Array(1) },
  ];
  assert.deepEqual(
    resolveOutcome(evidence({ budget: OVER, split: { ...SPLIT, proposals } })),
    { status: 'blocked', reasons: ['split-proposals-incomplete'] },
  );
});

test('a ledger digest that does not match its entries is blocked with ledger-digest-mismatch', () => {
  assert.deepEqual(
    resolveOutcome(evidence({ ledger: { ...CLEAN, digest: OTHER_DIGEST } })),
    { status: 'blocked', reasons: ['ledger-digest-mismatch'] },
  );
  // A clean ledger with no entries cannot prove its digest either.
  assert.equal(
    resolveOutcome(evidence({ ledger: { status: 'clean', profileId: PROFILE, digest: LEDGER_DIGEST } })).status,
    'blocked',
  );
});

test('a source path traversal that escapes the workspace is blocked after normalization', () => {
  // An interior `..` that stays within the root normalizes to `docs/private/...`
  // and escapes the workspace, so it is blocked with source-outside-workspace.
  assert.deepEqual(
    resolveOutcome(evidence({
      binding: { ...BINDING, sourcePath: 'docs/agent/../private/demo.full.md' },
      candidatePath: 'docs/agent/specs/demo.nano.md',
    })),
    { status: 'blocked', reasons: ['source-outside-workspace'] },
  );
});

test('the exact round-4 traversal-and-absolute payload resolves blocked, never complete', () => {
  // `../../docs/...` pops above the relative root and `/docs/...` is absolute.
  // A normalizer that silently dropped both used to reach complete; each is now
  // refused outright with its own named reason.
  assert.deepEqual(
    resolveOutcome(evidence({
      binding: { ...BINDING, sourcePath: '../../docs/agent/specs/demo.full.md' },
      candidatePath: '/docs/agent/specs/demo.nano.md',
    })),
    { status: 'blocked', reasons: ['source-path-escapes-root'] },
  );
  // A relative source with an absolute candidate is refused on the candidate.
  assert.deepEqual(
    resolveOutcome(evidence({ candidatePath: '/docs/agent/specs/faster-checkout.nano.md' })),
    { status: 'blocked', reasons: ['candidate-path-absolute'] },
  );
  // A Windows-drive absolute source is refused.
  assert.deepEqual(
    resolveOutcome(evidence({
      binding: { ...BINDING, sourcePath: 'C:/docs/agent/specs/demo.full.md' },
      candidatePath: 'docs/agent/specs/demo.nano.md',
    })),
    { status: 'blocked', reasons: ['source-path-absolute'] },
  );
});

test('a ledger defect outranks a budget split (refused beats needs-split)', () => {
  const outcome = resolveOutcome(evidence({
    budget: { ...WITHIN, words: 620, status: 'over' },
    ledger: { status: 'defect', code: 'weakened-criterion' },
    split: { status: 'needs-split' },
  }));
  assert.equal(outcome.status, 'refused');
});

test('a profile id mismatch across evidence is blocked with evidence-profile-mismatch', () => {
  assert.deepEqual(
    resolveOutcome(evidence({ budget: { ...WITHIN, profileId: 'spec-mini' } })),
    { status: 'blocked', reasons: ['evidence-profile-mismatch'] },
  );
  assert.deepEqual(
    resolveOutcome(evidence({ ledger: { ...CLEAN, profileId: 'spec-mini' } })),
    { status: 'blocked', reasons: ['evidence-profile-mismatch'] },
  );
});

test('missing top-level profile id or candidate path is blocked', () => {
  assert.equal(resolveOutcome(evidence({ profileId: undefined })).status, 'blocked');
  assert.equal(resolveOutcome(evidence({ candidatePath: '' })).status, 'blocked');
});

test('malformed binding, budget, or ledger evidence is blocked', () => {
  assert.equal(resolveOutcome(evidence({ binding: { ...BINDING, digest: 'not-a-digest' } })).status, 'blocked');
  assert.equal(resolveOutcome(evidence({ budget: { ...WITHIN, words: 3.5 } })).status, 'blocked');
  assert.equal(resolveOutcome(evidence({ ledger: { status: 'clean', profileId: PROFILE, digest: 'short' } })).status, 'blocked');
});

test('missing evidence is unmet evidence and never resolves complete', () => {
  assert.equal(resolveOutcome({ budget: WITHIN, ledger: CLEAN }).status, 'blocked');
  assert.equal(resolveOutcome(evidence({ binding: undefined })).status, 'blocked');
  assert.equal(resolveOutcome(evidence({ ledger: undefined })).status, 'blocked');
});

test('non-object evidence throws a typed error', () => {
  assert.throws(() => resolveOutcome(null), (error) => error instanceof SynthesisOutcomeError && error.code === 'invalid-input');
});

test('the exact round-2 exploit payload resolves blocked', () => {
  // profileId names no profile, revision != digest, and words/budget/status are
  // mutually inconsistent. The old resolver validated shapes and reached
  // complete; it now blocks on the unknown profile before weighing the rest.
  const outcome = resolveOutcome({
    profileId: 'fabricated-profile',
    candidatePath: 'docs/agent/specs/faster-checkout.nano.md',
    binding: { status: 'bound', sourcePath: 'docs/agent/specs/faster-checkout.full.md', revision: DIGEST, digest: OTHER_DIGEST },
    budget: { profileId: 'fabricated-profile', words: 999, budget: 1, status: 'within' },
    ledger: CLEAN,
  });
  assert.deepEqual(outcome, { status: 'blocked', reasons: ['unknown-profile'] });
});

test('an unknown top-level profile id is blocked with unknown-profile', () => {
  assert.deepEqual(resolveOutcome(evidence({ profileId: 'fabricated-profile' })), { status: 'blocked', reasons: ['unknown-profile'] });
});

test('a revision that is not the content digest is blocked with revision-digest-mismatch', () => {
  assert.deepEqual(
    resolveOutcome(evidence({ binding: { ...BINDING, revision: DIGEST, digest: OTHER_DIGEST } })),
    { status: 'blocked', reasons: ['revision-digest-mismatch'] },
  );
});

test('a budget that is not the profile word budget is blocked with budget-not-profile-bound', () => {
  assert.deepEqual(
    resolveOutcome(evidence({ budget: { ...WITHIN, budget: 1 } })),
    { status: 'blocked', reasons: ['budget-not-profile-bound'] },
  );
});

test('a status the profile rule does not derive is blocked with budget-status-inconsistent', () => {
  // 999 words against a 500 budget is `over`, never `within`.
  assert.deepEqual(
    resolveOutcome(evidence({ budget: { ...WITHIN, words: 999, status: 'within' } })),
    { status: 'blocked', reasons: ['budget-status-inconsistent'] },
  );
  // A negative word count is never valid.
  assert.deepEqual(
    resolveOutcome(evidence({ budget: { ...WITHIN, words: -1, status: 'within' } })),
    { status: 'blocked', reasons: ['budget-status-inconsistent'] },
  );
});

test('a candidate path that is not the profile pattern with the source slug is blocked', () => {
  assert.deepEqual(
    resolveOutcome(evidence({ candidatePath: 'docs/agent/specs/other-feature.nano.md' })),
    { status: 'blocked', reasons: ['candidate-path-mismatch'] },
  );
});

test('a source outside the profile workspace is blocked with source-outside-workspace', () => {
  assert.deepEqual(
    resolveOutcome(evidence({
      binding: { ...BINDING, sourcePath: 'src/faster-checkout.full.md' },
      candidatePath: 'docs/agent/specs/faster-checkout.nano.md',
    })),
    { status: 'blocked', reasons: ['source-outside-workspace'] },
  );
});

test('the documented status table matches STATUSES in both directions', () => {
  const section = DOCUMENT.split(/^## Resolution\s*$/m)[1].split(/^## /m)[0];
  const documented = [...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(documented.sort(), [...STATUSES].sort());
});

// A payload that drives the resolver down each blocked path. The reason the
// resolver actually EMITS is asserted, not two declarations that can drift
// together, so a prose reason emitted anywhere fails this suite.
const BLOCKED_PATHS = {
  'binding-missing': {},
  'binding-refused': evidence({ binding: { status: 'unbound-source' } }),
  'profile-id-missing': evidence({ profileId: undefined }),
  'unknown-profile': evidence({ profileId: 'fabricated-profile' }),
  'candidate-path-missing': evidence({ candidatePath: '' }),
  'binding-evidence-incomplete': evidence({ binding: { ...BINDING, digest: 'not-a-digest' } }),
  'budget-evidence-incomplete': evidence({ budget: { ...WITHIN, words: 3.5 } }),
  'evidence-profile-mismatch': evidence({ budget: { ...WITHIN, profileId: 'spec-mini' } }),
  'ledger-evidence-missing': evidence({ ledger: {} }),
  'revision-digest-mismatch': evidence({ binding: { ...BINDING, revision: DIGEST, digest: OTHER_DIGEST } }),
  'budget-not-profile-bound': evidence({ budget: { ...WITHIN, budget: 1 } }),
  'budget-status-inconsistent': evidence({ budget: { ...WITHIN, words: 999, status: 'within' } }),
  'source-path-absolute': evidence({ binding: { ...BINDING, sourcePath: 'C:/docs/agent/specs/faster-checkout.full.md' } }),
  'source-path-escapes-root': evidence({ binding: { ...BINDING, sourcePath: '../../docs/agent/specs/faster-checkout.full.md' } }),
  'candidate-path-absolute': evidence({ candidatePath: '/docs/agent/specs/faster-checkout.nano.md' }),
  'candidate-path-escapes-root': evidence({ candidatePath: '../../docs/agent/specs/faster-checkout.nano.md' }),
  'candidate-path-mismatch': evidence({ candidatePath: 'docs/agent/specs/other-feature.nano.md' }),
  'source-outside-workspace': evidence({ binding: { ...BINDING, sourcePath: 'src/faster-checkout.full.md' }, candidatePath: 'docs/agent/specs/faster-checkout.nano.md' }),
  'ledger-evidence-incomplete': evidence({ ledger: { status: 'clean', profileId: PROFILE, digest: 'short' } }),
  'ledger-digest-mismatch': evidence({ ledger: { ...CLEAN, digest: OTHER_DIGEST } }),
  'split-not-proposed': evidence({ budget: OVER, split: { status: 'not-required' } }),
  'split-ledger-mismatch': evidence({ budget: OVER, split: { ...SPLIT, ledgerDigest: OTHER_DIGEST } }),
  'split-profile-mismatch': evidence({ budget: OVER, split: { ...SPLIT, profileId: 'spec-mini' } }),
  'split-proposals-incomplete': evidence({ budget: OVER, split: { ...SPLIT, proposals: [{}] } }),
};

test('every blocked reason is EMITTED by a real payload, exported, and documented', () => {
  const section = DOCUMENT.split(/^## Blocked Reasons\s*$/m)[1].split(/^## /m)[0];
  const documented = [...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);

  const emitted = new Set();
  for (const [reason, payload] of Object.entries(BLOCKED_PATHS)) {
    const outcome = resolveOutcome(payload);
    assert.equal(outcome.status, 'blocked', `payload for ${reason} did not resolve blocked`);
    assert.equal(outcome.reasons.length, 1, `payload for ${reason} emitted more than one reason`);
    const [actual] = outcome.reasons;
    assert.equal(actual, reason, `payload for ${reason} emitted ${actual}`);
    assert.ok(BLOCKED_REASONS.includes(actual), `${actual} is not exported in BLOCKED_REASONS`);
    assert.ok(documented.includes(actual), `${actual} is not in the documented Blocked Reasons table`);
    emitted.add(actual);
  }

  // Neither the export nor the documented table may carry a reason no payload
  // drives, and no payload may emit a reason absent from either.
  assert.deepEqual([...emitted].sort(), [...BLOCKED_REASONS].sort());
  assert.deepEqual(documented.sort(), [...BLOCKED_REASONS].sort());
});

test('resolveOutcome({}).reasons[0] is a member of BLOCKED_REASONS', () => {
  const [reason] = resolveOutcome({}).reasons;
  assert.ok(BLOCKED_REASONS.includes(reason), `${reason} is not a stable blocked reason`);
});
