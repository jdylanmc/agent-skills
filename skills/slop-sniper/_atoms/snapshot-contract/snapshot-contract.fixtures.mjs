import { normalizeSlopSnapshot, SNAPSHOT_COVERAGE_AREAS } from './snapshot-contract.mjs';

const AREA_OBSERVATIONS = Object.freeze([
  ['human-decisions-and-authority', 'authority', 'human'],
  ['dependency-frontier', 'dependency', 'issue'],
  ['assignments', 'assignment', 'worker-report'],
  ['worker-generations-and-handoffs', 'worker', 'status-receipt'],
  ['branches-and-worktrees', 'branch', 'git'],
  ['change-requests-and-checks', 'change-request', 'provider'],
  ['failure-fingerprints', 'validation', 'runtime'],
  ['remediation-and-retries', 'retry', 'log'],
  ['status-receipts', 'status', 'status-receipt'],
  ['schedules-and-processes', 'process', 'runtime'],
  ['repository-privacy', 'repository-privacy', 'provider'],
  ['created-artifacts', 'artifact', 'filesystem'],
  ['budgets-and-elapsed-time', 'budget', 'runtime'],
]);

export function rawSnapshot({
  partial = false,
  approvedWork = [
    { id: 'work-a', kind: 'issue', owner: 'worker-a' },
    { id: 'work-b', kind: 'issue', owner: 'worker-b' },
  ],
  extraObservations = [],
} = {}) {
  const observations = AREA_OBSERVATIONS.map(([area, kind, sourceKind], index) => ({
    id: `obs-${area}`,
    area,
    kind,
    sourceKind,
    observedAt: `2026-09-02T20:${String(index).padStart(2, '0')}:00Z`,
    completeness: partial && area === 'budgets-and-elapsed-time' ? 'partial' : 'complete',
    subject: area,
    workIds: area === 'assignments' ? ['work-a'] : [],
    revision: null,
    baseRevision: null,
    fingerprint: area === 'remediation-and-retries' ? 'baseline-retry' : null,
    state: area === 'assignments' ? 'active' : null,
    assertion: null,
    activeFrom: null,
    activeUntil: null,
    hypothesis: null,
    scope: null,
    validationPurpose: null,
    statement: `Observed ${area}.`,
    locator: `snapshot://${area}`,
    sensitivity: 'public',
  }));
  const coverage = SNAPSHOT_COVERAGE_AREAS.map((area) => ({
    area,
    status: partial && area === 'budgets-and-elapsed-time' ? 'partial' : 'complete',
    sourceIds: [`obs-${area}`],
  }));
  for (const extra of extraObservations) {
    const { area, ...rest } = extra;
    const observation = {
      state: null,
      assertion: null,
      baseRevision: null,
      activeFrom: null,
      activeUntil: null,
      hypothesis: null,
      scope: null,
      validationPurpose: null,
      ...rest,
      area,
    };
    observations.push(observation);
    const coverageEntry = coverage.find((entry) => entry.area === area);
    if (!coverageEntry) throw new Error(`fixture names unknown area: ${area}`);
    coverageEntry.sourceIds.push(observation.id);
    if (observation.completeness !== 'complete') coverageEntry.status = 'partial';
  }
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-186',
    goal: {
      id: 'goal-186',
      revision: 'goal-r1',
      statement: 'Deliver the confirmed orchestration goal.',
    },
    manifest: {
      revision: 'manifest-r1',
      approvedWork,
      exclusions: ['unrelated-work'],
    },
    fleet: { revision: 'fleet-r1' },
    repository: {
      id: 'jdylanmc/example',
      revision: 'abc123',
      visibility: 'public',
    },
    observation: {
      observedAt: '2026-09-02T21:00:00Z',
      completeness: coverage.every((entry) => entry.status === 'complete')
        ? 'complete'
        : 'partial',
      priorSnapshotId: null,
    },
    coverage,
    observations,
  };
}

export function sealedSnapshot(options) {
  return normalizeSlopSnapshot(rawSnapshot(options));
}
