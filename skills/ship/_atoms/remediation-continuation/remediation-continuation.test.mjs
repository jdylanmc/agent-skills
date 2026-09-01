import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_REMEDIATION_LIMIT,
  authorizeFreshContinuation,
  authorizeShepherdHandoff,
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
  const validation = overrides.validation ?? {
    evidenceComplete: true,
    status: 'passed',
    repository: { revision: HEAD },
    steps: [],
  };
  const currentState = {
    headSha: HEAD,
    diffDigest: 'd'.repeat(64),
    validationStatus: validation.status,
    criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
    ...overrides.currentState,
  };
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
    validation,
    validationClassifications: [],
    previousState: null,
    ...overrides,
    currentState,
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
    validation_classifications: JSON.stringify(expected.validationClassifications),
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
      repository: {
        root: '/workspace/issue-164',
        revision: HEAD,
        dirtyState: [],
      },
      steps: [],
    },
    validationClassifications: [],
    roastFindings: [finding],
    priorRemediationAttempts: { used: 5, limit: 5 },
    continuationsUsed: 0,
    previousState: null,
    currentState: {
      headSha: HEAD,
      diffDigest: 'd'.repeat(64),
      validationStatus: 'passed',
      criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
    },
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
      repository: structuredClone(expected.runCiEvidence.repository),
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
    previousState: {
      headSha: BASE,
      diffDigest: 'c'.repeat(64),
      validationStatus: 'passed',
      criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
      findingFingerprints: [fingerprintFinding(finding)],
    },
  });
  assert.equal(cleared.action, 'authorize-shepherd-handoff');
  assert.equal(cleared.invokeShepherd, false);
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
  assert.equal(result.action, 'human-handoff');
  assert.equal(result.reason, 'unchanged-blocker-without-progress');
});

test('validation-only implementation failure continues instead of invoking Shepherd', () => {
    const result = decision({
      findings: [],
      validation: {
        evidenceComplete: false,
        status: 'failed',
        repository: { revision: HEAD },
        steps: [{
          workflow: '.github/workflows/validate-skills.yml',
          job: 'validate',
          name: 'Run validator and conformance tests',
          command: 'node scripts/run-registered-tests.mjs',
          status: 'failed',
        }, {
          workflow: '.github/workflows/validate-skills.yml',
          job: 'validate',
          name: 'Later validation',
          command: 'node later-validation.mjs',
          status: 'skipped',
          reason: 'prior step did not complete successfully',
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

test('run-ci fingerprints preserve exact failed-step identity', () => {
    const base = {
      kind: 'run-ci',
      classification: 'implementation',
      ledgerEntryId: 'L1',
      location: '.github/workflows/validate-skills.yml:1',
      rule: 'declared-validation-must-pass',
    };
    assert.notEqual(
      fingerprintFinding({ ...base, stepIdentity: 'unit-tests' }),
      fingerprintFinding({ ...base, stepIdentity: 'integration-tests' }),
    );
});

test('validation-only continuation uses the same canonical fingerprints during authorization', () => {
  const failedStep = {
    workflow: '.github/workflows/validate-skills.yml',
    job: 'validate',
    name: 'Run validator and conformance tests',
    command: 'node scripts/run-registered-tests.mjs',
    status: 'failed',
  };
  const classification = {
    stepIdentity: JSON.stringify({
      workflow: failedStep.workflow,
      job: failedStep.job,
      name: failedStep.name,
      command: failedStep.command,
    }),
    id: 'ci-failure',
    classification: 'implementation',
    ledgerEntryId: 'L1',
    location: '.github/workflows/validate-skills.yml:1',
    rule: 'declared-validation-must-pass',
  };
  const input = authorization();
  input.canonicalState.runCiEvidence = {
    evidenceComplete: false,
    status: 'failed',
    repository: {
      root: input.expected.worktree,
      revision: HEAD,
      dirtyState: [],
    },
    steps: [failedStep, {
      workflow: failedStep.workflow,
      job: failedStep.job,
      name: 'Later validation',
      command: 'node later-validation.mjs',
      status: 'skipped',
      reason: 'prior step did not complete successfully',
    }],
  };
  input.canonicalState.validationClassifications = [classification];
  input.canonicalState.roastFindings = [];
  input.canonicalState.currentState.validationStatus = 'failed';
  input.canonicalState.findingFingerprints = [fingerprintFinding({
    ...classification,
    kind: 'run-ci',
    severity: 'Must fix',
  })];
  input.decision = decision({
    findings: [],
    validation: structuredClone(input.canonicalState.runCiEvidence),
    validationClassifications: [classification],
  });
  input.handoffPayload = payload(input.canonicalState);
  input.artifactDocument = expectedHandoffDocument(input.handoffPayload);
  input.handoffReceipt.bytes = Buffer.byteLength(input.artifactDocument);
  input.handoffReceipt.headings = input.artifactDocument.split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3));
  input.freshness.repository = structuredClone(input.canonicalState.runCiEvidence.repository);
  input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);

  const result = authorize(input);
  assert.equal(result.authorized, true);
  assert.equal(result.action, 'dispatch-fresh-continuation');
});

test('validation-only authorization rejects missing or mismatched canonical failed-step classifications', () => {
  const failedStep = {
    workflow: 'ci.yml',
    job: 'test',
    name: 'tests',
    command: 'node --test',
    status: 'failed',
  };
  const classification = {
    stepIdentity: JSON.stringify({
      workflow: failedStep.workflow,
      job: failedStep.job,
      name: failedStep.name,
      command: failedStep.command,
    }),
    classification: 'implementation',
    ledgerEntryId: 'L1',
    location: 'ci.yml:1',
    rule: 'tests-pass',
  };
  for (const validationClassifications of [
    [],
    [classification, {
      ...classification,
      stepIdentity: JSON.stringify({
        workflow: 'other.yml',
        job: 'test',
        name: 'other tests',
        command: 'node --test other',
      }),
    }],
    [{
      ...classification,
      stepIdentity: JSON.stringify({
        workflow: failedStep.workflow,
        job: failedStep.job,
        name: failedStep.name,
        command: 'node --test different',
      }),
    }],
  ]) {
    const input = authorization();
    input.canonicalState.runCiEvidence = {
      evidenceComplete: false,
      status: 'failed',
      repository: {
        root: input.expected.worktree,
        revision: HEAD,
        dirtyState: [],
      },
      steps: [failedStep, {
        workflow: failedStep.workflow,
        job: failedStep.job,
        name: 'Later validation',
        command: 'node later-validation.mjs',
        status: 'skipped',
        reason: 'prior step did not complete successfully',
      }],
    };
    input.canonicalState.validationClassifications = validationClassifications;
    input.canonicalState.roastFindings = [];
    input.canonicalState.currentState.validationStatus = 'failed';
    input.canonicalState.findingFingerprints = [fingerprintFinding({
      ...classification,
      kind: 'run-ci',
      severity: 'Must fix',
    })];
    input.decision = decision({
      findings: [],
      validation: structuredClone(input.canonicalState.runCiEvidence),
      validationClassifications: [classification],
    });
    input.handoffPayload = payload(input.canonicalState);
    input.artifactDocument = expectedHandoffDocument(input.handoffPayload);
    input.handoffReceipt.bytes = Buffer.byteLength(input.artifactDocument);
    input.handoffReceipt.headings = input.artifactDocument.split('\n')
      .filter((line) => line.startsWith('## '))
      .map((line) => line.slice(3));
    input.freshness.repository = structuredClone(input.canonicalState.runCiEvidence.repository);
    input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);

    const result = authorize(input);
    assert.equal(result.authorized, false);
    assert.match(result.defects.join('\n'), /failed-step classifications/);
  }
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

test('regression, added blockers, blocker replacement, and criterion regression are not measurable progress', () => {
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
        findings: [added],
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

test('caller validation mirrors cannot fabricate monotonic progress', () => {
  const fingerprint = fingerprintFinding(finding);
  const result = decision({
    continuationsUsed: 1,
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
  assert.equal(result.action, 'human-handoff');
  assert.equal(result.reason, 'validation-state-mismatch');
});

test('Shepherd exits still require monotonic whole-outcome progress', () => {
    const old = fingerprintFinding(finding);
    const regressedCriterion = decision({
      continuationsUsed: 1,
      findings: [{ ...finding, cleared: true }],
      previousState: {
        headSha: BASE,
        diffDigest: 'c'.repeat(64),
        validationStatus: 'passed',
        criterionVerdicts: [{ id: 'C1', verdict: 'satisfied' }],
        findingFingerprints: [old],
      },
    });
    assert.equal(regressedCriterion.action, 'human-handoff');
    assert.equal(regressedCriterion.reason, 'unchanged-blocker-without-progress');

    const shepherdReplacement = decision({
      continuationsUsed: 1,
      findings: [{
        ...finding,
        classification: 'shepherd-owned',
        rule: 'new-shepherd-condition',
      }],
      previousState: {
        headSha: BASE,
        diffDigest: 'c'.repeat(64),
        validationStatus: 'passed',
        criterionVerdicts: [{ id: 'C1', verdict: 'partial' }],
        findingFingerprints: [old],
      },
    });
    assert.equal(shepherdReplacement.action, 'human-handoff');
    assert.equal(shepherdReplacement.reason, 'unchanged-blocker-without-progress');
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
  assert.equal(result.action, 'authorize-shepherd-handoff');
  assert.equal(result.reason, 'remaining-condition-is-shepherd-owned');
  assert.equal(result.invokeShepherd, false);
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
    (input) => { input.canonicalState.validationClassifications = [{ stepIdentity: 'stale' }]; },
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
    assert.equal(result.action, 'human-handoff');
    assert.equal(result.reason, `validation-${status}`);
  }
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

test('fresh continuation authorization independently enforces canonical outcome history', () => {
    const input = authorization();
    input.canonicalState.continuationsUsed = 1;
    input.canonicalState.previousState = {
      headSha: BASE,
      diffDigest: 'c'.repeat(64),
      validationStatus: 'passed',
      criterionVerdicts: [{ id: 'C1', verdict: 'satisfied' }],
      findingFingerprints: [...input.expected.findingFingerprints],
    };
    input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
    const result = authorize(input);
    assert.equal(result.authorized, false);
    assert.match(result.defects.join('\n'), /outcome history/);
});

test('fresh continuation authorization derives blocker fingerprints from canonical findings', () => {
    const input = authorization();
    input.canonicalState.roastFindings = [{
      ...finding,
      rule: 'replacement-blocker',
    }];
    input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
    const result = authorize(input);
    assert.equal(result.authorized, false);
    assert.match(result.defects.join('\n'), /continuation fingerprints/);
});

test('direct Shepherd handoff requires canonical state plus independent Git and ownership observations', () => {
  const input = authorization();
  input.canonicalState.roastFindings = [];
  input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
  input.decision = decision({ findings: [] });
  const result = authorizeShepherdHandoff(input, {
    loadCanonicalState: () => structuredClone(input.canonicalState),
    observeGitState: () => structuredClone(input.freshness),
    observeOwnership: () => ({
      branch: input.expected.branch,
      worktree: input.expected.worktree,
      sourceAgent: input.expected.sourceAgent,
      sourceActive: true,
      shepherdActive: false,
      concurrentOwners: 1,
    }),
  });
  assert.equal(result.authorized, true);
  assert.equal(result.action, 'invoke-shepherd');
  assert.equal(result.invokeShepherd, true);

  for (const missing of ['loadCanonicalState', 'observeGitState', 'observeOwnership']) {
    const observers = {
      loadCanonicalState: () => structuredClone(input.canonicalState),
      observeGitState: () => structuredClone(input.freshness),
      observeOwnership: () => ({
        branch: input.expected.branch,
        worktree: input.expected.worktree,
        sourceAgent: input.expected.sourceAgent,
        sourceActive: true,
        shepherdActive: false,
        concurrentOwners: 1,
      }),
    };
    delete observers[missing];
    const refused = authorizeShepherdHandoff(input, observers);
    assert.equal(refused.authorized, false, missing);
    assert.equal(refused.invokeShepherd, false, missing);
  }
});

test('direct Shepherd authorization refuses a caller decision that hides canonical blockers', () => {
  const input = authorization();
  input.decision = decision({ findings: [] });
  const result = authorizeShepherdHandoff(input, {
    loadCanonicalState: () => structuredClone(input.canonicalState),
    observeGitState: () => structuredClone(input.freshness),
    observeOwnership: () => ({
      branch: input.expected.branch,
      worktree: input.expected.worktree,
      sourceAgent: input.expected.sourceAgent,
      sourceActive: true,
      shepherdActive: false,
      concurrentOwners: 1,
    }),
  });
  assert.equal(result.authorized, false);
  assert.equal(result.invokeShepherd, false);
  assert.match(result.defects.join('\n'), /implementation Must-fix/);
});

test('direct Shepherd authorization independently enforces canonical outcome history', () => {
    const input = authorization();
    input.canonicalState.roastFindings = [];
    input.canonicalState.previousState = {
      headSha: BASE,
      diffDigest: 'c'.repeat(64),
      validationStatus: 'passed',
      criterionVerdicts: [{ id: 'C1', verdict: 'satisfied' }],
      findingFingerprints: [fingerprintFinding(finding)],
    };
    input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
    input.decision = {
      action: 'authorize-shepherd-handoff',
      reason: 'no-unresolved-implementation-must-fix',
      invokeShepherd: false,
      unresolved: [],
    };
    const result = authorizeShepherdHandoff(input, {
      loadCanonicalState: () => structuredClone(input.canonicalState),
      observeGitState: () => structuredClone(input.freshness),
      observeOwnership: () => ({
        branch: input.expected.branch,
        worktree: input.expected.worktree,
        sourceAgent: input.expected.sourceAgent,
        sourceActive: true,
        shepherdActive: false,
        concurrentOwners: 1,
      }),
    });
    assert.equal(result.authorized, false);
    assert.match(result.defects.join('\n'), /outcome history/);
});

test('later-generation direct Shepherd authorization requires canonical prior outcome history', () => {
      const input = authorization();
      input.canonicalState.roastFindings = [];
      input.canonicalState.continuationsUsed = 1;
      input.canonicalState.previousState = null;
      input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
      input.decision = {
        action: 'authorize-shepherd-handoff',
        reason: 'no-unresolved-implementation-must-fix',
        invokeShepherd: false,
        unresolved: [],
      };
      const result = authorizeShepherdHandoff(input, {
        loadCanonicalState: () => structuredClone(input.canonicalState),
        observeGitState: () => structuredClone(input.freshness),
        observeOwnership: () => ({
          branch: input.expected.branch,
          worktree: input.expected.worktree,
          sourceAgent: input.expected.sourceAgent,
          sourceActive: true,
          shepherdActive: false,
          concurrentOwners: 1,
        }),
    });
    assert.equal(result.authorized, false);
    assert.match(result.defects.join('\n'), /outcome history/);
});

test('run-ci handoff evidence is complete and bound to the current head and decision', () => {
  const cases = [
    (input) => { input.canonicalState.runCiEvidence.evidenceComplete = false; },
    (input) => { input.canonicalState.runCiEvidence.repository.revision = BASE; },
    (input) => { input.canonicalState.runCiEvidence.repository.root = '/different/worktree'; },
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

test('fresh Git observations cannot pair an expected worktree with another repository snapshot', () => {
  const input = authorization();
  input.freshness.repository.root = '/different/worktree';
  input.freshness.worktree = input.expected.worktree;
  const result = authorize(input);
  assert.equal(result.authorized, false);
  assert.match(result.defects.join('\n'), /repository snapshot/);

  input.canonicalState.roastFindings = [];
  input.canonicalState.digest = digestCanonicalContinuationState(input.canonicalState);
  input.decision = decision({ findings: [] });
  const shepherd = authorizeShepherdHandoff(input, {
    loadCanonicalState: () => structuredClone(input.canonicalState),
    observeGitState: () => structuredClone(input.freshness),
    observeOwnership: () => ({
      branch: input.expected.branch,
      worktree: input.expected.worktree,
      sourceAgent: input.expected.sourceAgent,
      sourceActive: true,
      shepherdActive: false,
      concurrentOwners: 1,
    }),
  });
  assert.equal(shepherd.authorized, false);
  assert.match(shepherd.defects.join('\n'), /repository snapshot/);
});
