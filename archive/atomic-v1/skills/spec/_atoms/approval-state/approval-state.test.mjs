import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveApprovalState,
  verifyApprovalObservation,
  ApprovalStateError,
} from './approval-state.mjs';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const COMMIT_A = 'c'.repeat(40);

function observation(overrides = {}) {
  return {
    version: 1,
    boundary: 'git-default-branch',
    remote: 'origin',
    defaultBranch: 'main',
    defaultBranchRef: 'origin/main',
    nanoPath: 'docs/agent/specs/checkout-payments.nano.md',
    nanoDigest: DIGEST_A,
    publishedDigest: DIGEST_A,
    publishedCommit: COMMIT_A,
    observedAt: '2026-08-28T12:00:00Z',
    observedWith: ['git fetch origin', 'git show origin/main:docs/agent/specs/checkout-payments.nano.md'],
    ...overrides,
  };
}

function code(run) {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
}

test('a published digest that matches resolves approved and carries the commit', () => {
  const result = resolveApprovalState(observation());
  assert.equal(result.state, 'approved');
  assert.equal(result.slug, 'checkout-payments');
  assert.equal(result.commit, COMMIT_A.toLowerCase());
  assert.equal(result.digest, DIGEST_A.toLowerCase());
  assert.equal(result.publishedDigest, DIGEST_A.toLowerCase());
  assert.deepEqual(result.reasons, []);
});

test('digest comparison is case-insensitive', () => {
  const result = resolveApprovalState(observation({
    nanoDigest: DIGEST_A.toUpperCase(),
    publishedDigest: DIGEST_A.toLowerCase(),
  }));
  assert.equal(result.state, 'approved');
});

test('a pair absent from the default branch resolves draft / not-on-default-branch', () => {
  const result = resolveApprovalState(observation({
    publishedDigest: null,
    publishedCommit: null,
  }));
  assert.equal(result.state, 'draft');
  assert.deepEqual(result.reasons, ['not-on-default-branch']);
  assert.equal(result.commit, null);
  assert.equal(result.publishedDigest, null);
});

test('a working copy that differs from the merged bytes resolves draft / differs-from-default-branch', () => {
  const result = resolveApprovalState(observation({
    nanoDigest: DIGEST_B,
  }));
  assert.equal(result.state, 'draft');
  assert.deepEqual(result.reasons, ['differs-from-default-branch']);
});

test('a forged approved: true field is refused as invalid-observation', () => {
  assert.equal(
    code(() => resolveApprovalState({ ...observation(), approved: true })),
    'invalid-observation',
  );
});

test('any unknown field is refused as invalid-observation', () => {
  assert.equal(
    code(() => resolveApprovalState({ ...observation(), selfAsserted: 'yes' })),
    'invalid-observation',
  );
});

test('a bare local branch name as defaultBranchRef is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ defaultBranchRef: 'main' }))),
    'invalid-observation',
  );
});

test('defaultBranchRef that does not match <remote>/<defaultBranch> is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ defaultBranchRef: 'upstream/main' }))),
    'invalid-observation',
  );
});

test('publishedCommit without publishedDigest is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ publishedDigest: null }))),
    'invalid-observation',
  );
});

test('publishedDigest without publishedCommit is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ publishedCommit: null }))),
    'invalid-observation',
  );
});

test('an unsupported boundary returns unsupported-boundary', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ boundary: 'code-review-approval' }))),
    'unsupported-boundary',
  );
});

test('a malformed nanoDigest is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ nanoDigest: 'not-a-digest' }))),
    'invalid-observation',
  );
  assert.equal(
    code(() => resolveApprovalState(observation({ nanoDigest: 'a'.repeat(63) }))),
    'invalid-observation',
  );
});

test('a malformed publishedDigest is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ publishedDigest: 'xyz' }))),
    'invalid-observation',
  );
});

test('a malformed publishedCommit is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ publishedCommit: 'short' }))),
    'invalid-observation',
  );
});

test('a nanoPath outside docs/agent/specs/ is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ nanoPath: 'src/specs/checkout.nano.md' }))),
    'invalid-observation',
  );
});

test('a traversal path is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ nanoPath: 'docs/agent/specs/../../../etc/passwd' }))),
    'invalid-observation',
  );
});

test('a nanoPath with backslashes is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ nanoPath: 'docs\\agent\\specs\\checkout.nano.md' }))),
    'invalid-observation',
  );
});

test('an empty observedWith is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ observedWith: [] }))),
    'invalid-observation',
  );
});

test('an observedWith with empty strings is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ observedWith: ['git fetch', ''] }))),
    'invalid-observation',
  );
});

test('an unparsable observedAt is refused', () => {
  assert.equal(
    code(() => resolveApprovalState(observation({ observedAt: 'not-a-date' }))),
    'invalid-observation',
  );
});

test('a missing field is refused', () => {
  const obs = observation();
  delete obs.nanoDigest;
  assert.equal(code(() => resolveApprovalState(obs)), 'invalid-observation');
});

test('every refusal path yields a refusal and never approved (fail closed)', () => {
  const badInputs = [
    { boundary: 'local-flag' },
    { defaultBranchRef: 'main' },
    { defaultBranchRef: 'upstream/develop' },
    { nanoPath: 'src/foo.nano.md' },
    { nanoDigest: 'bad' },
    { publishedDigest: null },
    { publishedCommit: null },
    { observedWith: [] },
    { observedAt: 'never' },
    { approved: true },
  ];
  for (const override of badInputs) {
    assert.throws(
      () => resolveApprovalState(observation(override)),
      (error) => error instanceof ApprovalStateError,
      `expected refusal for override: ${JSON.stringify(override)}`,
    );
  }
});

// R1: slug vocabulary must agree between approval-state and spec-pair.
// A digit-bearing slug must resolve through approval-state — if it does not,
// a pair written and validated by spec-pair can never be recognized as approved.

test('a digit-bearing slug resolves through approval-state (slug vocabulary agrees with spec-pair)', () => {
  const result = resolveApprovalState(observation({
    nanoPath: 'docs/agent/specs/payments-v2.nano.md',
  }));
  assert.equal(result.state, 'approved');
  assert.equal(result.slug, 'payments-v2');
});

test('a slug with digits in every word resolves through approval-state', () => {
  const result = resolveApprovalState(observation({
    nanoPath: 'docs/agent/specs/checkout2.nano.md',
  }));
  assert.equal(result.state, 'approved');
  assert.equal(result.slug, 'checkout2');
});

test('a slug starting with a digit resolves through approval-state', () => {
  const result = resolveApprovalState(observation({
    nanoPath: 'docs/agent/specs/2fa-login.nano.md',
  }));
  assert.equal(result.state, 'approved');
  assert.equal(result.slug, '2fa-login');
});

// R2: Verification tests — the observation is verified against the repository,
// not trusted from the caller.

import crypto from 'node:crypto';

function fakeGit({ revParseReturn, showReturn, showError, remoteUrlReturn, symbolicFullNameReturn, remoteHeadReturn } = {}) {
  return async ({ args }) => {
    // git remote get-url <remote>
    if (args[0] === 'remote' && args[1] === 'get-url') {
      if (remoteUrlReturn instanceof Error) return { status: 'error', stderr: remoteUrlReturn.message };
      return { status: 'ok', stdout: remoteUrlReturn ?? 'https://github.com/example/repo.git\n' };
    }
    // git rev-parse --symbolic-full-name <ref>
    if (args[0] === 'rev-parse' && args[1] === '--symbolic-full-name') {
      if (symbolicFullNameReturn instanceof Error) return { status: 'error', stderr: symbolicFullNameReturn.message };
      return { status: 'ok', stdout: symbolicFullNameReturn ?? 'refs/remotes/origin/main\n' };
    }
    // git symbolic-ref refs/remotes/<remote>/HEAD
    if (args[0] === 'symbolic-ref') {
      if (remoteHeadReturn instanceof Error) return { status: 'error', stderr: remoteHeadReturn.message };
      return { status: 'ok', stdout: remoteHeadReturn ?? 'refs/remotes/origin/main\n' };
    }
    if (args[0] === 'rev-parse') {
      if (revParseReturn instanceof Error) return { status: 'error', stderr: revParseReturn.message };
      return { status: 'ok', stdout: revParseReturn ?? COMMIT_A + '\n' };
    }
    if (args[0] === 'show') {
      if (showError) return { status: 'error', stderr: showError.message };
      return { status: 'ok', stdout: showReturn ?? Buffer.from('nano content') };
    }
    throw new Error(`unexpected git args: ${args}`);
  };
}

function digestOf(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

test('verifyApprovalObservation passes when all fields agree with the repository', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  const result = await verifyApprovalObservation({
    repositoryRoot: '/fake/root',
    observation: obs,
    git,
    _readFile: () => nanoContent,
  });
  assert.equal(result.verified, true);
});

test('verifyApprovalObservation refuses when nanoDigest disagrees', async () => {
  const nanoContent = Buffer.from('nano content');
  const realDigest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: 'f'.repeat(64),
    publishedDigest: realDigest,
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /nanoDigest/);
      return true;
    },
  );
});

test('verifyApprovalObservation refuses when publishedCommit disagrees', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: 'd'.repeat(40),
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /publishedCommit/);
      return true;
    },
  );
});

test('verifyApprovalObservation refuses when publishedDigest disagrees', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: 'e'.repeat(64),
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /publishedDigest/);
      return true;
    },
  );
});

test('verifyApprovalObservation refuses when the ref cannot be resolved (fail closed)', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({ revParseReturn: new Error('not a ref') });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /could not resolve ref/);
      return true;
    },
  );
});

test('verifyApprovalObservation treats a recognizable missing-path failure as null/null', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: null,
    publishedCommit: null,
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showError: new Error("fatal: path 'docs/agent/specs/checkout-payments.nano.md' does not exist in 'origin/main'"),
  });

  const result = await verifyApprovalObservation({
    repositoryRoot: '/fake/root',
    observation: obs,
    git,
    _readFile: () => nanoContent,
  });
  assert.equal(result.verified, true);
  assert.equal(result.recomputedPublishedDigest, null);
  assert.equal(result.recomputedPublishedCommit, null);
});

test('verifyApprovalObservation refuses an unrecognized git failure rather than classifying as absent', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: null,
    publishedCommit: null,
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showError: new Error('repository corrupted: packfile invalid'),
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /git failure/);
      assert.match(err.message, /repository corrupted/);
      return true;
    },
  );
});

// R3: Published provenance parsing — the verifier extracts Source and Source
// revision from the published nano blob so discovery-source can bind the
// approval to the exact source and revision the human merged.

test('verifyApprovalObservation returns published Source and Source revision from the nano blob', async () => {
  const nanoText = [
    '# Checkout Payments',
    '',
    '- Spec ID: SPEC-checkout-payments',
    '- Source: docs/agent/discovery/payments.md',
    '- Source revision: ' + 'a'.repeat(64),
    '- Full specification: [Full](./checkout-payments.full.md)',
    '',
    '## Intention',
    '',
    'Test intention.',
  ].join('\n');
  const nanoContent = Buffer.from(nanoText);
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  const result = await verifyApprovalObservation({
    repositoryRoot: '/fake/root',
    observation: obs,
    git,
    _readFile: () => nanoContent,
  });
  assert.equal(result.verified, true);
  assert.equal(result.publishedSource, 'docs/agent/discovery/payments.md');
  assert.equal(result.publishedSourceRevision, 'a'.repeat(64));
});

test('verifyApprovalObservation returns null provenance when the path is absent', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: null,
    publishedCommit: null,
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showError: new Error("fatal: path 'docs/agent/specs/checkout-payments.nano.md' does not exist in 'origin/main'"),
  });

  const result = await verifyApprovalObservation({
    repositoryRoot: '/fake/root',
    observation: obs,
    git,
    _readFile: () => nanoContent,
  });
  assert.equal(result.publishedSource, null);
  assert.equal(result.publishedSourceRevision, null);
});

test('verifyApprovalObservation does not scan fenced code blocks for provenance lines', async () => {
  const nanoText = [
    '# Checkout Payments',
    '',
    '- Spec ID: SPEC-checkout-payments',
    '- Source: docs/agent/discovery/payments.md',
    '- Source revision: ' + 'a'.repeat(64),
    '- Full specification: [Full](./checkout-payments.full.md)',
    '',
    '## Intention',
    '',
    'Test intention.',
    '',
    '```',
    '- Source: docs/agent/discovery/other.md',
    '```',
  ].join('\n');
  const nanoContent = Buffer.from(nanoText);
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  const result = await verifyApprovalObservation({
    repositoryRoot: '/fake/root',
    observation: obs,
    git,
    _readFile: () => nanoContent,
  });
  assert.equal(result.publishedSource, 'docs/agent/discovery/payments.md');
});

// F1: the verified ref is proved rather than asserted — remote identity,
// remote-tracking ref, and default branch are all checked.

test('verifyApprovalObservation refuses when the remote is not configured', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    remote: 'attacker',
    defaultBranch: 'review',
    defaultBranchRef: 'attacker/review',
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
    observedWith: ['git fetch attacker', 'git show attacker/review:docs/agent/specs/checkout-payments.nano.md'],
  });

  const git = fakeGit({
    remoteUrlReturn: new Error('No such remote'),
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /not a configured remote/);
      return true;
    },
  );
});

test('verifyApprovalObservation refuses when the ref is not a remote-tracking ref', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({
    symbolicFullNameReturn: 'refs/heads/main\n',
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /does not resolve to a remote-tracking ref/);
      return true;
    },
  );
});

test('verifyApprovalObservation refuses when remote HEAD is not set', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({
    remoteHeadReturn: new Error('not a symbolic ref'),
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /cannot prove/);
      assert.match(err.message, /git remote set-head/);
      return true;
    },
  );
});

test('verifyApprovalObservation refuses when the branch is not the remote default', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({
    remoteHeadReturn: 'refs/remotes/origin/develop\n',
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /not the default branch/);
      return true;
    },
  );
});

test('verifyApprovalObservation refuses an attacker-chosen remote/branch that happens to hold matching bytes', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    remote: 'attacker',
    defaultBranch: 'review',
    defaultBranchRef: 'attacker/review',
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
    observedWith: ['git fetch attacker', 'git show attacker/review:docs/agent/specs/checkout-payments.nano.md'],
  });

  // Even if the remote is configured, the ref must be a real remote-tracking ref.
  const git = fakeGit({
    remoteUrlReturn: 'https://attacker.example.com/repo.git\n',
    symbolicFullNameReturn: new Error('not found'),
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      return true;
    },
  );
});

test('verifyApprovalObservation refuses when observedWith does not reference the remote', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
    observedWith: ['git fetch somewhere-else', 'git show something:docs/agent/specs/checkout-payments.nano.md'],
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /observedWith/);
      assert.match(err.message, /remote/);
      return true;
    },
  );
});

test('verifyApprovalObservation refuses when observedWith does not reference the nanoPath', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
    observedWith: ['git fetch origin', 'git show origin/main:some/other/path.md'],
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  await assert.rejects(
    () => verifyApprovalObservation({
      repositoryRoot: '/fake/root',
      observation: obs,
      git,
      _readFile: () => nanoContent,
    }),
    (err) => {
      assert.equal(err.code, 'unverified-observation');
      assert.match(err.message, /observedWith/);
      assert.match(err.message, /nanoPath/);
      return true;
    },
  );
});

test('verifyApprovalObservation returns the resolved state from the observation', async () => {
  const nanoContent = Buffer.from('nano content');
  const digest = digestOf(nanoContent);
  const obs = observation({
    nanoDigest: digest,
    publishedDigest: digest,
    publishedCommit: COMMIT_A,
  });

  const git = fakeGit({
    revParseReturn: COMMIT_A + '\n',
    showReturn: nanoContent,
  });

  const result = await verifyApprovalObservation({
    repositoryRoot: '/fake/root',
    observation: obs,
    git,
    _readFile: () => nanoContent,
  });
  assert.equal(result.verified, true);
  assert.equal(result.state, 'approved');
});
