/**
 * Behavioural tests for the preview -> confirm -> safety -> stage -> commit ->
 * readback -> rollback cycle, including the four provider classes end to end
 * and the command interface exposed as an executable.
 *
 * Every refusal is proven by the absence of a file, not by a returned string.
 * Every failure injection is proven by the residue on disk matching what the
 * status claims. Scratch repositories live under the git-ignored
 * `.test-sandbox/` directory so the runtime never touches the operating-system
 * temporary directory.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyRemote, normalizeContext } from '../repository-context/repository-context.mjs';
import { renderArtifacts } from '../context-artifacts/context-artifacts.mjs';
import {
  CONFIRMATION_GRANT,
  WRITE_STATUSES,
  applyPreview,
  buildPreview,
  _setPlatformCapabilityForTests,
} from './write-gate.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const WRITE_GATE_MJS = path.join(UNIT_ROOT, 'write-gate.mjs');
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

/**
 * Try to create a symbolic link. On Windows, `fs.symlinkSync` requires
 * Developer Mode or administrator elevation; when neither is granted the
 * kernel returns `EPERM` (or, less commonly, `ENOSYS`/`UNKNOWN`). A test that
 * cannot create its symlink cannot exercise its scenario and skips itself
 * — never silently passing — while other tests continue.
 */
function trySymlinkOrSkip(t, target, link, why) {
  try {
    fs.symlinkSync(target, link);
    return true;
  } catch (error) {
    if (
      process.platform === 'win32'
      && (error.code === 'EPERM' || error.code === 'ENOSYS' || error.code === 'UNKNOWN')
    ) {
      t.skip(`${why} — creating a symlink on Windows requires Developer Mode or elevation (${error.code})`);
      return false;
    }
    throw error;
  }
}

function workspace(t) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  const root = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX_ROOT, 'write-gate-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

function grant(preview) {
  return { previewId: preview.previewId, grant: CONFIRMATION_GRANT };
}

function answers(overrides = {}) {
  return {
    defaultBranch: 'main',
    targetDirectory: '.agent/context',
    trackerOperations: ['read-item'],
    relationshipKinds: ['relates-to'],
    mutationVocabulary: ['open', 'close'],
    itemTypes: ['issue'],
    labels: [{ name: 'bug', meaning: 'a defect' }],
    states: [
      { name: 'open', meaning: 'the item is unresolved' },
      { name: 'closed', meaning: 'the item is resolved' },
    ],
    domain: { name: 'Widgets', summary: 'a catalog', vocabularySources: ['docs/glossary.md'] },
    ...overrides,
  };
}

test('an overwrite that gains a hard link after preview is refused before truncation', (t) => {
  const root = workspace(t);
  const target = path.join(root, 'target.md');
  fs.writeFileSync(target, 'prior');
  const preview = buildPreview({
    repositoryRoot: root,
    artifacts: [{ path: 'target.md', content: 'next' }],
  });
  fs.linkSync(target, path.join(root, 'alias.md'));
  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'unsafe-target');
  assert.equal(fs.readFileSync(target, 'utf8'), 'prior');
  assert.equal(fs.readFileSync(path.join(root, 'alias.md'), 'utf8'), 'prior');
});

test('same-byte inode replacement between stale check and open is refused without truncation', (t) => {
  const root = workspace(t);
  const target = path.join(root, 'target.md');
  fs.writeFileSync(target, 'prior');
  const preview = buildPreview({
    repositoryRoot: root,
    artifacts: [{ path: 'target.md', content: 'next' }],
  });
  let replacementIdentity;
  const result = applyPreview(
    { repositoryRoot: root, preview, confirmation: grant(preview) },
    {
      fault: ({ phase, relativePath }) => {
        if (phase !== 'before-mutation' || relativePath !== 'target.md') return;
        const replacement = path.join(root, 'replacement.md');
        fs.writeFileSync(replacement, 'prior');
        replacementIdentity = fs.lstatSync(replacement).ino;
        fs.renameSync(replacement, target);
      },
    },
  );
  assert.equal(result.status, 'stale-preview');
  assert.equal(result.written, false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'prior');
  assert.equal(fs.lstatSync(target).ino, replacementIdentity);
});

test('overwrite rollback refuses a concurrent replacement inode', (t) => {
  const root = workspace(t);
  const target = path.join(root, 'target.md');
  fs.writeFileSync(target, 'prior');
  const preview = buildPreview({
    repositoryRoot: root,
    artifacts: [{ path: 'target.md', content: 'next' }],
  });
  let replacementIdentity;
  const result = applyPreview(
    { repositoryRoot: root, preview, confirmation: grant(preview) },
    {
      fault: ({ phase, relativePath }) => {
        if (relativePath !== 'target.md') return;
        if (phase === 'after-mutation') throw new Error('force rollback');
        if (phase === 'during-rollback') {
          const replacement = path.join(root, 'replacement.md');
          fs.writeFileSync(replacement, 'concurrent');
          replacementIdentity = fs.lstatSync(replacement).ino;
          fs.renameSync(replacement, target);
        }
      },
    },
  );
  assert.equal(result.status, 'blocked');
  assert.equal(fs.readFileSync(target, 'utf8'), 'concurrent');
  assert.equal(fs.lstatSync(target).ino, replacementIdentity);
  assert.ok(
    result.rollbackRemaining.some(
      (entry) => entry.relativePath === 'target.md' && entry.reason === 'EIDENTITY',
    ),
    JSON.stringify(result.rollbackRemaining),
  );
});

test('create rollback reports residue when a concurrent hard-link alias preserves the inode', (t) => {
  const root = workspace(t);
  const target = path.join(root, 'target.md');
  const alias = path.join(root, 'alias.md');
  const preview = buildPreview({
    repositoryRoot: root,
    artifacts: [{ path: 'target.md', content: 'created' }],
  });
  const result = applyPreview(
    { repositoryRoot: root, preview, confirmation: grant(preview) },
    {
      fault: ({ phase, relativePath }) => {
        if (phase !== 'after-mutation' || relativePath !== 'target.md') return;
        fs.linkSync(target, alias);
        throw new Error('force rollback after alias creation');
      },
    },
  );
  assert.equal(result.status, 'blocked');
  assert.equal(fs.readFileSync(target, 'utf8'), 'created');
  assert.equal(fs.readFileSync(alias, 'utf8'), 'created');
  assert.ok(
    result.rollbackRemaining.some(
      (entry) => entry.relativePath === 'target.md' && entry.reason === 'hard-link-residue',
    ),
    JSON.stringify(result.rollbackRemaining),
  );
});

const PROVIDER_INPUTS = {
  github: { ...classifyRemote('https://github.com/acme/widgets.git'), ...answers() },
  gitlab: { ...classifyRemote('https://gitlab.com/group/sub/widgets.git'), ...answers() },
  'azure-devops': { ...classifyRemote('https://dev.azure.com/contoso/Platform/_git/widgets'), ...answers() },
  local: {
    provider: 'local',
    host: 'tracker.internal',
    organization: 'ops',
    repository: 'widgets',
    customTrackerInstructions: 'Read items from ops/board.json.',
    ...answers(),
  },
};

test('the write statuses are exactly the five the gate reports', () => {
  assert.deepEqual([...WRITE_STATUSES], [
    'configured',
    'cancelled',
    'unsafe-target',
    'stale-preview',
    'blocked',
  ]);
});

for (const [provider, input] of Object.entries(PROVIDER_INPUTS)) {
  test(`${provider}: classify -> normalize -> render -> preview -> apply writes verified bytes`, (t) => {
    const root = workspace(t);
    const normalized = normalizeContext(input);
    assert.equal(normalized.status, 'complete', provider);

    const artifacts = renderArtifacts(normalized.context);
    const preview = buildPreview({ repositoryRoot: root, artifacts });
    assert.ok(preview.safety.every((entry) => entry.safe), `${provider} targets are safe`);

    const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
    assert.equal(result.status, 'configured', provider);
    assert.equal(result.readback.length, artifacts.length);

    for (const artifact of artifacts) {
      const absolute = path.join(root, artifact.path);
      const bytes = fs.readFileSync(absolute);
      assert.equal(sha256(bytes.toString('utf8')), artifact.sha256, `${provider} ${artifact.path} bytes`);
      const readback = result.readback.find((entry) => entry.relativePath === artifact.path);
      assert.equal(readback.sha256, artifact.sha256, `${provider} ${artifact.path} readback hash`);
      assert.equal(readback.byteLength, bytes.length);
      assert.equal(readback.change, 'created');
    }
  });
}

test('a truthy non-token confirmation does not confirm and writes nothing', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  for (const confirmation of [true, 'yes', 1, { ok: true }, { previewId: preview.previewId, grant: true }]) {
    const result = applyPreview({ repositoryRoot: root, preview, confirmation });
    assert.equal(result.status, 'cancelled');
    assert.equal(result.written, false);
  }
  for (const artifact of artifacts) {
    assert.equal(fs.existsSync(path.join(root, artifact.path)), false);
  }
});

test('a confirmation for a different preview does not confirm', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  const result = applyPreview({
    repositoryRoot: root,
    preview,
    confirmation: { previewId: 'a-different-preview', grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(fs.existsSync(path.join(root, artifacts[0].path)), false);
});

test('a path escaping the repository is refused and writes nothing', (t) => {
  const root = workspace(t);
  const preview = buildPreview({
    repositoryRoot: root,
    artifacts: [{ path: '../escape.md', content: 'x' }],
  });
  assert.equal(preview.safety[0].safe, false);
  assert.equal(preview.safety[0].reason, 'path-escape');

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'unsafe-target');
  assert.equal(fs.existsSync(path.join(path.dirname(root), 'escape.md')), false);
});

test('a symlinked target is refused and writes nothing', (t) => {
  const root = workspace(t);
  fs.writeFileSync(path.join(root, 'actual.md'), 'real');
  if (!trySymlinkOrSkip(t, path.join(root, 'actual.md'), path.join(root, 'target.md'), 'symlinked target refusal')) return;

  const preview = buildPreview({ repositoryRoot: root, artifacts: [{ path: 'target.md', content: 'new' }] });
  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'unsafe-target');
  assert.equal(result.reason, 'symlink-component');
  assert.equal(fs.readFileSync(path.join(root, 'actual.md'), 'utf8'), 'real');
});

test('a symlinked parent directory is refused and writes nothing', (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, 'real'));
  if (!trySymlinkOrSkip(t, path.join(root, 'real'), path.join(root, 'link'), 'symlinked parent refusal')) return;

  const preview = buildPreview({ repositoryRoot: root, artifacts: [{ path: 'link/file.md', content: 'new' }] });
  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'unsafe-target');
  assert.equal(fs.existsSync(path.join(root, 'real', 'file.md')), false);
});

test('a target that is a directory is refused as not a regular file', (t) => {
  const root = workspace(t);
  fs.mkdirSync(path.join(root, 'occupied.md'));

  const preview = buildPreview({ repositoryRoot: root, artifacts: [{ path: 'occupied.md', content: 'new' }] });
  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'unsafe-target');
  assert.equal(result.reason, 'not-regular-file');
});

test('one unsafe target in the set prevents any target from being written', (t) => {
  const root = workspace(t);
  const preview = buildPreview({
    repositoryRoot: root,
    artifacts: [
      { path: '.agent/context/issue-tracker.md', content: 'safe' },
      { path: '../escape.md', content: 'unsafe' },
    ],
  });
  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'unsafe-target');
  assert.equal(fs.existsSync(path.join(root, '.agent/context/issue-tracker.md')), false);
});

test('a target changed after the preview returns stale-preview and writes nothing', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  const mutated = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(mutated), { recursive: true });
  fs.writeFileSync(mutated, 'a concurrent write');

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'stale-preview');
  assert.equal(fs.readFileSync(mutated, 'utf8'), 'a concurrent write');
  assert.equal(fs.existsSync(path.join(root, artifacts[1].path)), false);
});

test('re-running with unchanged inputs is idempotent and reports unchanged', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);

  const first = buildPreview({ repositoryRoot: root, artifacts });
  const firstResult = applyPreview({ repositoryRoot: root, preview: first, confirmation: grant(first) });
  assert.equal(firstResult.status, 'configured');
  const before = artifacts.map((artifact) => fs.readFileSync(path.join(root, artifact.path)));

  const second = buildPreview({ repositoryRoot: root, artifacts });
  const secondResult = applyPreview({ repositoryRoot: root, preview: second, confirmation: grant(second) });
  assert.equal(secondResult.status, 'configured');
  assert.deepEqual(secondResult.readback.map((entry) => entry.change), artifacts.map(() => 'unchanged'));

  const after = artifacts.map((artifact) => fs.readFileSync(path.join(root, artifact.path)));
  before.forEach((bytes, index) => assert.ok(bytes.equals(after[index]), 'bytes are identical'));
});

test('an overwrite of a stale-but-present target is reported and read back', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);

  const seedPath = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  fs.writeFileSync(seedPath, 'an older configuration');

  const preview = buildPreview({ repositoryRoot: root, artifacts });
  assert.equal(preview.entries[0].action, 'overwrite');

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'configured');
  assert.equal(result.readback[0].change, 'overwritten');
  assert.equal(fs.readFileSync(seedPath, 'utf8'), artifacts[0].content);
});

// --- SR-01: TOCTOU no-follow at final open ---------------------------------

test('a target swapped into a symlink between preview and commit is refused', (t) => {
  const root = workspace(t);
  const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX_ROOT, 'outside-')));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
  const outsidePath = path.join(outsideDir, 'sneaky.md');
  fs.writeFileSync(outsidePath, 'off-limits');

  const relativePath = '.agent/context/target.md';
  const artifacts = [{ path: relativePath, content: 'legitimate' }];
  const preview = buildPreview({ repositoryRoot: root, artifacts });
  assert.equal(preview.entries[0].action, 'create');

  // Between the preview and the write, swap the target into a symlink that
  // points outside the sandbox. The gate must refuse and never touch the
  // outside file.
  fs.mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
  if (!trySymlinkOrSkip(t, outsidePath, path.join(root, relativePath), 'SR-01 target swap')) return;

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.ok(['unsafe-target', 'stale-preview'].includes(result.status), `${result.status}: ${result.detail}`);
  assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'off-limits');
});

test('a parent directory swapped into a symlink between preview and commit is refused', (t) => {
  const root = workspace(t);
  const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX_ROOT, 'outside-')));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));

  const relativePath = 'ctx/target.md';
  const artifacts = [{ path: relativePath, content: 'legitimate' }];
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Preview built for a non-existent parent. Now replace the parent path with
  // a symlink pointing outside the sandbox before applying.
  if (!trySymlinkOrSkip(t, outsideDir, path.join(root, 'ctx'), 'SR-01 parent swap')) return;

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.ok(['unsafe-target', 'stale-preview'].includes(result.status), `${result.status}: ${result.detail}`);
  assert.equal(fs.existsSync(path.join(outsideDir, 'target.md')), false);
});

// --- SR-02: identity binds prior state -------------------------------------

test('mutating existingSha256 on a supplied preview does not defeat the stale check', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // First write is fine.
  const first = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(first.status, 'configured');

  // Change the target on disk, then hand a mutated copy of the ORIGINAL
  // preview to apply, patching existingSha256 to the new on-disk hash.
  const mutated = path.join(root, artifacts[0].path);
  fs.writeFileSync(mutated, 'a concurrent write');
  const newHash = sha256('a concurrent write');

  const tampered = {
    previewId: preview.previewId,
    entries: preview.entries.map((entry, index) => (
      index === 0 ? { ...entry, existingSha256: newHash } : { ...entry }
    )),
    safety: preview.safety.map((entry) => ({ ...entry })),
  };

  const result = applyPreview({
    repositoryRoot: root,
    preview: tampered,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'stale-preview');
  assert.equal(fs.readFileSync(mutated, 'utf8'), 'a concurrent write');
});

test('duplicate target paths in one preview are refused before a write is attempted', (t) => {
  const root = workspace(t);
  assert.throws(
    () => buildPreview({
      repositoryRoot: root,
      artifacts: [
        { path: 'a/one.md', content: 'first' },
        { path: 'a/one.md', content: 'second' },
      ],
    }),
    (error) => error.code === 'usage',
  );
});

// --- SR-03: mid-write failures roll back and never throw ------------------

test('a commit-time failure returns blocked with no undisclosed residue on disk', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);

  // Force a mkdir failure on the second artifact by making its parent path a
  // regular file rather than a directory. The first artifact will commit, the
  // second will fail, and the atom must roll back the first and report
  // `blocked` describing the residue.
  const secondArtifactDir = path.dirname(path.join(root, artifacts[1].path));
  const parentOfSecondDir = path.dirname(secondArtifactDir);
  fs.mkdirSync(parentOfSecondDir, { recursive: true });
  // secondArtifactDir is `.agent/context`, whose parent is `.agent`. We must
  // force a failure while creating a file inside `.agent/context`, so remove
  // `.agent/context` and put a file at that path.
  if (fs.existsSync(secondArtifactDir)) {
    fs.rmSync(secondArtifactDir, { recursive: true, force: true });
  }
  fs.writeFileSync(secondArtifactDir, 'not a directory');

  const preview = buildPreview({ repositoryRoot: root, artifacts });
  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });

  assert.ok(WRITE_STATUSES.includes(result.status), result.status);
  assert.notEqual(result.status, 'configured');
  // No exception, no undisclosed file. The first artifact — which shares the
  // same directory — either was rolled back or was never committed, but must
  // not remain as bytes we never disclosed.
  assert.equal(result.written, false);
  const firstAbsolute = path.join(root, artifacts[0].path);
  const firstExistsAfter = fs.existsSync(firstAbsolute) && fs.lstatSync(firstAbsolute).isFile();
  if (firstExistsAfter) {
    // If it exists it must be named in the residue so the operator knows.
    const named = (result.rollbackRemaining ?? []).some((entry) => entry.relativePath === artifacts[0].path);
    assert.ok(named, `residue must name ${artifacts[0].path} if it survived: ${JSON.stringify(result)}`);
  }
});

test('a readback failure rolls back the whole commit and reports blocked', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Wrap fs.readFileSync so that reading through a numeric fd (the readback
  // path) throws exactly once. The write completes; the readback fails.
  const originalReadFileSync = fs.readFileSync;
  let failed = false;
  fs.readFileSync = (target, ...rest) => {
    if (!failed && typeof target === 'number') {
      failed = true;
      const error = new Error('injected readback failure');
      error.code = 'EIO';
      throw error;
    }
    return originalReadFileSync(target, ...rest);
  };
  t.after(() => { fs.readFileSync = originalReadFileSync; });

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.written, false);
  // The rolled-back write leaves nothing on disk for the failed target.
  assert.equal(fs.existsSync(path.join(root, artifacts[0].path)), false);
});

test('a filesystem write failure returns blocked instead of throwing', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Force writeFileSync into a fd to fail once, mid-commit.
  const originalWriteFileSync = fs.writeFileSync;
  let failed = false;
  fs.writeFileSync = (target, data, ...rest) => {
    if (!failed && typeof target === 'number') {
      failed = true;
      const error = new Error('injected write failure');
      error.code = 'ENOSPC';
      throw error;
    }
    return originalWriteFileSync(target, data, ...rest);
  };
  t.after(() => { fs.writeFileSync = originalWriteFileSync; });

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.written, false);
});

// --- SR-06: command interface is the enforced mutation path ---------------

test('the --probe subcommand reports availability with exit 0', () => {
  const buildResult = spawnSync('node', [WRITE_GATE_MJS, '--probe'], { encoding: 'utf8' });
  assert.equal(buildResult.status, 0);
  assert.match(buildResult.stdout, /write-gate: available/);
});

test('R2-07: apply-preview without a confirmed preview truly refuses the write', (t) => {
  // Regression: the prior test with this name only ran --probe. Actually
  // exercise the apply-preview path with an unconfirmed request and assert
  // that (a) the exit code is the documented `2 findings`, (b) the status
  // is `cancelled`, and (c) no target file exists on disk after the call.
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);

  const built = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'build-preview'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, artifacts }) },
  );
  assert.equal(built.status, 0, `build-preview stderr: ${built.stderr}`);
  const preview = JSON.parse(built.stdout);

  // The confirmation payload is deliberately absent — apply-preview must
  // refuse and write nothing.
  const attempted = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'apply-preview'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, preview }) },
  );
  assert.equal(attempted.status, 2, `expected findings exit code; stderr: ${attempted.stderr}`);
  const result = JSON.parse(attempted.stdout);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.written, false);
  for (const entry of preview.entries) {
    assert.equal(fs.existsSync(path.join(root, entry.relativePath)), false);
  }
});

test('build-preview and apply-preview together write only through a matching confirmation', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);

  const built = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'build-preview'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, artifacts }) },
  );
  assert.equal(built.status, 0, `stderr: ${built.stderr}`);
  const preview = JSON.parse(built.stdout);
  assert.match(preview.previewId, /^[0-9a-f]{64}$/);

  // Without confirmation the executable refuses the write.
  const refused = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'apply-preview'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, preview, confirmation: { grant: 'not-the-token', previewId: preview.previewId } }) },
  );
  const refusedResult = JSON.parse(refused.stdout);
  assert.equal(refusedResult.status, 'cancelled');
  assert.equal(refused.status, 2);
  for (const entry of preview.entries) {
    assert.equal(fs.existsSync(path.join(root, entry.relativePath)), false);
  }

  // With the correct confirmation, the executable writes and reports back.
  const accepted = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'apply-preview'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, preview, confirmation: { grant: CONFIRMATION_GRANT, previewId: preview.previewId } }) },
  );
  const acceptedResult = JSON.parse(accepted.stdout);
  assert.equal(acceptedResult.status, 'configured');
  assert.equal(accepted.status, 0);
  for (const entry of preview.entries) {
    assert.ok(fs.existsSync(path.join(root, entry.relativePath)));
  }
});

test('the command interface reports an unknown subcommand as a usage error', () => {
  const result = spawnSync('node', [WRITE_GATE_MJS, 'no-such-subcommand'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const err = JSON.parse(result.stderr);
  assert.equal(err.error.code, 'usage');
});

// --- R2-01: a mutated absolutePath in the serialized payload cannot redirect
// the write; the schema check refuses the payload.

test('R2-01: a serialized preview with an added absolutePath field is refused before any write', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Simulate a caller round-tripping the preview through JSON and injecting
  // an `absolutePath` field pointing outside the sandbox. Even though the
  // confirmation carries the correct previewId, the schema check refuses
  // the payload.
  const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX_ROOT, 'r2-01-outside-')));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));

  const tampered = {
    previewId: preview.previewId,
    entries: preview.entries.map((entry) => ({
      relativePath: entry.relativePath,
      content: entry.content,
      sha256: entry.sha256,
      action: entry.action,
      existingSha256: entry.existingSha256,
      // Injected field: nothing in a legitimate serialized preview carries this.
      absolutePath: path.join(outsideDir, 'redirected.md'),
    })),
    safety: preview.safety.map((entry) => ({ ...entry })),
  };

  const result = applyPreview({
    repositoryRoot: root,
    preview: tampered,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'stale-preview');
  assert.equal(result.written, false);
  assert.match(result.detail, /absolutePath/);
  assert.equal(fs.existsSync(path.join(outsideDir, 'redirected.md')), false);
  // The intended target inside the sandbox is also not written.
  assert.equal(fs.existsSync(path.join(root, tampered.entries[0].relativePath)), false);
});

test('R2-01: an unknown top-level field in the preview payload is refused', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });
  const tampered = {
    previewId: preview.previewId,
    entries: preview.entries.map((entry) => ({
      relativePath: entry.relativePath,
      content: entry.content,
      sha256: entry.sha256,
      action: entry.action,
      existingSha256: entry.existingSha256,
    })),
    safety: preview.safety.map((entry) => ({ ...entry })),
    extraField: 'nope',
  };
  const result = applyPreview({
    repositoryRoot: root,
    preview: tampered,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'stale-preview');
});

test('R2-01: duplicate normalized target paths in the payload are refused', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });
  const tampered = {
    previewId: preview.previewId,
    entries: [
      // Duplicate the first entry so the payload has two entries pointing at
      // the same normalized target path.
      { ...preview.entries[0] },
      { ...preview.entries[0] },
    ],
    safety: [...preview.safety, ...preview.safety],
  };
  const result = applyPreview({
    repositoryRoot: root,
    preview: tampered,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'stale-preview');
  assert.match(result.detail, /duplicate/);
});

test('R2-01: a non-string content field is refused as a shape violation', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });
  const tampered = {
    previewId: preview.previewId,
    entries: [
      { ...preview.entries[0], content: 12345 },
      ...preview.entries.slice(1),
    ],
    safety: preview.safety.map((entry) => ({ ...entry })),
  };
  const result = applyPreview({
    repositoryRoot: root,
    preview: tampered,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'stale-preview');
});

// --- R2-02: confirmation binds to the exact previewId; a valid grant naming
// a different preview does not authorize the write, and a valid grant for a
// preview whose targets changed is still stale-preview.

test('R2-02: confirmation naming a different preview is refused as cancelled', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const previewA = buildPreview({ repositoryRoot: root, artifacts });

  // Build a second preview with different content so its previewId differs.
  const artifactsB = artifacts.map((entry, index) => (
    index === 0 ? { ...entry, content: `${entry.content}\n<!-- variant -->\n` } : entry
  ));
  const previewB = buildPreview({ repositoryRoot: root, artifacts: artifactsB });
  assert.notEqual(previewA.previewId, previewB.previewId);

  // Confirmation naming previewB is used to try to apply previewA. Even
  // though both grants are valid literals, the previewId does not match.
  const result = applyPreview({
    repositoryRoot: root,
    preview: previewA,
    confirmation: { previewId: previewB.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.written, false);
  for (const entry of previewA.entries) {
    assert.equal(fs.existsSync(path.join(root, entry.relativePath)), false);
  }
});

test('R2-02: correct confirmation but target changed after preview is stale-preview', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Between the preview and the apply, the operator (or another writer)
  // changed the target on disk. The confirmation still names the correct
  // previewId, but the state it was approving no longer holds.
  const mutated = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(mutated), { recursive: true });
  fs.writeFileSync(mutated, 'a concurrent write');

  const result = applyPreview({
    repositoryRoot: root,
    preview,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'stale-preview');
  assert.equal(result.written, false);
  // The concurrent write survives untouched.
  assert.equal(fs.readFileSync(mutated, 'utf8'), 'a concurrent write');
});

// --- R2-03: ancestor and root re-verification across the write window.

test('R2-03: a parent directory swapped between mkdir and open is refused as unsafe-target', (t) => {
  // Build a preview whose target lives two directories deep. The first
  // directory does not exist at inspection; between mkdir and open we swap
  // it into a symlink. The chain verification catches it.
  const root = workspace(t);
  const outsideDir = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX_ROOT, 'r2-03-swap-')));
  t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));

  const relativePath = 'nested/inside/target.md';
  const preview = buildPreview({
    repositoryRoot: root,
    artifacts: [{ path: relativePath, content: 'legit' }],
  });

  // Force a swap: precreate the outer dir as a symlink pointing outside the
  // sandbox before the apply runs. The walker refuses the symlink ancestor.
  if (!trySymlinkOrSkip(t, outsideDir, path.join(root, 'nested'), 'R2-03 parent swap')) return;

  const result = applyPreview({
    repositoryRoot: root,
    preview,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.ok(['unsafe-target', 'stale-preview'].includes(result.status), result.status);
  assert.equal(fs.existsSync(path.join(outsideDir, 'inside', 'target.md')), false);
});

test('R2-03: a repository root swapped between preview and commit is refused', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Replace the repository root with a different directory (same location
  // in the parent, but a different inode) between preview and apply.
  const shadowDir = fs.realpathSync(fs.mkdtempSync(path.join(SANDBOX_ROOT, 'r2-03-shadow-')));
  t.after(() => fs.rmSync(shadowDir, { recursive: true, force: true }));

  const parent = path.dirname(root);
  const rootName = path.basename(root);
  // Move original root aside, put shadow in its place.
  const originalSpot = path.join(parent, `${rootName}-original`);
  fs.renameSync(root, originalSpot);
  t.after(() => {
    try {
      if (fs.existsSync(root)) {
        fs.rmSync(root, { recursive: true, force: true });
      }
      fs.renameSync(originalSpot, root);
    } catch { /* noop */ }
  });
  if (!trySymlinkOrSkip(t, shadowDir, root, 'R2-03 root swap')) return;

  const result = applyPreview({
    repositoryRoot: root,
    preview,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  // Whether the run refuses at realpath or at chain-verification, nothing
  // outside the original root must be written.
  assert.notEqual(result.status, 'configured');
  assert.equal(fs.existsSync(path.join(shadowDir, artifacts[0].path)), false);
});

test('R2-03: target content changed after confirmation is refused before truncation', (t) => {
  // The preview inspection captured existingSha256 = X. Between confirmation
  // and the truncating open, the target's on-disk content flips. The
  // pre-open re-verification of the prior content hash must catch it and
  // return stale-preview without truncating.
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const target = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'initial contents');

  const preview = buildPreview({ repositoryRoot: root, artifacts });
  // Both entries are `overwrite` for the first, `create` for the others.
  // Just before applying, change the first target's bytes.
  fs.writeFileSync(target, 'flipped contents');

  const result = applyPreview({
    repositoryRoot: root,
    preview,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'stale-preview');
  // The flipped bytes survive untouched — no truncation occurred.
  assert.equal(fs.readFileSync(target, 'utf8'), 'flipped contents');
});

// --- R2-04: rollback correctness across write, close, and rollback failures.

test('R2-04: write failure after truncation leaves the target restored to prior bytes', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const target = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'the prior contents that must survive');
  const priorBytes = fs.readFileSync(target);

  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Inject a failure at the first writeFileSync(fd, ...) call.
  const originalWriteFileSync = fs.writeFileSync;
  let failed = false;
  fs.writeFileSync = (target_, data, ...rest) => {
    if (!failed && typeof target_ === 'number') {
      failed = true;
      const error = new Error('injected write failure');
      error.code = 'EIO';
      throw error;
    }
    return originalWriteFileSync(target_, data, ...rest);
  };
  t.after(() => { fs.writeFileSync = originalWriteFileSync; });

  const result = applyPreview({
    repositoryRoot: root,
    preview,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.written, false);
  // The truncated file was restored to the prior bytes via reverse rollback.
  const after = fs.readFileSync(target);
  assert.ok(priorBytes.equals(after), 'target bytes must be restored to the prior snapshot');
});

test('R2-04: create failure after truncating open removes the newly created file', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Force writeFileSync into a fd to fail once. The first entry is a
  // `create`, and after the failure rollback must delete it.
  const originalWriteFileSync = fs.writeFileSync;
  let failed = false;
  fs.writeFileSync = (target_, data, ...rest) => {
    if (!failed && typeof target_ === 'number') {
      failed = true;
      const error = new Error('injected write failure');
      error.code = 'EIO';
      throw error;
    }
    return originalWriteFileSync(target_, data, ...rest);
  };
  t.after(() => { fs.writeFileSync = originalWriteFileSync; });

  const result = applyPreview({
    repositoryRoot: root,
    preview,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'blocked');
  // The created-then-failed file has been removed by rollback.
  const stat = fs.existsSync(path.join(root, artifacts[0].path));
  assert.equal(stat, false, 'newly created target must be removed on rollback');
});

test('R2-04: close failure records rollback and restores prior bytes', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const target = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'prior');
  const priorBytes = fs.readFileSync(target);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Arm the close failure only for the closeSync that immediately follows a
  // successful writeFileSync into a numeric fd — that is the write-gate's
  // own close call inside the commit. All the other closeSync calls
  // (snapshot and readback closes) run inside try/catch/finally guards, so
  // failing them silently would be swallowed and the test would prove
  // nothing.
  const originalWriteFileSync = fs.writeFileSync;
  const originalCloseSync = fs.closeSync;
  let armed = false;
  fs.writeFileSync = (target_, data, ...rest) => {
    const result = originalWriteFileSync(target_, data, ...rest);
    if (typeof target_ === 'number') {
      armed = true;
    }
    return result;
  };
  fs.closeSync = (fd) => {
    if (armed) {
      armed = false;
      originalCloseSync(fd);
      const error = new Error('injected close failure');
      error.code = 'EIO';
      throw error;
    }
    return originalCloseSync(fd);
  };
  t.after(() => {
    fs.closeSync = originalCloseSync;
    fs.writeFileSync = originalWriteFileSync;
  });

  const result = applyPreview({
    repositoryRoot: root,
    preview,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'blocked');
  const after = fs.readFileSync(target);
  assert.ok(priorBytes.equals(after), 'target must be restored to prior bytes even when close failed');
});

test('R2-04: rollback failure reports blocked with an accurate residue', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const target = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'prior');
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Force the mutating write to fail, AND force rollback's fd-form
  // writeFileSync to also fail. Rollback now opens the target with
  // `fs.openSync` and calls `fs.writeFileSync(fd, priorSnapshot)`, so both
  // failures are on the numeric-fd variant. `commitDone` distinguishes the
  // commit write (which must fail) from the later rollback restoration write
  // (which must also fail so the residue is reported).
  const originalWriteFileSync = fs.writeFileSync;
  let commitDone = false;
  fs.writeFileSync = (target_, data, ...rest) => {
    if (typeof target_ === 'number') {
      if (!commitDone) {
        commitDone = true;
        const error = new Error('injected commit write failure');
        error.code = 'EIO';
        throw error;
      }
      const error = new Error('injected rollback write failure');
      error.code = 'EIO';
      throw error;
    }
    return originalWriteFileSync(target_, data, ...rest);
  };
  t.after(() => { fs.writeFileSync = originalWriteFileSync; });

  const result = applyPreview({
    repositoryRoot: root,
    preview,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.written, false);
  // rollbackRemaining must name the failed-to-restore target.
  assert.ok(Array.isArray(result.rollbackRemaining));
  assert.ok(
    result.rollbackRemaining.some((entry) => entry.relativePath === artifacts[0].path),
    `residue must name ${artifacts[0].path}: ${JSON.stringify(result.rollbackRemaining)}`,
  );
});

test('R2-04: no filesystem exception crosses the public boundary', (t) => {
  // A pathological filesystem — mkdir throws unexpectedly — must map to a
  // status, not a thrown exception.
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  const originalMkdirSync = fs.mkdirSync;
  fs.mkdirSync = () => {
    const error = new Error('injected mkdir failure');
    error.code = 'EACCES';
    throw error;
  };
  t.after(() => { fs.mkdirSync = originalMkdirSync; });

  assert.doesNotThrow(() => {
    const result = applyPreview({
      repositoryRoot: root,
      preview,
      confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
    });
    assert.equal(result.status, 'blocked');
    assert.ok(WRITE_STATUSES.includes(result.status));
  });
});

// --- R2-07: exit codes and argument schema for the command interface -------

test('R2-07: build-preview exit codes match the documented table', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const good = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'build-preview'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, artifacts }) },
  );
  assert.equal(good.status, 0);

  // Malformed JSON — usage error, exit 1.
  const badJson = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'build-preview'],
    { encoding: 'utf8', input: 'not valid json' },
  );
  assert.equal(badJson.status, 1);

  // Missing input on stdin — usage error, exit 1.
  const noInput = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'build-preview'],
    { encoding: 'utf8', input: '' },
  );
  assert.equal(noInput.status, 1);
});

test('R2-07: apply-preview covers every documented outcome across a table', (t) => {
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Cancelled: exit 2 findings.
  const cancelled = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'apply-preview'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, preview, confirmation: { previewId: preview.previewId, grant: 'not-the-token' } }) },
  );
  assert.equal(cancelled.status, 2);
  assert.equal(JSON.parse(cancelled.stdout).status, 'cancelled');

  // Malformed JSON — usage error, exit 1.
  const badJson = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'apply-preview'],
    { encoding: 'utf8', input: 'not valid json' },
  );
  assert.equal(badJson.status, 1);

  // Unknown flag — usage error, exit 1.
  const unknownFlag = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'apply-preview', '--nope'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, preview }) },
  );
  assert.equal(unknownFlag.status, 1);

  // Repeated --input — usage error, exit 1.
  const repeatedInput = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'apply-preview', '--input', 'a.json', '--input', 'b.json'],
    { encoding: 'utf8' },
  );
  assert.equal(repeatedInput.status, 1);

  // Unsafe target: build a preview containing an escaping path directly and
  // apply it. Result maps to unsafe-target with exit 2.
  const unsafePreview = buildPreview({
    repositoryRoot: root,
    artifacts: [{ path: '../escape.md', content: 'x' }],
  });
  const unsafeAttempt = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'apply-preview'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, preview: unsafePreview, confirmation: { previewId: unsafePreview.previewId, grant: CONFIRMATION_GRANT } }) },
  );
  assert.equal(unsafeAttempt.status, 2);
  assert.equal(JSON.parse(unsafeAttempt.stdout).status, 'unsafe-target');

  // Successful apply: exit 0.
  const good = spawnSync(
    'node',
    [WRITE_GATE_MJS, 'apply-preview'],
    { encoding: 'utf8', input: JSON.stringify({ repositoryRoot: root, preview, confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT } }) },
  );
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).status, 'configured');
});

test('R2-07: --probe does not accept --input', () => {
  const bad = spawnSync('node', [WRITE_GATE_MJS, '--probe', '--input', 'x.json'], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
});

// --- F-3: overwrite rollback preserves prior permission mode ---------------

test('F-3: overwrite rollback restores prior permission bits, not only content', (t) => {
  // A prior 0o600 file that gets rolled back after an injected write failure
  // must come back at 0o600, not the default creation mode of writeFileSync
  // (0o644 under a typical umask). Preserving the bytes but relaxing the
  // mode is a silent regression a hardened operator cannot detect from the
  // diff.
  if (process.platform === 'win32') {
    // Windows does not carry the POSIX rwx permission bits — `fs.chmodSync`
    // only toggles the read-only attribute — so this behaviour is nothing
    // the platform can express. The rollback path itself is exercised by
    // the R2-04 rollback tests, which do run on Windows.
    t.skip('POSIX permission bits are not represented on Windows');
    return;
  }
  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const target = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'prior');
  fs.chmodSync(target, 0o600);
  const priorMode = fs.lstatSync(target).mode & 0o777;
  assert.equal(priorMode, 0o600, 'test setup pins prior mode to 0o600');
  const priorBytes = fs.readFileSync(target);

  const preview = buildPreview({ repositoryRoot: root, artifacts });

  // Inject a write failure so rollback restores from the snapshot.
  const originalWriteFileSync = fs.writeFileSync;
  let failed = false;
  fs.writeFileSync = (target_, data, ...rest) => {
    if (!failed && typeof target_ === 'number') {
      failed = true;
      const error = new Error('injected write failure');
      error.code = 'EIO';
      throw error;
    }
    return originalWriteFileSync(target_, data, ...rest);
  };
  t.after(() => { fs.writeFileSync = originalWriteFileSync; });

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.written, false);

  const after = fs.readFileSync(target);
  assert.ok(priorBytes.equals(after), 'bytes must be restored');
  const restoredMode = fs.lstatSync(target).mode & 0o777;
  assert.equal(restoredMode, 0o600, 'rollback must restore the prior 0o600 mode');
});

// --- F-4: duplicate detection is filesystem-strict, not byte-strict --------

test('F-4: NFC and NFD spellings of the same filename are refused as duplicates', (t) => {
  const root = workspace(t);
  const nfc = 'café.md'.normalize('NFC');
  const nfd = 'café.md'.normalize('NFD');
  assert.notEqual(nfc, nfd, 'test setup produces distinct byte sequences');
  assert.throws(
    () => buildPreview({
      repositoryRoot: root,
      artifacts: [
        { path: nfc, content: 'first' },
        { path: nfd, content: 'second' },
      ],
    }),
    (error) => error.code === 'usage' && /duplicate normalized target path/.test(error.message),
  );
});

test('F-4: on case-insensitive filesystems Foo.md and foo.md are refused as duplicates', (t) => {
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    t.skip('case-insensitive collision only applies on darwin/win32');
    return;
  }
  const root = workspace(t);
  assert.throws(
    () => buildPreview({
      repositoryRoot: root,
      artifacts: [
        { path: 'Foo.md', content: 'first' },
        { path: 'foo.md', content: 'second' },
      ],
    }),
    (error) => error.code === 'usage' && /duplicate normalized target path/.test(error.message),
  );
});

test('F-4: applyPreview refuses a supplied payload carrying NFC + NFD duplicates', (t) => {
  const root = workspace(t);
  const preview = buildPreview({
    repositoryRoot: root,
    artifacts: [{ path: 'a.md', content: 'x' }],
  });
  const nfc = 'café.md'.normalize('NFC');
  const nfd = 'café.md'.normalize('NFD');
  const tampered = {
    previewId: preview.previewId,
    entries: [
      { ...preview.entries[0], relativePath: nfc },
      { ...preview.entries[0], relativePath: nfd },
    ],
    safety: preview.safety.map((entry) => ({ ...entry })),
  };
  const result = applyPreview({
    repositoryRoot: root,
    preview: tampered,
    confirmation: { previewId: preview.previewId, grant: CONFIRMATION_GRANT },
  });
  assert.equal(result.status, 'stale-preview');
  assert.match(result.detail, /duplicate/);
});

// --- WIN-1: the Windows check-open-verify branch, forced on POSIX ---------
//
// `_setPlatformCapabilityForTests` overrides the process-wide capability
// descriptor so the check-open-verify branch (Windows' safe path) can be
// exercised on a POSIX host. Without this the branch would only ever run on
// the Windows CI job, and a regression could ship unnoticed on the two
// POSIX jobs.

test('WIN-1: check-open-verify branch performs the full write and readback', (t) => {
  const restore = _setPlatformCapabilityForTests({ atomicNoFollow: false, oNoFollow: 0 });
  t.after(restore);

  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });
  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'configured', result.detail);
  for (const artifact of artifacts) {
    const bytes = fs.readFileSync(path.join(root, artifact.path));
    assert.equal(sha256(bytes.toString('utf8')), artifact.sha256);
  }
});

test('WIN-1: check-open-verify branch refuses a symlinked target', (t) => {
  const restore = _setPlatformCapabilityForTests({ atomicNoFollow: false, oNoFollow: 0 });
  t.after(restore);

  const root = workspace(t);
  fs.writeFileSync(path.join(root, 'actual.md'), 'real');
  if (!trySymlinkOrSkip(t, path.join(root, 'actual.md'), path.join(root, 'target.md'), 'WIN-1 symlink refusal')) return;

  const preview = buildPreview({ repositoryRoot: root, artifacts: [{ path: 'target.md', content: 'new' }] });
  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'unsafe-target');
  assert.equal(result.reason, 'symlink-component');
  assert.equal(fs.readFileSync(path.join(root, 'actual.md'), 'utf8'), 'real');
});

test('WIN-1: check-open-verify branch rolls back an injected write failure', (t) => {
  const restore = _setPlatformCapabilityForTests({ atomicNoFollow: false, oNoFollow: 0 });
  t.after(restore);

  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const target = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'prior contents that must survive');
  const priorBytes = fs.readFileSync(target);

  const preview = buildPreview({ repositoryRoot: root, artifacts });

  const originalWriteFileSync = fs.writeFileSync;
  let failed = false;
  fs.writeFileSync = (target_, data, ...rest) => {
    if (!failed && typeof target_ === 'number') {
      failed = true;
      const error = new Error('injected write failure');
      error.code = 'EIO';
      throw error;
    }
    return originalWriteFileSync(target_, data, ...rest);
  };
  t.after(() => { fs.writeFileSync = originalWriteFileSync; });

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.written, false);
  const after = fs.readFileSync(target);
  assert.ok(priorBytes.equals(after), 'target must be restored to prior bytes');
});

test('WIN-1: with neither primitive available the gate fails closed', (t) => {
  const restore = _setPlatformCapabilityForTests({
    atomicNoFollow: false,
    oNoFollow: 0,
    checkOpenVerify: false,
  });
  t.after(restore);

  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const preview = buildPreview({ repositoryRoot: root, artifacts });
  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'blocked');
  assert.match(result.detail, /no safe-open primitive/);
});

test('WIN-1: check-open-verify branch overwrites an existing target and reads it back', (t) => {
  // Regression: an earlier version opened the target with O_WRONLY on the
  // Windows branch. `fstatSync` on a write-only handle needs
  // FILE_READ_ATTRIBUTES, which Windows' GENERIC_WRITE alone does not
  // grant, so every fstat threw EACCES and every real overwrite returned
  // `blocked`. This test forces the check-open-verify branch on POSIX,
  // seeds a target with different content, and requires the overwrite to
  // land AND read back.
  const restore = _setPlatformCapabilityForTests({ atomicNoFollow: false, oNoFollow: 0 });
  t.after(restore);

  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const seedPath = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(seedPath), { recursive: true });
  fs.writeFileSync(seedPath, 'an older configuration');

  const preview = buildPreview({ repositoryRoot: root, artifacts });
  assert.equal(preview.entries[0].action, 'overwrite');

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'configured', result.detail);
  assert.equal(result.readback[0].change, 'overwritten');
  assert.equal(fs.readFileSync(seedPath, 'utf8'), artifacts[0].content);
});

test('WIN-1: check-open-verify rollback residue names a target whose restore failed', (t) => {
  // Regression: the same O_WRONLY defect made rollback's own write open a
  // fresh handle whose fstat failed, so a commit-time write failure
  // returned `blocked` with an EMPTY residue instead of naming the file.
  // This test forces the check-open-verify branch on POSIX and injects a
  // failure on BOTH the commit write and the rollback restore write; the
  // residue must name the target.
  const restore = _setPlatformCapabilityForTests({ atomicNoFollow: false, oNoFollow: 0 });
  t.after(restore);

  const root = workspace(t);
  const artifacts = renderArtifacts(normalizeContext(PROVIDER_INPUTS.github).context);
  const target = path.join(root, artifacts[0].path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'prior');
  const preview = buildPreview({ repositoryRoot: root, artifacts });

  const originalWriteFileSync = fs.writeFileSync;
  let commitDone = false;
  fs.writeFileSync = (target_, data, ...rest) => {
    if (typeof target_ === 'number') {
      if (!commitDone) {
        commitDone = true;
        const error = new Error('injected commit write failure');
        error.code = 'EIO';
        throw error;
      }
      const error = new Error('injected rollback write failure');
      error.code = 'EIO';
      throw error;
    }
    return originalWriteFileSync(target_, data, ...rest);
  };
  t.after(() => { fs.writeFileSync = originalWriteFileSync; });

  const result = applyPreview({ repositoryRoot: root, preview, confirmation: grant(preview) });
  assert.equal(result.status, 'blocked', result.detail);
  assert.equal(result.written, false);
  assert.ok(Array.isArray(result.rollbackRemaining));
  assert.ok(
    result.rollbackRemaining.some((entry) => entry.relativePath === artifacts[0].path),
    `residue must name ${artifacts[0].path}: ${JSON.stringify(result.rollbackRemaining)}`,
  );
});

test('deterministic before-mutation hook is caught and rolls back prior ordered writes', (t) => {
  const root = workspace(t);
  const artifacts = [
    { path: 'first.md', content: 'first\n' },
    { path: 'second.md', content: 'second\n' },
  ];
  const preview = buildPreview({ repositoryRoot: root, artifacts });
  const result = applyPreview(
    { repositoryRoot: root, preview, confirmation: grant(preview) },
    {
      fault: ({ phase, relativePath }) => {
        if (phase === 'before-mutation' && relativePath === 'second.md') throw new Error('boundary');
      },
    },
  );
  assert.equal(result.status, 'blocked');
  assert.equal(fs.existsSync(path.join(root, 'first.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'second.md')), false);
});

test('deterministic after-readback hook cannot report success and rolls back', (t) => {
  const root = workspace(t);
  const artifacts = [{ path: 'verified.md', content: 'verified\n' }];
  const preview = buildPreview({ repositoryRoot: root, artifacts });
  const result = applyPreview(
    { repositoryRoot: root, preview, confirmation: grant(preview) },
    {
      fault: ({ phase }) => {
        if (phase === 'after-readback-complete') throw new Error('boundary');
      },
    },
  );
  assert.equal(result.status, 'blocked');
  assert.equal(fs.existsSync(path.join(root, 'verified.md')), false);
});
