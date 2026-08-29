/**
 * Seam tests for source-binding.
 *
 * The property worth holding: a synthesis run binds exactly one identified,
 * fresh, in-workspace, readable artifact, the workspace comes from the named
 * profile, the revision is computed from the bytes, and every other case is a
 * named refusal.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { REFUSAL_CODES, SourceBindingError, bindFile, bindSource, run } from './source-binding.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');
const DOCUMENT = fs.readFileSync(path.join(UNIT_ROOT, 'source-binding.md'), 'utf8');

function workspace(t) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(SANDBOX_ROOT, 'source-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeSource(root, relative, content) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  return absolute;
}

function code(run) {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
}

const PROFILE = 'spec-nano';
const SOURCE = 'docs/agent/specs/faster-checkout.full.md';
const CONTENT = '# Faster checkout\n\nOne full specification body.\n';
const REVISION = createHash('sha256').update(CONTENT).digest('hex');

test('binds one identified, fresh, in-workspace source with a computed content digest', (t) => {
  const root = workspace(t);
  writeSource(root, SOURCE, CONTENT);
  const binding = bindSource({
    repositoryRoot: root,
    sourcePath: SOURCE,
    declaredRevision: REVISION,
    profileId: PROFILE,
  });
  assert.equal(binding.status, 'bound');
  assert.equal(binding.sourcePath, SOURCE);
  assert.equal(binding.slug, 'faster-checkout');
  assert.equal(binding.revision, REVISION);
  assert.equal(binding.digest, REVISION);
});

test('the digest is stable across repeated reads of the same bytes', (t) => {
  const root = workspace(t);
  writeSource(root, SOURCE, CONTENT);
  const first = bindFile({ repositoryRoot: root, sourcePath: SOURCE, declaredRevision: REVISION, profileId: PROFILE });
  const second = bindFile({ repositoryRoot: root, sourcePath: SOURCE, declaredRevision: REVISION, profileId: PROFILE });
  assert.equal(first.digest, second.digest);
});

test('a missing source path or revision is unbound-source, never inferred', (t) => {
  const root = workspace(t);
  assert.equal(
    code(() => bindSource({ repositoryRoot: root, declaredRevision: REVISION, profileId: PROFILE })),
    'unbound-source',
  );
  assert.equal(
    code(() => bindSource({ repositoryRoot: root, sourcePath: SOURCE, profileId: PROFILE })),
    'unbound-source',
  );
});

test('an absolute source path is unbound-source', (t) => {
  const root = workspace(t);
  const absolute = writeSource(root, SOURCE, CONTENT);
  assert.equal(
    code(() => bindSource({ repositoryRoot: root, sourcePath: absolute, declaredRevision: REVISION, profileId: PROFILE })),
    'unbound-source',
  );
});

test('an unknown profile is unknown-profile, and the workspace cannot be widened by a caller', (t) => {
  const root = workspace(t);
  writeSource(root, SOURCE, CONTENT);
  assert.equal(
    code(() => bindSource({ repositoryRoot: root, sourcePath: SOURCE, declaredRevision: REVISION, profileId: 'spec-mini' })),
    'unknown-profile',
  );
  assert.equal(
    code(() => bindSource({ repositoryRoot: root, sourcePath: SOURCE, declaredRevision: REVISION })),
    'unknown-profile',
  );
});

test('a source outside the profile workspace is outside-workspace', (t) => {
  const root = workspace(t);
  writeSource(root, 'docs/other/thing.full.md', CONTENT);
  assert.equal(
    code(() => bindSource({
      repositoryRoot: root,
      sourcePath: 'docs/other/thing.full.md',
      declaredRevision: REVISION,
      profileId: PROFILE,
    })),
    'outside-workspace',
  );
});

test('a source whose bytes no longer match the declared revision is stale-source', (t) => {
  const root = workspace(t);
  writeSource(root, SOURCE, CONTENT);
  try {
    bindSource({ repositoryRoot: root, sourcePath: SOURCE, declaredRevision: 'a'.repeat(64), profileId: PROFILE });
    assert.fail('expected a stale-source refusal');
  } catch (error) {
    assert.ok(error instanceof SourceBindingError);
    assert.equal(error.code, 'stale-source');
    assert.equal(error.detail.declaredRevision, 'a'.repeat(64));
    assert.equal(error.detail.observedRevision, REVISION);
  }
});

test('an absent source is unreadable', (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, 'docs', 'agent', 'specs'), { recursive: true });
  assert.equal(
    code(() => bindSource({ repositoryRoot: root, sourcePath: SOURCE, declaredRevision: REVISION, profileId: PROFILE })),
    'unreadable',
  );
});

test('a directory in the source position is unreadable', (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, SOURCE), { recursive: true });
  assert.equal(
    code(() => bindSource({ repositoryRoot: root, sourcePath: SOURCE, declaredRevision: REVISION, profileId: PROFILE })),
    'unreadable',
  );
});

test('final stat and read failures are normalized to unreadable with native detail', (t) => {
  const root = workspace(t);
  writeSource(root, SOURCE, CONTENT);
  for (const operation of ['lstatSync', 'readFileSync']) {
    let calls = 0;
    const io = {
      lstatSync(value) {
        calls += 1;
        if (operation === 'lstatSync' && calls > SOURCE.split('/').length) {
          const error = new Error('denied');
          error.code = 'EACCES';
          throw error;
        }
        return fs.lstatSync(value);
      },
      readFileSync(value) {
        if (operation === 'readFileSync') {
          const error = new Error('denied');
          error.code = 'EACCES';
          throw error;
        }
        return fs.readFileSync(value);
      },
    };
    try {
      bindSource({ repositoryRoot: root, sourcePath: SOURCE, declaredRevision: REVISION, profileId: PROFILE, io });
      assert.fail(`expected ${operation} to refuse`);
    } catch (error) {
      assert.ok(error instanceof SourceBindingError);
      assert.equal(error.code, 'unreadable');
      assert.equal(error.detail.filesystemCode, 'EACCES');
    }
  }
});

test('a symlinked path component is unsafe-path', (t) => {
  const root = workspace(t);
  writeSource(root, 'docs/agent/real/faster-checkout.full.md', CONTENT);
  const linkParent = path.join(root, 'docs', 'agent', 'specs');
  try {
    fs.symlinkSync(path.join(root, 'docs', 'agent', 'real'), linkParent, 'dir');
  } catch (error) {
    if (error.code === 'EPERM') {
      t.skip('the platform does not permit creating a test symlink');
      return;
    }
    throw error;
  }
  assert.equal(
    code(() => bindSource({ repositoryRoot: root, sourcePath: SOURCE, declaredRevision: REVISION, profileId: PROFILE })),
    'unsafe-path',
  );
});

test('a symlinked repository root is unsafe-path', (t) => {
  const real = workspace(t);
  writeSource(real, SOURCE, CONTENT);
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
  assert.equal(
    code(() => bindSource({ repositoryRoot: link, sourcePath: SOURCE, declaredRevision: REVISION, profileId: PROFILE })),
    'unsafe-path',
  );
});

test('run refuses a second --source as usage', (t) => {
  const root = workspace(t);
  writeSource(root, SOURCE, CONTENT);
  const out = [];
  const streams = { stdout: { write: (v) => out.push(v) }, stderr: { write: () => {} } };
  assert.equal(
    code(() => run(['--root', root, '--source', SOURCE, '--source', SOURCE, '--revision', REVISION, '--profile', PROFILE], streams)),
    'usage',
  );
});

test('run prints a binding for a valid single source', (t) => {
  const root = workspace(t);
  writeSource(root, SOURCE, CONTENT);
  const out = [];
  const streams = { stdout: { write: (v) => out.push(v) }, stderr: { write: () => {} } };
  const exit = run(['--root', root, '--source', SOURCE, '--revision', REVISION, '--profile', PROFILE], streams);
  assert.equal(exit, 0);
  const binding = JSON.parse(out.join(''));
  assert.equal(binding.status, 'bound');
  assert.equal(binding.slug, 'faster-checkout');
  assert.equal(binding.revision, REVISION);
});

test('the documented refusal table matches REFUSAL_CODES in both directions', () => {
  const section = DOCUMENT.split(/^## Refusals\s*$/m)[1];
  assert.ok(section, 'source-binding.md no longer carries the refusal table');
  const table = section.split(/^#{1,6} /m)[0];
  const documented = [...table.matchAll(/^\| `([a-z-]+)` \|/gm)].map((match) => match[1]);
  assert.deepEqual(documented.sort(), [...REFUSAL_CODES].sort());
});
