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

/**
 * The same class of defect that shipped in the finding-schema checker: a
 * vocabulary hardcoded in one place that another document owns, with nothing
 * tying them together. Here the lens table names repository coach agents and
 * the coordinator's required headings. If either is renamed, resolution falls
 * through to the bundled configuration or fails outright, and nothing would
 * have said so.
 */

function lensTableAgents(document) {
  return [...document.matchAll(/\| `([a-z0-9-]+\.agent\.md)` \|/g)].map((match) => match[1]);
}

test('every repository coach agent the lens table names exists on disk', () => {
  const document = fs.readFileSync(path.join(UNIT_ROOT, 'roast-trusted-lenses.md'), 'utf8');
  const named = lensTableAgents(document);
  assert.ok(named.length >= 3, 'the lens table no longer names its coach agents');

  const missing = named.filter(
    (agent) => !fs.existsSync(path.join(REPOSITORY_ROOT, 'agents', agent)),
  );
  assert.deepEqual(
    missing,
    [],
    `the lens table names agents that do not exist, so resolution silently falls back: ${missing.join(', ')}`,
  );
});

test('every bundled configuration the lens table names is a section of this file', () => {
  // The other direction of the same defect. A table row pointing at a bundled
  // section that does not exist leaves a lens with no source at all, and the
  // Spec Pair lens has no repository copy to fall back to.
  const document = fs.readFileSync(path.join(UNIT_ROOT, 'roast-trusted-lenses.md'), 'utf8');
  const rows = [...document.matchAll(/^\| ([^|]+?) \| ([^|]+?) \| `(## [^`]+)` \|$/gm)];
  assert.ok(rows.length >= 4, 'the lens table no longer names its bundled configurations');

  const missing = rows
    .map((row) => row[3])
    .filter((heading) => !new RegExp(`^${heading}\\s*$`, 'm').test(document));
  assert.deepEqual(missing, [], `named but absent from this file: ${missing.join(', ')}`);

  const specRow = rows.find((row) => row[1] === 'Spec Pair');
  assert.ok(specRow, 'the specification-pair lens is no longer declared');
  assert.equal(specRow[2], 'none; bundled only');
  assert.match(
    document,
    /The Spec Pair lens has no repository coach agent and resolves at step 3/,
    'a lens with no repository copy must say so, or a missing file reads as a failed check',
  );
});

test('the bundled spec lens carries the nano authority and the review boundaries', () => {
  const document = fs.readFileSync(path.join(UNIT_ROOT, 'roast-trusted-lenses.md'), 'utf8');
  const section = document.split(/^## Spec Pair Lens\s*$/m)[1].split(/^## /m)[0];

  for (const requirement of [
    'may elaborate the nano artifact and may never\noverride it',
    'the nano artifact is\n  right and the full artifact carries the defect',
    'observable, unambiguous, non-duplicative',
    'never approve a specification',
    'never make the product decision the specification left open',
    'never select\narchitecture, author Gherkin, create tickets, or implement',
    'Native severity labels: Blocker, Improvement, Nit, Evidence gap.',
    'Never the author.',
  ]) {
    assert.ok(section.includes(requirement), `the spec lens no longer states: ${requirement}`);
  }
});

test('the coordinator emits every heading the resolution order requires of it', () => {
  const document = fs.readFileSync(path.join(UNIT_ROOT, 'roast-trusted-lenses.md'), 'utf8');
  const coordinator = fs.readFileSync(
    path.join(REPOSITORY_ROOT, 'agents', 'artifact-roastmaster.agent.md'),
    'utf8',
  );

  const required = [...document.matchAll(/`(#{1,2} [A-Z][A-Za-z ]*)`/g)]
    .map((match) => match[1])
    .filter((heading) =>
      ['# Artifact Roastmaster', '## Inputs', '## Coordinate Mode', '## Synthesize Mode', '## Final Output'].includes(
        heading,
      ),
    );
  assert.equal(new Set(required).size, 5, 'the required-heading list changed shape');

  const missing = [...new Set(required)].filter(
    (heading) => !new RegExp(`^${heading}\\s*$`, 'm').test(coordinator),
  );
  assert.deepEqual(
    missing,
    [],
    `the coordinator no longer emits ${missing.join(', ')}, so every resolution would fail`,
  );
});
