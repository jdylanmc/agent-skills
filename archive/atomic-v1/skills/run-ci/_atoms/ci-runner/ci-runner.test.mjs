import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyAttempt,
  discoverGitHubActionsCommands,
  discoverRepositoryCi,
  parseNodeTapSummary,
} from './ci-runner.mjs';

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
const SANDBOX_ROOT = path.join(REPOSITORY_ROOT, '.test-sandbox');

function sandbox(prefix) {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(SANDBOX_ROOT, prefix));
}

test('discovers folded GitHub Actions run commands in workflow order', () => {
  const workflow = [
    'name: Validate',
    'on: [pull_request]',
    'jobs:',
    '  validate:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - name: Validate graph',
    '        run: node scripts/validate-skill-graph.mjs',
    '      - name: Run tests',
    '        shell: bash',
    '        run: >-',
    '          node scripts/run-registered-tests.mjs',
    '          scripts/run-registered-tests.test.mjs',
    '          skills/run-ci/_atoms/ci-runner/ci-runner.test.mjs',
    '  docs:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Docs check',
    '        run: echo docs',
    '',
  ].join('\n');

  const result = discoverGitHubActionsCommands(workflow, '.github/workflows/validate-skills.yml');

  assert.equal(result.provider, 'github-actions');
  assert.deepEqual(result.providerActions.map((step) => step.uses), ['actions/checkout@v4']);
  assert.deepEqual(
    result.commands.map((step) => [step.job, step.name, step.shell, step.command]),
    [
      ['validate', 'Validate graph', null, 'node scripts/validate-skill-graph.mjs'],
      [
        'validate',
        'Run tests',
        'bash',
        'node scripts/run-registered-tests.mjs scripts/run-registered-tests.test.mjs skills/run-ci/_atoms/ci-runner/ci-runner.test.mjs',
      ],
      ['docs', 'Docs check', null, 'echo docs'],
    ],
  );
});

test('repository discovery binds evidence to the current revision and dirty state', () => {
  const result = discoverRepositoryCi(REPOSITORY_ROOT, {
    workflowPath: '.github/workflows/validate-skills.yml',
  });

  assert.equal(result.repository.root, REPOSITORY_ROOT);
  assert.match(result.repository.revision, /^[0-9a-f]{40}$/);
  assert.ok(Array.isArray(result.repository.dirtyState));
});

test('discovers this repository validation command without globbing tests', () => {
  const result = discoverRepositoryCi(REPOSITORY_ROOT, {
    workflowPath: '.github/workflows/validate-skills.yml',
  });

  const testCommand = result.commands.find((command) => command.name === 'Run validator and conformance tests');
  assert.ok(testCommand, 'expected the validation workflow test step to be discovered');
  assert.match(testCommand.command, /^node scripts\/run-registered-tests\.mjs /);
  assert.match(testCommand.command, /scripts\/workflow-registration\.test\.mjs/);
  assert.doesNotMatch(testCommand.command, /node --test scripts\//);
  assert.doesNotMatch(testCommand.command, /\*\.test\.mjs/);
});

test('reports unsupported provider instead of inventing a command', () => {
  const root = sandbox('run-ci-no-provider-');
  const result = discoverRepositoryCi(root);

  assert.equal(result.provider, 'unsupported-provider');
  assert.deepEqual(result.commands, []);
  assert.equal(result.repository.root, root);
});

test('parses Node TAP summaries including cancelled tests', () => {
  const summary = parseNodeTapSummary([
    '# tests 4',
    '# pass 2',
    '# fail 0',
    '# cancelled 2',
    '# skipped 0',
    '# todo 0',
    '# duration_ms 12.5',
  ].join('\n'));

  assert.deepEqual(summary, {
    tests: 4,
    pass: 2,
    fail: 0,
    cancelled: 2,
    skipped: 0,
    todo: 0,
    duration_ms: 12.5,
  });
});

test('classifies cancellation before ordinary process success', () => {
  const classified = classifyAttempt({
    exitCode: 0,
    signal: null,
    startError: null,
    stdout: '# tests 1\n# pass 0\n# fail 0\n# cancelled 1\n',
    stderr: '',
  });

  assert.equal(classified.classification, 'cancelled');
  assert.equal(classified.tap.cancelled, 1);
});

test('classifies missing tools as environment failures', () => {
  const classified = classifyAttempt({
    exitCode: 127,
    signal: null,
    startError: null,
    stdout: '',
    stderr: 'sh: missing-tool: command not found',
  });

  assert.equal(classified.classification, 'environment-failed');
});
