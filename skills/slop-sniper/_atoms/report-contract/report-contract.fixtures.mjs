import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSpecialistPromptBinding } from './report-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', '..');

export function specialistPromptBinding() {
  return createSpecialistPromptBinding({
    personaText: fs.readFileSync(path.join(ROOT, 'agents', 'slop-sniper.agent.md'), 'utf8'),
    reportSchemaText: fs.readFileSync(
      path.join(HERE, 'report-contract.schema.json'),
      'utf8',
    ),
  });
}

export function snapshotReference(snapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    bindingDigest: snapshot.bindingDigest,
    goalRevision: snapshot.goal.revision,
    manifestRevision: snapshot.manifest.revision,
    fleetRevision: snapshot.fleet.revision,
    repositoryRevision: snapshot.repository.revision,
    observedAt: snapshot.observation.observedAt,
    completeness: snapshot.observation.completeness,
  };
}

export function finding(overrides = {}) {
  return {
    id: 'finding-1',
    category: 'stale-worker',
    severity: 'medium',
    evidenceAnchors: ['obs-assignments'],
    affectedWork: ['work-a'],
    consequence: 'Work continues after its authority ended.',
    confidence: 'high',
    disconfirmingEvidence: [],
    rootCorrection: 'Preserve a handoff and stop further dispatch to the stale route.',
    localActionsToStop: ['new dispatch to worker-a'],
    validation: ['Observe terminal worker state with no new assignment.'],
    privacyHandling: 'not-applicable',
    ...overrides,
  };
}

export function findingAudit(findingId, category, evidenceRoles) {
  return {
    findingId,
    category,
    evidenceRoles: Object.entries(evidenceRoles).map(([role, observationIds]) => ({
      role,
      observationIds,
    })),
  };
}

export function evidenceObservation(
  id,
  area,
  kind,
  sourceKind,
  workIds,
  assertion,
  overrides = {},
) {
  return {
    area,
    id,
    kind,
    sourceKind,
    observedAt: '2026-09-02T20:40:00Z',
    completeness: 'complete',
    subject: id,
    workIds,
    revision: null,
    baseRevision: null,
    fingerprint: null,
    state: null,
    assertion,
    activeFrom: null,
    activeUntil: null,
    hypothesis: null,
    scope: null,
    validationPurpose: null,
    statement: `Observed ${id}.`,
    locator: `evidence://${id}`,
    sensitivity: 'public',
    ...overrides,
  };
}

const DUPLICATE_DIMENSIONS = Object.freeze({
  hypothesis: 'same-hypothesis',
  scope: 'same-scope',
  validationPurpose: 'same-validation-purpose',
  state: 'active',
  activeFrom: '2026-09-02T20:00:00Z',
});

const RESOURCE_EVIDENCE = Object.freeze({
  worker: {
    area: 'worker-generations-and-handoffs',
    kind: 'worker',
    sourceKind: 'runtime',
    activeAssertion: 'worker-active',
    terminalAssertion: 'worker-terminal',
    duplicateRole: 'workers',
    terminalRole: 'terminalWorkers',
    postTerminalRole: 'postTerminalWorkers',
  },
  branch: {
    area: 'branches-and-worktrees',
    kind: 'branch',
    sourceKind: 'git',
    activeAssertion: 'branch-active',
    terminalAssertion: 'branch-terminal',
    duplicateRole: 'branches',
    terminalRole: 'terminalBranches',
    postTerminalRole: 'postTerminalBranches',
  },
  'change-request': {
    area: 'change-requests-and-checks',
    kind: 'change-request',
    sourceKind: 'provider',
    activeAssertion: 'change-request-active',
    terminalAssertion: 'change-request-terminal',
    duplicateRole: 'changeRequests',
    terminalRole: 'terminalChangeRequests',
    postTerminalRole: 'postTerminalChangeRequests',
  },
  schedule: {
    area: 'schedules-and-processes',
    kind: 'schedule',
    sourceKind: 'schedule',
    activeAssertion: 'schedule-active',
    terminalAssertion: 'schedule-terminal',
    duplicateRole: 'schedules',
    terminalRole: 'terminalSchedules',
    postTerminalRole: 'postTerminalSchedules',
  },
});

function duplicateAssignments(assertion) {
  return [
    evidenceObservation('implementation-a', 'assignments', 'assignment', 'worker-report', ['work-a'], assertion, {
      subject: 'same-operation',
      ...DUPLICATE_DIMENSIONS,
    }),
    evidenceObservation('implementation-b', 'assignments', 'assignment', 'worker-report', ['work-b'], assertion, {
      observedAt: '2026-09-02T20:41:00Z',
      subject: 'same-operation',
      ...DUPLICATE_DIMENSIONS,
    }),
  ];
}

function duplicateResourceObservations(resourceKind) {
  const spec = RESOURCE_EVIDENCE[resourceKind];
  return ['a', 'b'].map((suffix, index) => evidenceObservation(
    `${resourceKind}-${suffix}`,
    spec.area,
    spec.kind,
    spec.sourceKind,
    [`work-${suffix}`],
    spec.activeAssertion,
    {
      observedAt: `2026-09-02T20:4${index}:30Z`,
      subject: `${resourceKind}-${suffix}`,
      state: 'active',
      activeFrom: '2026-09-02T20:00:00Z',
    },
  ));
}

function duplicateImplementationCase(resourceKind) {
  const spec = RESOURCE_EVIDENCE[resourceKind];
  return {
    observations: [
      ...duplicateAssignments('implementation-active'),
      ...duplicateResourceObservations(resourceKind),
    ],
    affectedWork: ['work-a', 'work-b'],
    roles: {
      implementations: ['implementation-a', 'implementation-b'],
      [spec.duplicateRole]: [`${resourceKind}-a`, `${resourceKind}-b`],
    },
  };
}

function staleResourceCase(resourceKind) {
  const spec = RESOURCE_EVIDENCE[resourceKind];
  return {
    observations: [
      evidenceObservation(
        `${resourceKind}-terminal`,
        spec.area,
        spec.kind,
        spec.sourceKind,
        ['work-a'],
        spec.terminalAssertion,
        {
          subject: `${resourceKind}-a`,
          state: 'terminal',
        },
      ),
      evidenceObservation(
        `${resourceKind}-post-terminal`,
        spec.area,
        spec.kind,
        spec.sourceKind,
        ['work-a'],
        spec.activeAssertion,
        {
          observedAt: '2026-09-02T20:41:00Z',
          subject: `${resourceKind}-a`,
          state: 'active',
          activeFrom: '2026-09-02T20:00:00Z',
        },
      ),
    ],
    affectedWork: ['work-a'],
    roles: {
      [spec.terminalRole]: [`${resourceKind}-terminal`],
      [spec.postTerminalRole]: [`${resourceKind}-post-terminal`],
    },
  };
}

const CATEGORY_CASES = Object.freeze({
  'shared-root-local-remediation': {
    observations: [
      evidenceObservation('branch-a', 'branches-and-worktrees', 'branch', 'git', ['work-a'], 'independent-branch', {
        revision: 'head-a',
        baseRevision: 'base-1',
      }),
      evidenceObservation('branch-b', 'branches-and-worktrees', 'branch', 'git', ['work-b'], 'independent-branch', {
        revision: 'head-b',
        baseRevision: 'base-1',
      }),
      evidenceObservation('path-a', 'branches-and-worktrees', 'file-change', 'git', ['work-a'], 'changed-path'),
      evidenceObservation('path-b', 'branches-and-worktrees', 'file-change', 'git', ['work-b'], 'changed-path'),
      evidenceObservation('component-owner', 'branches-and-worktrees', 'file-change', 'git', ['work-a', 'work-b'], 'shared-component-owner', {
        subject: 'shared-component',
      }),
      evidenceObservation('failure-a', 'failure-fingerprints', 'failure', 'runtime', ['work-a'], 'repeated-failure', {
        subject: 'shared-component',
        fingerprint: 'failure-1',
      }),
      evidenceObservation('failure-b', 'failure-fingerprints', 'failure', 'runtime', ['work-b'], 'repeated-failure', {
        observedAt: '2026-09-02T20:41:00Z',
        subject: 'shared-component',
        fingerprint: 'failure-1',
      }),
    ],
    affectedWork: ['work-a', 'work-b'],
    roles: {
      branches: ['branch-a', 'branch-b'],
      changedPaths: ['path-a', 'path-b'],
      componentOwnership: ['component-owner'],
      failures: ['failure-a', 'failure-b'],
    },
    repeatedFailureClusters: [{
      fingerprint: 'failure-1',
      affectedWork: ['work-a', 'work-b'],
      evidenceAnchors: ['failure-a', 'failure-b'],
    }],
  },
  'duplicate-investigation': {
    observations: [
      evidenceObservation('investigation-a', 'assignments', 'assignment', 'worker-report', ['work-a'], 'investigation-active', {
        subject: 'same-investigation',
        ...DUPLICATE_DIMENSIONS,
      }),
      evidenceObservation('investigation-b', 'assignments', 'assignment', 'worker-report', ['work-b'], 'investigation-active', {
        observedAt: '2026-09-02T20:41:00Z',
        subject: 'same-investigation',
        ...DUPLICATE_DIMENSIONS,
      }),
      ...duplicateResourceObservations('worker'),
    ],
    affectedWork: ['work-a', 'work-b'],
    roles: {
      investigations: ['investigation-a', 'investigation-b'],
      workers: ['worker-a', 'worker-b'],
    },
  },
  'duplicate-implementation': duplicateImplementationCase('branch'),
  'stale-worker': staleResourceCase('worker'),
  'stale-readiness': {
    observations: [
      evidenceObservation('readiness-claim', 'status-receipts', 'claim', 'worker-report', ['work-a'], 'readiness-claim'),
      evidenceObservation('readiness-contradiction', 'change-requests-and-checks', 'change-request', 'provider', ['work-a'], 'readiness-contradiction'),
    ],
    affectedWork: ['work-a'],
    roles: {
      readinessClaim: ['readiness-claim'],
      contradiction: ['readiness-contradiction'],
    },
  },
  'retry-without-new-evidence': {
    observations: [
      evidenceObservation('retry-a', 'remediation-and-retries', 'retry', 'log', ['work-a'], 'retry-unchanged', {
        subject: 'retry-chain',
        fingerprint: 'same-retry',
      }),
      evidenceObservation('retry-b', 'remediation-and-retries', 'retry', 'log', ['work-a'], 'retry-unchanged', {
        observedAt: '2026-09-02T20:41:00Z',
        subject: 'retry-chain',
        fingerprint: 'same-retry',
      }),
    ],
    affectedWork: ['work-a'],
    roles: { retries: ['retry-a', 'retry-b'] },
  },
  'out-of-manifest-work': {
    observations: [
      evidenceObservation('outside-issue', 'dependency-frontier', 'issue', 'provider', ['work-c'], 'observed-work'),
    ],
    affectedWork: ['work-c'],
    roles: { issues: ['outside-issue'] },
  },
  'goal-drift': {
    observations: [
      evidenceObservation('goal-boundary', 'human-decisions-and-authority', 'goal', 'human', [], 'goal-boundary'),
      evidenceObservation('goal-mismatch', 'branches-and-worktrees', 'file-change', 'git', ['work-a'], 'goal-mismatch'),
    ],
    affectedWork: ['work-a'],
    roles: {
      goalBoundary: ['goal-boundary'],
      driftedWork: ['goal-mismatch'],
    },
  },
  'premature-abstraction': {
    observations: [
      evidenceObservation('abstraction', 'created-artifacts', 'artifact', 'filesystem', ['work-a'], 'shared-abstraction', {
        subject: 'shared-helper',
      }),
      evidenceObservation('consumer-absence', 'status-receipts', 'claim', 'provider', ['work-a'], 'second-consumer-absent', {
        subject: 'shared-helper',
      }),
    ],
    affectedWork: ['work-a'],
    roles: {
      abstraction: ['abstraction'],
      consumerAbsence: ['consumer-absence'],
    },
  },
  'premature-optimization': {
    observations: [
      evidenceObservation('optimization', 'created-artifacts', 'artifact', 'filesystem', ['work-a'], 'optimization-change', {
        subject: 'optimization-target',
      }),
      evidenceObservation('baseline-absence', 'status-receipts', 'claim', 'provider', ['work-a'], 'measured-baseline-absent', {
        subject: 'optimization-target',
      }),
      evidenceObservation('bottleneck-absence', 'status-receipts', 'claim', 'provider', ['work-a'], 'bottleneck-absent', {
        subject: 'optimization-target',
      }),
      evidenceObservation('target-absence', 'status-receipts', 'claim', 'provider', ['work-a'], 'target-absent', {
        subject: 'optimization-target',
      }),
    ],
    affectedWork: ['work-a'],
    roles: {
      optimization: ['optimization'],
      baselineAbsence: ['baseline-absence'],
      bottleneckAbsence: ['bottleneck-absence'],
      targetAbsence: ['target-absence'],
    },
  },
  'authority-escalation': {
    observations: [
      evidenceObservation('authority-boundary', 'human-decisions-and-authority', 'authority', 'human', ['work-a'], 'authority-boundary', {
        subject: 'routine-decision',
      }),
      evidenceObservation('authority-exceeded', 'human-decisions-and-authority', 'interruption', 'comment', ['work-a'], 'authority-exceeded', {
        subject: 'routine-decision',
      }),
    ],
    affectedWork: ['work-a'],
    roles: {
      authorityBoundary: ['authority-boundary'],
      authorityExceeded: ['authority-exceeded'],
    },
  },
  'human-interruption-noise': {
    observations: [
      evidenceObservation('routine-question', 'human-decisions-and-authority', 'interruption', 'comment', ['work-a'], 'routine-engineering-question', {
        subject: 'routine-decision',
      }),
      evidenceObservation('parent-authority', 'human-decisions-and-authority', 'authority', 'human', ['work-a'], 'parent-authority', {
        subject: 'routine-decision',
      }),
    ],
    affectedWork: ['work-a'],
    roles: {
      routineQuestion: ['routine-question'],
      parentAuthority: ['parent-authority'],
    },
  },
  'ownership-race': {
    observations: [
      evidenceObservation('owner-a', 'assignments', 'assignment', 'worker-report', ['work-a'], 'mutation-owner-active', {
        subject: 'shared-mutation-scope',
        state: 'active',
      }),
      evidenceObservation('owner-b', 'assignments', 'assignment', 'worker-report', ['work-b'], 'mutation-owner-active', {
        subject: 'shared-mutation-scope',
        state: 'active',
      }),
    ],
    affectedWork: ['work-a', 'work-b'],
    roles: { mutationOwners: ['owner-a', 'owner-b'] },
  },
  'hallucinated-state': {
    observations: [
      evidenceObservation('state-claim', 'status-receipts', 'claim', 'worker-report', ['work-a'], 'state-claim'),
      evidenceObservation('state-contradiction', 'change-requests-and-checks', 'change-request', 'provider', ['work-a'], 'state-contradiction'),
    ],
    affectedWork: ['work-a'],
    roles: {
      stateClaim: ['state-claim'],
      contradiction: ['state-contradiction'],
    },
  },
  'evidence-laundering': {
    observations: [
      evidenceObservation('verification-claim', 'status-receipts', 'claim', 'worker-report', ['work-a'], 'verification-claim'),
      evidenceObservation('incomplete-evidence', 'failure-fingerprints', 'validation', 'runtime', ['work-a'], 'incomplete-evidence', {
        completeness: 'partial',
      }),
    ],
    affectedWork: ['work-a'],
    roles: {
      verificationClaim: ['verification-claim'],
      incompleteEvidence: ['incomplete-evidence'],
    },
    confidence: 'medium',
  },
  'privacy-boundary-breach': {
    observations: [
      evidenceObservation('privacy-boundary', 'repository-privacy', 'repository-privacy', 'provider', [], 'privacy-boundary'),
      evidenceObservation('cross-boundary-artifact', 'created-artifacts', 'artifact', 'filesystem', ['work-a'], 'cross-boundary-publication', {
        sensitivity: 'private',
      }),
    ],
    affectedWork: ['work-a'],
    roles: {
      privacyBoundary: ['privacy-boundary'],
      crossBoundaryArtifact: ['cross-boundary-artifact'],
    },
    severity: 'critical',
    privacyHandling: 'anchors-only-redacted',
    correction: {
      strategy: 'human-decision',
      status: 'human-decision-required',
      parentDirectives: [{
        action: 'pause-cross-boundary-publication',
        targets: ['work-a'],
        rationale: 'Pause publication.',
      }],
      humanDecisions: [{
        decision: 'remediate-privacy-incident',
        rationale: 'Human privacy response required.',
      }],
    },
  },
  'context-churn': {
    observations: [
      evidenceObservation('transition-a', 'worker-generations-and-handoffs', 'handoff', 'worker-report', ['work-a'], 'context-transition', {
        subject: 'handoff-chain',
      }),
      evidenceObservation('transition-b', 'worker-generations-and-handoffs', 'handoff', 'status-receipt', ['work-a'], 'context-transition', {
        observedAt: '2026-09-02T20:41:00Z',
        subject: 'handoff-chain',
      }),
      evidenceObservation('missing-handoff-state', 'status-receipts', 'status', 'status-receipt', ['work-a'], 'handoff-state-missing', {
        subject: 'handoff-chain',
      }),
    ],
    affectedWork: ['work-a'],
    roles: {
      transitions: ['transition-a', 'transition-b'],
      missingState: ['missing-handoff-state'],
    },
  },
  'unbounded-work': {
    observations: [
      evidenceObservation('active-work', 'assignments', 'assignment', 'worker-report', ['work-a'], 'work-active', {
        state: 'active',
      }),
      evidenceObservation('missing-bound', 'budgets-and-elapsed-time', 'budget', 'runtime', ['work-a'], 'execution-bound-missing'),
    ],
    affectedWork: ['work-a'],
    roles: {
      activeWork: ['active-work'],
      missingBound: ['missing-bound'],
    },
  },
});

export function categoryCase(category) {
  return structuredClone(CATEGORY_CASES[category]);
}

export function resourceCategoryCase(category, resourceKind) {
  if (category === 'duplicate-implementation') {
    return structuredClone(duplicateImplementationCase(resourceKind));
  }
  if (category === 'stale-worker') {
    return structuredClone(staleResourceCase(resourceKind));
  }
  throw new Error(`unsupported resource category: ${category}`);
}

function reportValue(value, fallback) {
  return value ?? fallback;
}

function defaultCorrection(findings, ids) {
  return {
    strategy: findings.length === 0 ? 'continue' : 'deduplicate',
    authority: 'parent-only',
    findingIds: ids,
    parentDirectives: [],
    humanDecisions: [],
    validation: ['Reobserve the corrected orchestration state.'],
  };
}

function defaultReportStatus(findings) {
  return findings.length === 0 ? 'clean' : 'slop-detected';
}

export function report(snapshot, overrides = {}) {
  const findings = reportValue(overrides.findings, []);
  const ids = findings.map((entry) => entry.id).sort();
  return {
    schemaVersion: 1,
    snapshot: snapshotReference(snapshot),
    currentWorkInventory: reportValue(overrides.currentWorkInventory, []),
    findings,
    findingAudits: reportValue(overrides.findingAudits, []),
    repeatedFailureClusters: reportValue(overrides.repeatedFailureClusters, []),
    correction: reportValue(overrides.correction, defaultCorrection(findings, ids)),
    validationPlan: reportValue(
      overrides.validationPlan,
      ['Reobserve all affected work at a new checkpoint.'],
    ),
    status: reportValue(overrides.status, defaultReportStatus(findings)),
  };
}
