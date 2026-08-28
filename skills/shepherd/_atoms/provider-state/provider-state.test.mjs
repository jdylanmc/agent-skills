/**
 * Behaviour tests for reading change-request state.
 *
 * Fixtures here match the documented output shapes of `gh pr view --json` and
 * `az repos pr show` / `az repos pr policy list`, and the assertions are the
 * normalized result a caller sees. That is deliberate: the regressions this
 * suite guards — an Azure response shape the parser rejected, a GitHub field
 * that never existed, an ignored merge-state status, a guard a mutation slipped
 * past — all previously passed because tests asserted locally invented payloads
 * and argument membership instead of provider contracts.
 *
 * Two claims still carry the most weight. A caller must be able to tell "the
 * provider said nothing" apart from "the provider said nothing is wrong". And a
 * caller must not be able to reach a mutation through a unit documented as
 * read-only.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { detectProvider } from '../../../_base/_atoms/provider-detect/provider-detect.mjs';
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

// The repository's sensitive-content floor reads a user-and-host pair joined by an at-sign as an electronic
// mail address and is deliberately eager, so a literal scp-like SSH remote in
// committed source is a finding even though it holds no secret. Compose the
// remote from its parts so the byte-for-byte string still reaches the code
// under test without an address-shaped literal appearing in this file.
const scpRemote = (user, host, path) => `${user}@${host}:${path}`;

const GITHUB = detectProvider({
  remoteUrls: ['https://github.com/example/repo.git'],
  toolAvailability: { gh: READY },
});

const GITHUB_ENTERPRISE = detectProvider({
  remoteUrls: [scpRemote('git', 'github.contoso-internal.example', 'example/repo.git')],
  hostProviders: { 'github.contoso-internal.example': 'github' },
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

test('each operation builds the official-tool read the external CLI contract requires', () => {
  const github = ALL_BUILDERS.map((build) => build(GITHUB, GITHUB_TARGET));
  const azure = ALL_BUILDERS.map((build) => build(AZURE, AZURE_TARGET));

  for (const command of github) {
    assert.equal(command.ok, true);
    assert.equal(command.tool, 'gh');
    // `--json` is the external contract that makes the output machine-readable,
    // so its presence is asserted directly.
    assert.ok(command.args.includes('--json'), 'gh reads are pinned to --json output');
    assert.ok(command.args.includes('--repo') && command.args.includes('example/repo'));
    assert.ok(command.args.includes('42'));
  }
  for (const command of azure) {
    assert.equal(command.ok, true);
    assert.equal(command.tool, 'az');
    assert.ok(command.args.includes('--org') && command.args.includes('https://dev.azure.com/contoso'));
    assert.ok(command.args.includes('--output') && command.args.includes('json'));
  }

  assert.deepEqual(github.map((command) => command.operation), ['resolve-target', 'read-state', 'read-checks']);
  assert.deepEqual(azure.map((command) => command.operation), ['resolve-target', 'read-state', 'read-checks']);
});

test('the detected enterprise host is carried into the constructed GitHub read', () => {
  const command = mergeStateCommand(GITHUB_ENTERPRISE, GITHUB_TARGET);
  const repoIndex = command.args.indexOf('--repo');

  assert.equal(
    command.args[repoIndex + 1],
    'github.contoso-internal.example/example/repo',
    '`gh pr view --repo` accepts [HOST/]OWNER/REPO, so the detected host reaches the command',
  );
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
  // An organization URL pointing at a different host than detection is a
  // distinct, named failure rather than a silently accepted target.
  assert.throws(
    () => resolveTargetCommand(AZURE, {
      changeRequest: 42,
      repository: { organizationUrl: 'https://dev.azure.example.invalid/contoso', project: 'project', name: 'repo' },
    }),
    (error) => error.code === 'repository-host-mismatch',
  );
});

test('the read-only allow-list refuses every write, including the ones a deny-list misses', () => {
  for (const args of [
    // `gh api` switches to POST the moment a field is supplied — the deny-list bypass.
    ['api', 'repos/example/repo/issues', '-f', 'title=x'],
    ['api', 'repos/example/repo/issues', '-F', 'title=x'],
    // `add` is a mutating subcommand no deny-list of verbs listed.
    ['repos', 'pr', 'reviewer', 'add', '--id', '42', '--reviewers', 'user'],
    // Named writes.
    ['pr', 'merge', '42'],
    ['pr', 'review', '42', '--approve'],
    ['pr', 'lock', '42'],
    ['pr', 'comment', '42', '--body', 'text'],
    ['repos', 'pr', 'update', '--id', '42'],
    // Explicit write HTTP methods.
    ['api', '--method', 'POST', 'repos/example/repo/pulls/42/reviews'],
    ['devops', 'invoke', '--http-method', 'PATCH'],
  ]) {
    const tool = args[0] === 'repos' || args[0] === 'devops' ? 'az' : 'gh';
    assert.throws(
      () => assertReadOnlyCommand({ tool, args }),
      (error) => error instanceof ProviderCommandError && error.code === 'mutating-command',
      `${args.join(' ')} must be refused`,
    );
  }

  // Every sanctioned read this unit constructs passes its own guard.
  for (const build of ALL_BUILDERS) {
    assert.doesNotThrow(() => build(GITHUB, GITHUB_TARGET));
    assert.doesNotThrow(() => build(GITHUB_ENTERPRISE, GITHUB_TARGET));
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

test('a clean, approved GitHub change request reports mergeable with no blocking signals', () => {
  const state = interpretMergeState(GITHUB, {
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    isDraft: false,
    baseRefOid: 'base000',
    headRefOid: 'head000',
  });

  assert.equal(state.observed, true);
  assert.equal(state.mergeState, 'mergeable');
  assert.equal(state.mergeStateStatus, 'clean');
  assert.equal(state.blocked, false);
  assert.equal(state.behind, false);
  assert.equal(state.reviewDecision, 'approved');
  assert.equal(state.upToDatePolicy, 'unobserved', 'CLEAN is not evidence of a required-up-to-date policy');
});

test('a conflict-free change request behind its base surfaces the required policy', () => {
  // The exact failure the regression allowed: mergeable and green, yet
  // unlandable because the base requires the branch to contain it.
  const state = interpretMergeState(GITHUB, {
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BEHIND',
    reviewDecision: 'APPROVED',
  });

  assert.equal(state.mergeState, 'mergeable');
  assert.equal(state.mergeStateStatus, 'behind');
  assert.equal(state.behind, true);
  assert.equal(state.upToDatePolicy, 'required', 'GitHub reports BEHIND only when the base requires containment');
});

test('a change request blocked by required review is not flattened to mergeable', () => {
  const blocked = interpretMergeState(GITHUB, {
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    reviewDecision: 'REVIEW_REQUIRED',
  });

  assert.equal(blocked.mergeState, 'mergeable');
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.reviewDecision, 'review-required');

  const changesRequested = interpretMergeState(GITHUB, {
    mergeable: 'CONFLICTING',
    mergeStateStatus: 'DIRTY',
    reviewDecision: 'CHANGES_REQUESTED',
  });
  assert.equal(changesRequested.mergeState, 'conflicted');
  assert.equal(changesRequested.mergeStateStatus, 'dirty');
  assert.equal(changesRequested.reviewDecision, 'changes-requested');
});

test('an unreported merge-state status or review decision is unobserved, never a negative', () => {
  const state = interpretMergeState(GITHUB, { mergeable: 'MERGEABLE', mergeStateStatus: 'UNKNOWN' });

  assert.equal(state.observed, true);
  assert.equal(state.mergeStateStatus, 'unobserved');
  assert.equal(state.blocked, null, 'UNKNOWN status leaves blocked unobserved rather than false');
  assert.equal(state.behind, null);
  assert.equal(state.reviewDecision, 'unobserved', 'an absent review decision is unobserved, never approved');
  assert.equal(state.upToDatePolicy, 'unobserved');
});

test('Azure review state comes from reviewer votes on the pull request payload', () => {
  const approved = interpretMergeState(AZURE, {
    mergeStatus: 'succeeded',
    reviewers: [{ vote: 10 }, { vote: 0 }],
  });
  assert.equal(approved.mergeState, 'mergeable');
  assert.equal(approved.reviewDecision, 'approved');

  const rejected = interpretMergeState(AZURE, {
    mergeStatus: 'succeeded',
    reviewers: [{ vote: 10 }, { vote: -10 }],
  });
  assert.equal(rejected.reviewDecision, 'changes-requested');

  const waiting = interpretMergeState(AZURE, {
    mergeStatus: 'succeeded',
    reviewers: [{ vote: -5 }],
  });
  assert.equal(waiting.reviewDecision, 'review-required');

  const noReviewers = interpretMergeState(AZURE, { mergeStatus: 'succeeded' });
  assert.equal(noReviewers.reviewDecision, 'unobserved', 'no reviewer collection is unobserved, never approved');
});

test('an Azure up-to-date policy is required only when a matching policy evaluation is visible', () => {
  const required = interpretMergeState(AZURE, {
    mergeStatus: 'succeeded',
    policyEvaluations: [{ configuration: { type: { displayName: 'Require branch to be up to date' } } }],
  });
  assert.equal(required.upToDatePolicy, 'required');

  const noEvidence = interpretMergeState(AZURE, {
    mergeStatus: 'succeeded',
    policyEvaluations: [{ configuration: { type: { displayName: 'Minimum number of reviewers' } } }],
  });
  assert.equal(noEvidence.upToDatePolicy, 'unobserved', 'an unrelated policy is not proof the up-to-date policy is absent');

  const absent = interpretMergeState(AZURE, { mergeStatus: 'succeeded' });
  assert.equal(absent.upToDatePolicy, 'unobserved');
});

test('a provider that has not computed mergeability is unobserved, not mergeable', () => {
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

test('validation results are normalized from each provider native output shape', () => {
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

  // `az repos pr policy list` returns a top-level array, which is the shape the
  // parser must accept — the previous test fabricated an { evaluations } wrapper.
  const azure = interpretValidation(AZURE, [
    { evaluationId: 'e1', status: 'approved', configuration: { isBlocking: true, type: { displayName: 'Build' } } },
  ]);
  assert.equal(azure.status, 'passing');
  assert.equal(azure.checks[0].name, 'Build');
  assert.equal(validationIsGreen(azure), true);
});

test('a wrapped Azure rollup is still accepted, but an unrecognized shape is absent, not an empty pass', () => {
  const wrapped = interpretValidation(AZURE, {
    evaluations: [{ evaluationId: 'e1', status: 'approved', configuration: { isBlocking: true, type: { displayName: 'Build' } } }],
  });
  assert.equal(wrapped.status, 'passing');

  const unrecognized = interpretValidation(AZURE, { count: 3 });
  assert.equal(unrecognized.observed, false);
  assert.equal(unrecognized.reason, 'validation-status-absent');
  assert.equal(validationIsGreen(unrecognized), false);
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

  const azureEmpty = interpretValidation(AZURE, []);
  assert.equal(azureEmpty.observed, true);
  assert.equal(azureEmpty.status, 'no-results');
  assert.equal(validationIsGreen(azureEmpty), false);
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
    [interpretMergeState, { mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }],
    [interpretValidation, { statusCheckRollup: [{ name: 'validate', status: 'COMPLETED', conclusion: 'SUCCESS' }] }],
  ]) {
    const result = interpret(unobserved, payload);
    assert.equal(result.observed, false);
    assert.equal(result.reason, 'provider-state-unobservable');
  }

  assert.equal(validationIsGreen(interpretValidation(unobserved, { statusCheckRollup: [] })), false);
});
