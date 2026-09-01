import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyAttempt,
  discoverGitHubActionsCommands,
  discoverRepositoryCi,
  parseNodeTapSummary,
  runDiscoveredCi,
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

test('discovery-to-execution preserves the complete canonical repository snapshot', async () => {
  const root = sandbox('run-ci-snapshot-');
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), [
    'name: CI',
    'on: [pull_request]',
    'jobs:',
    '  validate:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Exercise execution',
    '        run: node -e "process.exit(0)"',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'committed\n');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', [
    '-c', 'user.name=Run CI Test',
    '-c', 'user.email=run-ci@example.invalid',
    'commit', '--quiet', '-m', 'fixture',
  ], { cwd: root });
  fs.appendFileSync(path.join(root, 'tracked.txt'), 'dirty\n');

  const discovery = discoverRepositoryCi(root);
  const result = await runDiscoveredCi(root, discovery);

  assert.deepEqual(result.repository, discovery.repository);
  assert.notEqual(result.repository, discovery.repository);
  assert.equal(result.repository.root, root);
  assert.match(result.repository.revision, /^[0-9a-f]{40}$/);
  assert.deepEqual(result.repository.dirtyState, ['M tracked.txt']);
  assert.equal(result.status, 'passed');
  assert.equal(result.evidenceComplete, true);
});

test('execution refuses a different worktree before running a discovered command', async () => {
  const discoveredRoot = sandbox('run-ci-discovered-root-');
  const executionRoot = sandbox('run-ci-execution-root-');
  fs.mkdirSync(path.join(discoveredRoot, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(discoveredRoot, '.github', 'workflows', 'ci.yml'), [
    'name: CI',
    'on: [pull_request]',
    'jobs:',
    '  validate:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Must not run',
    "        run: node -e \"require('node:fs').writeFileSync('ran.txt', 'yes')\"",
    '',
  ].join('\n'));
  execFileSync('git', ['init', '--quiet'], { cwd: discoveredRoot });
  const discovery = discoverRepositoryCi(discoveredRoot);

  await assert.rejects(
    runDiscoveredCi(executionRoot, discovery),
    /execution root does not match/,
  );
  assert.equal(fs.existsSync(path.join(executionRoot, 'ran.txt')), false);
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
