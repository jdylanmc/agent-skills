import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadIdentifierConfig } from '../skills/_base/_atoms/redact-sensitive/redact-sensitive.config.mjs';
import {
  identifierConfigurationStatus,
  parseAddedHunks,
  scanRepository,
  scanText,
} from './scan-sensitive.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

function git(repository, ...args) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
}

function repositorySandbox(context, label) {
  fs.mkdirSync(TEST_SANDBOX_ROOT, { recursive: true });
  const repository = fs.realpathSync(fs.mkdtempSync(path.join(TEST_SANDBOX_ROOT, `${label}-`)));
  context.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  git(repository, 'init', '--initial-branch=main');
  git(repository, 'config', 'user.name', 'Repository Author');
  git(repository, 'config', 'user.email', ['author', 'example.test'].join('@'));
  return repository;
}

function commit(repository, message) {
  git(repository, 'add', '--all');
  git(repository, 'commit', '-m', message);
  return git(repository, 'rev-parse', 'HEAD');
}

function identifierConfig() {
  return loadIdentifierConfig({
    json: JSON.stringify({
      version: 1,
      identifiers: [{
        value: ['Private', 'System'].join(' '),
        evidenceType: 'internal-system',
      }],
    }),
  });
}

function pullRequestEvent(base, head, fork = false) {
  return {
    pull_request: {
      base: { sha: base },
      head: { sha: head, repo: { fork } },
      title: 'Safe title',
      body: 'Safe body.',
    },
  };
}

test('text findings contain anchors and evidence types but not values', () => {
  const secret = ['ghp_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'].join('');
  const result = scanText(
    `safe\nAuthorization: Bearer ${secret}\n`,
    { source: 'tracked-content', path: 'sample.txt' },
    [],
  );

  assert.deepEqual(result.unscanned, []);
  assert.deepEqual(result.findings, [{
    anchor: {
      source: 'tracked-content',
      path: 'sample.txt',
      lineStart: 2,
      lineEnd: 2,
    },
    evidenceType: 'credential',
    count: 1,
  }]);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('ordinary JavaScript declarations do not trip the repository leak gate', () => {
  const result = scanText(
    'const key = resolveKey();\nconst token = "bounded";\n',
    { source: 'added-content', path: 'ordinary.mjs' },
    [],
  );

  assert.deepEqual(result, { findings: [], unscanned: [] });
});

test('configured path anchors use a stable non-reversible locator', () => {
  const identifier = ['Private', 'System'].join(' ');
  const result = scanText(
    `Uses ${identifier}.\n`,
    { source: 'added-content', path: ['notes/', 'Private', 'System.md'].join('') },
    identifierConfig().identifiers,
  );

  assert.equal(result.findings.length, 1);
  assert.match(result.findings[0].anchor.path, /^sha256:[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).toLocaleLowerCase().includes('private system'), false);
  assert.equal(JSON.stringify(result).toLocaleLowerCase().includes('privatesystem'), false);
});

test('configured findings preserve exact wrapped line anchors', () => {
  const result = scanText(
    ['safe\nPRIVATE\nsys-tem\nsafe\n'].join(''),
    { source: 'added-content', path: 'sample.txt' },
    identifierConfig().identifiers,
    10,
  );

  assert.deepEqual(
    result.findings.filter(({ evidenceType }) => evidenceType === 'internal-system'),
    [{
      anchor: {
        source: 'added-content',
        path: 'sample.txt',
        lineStart: 11,
        lineEnd: 12,
      },
      evidenceType: 'internal-system',
      count: 1,
    }],
  );
});

test('unified diff parsing returns only added content with new-file lines', () => {
  const diff = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -2,2 +2,3 @@',
    ' context',
    '-old',
    '+first',
    '+second',
    ' context',
    '',
  ].join('\n');

  assert.deepEqual(parseAddedHunks(diff), [{
    path: 'a.txt',
    firstLine: 3,
    text: 'first\nsecond\n',
  }]);
});

test('an added line resembling a file header cannot disable hunk scanning', () => {
  const diff = [
    'diff --git a/a.txt b/a.txt',
    '--- a/a.txt',
    '+++ b/a.txt',
    '@@ -1 +1,2 @@',
    '-old',
    '+++ /dev/null',
    '+still scanned',
    '',
  ].join('\n');

  assert.deepEqual(parseAddedHunks(diff), [{
    path: 'a.txt',
    firstLine: 1,
    text: '++ /dev/null\nstill scanned\n',
  }]);
});

test('added and renamed binaries fail closed while a deleted binary passes', (context) => {
  const repository = repositorySandbox(context, 'scan-sensitive-binary');
  fs.writeFileSync(path.join(repository, 'safe.txt'), 'safe\n');
  const initial = commit(repository, 'initial');

  fs.writeFileSync(path.join(repository, 'added.bin'), Buffer.from([0, 1, 2]));
  const added = commit(repository, 'add binary');
  const addedResult = scanRepository({
    repository,
    identifiers: [],
    event: pullRequestEvent(initial, added),
  });
  assert.deepEqual(addedResult.unscanned, [{
    anchor: { source: 'added-binary', path: 'added.bin' },
    reason: 'binary content requires an explicit human review',
  }]);

  fs.renameSync(path.join(repository, 'added.bin'), path.join(repository, 'renamed.bin'));
  const renamed = commit(repository, 'rename binary');
  const renamedResult = scanRepository({
    repository,
    identifiers: [],
    event: pullRequestEvent(added, renamed),
  });
  assert.deepEqual(renamedResult.unscanned, [{
    anchor: { source: 'added-binary', path: 'renamed.bin' },
    reason: 'binary content requires an explicit human review',
  }]);

  fs.rmSync(path.join(repository, 'renamed.bin'));
  const deleted = commit(repository, 'delete binary');
  const deletedResult = scanRepository({
    repository,
    identifiers: [],
    event: pullRequestEvent(renamed, deleted),
  });
  assert.deepEqual(deletedResult.unscanned, []);
});

test('repository scan covers changed content, filenames, PR metadata, and commits', (context) => {
  const repository = repositorySandbox(context, 'scan-sensitive-coverage');
  fs.writeFileSync(path.join(repository, 'safe.txt'), 'safe\n');
  const base = commit(repository, 'initial');

  fs.writeFileSync(path.join(repository, 'safe.txt'), 'safe\nPRIVATE\nsys-tem\n');
  git(repository, 'config', 'user.name', ['Private', 'System'].join(' '));
  const head = commit(repository, ['Mention private', 'system'].join(' '));
  const event = {
    ...pullRequestEvent(base, head),
    pull_request: {
      ...pullRequestEvent(base, head).pull_request,
      title: ['Private', 'System', ' change'].join(' '),
    },
  };

  const result = scanRepository({
    repository,
    identifiers: identifierConfig().identifiers,
    event,
  });
  const sources = new Set(result.findings.map(({ anchor }) => anchor.source));

  assert.deepEqual(result.unscanned, []);
  assert.equal(result.configuration.state, 'active');
  assert.equal(sources.has('added-content'), true);
  assert.equal(sources.has('commit-author'), true);
  assert.equal(sources.has('commit-message'), true);
  assert.equal(sources.has('pull-request-title'), true);
  assert.equal(JSON.stringify(result).toLocaleLowerCase().includes('private system'), false);
});

test('identifier configuration makes same-repository failures and fork degradation explicit', () => {
  const sameRepository = identifierConfigurationStatus({
    identifiers: [],
    event: pullRequestEvent('base', 'head', false),
    required: true,
  });
  assert.deepEqual(sameRepository, {
    state: 'degraded',
    reason: 'identifier-configuration-missing',
    required: true,
    blocking: true,
    identifierCount: 0,
  });

  const fork = identifierConfigurationStatus({
    identifiers: [],
    event: pullRequestEvent('base', 'head', true),
    required: true,
  });
  assert.deepEqual(fork, {
    state: 'degraded',
    reason: 'fork-pull-request-identifier-configuration-unavailable',
    required: true,
    blocking: false,
    identifierCount: 0,
  });
});

function stackedHistory(context, strategy) {
  const repository = repositorySandbox(context, `scan-sensitive-${strategy}`);
  fs.writeFileSync(path.join(repository, 'base.txt'), 'base\n');
  commit(repository, 'initial');

  git(repository, 'checkout', '-b', 'handoff');
  const priorLeak = ['ghp_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'].join('');
  fs.writeFileSync(path.join(repository, 'handoff.txt'), `${priorLeak}\n`);
  commit(repository, `handoff ${priorLeak}`);
  const handoff = git(repository, 'rev-parse', 'HEAD');

  git(repository, 'checkout', '-b', 'gate', handoff);
  fs.writeFileSync(path.join(repository, 'current.mjs'), 'const key = resolveKey();\n');
  const head = commit(repository, 'gate only change');

  git(repository, 'checkout', 'main');
  if (strategy === 'merge') {
    git(repository, 'merge', '--no-ff', 'handoff', '-m', 'merge handoff');
  } else {
    git(repository, 'merge', '--squash', 'handoff');
    commit(repository, 'squash handoff');
  }
  return { repository, base: git(repository, 'rev-parse', 'HEAD'), head };
}

for (const strategy of ['merge', 'squash']) {
  test(`retargeting after a ${strategy} handoff integration scans only the current gate change`, (context) => {
    const history = stackedHistory(context, strategy);
    const result = scanRepository({
      repository: history.repository,
      identifiers: [],
      event: pullRequestEvent(history.base, history.head),
    });

    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.unscanned, []);
  });
}

test('merge-commit metadata on the current PR head is scanned', (context) => {
  const repository = repositorySandbox(context, 'scan-sensitive-head-merge');
  fs.writeFileSync(path.join(repository, 'base.txt'), 'base\n');
  const base = commit(repository, 'initial');

  git(repository, 'checkout', '-b', 'side');
  fs.writeFileSync(path.join(repository, 'side.txt'), 'side\n');
  commit(repository, 'safe side change');

  git(repository, 'checkout', '-b', 'gate', base);
  fs.writeFileSync(path.join(repository, 'gate.txt'), 'gate\n');
  commit(repository, 'safe gate change');
  const token = ['ghp_', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'].join('');
  git(repository, 'merge', '--no-ff', 'side', '-m', `merge ${token}`);
  const head = git(repository, 'rev-parse', 'HEAD');

  const result = scanRepository({
    repository,
    identifiers: [],
    event: pullRequestEvent(base, head),
  });
  assert.equal(
    result.findings.some(({ anchor, evidenceType }) => (
      anchor.source === 'commit-message' && evidenceType === 'token'
    )),
    true,
  );
  assert.equal(JSON.stringify(result).includes(token), false);
});
