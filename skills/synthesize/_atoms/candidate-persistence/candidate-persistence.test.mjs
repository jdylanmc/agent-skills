import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CandidatePersistenceError, destinationFor, persistCandidate, run } from './candidate-persistence.mjs';
import { DECLARED_ROOT, PROFILES } from '../synthesis-profile/synthesis-profile.mjs';

const DECLARED = {
  goal: 'the human intent of a skill, as plain requirements a person can confirm',
  sourceKind: 'skill-bundle',
  variantKind: 'intent-prose',
  workspaceRoot: 'synthesis/intent/',
  outputPattern: 'synthesis/intent/<slug>.intent.md',
  wordBudget: 400,
  requiredContent: ['subject', 'purpose', 'requirements', 'refusals'],
  nonOmittableKinds: ['intention', 'criterion', 'non-goal', 'constraint', 'contradiction'],
  structuralHeadings: [],
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SANDBOX = path.resolve(HERE, '..', '..', '..', '..', '.test-sandbox', 'candidate-persistence');
const CANDIDATE = 'docs/agent/specs/demo.nano.md';
let serial = 0;

function root(t) {
  serial += 1;
  const value = path.join(SANDBOX, `${process.pid}-${serial}`);
  fs.mkdirSync(value, { recursive: true });
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}

function destination(repositoryRoot) {
  return path.join(repositoryRoot, CANDIDATE);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function input(repositoryRoot, overrides = {}) {
  const candidateText = overrides.candidateText ?? '# Candidate\n';
  return {
    repositoryRoot,
    candidatePath: CANDIDATE,
    candidateText,
    outcome: { status: 'complete', candidate: { path: CANDIDATE, digest: digest(candidateText) } },
    runId: 'run-1',
    profile: 'spec-nano',
    ...overrides,
  };
}

function code(fn) {
  try { fn(); } catch (error) {
    assert.ok(error instanceof CandidatePersistenceError);
    return error.code;
  }
  return null;
}

test('creates a new canonical candidate only after a complete outcome', (t) => {
  const repositoryRoot = root(t);
  const result = persistCandidate(input(repositoryRoot), { uuid: () => 'one' });
  assert.equal(result.status, 'persisted');
  assert.equal(fs.readFileSync(destination(repositoryRoot), 'utf8'), '# Candidate\n');
});

test('refused, blocked, stale, and needs-split outcomes leave no canonical candidate', (t) => {
  for (const status of ['refused', 'blocked', 'stale-source', 'needs-split']) {
    const repositoryRoot = root(t);
    assert.equal(code(() => persistCandidate(input(repositoryRoot, { outcome: { status } }))), 'outcome-not-persistable');
    assert.equal(fs.existsSync(destination(repositoryRoot)), false);
  }
});

test('an existing candidate is never overwritten', (t) => {
  const repositoryRoot = root(t);
  fs.mkdirSync(path.dirname(destination(repositoryRoot)), { recursive: true });
  fs.writeFileSync(destination(repositoryRoot), 'prior\n');
  assert.equal(code(() => persistCandidate(input(repositoryRoot))), 'replacement-not-authorized');
  assert.equal(fs.readFileSync(destination(repositoryRoot), 'utf8'), 'prior\n');
});

test('validated candidate A cannot be replaced with candidate B before persistence', (t) => {
  const repositoryRoot = root(t);
  const outcome = input(repositoryRoot).outcome;
  assert.equal(
    code(() => persistCandidate(input(repositoryRoot, { candidateText: '# Changed\n', outcome }), { uuid: () => 'two' })),
    'candidate-receipt-mismatch',
  );
  assert.equal(fs.existsSync(destination(repositoryRoot)), false);
});

test('failed staged verification preserves the prior destination and removes staging', (t) => {
  const repositoryRoot = root(t);
  const io = {
    lstat: (value) => fs.lstatSync(value),
    read: (value) => value.includes('.stage-') ? Buffer.from('corrupt') : fs.readFileSync(value),
    mkdir: (value) => fs.mkdirSync(value, { recursive: true }),
    write: (value, bytes) => fs.writeFileSync(value, bytes, { flag: 'wx' }),
    link: (from, to) => fs.linkSync(from, to),
    unlink: (value) => fs.unlinkSync(value),
  };
  assert.equal(
    code(() => persistCandidate(input(repositoryRoot), { io, uuid: () => 'three' })),
    'verification-failed',
  );
  assert.equal(fs.existsSync(destination(repositoryRoot)), false);
  assert.deepEqual(fs.readdirSync(path.dirname(destination(repositoryRoot))), []);
});

test('unsafe run ids, nonces, and symlinked workspace components are refused', (t) => {
  const repositoryRoot = root(t);
  assert.equal(code(() => persistCandidate(input(repositoryRoot, { runId: '../escape' }))), 'invalid-input');
  assert.equal(code(() => persistCandidate(input(repositoryRoot), { uuid: () => '../escape' })), 'invalid-input');

  const symlinkRoot = root(t);
  const outside = root(t);
  fs.mkdirSync(path.join(symlinkRoot, 'docs', 'agent'), { recursive: true });
  try {
    fs.symlinkSync(outside, path.join(symlinkRoot, 'docs', 'agent', 'specs'), 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('the platform does not permit creating a test symlink');
      return;
    }
    throw error;
  }
  assert.equal(code(() => persistCandidate(input(symlinkRoot))), 'unsafe-path');
  assert.equal(fs.existsSync(path.join(outside, 'demo.nano.md')), false);
});

test('a symlinked repository root cannot publish outside its lexical boundary', (t) => {
  const real = root(t);
  const link = `${real}-link`;
  t.after(() => fs.rmSync(link, { force: true }));
  try {
    fs.symlinkSync(real, link, 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('the platform does not permit creating a test symlink');
      return;
    }
    throw error;
  }
  assert.equal(code(() => persistCandidate(input(link))), 'unsafe-path');
  assert.equal(fs.existsSync(destination(real)), false);
});

test('a concurrent destination creation wins and is never overwritten', (t) => {
  const repositoryRoot = root(t);
  const io = {
    lstat: (value) => fs.lstatSync(value),
    read: (value) => fs.readFileSync(value),
    mkdir: (value) => fs.mkdirSync(value, { recursive: true }),
    write: (value, bytes) => fs.writeFileSync(value, bytes, { flag: 'wx' }),
    link(from, to) {
      fs.writeFileSync(to, 'newer\n', { flag: 'wx' });
      fs.linkSync(from, to);
    },
    unlink: (value) => fs.unlinkSync(value),
  };
  assert.equal(code(() => persistCandidate(input(repositoryRoot), { io, uuid: () => 'race' })), 'concurrent-modification');
  assert.equal(fs.readFileSync(destination(repositoryRoot), 'utf8'), 'newer\n');
});

test('post-commit cleanup failure preserves the persistence receipt with a warning', (t) => {
  const repositoryRoot = root(t);
  const io = {
    lstat: (value) => fs.lstatSync(value),
    read: (value) => fs.readFileSync(value),
    mkdir: (value) => fs.mkdirSync(value, { recursive: true }),
    write: (value, bytes) => fs.writeFileSync(value, bytes, { flag: 'wx' }),
    link: (from, to) => fs.linkSync(from, to),
    unlink() {
      const error = new Error('busy');
      error.code = 'EBUSY';
      throw error;
    },
  };
  const result = persistCandidate(input(repositoryRoot), { io, uuid: () => 'cleanup' });
  assert.equal(result.status, 'persisted');
  assert.equal(result.revision, digest('# Candidate\n'));
  assert.equal(result.cleanupWarning.filesystemCode, 'EBUSY');
  assert.equal(fs.readFileSync(destination(repositoryRoot), 'utf8'), '# Candidate\n');
  assert.ok(fs.existsSync(result.cleanupWarning.staged));
});

test('the command entry reads one absolute input record and prints the receipt', (t) => {
  const repositoryRoot = root(t);
  const record = path.join(repositoryRoot, 'input.json');
  fs.writeFileSync(record, JSON.stringify(input(repositoryRoot)));
  const output = [];
  assert.equal(run(['--input', record], { stdout: { write: (value) => output.push(value) } }), 0);
  assert.equal(JSON.parse(output.join('')).status, 'persisted');
  assert.equal(code(() => run(['--input', 'relative.json'])), 'invalid-input');
});

test("the destination is the one this run's contract names, and nothing else is", () => {
  assert.deepEqual(destinationFor('spec-nano', 'docs/agent/specs/demo.nano.md'), { profileId: 'spec-nano', slug: 'demo' });
  assert.deepEqual(destinationFor('spec-nano', 'docs/agent/specs/two-word-slug.nano.md'), { profileId: 'spec-nano', slug: 'two-word-slug' });
  // The slug is a slug, not a path segment that could climb or fan out.
  for (const stray of [
    'docs/agent/specs/../escape.nano.md',
    'docs/agent/specs/Demo.nano.md',
    'docs/agent/specs/a/b.nano.md',
    'docs/agent/specs/demo.intent.md',
    'docs/agent/demo.nano.md',
    'README.md',
    'docs/agent/specs/demo.nano.md.stage-run-1-nonce',
    '',
    null,
  ]) {
    assert.equal(destinationFor('spec-nano', stray), null, JSON.stringify(stray));
  }
  // A contract nobody stated names no destination at all.
  assert.equal(destinationFor(undefined, 'docs/agent/specs/demo.nano.md'), null);
  assert.equal(destinationFor({ ...DECLARED, wordBudget: 0 }, 'synthesis/intent/demo.intent.md'), null);
});

test("a candidate outside the run's own contract is refused before any write", (t) => {
  const repositoryRoot = root(t);
  const candidatePath = 'synthesis/intent/demo.intent.md';
  const candidateText = '# Candidate\n';
  assert.equal(
    code(() => persistCandidate({
      repositoryRoot,
      candidatePath,
      candidateText,
      outcome: { status: 'complete', candidate: { path: candidatePath, digest: digest(candidateText) } },
      runId: 'run-1',
      profile: 'spec-nano',
    })),
    'invalid-input',
  );
  assert.equal(fs.existsSync(path.join(repositoryRoot, candidatePath)), false);
});

test('a declared reduction publishes to the destination it declared', (t) => {
  const repositoryRoot = root(t);
  const candidatePath = 'synthesis/intent/demo.intent.md';
  const candidateText = '# Intent: demo\n';
  const contract = destinationFor(DECLARED, candidatePath).profileId;
  assert.deepEqual(destinationFor(DECLARED, candidatePath), { profileId: contract, slug: 'demo' });
  const result = persistCandidate({
    repositoryRoot,
    candidatePath,
    candidateText,
    // The receipt names the contract it was validated under, which is what
    // `resolveOutcome` emits for every complete run.
    outcome: { status: 'complete', contract, candidate: { path: candidatePath, digest: digest(candidateText) } },
    runId: 'run-1',
    profile: DECLARED,
  }, { uuid: () => 'declared-one' });
  assert.equal(result.status, 'persisted');
  assert.equal(fs.readFileSync(path.join(repositoryRoot, candidatePath), 'utf8'), candidateText);
});

test('a declared reduction never publishes from a receipt carrying no contract', (t) => {
  // Absent evidence is not permission. Checking the receipt only when it happened
  // to name a contract left the case that matters open: a receipt with no
  // contract evidence, published under whatever terms the caller handed in. Two
  // declared contracts can name the same destination while differing in budget,
  // required content, or what may never be dropped, so a candidate validated
  // under strict terms could be published under weaker ones and nothing would
  // notice.
  const candidatePath = 'synthesis/intent/demo.intent.md';
  const candidateText = '# Intent: demo\n';
  const receipt = { status: 'complete', candidate: { path: candidatePath, digest: digest(candidateText) } };
  for (const contract of [undefined, '', '   ', null]) {
    const repositoryRoot = root(t);
    assert.equal(
      code(() => persistCandidate({
        repositoryRoot,
        candidatePath,
        candidateText,
        outcome: contract === undefined ? receipt : { ...receipt, contract },
        runId: 'run-1',
        profile: DECLARED,
      })),
      'contract-evidence-missing',
      String(contract),
    );
    assert.equal(fs.existsSync(path.join(repositoryRoot, candidatePath)), false);
  }

  // A reference that is the id rather than the terms is refused earlier and for
  // a different reason: without the terms there is no destination to discuss at
  // all, so the actionable message is "supply the terms", not "name the
  // contract". Either way nothing is published.
  const repositoryRoot = root(t);
  let message;
  try {
    persistCandidate({
      repositoryRoot,
      candidatePath,
      candidateText,
      outcome: receipt,
      runId: 'run-1',
      profile: `declared:${'0'.repeat(64)}`,
    });
  } catch (error) {
    message = error.message;
    assert.equal(error.code, 'invalid-input');
  }
  assert.match(message, /cannot be resolved by name; supply its terms as profile/);
  assert.equal(fs.existsSync(path.join(repositoryRoot, candidatePath)), false);
});

test('weaker terms cannot publish a receipt validated under stricter ones, contract absent or not', (t) => {
  // The defect this closes: contract A validated, contract B published, because
  // both name the same destination and the receipt said nothing.
  const candidatePath = 'synthesis/intent/demo.intent.md';
  const candidateText = '# Intent: demo\n';
  const strict = DECLARED;
  const weaker = { ...DECLARED, wordBudget: 4000, requiredContent: ['subject'] };
  const strictId = destinationFor(strict, candidatePath).profileId;
  const weakerId = destinationFor(weaker, candidatePath).profileId;
  assert.notEqual(strictId, weakerId, 'the two contracts must really differ');

  // With the contract on the receipt, the substitution is named and refused.
  const repositoryRoot = root(t);
  assert.equal(
    code(() => persistCandidate({
      repositoryRoot,
      candidatePath,
      candidateText,
      outcome: { status: 'complete', contract: strictId, candidate: { path: candidatePath, digest: digest(candidateText) } },
      runId: 'run-1',
      profile: weaker,
    })),
    'contract-mismatch',
  );
  assert.equal(fs.existsSync(path.join(repositoryRoot, candidatePath)), false);
});

test('a named profile keeps its original receipt semantics, and a present contract is still compared', (t) => {
  // Named profiles carried a path and a digest and no contract before this
  // change. That stays legal, and it is safe for a reason rather than by
  // oversight: a declared workspace must sit beneath the one root declared
  // reductions have, so no declared destination can collide with a named one.
  for (const profile of Object.values(PROFILES)) {
    assert.ok(!profile.workspaceRoot.startsWith(DECLARED_ROOT), profile.id);
    assert.ok(!profile.outputPattern.startsWith(DECLARED_ROOT), profile.id);
  }
  const repositoryRoot = root(t);
  const candidateText = '# Candidate\n';
  assert.equal(
    persistCandidate({
      repositoryRoot,
      candidatePath: CANDIDATE,
      candidateText,
      outcome: { status: 'complete', candidate: { path: CANDIDATE, digest: digest(candidateText) } },
      runId: 'run-1',
      profile: 'spec-nano',
    }, { uuid: () => 'named-legacy' }).status,
    'persisted',
  );

  const mismatched = root(t);
  assert.equal(
    code(() => persistCandidate({
      repositoryRoot: mismatched,
      candidatePath: CANDIDATE,
      candidateText,
      outcome: { status: 'complete', contract: 'some-other-profile', candidate: { path: CANDIDATE, digest: digest(candidateText) } },
      runId: 'run-1',
      profile: 'spec-nano',
    })),
    'contract-mismatch',
  );
});

test('a named-profile call needs no separate contract argument', (t) => {
  // The contract is read off the validated receipt. A spec-nano caller passes
  // exactly what it always passed.
  const repositoryRoot = root(t);
  const candidateText = '# Candidate\n';
  const result = persistCandidate({
    repositoryRoot,
    candidatePath: CANDIDATE,
    candidateText,
    outcome: {
      status: 'complete',
      contract: 'spec-nano',
      candidate: { path: CANDIDATE, digest: digest(candidateText) },
    },
    runId: 'run-1',
  }, { uuid: () => 'receipt-one' });
  assert.equal(result.status, 'persisted');
  assert.equal(fs.readFileSync(destination(repositoryRoot), 'utf8'), candidateText);
});

test('a receipt validated under one contract is not published under another', (t) => {
  // Two contracts can name the same destination. Without the contract on the
  // receipt, a candidate validated under strict terms could be published under
  // weaker ones that happen to write to the same path.
  const repositoryRoot = root(t);
  const candidatePath = 'synthesis/intent/demo.intent.md';
  const candidateText = '# Intent: demo\n';
  const weaker = { ...DECLARED, wordBudget: 4000 };
  const strictId = 'declared:0000000000000000000000000000000000000000000000000000000000000000';
  assert.equal(
    code(() => persistCandidate({
      repositoryRoot,
      candidatePath,
      candidateText,
      outcome: {
        status: 'complete',
        contract: strictId,
        candidate: { path: candidatePath, digest: digest(candidateText) },
      },
      runId: 'run-1',
      profile: weaker,
    })),
    'contract-mismatch',
  );
  assert.equal(fs.existsSync(path.join(repositoryRoot, candidatePath)), false);
});

test('a declared contract cannot publish outside the root declared contracts have', () => {
  // Stating a reduction goal is a semantic request, not a grant of write
  // authority. `doctrine/` is the case that makes the difference obvious: this
  // repository reserves it for a human's explicit act.
  for (const workspaceRoot of ['doctrine/', 'docs/agent/', 'skills/', '']) {
    const contract = {
      ...DECLARED,
      workspaceRoot,
      outputPattern: `${workspaceRoot}<slug>.intent.md`,
    };
    assert.equal(destinationFor(contract, `${workspaceRoot}injected.intent.md`), null, workspaceRoot);
  }
});

test('a declared receipt with no contract says which thing is missing', (t) => {
  // The refusal is right either way; the message decides whether a caller fixes
  // the call or hunts a path bug that is not there.
  const repositoryRoot = root(t);
  const candidatePath = 'synthesis/intent/demo.intent.md';
  const candidateText = '# Intent: demo\n';
  let message;
  try {
    persistCandidate({
      repositoryRoot,
      candidatePath,
      candidateText,
      outcome: {
        status: 'complete',
        contract: `declared:${'0'.repeat(64)}`,
        candidate: { path: candidatePath, digest: digest(candidateText) },
      },
      runId: 'run-1',
    });
  } catch (error) {
    message = error.message;
  }
  assert.match(message, /cannot be resolved by name; supply its terms as profile/);
  assert.equal(fs.existsSync(path.join(repositoryRoot, candidatePath)), false);
});

test('receipt evidence must be an own, stable property of the receipt', (t) => {
  // A receipt is evidence, and evidence has to sit on the object. Reading fields
  // with ordinary property access let two things through: a value inherited from
  // a prototype, which is not on the receipt at all, and an accessor answering
  // the check and the use differently. Both published a candidate whose receipt
  // did not say what the code had read.
  const candidatePath = 'synthesis/intent/demo.intent.md';
  const candidateText = '# Intent: demo\n';
  const contract = destinationFor(DECLARED, candidatePath).profileId;
  const candidate = { path: candidatePath, digest: digest(candidateText) };

  const inherited = Object.create({ contract });
  inherited.status = 'complete';
  inherited.candidate = candidate;

  let reads = 0;
  const varying = { status: 'complete', candidate };
  Object.defineProperty(varying, 'contract', {
    get() { reads += 1; return reads === 1 ? contract : undefined; },
    enumerable: true,
  });

  for (const [label, outcome] of [['inherited', inherited], ['accessor', varying]]) {
    const repositoryRoot = root(t);
    assert.equal(
      code(() => persistCandidate({
        repositoryRoot, candidatePath, candidateText, outcome, runId: 'run-1', profile: DECLARED,
      })),
      'contract-evidence-missing',
      label,
    );
    assert.equal(fs.existsSync(path.join(repositoryRoot, candidatePath)), false, label);
  }

  // The candidate receipt is read the same way, so a path or digest that is
  // inherited rather than stated cannot vouch for the bytes either.
  const inheritedCandidate = { status: 'complete', contract, candidate: Object.create(candidate) };
  const repositoryRoot = root(t);
  assert.equal(
    code(() => persistCandidate({
      repositoryRoot, candidatePath, candidateText, outcome: inheritedCandidate, runId: 'run-1', profile: DECLARED,
    })),
    'candidate-receipt-mismatch',
  );
  assert.equal(fs.existsSync(path.join(repositoryRoot, candidatePath)), false);
});
