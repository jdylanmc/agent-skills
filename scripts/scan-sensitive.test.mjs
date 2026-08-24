import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadIdentifierConfig } from '../skills/_base/_atoms/redact-sensitive/redact-sensitive.config.mjs';
import {
  parseAddedHunks,
  scanRepository,
  scanText,
} from './scan-sensitive.mjs';

function git(repository, ...args) {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
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

test('text findings contain anchors and evidence types but not values', () => {
  const fixtureLine = ['api', '_key=', 'not-a-real-secret-value'].join('');
  const result = scanText(
    `safe\n${fixtureLine}\n`,
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
    evidenceType: 'secret',
    count: 1,
  }]);
  assert.equal(JSON.stringify(result).includes('not-a-real-secret-value'), false);
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

test('repository scan covers changed content, filenames, PR metadata, and commits', (context) => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-sensitive-'));
  context.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  git(repository, 'init', '--initial-branch=main');
  git(repository, 'config', 'user.name', 'Repository Author');
  git(repository, 'config', 'user.email', ['author', 'example.test'].join('@'));
  fs.writeFileSync(path.join(repository, 'safe.txt'), 'safe\n');
  git(repository, 'add', 'safe.txt');
  git(repository, 'commit', '-m', 'initial');
  const base = git(repository, 'rev-parse', 'HEAD');

  fs.writeFileSync(path.join(repository, 'safe.txt'), 'safe\nPRIVATE\nsys-tem\n');
  git(repository, 'add', 'safe.txt');
  git(repository, 'config', 'user.name', ['Private', 'System'].join(' '));
  git(repository, 'commit', '-m', ['Mention private', 'system'].join(' '));
  const head = git(repository, 'rev-parse', 'HEAD');
  const event = {
    pull_request: {
      base: { sha: base },
      head: { sha: head },
      title: ['Private', 'System', ' change'].join(' '),
      body: 'No raw values here.',
    },
  };

  const result = scanRepository({
    repository,
    identifiers: identifierConfig().identifiers,
    event,
  });
  const sources = new Set(result.findings.map(({ anchor }) => anchor.source));

  assert.deepEqual(result.unscanned, []);
  assert.equal(sources.has('added-content'), true);
  assert.equal(sources.has('commit-author'), true);
  assert.equal(sources.has('commit-message'), true);
  assert.equal(sources.has('pull-request-title'), true);
  assert.equal(JSON.stringify(result).toLocaleLowerCase().includes('private system'), false);
});
