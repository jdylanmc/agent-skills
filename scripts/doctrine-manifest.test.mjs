import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The doctrine manifest is a trust boundary, not documentation. The roast
 * lenses verify each digest before loading guidance, so drift silently changes
 * what an adversarial review judges against. Until this file existed the
 * digests were checked only by an agent at runtime, which meant a bad edit
 * reached the default branch and was discovered, if at all, by a reviewer.
 */

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCTRINE_ROOT = path.join(REPOSITORY_ROOT, 'doctrine');
const MANIFEST = path.join(DOCTRINE_ROOT, 'manifest.md');

function manifestEntries() {
  const raw = fs.readFileSync(MANIFEST, 'utf8');
  const entries = [...raw.matchAll(/- id: (\S+)\s+path: (\S+)\s+sha256: ([a-f0-9]{64})/g)];
  return entries.map(([, id, entryPath, sha256]) => ({ id, path: entryPath, sha256 }));
}

function digestOf(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('the manifest declares at least one doctrine entry', () => {
  // A manifest that parses to nothing would make every other assertion here
  // vacuously true.
  assert.ok(manifestEntries().length > 0, 'expected parsable doctrine entries');
});

test('every declared doctrine digest reproduces', () => {
  const drifted = [];
  for (const entry of manifestEntries()) {
    const file = path.join(DOCTRINE_ROOT, entry.path);
    assert.ok(fs.existsSync(file), `${entry.id}: ${entry.path} is declared but missing`);
    const actual = digestOf(file);
    if (actual !== entry.sha256) {
      drifted.push(`${entry.id}: declared ${entry.sha256}, actual ${actual}`);
    }
  }
  assert.deepEqual(
    drifted,
    [],
    `recompute with shasum -a 256 and update doctrine/manifest.md in the same commit:\n${drifted.join('\n')}`,
  );
});

test('every doctrine file on disk is declared in the manifest', () => {
  // The reverse direction matters as much: an undeclared file is guidance no
  // lens will ever verify, which is worse than absent because it looks trusted.
  const declared = new Set(manifestEntries().map((entry) => entry.path));
  const onDisk = fs
    .readdirSync(DOCTRINE_ROOT)
    .filter((name) => name.endsWith('.doctrine.md'));

  const undeclared = onDisk.filter((name) => !declared.has(name));
  assert.deepEqual(undeclared, [], 'doctrine files present but not declared in the manifest');
});

test('a doctrine path cannot escape the doctrine root or be a symbolic link', () => {
  for (const entry of manifestEntries()) {
    const resolved = path.resolve(DOCTRINE_ROOT, entry.path);
    assert.ok(
      resolved.startsWith(DOCTRINE_ROOT + path.sep),
      `${entry.id}: resolves outside the doctrine root`,
    );
    assert.ok(
      !fs.lstatSync(resolved).isSymbolicLink(),
      `${entry.id}: is a symbolic link, so its digest does not describe what would load`,
    );
  }
});
