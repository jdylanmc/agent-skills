import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_REMEDIATION_LIMIT,
  authorizeFreshContinuation,
  digestCanonicalContinuationState,
  evaluateRemediationContinuation,
  expectedHandoffDocument,
  fingerprintFinding,
} from './remediation-continuation.mjs';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const finding = {
  id: 'roast-concurrency',
  severity: 'Must fix',
  classification: 'implementation',
  ledgerEntryId: 'L1',
  location: 'skills/ship/SKILL.md:1',
  rule: 'implementation-blockers-before-shepherd',
  evidence: 'race remains reachable',
};

function decision(overrides = {}) {
  return evaluateRemediationContinuation({
    localAttempts: LOCAL_REMEDIATION_LIMIT,
    localLimit: LOCAL_REMEDIATION_LIMIT,
    continuationsUsed: 0,
    confirmedPacket: {
      id: 'packet-164',
      digest: '9'.repeat(64),
      globalContinuationSource: 'operator-confirmed delivery packet',
      globalContinuationLimit: 2,
    },
    findings: [finding],
    validation: {
      evidenceComplete: true,
      status: 'passed',
      repository: { revision: HEAD },
      steps: [],
    },
    validationClassifications: [],
    previousState: null,
    currentState: {
      headSha: HEAD,
      diffDigest: 'd'.repeat(64),
      validationStatus: 'passed',
      criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
    },
    ...overrides,
  });
}

function payload(expected, overrides = {}) {
  const values = {
    issue: expected.issue,
    branch: expected.branch,
    worktree: expected.worktree,
    base_sha: expected.baseSha,
    head_sha: expected.headSha,
    continuation_generation: expected.nextGeneration,
    local_remediation_limit: LOCAL_REMEDIATION_LIMIT,
    global_continuation_limit: expected.globalContinuationPolicy.limit,
    global_continuation_source: expected.globalContinuationPolicy.source,
    confirmed_packet_id: expected.globalContinuationPolicy.packetId,
    confirmed_packet_digest: expected.globalContinuationPolicy.packetDigest,
    finding_fingerprints: JSON.stringify(expected.findingFingerprints),
    change_ledger: JSON.stringify(expected.changeLedger),
    exclusions: JSON.stringify(expected.exclusions),
    change_request: JSON.stringify(expected.changeRequest),
    isolation_state: JSON.stringify(expected.isolationState),
    criterion_verdicts: JSON.stringify(expected.criterionVerdicts),
    reconciliation_result: JSON.stringify(expected.reconciliationResult),
    run_ci_evidence: JSON.stringify(expected.runCiEvidence),
    roast_findings: JSON.stringify(expected.roastFindings),
    prior_remediation_attempts: JSON.stringify(expected.priorRemediationAttempts),
  };
  return {
    schema_version: 1,
    run_identity: { run_id: expected.runId, root_skill: 'ship' },
    source_agent: { id: expected.sourceAgent, role: 'implementation worker' },
    target_agent: {
      id: expected.targetAgent,
      role: 'fresh continuation worker',
      invocation_reason: 'local remediation exhausted',
    },
    task_contract: {
      goal: 'Clear the remaining in-scope blocker.',
      scope: 'Issue 164 and its confirmed ledger only.',
      context: 'Continue the same branch from the captured head.',
      verify: 'Reconcile the complete diff, run run-ci, and obtain a fresh Roast.',
      timebox: 'One fresh local budget of five attempts.',
      forbidden: 'No merge, approval, force push, scope expansion, or risk acceptance.',
      report: 'Return criterion verdicts and complete evidence.',
      standing: 'Stop on stale identity, no progress, or the global ceiling.',
    },
    inputs: Object.entries(values).map(([name, value]) => ({
      name,
      value: String(value),
      source: 'confirmed Ship run state',
    })),
    constraints: ['One issue and one mutable owner.'],
    assumptions: [],
    artifacts_and_references: [{ reference: 'https://github.com/jdylanmc/agent-skills/issues/164', note: 'issue' }],
    acceptance_criteria: expected.acceptanceCriteria,
    open_questions: [],
    ...overrides,
  };
}

function authorization(overrides = {}) {
  const currentDecision = decision();
  const expected = {
    runId: 'ship-164',
    issue: 'issue-164',
    sourceAgent: 'worker-1',
    targetAgent: 'worker-2',
    branch: 'squadron/issue-164',
    worktree: '/workspace/issue-164',
    baseSha: BASE,
    headSha: HEAD,
    nextGeneration: currentDecision.nextGeneration,
    globalContinuationPolicy: {
      source: 'operator-confirmed delivery packet',
      packetId: 'packet-164',
      packetDigest: '9'.repeat(64),
      limit: 2,
    },
    findingFingerprints: currentDecision.findingFingerprints,
    acceptanceCriteria: ['Continuation owns remediable blockers after local exhaustion.'],
    changeLedger: 'ledger-164',
    exclusions: ['No doctrine or intent edits.'],
    changeRequest: null,
    isolationState: { isolated: true, branch: 'squadron/issue-164', worktree: '/workspace/issue-164' },
    criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
    reconciliationResult: { status: 'reconciled', headSha: HEAD },
    runCiEvidence: {
      evidenceComplete: true,
      status: 'passed',
      repository: { revision: HEAD },
      steps: [],
    },
    roastFindings: [finding],
    priorRemediationAttempts: { used: 5, limit: 5 },
    taskContract: {
      goal: 'Clear the remaining in-scope blocker.',
      scope: 'Issue 164 and its confirmed ledger only.',
      context: 'Continue the same branch from the captured head.',
      verify: 'Reconcile the complete diff, run run-ci, and obtain a fresh Roast.',
      timebox: 'One fresh local budget of five attempts.',
      forbidden: 'No merge, approval, force push, scope expansion, or risk acceptance.',
      report: 'Return criterion verdicts and complete evidence.',
      standing: 'Stop on stale identity, no progress, or the global ceiling.',
    },
  };
  const handoffPayload = payload(expected);
  const document = expectedHandoffDocument(handoffPayload);
  const canonicalState = {
    schemaVersion: 1,
    confirmed: true,
    ...expected,
  };
  canonicalState.digest = digestCanonicalContinuationState(canonicalState);
  return {
    decision: currentDecision,
    expected,
    canonicalStateRef: 'ship-state-164',
    canonicalState,
    handoffPayload,
    handoffReceipt: {
      path: '/runtime/handoffs/ship-164.md',
      directory: '/runtime/handoffs',
      name: 'ship-164.md',
      bytes: Buffer.byteLength(document),
      headings: document.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3)),
      redactions: [],
      suggested_skills_included: false,
    },
    freshness: {
      complete: true,
      branch: expected.branch,
      worktree: expected.worktree,
      baseSha: BASE,
      headSha: HEAD,
      observedAt: '2026-08-31T12:00:00Z',
    },
    ownership: {
      branch: expected.branch,
      worktree: expected.worktree,
      sourceAgent: expected.sourceAgent,
      targetAgent: expected.targetAgent,
      sourceReleased: true,
      targetActivated: true,
      concurrentOwners: 1,
    },
    artifactDocument: document,
    ...overrides,
  };
}

function authorize(input) {
  return authorizeFreshContinuation(input, {
    loadCanonicalState: () => structuredClone(input.canonicalState),
    observeGitState: () => structuredClone(input.freshness),
    observeOwnership: () => structuredClone(input.ownership),
    readArtifact: () => ({
      bytes: Buffer.from(input.artifactDocument),
      modifiedAt: '2026-08-31T11:59:59Z',
    }),
  });
}

test('local exhaustion with a new in-scope blocker persists a continuation and not Shepherd', () => {
  const result = decision();
  assert.equal(result.action, 'persist-continuation-handoff');
  assert.equal(result.invokeShepherd, false);
  assert.deepEqual(result.nextLocalBudget, { used: 0, limit: 5 });
});

test('a verified continuation clears the path to normal Shepherd handoff', () => {
  const authorized = authorize(authorization());
  assert.equal(authorized.authorized, true);
  assert.equal(authorized.action, 'dispatch-fresh-continuation');
  assert.equal(authorized.requireCompleteDiffReconciliation, true);

  const cleared = decision({
    localAttempts: 1,
    continuationsUsed: 1,
    findings: [{ ...finding, cleared: true }],
  });
  assert.equal(cleared.action, 'invoke-shepherd');
  assert.equal(cleared.invokeShepherd, true);
});

test('an unchanged blocker without measurable progress stops instead of respawning', () => {
  const fingerprint = fingerprintFinding(finding);
  const result = decision({
    previousState: {
      headSha: BASE,
      diffDigest: 'c'.repeat(64),
      validationStatus: 'passed',
      criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
      findingFingerprints: [fingerprint],
    },
    currentState: {
      headSha: HEAD,
      diffDigest: 'd'.repeat(64),
      validationStatus: 'passed',
      criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
    },
  });

  test('validation-only implementation failure continues instead of invoking Shepherd', () => {
    const result = decision({
      findings: [],
      validation: {
        evidenceComplete: true,
        status: 'failed',
        repository: { revision: HEAD },
        steps: [{
          workflow: '.github/workflows/validate-skills.yml',
          job: 'validate',
          name: 'Run validator and conformance tests',
          command: 'node scripts/run-registered-tests.mjs',
          status: 'failed',
        }],
      },
      validationClassifications: [{
        stepIdentity: JSON.stringify({
          workflow: '.github/workflows/validate-skills.yml',
          job: 'validate',
          name: 'Run validator and conformance tests',
          command: 'node scripts/run-registered-tests.mjs',
        }),
        id: 'ci-failure',
        classification: 'implementation',
        ledgerEntryId: 'L1',
        location: '.github/workflows/validate-skills.yml:1',
        rule: 'declared-validation-must-pass',
      }],
    });
    assert.equal(result.action, 'persist-continuation-handoff');
    assert.equal(result.invokeShepherd, false);
  });

  test('caller-made fingerprints and progress booleans cannot bypass repetition detection', () => {
    const fingerprint = fingerprintFinding(finding);
    const result = decision({
      findings: [{ ...finding, fingerprint: 'f'.repeat(64) }],
      measurableProgress: true,
      previousState: {
        headSha: BASE,
        diffDigest: 'c'.repeat(64),
        validationStatus: 'passed',
        criterionDigest: 'e'.repeat(64),
        findingFingerprints: [fingerprint],
      },
      currentState: {
        headSha: HEAD,
        diffDigest: 'd'.repeat(64),
        validationStatus: 'passed',
        criterionDigest: 'e'.repeat(64),
      },
    });
    assert.equal(result.reason, 'unchanged-blocker-without-progress');
  });

  test('free-form Roast wording churn keeps the same blocker fingerprint', () => {
    assert.equal(
      fingerprintFinding(finding),
      fingerprintFinding({ ...finding, id: 'renumbered', evidence: 'different prose' }),
    );
  });

  test('line-number movement keeps the same blocker fingerprint', () => {
    assert.equal(
      fingerprintFinding(finding),
      fingerprintFinding({ ...finding, location: 'skills/ship/SKILL.md:99' }),
    );
  });

  test('a genuine revision and validation improvement permits bounded continuation', () => {
    const fingerprint = fingerprintFinding(finding);
    const result = decision({
      previousState: {
        headSha: BASE,
        diffDigest: 'c'.repeat(64),
        validationStatus: 'failed',
        criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
        findingFingerprints: [fingerprint],
      },
      currentState: {
        headSha: HEAD,
        diffDigest: 'd'.repeat(64),
        validationStatus: 'passed',
        criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
      },
    });
    assert.equal(result.action, 'persist-continuation-handoff');
  });

  test('regression, added blockers, and criterion regression are not measurable progress', () => {
    const old = fingerprintFinding(finding);
    const added = {
      ...finding,
      id: 'new-blocker',
      rule: 'another-rule',
      location: 'skills/ship/SKILL.md:80',
    };
    const cases = [
      {
        validation: {
          evidenceComplete: true,
          status: 'failed',
          repository: { revision: HEAD },
          steps: [{
            workflow: 'ci.yml',
            job: 'test',
            name: 'tests',
            command: 'node --test',
            status: 'failed',
          }],
        },
        validationClassifications: [{
          stepIdentity: JSON.stringify({
            workflow: 'ci.yml',
            job: 'test',
            name: 'tests',
            command: 'node --test',
          }),
          classification: 'implementation',
          ledgerEntryId: 'L1',
          location: 'ci.yml:1',
          rule: 'tests-pass',
        }],
        previousState: {
          headSha: BASE,
          diffDigest: 'c'.repeat(64),
          validationStatus: 'passed',
          criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
          findingFingerprints: [old],
        },
      },
      {
        findings: [finding, added],
        previousState: {
          headSha: BASE,
          diffDigest: 'c'.repeat(64),
          validationStatus: 'passed',
          criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
          findingFingerprints: [old],
        },
      },
      {
        previousState: {
          headSha: BASE,
          diffDigest: 'c'.repeat(64),
          validationStatus: 'passed',
          criterionVerdicts: [{ id: 'C1', verdict: 'satisfied' }],
          findingFingerprints: [old],
        },
        currentState: {
          headSha: HEAD,
          diffDigest: 'd'.repeat(64),
          validationStatus: 'passed',
          criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
        },
      },
    ];
    for (const overrides of cases) {
      const result = decision({ continuationsUsed: 1, ...overrides });
      assert.equal(result.action, 'human-handoff');
      assert.equal(result.reason, 'unchanged-blocker-without-progress');
    }
  });
  assert.equal(result.action, 'human-handoff');
  assert.equal(result.reason, 'unchanged-blocker-without-progress');
});

test('out-of-scope or decision-dependent findings return to the human', () => {
  const result = decision({
    findings: [{ ...finding, classification: 'human-owned' }],
  });
  assert.equal(result.action, 'human-handoff');
  assert.equal(result.reason, 'scope-or-intent-decision-required');
  assert.equal(result.invokeShepherd, false);
});

test('an incomplete or stale handoff blocks continuation', () => {
  const input = authorization();
  input.handoffReceipt.bytes = 0;
  input.freshness.headSha = 'c'.repeat(40);
  const result = authorize(input);
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'stale-or-incomplete-continuation-handoff');
  assert.equal(result.invokeShepherd, false);
  assert.ok(result.defects.length >= 2);
});

test('an explicitly Shepherd-owned condition invokes Shepherd directly', () => {
  const result = decision({
    findings: [{ ...finding, classification: 'shepherd-owned' }],
  });
  assert.equal(result.action, 'invoke-shepherd');
  assert.equal(result.reason, 'remaining-condition-is-shepherd-owned');
});

test('the global continuation ceiling produces a bounded human handoff', () => {
  const result = decision({ continuationsUsed: 2 });
  assert.equal(result.action, 'human-handoff');
  assert.equal(result.reason, 'global-continuation-ceiling-reached');
  assert.equal(result.invokeShepherd, false);
});

test('intermittent validation never invokes Shepherd', () => {
  const result = decision({
    findings: [],
    validation: {
      evidenceComplete: true,
      status: 'intermittent',
      repository: { revision: HEAD },
      steps: [{ name: 'tests', status: 'intermittent' }],
    },
  });
  assert.equal(result.action, 'human-handoff');
  assert.equal(result.reason, 'validation-intermittent');
  assert.equal(result.invokeShepherd, false);
});

test('later continuation requires complete prior measurable-progress state', () => {
  for (const previousState of [null, {}, { findingFingerprints: [] }]) {
    const result = decision({ continuationsUsed: 1, previousState });
    assert.equal(result.action, 'human-handoff');
    assert.equal(result.reason, 'prior-continuation-state-incomplete');
  }
});

test('ownership transfer requires exactly one active owner', () => {
  const input = authorization();
  input.ownership.concurrentOwners = 2;
  const result = authorize(input);
  assert.equal(result.authorized, false);
  assert.match(result.defects.join('\n'), /ownership was not explicitly transferred/);
});

test('stale consolidated evidence and policy mismatches refuse ownership transfer', () => {
  const cases = [
    (input) => { input.canonicalState.changeLedger = 'stale-ledger'; },
    (input) => { input.canonicalState.exclusions = ['different exclusion']; },
    (input) => { input.canonicalState.changeRequest = { id: 'pr-164' }; },
    (input) => { input.canonicalState.isolationState = { isolated: false }; },
    (input) => { input.canonicalState.criterionVerdicts = [{ id: 'C1', verdict: 'satisfied' }]; },
    (input) => { input.canonicalState.runCiEvidence = { evidenceComplete: true, status: 'failed', repository: { revision: HEAD }, steps: [] }; },
    (input) => { input.canonicalState.nextGeneration = 2; },
    (input) => { input.canonicalState.findingFingerprints = ['f'.repeat(64)]; },
    (input) => { input.canonicalState.globalContinuationPolicy = { ...input.canonicalState.globalContinuationPolicy, limit: 3 }; },
  ];
  for (const mutate of cases) {
    const input = authorization();
    mutate(input);
    input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
    const result = authorize(input);
    assert.equal(result.authorized, false);
    assert.equal(result.reason, 'stale-or-incomplete-continuation-handoff');
  }
});

test('every task-contract field is bound before the fresh worker owns the branch', () => {
  for (const field of Object.keys(authorization().canonicalState.taskContract)) {
    const input = authorization();
    input.canonicalState.taskContract = {
      ...input.canonicalState.taskContract,
      [field]: `changed ${field}`,
    };
    input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
    const result = authorize(input);
    assert.equal(result.authorized, false, field);
    assert.match(result.defects.join('\n'), /task contract/);
  }
});

test('a prior-generation persistence receipt cannot be replayed', () => {
  const input = authorization();
  const prior = structuredClone(input.handoffPayload);
  prior.inputs.find((entry) => entry.name === 'continuation_generation').value = '0';
  input.artifactDocument = expectedHandoffDocument(prior);
  input.handoffReceipt.bytes = Buffer.byteLength(input.artifactDocument);
  input.handoffReceipt.headings = input.artifactDocument.split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3));
  const result = authorize(input);
  assert.equal(result.authorized, false);
  assert.match(result.defects.join('\n'), /artifact does not verify/);
});

test('raising both payload and expected ceiling cannot bypass the decision-bound ceiling', () => {
  const input = authorization();
  input.canonicalState.globalContinuationPolicy = {
    ...input.canonicalState.globalContinuationPolicy,
    limit: 3,
  };
  input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
  input.handoffPayload.inputs
    .find((entry) => entry.name === 'global_continuation_limit').value = '3';
  input.artifactDocument = expectedHandoffDocument(input.handoffPayload);
  input.handoffReceipt.bytes = Buffer.byteLength(input.artifactDocument);
  input.handoffReceipt.headings = input.artifactDocument.split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3));
  const result = authorize(input);
  assert.equal(result.authorized, false);
  assert.match(result.defects.join('\n'), /policy does not match/);
});

test('global continuation ceiling must come from the confirmed delivery packet', () => {
  assert.throws(
    () => decision({ confirmedPacket: { id: 'claimed', digest: '', globalContinuationSource: 'caller', globalContinuationLimit: 2 } }),
    /bounded local and global continuation accounting/,
  );
});

test('stale, missing, abbreviated, and uppercase validation revisions never invoke Shepherd', () => {
  for (const revision of [undefined, BASE, 'abc123', 'A'.repeat(40)]) {
    const input = {
      findings: [],
      validation: {
        evidenceComplete: true,
        status: 'passed',
        repository: revision === undefined ? {} : { revision },
        steps: [],
      },
    };
    const result = decision(input);
    assert.equal(result.action, 'human-handoff');
    assert.equal(result.reason, 'validation-revision-stale-or-invalid');
    assert.equal(result.invokeShepherd, false);
  }
});

test('only failed validation is eligible for implementation continuation', () => {
  for (const status of ['cancelled', 'environment-failed', 'unsupported-provider', 'incomplete']) {
    const result = decision({
      findings: [],
      validation: {
        evidenceComplete: true,
        status,
        repository: { revision: HEAD },
        steps: [{ name: 'validation', status }],
      },
    });

    test('local attempt accounting refuses an already-consumed sixth attempt', () => {
      assert.equal(decision({ localAttempts: 4 }).action, 'dispatch-local-remediation');
      assert.equal(decision({ localAttempts: 5 }).action, 'persist-continuation-handoff');
      for (const localAttempts of [6, 99]) {
        const result = decision({ localAttempts });
        assert.equal(result.action, 'human-handoff');
        assert.equal(result.reason, 'local-attempt-accounting-invalid');
      }
    });

    test('authorization requires independently loaded canonical state and observations', () => {
      const input = authorization();
      const result = authorizeFreshContinuation(input, {
        readArtifact: () => ({
          bytes: Buffer.from(input.artifactDocument),
          modifiedAt: '2026-08-31T11:59:59Z',
        }),
      });
      assert.equal(result.authorized, false);
      assert.match(result.defects.join('\n'), /canonical Ship state/);
      assert.match(result.defects.join('\n'), /not freshly re-read/);
      assert.match(result.defects.join('\n'), /ownership/);
    });
    assert.equal(result.action, 'human-handoff');
    assert.equal(result.reason, `validation-${status}`);
  }
});

test('run-ci handoff evidence is complete and bound to the current head and decision', () => {
  const cases = [
    (input) => { input.canonicalState.runCiEvidence.evidenceComplete = false; },
    (input) => { input.canonicalState.runCiEvidence.repository.revision = BASE; },
    (input) => { input.canonicalState.runCiEvidence.status = 'failed'; },
    (input) => { delete input.canonicalState.runCiEvidence.repository; },
  ];
  for (const mutate of cases) {
    const input = authorization();
    mutate(input);
    input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
    const result = authorize(input);
    assert.equal(result.authorized, false);
    assert.match(result.defects.join('\n'), /run-ci evidence/);
  }
});
