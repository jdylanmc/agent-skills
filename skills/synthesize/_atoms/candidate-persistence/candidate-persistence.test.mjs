import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CandidatePersistenceError, persistCandidate, run } from './candidate-persistence.mjs';

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
