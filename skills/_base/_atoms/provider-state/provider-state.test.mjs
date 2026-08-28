/**
 * Behaviour tests for reading change-request state.
 *
 * Two claims carry the weight. A caller must be able to tell "the provider said
 * nothing" apart from "the provider said nothing is wrong", because those lead
 * to opposite decisions and only one of them is safe. And a caller must not be
 * able to reach a mutation through a unit that is documented as read-only.
 *
 * Tests here state a provider response and assert the answer a caller gets from
 * it. They do not reach into how the response was parsed.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { detectProvider } from '../provider-detect/provider-detect.mjs';
import {
  ProviderCommandError,
  assertReadOnlyCommand,
  interpretMergeState,
  interpretTarget,
  interpretValidation,
  mergeStateCommand,
  resolveTargetCommand,
  validationIsGreen,
  validationStatusCommand,
} from './provider-state.mjs';

const READY = { available: true, authenticated: true };

const GITHUB = detectProvider({
  remoteUrls: ['https://github.com/example/repo.git'],
  toolAvailability: { gh: READY },
});

const AZURE = detectProvider({
  remoteUrls: ['https://dev.azure.com/contoso/project/_git/repo'],
  toolAvailability: { az: READY },
});

const GITHUB_TARGET = { changeRequest: 42, repository: { slug: 'example/repo' } };
const AZURE_TARGET = {
  changeRequest: 42,
  repository: { organizationUrl: 'https://dev.azure.com/contoso', project: 'project', name: 'repo' },
};

const ALL_BUILDERS = [resolveTargetCommand, mergeStateCommand, validationStatusCommand];

test('each operation builds an argument vector for the provider official tool', () => {
  const github = ALL_BUILDERS.map((build) => build(GITHUB, GITHUB_TARGET));
  const azure = ALL_BUILDERS.map((build) => build(AZURE, AZURE_TARGET));

  for (const command of github) {
    assert.equal(command.ok, true);
    assert.equal(command.tool, 'gh');
    assert.ok(Array.isArray(command.args) && command.args.every((arg) => typeof arg === 'string'));
    assert.ok(command.args.includes('--repo') && command.args.includes('example/repo'));
    assert.ok(command.args.includes('42'));
  }
  for (const command of azure) {
    assert.equal(command.ok, true);
    assert.equal(command.tool, 'az');
    assert.ok(command.args.includes('--org') && command.args.includes('https://dev.azure.com/contoso'));
  }

  assert.deepEqual(github.map((command) => command.operation), ['resolve-target', 'read-state', 'read-checks']);
  assert.deepEqual(azure.map((command) => command.operation), ['resolve-target', 'read-state', 'read-checks']);
});

test('every operation refuses when the provider cannot be observed, naming the condition', () => {
  const conditions = [
    detectProvider({ remoteUrls: ['https://github.com/example/repo.git'], toolAvailability: { gh: { available: false } } }),
    detectProvider({ remoteUrls: ['https://github.com/example/repo.git'], toolAvailability: { gh: { available: true, authenticated: false } } }),
    detectProvider({ remoteUrls: ['https://github.com/example/repo.git'] }),
    detectProvider({ remoteUrls: ['https://gitlab.com/group/repo.git'] }),
    detectProvider({ remoteUrls: ['https://git.example.invalid/team/repo.git'] }),
  ];

  for (const detection of conditions) {
    for (const build of ALL_BUILDERS) {
      const refusal = build(detection, GITHUB_TARGET);
      assert.equal(refusal.ok, false, `${detection.status} must not produce a command`);
      assert.equal(refusal.status, detection.status);
      assert.equal(refusal.args, undefined);
    }
  }
});

test('a hostile change-request identifier is rejected rather than interpolated', () => {
  for (const hostile of ['1; rm -rf /', '--repo=attacker/repo', '42 43', '0', '', null, {}]) {
    assert.throws(
      () => resolveTargetCommand(GITHUB, { changeRequest: hostile, repository: { slug: 'example/repo' } }),
      (error) => error instanceof ProviderCommandError && error.code === 'invalid-change-request-identifier',
      `identifier ${JSON.stringify(hostile)} must be rejected`,
    );
  }
});

test('a malformed repository address is rejected rather than interpolated', () => {
  assert.throws(
    () => resolveTargetCommand(GITHUB, { changeRequest: 42, repository: { slug: 'example/repo --json x' } }),
    (error) => error.code === 'invalid-repository',
  );
  assert.throws(
    () => resolveTargetCommand(AZURE, { changeRequest: 42, repository: { organizationUrl: 'http://insecure.example', project: 'p', name: 'r' } }),
    (error) => error.code === 'invalid-repository',
  );
  assert.throws(
    () => resolveTargetCommand(AZURE, { changeRequest: 42, repository: { organizationUrl: 'https://dev.azure.com/contoso', project: '', name: 'r' } }),
    (error) => error.code === 'invalid-repository',
  );
});

test('a mutating command cannot be constructed through this unit', () => {
  for (const args of [
    ['pr', 'merge', '42'],
    ['pr', 'review', '42', '--approve'],
    ['api', '--method', 'POST', 'repos/example/repo/pulls/42/reviews'],
    ['repos', 'pr', 'update', '--id', '42'],
    ['devops', 'invoke', '--http-method', 'PATCH'],
  ]) {
    assert.throws(
      () => assertReadOnlyCommand({ args }),
      (error) => error instanceof ProviderCommandError && error.code === 'mutating-command',
      `${args.join(' ')} must be refused`,
    );
  }

  for (const build of ALL_BUILDERS) {
    assert.doesNotThrow(() => build(GITHUB, GITHUB_TARGET));
    assert.doesNotThrow(() => build(AZURE, AZURE_TARGET));
  }
});

test('a credential offered by a caller never reaches the command line', () => {
  const commands = [
    ...ALL_BUILDERS.map((build) => build(GITHUB, { ...GITHUB_TARGET, token: 'caller-supplied-credential-value' })),
    ...ALL_BUILDERS.map((build) => build(AZURE, { ...AZURE_TARGET, token: 'caller-supplied-credential-value' })),
  ];

  for (const command of commands) {
    assert.ok(
      !command.args.some((arg) => arg.includes('caller-supplied-credential-value')),
      'authentication belongs to the official tool, never to a constructed argument',
    );
  }
});

test('a resolved target reports branch, base, and head commit', () => {
  const github = interpretTarget(GITHUB, {
    number: 42,
    url: 'https://github.com/example/repo/pull/42',
    headRefName: 'feature',
    baseRefName: 'main',
    headRefOid: 'aaaaaaa',
    isDraft: false,
  });
  assert.equal(github.observed, true);
  assert.equal(github.branch, 'feature');
  assert.equal(github.base, 'main');
  assert.equal(github.headSha, 'aaaaaaa');

  const azure = interpretTarget(AZURE, {
    sourceRefName: 'refs/heads/feature',
    targetRefName: 'refs/heads/main',
    lastMergeSourceCommit: { commitId: 'bbbbbbb' },
  });
  assert.equal(azure.observed, true);
  assert.equal(azure.branch, 'feature');
  assert.equal(azure.base, 'main');
  assert.equal(azure.headSha, 'bbbbbbb');
});

test('a response that omits resolution state is unobserved, naming what was missing', () => {
  const partial = interpretTarget(GITHUB, { number: 42, url: 'https://github.com/example/repo/pull/42' });

  assert.equal(partial.observed, false);
  assert.equal(partial.reason, 'resolution-state-absent');
  assert.deepEqual(partial.missing, ['branch', 'base', 'headSha']);
  assert.equal(partial.branch, undefined, 'no branch is invented for a response that carried none');
});

test('an absent response is unobserved rather than an empty target', () => {
  for (const payload of [undefined, null, '', 'not-json']) {
    const result = interpretTarget(GITHUB, payload);
    assert.equal(result.observed, false);
    assert.equal(result.reason, 'response-absent');
  }
});

test('merge state is reported only when the provider actually computed it', () => {
  assert.equal(interpretMergeState(GITHUB, { mergeable: 'MERGEABLE' }).mergeState, 'mergeable');
  assert.equal(interpretMergeState(GITHUB, { mergeable: 'CONFLICTING' }).mergeState, 'conflicted');
  assert.equal(interpretMergeState(AZURE, { mergeStatus: 'succeeded' }).mergeState, 'mergeable');
  assert.equal(interpretMergeState(AZURE, { mergeStatus: 'conflicts' }).mergeState, 'conflicted');
});

test('a provider that has not computed mergeability is unobserved, not mergeable', () => {
  // GitHub answers UNKNOWN while it computes the merge commit, and Azure DevOps
  // answers queued or notSet. Reading either as mergeable would let a
  // conflicted change request pass as landable.
  for (const [detection, payload] of [
    [GITHUB, { mergeable: 'UNKNOWN' }],
    [AZURE, { mergeStatus: 'queued' }],
    [AZURE, { mergeStatus: 'notSet' }],
  ]) {
    const result = interpretMergeState(detection, payload);
    assert.equal(result.observed, false);
    assert.equal(result.reason, 'provider-has-not-computed-mergeability');
    assert.equal(result.mergeState, undefined);
  }

  const absent = interpretMergeState(GITHUB, { number: 42 });
  assert.equal(absent.observed, false);
  assert.equal(absent.reason, 'merge-state-absent');
});

test('validation results are normalized with the provider raw fields preserved', () => {
  const passing = interpretValidation(GITHUB, {
    statusCheckRollup: [
      { name: 'validate', status: 'COMPLETED', conclusion: 'SUCCESS', isRequired: true, detailsUrl: 'https://example.invalid/1' },
    ],
  });

  assert.equal(passing.observed, true);
  assert.equal(passing.status, 'passing');
  assert.equal(passing.checks[0].name, 'validate');
  assert.equal(passing.checks[0].required, true);
  assert.deepEqual(passing.checks[0].raw, { state: null, status: 'COMPLETED', conclusion: 'SUCCESS' });
  assert.equal(validationIsGreen(passing), true);

  const azure = interpretValidation(AZURE, {
    evaluations: [
      { evaluationId: 'e1', status: 'approved', configuration: { isBlocking: true, type: { displayName: 'Build' } } },
    ],
  });
  assert.equal(azure.status, 'passing');
  assert.equal(azure.checks[0].name, 'Build');
  assert.equal(validationIsGreen(azure), true);
});

test('an absent validation rollup is unobserved and is never green', () => {
  const absent = interpretValidation(GITHUB, { number: 42 });

  assert.equal(absent.observed, false);
  assert.equal(absent.reason, 'validation-status-absent');
  assert.equal(absent.checks, undefined, 'no empty check list stands in for checks nobody read');
  assert.equal(validationIsGreen(absent), false);
});

test('a change request with no reported checks has demonstrated nothing', () => {
  const empty = interpretValidation(GITHUB, { statusCheckRollup: [] });

  assert.equal(empty.observed, true);
  assert.equal(empty.status, 'no-results');
  assert.notEqual(empty.status, 'passing');
  assert.equal(validationIsGreen(empty), false);
});

test('pending, failing, and inconclusive validation are each distinct and none are green', () => {
  const pending = interpretValidation(GITHUB, {
    statusCheckRollup: [
      { name: 'validate', status: 'IN_PROGRESS' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' },
    ],
  });
  assert.equal(pending.status, 'pending');

  const failing = interpretValidation(GITHUB, {
    statusCheckRollup: [
      { name: 'validate', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'lint', status: 'IN_PROGRESS' },
    ],
  });
  assert.equal(failing.status, 'failing', 'a failure outranks a pending sibling');

  const inconclusive = interpretValidation(GITHUB, {
    statusCheckRollup: [
      { name: 'validate', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { name: 'lint', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    ],
  });
  assert.equal(inconclusive.status, 'inconclusive');

  const unknown = interpretValidation(GITHUB, { statusCheckRollup: [{ name: 'mystery', status: 'SOMETHING_NEW' }] });
  assert.equal(unknown.checks[0].status, 'unknown');
  assert.equal(unknown.status, 'inconclusive');

  for (const validation of [pending, failing, inconclusive, unknown]) {
    assert.equal(validationIsGreen(validation), false);
  }
});

test('an unobservable provider yields an unobserved reading, never a clean one', () => {
  const unobserved = detectProvider({ remoteUrls: ['https://github.com/example/repo.git'] });

  for (const [interpret, payload] of [
    [interpretTarget, { headRefName: 'feature', baseRefName: 'main', headRefOid: 'aaa' }],
    [interpretMergeState, { mergeable: 'MERGEABLE' }],
    [interpretValidation, { statusCheckRollup: [{ name: 'validate', status: 'COMPLETED', conclusion: 'SUCCESS' }] }],
  ]) {
    const result = interpret(unobserved, payload);
    assert.equal(result.observed, false);
    assert.equal(result.reason, 'provider-state-unobservable');
  }

  assert.equal(validationIsGreen(interpretValidation(unobserved, { statusCheckRollup: [] })), false);
});
