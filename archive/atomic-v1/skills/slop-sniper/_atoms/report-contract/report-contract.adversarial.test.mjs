import assert from 'node:assert/strict';
import test from 'node:test';

import { sealedSnapshot } from '../snapshot-contract/snapshot-contract.fixtures.mjs';
import {
  CATEGORY_EVIDENCE_RULES,
  normalizeSlopReport as normalizeSlopReportWithBinding,
  REPORT_SCHEMA,
  SLOP_CATEGORIES,
} from './report-contract.mjs';
import {
  categoryCase,
  evidenceObservation,
  finding,
  findingAudit,
  report,
  specialistPromptBinding,
} from './report-contract.fixtures.mjs';

const PROMPT_BINDING = specialistPromptBinding();

function normalizeSlopReport(input, snapshot, binding = PROMPT_BINDING) {
  return normalizeSlopReportWithBinding(input, snapshot, binding);
}

function evidenceIds(roles) {
  return [...new Set(Object.values(roles).flat())];
}

function scenarioReport(category, mutate = () => {}) {
  const scenario = categoryCase(category);
  mutate(scenario);
  const snapshot = sealedSnapshot({ extraObservations: scenario.observations });
  const scenarioFinding = finding({
    category,
    evidenceAnchors: evidenceIds(scenario.roles),
    affectedWork: scenario.affectedWork,
    confidence: scenario.confidence ?? 'high',
    severity: scenario.severity ?? 'medium',
    privacyHandling: scenario.privacyHandling ?? 'not-applicable',
  });
  const correctionSpec = scenario.correction ?? {};
  return {
    snapshot,
    scenario,
    report: report(snapshot, {
      findings: [scenarioFinding],
      findingAudits: [findingAudit('finding-1', category, scenario.roles)],
      repeatedFailureClusters: scenario.repeatedFailureClusters ?? [],
      correction: {
        strategy: correctionSpec.strategy ?? 'deduplicate',
        authority: 'parent-only',
        findingIds: ['finding-1'],
        parentDirectives: (correctionSpec.parentDirectives ?? []).map((entry) => ({
          ...entry,
          findingIds: ['finding-1'],
        })),
        humanDecisions: (correctionSpec.humanDecisions ?? []).map((entry) => ({
          ...entry,
          findingIds: ['finding-1'],
        })),
        validation: ['Reobserve.'],
      },
      status: correctionSpec.status ?? 'slop-detected',
    }),
  };
}

test('rejects unknown fields, categories, evidence anchors, and direct authority', () => {
  const snapshot = sealedSnapshot();
  assert.throws(
    () => normalizeSlopReport({ ...report(snapshot), hiddenAuthority: true }, snapshot),
    /unknown field/,
  );
  assert.throws(
    () => normalizeSlopReport(report(snapshot, {
      findings: [finding({ category: 'looks-sloppy' })],
    }), snapshot),
    /unsupported value/,
  );
  assert.throws(
    () => normalizeSlopReport(report(snapshot, {
      findings: [finding({ evidenceAnchors: ['imaginary'] })],
    }), snapshot),
    /unknown observation/,
  );
  assert.throws(
    () => normalizeSlopReport(report(snapshot, {
      correction: {
        strategy: 'continue',
        authority: 'slop-sniper',
        findingIds: [],
        parentDirectives: [],
        humanDecisions: [],
        validation: ['Reobserve.'],
      },
    }), snapshot),
    /parent-only/,
  );
});

test('rejects missing or substituted specialist prompt bindings before report validation', () => {
  const snapshot = sealedSnapshot();
  const invalidReport = { hiddenAuthority: true };
  assert.throws(
    () => normalizeSlopReportWithBinding(invalidReport, snapshot),
    (error) => error.code === 'invalid-specialist-materials',
  );
  assert.throws(
    () => normalizeSlopReport(invalidReport, snapshot, {
      ...PROMPT_BINDING,
      personaSha256: '0'.repeat(64),
    }),
    (error) => error.code === 'invalid-specialist-materials',
  );
  assert.throws(
    () => normalizeSlopReport(invalidReport, snapshot, {
      ...PROMPT_BINDING,
      hiddenMaterial: true,
    }),
    (error) => error.code === 'invalid-specialist-materials',
  );
});

test('requires one matching audit projection for every category finding', () => {
  for (const category of SLOP_CATEGORIES) {
    const scenario = scenarioReport(category);
    scenario.report.findingAudits = [];
    assert.throws(
      () => normalizeSlopReport(scenario.report, scenario.snapshot),
      /missing finding audit/,
      category,
    );
  }
});

test('rejects every category when one schema-required evidence role is absent', () => {
  for (const category of SLOP_CATEGORIES) {
    const scenario = scenarioReport(category);
    const missingRole = Object.keys(CATEGORY_EVIDENCE_RULES[category].roles)[0];
    scenario.report.findingAudits[0].evidenceRoles =
      scenario.report.findingAudits[0].evidenceRoles.filter(
        (entry) => entry.role !== missingRole,
      );
    scenario.report.findings[0].evidenceAnchors = evidenceIds(
      Object.fromEntries(
        Object.entries(scenario.scenario.roles).filter(([role]) => role !== missingRole),
      ),
    );
    assert.throws(
      () => normalizeSlopReport(scenario.report, scenario.snapshot),
      /lacks evidence role|must contain at least 1 entries|incomplete resource evidence role set/,
      category,
    );
  }
});

test('rejects terminal state without post-terminal continuation as stale evidence', () => {
  const scenario = scenarioReport('stale-worker');
  scenario.report.findings[0].evidenceAnchors = ['worker-terminal'];
  scenario.report.findingAudits[0].evidenceRoles = [{
    role: 'terminalWorkers',
    observationIds: ['worker-terminal'],
  }];
  assert.throws(
    () => normalizeSlopReport(scenario.report, scenario.snapshot),
    /incomplete resource evidence role set/,
  );
});

test('rejects reversed post-terminal evidence and sequential stale handoffs', () => {
  const reversed = scenarioReport('stale-worker', (scenario) => {
    scenario.observations.find((entry) => entry.id === 'worker-post-terminal').observedAt =
      '2026-09-02T20:39:00Z';
  });
  assert.throws(
    () => normalizeSlopReport(reversed.report, reversed.snapshot),
    /requires post-terminal continuation/,
  );

  const handoff = scenarioReport('stale-worker', (scenario) => {
    scenario.observations.find((entry) => entry.id === 'worker-post-terminal').subject =
      'worker-b';
  });
  assert.throws(
    () => normalizeSlopReport(handoff.report, handoff.snapshot),
    /requires one matching evidence subject/,
  );

  const restarted = scenarioReport('stale-worker', (scenario) => {
    scenario.observations.find((entry) => entry.id === 'worker-post-terminal').activeFrom =
      '2026-09-02T20:40:00Z';
  });
  assert.throws(
    () => normalizeSlopReport(restarted.report, restarted.snapshot),
    /requires post-terminal continuation/,
  );
});

test('rejects non-overlapping sequential activity as duplicate work', () => {
  for (const category of ['duplicate-investigation', 'duplicate-implementation']) {
    const scenario = scenarioReport(category, (candidate) => {
      const assignmentPrefix = category === 'duplicate-investigation'
        ? 'investigation'
        : 'implementation';
      const firstAssignment = candidate.observations.find(
        (entry) => entry.id === `${assignmentPrefix}-a`,
      );
      firstAssignment.activeUntil = '2026-09-02T20:20:00Z';
      firstAssignment.state = 'terminal';
      candidate.observations.find(
        (entry) => entry.id === `${assignmentPrefix}-b`,
      ).activeFrom = '2026-09-02T20:20:00Z';

      const resourceRole = category === 'duplicate-investigation' ? 'workers' : 'branches';
      const resourceIds = candidate.roles[resourceRole];
      const firstResource = candidate.observations.find(
        (entry) => entry.id === resourceIds[0],
      );
      firstResource.activeUntil = '2026-09-02T20:20:00Z';
      firstResource.state = 'terminal';
      candidate.observations.find(
        (entry) => entry.id === resourceIds[1],
      ).activeFrom = '2026-09-02T20:20:00Z';
    });
    assert.throws(
      () => normalizeSlopReport(scenario.report, scenario.snapshot),
      /requires overlapping activity/,
      category,
    );
  }
});

test('rejects duplicate findings for distinct hypotheses, scopes, or validation purposes', () => {
  const cases = [
    ['duplicate-investigation', 'investigation-b'],
    ['duplicate-implementation', 'implementation-b'],
  ];
  for (const [category, observationId] of cases) {
    for (const property of ['hypothesis', 'scope', 'validationPurpose']) {
      const scenario = scenarioReport(category, (candidate) => {
        candidate.observations.find((entry) => entry.id === observationId)[property] =
          `distinct-${property}`;
      });
      assert.throws(
        () => normalizeSlopReport(scenario.report, scenario.snapshot),
        new RegExp(`requires matching ${property}`),
        `${category}:${property}`,
      );
    }
  }
});

test('rejects artifact alone as premature-abstraction evidence', () => {
  const scenario = scenarioReport('premature-abstraction');
  scenario.report.findings[0].evidenceAnchors = ['abstraction'];
  scenario.report.findingAudits[0].evidenceRoles = [{
    role: 'abstraction',
    observationIds: ['abstraction'],
  }];
  assert.throws(
    () => normalizeSlopReport(scenario.report, scenario.snapshot),
    /lacks evidence role: consumerAbsence/,
  );
});

test('rejects budget observation alone as unbounded-work evidence', () => {
  const scenario = scenarioReport('unbounded-work');
  scenario.report.findings[0].evidenceAnchors = ['missing-bound'];
  scenario.report.findingAudits[0].evidenceRoles = [{
    role: 'missingBound',
    observationIds: ['missing-bound'],
  }];
  assert.throws(
    () => normalizeSlopReport(scenario.report, scenario.snapshot),
    /lacks evidence role: activeWork/,
  );
});

test('rejects shared-root findings without common-base independent branches', () => {
  const related = scenarioReport('shared-root-local-remediation', (scenario) => {
    scenario.observations.find((entry) => entry.id === 'branch-b').assertion = 'related-branch';
  });
  assert.throws(
    () => normalizeSlopReport(related.report, related.snapshot),
    /incompatible observation branch-b/,
  );

  const sameHead = scenarioReport('shared-root-local-remediation', (scenario) => {
    scenario.observations.find((entry) => entry.id === 'branch-b').revision = 'head-a';
  });
  assert.throws(
    () => normalizeSlopReport(sameHead.report, sameHead.snapshot),
    /requires distinct revision/,
  );

  const differentBase = scenarioReport('shared-root-local-remediation', (scenario) => {
    scenario.observations.find((entry) => entry.id === 'branch-b').baseRevision = 'base-2';
  });
  assert.throws(
    () => normalizeSlopReport(differentBase.report, differentBase.snapshot),
    /requires matching baseRevision/,
  );
});

test('rejects shared-root findings with local component ownership or one-work reproduction', () => {
  const localOwner = scenarioReport('shared-root-local-remediation', (scenario) => {
    scenario.observations.find((entry) => entry.id === 'component-owner').assertion =
      'local-component-owner';
  });
  assert.throws(
    () => normalizeSlopReport(localOwner.report, localOwner.snapshot),
    /incompatible observation component-owner/,
  );

  const oneWork = scenarioReport('shared-root-local-remediation', (scenario) => {
    scenario.observations.find((entry) => entry.id === 'failure-b').workIds = ['work-a'];
  });
  assert.throws(
    () => normalizeSlopReport(oneWork.report, oneWork.snapshot),
    /role failures does not cover work-b/,
  );
});

test('rejects shared-root mismatched failures, absent clusters, and unrelated cluster anchors', () => {
  const mismatch = scenarioReport('shared-root-local-remediation', (scenario) => {
    scenario.observations.find((entry) => entry.id === 'failure-b').fingerprint = 'failure-2';
    scenario.repeatedFailureClusters[0].fingerprint = 'failure-2';
  });
  assert.throws(
    () => normalizeSlopReport(mismatch.report, mismatch.snapshot),
    /requires matching fingerprint/,
  );

  const absent = scenarioReport('shared-root-local-remediation');
  absent.report.repeatedFailureClusters = [];
  assert.throws(
    () => normalizeSlopReport(absent.report, absent.snapshot),
    /requires its exact repeatedFailureCluster/,
  );

  const unrelated = scenarioReport('shared-root-local-remediation');
  unrelated.report.repeatedFailureClusters[0].evidenceAnchors.push('path-a');
  assert.throws(
    () => normalizeSlopReport(unrelated.report, unrelated.snapshot),
    /must contain only matching failures/,
  );
});

test('rejects audit anchors outside the finding and findings outside the audit', () => {
  const scenario = scenarioReport('stale-worker');
  scenario.report.findingAudits[0].evidenceRoles[0].observationIds.push('obs-assignments');
  assert.throws(
    () => normalizeSlopReport(scenario.report, scenario.snapshot),
    /cites evidence outside the finding/,
  );

  const extraAnchor = scenarioReport('stale-worker');
  extraAnchor.report.findings[0].evidenceAnchors.push('obs-assignments');
  assert.throws(
    () => normalizeSlopReport(extraAnchor.report, extraAnchor.snapshot),
    /audit must project every evidence anchor exactly/,
  );
});

test('rejects prototype-key evidence roles that launder unrelated evidence', () => {
  for (const role of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const scenario = scenarioReport('stale-worker');
    scenario.report.findings[0].evidenceAnchors.push('obs-assignments');
    scenario.report.findingAudits[0].evidenceRoles.push({
      role,
      observationIds: ['obs-assignments'],
    });
    assert.throws(
      () => normalizeSlopReport(scenario.report, scenario.snapshot),
      new RegExp(`unsupported evidence role: ${role}$`),
      role,
    );
  }
});

test('rejects schema-disclosed strategy, status, critical, and human-decision incompatibilities', () => {
  const stale = scenarioReport('stale-worker');
  stale.report.correction.strategy = 'pause-wave';
  assert.throws(
    () => normalizeSlopReport(stale.report, stale.snapshot),
    /pause-wave requires status pause-recommended/,
  );

  const decision = scenarioReport('stale-worker');
  decision.report.correction.humanDecisions = [{
    decision: 'change-scope-or-priority',
    rationale: 'Human decision requested.',
    findingIds: ['finding-1'],
  }];
  assert.throws(
    () => normalizeSlopReport(decision.report, decision.snapshot),
    /human-decision-required and named human decisions must occur together/,
  );

  const critical = scenarioReport('stale-worker');
  critical.report.findings[0].severity = 'critical';
  assert.throws(
    () => normalizeSlopReport(critical.report, critical.snapshot),
    /critical finding status is incompatible/,
  );
});

test('rejects privacy findings without the exact parent-only containment route', () => {
  const privacy = scenarioReport('privacy-boundary-breach');
  privacy.report.correction.parentDirectives = [];
  assert.throws(
    () => normalizeSlopReport(privacy.report, privacy.snapshot),
    /violates the canonical privacy route/,
  );
});

test('rejects sensitive report text and responses above the schema byte ceiling', () => {
  const stale = scenarioReport('stale-worker');
  stale.report.findings[0].consequence = 'client_secret=Sup3rSecretValue';
  assert.throws(
    () => normalizeSlopReport(stale.report, stale.snapshot),
    /contains sensitive content/,
  );

  const snapshot = sealedSnapshot();
  const oversized = report(snapshot, {
    validationPlan: ['x'.repeat(REPORT_SCHEMA['x-maxUtf8Bytes'])],
  });
  assert.throws(
    () => normalizeSlopReport(oversized, snapshot),
    /report exceeds 524288 bytes/,
  );
});

test('rejects high confidence backed by partial evidence', () => {
  const scenario = scenarioReport('evidence-laundering');
  scenario.report.findings[0].confidence = 'high';
  assert.throws(
    () => normalizeSlopReport(scenario.report, scenario.snapshot),
    /cannot claim high confidence from partial evidence/,
  );
});

test('requires correction findingIds to cover all and only findings', () => {
  const scenario = scenarioReport('stale-worker');
  scenario.report.correction.findingIds = [];
  assert.throws(
    () => normalizeSlopReport(scenario.report, scenario.snapshot),
    /must account for every finding/,
  );
});

test('accepts only affected or current work as correction targets', () => {
  const stale = scenarioReport('stale-worker');
  stale.report.correction.parentDirectives = [{
    action: 'stop-new-dispatch',
    targets: ['outside-snapshot-work'],
    rationale: 'Not anchored.',
    findingIds: ['finding-1'],
  }];
  assert.throws(
    () => normalizeSlopReport(stale.report, stale.snapshot),
    /targets are outside affected\/current work/,
  );

  const current = scenarioReport('stale-worker');
  current.report.currentWorkInventory = [{
    workId: 'work-a',
    state: 'active',
    evidenceAnchors: ['worker-post-terminal'],
  }];
  current.report.correction.parentDirectives = [{
    action: 'stop-new-dispatch',
    targets: ['work-a'],
    rationale: 'Target current work.',
    findingIds: ['finding-1'],
  }];
  assert.doesNotThrow(() => normalizeSlopReport(current.report, current.snapshot));

  const anchor = scenarioReport('stale-worker');
  anchor.report.correction.parentDirectives = [{
    action: 'stop-new-dispatch',
    targets: ['active-assignment'],
    rationale: 'Evidence identities are not work targets.',
    findingIds: ['finding-1'],
  }];
  assert.throws(
    () => normalizeSlopReport(anchor.report, anchor.snapshot),
    /targets are outside affected\/current work/,
  );
});

test('rejects a finding projection that substitutes an unrelated observation kind', () => {
  const stale = scenarioReport('stale-worker', (scenario) => {
    scenario.observations.push(evidenceObservation(
      'unrelated-active-worker',
      'created-artifacts',
      'artifact',
      'filesystem',
      ['work-a'],
      'worker-active',
      {
        state: 'active',
        subject: 'worker-a',
        activeFrom: '2026-09-02T20:00:00Z',
      },
    ));
    scenario.roles.postTerminalWorkers = ['unrelated-active-worker'];
  });
  assert.throws(
    () => normalizeSlopReport(stale.report, stale.snapshot),
    /incompatible observation unrelated-active-worker/,
  );
});
