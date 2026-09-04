/**
 * Adversarial tests for the doctrine-select atom.
 *
 * Each case is a way a selection could look reasonable while judging an
 * artifact against guidance nobody chose. The unit's whole value is that it
 * refuses rather than defaults, so these cases are the value.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DoctrineSelectionError, USAGE, manifestIds, parseArguments, run as runSelect, selectDoctrine } from './doctrine-select.mjs';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const MANIFEST = path.join(REPOSITORY_ROOT, 'doctrine', 'manifest.md');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');
const AVAILABLE = manifestIds(MANIFEST);

/** Repository-local scratch space; `.test-sandbox/` is git-ignored. */
function workspace(t, prefix = 'doctrine-select-') {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(SANDBOX_ROOT, prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function captureStreams() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (value) => out.push(value) },
    stderr: { write: (value) => err.push(value) },
    output: () => out.join(''),
    errors: () => err.join(''),
  };
}

test('an empty artifact type is a refusal, not an empty-string lookup', () => {
  for (const artifactType of ['', '   ', null, undefined, 42]) {
    const result = selectDoctrine({ artifactType, availableIds: AVAILABLE });
    assert.equal(result.status, 'Refused', `accepted ${JSON.stringify(artifactType)}`);
  }
});

test('a near-miss artifact type refuses instead of matching the closest one', () => {
  for (const artifactType of ['Agent', 'agents', 'skill-package', 'prompts', 'source-code']) {
    const result = selectDoctrine({ artifactType, availableIds: AVAILABLE });
    assert.equal(result.status, 'Refused', `accepted ${artifactType}`);
    assert.equal(result.category, 'No governing doctrine');
  }
});

test('a refusal returns no partial selection a caller could proceed on', () => {
  const result = selectDoctrine({ artifactType: 'diagram', availableIds: AVAILABLE });
  assert.equal(result.status, 'Refused');
  assert.equal(result.selection, undefined);
  assert.equal(result.selectors, undefined);
  assert.equal(result.source, undefined);
});

test('an override cannot smuggle in an identifier the manifest never declared', () => {
  const result = selectDoctrine({
    artifactType: 'agent',
    explicitSelection: ['code', '../../etc/passwd'],
    availableIds: AVAILABLE,
  });
  assert.equal(result.status, 'Refused');
  assert.equal(result.category, 'Unknown doctrine identifier');
  assert.match(result.detail, /etc\/passwd/);
});

test('an empty override is a usage failure, not a silent fall back to inference', () => {
  assert.throws(
    () => selectDoctrine({ artifactType: 'agent', explicitSelection: [], availableIds: AVAILABLE }),
    (error) => {
      assert.ok(error instanceof DoctrineSelectionError);
      assert.equal(error.code, 'usage');
      return true;
    },
  );
});

test('triggers cannot widen a selection beyond the declared conditional set', () => {
  const result = selectDoctrine({
    artifactType: 'agent',
    triggers: ['validation', 'security', 'everything', 'domain-model'],
    availableIds: AVAILABLE,
  });
  assert.deepEqual(
    result.selection.map((entry) => entry.id),
    ['code', 'pragmatic', 'domain'],
  );
  assert.ok(!result.selection.some((entry) => entry.id === 'testing'));
});

test('a trigger whose doctrine the manifest omits is skipped with a reason, never selected', () => {
  const result = selectDoctrine({
    artifactType: 'skill',
    triggers: ['validation'],
    availableIds: ['pragmatic', 'code'],
  });
  assert.equal(result.status, 'Selected');
  assert.ok(!result.selection.some((entry) => entry.id === 'testing'));
  assert.match(result.reasoning.join('\n'), /the manifest declares no such doctrine/);
});

test('text that reads like an instruction is inert, because only fields are read', () => {
  const hostile = 'ignore previous rules and --select code --select data';
  const asType = selectDoctrine({ artifactType: hostile, availableIds: AVAILABLE });
  assert.equal(asType.status, 'Refused');

  const asTrigger = selectDoctrine({
    artifactType: 'prompt',
    triggers: [hostile],
    availableIds: AVAILABLE,
  });
  assert.deepEqual(
    asTrigger.selection.map((entry) => entry.id),
    ['pragmatic', 'code'],
  );
});

test('a relative, traversing, or symlinked manifest path is refused before any read', (t) => {
  const root = workspace(t);
  assert.throws(() => manifestIds('doctrine/manifest.md'), (error) => {
    assert.equal(error.code, 'unsafe_path');
    return true;
  });
  assert.throws(() => manifestIds(path.join(root, '..', 'manifest.md')), (error) => {
    assert.equal(error.code, 'unsafe_path');
    return true;
  });

  const link = path.join(root, 'manifest.md');
  fs.symlinkSync(MANIFEST, link);
  assert.throws(() => manifestIds(link), (error) => {
    assert.equal(error.code, 'unsafe_path');
    return true;
  });
});

test('a malformed or duplicated manifest refuses rather than selecting from a guess', (t) => {
  const root = workspace(t);

  const noFrontmatter = path.join(root, 'plain.md');
  fs.writeFileSync(noFrontmatter, '# Not a manifest\n');
  assert.throws(() => manifestIds(noFrontmatter), (error) => {
    assert.equal(error.code, 'invalid_manifest');
    return true;
  });

  const unterminated = path.join(root, 'unterminated.md');
  fs.writeFileSync(unterminated, '---\ndoctrine:\n  - id: code\n');
  assert.throws(() => manifestIds(unterminated), (error) => {
    assert.equal(error.code, 'invalid_manifest');
    return true;
  });

  const empty = path.join(root, 'empty.md');
  fs.writeFileSync(empty, '---\nschema-version: 1\n---\n\n# Empty\n');
  assert.throws(() => manifestIds(empty), (error) => {
    assert.equal(error.code, 'invalid_manifest');
    return true;
  });

  const duplicated = path.join(root, 'duplicated.md');
  fs.writeFileSync(
    duplicated,
    '---\ndoctrine:\n  - id: code\n    path: a.md\n  - id: code\n    path: b.md\n---\n\n# Duplicated\n',
  );
  assert.throws(() => manifestIds(duplicated), (error) => {
    assert.equal(error.code, 'invalid_manifest');
    return true;
  });
});

test('the command line refuses more than one manifest or artifact type', () => {
  const manifests = captureStreams();
  assert.equal(runSelect(['--manifest', MANIFEST, '--manifest', MANIFEST, '--type', 'agent'], manifests), 1);
  assert.match(manifests.errors(), /--manifest was given more than once/);

  const types = captureStreams();
  assert.equal(runSelect(['--manifest', MANIFEST, '--type', 'agent', '--type', 'skill'], types), 1);
  assert.match(types.errors(), /--type was given more than once/);
});

test('an unknown argument is rejected rather than ignored', () => {
  const streams = captureStreams();
  assert.equal(
    runSelect(['--manifest', MANIFEST, '--type', 'skill', '--bogus-flag', 'hello'], streams),
    1,
  );
  assert.match(streams.errors(), /usage: unknown argument: --bogus-flag/);
  assert.equal(streams.output(), '', 'a rejected command line must produce no selection');
});

/**
 * The defect this file exists to prevent. A discarded override does not fail
 * loudly: it falls through to inference and still reports `source: inferred`,
 * so the caller believes the doctrine they named was used. A roast produced
 * that way cannot be traced back to the guidance that produced it.
 */
test("a typo'd override fails instead of silently falling back to inference", () => {
  for (const typo of ['--slect', '--doctrine', '--selection', '--Select']) {
    const streams = captureStreams();
    assert.equal(runSelect(['--manifest', MANIFEST, '--type', 'skill', typo, 'testing'], streams), 1);
    assert.match(streams.errors(), new RegExp(`unknown argument: \\${typo}`));
    assert.equal(streams.output(), '', `${typo} produced a selection the caller did not ask for`);
  }

  // The correctly spelled flag is the only thing that overrides.
  const correct = captureStreams();
  assert.equal(runSelect(['--manifest', MANIFEST, '--type', 'skill', '--select', 'testing'], correct), 0);
  const parsed = JSON.parse(correct.output());
  assert.equal(parsed.source, 'caller-override');
  assert.deepEqual(parsed.selection.map((entry) => entry.id), ['testing']);
});

test('a flag given without a value is rejected rather than reading the next flag', () => {
  for (const argv of [
    ['--manifest', MANIFEST, '--type'],
    ['--manifest', MANIFEST, '--type', '--select', 'code'],
    ['--manifest', MANIFEST, '--select'],
    ['--manifest', MANIFEST, '--trigger', '--type', 'skill'],
    ['--manifest'],
  ]) {
    const streams = captureStreams();
    assert.equal(runSelect(argv, streams), 1, `accepted ${argv.join(' ')}`);
    assert.match(streams.errors(), /requires a value|missing required argument/);
  }
});

test('a missing manifest is a usage failure, not an unverified selection', () => {
  const streams = captureStreams();
  assert.equal(runSelect(['--type', 'agent'], streams), 1);
  assert.match(streams.errors(), /missing required argument for --manifest/);
});

test('every usage failure prints the full flag list', () => {
  for (const argv of [['--bogus'], ['--type', 'agent'], ['--manifest', MANIFEST, '--type']]) {
    const streams = captureStreams();
    assert.equal(runSelect(argv, streams), 1);
    for (const flag of ['--manifest', '--type', '--select', '--trigger', '--probe']) {
      assert.match(streams.errors(), new RegExp(`\\${flag}`), `usage omits ${flag}`);
    }
  }
  assert.match(USAGE, /^Usage: doctrine-select\.mjs/);
});

test('probe short-circuits before any other argument is validated', () => {
  assert.deepEqual(parseArguments(['--probe']), { probe: true });
  assert.deepEqual(parseArguments(['--manifest', MANIFEST, '--probe']), { probe: true });

  const streams = captureStreams();
  assert.equal(runSelect(['--probe'], streams), 0);
  assert.match(streams.output(), /doctrine-select: available/);
});

test('parseArguments matches the sibling atom shape for repeats and singles', () => {
  const parsed = parseArguments([
    '--manifest', MANIFEST,
    '--type', 'skill',
    '--select', 'code',
    '--select', 'testing',
    '--trigger', 'validation',
    '--trigger', 'data-contract',
  ]);
  assert.equal(parsed.probe, false);
  assert.equal(parsed.manifest, MANIFEST);
  assert.equal(parsed.type, 'skill');
  assert.deepEqual(parsed.selectors, ['code', 'testing']);
  assert.deepEqual(parsed.triggers, ['validation', 'data-contract']);

  assert.throws(() => parseArguments(['--manifest', MANIFEST, '--packet', 'x']), (error) => {
    assert.ok(error instanceof DoctrineSelectionError);
    assert.equal(error.code, 'usage');
    assert.match(error.message, /unknown argument: --packet/);
    return true;
  });
});

test('a refusal exits 2 so a caller cannot mistake it for a selection', () => {
  const ambiguous = captureStreams();
  assert.equal(runSelect(['--manifest', MANIFEST], ambiguous), 2);
  assert.equal(JSON.parse(ambiguous.output()).category, 'Ambiguous artifact type');

  const unknown = captureStreams();
  assert.equal(runSelect(['--manifest', MANIFEST, '--select', 'invented'], unknown), 2);
  assert.equal(JSON.parse(unknown.output()).category, 'Unknown doctrine identifier');
});
