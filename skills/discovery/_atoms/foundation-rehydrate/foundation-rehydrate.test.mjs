import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FOUNDATION_FIELDS,
  alignedPayloadDigestOf,
  persistFoundation,
  revisionOf,
} from '../foundation-persist/foundation-persist.mjs';
import {
  FoundationRehydrateError,
  MODES,
  RECOVERY,
  REHYDRATED,
  parseContinuation,
  rehydrateFoundation,
  renderContinuation,
  run,
} from './foundation-rehydrate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.join(HERE, '..', '..', '..', '..', '.test-sandbox', 'foundation-rehydrate');

const SLUG = 'discovery-rehydration';
const SUBJECT_ID = 'issue-119';
const LOCATOR = `docs/agent/discovery/${SLUG}.md`;

let counter = 0;
function freshRepo() {
  counter += 1;
  const root = path.join(SANDBOX, `repo-${process.pid}-${counter}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

// Persist a genuine foundation into a real repository so rehydration reads real
// bytes, exactly what the atom does at the start of a run.
function seed(root, overrides = {}) {
  const payload = {
    version: 1,
    repositoryRoot: root,
    subject: { id: SUBJECT_ID, slug: SLUG },
    alignment: 'verified',
    cycle: 'c-0001',
    timestamp: '2026-08-29T01:00:00Z',
    confirmedFacts: ['A confirmed fact.'],
    evidenceReferences: ['docs/x.md'],
    decisions: ['A decision.'],
    constraints: ['A constraint.'],
    assumptions: ['An assumption.'],
    contradictions: ['A contradiction.'],
    openQuestions: ['An open question.'],
    scope: ['In scope.'],
    exclusions: ['Excluded.'],
    frontier: ['ready'],
    nextAction: 'Hand to specification.',
    resolved: [],
    ...overrides,
  };
  const dest = path.join(payload.repositoryRoot, 'docs', 'agent', 'discovery', `${payload.subject.slug}.md`);
  let expectedPriorRevision = null;
  try {
    expectedPriorRevision = revisionOf(fs.readFileSync(dest, 'utf8'));
  } catch { /* first cycle */ }
  const result = persistFoundation({ ...payload, expectedPriorRevision, alignedPayloadDigest: alignedPayloadDigestOf(payload) });
  return result;
}

function intake(root, overrides = {}) {
  return {
    version: 1,
    repositoryRoot: root,
    subject: { id: SUBJECT_ID, slug: SLUG },
    expected: null,
    ...overrides,
  };
}

function code(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof FoundationRehydrateError) return error.code;
    throw error;
  }
}

test.after(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('cold-start rehydration reads the artifact and returns the eleven distinct fields', () => {
  const root = freshRepo();
  seed(root);
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, REHYDRATED);
  assert.equal(result.mode, MODES.coldStart);
  for (const field of FOUNDATION_FIELDS) {
    assert.ok(result[field] !== undefined, `rehydrated state must carry a distinct ${field}`);
  }
  assert.deepEqual(result.confirmedFacts, ['A confirmed fact.']);
  assert.deepEqual(result.openQuestions, ['An open question.']);
  assert.equal(result.foundation.alignment, 'confirmed');
  assert.equal(result.foundation.locator, LOCATOR);
});

test('compacted-session rehydration matches the carried continuation', () => {
  const root = freshRepo();
  const { revision } = seed(root);
  const result = rehydrateFoundation(intake(root, { expected: { locator: LOCATOR, revision } }));
  assert.equal(result.status, REHYDRATED);
  assert.equal(result.mode, MODES.compactedSession);
  assert.deepEqual(result.continuation, { locator: LOCATOR, revision });
});

test('the continuation record carries the exact locator and current revision', () => {
  const root = freshRepo();
  const { revision } = seed(root);
  const result = rehydrateFoundation(intake(root));
  assert.deepEqual(result.continuation, { locator: LOCATOR, revision });
  assert.equal(result.foundation.revision, revision);
});

test('a missing foundation is a named recovery state, not a silent continuation', () => {
  const root = freshRepo();
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.missing);
  assert.equal(result.confirmedFacts, undefined);
});

test('a foreign artifact does not rehydrate under a mismatched identity', () => {
  const root = freshRepo();
  // A genuine foundation exists, but for a different subject.
  seed(root, { subject: { id: 'issue-999', slug: 'other-subject' } });
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.missing);
  // The foreign artifact is reported under ignored with the subject it declares.
  assert.equal(result.ignored.length, 1);
  assert.deepEqual(result.ignored[0].declaredSubject, { id: 'issue-999', slug: 'other-subject' });
});

test('two genuinely different files declaring the same subject are ambiguous, choosing none', () => {
  const root = freshRepo();
  seed(root);
  // A second, genuinely different file that also declares this subject.
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  const canonical = fs.readFileSync(path.join(dir, `${SLUG}.md`), 'utf8');
  const different = canonical.replace('A confirmed fact.', 'A different confirmed fact.');
  fs.writeFileSync(path.join(dir, 'duplicate.md'), different);

  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.ambiguous);
  assert.deepEqual(result.candidates.sort(), [LOCATOR, 'docs/agent/discovery/duplicate.md'].sort());
  assert.equal(result.confirmedFacts, undefined);
});

test('a carried continuation whose artifact moved is stale, never missing', () => {
  const root = freshRepo();
  const { revision } = seed(root);
  // The continuation points at a locator that no longer exists.
  const result = rehydrateFoundation(intake(root, { expected: { locator: 'docs/agent/discovery/moved.md', revision } }));
  assert.equal(result.status, RECOVERY.stale);
  assert.equal(result.currentRevision, null);
});

test('a carried continuation whose artifact is gone is stale, never missing', () => {
  const root = freshRepo();
  const { revision } = seed(root);
  fs.rmSync(path.join(root, 'docs', 'agent', 'discovery', `${SLUG}.md`));
  const result = rehydrateFoundation(intake(root, { expected: { locator: LOCATOR, revision } }));
  assert.equal(result.status, RECOVERY.stale);
  assert.equal(result.currentRevision, null);
});

test('a carried continuation whose revision moved is stale and reports both revisions', () => {
  const root = freshRepo();
  const { revision } = seed(root);
  const result = rehydrateFoundation(intake(root, { expected: { locator: LOCATOR, revision: 'deadbeef' } }));
  assert.equal(result.status, RECOVERY.stale);
  assert.equal(result.expectedRevision, 'deadbeef');
  assert.equal(result.currentRevision, revision);
  for (const field of FOUNDATION_FIELDS) {
    assert.equal(result[field], undefined, `stale must not return ${field}`);
  }
});

test('the canonical locator existing but unparsable is unreadable, not missing', () => {
  const root = freshRepo();
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${SLUG}.md`), '# Not a foundation\n\njust prose\n');
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /could not be recovered/);
});

test('a parsed artifact whose alignment is not confirmed is unaligned', () => {
  const root = freshRepo();
  seed(root);
  const dest = path.join(root, 'docs', 'agent', 'discovery', `${SLUG}.md`);
  fs.writeFileSync(dest, fs.readFileSync(dest, 'utf8').replace('- Alignment: confirmed', '- Alignment: offered'));
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.unaligned);
  assert.equal(result.alignment, 'offered');
});

test('a symlinked .md entry fails closed as unreadable, still reported under ignored and never read', () => {
  const root = freshRepo();
  seed(root);
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  const target = path.join(root, 'outside.md');
  fs.writeFileSync(target, 'secret bytes');
  fs.symlinkSync(target, path.join(dir, 'linked.md'));
  const result = rehydrateFoundation(intake(root));
  // A symlinked artifact is never read or followed, so its true subject is
  // unknowable — the run fails closed rather than rehydrating from the real
  // foundation as if the symlink were absent.
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /docs\/agent\/discovery\/linked\.md/);
  assert.match(result.readFailure, /symbolic link/);
  // No rehydrated payload leaks despite a genuine foundation existing on disk.
  assert.equal(result.confirmedFacts, undefined);
  // The reason it was skipped is still surfaced under ignored.
  const linkIgnored = result.ignored.find((entry) => entry.locator === 'docs/agent/discovery/linked.md');
  assert.match(linkIgnored.reason, /symbolic link/);
});

test('a symlinked artifact for THIS subject fails closed as unreadable, not missing', () => {
  const root = freshRepo();
  // A genuine, aligned foundation for this subject lives outside the discovery
  // directory; the canonical locator is a symbolic link to it. It is never
  // followed, so cold start cannot dismiss it as absent.
  const outside = path.join(root, 'real');
  fs.mkdirSync(outside, { recursive: true });
  seed(outside);
  const realFoundation = path.join(outside, 'docs', 'agent', 'discovery', `${SLUG}.md`);
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(realFoundation, path.join(dir, `${SLUG}.md`));
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.notEqual(result.status, RECOVERY.missing);
  assert.match(result.readFailure, new RegExp(`docs/agent/discovery/${SLUG}\\.md`));
  assert.match(result.readFailure, /symbolic link/);
  assert.equal(result.confirmedFacts, undefined);
});

test('cold start and compacted mode agree on a symlinked artifact: both foundation-unreadable', () => {
  // Build one on-disk condition: the canonical locator is a symbolic link to a
  // genuine, aligned foundation for this subject. Resolve it in BOTH modes and
  // assert the recovery states are equal — the identical bytes must not diverge.
  function symlinkedFoundationRepo() {
    const root = freshRepo();
    const outside = path.join(root, 'real');
    fs.mkdirSync(outside, { recursive: true });
    const { revision } = seed(outside);
    const realFoundation = path.join(outside, 'docs', 'agent', 'discovery', `${SLUG}.md`);
    const dir = path.join(root, 'docs', 'agent', 'discovery');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(realFoundation, path.join(dir, `${SLUG}.md`));
    return { root, revision };
  }

  const coldRepo = symlinkedFoundationRepo();
  const coldStart = rehydrateFoundation(intake(coldRepo.root));

  const compactedRepo = symlinkedFoundationRepo();
  const compacted = rehydrateFoundation(
    intake(compactedRepo.root, { expected: { locator: LOCATOR, revision: compactedRepo.revision } }),
  );

  assert.equal(coldStart.status, compacted.status);
  assert.equal(coldStart.status, RECOVERY.unreadable);
  assert.equal(coldStart.confirmedFacts, undefined);
  assert.equal(compacted.confirmedFacts, undefined);
});

test('a symlinked discovery directory is refused rather than followed', () => {
  const root = freshRepo();
  fs.mkdirSync(path.join(root, 'docs', 'agent'), { recursive: true });
  const elsewhere = path.join(root, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(root, 'docs', 'agent', 'discovery'));
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /symbolic link/);
});

test('every recovery state and the rehydrated state is genuinely producible', () => {
  const producible = new Set();

  const rehydrateRoot = freshRepo();
  seed(rehydrateRoot);
  producible.add(rehydrateFoundation(intake(rehydrateRoot)).status);

  producible.add(rehydrateFoundation(intake(freshRepo())).status); // missing

  const ambiguousRoot = freshRepo();
  seed(ambiguousRoot);
  const dir = path.join(ambiguousRoot, 'docs', 'agent', 'discovery');
  const canonical = fs.readFileSync(path.join(dir, `${SLUG}.md`), 'utf8');
  fs.writeFileSync(path.join(dir, 'duplicate.md'), canonical.replace('A confirmed fact.', 'Another.'));
  producible.add(rehydrateFoundation(intake(ambiguousRoot)).status); // ambiguous

  const unreadableRoot = freshRepo();
  const udir = path.join(unreadableRoot, 'docs', 'agent', 'discovery');
  fs.mkdirSync(udir, { recursive: true });
  fs.writeFileSync(path.join(udir, `${SLUG}.md`), 'not a foundation\n');
  producible.add(rehydrateFoundation(intake(unreadableRoot)).status); // unreadable

  const unalignedRoot = freshRepo();
  seed(unalignedRoot);
  const udest = path.join(unalignedRoot, 'docs', 'agent', 'discovery', `${SLUG}.md`);
  fs.writeFileSync(udest, fs.readFileSync(udest, 'utf8').replace('- Alignment: confirmed', '- Alignment: offered'));
  producible.add(rehydrateFoundation(intake(unalignedRoot)).status); // unaligned

  const staleRoot = freshRepo();
  seed(staleRoot);
  producible.add(rehydrateFoundation(intake(staleRoot, { expected: { locator: LOCATOR, revision: 'nope' } })).status); // stale

  assert.deepEqual([...producible].sort(), [REHYDRATED, ...Object.values(RECOVERY)].sort());
});

test('malformed intake throws invalid-input, not a recovery state', () => {
  const root = freshRepo();
  assert.equal(code(() => rehydrateFoundation({ ...intake(root), surprise: 1 })), 'invalid-input');
  assert.equal(code(() => rehydrateFoundation(intake(root, { version: 2 }))), 'invalid-input');
  assert.equal(code(() => rehydrateFoundation(intake(root, { subject: { id: 'x', slug: 'Bad Slug' } }))), 'invalid-input');
  assert.equal(code(() => rehydrateFoundation(intake('relative/root'))), 'invalid-input');
});

test('a caller cannot assert a verified write, subject identity, alignment, or bytes', () => {
  const root = freshRepo();
  // AC7/F1/F2 made mechanical: there is no field to claim a write, an identity,
  // an alignment, or the bytes of a foundation.
  assert.equal(code(() => rehydrateFoundation({ ...intake(root), writeVerified: true })), 'invalid-input');
  assert.equal(code(() => rehydrateFoundation({ ...intake(root), candidates: [] })), 'invalid-input');
  assert.equal(code(() => rehydrateFoundation({ ...intake(root), alignment: 'confirmed' })), 'invalid-input');
  assert.equal(code(() => rehydrateFoundation({ ...intake(root), content: 'bytes' })), 'invalid-input');
});

// --- Continuation encoding round trip (F8) ---------------------------------

test('the continuation line round-trips through arbitrary handoff prose', () => {
  const root = freshRepo();
  const { locator, revision } = seed(root);

  const line = renderContinuation({ locator, revision });
  assert.equal(line, `discovery-foundation: ${locator}@${revision}`);

  const handoff = [
    '## Artifacts and References',
    '',
    '- Some other reference: docs/notes.md',
    `- ${line}`,
    '- Trailing prose about the next cycle.',
  ].join('\n');

  const parsed = parseContinuation(handoff);
  assert.deepEqual(parsed, { locator, revision });

  const result = rehydrateFoundation(intake(root, { expected: parsed }));
  assert.equal(result.status, REHYDRATED);
  assert.equal(result.mode, MODES.compactedSession);
  assert.equal(result.foundation.locator, locator);
  assert.equal(result.foundation.revision, revision);
});

test('parseContinuation refuses zero and refuses to choose among many', () => {
  assert.equal(code(() => parseContinuation('no reference here at all')), 'invalid-input');
  const two = [
    'discovery-foundation: docs/agent/discovery/a.md@' + 'a'.repeat(64),
    'discovery-foundation: docs/agent/discovery/b.md@' + 'b'.repeat(64),
  ].join('\n');
  assert.equal(code(() => parseContinuation(two)), 'invalid-input');
});

test('renderContinuation refuses a non-digest revision or a spaced locator', () => {
  assert.equal(code(() => renderContinuation({ locator: 'docs/x.md', revision: 'short' })), 'invalid-input');
  assert.equal(code(() => renderContinuation({ locator: 'has space.md', revision: 'a'.repeat(64) })), 'invalid-input');
});

test('the command-line path prints a rehydrated result and rejects bad usage', () => {
  const root = freshRepo();
  seed(root);
  const intakePath = path.join(root, 'intake.json');
  fs.writeFileSync(intakePath, JSON.stringify(intake(root)));

  const out = [];
  const exit = run(['--input', intakePath], { stdout: { write: (s) => out.push(s) } });
  assert.equal(exit, 0);
  assert.equal(JSON.parse(out.join('')).status, REHYDRATED);

  assert.equal(code(() => run(['--input'], { stdout: { write() {} } })), 'usage');
});

// --- R1 / workspace confinement --------------------------------------------

test('R1: a traversing or out-of-bound continuation locator is invalid-input, not a recovery state', () => {
  const root = freshRepo();
  seed(root);
  for (const locator of [
    '../outside/discovery-rehydration.md',
    '/abs/discovery-rehydration.md',
    'docs/agent/discovery/../evil.md',
    'docs\\agent\\discovery\\x.md',
    'docs/agent/discovery/Bad Name.md',
    'other/dir/x.md',
    'docs/agent/discovery/a/b.md',
  ]) {
    assert.equal(
      code(() => rehydrateFoundation(intake(root, { expected: { locator, revision: 'a'.repeat(64) } }))),
      'invalid-input',
      locator,
    );
  }
});

test('R1: a continuation resolved through an ancestor symlink is unreadable, never followed', () => {
  const root = freshRepo();
  const realTree = path.join(root, 'real');
  fs.mkdirSync(realTree, { recursive: true });
  const { revision } = seed(realTree);
  // Redirect root/docs at a real tree via a symlinked ancestor component.
  fs.symlinkSync(path.join(realTree, 'docs'), path.join(root, 'docs'));
  const result = rehydrateFoundation(intake(root, { expected: { locator: LOCATOR, revision } }));
  // A symlinked component is bytes that cannot be safely recovered, not an
  // absent artifact, so the SF-1 split reports it as unreadable, not stale.
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /symbolic link/);
});

// --- R2: duplicate headings never silently replace durable evidence ---------

test('R2: a duplicate-heading artifact is unreadable on cold start, not silently accepted', () => {
  const root = freshRepo();
  seed(root);
  const dest = path.join(root, 'docs', 'agent', 'discovery', `${SLUG}.md`);
  const bytes = fs.readFileSync(dest, 'utf8');
  fs.writeFileSync(dest, `${bytes}\n## Open Questions\n\n- a ghost question\n`);
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.unreadable);
});

test('R2: a duplicate-heading artifact under a matching-revision continuation is unreadable, not accepted', () => {
  const root = freshRepo();
  seed(root);
  const dest = path.join(root, 'docs', 'agent', 'discovery', `${SLUG}.md`);
  const modified = `${fs.readFileSync(dest, 'utf8')}\n## Open Questions\n\n- a ghost question\n`;
  fs.writeFileSync(dest, modified);
  // Carry the modified file's own revision so the revision check passes and the
  // strict parse is what refuses. Bytes that exist but cannot be parsed are
  // unreadable under the SF-1 split, not stale.
  const result = rehydrateFoundation(intake(root, { expected: { locator: LOCATOR, revision: revisionOf(modified) } }));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /could not be parsed/);
});

// --- R7: an unreadable non-canonical candidate fails closed -----------------

test('R7: an unreadable non-canonical artifact makes rehydration unreadable, not missing', () => {
  const root = freshRepo();
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  fs.mkdirSync(dir, { recursive: true });
  // No foundation for this subject; a different, unparsable .md exists.
  fs.writeFileSync(path.join(dir, 'other.md'), '# Not a foundation\n\njust prose\n');
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /other\.md/);
});

// --- R8: continuation parsing matches only the anchored grammar -------------

test('R8: prose that merely mentions the prefix is not a continuation reference', () => {
  const decoy = `This is not-discovery-foundation: docs/agent/discovery/decoy.md@${'a'.repeat(64)}`;
  assert.equal(code(() => parseContinuation(decoy)), 'invalid-input');
  const quoted = `Example: "discovery-foundation: docs/agent/discovery/x.md@${'b'.repeat(64)}" appears in the docs.`;
  assert.equal(code(() => parseContinuation(quoted)), 'invalid-input');
});

// --- R10: revision-first diagnostic on malformed-plus-stale -----------------

test('R10: with unparsable bytes AND a mismatched revision, the revision diagnostic is selected', () => {
  const root = freshRepo();
  const { revision } = seed(root);
  const dest = path.join(root, 'docs', 'agent', 'discovery', `${SLUG}.md`);
  fs.writeFileSync(dest, 'garbage, not a foundation\n');
  const result = rehydrateFoundation(intake(root, { expected: { locator: LOCATOR, revision } }));
  assert.equal(result.status, RECOVERY.stale);
  assert.match(result.note, /revision no longer matches/);
});

// --- MF-1: cold start follows no ancestor symlink ---------------------------

test('MF-1: a symlinked docs ancestor makes cold start unreadable, never read', () => {
  const root = freshRepo();
  const realTree = path.join(root, 'real');
  fs.mkdirSync(realTree, { recursive: true });
  seed(realTree);
  fs.symlinkSync(path.join(realTree, 'docs'), path.join(root, 'docs'));
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /symbolic link/);
});

test('MF-1: a symlinked agent ancestor makes cold start unreadable, never read', () => {
  const root = freshRepo();
  const realTree = path.join(root, 'real');
  fs.mkdirSync(realTree, { recursive: true });
  seed(realTree);
  fs.mkdirSync(path.join(root, 'docs'));
  fs.symlinkSync(path.join(realTree, 'docs', 'agent'), path.join(root, 'docs', 'agent'));
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /symbolic link/);
});

// --- MF-2: an unreadable candidate fails closed even when a match exists -----

test('MF-2: one readable match plus one unreadable regular .md is unreadable, not rehydrated', () => {
  const root = freshRepo();
  seed(root);
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  // A second, regular .md that cannot be parsed. It could itself have declared
  // this subject, so the run must fail closed.
  fs.writeFileSync(path.join(dir, 'garbage.md'), 'not a foundation at all\n');
  const result = rehydrateFoundation(intake(root));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /garbage\.md/);
  assert.equal(result.confirmedFacts, undefined);
});

// --- MF-5: the continuation line survives CRLF ------------------------------

test('MF-5: the continuation line round-trips under both LF and CRLF', () => {
  const root = freshRepo();
  const { locator, revision } = seed(root);
  const line = renderContinuation({ locator, revision });
  const lf = ['## Artifacts and References', '', `- ${line}`, '- trailing prose'].join('\n');
  const crlf = lf.replace(/\n/g, '\r\n');

  assert.deepEqual(parseContinuation(lf), { locator, revision });
  assert.deepEqual(parseContinuation(crlf), { locator, revision });

  const result = rehydrateFoundation(intake(root, { expected: parseContinuation(crlf) }));
  assert.equal(result.status, REHYDRATED);
  assert.equal(result.mode, MODES.compactedSession);
});

// --- MF-7: a locator persistence cannot continue from is refused -------------

test('MF-7: a cold-start foundation whose basename disagrees with its slug is unreadable', () => {
  const root = freshRepo();
  seed(root, { subject: { id: 'issue-119', slug: 'canonical' } });
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  const bytes = fs.readFileSync(path.join(dir, 'canonical.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'moved.md'), bytes);
  fs.rmSync(path.join(dir, 'canonical.md'));
  const result = rehydrateFoundation(intake(root, { subject: { id: 'issue-119', slug: 'canonical' } }));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /moved\.md/);
  assert.match(result.readFailure, /disagrees|non-canonical/);
});

test('MF-7: a compacted continuation whose basename disagrees with its slug is unreadable', () => {
  const root = freshRepo();
  seed(root, { subject: { id: 'issue-119', slug: 'canonical' } });
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  const bytes = fs.readFileSync(path.join(dir, 'canonical.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'moved.md'), bytes);
  const revision = revisionOf(bytes);
  const result = rehydrateFoundation(intake(root, {
    subject: { id: 'issue-119', slug: 'canonical' },
    expected: { locator: 'docs/agent/discovery/moved.md', revision },
  }));
  assert.equal(result.status, RECOVERY.unreadable);
  assert.match(result.readFailure, /disagrees/);
});

// --- SF-1: the compacted recovery split ------------------------------------

test('SF-1: a compacted read error is unreadable (bytes cannot be recovered)', () => {
  const root = freshRepo();
  const { revision } = seed(root);
  const dest = path.join(root, 'docs', 'agent', 'discovery', `${SLUG}.md`);
  const io = {
    lstat: (p) => fs.lstatSync(p),
    readdir: (p) => fs.readdirSync(p),
    read: (p) => { if (p === dest) { const e = new Error('read denied'); e.code = 'EACCES'; throw e; } return fs.readFileSync(p, 'utf8'); },
  };
  const result = rehydrateFoundation(intake(root, { expected: { locator: LOCATOR, revision } }), { io });
  assert.equal(result.status, RECOVERY.unreadable);
});

test('SF-1: a compacted continuation for a different subject is stale (no longer this subject)', () => {
  const root = freshRepo();
  const { revision } = seed(root);
  // The bytes at LOCATOR really declare SUBJECT_ID/SLUG; ground a different
  // subject against them. Revision matches and the parse succeeds, so what
  // refuses is the subject identity — a stale continuation, not unreadable.
  const result = rehydrateFoundation(intake(root, {
    subject: { id: 'issue-999', slug: 'someone-else' },
    expected: { locator: LOCATOR, revision },
  }));
  assert.equal(result.status, RECOVERY.stale);
  assert.match(result.note, /belongs to subject/);
});
