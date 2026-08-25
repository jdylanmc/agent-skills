import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { buildTrailPacket, sanitizeText } from './_molecules/decision-trail-ledger/decision-trail-ledger.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'decision-trail/SKILL.md';
const PINNED_TOOLS = ['execute', 'read', 'search'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

function sha(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

const RUN_EVIDENCE = {
  issue: 'Issue #68 requests human-reviewable decisions and rejected alternatives.',
  agents: 'AGENTS.md says units move to _base only after more than one skill composes them.',
  chronicler: 'Chronicler records what happened, not decision rationale.',
  review: 'A different model family reviewed this trail and found no blocking defects.',
};

function runEvidence(extra = []) {
  return [
    { locator: 'issue-68#body', content: RUN_EVIDENCE.issue, trust_boundary: 'scoped-run-evidence' },
    { locator: 'AGENTS.md#canonical-formats', content: RUN_EVIDENCE.agents, trust_boundary: 'scoped-run-evidence' },
    { locator: 'chronicler.md#boundary', content: RUN_EVIDENCE.chronicler, trust_boundary: 'scoped-run-evidence' },
    ...extra,
  ];
}

function verificationResults(extra = []) {
  return [
    {
      locator: 'issue-68#body',
      summary: 'Issue requests human-reviewable decisions and rejected alternatives.',
      verified_by: 'self-audit',
      verified_at: '2026-08-25T10:01:00.000Z',
      source_digest: sha(RUN_EVIDENCE.issue),
      supports: ['*'],
    },
    {
      locator: 'AGENTS.md#canonical-formats',
      summary: 'Repository format requires local units until multiple consumers exist.',
      verified_by: 'self-audit',
      verified_at: '2026-08-25T10:01:00.000Z',
      source_digest: sha(RUN_EVIDENCE.agents),
      supports: ['*'],
    },
    {
      locator: 'chronicler.md#boundary',
      summary: 'Chronicler records what happened, not decision rationale.',
      verified_by: 'self-audit',
      verified_at: '2026-08-25T10:01:00.000Z',
      source_digest: sha(RUN_EVIDENCE.chronicler),
      supports: ['*'],
    },
    ...extra,
  ];
}

function independentReview(trailDigest) {
  return {
    creator_model_family: 'claude',
    reviewer_model_family: 'gpt',
    result: 'pass',
    evidence_locator: 'review#decision-trail',
    trail_digest: trailDigest,
  };
}

function reviewRunEvidence() {
  return { locator: 'review#decision-trail', content: RUN_EVIDENCE.review, trust_boundary: 'scoped-run-evidence' };
}

function verifiedReview(trailDigest) {
  return {
    locator: 'review#decision-trail',
    summary: 'Independent review found no blocking defects.',
    verified_by: 'self-audit',
    verified_at: '2026-08-25T10:02:00.000Z',
    source_digest: sha(RUN_EVIDENCE.review),
    supports: ['independent-review'],
    reviewed_trail_digest: trailDigest,
  };
}

function goodEntry(overrides = {}) {
  return {
    sequence: 1,
    decision_id: 'shape-routable',
    timestamp: '2026-08-25T10:00:00.000Z',
    decision_maker: 'agent',
    decision: 'Ship decision-trail as a routable skill with local units.',
    selected_option: 'routable skill',
    route_rationale: 'Issue names a target slug and no existing skill composes the unit today.',
    rejected_alternatives: [
      {
        option: 'promote shared base molecule immediately',
        reason_lost: 'Repository guidance promotes to _base only after more than one skill composes it.',
        evidence: ['AGENTS.md#canonical-formats'],
      },
    ],
    evidence: [
      { locator: 'issue-68#body', summary: 'The issue asks for structured rows with evidence.' },
      { locator: 'AGENTS.md#canonical-formats', summary: 'The repository defines promotion rules.' },
    ],
    confidence: 'high',
    authority_check: 'The skill records rationale only and grants no mutation authority.',
    outcome_state: 'proposed',
    human_gate: 'Human review before publication.',
    redaction_state: 'sanitized',
    defects: [],
    ...overrides,
  };
}

function packetFor(entries, overrides = {}) {
  const { extra_run_evidence = [], extra_verifications = [], trusted_independent_review, ...packetOverrides } = overrides;
  return buildTrailPacket({
    trail_id: 'issue-68',
    scope: 'decision-trail package',
    created_at: '2026-08-25T10:05:00.000Z',
    decision_maker: 'agent',
    source_context: ['issue-68#body'],
    entries,
    ...packetOverrides,
  }, {
    run_evidence: runEvidence(extra_run_evidence),
    verification_results: verificationResults(extra_verifications),
    independent_review: trusted_independent_review,
  });
}

test('decision-trail is routable and has the narrow pinned grant', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'decision-trail');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description names positive and negative triggers', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /human-reviewable decision trail/);
  assert.match(description, /material choices/);
  assert.match(description, /show the work/);
  assert.match(description, /audit a chain of choices/);
  assert.match(description, /Do not use/);
  assert.match(description, /routine progress logging/);
  assert.match(description, /approval/);
  assert.match(description, /replacing Chronicler/);
});

test('the skill composes chronicler and only local decision-trail units', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'decision-trail/_molecules/decision-trail-ledger/decision-trail-ledger.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'decision-trail/_molecules/decision-trail-ledger/decision-trail-ledger.md',
    'decision-trail/_atoms/decision-entry/decision-entry.md',
    'decision-trail/_atoms/trail-sanitization/trail-sanitization.md',
    'decision-trail/_atoms/trail-self-audit/trail-self-audit.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('nothing in the closure widens the pinned grant', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) {
      required.add(tool);
    }
  }

  const excess = [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort();
  assert.deepEqual(excess, [], `a composed unit needs ${excess.join(', ')}`);
  assert.deepEqual(derived.grantViolations, []);
});

test('the package states why it is not promoted to _base yet', () => {
  const entry = flat(ENTRY);
  const promoted = [...validateRepository(REPOSITORY_ROOT).graph.keys()].filter(
    (file) => file.startsWith('_base/') && /decision-trail/.test(file),
  );

  assert.deepEqual(promoted, [], 'first-consumer units stay local rather than promoted to _base');
  assert.match(entry, /Not a base unit yet/);
  assert.match(entry, /no current skill composes it/);
  assert.match(entry, /more than one skill actually depends on it/);
});

test('the output contract separates why-decisions from chronicler what-happened records', () => {
  const entry = flat(ENTRY);
  const molecule = flat('decision-trail/_molecules/decision-trail-ledger/decision-trail-ledger.md');

  assert.match(entry, /Chronicler records the bounded lifecycle\s+of what happened/);
  assert.match(entry, /Decision-trail records the reasoning behind consequential choices/);
  assert.match(entry, /selected option, rejected alternatives, evidence, decision maker, uncertainty,\s+and confidence/);
  assert.match(entry, /Not Chronicler/);
  assert.match(entry, /Not approval/);
  assert.match(molecule, /why material decisions were made/);
});

test('the row contract requires alternatives, evidence, maker, and confidence', () => {
  const atom = flat('decision-trail/_atoms/decision-entry/decision-entry.md');

  for (const phrase of [
    '`decision_maker`',
    '`decision`',
    '`selected_option`',
    '`route_rationale`',
    '`rejected_alternatives`',
    '`evidence`',
    '`confidence`',
    '`authority_check`',
    '`defects`',
  ]) {
    assert.match(atom, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(atom, /A dropped alternative is an audit defect/);
  assert.match(atom, /Never invent rationale/);
});

test('sanitization neutralizes spreadsheet formulas and records the change', () => {
  const result = sanitizeText('=IMPORTDATA("https://example.invalid")', 'entry.decision');

  assert.equal(result.value.startsWith("'="), true);
  assert.deepEqual(result.changes.map((change) => change.type), ['spreadsheet-formula-prefix']);
});

test('packet metadata is sanitized, not only entry fields', () => {
  const packet = packetFor([goodEntry()], {
    trail_id: '=metadata-formula',
    source_context: [' @also-formula'],
  });

  assert.equal(packet.trail_id, "'=metadata-formula");
  assert.equal(packet.source_context[0], "' @also-formula");
  assert.ok(packet.audit.sanitization_changes.some((change) => change.path === 'packet.trail_id'));
  assert.ok(packet.audit.sanitization_changes.some((change) => change.path === 'packet.source_context[0]'));
});

test('a complete high-stakes trail with independent review is ready for review', () => {
  const preliminary = packetFor([goodEntry()]);
  const packet = packetFor([goodEntry()], {
    high_stakes: true,
    publication_target: 'commit',
    reviewer_need: 'Reviewer needs the reasoning trail for pull request review.',
    explicit_operator_approval: true,
    trusted_independent_review: independentReview(preliminary.trail_digest),
    extra_run_evidence: [reviewRunEvidence()],
    extra_verifications: [verifiedReview(preliminary.trail_digest)],
  });

  assert.equal(packet.audit.complete, true);
  assert.equal(packet.audit.defects.length, 0);
  assert.equal(packet.publication_gate, 'ready-for-review');
  assert.equal(packet.entries[0].sequence, 1);
  assert.match(packet.entries[0].row_digest, /^[0-9a-f]{64}$/);
  assert.equal(packet.entries[0].previous_digest, null);
});

test('a high-stakes committed trail without different-family review is gated', () => {
  const packet = packetFor([goodEntry()], {
    high_stakes: true,
    publication_target: 'commit',
    reviewer_need: 'Reviewer needs the reasoning trail for pull request review.',
    explicit_operator_approval: true,
  });

  assert.equal(packet.publication_gate, 'needs-independent-review');
  assert.equal(packet.audit.complete, true);
});

test('a committed trail without operator approval is blocked', () => {
  const preliminary = packetFor([goodEntry()]);
  const packet = packetFor([goodEntry()], {
    publication_target: 'commit',
    reviewer_need: 'Reviewer needs the reasoning trail for pull request review.',
    trusted_independent_review: independentReview(preliminary.trail_digest),
    extra_run_evidence: [reviewRunEvidence()],
    extra_verifications: [verifiedReview(preliminary.trail_digest)],
  });

  assert.equal(packet.publication_gate, 'blocked');
  assert.ok(packet.audit.defects.some((item) => item.type === 'publication_gate_unmet'));
});

test('a fabricated independent-review locator cannot make a trail ready', () => {
  const preliminary = packetFor([goodEntry()]);
  const packet = packetFor([goodEntry()], {
    high_stakes: true,
    publication_target: 'commit',
    reviewer_need: 'Reviewer needs the reasoning trail for pull request review.',
    explicit_operator_approval: true,
    independent_review: independentReview(preliminary.trail_digest),
    extra_verifications: [verifiedReview(preliminary.trail_digest)],
  });

  assert.equal(packet.publication_gate, 'needs-independent-review');
  assert.equal(packet.audit.complete, true);
});

test('matching fabricated review structures in packet input cannot make a trail ready', () => {
  const preliminary = packetFor([goodEntry()]);
  const packet = packetFor([goodEntry()], {
    high_stakes: true,
    publication_target: 'commit',
    reviewer_need: 'Reviewer needs the reasoning trail for pull request review.',
    explicit_operator_approval: true,
    independent_review: independentReview(preliminary.trail_digest),
    extra_run_evidence: [reviewRunEvidence()],
    extra_verifications: [verifiedReview(preliminary.trail_digest)],
  });

  assert.equal(packet.publication_gate, 'needs-independent-review');
  assert.equal(packet.audit.complete, true);
});

test('a dropped alternative is visible as a defect rather than omitted', () => {
  const packet = packetFor([goodEntry({ rejected_alternatives: [] })]);

  assert.equal(packet.audit.complete, false);
  assert.ok(packet.audit.defects.some((item) => item.type === 'dropped_alternative'));
});

test('an unsupported evidence claim is visible as a defect', () => {
  const packet = packetFor([
    goodEntry({ evidence: [{ locator: 'imaginary-source', summary: 'This source does not exist.' }] }),
  ]);

  assert.equal(packet.audit.complete, false);
  assert.ok(packet.audit.defects.some((item) => item.type === 'unsupported_evidence'));
});

test('a fabricated catalog entry is not evidence even when it self-declares verified', () => {
  const packet = buildTrailPacket({
    trail_id: 'issue-68',
    scope: 'decision-trail package',
    created_at: '2026-08-25T10:05:00.000Z',
    decision_maker: 'agent',
    verification_results: [{
      locator: 'fabricated',
      summary: 'Caller supplied this only.',
      verified_by: 'caller',
      verified_at: '2026-08-25T10:02:00.000Z',
      source_digest: 'e'.repeat(64),
      supports: ['shape-routable'],
    }],
    entries: [goodEntry({ evidence: [{ locator: 'fabricated', summary: 'This is not actually verified.' }] })],
  });

  assert.equal(packet.audit.complete, false);
  assert.ok(packet.audit.defects.some((item) => item.type === 'unsupported_evidence'));
});

test('a tampered or reordered stored trail is visible and blocks publication', () => {
  const original = packetFor([
    goodEntry({ sequence: 1, decision_id: 'first' }),
    goodEntry({
      sequence: 2,
      decision_id: 'second',
      decision: 'Keep trail output local by default.',
      selected_option: 'return packet',
    }),
  ]);
  const reordered = [original.entries[1], original.entries[0]];

  const packet = packetFor(reordered, {
    publication_target: 'commit',
    reviewer_need: 'Reviewer needs the reasoning trail for pull request review.',
    explicit_operator_approval: true,
    trusted_independent_review: independentReview(original.trail_digest),
    extra_run_evidence: [reviewRunEvidence()],
    extra_verifications: [verifiedReview(original.trail_digest)],
  });

  assert.equal(packet.publication_gate, 'blocked');
  assert.ok(packet.audit.defects.some((item) => item.type === 'reordered_trail'));
  assert.ok(packet.audit.defects.some((item) => item.type === 'tampered_trail'));
});

test('tail deletion from a persisted packet is visible as tampering', () => {
  const original = packetFor([
    goodEntry({ sequence: 1, decision_id: 'first' }),
    goodEntry({
      sequence: 2,
      decision_id: 'second',
      decision: 'Keep trail output local by default.',
      selected_option: 'return packet',
    }),
  ]);

  const truncated = packetFor([original.entries[0]], {
    persisted: true,
    audit: original.audit,
    trail_digest: original.trail_digest,
    publication_target: 'commit',
    reviewer_need: 'Reviewer needs the reasoning trail for pull request review.',
    explicit_operator_approval: true,
    trusted_independent_review: independentReview(original.trail_digest),
    extra_run_evidence: [reviewRunEvidence()],
    extra_verifications: [verifiedReview(original.trail_digest)],
  });

  assert.equal(truncated.publication_gate, 'blocked');
  assert.ok(truncated.audit.defects.some((item) => item.type === 'tampered_trail'));
});

test('a persisted packet with the integrity envelope stripped is blocked', () => {
  const stripped = packetFor([goodEntry()], { persisted: true });

  assert.equal(stripped.publication_gate, 'blocked');
  assert.ok(stripped.audit.defects.some((item) => item.type === 'tampered_trail'));
});

test('unreconstructable reasoning stays visible rather than being invented', () => {
  const packet = packetFor([
    goodEntry({
      confidence: 'unreconstructable',
      outcome_state: 'unreconstructable',
      route_rationale: '',
      rejected_alternatives: [],
      defects: [{ type: 'unreconstructable_reasoning', detail: 'rationale missing from available evidence' }],
    }),
  ]);

  assert.equal(packet.audit.complete, false);
  assert.ok(packet.audit.defects.some((item) => item.type === 'unreconstructable_reasoning'));
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'decision-trail', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: decision-trail\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /reasoning matters after the run is over/);
  assert.match(normalized, /Chronicler records lifecycle operations/);
  assert.match(normalized, /evidence for review, never an approval mechanism/);
});

test('the workflow registers the decision-trail conformance suite explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/decision-trail\/decision-trail\.conformance\.test\.mjs/);
});
