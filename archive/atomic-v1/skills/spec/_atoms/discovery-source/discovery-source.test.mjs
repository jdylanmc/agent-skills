import assert from 'node:assert/strict';
import test from 'node:test';

import { validateDiscoverySource, DiscoverySourceError } from './discovery-source.mjs';

// A fake verifier that accepts everything and returns realistic provenance.
function passingVerifier(overrides = {}) {
  return async () => ({
    verified: true,
    state: 'approved',
    recomputedNanoDigest: 'a'.repeat(64),
    recomputedPublishedDigest: 'a'.repeat(64),
    recomputedPublishedCommit: 'c'.repeat(40),
    publishedSource: 'docs/agent/discovery/payments.md',
    publishedSourceRevision: 'a'.repeat(64),
    ...overrides,
  });
}

function source(overrides = {}) {
  return {
    version: 1,
    kind: 'markdown',
    locator: 'docs/agent/discovery/payments.md',
    alignment: 'confirmed',
    capturedRevision: 'a'.repeat(64),
    currentRevision: 'a'.repeat(64),
    repositoryRoot: '/fake/repo',
    specNanoPath: 'docs/agent/specs/checkout-payments.nano.md',
    approvalEvidence: null,
    confirmedFacts: ['Checkout currently accepts one payment method [source: user research].'],
    decisions: ['Support one additional payment method.'],
    assumptions: [],
    contradictions: [],
    unresolvedQuestions: [],
    scope: ['Customer checkout payment selection.'],
    exclusions: ['Payment-provider implementation.'],
    ...overrides,
  };
}

function code(run) {
  return run().catch((error) => error.code);
}

test('accepts a confirmed fresh Markdown Discovery artifact', async () => {
  const result = await validateDiscoverySource(source(), { verify: passingVerifier() });
  assert.equal(result.status, 'ready');
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.approval, null);
  assert.equal(result.source.kind, 'markdown');
  assert.equal(result.source.locator, 'docs/agent/discovery/payments.md');
  assert.equal(result.source.currentRevision, 'a'.repeat(64));
});

test('accepts a revision-bound tracker issue as the same intake contract', async () => {
  const result = await validateDiscoverySource(source({
    kind: 'tracker-issue',
    locator: 'https://github.com/example/app/issues/42',
    capturedRevision: 'issue-42@2026-08-26T10:00:00Z',
    currentRevision: 'issue-42@2026-08-26T10:00:00Z',
  }), { verify: passingVerifier() });
  assert.equal(result.status, 'ready');
  assert.equal(result.freshness, 'fresh');
  assert.equal(result.source.kind, 'tracker-issue');
});

test('refuses raw or inferred alignment', async () => {
  assert.equal(await code(() => validateDiscoverySource(source({ alignment: 'verified' }), { verify: passingVerifier() })), 'unconfirmed');
  assert.equal(await code(() => validateDiscoverySource(source({ alignment: 'we discussed it' }), { verify: passingVerifier() })), 'unconfirmed');
});

test('refuses a source that moved after confirmation', async () => {
  assert.equal(
    await code(() => validateDiscoverySource(source({ currentRevision: 'b'.repeat(64) }), { verify: passingVerifier() })),
    'stale',
  );
});

test('keeps Markdown inside the durable Discovery workspace', async () => {
  assert.equal(
    await code(() => validateDiscoverySource(source({ locator: '../private/discovery.md' }), { verify: passingVerifier() })),
    'invalid-source',
  );
  assert.equal(
    await code(() => validateDiscoverySource(source({ locator: 'docs/discovery.md' }), { verify: passingVerifier() })),
    'invalid-source',
  );
});

test('refuses materially incomplete shared understanding', async () => {
  assert.equal(await code(() => validateDiscoverySource(source({ confirmedFacts: [] }), { verify: passingVerifier() })), 'incomplete');
  assert.equal(await code(() => validateDiscoverySource(source({ scope: [] }), { verify: passingVerifier() })), 'incomplete');
  assert.equal(await code(() => validateDiscoverySource(source({ exclusions: [] }), { verify: passingVerifier() })), 'incomplete');
});

test('rejects unknown fields instead of silently losing evidence', async () => {
  assert.equal(await code(() => validateDiscoverySource(source({ transcript: 'raw conversation' }), { verify: passingVerifier() })), 'invalid-source');
});

test('distinguishes a malformed record from materially incomplete Discovery', async () => {
  const malformed = source();
  delete malformed.kind;
  assert.equal(await code(() => validateDiscoverySource(malformed, { verify: passingVerifier() })), 'invalid-source');
  assert.equal(
    await code(() => validateDiscoverySource(source({ kind: undefined }), { verify: passingVerifier() })),
    'invalid-source',
  );
  assert.equal(await code(() => validateDiscoverySource(source({ kind: null }), { verify: passingVerifier() })), 'invalid-source');
  assert.equal(await code(() => validateDiscoverySource(source({ locator: 42 }), { verify: passingVerifier() })), 'invalid-source');
  assert.equal(await code(() => validateDiscoverySource(source({ decisions: null }), { verify: passingVerifier() })), 'invalid-source');
  assert.equal(await code(() => validateDiscoverySource(source({ confirmedFacts: [] }), { verify: passingVerifier() })), 'incomplete');
  assert.equal(await code(() => validateDiscoverySource(source({ scope: [] }), { verify: passingVerifier() })), 'incomplete');
  assert.equal(await code(() => validateDiscoverySource(source({ exclusions: [] }), { verify: passingVerifier() })), 'incomplete');
});

// --- State-dependent freshness tests ---

function approvedEvidence(overrides = {}) {
  return {
    version: 1,
    boundary: 'git-default-branch',
    remote: 'origin',
    defaultBranch: 'main',
    defaultBranchRef: 'origin/main',
    nanoPath: 'docs/agent/specs/checkout-payments.nano.md',
    nanoDigest: 'a'.repeat(64),
    publishedDigest: 'a'.repeat(64),
    publishedCommit: 'c'.repeat(40),
    observedAt: '2026-08-28T12:00:00Z',
    observedWith: ['git fetch origin'],
    ...overrides,
  };
}

function draftEvidence(overrides = {}) {
  return approvedEvidence({
    publishedDigest: null,
    publishedCommit: null,
    ...overrides,
  });
}

test('a fresh source still returns ready', async () => {
  const result = await validateDiscoverySource(source({ approvalEvidence: approvedEvidence() }), { verify: passingVerifier() });
  assert.equal(result.status, 'ready');
  assert.equal(result.freshness, 'fresh');
});

test('a moved revision with no approval evidence still refuses stale', async () => {
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: null,
    }), { verify: passingVerifier() })),
    'stale',
  );
});

test('a moved revision with approved and verified evidence returns held and carries both revisions', async () => {
  const result = await validateDiscoverySource(source({
    currentRevision: 'b'.repeat(64),
    approvalEvidence: approvedEvidence(),
  }), { verify: passingVerifier() });
  assert.equal(result.status, 'held');
  assert.equal(result.freshness, 'held');
  assert.equal(result.approval.state, 'approved');
  assert.equal(result.source.revision, 'a'.repeat(64));
  assert.equal(result.source.currentRevision, 'b'.repeat(64));
});

test('a moved revision with draft evidence refuses stale', async () => {
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: draftEvidence(),
    }), { verify: passingVerifier() })),
    'stale',
  );
});

test('a moved revision with structurally invalid approval record refuses rather than holding', async () => {
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: { approved: true },
    }), { verify: passingVerifier() })),
    'invalid-source',
  );
});

test('held is never reachable without an approved observation', async () => {
  // No evidence
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: null,
    }), { verify: passingVerifier() })),
    'stale',
  );
  // Draft evidence
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: draftEvidence(),
    }), { verify: passingVerifier() })),
    'stale',
  );
  // Invalid evidence
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: { bad: 'data' },
    }), { verify: passingVerifier() })),
    'invalid-source',
  );
});

// F1: Verification is the only route to held — fabricated observations are caught.

test('held is never reachable without verification passing', async () => {
  const { ApprovalStateError } = await import('../approval-state/approval-state.mjs');
  const failingVerifier = async () => {
    throw new ApprovalStateError('unverified-observation', 'digests disagree');
  };
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: failingVerifier })),
    'invalid-source',
  );
});

// F2: Approval is bound to the exact source and revision — cross-spec replay is refused.

test('an approval for a different source locator refuses rather than holding', async () => {
  const wrongSourceVerifier = passingVerifier({
    publishedSource: 'docs/agent/discovery/other.md',
  });
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: wrongSourceVerifier })),
    'invalid-source',
  );
});

test('an approval for a different source revision refuses rather than holding', async () => {
  const wrongRevisionVerifier = passingVerifier({
    publishedSourceRevision: 'f'.repeat(64),
  });
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: wrongRevisionVerifier })),
    'invalid-source',
  );
});

// F2: held requires verified === true AND state === 'approved' from the verifier result.

test('held is never reachable when verifier returns verified: false', async () => {
  const unverifiedVerifier = passingVerifier({ verified: false });
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: unverifiedVerifier })),
    'invalid-source',
  );
});

test('held is never reachable when verifier returns verified absent', async () => {
  const noVerifiedField = async () => ({
    state: 'approved',
    recomputedNanoDigest: 'a'.repeat(64),
    recomputedPublishedDigest: 'a'.repeat(64),
    recomputedPublishedCommit: 'c'.repeat(40),
    publishedSource: 'docs/agent/discovery/payments.md',
    publishedSourceRevision: 'a'.repeat(64),
  });
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: noVerifiedField })),
    'invalid-source',
  );
});

test('held is never reachable when verifier returns state !== approved', async () => {
  const draftStateVerifier = passingVerifier({ state: 'draft' });
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: draftStateVerifier })),
    'invalid-source',
  );
});

test('held is never reachable when verifier returns a non-object (null)', async () => {
  const nullVerifier = async () => null;
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: nullVerifier })),
    'invalid-source',
  );
});

// F3: missing provenance is refused — both Source and Source revision must be present.

test('held is refused when both published provenance lines are missing', async () => {
  const noProvenanceVerifier = passingVerifier({
    publishedSource: null,
    publishedSourceRevision: null,
  });
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: noProvenanceVerifier })),
    'invalid-source',
  );
});

test('held is refused when only Source is present (Source revision missing)', async () => {
  const missingRevVerifier = passingVerifier({
    publishedSourceRevision: null,
  });
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: missingRevVerifier })),
    'invalid-source',
  );
});

test('held is refused when only Source revision is present (Source missing)', async () => {
  const missingSourceVerifier = passingVerifier({
    publishedSource: null,
  });
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      approvalEvidence: approvedEvidence(),
    }), { verify: missingSourceVerifier })),
    'invalid-source',
  );
});

// F4: cross-specification replay is refused — specNanoPath binds the approval.

test('an approval for a different specification (same source/revision) refuses rather than holding', async () => {
  // Two specifications sharing the same Discovery source and revision — the
  // approval for checkout-payments must not hold notifications-preferences.
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      specNanoPath: 'docs/agent/specs/notifications-preferences.nano.md',
      approvalEvidence: approvedEvidence(),
    }), { verify: passingVerifier() })),
    'invalid-source',
  );
});

test('specNanoPath is required when approval evidence is present', async () => {
  assert.equal(
    await code(() => validateDiscoverySource(source({
      currentRevision: 'b'.repeat(64),
      specNanoPath: null,
      approvalEvidence: approvedEvidence(),
    }), { verify: passingVerifier() })),
    'invalid-source',
  );
});

test('a malformed specNanoPath is refused', async () => {
  assert.equal(
    await code(() => validateDiscoverySource(source({
      specNanoPath: 'not/a/valid/spec-path.md',
    }), { verify: passingVerifier() })),
    'invalid-source',
  );
});

test('specNanoPath may be null when no approval evidence is supplied', async () => {
  const result = await validateDiscoverySource(source({
    specNanoPath: null,
    approvalEvidence: null,
  }), { verify: passingVerifier() });
  assert.equal(result.status, 'ready');
});
