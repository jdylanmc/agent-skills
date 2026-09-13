/**
 * Adversarial tests for changelog target resolution and write safety.
 *
 * These cover the cases the prose cannot: a path that escapes the repository,
 * a symlinked component, a target that changed between approval and write, and
 * a nested run that was told it had approval. Each one ends with real bytes in
 * the wrong file if it is wrong.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  TargetError,
  buildApproval,
  hash,
  isChangelogName,
  resolveTarget,
  verifyApproval,
} from './changelog-target.mjs';

function sandbox(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-target-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('a plain in-repository target resolves and reports its content hash', (t) => {
  const root = sandbox(t);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n');

  const resolved = resolveTarget(root, 'CHANGELOG.md');
  assert.equal(resolved.relativePath, 'CHANGELOG.md');
  assert.equal(resolved.exists, true);
  assert.equal(resolved.contentHash, hash('# Changelog\n'));
});

test('a component changelog under a subtree resolves', (t) => {
  const root = sandbox(t);
  fs.mkdirSync(path.join(root, 'packages', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'api', 'CHANGELOG.md'), '# Changelog\n');

  const resolved = resolveTarget(root, 'packages/api/CHANGELOG.md');
  assert.equal(resolved.relativePath, 'packages/api/CHANGELOG.md');
  assert.equal(resolved.exists, true);
});

test('a target that does not exist yet is allowed but reports no hash', (t) => {
  const root = sandbox(t);
  const resolved = resolveTarget(root, 'CHANGELOG.md');
  assert.equal(resolved.exists, false);
  assert.equal(resolved.contentHash, null);
});

test('a traversal escape is rejected', (t) => {
  const root = sandbox(t);
  assert.throws(
    () => resolveTarget(root, '../outside/CHANGELOG.md'),
    (error) => error instanceof TargetError && error.code === 'outside_repository',
  );
});

test('an absolute path outside the repository is rejected', (t) => {
  const root = sandbox(t);
  assert.throws(
    () => resolveTarget(root, path.join(os.tmpdir(), 'elsewhere.md')),
    (error) => error instanceof TargetError && error.code === 'outside_repository',
  );
});

test('a symlinked leaf is rejected even though it sits inside the repository', (t) => {
  const root = sandbox(t);
  const outside = path.join(root, '..', `escape-${process.pid}.md`);
  fs.writeFileSync(outside, 'outside\n');
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.symlinkSync(outside, path.join(root, 'CHANGELOG.md'));

  assert.throws(
    () => resolveTarget(root, 'CHANGELOG.md'),
    (error) => error instanceof TargetError && error.code === 'symlink_component',
  );
});

test('a symlinked parent directory is rejected, not only a symlinked file', (t) => {
  // The easier one to miss: the leaf name looks ordinary and the redirect
  // happens a level up.
  const root = sandbox(t);
  const outsideDir = path.join(root, '..', `escape-dir-${process.pid}`);
  fs.mkdirSync(outsideDir, { recursive: true });
  fs.writeFileSync(path.join(outsideDir, 'CHANGELOG.md'), 'outside\n');
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  fs.symlinkSync(outsideDir, path.join(root, 'docs'));

  assert.throws(
    () => resolveTarget(root, 'docs/CHANGELOG.md'),
    (error) => error instanceof TargetError && error.code === 'symlink_component',
  );
});

test('a directory in place of the target is rejected', (t) => {
  const root = sandbox(t);
  fs.mkdirSync(path.join(root, 'CHANGELOG.md'));

  assert.throws(
    () => resolveTarget(root, 'CHANGELOG.md'),
    (error) => error instanceof TargetError && error.code === 'not_regular_file',
  );
});

test('approval is bound to the path, the content, and the patch', (t) => {
  const root = sandbox(t);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n');
  const resolved = resolveTarget(root, 'CHANGELOG.md');

  const approval = buildApproval({
    canonicalPath: resolved.canonicalPath,
    contentHash: resolved.contentHash,
    patch: 'PATCH',
    nested: false,
  });

  assert.equal(verifyApproval(root, approval, 'PATCH').status, 'verified');
});

test('a target edited after approval invalidates the approval', (t) => {
  const root = sandbox(t);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n');
  const resolved = resolveTarget(root, 'CHANGELOG.md');
  const approval = buildApproval({
    canonicalPath: resolved.canonicalPath,
    contentHash: resolved.contentHash,
    patch: 'PATCH',
    nested: false,
  });

  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n\nsomething else\n');

  assert.throws(
    () => verifyApproval(root, approval, 'PATCH'),
    (error) => error instanceof TargetError && error.code === 'approval_mismatch',
  );
});

test('a patch altered after approval invalidates the approval', (t) => {
  const root = sandbox(t);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n');
  const resolved = resolveTarget(root, 'CHANGELOG.md');
  const approval = buildApproval({
    canonicalPath: resolved.canonicalPath,
    contentHash: resolved.contentHash,
    patch: 'PATCH',
    nested: false,
  });

  assert.throws(
    () => verifyApproval(root, approval, 'DIFFERENT PATCH'),
    (error) => error instanceof TargetError && error.code === 'approval_mismatch',
  );
});

test('a target replaced by a symlink after approval is rejected', (t) => {
  const root = sandbox(t);
  const target = path.join(root, 'CHANGELOG.md');
  fs.writeFileSync(target, '# Changelog\n');
  const resolved = resolveTarget(root, 'CHANGELOG.md');
  const approval = buildApproval({
    canonicalPath: resolved.canonicalPath,
    contentHash: resolved.contentHash,
    patch: 'PATCH',
    nested: false,
  });

  const outside = path.join(root, '..', `swap-${process.pid}.md`);
  fs.writeFileSync(outside, '# Changelog\n');
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.rmSync(target);
  fs.symlinkSync(outside, target);

  assert.throws(
    () => verifyApproval(root, approval, 'PATCH'),
    (error) => error instanceof TargetError && error.code === 'symlink_component',
  );
});

test('a nested run never publishes, whatever it was told', (t) => {
  // The structural half of "a calling skill cannot supply approval". A nested
  // run is one this skill did not start, so any approval reaching it came
  // through another workflow rather than from a person here.
  const root = sandbox(t);
  fs.writeFileSync(path.join(root, 'CHANGELOG.md'), '# Changelog\n');
  const resolved = resolveTarget(root, 'CHANGELOG.md');

  const approval = buildApproval({
    canonicalPath: resolved.canonicalPath,
    contentHash: resolved.contentHash,
    patch: 'PATCH',
    nested: true,
  });

  assert.throws(
    () => verifyApproval(root, approval, 'PATCH'),
    (error) => error instanceof TargetError && error.code === 'nested_publication',
  );
});

test('content hashing distinguishes byte sequences that decode identically', (t) => {
  // Two different invalid UTF-8 sequences decode to the same replacement
  // characters. Hashing decoded text would make a real change invisible.
  const root = sandbox(t);
  const target = path.join(root, 'CHANGELOG.md');

  fs.writeFileSync(target, Buffer.from([0x23, 0x20, 0xc3, 0x28]));
  const first = resolveTarget(root, 'CHANGELOG.md').contentHash;

  fs.writeFileSync(target, Buffer.from([0x23, 0x20, 0xa0, 0xa1]));
  const second = resolveTarget(root, 'CHANGELOG.md').contentHash;

  assert.notEqual(first, second, 'distinct bytes must not share a hash');
});

test('changelog filenames are recognized case-insensitively', () => {
  assert.ok(isChangelogName('CHANGELOG.md'));
  assert.ok(isChangelogName('changelog.md'));
  assert.ok(isChangelogName('CHANGES.md'));
  assert.ok(isChangelogName('HISTORY.md'));
  assert.ok(!isChangelogName('README.md'));
  assert.ok(!isChangelogName('CHANGELOG.txt'));
});

test('missing arguments fail closed rather than defaulting', (t) => {
  const root = sandbox(t);
  assert.throws(() => resolveTarget('', 'CHANGELOG.md'), TargetError);
  assert.throws(() => resolveTarget(root, ''), TargetError);
  assert.throws(() => verifyApproval(root, null, 'PATCH'), TargetError);
  assert.throws(
    () => buildApproval({ canonicalPath: '', patch: 'x' }),
    TargetError,
  );
});
