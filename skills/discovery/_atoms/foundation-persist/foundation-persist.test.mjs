import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONFIRMED,
  DURABLE_SETS,
  FOUNDATION_FIELDS,
  FoundationPersistError,
  PERSISTABLE_ALIGNMENT,
  alignedFindingsDigestOf,
  alignedPayloadDigestOf,
  parseFoundation,
  persistFoundation,
  renderFoundation,
  revisionOf,
  run,
} from './foundation-persist.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.join(HERE, '..', '..', '..', '..', '.test-sandbox', 'foundation-persist');

let counter = 0;
function freshRepo() {
  counter += 1;
  const root = path.join(SANDBOX, `repo-${process.pid}-${counter}`);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function realIo() {
  return {
    lstat: (p) => fs.lstatSync(p),
    mkdir: (p) => fs.mkdirSync(p),
    read: (p) => fs.readFileSync(p, 'utf8'),
    write: (p, d) => fs.writeFileSync(p, d),
    rename: (from, to) => fs.renameSync(from, to),
    unlink: (p) => { try { fs.unlinkSync(p); } catch { /* best effort */ } },
  };
}

function destIn(root, slug = 'discovery-rehydration') {
  return path.join(root, 'docs', 'agent', 'discovery', `${slug}.md`);
}

// The revision currently on disk for a subject, or null when none exists. An
// honest caller passes this as expectedPriorRevision: null for a genuine first
// cycle, or the rehydrated revision for a later one.
function currentRevision(root, slug = 'discovery-rehydration') {
  try {
    return revisionOf(fs.readFileSync(destIn(root, slug), 'utf8'));
  } catch {
    return null;
  }
}

// Build an intake and bind its aligned payload digest, exactly as an honest
// caller would after showing the human the aligned payload. expectedPriorRevision
// defaults to whatever revision is currently on disk for the subject.
function intake(overrides = {}) {
  const payload = {
    version: 1,
    repositoryRoot: '/repo',
    subject: { id: 'issue-119', slug: 'discovery-rehydration' },
    alignment: 'verified',
    cycle: 'c-0001',
    timestamp: '2026-08-29T01:00:00Z',
    confirmedFacts: ['Discovery rereads its own handoff today.'],
    evidenceReferences: ['docs/agent/discovery/discovery-rehydration.md'],
    decisions: ['Persist a durable foundation.'],
    constraints: ['Never overwrite durable evidence.'],
    assumptions: ['One subject per foundation.'],
    contradictions: [],
    openQuestions: ['How is staleness reported?'],
    scope: ['Discovery re-entry.'],
    exclusions: ['Specification.'],
    frontier: ['needs-more-evidence: read discovery-source'],
    nextAction: 'Read the discovery-source contract.',
    resolved: [],
    ...overrides,
  };
  const expectedPriorRevision = 'expectedPriorRevision' in overrides
    ? overrides.expectedPriorRevision
    : currentRevision(payload.repositoryRoot, payload.subject.slug);
  return { ...payload, expectedPriorRevision, alignedPayloadDigest: alignedPayloadDigestOf(payload) };
}

function derivationIntake(overrides = {}) {
  const payload = intake(overrides);
  delete payload.alignedPayloadDigest;
  const alignedFindingsDigest = alignedFindingsDigestOf(payload);
  return {
    ...payload,
    alignedFindingsDigest,
    domainModelBasisDigest: alignedFindingsDigest,
    frontierBasisDigest: alignedFindingsDigest,
  };
}

function code(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof FoundationPersistError) return error.code;
    throw error;
  }
}

test.after(() => {
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

test('render and parse are exact inverses for the documents the renderer produces', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  const parsed = parseFoundation(bytes);
  assert.equal(renderFoundation(parsed), bytes);
});

test('schema 1 foundations written before domain modeling remain readable', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const current = fs.readFileSync(destIn(root), 'utf8');
  const legacy = [
    'Source Claims',
    'Relationship Claims',
    'Boundary Claims',
    'Risks',
    'Domain Model',
  ].reduce(
    (bytes, title) => bytes.replace(new RegExp(`\\n## ${title}\\n\\n_None recorded\\._\\n`), ''),
    current.replace('- Schema: 2', '- Schema: 1'),
  );
  const parsed = parseFoundation(legacy);
  assert.deepEqual(parsed.domainModel, []);
  assert.deepEqual(parsed.sourceClaims, []);
  assert.deepEqual(parsed.relationshipClaims, []);
  assert.deepEqual(parsed.boundaryClaims, []);
  assert.deepEqual(parsed.risks, []);
  assert.deepEqual(parsed.confirmedFacts, ['Discovery rereads its own handoff today.']);
});

test('schema 2 refuses deletion of any aligned-claims or domain-model section', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const current = fs.readFileSync(destIn(root), 'utf8');
  for (const title of [
    'Source Claims',
    'Relationship Claims',
    'Boundary Claims',
    'Risks',
    'Domain Model',
  ]) {
    const missing = current.replace(new RegExp(`\\n## ${title}\\n\\n_None recorded\\._\\n`), '');
    assert.equal(code(() => parseFoundation(missing)), 'invalid-input', title);
  }
});

test('CRLF input is normalized on read, so render(parse(crlf)) is not the crlf bytes', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const lf = fs.readFileSync(destIn(root), 'utf8');
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.notEqual(renderFoundation(parseFoundation(crlf)), crlf);
  assert.equal(renderFoundation(parseFoundation(crlf)), lf);
});

test('revisionOf is the SHA-256 of the exact bytes', () => {
  assert.match(revisionOf('x'), /^[a-f0-9]{64}$/);
  assert.equal(revisionOf('same'), revisionOf('same'));
  assert.notEqual(revisionOf('a'), revisionOf('b'));
});

test('a persisted foundation records alignment, schema, and every distinct field', () => {
  const root = freshRepo();
  const result = persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  assert.equal(result.status, 'persisted');
  assert.equal(result.locator, 'docs/agent/discovery/discovery-rehydration.md');
  assert.match(result.revision, /^[a-f0-9]{64}$/);
  assert.equal(result.alignment, CONFIRMED);

  const bytes = fs.readFileSync(destIn(root), 'utf8');
  assert.match(bytes, /^- Schema: 2$/m);
  const parsed = parseFoundation(bytes);
  assert.equal(parsed.alignment, CONFIRMED);
  for (const field of FOUNDATION_FIELDS) {
    assert.ok(parsed[field] !== undefined, `parsed foundation must carry ${field}`);
  }
  assert.deepEqual(parsed.confirmedFacts, ['Discovery rereads its own handoff today.']);
});

test('only verified or corrected alignment persists, always recorded as confirmed', () => {
  for (const alignment of PERSISTABLE_ALIGNMENT) {
    const root = freshRepo();
    const result = persistFoundation(intake({ repositoryRoot: root, alignment }), { io: realIo() });
    assert.equal(result.alignment, CONFIRMED);
    assert.equal(parseFoundation(fs.readFileSync(destIn(root), 'utf8')).history.at(-1).alignment, alignment);
  }
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), alignment: 'offered' }), { io: realIo() })), 'unaligned');
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), alignment: 'not-aligned' }), { io: realIo() })), 'unaligned');
});

test('the aligned payload digest is a binding, not a token', () => {
  // A caller cannot hand in aligned bytes that differ from the digest it showed
  // the human: mutating a field without recomputing the digest is alignment-unbound.
  const base = intake({ repositoryRoot: freshRepo() });
  const forged = { ...base, confirmedFacts: ['A fact the human never saw.'] };
  assert.equal(code(() => persistFoundation(forged, { io: realIo() })), 'alignment-unbound');

  // A missing or malformed digest is refused as invalid input.
  const noDigest = intake({ repositoryRoot: freshRepo() });
  delete noDigest.alignedPayloadDigest;
  assert.equal(code(() => persistFoundation(noDigest, { io: realIo() })), 'invalid-input');

  // The digest is independent of JSON key order in the payload.
  const a = alignedPayloadDigestOf({ subject: { id: 'x', slug: 'y' }, confirmedFacts: ['f'], evidenceReferences: [], decisions: [], constraints: [], assumptions: [], contradictions: [], openQuestions: [], scope: [], exclusions: [], frontier: [], nextAction: 'go', resolved: [] });
  const b = alignedPayloadDigestOf({ resolved: [], nextAction: 'go', frontier: [], exclusions: [], scope: [], openQuestions: [], contradictions: [], assumptions: [], constraints: [], decisions: [], evidenceReferences: [], confirmedFacts: ['f'], subject: { slug: 'y', id: 'x' } });
  assert.equal(a, b);
});

test('every documented-findings field changes the aligned findings digest', () => {
  const base = intake();
  const first = alignedFindingsDigestOf(base);
  for (const field of ['sourceClaims', 'relationshipClaims', 'boundaryClaims', 'risks']) {
    const changed = alignedFindingsDigestOf({ ...base, [field]: [`changed-${field}`] });
    assert.notEqual(changed, first, `${field} must participate in the alignment binding`);
  }
});

test('post-alignment domain and frontier derivations bind to the aligned findings', () => {
  const root = freshRepo();
  const payload = {
    ...intake({ repositoryRoot: root }),
    domainModel: [
      'actor: operator',
      'system: Discovery',
      'relationship: operator aligns documented findings',
      'boundary: Discovery retains persistence authority',
    ],
    frontier: ['ready: specification'],
    nextAction: 'Hand the reread compact handoff to specification.',
  };
  delete payload.alignedPayloadDigest;
  const alignedFindingsDigest = alignedFindingsDigestOf(payload);
  const derived = {
    ...payload,
    alignedFindingsDigest,
    domainModelBasisDigest: alignedFindingsDigest,
    frontierBasisDigest: alignedFindingsDigest,
  };

  persistFoundation(derived, { io: realIo() });
  const parsed = parseFoundation(fs.readFileSync(destIn(root), 'utf8'));
  assert.deepEqual(parsed.domainModel, payload.domainModel);
  assert.deepEqual(parsed.frontier, payload.frontier);
  assert.equal(parsed.nextAction, payload.nextAction);

  assert.equal(
    code(() => persistFoundation({
      ...derived,
      repositoryRoot: freshRepo(),
      domainModelBasisDigest: '0'.repeat(64),
    }, { io: realIo() })),
    'derivation-unbound',
  );

  const legacyBypass = {
    ...intake({ repositoryRoot: freshRepo() }),
    domainModel: ['actor: operator'],
  };
  assert.equal(
    code(() => persistFoundation(legacyBypass, { io: realIo() })),
    'derivation-unbound',
  );
});

test('persisting a different subject over an existing foundation is refused', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  // Same slug (same destination), different subject id.
  const mismatch = code(() => persistFoundation(intake({
    repositoryRoot: root,
    subject: { id: 'issue-999', slug: 'discovery-rehydration' },
    cycle: 'c-0002',
    timestamp: '2026-08-29T02:00:00Z',
  }), { io: realIo() }));
  assert.equal(mismatch, 'subject-mismatch');
});

test('a destination outside docs/agent/discovery/ is refused', () => {
  for (const slug of ['../evil', 'a/b', 'UPPER', '-leading', 'trailing-', 'a..b', '/abs']) {
    assert.equal(
      code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), subject: { id: 'x', slug } }), { io: realIo() })),
      'unsafe-destination',
      slug,
    );
  }
});

test('repositoryRoot must be an absolute path', () => {
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: 'relative/root' }), { io: realIo() })), 'invalid-input');
});

test('a non-canonical UTC timestamp is refused', () => {
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), timestamp: 'August 29, 2026 01:00:00' }), { io: realIo() })), 'invalid-input');
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), timestamp: '2026-08-29 01:00:00' }), { io: realIo() })), 'invalid-input');
  // A canonical RFC 3339 UTC timestamp with milliseconds is accepted.
  const ok = persistFoundation(intake({ repositoryRoot: freshRepo(), timestamp: '2026-08-29T01:00:00.250Z' }), { io: realIo() });
  assert.equal(ok.status, 'persisted');
});

test('unknown, missing, and wrong-version intake fields are refused', () => {
  assert.equal(code(() => persistFoundation({ ...intake(), surprise: 1 }, { io: realIo() })), 'invalid-input');
  const partial = intake();
  delete partial.confirmedFacts;
  assert.equal(code(() => persistFoundation(partial, { io: realIo() })), 'invalid-input');
  assert.equal(code(() => persistFoundation(intake({ version: 2 }), { io: realIo() })), 'invalid-input');
});

test('a nextAction or resolution that opens a Markdown heading is refused', () => {
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), nextAction: '## History' }), { io: realIo() })), 'invalid-input');
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), nextAction: '# top' }), { io: realIo() })), 'invalid-input');
  const withHeadingResolution = intake({
    repositoryRoot: freshRepo(),
    openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'How is staleness reported?', resolution: '### injected' }],
  });
  assert.equal(code(() => persistFoundation(withHeadingResolution, { io: realIo() })), 'invalid-input');
});

test('an unknown schema on parse is refused with a named code', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  const bumped = bytes.replace('- Schema: 2', '- Schema: 999');
  assert.equal(code(() => parseFoundation(bumped)), 'unsupported-schema');
  const removed = bytes.replace('- Schema: 2\n', '');
  assert.equal(code(() => parseFoundation(removed)), 'unsupported-schema');
});

// --- Retention: per field, multiset, frontier-inclusive, resolution-immutable

test('retention refuses dropping a previously recorded durable entry', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const drop = code(() => persistFoundation(intake({
    repositoryRoot: root,
    cycle: 'c-0002',
    timestamp: '2026-08-29T02:00:00Z',
    confirmedFacts: [],
  }), { io: realIo() }));
  assert.equal(drop, 'foundation-regression');
});

test('an entry moved to Resolved is retained, not dropped', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const result = persistFoundation(intake({
    repositoryRoot: root,
    cycle: 'c-0002',
    timestamp: '2026-08-29T02:00:00Z',
    openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'How is staleness reported?', resolution: 'discovery-source reports both revisions.' }],
  }), { io: realIo() });
  assert.equal(result.status, 'persisted');
  const parsed = parseFoundation(fs.readFileSync(destIn(root), 'utf8'));
  assert.deepEqual(parsed.openQuestions, []);
  assert.equal(parsed.resolved[0].entry, 'How is staleness reported?');
});

test('every durable set participates in retention', () => {
  for (const field of DURABLE_SETS) {
    const root = freshRepo();
    const makeIntake = field === 'domainModel' ? derivationIntake : intake;
    persistFoundation(makeIntake({ repositoryRoot: root, [field]: [`entry-for-${field}`] }), { io: realIo() });
    const dropped = code(() => persistFoundation(makeIntake({
      repositoryRoot: root,
      cycle: 'c-0002',
      timestamp: '2026-08-29T02:00:00Z',
      [field]: [],
    }), { io: realIo() }));
    assert.equal(dropped, 'foundation-regression', `${field} must be retained`);
  }
});

test('an unresolved frontier entry must survive a write', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root, frontier: ['blocked: needs owner'] }), { io: realIo() });
  const dropped = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z', frontier: ['ready'],
  }), { io: realIo() }));
  assert.equal(dropped, 'foundation-regression');
  // Resolving the frontier entry retains it.
  const ok = persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    frontier: ['ready'],
    resolved: [{ field: 'frontier', entry: 'blocked: needs owner', resolution: 'owner assigned.' }],
  }), { io: realIo() });
  assert.equal(ok.status, 'persisted');
});

test('moving an entry to a different section is not retention', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root, confirmedFacts: ['Fact A.'], openQuestions: ['Q1?'] }), { io: realIo() });
  const moved = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    confirmedFacts: [], openQuestions: ['Q1?', 'Fact A.'],
  }), { io: realIo() }));
  assert.equal(moved, 'foundation-regression');
});

test('losing one of two duplicate entries is a regression', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root, confirmedFacts: ['Dup.', 'Dup.'] }), { io: realIo() });
  const dropped = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z', confirmedFacts: ['Dup.'],
  }), { io: realIo() }));
  assert.equal(dropped, 'foundation-regression');
});

test('rewriting a prior Resolved resolution is a regression', () => {
  const root = freshRepo();
  persistFoundation(intake({
    repositoryRoot: root, openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'How is staleness reported?', resolution: 'first resolution.' }],
  }), { io: realIo() });
  const rewritten = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z', openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'How is staleness reported?', resolution: 'a different resolution.' }],
  }), { io: realIo() }));
  assert.equal(rewritten, 'foundation-regression');
});

test('history is append-only and accumulates one entry per aligned cycle', () => {
  const root = freshRepo();
  const r1 = persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  assert.equal(r1.priorRevision, null);
  assert.equal(r1.historyLength, 1);

  const firstBytes = fs.readFileSync(destIn(root), 'utf8');
  const firstRevision = revisionOf(firstBytes);
  const firstHistoryLine = parseFoundation(firstBytes).history[0];

  const r2 = persistFoundation(intake({ repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z', alignment: 'corrected' }), { io: realIo() });
  assert.equal(r2.priorRevision, firstRevision);
  assert.equal(r2.historyLength, 2);

  const history = parseFoundation(fs.readFileSync(destIn(root), 'utf8')).history;
  assert.equal(history.length, 2);
  assert.deepEqual(history[0], firstHistoryLine);
  assert.equal(history[1].priorRevision, firstRevision);
  assert.equal(history[1].alignment, 'corrected');
});

test('the post-write reread is write verification and is named as not rehydration evidence', () => {
  const result = persistFoundation(intake({ repositoryRoot: freshRepo() }), { io: realIo() });
  assert.equal(result.writeVerified, true);
  assert.match(result.writeVerificationNote, /not evidence that a later run rehydrated/);
});

// --- Atomicity, structural verification, concurrency, symlinks -------------

test('a staged reread that does not match is verification-failed and leaves nothing behind', () => {
  const root = freshRepo();
  const base = realIo();
  const io = {
    ...base,
    // The staged temporary file rereads as tampered, so the structural check fails.
    read: (p) => (p.endsWith('.tmp') ? `${base.read(p)}tampered` : base.read(p)),
  };
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: root }), { io })), 'verification-failed');
  // No destination was created and no staged file was left behind.
  assert.ok(!fs.existsSync(destIn(root)));
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a failed verification leaves an existing foundation byte-for-byte intact', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const original = fs.readFileSync(destIn(root), 'utf8');

  const base = realIo();
  const io = { ...base, read: (p) => (p.endsWith('.tmp') ? `${base.read(p)}x` : base.read(p)) };
  const failed = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    decisions: ['Persist a durable foundation.', 'A second decision.'],
  }), { io }));
  assert.equal(failed, 'verification-failed');
  assert.equal(fs.readFileSync(destIn(root), 'utf8'), original);
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  assert.deepEqual(fs.readdirSync(dir), ['discovery-rehydration.md']);
});

test('structural post-write verification re-parses the staged bytes', () => {
  const root = freshRepo();
  const base = realIo();
  // The staged file is structurally corrupted on reread — still bytes, but not
  // the intended foundation — which the re-parse must catch.
  const io = {
    ...base,
    read: (p) => (p.endsWith('.tmp') ? base.read(p).replace('# Discovery Foundation', '# Not A Foundation') : base.read(p)),
  };
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: root }), { io })), 'verification-failed');
});

test('a write failure surfaces as write-failed and reports no success', () => {
  const base = realIo();
  const io = { ...base, write: () => { throw new Error('disk full'); } };
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo() }), { io })), 'write-failed');
});

test('a destination that moved since this write began is refused as concurrent-modification', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const dest = destIn(root);

  const base = realIo();
  let destReads = 0;
  const io = {
    ...base,
    read: (p) => {
      if (p === dest) {
        destReads += 1;
        // The compare-and-swap reread (the second destination read) sees bytes a
        // concurrent writer landed, so the revision no longer matches.
        if (destReads >= 2) return `${base.read(p)}\n<!-- concurrent writer -->\n`;
      }
      return base.read(p);
    },
  };
  const refused = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
  }), { io }));
  assert.equal(refused, 'concurrent-modification');
});

test('a symbolic link anywhere in the bounded path is refused', () => {
  // A symlinked discovery directory.
  const root1 = freshRepo();
  fs.mkdirSync(path.join(root1, 'docs', 'agent'), { recursive: true });
  const elsewhere = path.join(root1, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(root1, 'docs', 'agent', 'discovery'));
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: root1 }), { io: realIo() })), 'unsafe-destination');

  // A symlinked destination file.
  const root2 = freshRepo();
  const dir = path.join(root2, 'docs', 'agent', 'discovery');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(root2, 'target.md');
  fs.writeFileSync(target, 'x');
  fs.symlinkSync(target, path.join(dir, 'discovery-rehydration.md'));
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: root2 }), { io: realIo() })), 'unsafe-destination');
});

test('the command-line path writes the artifact to a real repository root', () => {
  const root = freshRepo();
  const intakePath = path.join(root, 'intake.json');
  fs.writeFileSync(intakePath, JSON.stringify(intake({ repositoryRoot: root })));

  const out = [];
  const exit = run(['--input', intakePath], { stdout: { write: (s) => out.push(s) } });
  assert.equal(exit, 0);

  const printed = JSON.parse(out.join(''));
  assert.equal(printed.status, 'persisted');
  const written = fs.readFileSync(destIn(root), 'utf8');
  assert.equal(revisionOf(written), printed.revision);
  assert.equal(parseFoundation(written).alignment, CONFIRMED);
});

test('the command-line path rejects bad usage', () => {
  assert.equal(code(() => run(['--input'], { stdout: { write() {} } })), 'usage');
  assert.equal(code(() => run(['--input', 'relative.json'], { stdout: { write() {} } })), 'usage');
});

// --- R2: duplicate headings and metadata are refused on parse -------------

test('R2: a duplicate section heading is refused rather than silently replacing evidence', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  // Append a second Confirmed Facts section whose list would shadow the first.
  const dupe = `${bytes}\n## Confirmed Facts\n\n- A ghost fact.\n`;
  assert.equal(code(() => parseFoundation(dupe)), 'invalid-input');
});

test('R2: a duplicated metadata line and an unknown section are refused on parse', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  const dupSubject = bytes.replace('- Subject: issue-119', '- Subject: issue-119\n- Subject: issue-999');
  assert.equal(code(() => parseFoundation(dupSubject)), 'invalid-input');
  const unknownSection = `${bytes}\n## Surprise\n\n- unexpected\n`;
  assert.equal(code(() => parseFoundation(unknownSection)), 'invalid-input');
});

// --- R3: a fault injected AFTER the rename is post-commit, not verification ---

test('R3: a fault after the rename is post-commit-verification-failed, and the destination is replaced', () => {
  const root = freshRepo();
  const base = realIo();
  let committed = false;
  const dest = destIn(root);
  const io = {
    ...base,
    rename: (from, to) => { base.rename(from, to); committed = true; },
    read: (p) => (committed && p === dest ? `${base.read(p)}\n<!-- tamper -->\n` : base.read(p)),
  };
  let thrown = null;
  try {
    persistFoundation(intake({ repositoryRoot: root }), { io });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof FoundationPersistError);
  assert.equal(thrown.code, 'post-commit-verification-failed');
  assert.match(thrown.message, /already replaced/);
  assert.ok(fs.existsSync(dest), 'the rename committed, so the destination exists');
});

// --- R4: persistence is bound to the revision the cycle rehydrated ----------

test('R4: a stale cycle that rehydrated an older revision is refused, never recorded as succeeding a newer one', () => {
  const root = freshRepo();
  const r1 = persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  // Cycle B advances to R2, correctly succeeding R1.
  const r2 = persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: r1.revision,
  }), { io: realIo() });
  assert.equal(r2.priorRevision, r1.revision);
  // Stale cycle A still thinks R1 is current and tries to write over R2.
  const stale = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0003', timestamp: '2026-08-29T03:00:00Z',
    expectedPriorRevision: r1.revision,
  }), { io: realIo() }));
  assert.equal(stale, 'concurrent-modification');
});

test('R4: a first-cycle claim over an existing foundation is refused', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const refused = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: null,
  }), { io: realIo() }));
  assert.equal(refused, 'concurrent-modification');
});

test('R4: expecting a revision when none exists is refused', () => {
  const refused = code(() => persistFoundation(intake({
    repositoryRoot: freshRepo(), expectedPriorRevision: 'a'.repeat(64),
  }), { io: realIo() }));
  assert.equal(refused, 'concurrent-modification');
});

// --- R6: field-qualified, count-aware resolution ---------------------------

test('R6: a resolution discharges one occurrence only in its named field', () => {
  const root = freshRepo();
  // Same text lives in two fields.
  const r1 = persistFoundation(intake({
    repositoryRoot: root, confirmedFacts: ['Shared text.'], openQuestions: ['Shared text.'],
  }), { io: realIo() });
  // Resolving it in openQuestions must NOT discharge the confirmedFacts copy.
  const leak = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: r1.revision,
    confirmedFacts: [], openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'Shared text.', resolution: 'answered.' }],
  }), { io: realIo() }));
  assert.equal(leak, 'foundation-regression');

  // Resolving it in the correct field discharges only that field's occurrence.
  const ok = persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: r1.revision,
    confirmedFacts: ['Shared text.'], openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'Shared text.', resolution: 'answered.' }],
  }), { io: realIo() });
  assert.equal(ok.status, 'persisted');
  const parsed = parseFoundation(fs.readFileSync(destIn(root), 'utf8'));
  assert.deepEqual(parsed.resolved[0], { field: 'openQuestions', entry: 'Shared text.', resolution: 'answered.' });
});

test('R6: discharging two duplicate occurrences requires two resolution records', () => {
  const root = freshRepo();
  const r1 = persistFoundation(intake({
    repositoryRoot: root, openQuestions: ['Dup.', 'Dup.'],
  }), { io: realIo() });
  // One record cannot discharge both duplicate drops.
  const one = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: r1.revision,
    openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'Dup.', resolution: 'done.' }],
  }), { io: realIo() }));
  assert.equal(one, 'foundation-regression');
  // Two byte-identical records discharge both.
  const two = persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: r1.revision,
    openQuestions: [],
    resolved: [
      { field: 'openQuestions', entry: 'Dup.', resolution: 'done.' },
      { field: 'openQuestions', entry: 'Dup.', resolution: 'done.' },
    ],
  }), { io: realIo() });
  assert.equal(two.status, 'persisted');
});

test('R6: prior resolved records are preserved as a multiset, and a conflicting resolution is refused', () => {
  const root = freshRepo();
  const r1 = persistFoundation(intake({
    repositoryRoot: root, openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'Q.', resolution: 'first.' }],
  }), { io: realIo() });
  // Dropping the prior resolved record is a regression.
  const dropped = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: r1.revision, openQuestions: [], resolved: [],
  }), { io: realIo() }));
  assert.equal(dropped, 'foundation-regression');
  // A second, conflicting resolution for the same (field, entry) is refused.
  const conflict = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: r1.revision, openQuestions: [],
    resolved: [
      { field: 'openQuestions', entry: 'Q.', resolution: 'first.' },
      { field: 'openQuestions', entry: 'Q.', resolution: 'second.' },
    ],
  }), { io: realIo() }));
  assert.equal(conflict, 'foundation-regression');
});

test('R6: a resolution naming an unknown field is refused, and the field round-trips', () => {
  assert.equal(code(() => persistFoundation(intake({
    repositoryRoot: freshRepo(), openQuestions: [],
    resolved: [{ field: 'notAField', entry: 'Q.', resolution: 'x.' }],
  }), { io: realIo() })), 'invalid-input');

  const root = freshRepo();
  persistFoundation(intake({
    repositoryRoot: root, openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'Q.', resolution: 'answered.' }],
  }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  assert.match(bytes, /^- openQuestions: Q\. — answered\.$/m);
  assert.deepEqual(parseFoundation(bytes).resolved[0], { field: 'openQuestions', entry: 'Q.', resolution: 'answered.' });
});

// --- R9: the timestamp validator rejects impossible instants ----------------

test('R9: an impossible calendar or clock value is refused even when the shape is right', () => {
  for (const timestamp of [
    '2026-99-09T01:00:00Z', // month
    '2026-02-30T01:00:00Z', // day
    '2026-08-29T25:00:00Z', // hour
    '2026-08-29T01:99:00Z', // minute
    '2026-08-29T01:00:99Z', // second
    '2027-02-29T01:00:00Z', // non-leap-year 29 February
  ]) {
    assert.equal(
      code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), timestamp }), { io: realIo() })),
      'invalid-input',
      timestamp,
    );
  }
  // A leap-year 29 February is accepted.
  const ok = persistFoundation(intake({ repositoryRoot: freshRepo(), timestamp: '2028-02-29T01:00:00Z' }), { io: realIo() });
  assert.equal(ok.status, 'persisted');
});

// --- MF-3: the parser is strict and canonical -------------------------------

test('MF-3: a metadata line moved into a section no longer parses as the header', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  // Move the metadata lines out of the header and into Confirmed Facts, as list
  // items. The positional header parse must refuse rather than recover subject.
  const laundered = bytes
    .replace('- Schema: 2\n- Subject: issue-119\n- Slug: discovery-rehydration\n- Alignment: confirmed\n', '- Schema: 2\n')
    .replace('## Confirmed Facts\n\n- Discovery rereads its own handoff today.',
      '## Confirmed Facts\n\n- Subject: issue-119\n- Slug: discovery-rehydration\n- Alignment: confirmed\n- Discovery rereads its own handoff today.');
  assert.equal(code(() => parseFoundation(laundered)), 'invalid-input');
});

test('MF-3: a non-canonical ATX heading at any level is refused on parse', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  // A rogue heading smuggled under Next Action, at a level the section grammar
  // does not use.
  const withRogue = bytes.replace('## Next Action\n\nRead the discovery-source contract.',
    '## Next Action\n\n### Surprise Heading\nRead the discovery-source contract.');
  assert.equal(code(() => parseFoundation(withRogue)), 'invalid-input');
  // A stray H1 elsewhere is also refused.
  const withH1 = `${bytes}\n# Another Document\n`;
  assert.equal(code(() => parseFoundation(withH1)), 'invalid-input');
});

test('MF-3: a legitimate list entry that merely looks like metadata round-trips', () => {
  const root = freshRepo();
  const result = persistFoundation(intake({
    repositoryRoot: root,
    confirmedFacts: ['Subject: a source topic', 'Slug: not-a-slug-line'],
  }), { io: realIo() });
  assert.equal(result.status, 'persisted');
  const parsed = parseFoundation(fs.readFileSync(destIn(root), 'utf8'));
  assert.deepEqual(parsed.confirmedFacts, ['Subject: a source topic', 'Slug: not-a-slug-line']);
  assert.equal(parsed.subject.id, 'issue-119');
  assert.equal(parsed.subject.slug, 'discovery-rehydration');
});

test('MF-3: a parsed history record is validated with the write-path validators', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  const history = '- c-0001 | 2026-08-29T01:00:00Z | verified | succeeds none';
  // Impossible timestamp in a history line.
  assert.equal(code(() => parseFoundation(bytes.replace(history, '- c-0001 | 2026-02-30T25:99:99Z | verified | succeeds none'))), 'invalid-input');
  // A non-persistable alignment in history.
  assert.equal(code(() => parseFoundation(bytes.replace(history, '- c-0001 | 2026-08-29T01:00:00Z | offered | succeeds none'))), 'invalid-input');
  // A malformed prior revision in history.
  assert.equal(code(() => parseFoundation(bytes.replace(history, '- c-0001 | 2026-08-29T01:00:00Z | verified | succeeds deadbeef'))), 'invalid-input');
});

// --- MF-4: any legal durable entry can be resolved --------------------------

test('MF-4: an entry with delimiter and sentinel characters survives persist -> parse -> resolve', () => {
  const tricky = [
    'Question with `code`?',
    'entry | with a pipe',
    'entry: with a colon',
    'entry — with an em dash',
    '- leading dash entry',
    '_None recorded._',
  ];
  const root = freshRepo();
  // Persist all tricky entries as open questions.
  const r1 = persistFoundation(intake({ repositoryRoot: root, openQuestions: tricky }), { io: realIo() });
  const parsed1 = parseFoundation(fs.readFileSync(destIn(root), 'utf8'));
  assert.deepEqual(parsed1.openQuestions, tricky);

  // Resolve every one of them in a single write, each with a resolution that
  // also contains delimiter and sentinel characters.
  const resolved = tricky.map((entry) => ({
    field: 'openQuestions',
    entry,
    resolution: `resolved | with: every — char and _None recorded._ for ${entry}`,
  }));
  const r2 = persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: r1.revision,
    openQuestions: [],
    resolved,
  }), { io: realIo() });
  assert.equal(r2.status, 'persisted');
  const parsed2 = parseFoundation(fs.readFileSync(destIn(root), 'utf8'));
  assert.deepEqual(parsed2.openQuestions, []);
  assert.deepEqual(parsed2.resolved, resolved);
});

test('MF-4: a backslash in an entry or resolution round-trips through the escape', () => {
  const root = freshRepo();
  const entry = 'a\\b and \\| and \\— literal escapes';
  const r1 = persistFoundation(intake({ repositoryRoot: root, openQuestions: [entry] }), { io: realIo() });
  const r2 = persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z',
    expectedPriorRevision: r1.revision,
    openQuestions: [],
    resolved: [{ field: 'openQuestions', entry, resolution: 'done with a \\ trailing backslash\\' }],
  }), { io: realIo() });
  assert.equal(r2.status, 'persisted');
  const parsed = parseFoundation(fs.readFileSync(destIn(root), 'utf8'));
  assert.deepEqual(parsed.resolved[0], { field: 'openQuestions', entry, resolution: 'done with a \\ trailing backslash\\' });
});

test('MF-4: noncanonical Resolved escapes are refused instead of laundered', () => {
  const root = freshRepo();
  persistFoundation(intake({
    repositoryRoot: root,
    openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'Q.', resolution: 'answered.' }],
  }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  const canonical = '- openQuestions: Q. — answered.';

  for (const hostile of [
    '- openQuestions: \\q. — answered.',
    '- openQuestions: \\|. — answered.',
    '- openQuestions: Q. — answered.\\',
  ]) {
    assert.equal(code(() => parseFoundation(bytes.replace(canonical, hostile))), 'invalid-input', hostile);
  }
});

test('an empty Resolved section is refused instead of laundering all prior resolutions', () => {
  const root = freshRepo();
  persistFoundation(intake({
    repositoryRoot: root,
    openQuestions: [],
    resolved: [{ field: 'openQuestions', entry: 'Q.', resolution: 'answered.' }],
  }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  const emptyResolved = bytes.replace('- openQuestions: Q. — answered.\n', '');

  assert.equal(code(() => parseFoundation(emptyResolved)), 'invalid-input');
});

// --- MF-6: control characters are refused everywhere ------------------------

test('MF-6: a control character in any persisted string is refused as invalid-input', () => {
  const root = freshRepo();
  // NUL in a durable entry.
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: root, confirmedFacts: ['left\u0000right'] }), { io: realIo() })), 'invalid-input');
  // NUL in nextAction, a resolution, the frontier, the subject id, and the cycle.
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), nextAction: 'go\u0000stop' }), { io: realIo() })), 'invalid-input');
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), openQuestions: [], resolved: [{ field: 'openQuestions', entry: 'q', resolution: 'a\u0000b' }] }), { io: realIo() })), 'invalid-input');
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), frontier: ['ready\u0007bell'] }), { io: realIo() })), 'invalid-input');
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), subject: { id: 'issue\u0000119', slug: 'discovery-rehydration' } }), { io: realIo() })), 'invalid-input');
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: freshRepo(), cycle: 'c-\u007f0001' }), { io: realIo() })), 'invalid-input');
});

test('MF-6: a control character is refused on parse too, and cannot collide two records on a key', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const bytes = fs.readFileSync(destIn(root), 'utf8');
  // A NUL smuggled into a rendered durable entry is refused when read back.
  const tampered = bytes.replace('- Discovery rereads its own handoff today.', '- Discovery rereads\u0000its own handoff today.');
  assert.equal(code(() => parseFoundation(tampered)), 'invalid-input');
});

// --- MF-8: cleanup failures never mask the primary failure ------------------

test('MF-8: a cleanup failure keeps the primary code and names the staged file, never a raw error', () => {
  const root = freshRepo();
  const base = realIo();
  // The staged write fails (primary: write-failed) AND unlink throws a raw
  // error during cleanup. The primary code must survive and the message must
  // name the staged file left behind.
  const io = {
    ...base,
    write: () => { const e = new Error('disk full'); e.code = 'ENOSPC'; throw e; },
    unlink: () => { const e = new Error('unlink denied'); e.code = 'EACCES'; throw e; },
  };
  let thrown = null;
  try {
    persistFoundation(intake({ repositoryRoot: root }), { io });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof FoundationPersistError);
  assert.equal(thrown.code, 'write-failed');
  assert.match(thrown.message, /could not be removed/);
  assert.match(thrown.message, /\.tmp/);
});

test('MF-8: a rename failure is write-failed and cleans up the staged file', () => {
  const root = freshRepo();
  const base = realIo();
  const io = { ...base, rename: () => { const e = new Error('rename denied'); e.code = 'EACCES'; throw e; } };
  assert.equal(code(() => persistFoundation(intake({ repositoryRoot: root }), { io })), 'write-failed');
  // With a cooperative unlink, nothing is left behind.
  const dir = path.join(root, 'docs', 'agent', 'discovery');
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});

// --- MF-9: a revision refusal mutates nothing on disk -----------------------

test('MF-9: a stale revision refusal creates no directory', () => {
  const root = freshRepo();
  // A non-null expected revision with no artifact must refuse without creating
  // docs/agent/discovery.
  const refused = code(() => persistFoundation(intake({
    repositoryRoot: root, expectedPriorRevision: 'a'.repeat(64),
  }), { io: realIo() }));
  assert.equal(refused, 'concurrent-modification');
  assert.ok(!fs.existsSync(path.join(root, 'docs')), 'no docs directory may be created on a refusal');
});

test('MF-9: a first-cycle-over-existing refusal creates no new state', () => {
  const root = freshRepo();
  persistFoundation(intake({ repositoryRoot: root }), { io: realIo() });
  const before = fs.readdirSync(path.join(root, 'docs', 'agent', 'discovery'));
  const refused = code(() => persistFoundation(intake({
    repositoryRoot: root, cycle: 'c-0002', timestamp: '2026-08-29T02:00:00Z', expectedPriorRevision: null,
  }), { io: realIo() }));
  assert.equal(refused, 'concurrent-modification');
  assert.deepEqual(fs.readdirSync(path.join(root, 'docs', 'agent', 'discovery')), before);
});

// --- CF-1: post-commit reread failure is honest about the unknown revision --

test('CF-1: a post-commit reread failure says the on-disk revision is unknown', () => {
  const root = freshRepo();
  const base = realIo();
  let committed = false;
  const dest = destIn(root);
  const io = {
    ...base,
    rename: (from, to) => { base.rename(from, to); committed = true; },
    read: (p) => { if (committed && p === dest) { const e = new Error('read denied'); e.code = 'EACCES'; throw e; } return base.read(p); },
  };
  let thrown = null;
  try {
    persistFoundation(intake({ repositoryRoot: root }), { io });
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof FoundationPersistError);
  assert.equal(thrown.code, 'post-commit-verification-failed');
  assert.match(thrown.message, /current on-disk revision is unknown/);
});
