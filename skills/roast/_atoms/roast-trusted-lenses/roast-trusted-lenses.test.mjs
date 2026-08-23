/**
 * The bundled lens configuration is a trusted source: it is the fallback that
 * loads when no repository coach agent resolves. Its manifest pins the digest
 * of this unit's Markdown file, and the trust boundary tells a consumer not to
 * load the configuration when the digest does not reproduce.
 *
 * A pinned digest that nobody checks rots silently, and a rotted pin disables
 * the fallback exactly when it is needed. This test makes an edit without a
 * regenerated digest a build failure instead.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const MANIFEST_PATH = path.join(UNIT_ROOT, 'roast-trusted-lenses.manifest.json');

function manifest() {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
}

test('the manifest declares exactly the bundled lens configuration', () => {
  const parsed = manifest();
  assert.equal(parsed['schema-version'], 1);
  assert.equal(parsed['trusted-files'].length, 1);
  const [entry] = parsed['trusted-files'];
  assert.equal(entry.id, 'bundled-lenses');
  assert.equal(entry.path, 'roast-trusted-lenses.md');
  assert.equal(
    entry['source-path'],
    'skills/roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.md',
  );
});

test('the declared source path resolves to the pinned file', () => {
  const [entry] = manifest()['trusted-files'];
  const bySourcePath = path.join(REPOSITORY_ROOT, ...entry['source-path'].split('/'));
  const byLocalPath = path.join(UNIT_ROOT, entry.path);
  assert.equal(fs.realpathSync(bySourcePath), fs.realpathSync(byLocalPath));
  assert.ok(fs.lstatSync(byLocalPath).isFile());
  assert.ok(!fs.lstatSync(byLocalPath).isSymbolicLink());
});

test('the pinned digest reproduces from the bundled configuration', () => {
  const [entry] = manifest()['trusted-files'];
  const actual = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(UNIT_ROOT, entry.path)))
    .digest('hex');
  assert.equal(
    entry.sha256,
    actual,
    'regenerate with: shasum -a 256 skills/roast/_atoms/roast-trusted-lenses/roast-trusted-lenses.md',
  );
});

test('the trust boundary still names every step a consumer must perform', () => {
  const document = fs.readFileSync(path.join(UNIT_ROOT, 'roast-trusted-lenses.md'), 'utf8');
  for (const requirement of [
    'regular file and not a symbolic link',
    'stays inside its declared containing root',
    'compute its SHA-256 digest',
    'A failed check means the file is not loaded',
    'Insufficient review',
    'Lens drift',
  ]) {
    assert.ok(document.includes(requirement), `missing trust requirement: ${requirement}`);
  }
});
