import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { sealedSnapshot } from '../snapshot-contract/snapshot-contract.fixtures.mjs';
import { EVIDENCE_ASSERTIONS, WORK_STATES } from '../snapshot-contract/snapshot-contract.mjs';
import {
  assertSlopReport as assertSlopReportWithBinding,
  CATEGORY_EVIDENCE_RULES,
  CONFIDENCE_LEVELS,
  CORRECTION_STRATEGIES,
  createSpecialistPromptBinding,
  FAILURE_CLUSTER_RULES,
  FINDING_AUDIT_RULES,
  HUMAN_DECISIONS,
  normalizeSlopReport as normalizeSlopReportWithBinding,
  OUTCOME_RULES,
  PARENT_DIRECTIVES,
  PRIVACY_HANDLING,
  RELATIONAL_RULES,
  REPORT_OBJECT_KEYS,
  REPORT_SCHEMA,
  REPORT_SCHEMA_SHA256,
  REPORT_STATUSES,
  SEVERITIES,
  SPECIALIST_PROMPT_BINDING_RULES,
  SLOP_CATEGORIES,
} from './report-contract.mjs';
import {
  categoryCase,
  finding,
  findingAudit,
  report,
  resourceCategoryCase,
  specialistPromptBinding,
} from './report-contract.fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_BINDING = specialistPromptBinding();

function normalizeSlopReport(input, snapshot) {
  return normalizeSlopReportWithBinding(input, snapshot, PROMPT_BINDING);
}

function assertSlopReport(input, snapshot) {
  return assertSlopReportWithBinding(input, snapshot, PROMPT_BINDING);
}

function evidenceIds(roles) {
  return [...new Set(Object.values(roles).flat())];
}

function scenarioValue(value, fallback) {
  return value ?? fallback;
}

function findingLinkedEntries(entries, findingId) {
  return scenarioValue(entries, []).map((entry) => ({
    ...entry,
    findingIds: [findingId],
  }));
}

function categoryReport(category, overrides = {}, suppliedScenario = null) {
  const scenario = scenarioValue(suppliedScenario, categoryCase(category));
  const snapshot = sealedSnapshot({ extraObservations: scenario.observations });
  const findingId = 'finding-1';
  const scenarioFinding = finding({
    category,
    evidenceAnchors: evidenceIds(scenario.roles),
    affectedWork: scenario.affectedWork,
    confidence: scenarioValue(scenario.confidence, 'high'),
    severity: scenarioValue(scenario.severity, 'medium'),
    privacyHandling: scenarioValue(scenario.privacyHandling, 'not-applicable'),
    ...overrides.finding,
  });
  const correctionSpec = scenarioValue(scenario.correction, {});
  const normalizedReport = report(snapshot, {
    findings: [scenarioFinding],
    findingAudits: [findingAudit(findingId, category, scenario.roles)],
    repeatedFailureClusters: scenarioValue(scenario.repeatedFailureClusters, []),
    correction: {
      strategy: scenarioValue(correctionSpec.strategy, 'deduplicate'),
      authority: 'parent-only',
      findingIds: [findingId],
      parentDirectives: findingLinkedEntries(correctionSpec.parentDirectives, findingId),
      humanDecisions: findingLinkedEntries(correctionSpec.humanDecisions, findingId),
      validation: ['Reobserve the corrected state.'],
    },
    status: scenarioValue(correctionSpec.status, 'slop-detected'),
    ...overrides.report,
  });
  return { snapshot, report: normalizedReport, scenario };
}

function walkSchema(value, visit) {
  if (Array.isArray(value)) {
    for (const entry of value) walkSchema(entry, visit);
    return;
  }
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const entry of Object.values(value)) walkSchema(entry, visit);
}

test('accepts a clean complete orchestration without manufacturing findings', () => {
  const snapshot = sealedSnapshot();
  const result = normalizeSlopReport(report(snapshot, {
    currentWorkInventory: [{
      workId: 'work-a',
      state: 'active',
      evidenceAnchors: ['obs-assignments'],
    }],
  }), snapshot);
  assert.equal(result.status, 'clean');
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.findingAudits, []);
  assert.equal(result.correction.authority, 'parent-only');
  assert.equal(assertSlopReport(result, snapshot), result);
});

test('derives every report key, enum, bound, category rule, and outcome rule from one schema', () => {
  assert.deepEqual(REPORT_OBJECT_KEYS.report, REPORT_SCHEMA.required);
  assert.deepEqual(REPORT_OBJECT_KEYS.finding, REPORT_SCHEMA.$defs.finding.required);
  assert.deepEqual(
    REPORT_OBJECT_KEYS.findingAudit,
    REPORT_SCHEMA.$defs.findingAudit.required,
  );
  assert.deepEqual(
    REPORT_OBJECT_KEYS.evidenceRole,
    REPORT_SCHEMA.$defs.evidenceRole.required,
  );
  assert.deepEqual(SLOP_CATEGORIES, REPORT_SCHEMA.$defs.category.enum);
  assert.deepEqual(SEVERITIES, REPORT_SCHEMA.$defs.severity.enum);
  assert.deepEqual(CONFIDENCE_LEVELS, REPORT_SCHEMA.$defs.confidence.enum);
  assert.deepEqual(WORK_STATES, REPORT_SCHEMA.$defs.workState.enum);
  assert.deepEqual(CORRECTION_STRATEGIES, REPORT_SCHEMA.$defs.correctionStrategy.enum);
  assert.deepEqual(PARENT_DIRECTIVES, REPORT_SCHEMA.$defs.parentDirectiveAction.enum);
  assert.deepEqual(HUMAN_DECISIONS, REPORT_SCHEMA.$defs.humanDecision.enum);
  assert.deepEqual(PRIVACY_HANDLING, REPORT_SCHEMA.$defs.privacyHandling.enum);
  assert.deepEqual(REPORT_STATUSES, REPORT_SCHEMA.$defs.reportStatus.enum);
  assert.equal(CATEGORY_EVIDENCE_RULES, REPORT_SCHEMA['x-categoryEvidenceRules']);
  assert.equal(OUTCOME_RULES, REPORT_SCHEMA['x-outcomeRules']);
  assert.equal(FINDING_AUDIT_RULES, REPORT_SCHEMA['x-findingAuditRules']);
  assert.equal(
    FAILURE_CLUSTER_RULES,
    REPORT_SCHEMA['x-repeatedFailureClusterRules'],
  );
  assert.equal(RELATIONAL_RULES, REPORT_SCHEMA['x-relationalRules']);
  assert.equal(
    SPECIALIST_PROMPT_BINDING_RULES,
    REPORT_SCHEMA['x-specialistPromptBinding'],
  );
  assert.match(REPORT_SCHEMA_SHA256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(CATEGORY_EVIDENCE_RULES), SLOP_CATEGORIES);

  const knownAssertions = new Set(EVIDENCE_ASSERTIONS);
  for (const rule of Object.values(CATEGORY_EVIDENCE_RULES)) {
    for (const role of Object.values(rule.roles)) {
      for (const assertion of role.assertions) assert.ok(knownAssertions.has(assertion));
    }
  }

  walkSchema(REPORT_SCHEMA, (schema) => {
    if (schema.type === 'string') {
      assert.ok(Number.isInteger(schema.maxLength), 'every report string is bounded');
    }
    if (schema.type === 'array') {
      assert.ok(Number.isInteger(schema.maxItems), 'every report array is bounded');
    }
  });
  assert.equal(REPORT_SCHEMA['x-maxUtf8Bytes'], 512 * 1024);
});

test('binds the exact persona and schema bytes before dispatch', () => {
  assert.match(PROMPT_BINDING.personaSha256, /^[a-f0-9]{64}$/);
  assert.equal(PROMPT_BINDING.reportSchemaSha256, REPORT_SCHEMA_SHA256);

  const personaPath = path.resolve(
    HERE,
    '..',
    '..',
    '..',
    '..',
    'agents',
    'slop-sniper.agent.md',
  );
  const schemaPath = path.join(HERE, 'report-contract.schema.json');
  const materials = {
    personaText: fs.readFileSync(personaPath, 'utf8'),
    reportSchemaText: fs.readFileSync(schemaPath, 'utf8'),
  };
  assert.throws(
    () => createSpecialistPromptBinding({
      ...materials,
      personaText: `${materials.personaText}\nsubstituted`,
    }),
    (error) => error.code === 'invalid-specialist-materials',
  );
  assert.throws(
    () => createSpecialistPromptBinding({
      ...materials,
      reportSchemaText: `${materials.reportSchemaText}\n`,
    }),
    (error) => error.code === 'invalid-specialist-materials',
  );
});

test('publishes every validator-only rejection rule in the supplied schema', () => {
  assert.equal(RELATIONAL_RULES.highConfidenceEvidenceCompleteness, 'complete');
  assert.equal(RELATIONAL_RULES.correctionFindingIds, 'exactly-all-findings');
  assert.deepEqual(RELATIONAL_RULES.directiveTargetSources, [
    'referenced-finding-affected-work',
    'current-work-inventory',
  ]);
  assert.match(REPORT_SCHEMA.$defs.finding.$comment, /high.*complete/i);
  assert.match(
    REPORT_SCHEMA.$defs.correction.properties.findingIds.$comment,
    /all and only.*findings/i,
  );
  assert.match(
    REPORT_SCHEMA.$defs.parentDirective.properties.targets.$comment,
    /affectedWork.*currentWorkInventory/i,
  );

  const privacyConditional = REPORT_SCHEMA.$defs.finding.allOf[0];
  assert.equal(
    privacyConditional.if.properties.category.const,
    'privacy-boundary-breach',
  );
  assert.equal(
    privacyConditional.then.properties.privacyHandling.const,
    'anchors-only-redacted',
  );
  assert.equal(
    privacyConditional.else.properties.privacyHandling.const,
    'not-applicable',
  );
});

test('publishes temporal and resource-specific evidence rules in the canonical schema', () => {
  const duplicateInvestigation = CATEGORY_EVIDENCE_RULES['duplicate-investigation'];
  assert.deepEqual(duplicateInvestigation.requiredRoles, ['investigations', 'workers']);
  assert.deepEqual(
    duplicateInvestigation.relations
      .filter((relation) => relation.type === 'same-property')
      .map((relation) => relation.property),
    ['hypothesis', 'scope', 'validationPurpose'],
  );
  assert.equal(
    duplicateInvestigation.relations.filter(
      (relation) => relation.type === 'overlapping-activity',
    ).length,
    2,
  );

  const duplicateImplementation = CATEGORY_EVIDENCE_RULES['duplicate-implementation'];
  assert.deepEqual(duplicateImplementation.roleSets.sets, [
    ['branches'],
    ['changeRequests'],
    ['schedules'],
  ]);

  const stale = CATEGORY_EVIDENCE_RULES['stale-worker'];
  assert.equal(stale.roleSets.sets.length, 4);
  assert.equal(
    stale.relations.filter((relation) => relation.type === 'activity-spans-terminal').length,
    4,
  );
  assert.deepEqual(
    CATEGORY_EVIDENCE_RULES['out-of-manifest-work'].roles.issues.kinds,
    ['issue'],
  );
});

test('enforces schema-owned string, array, and report byte boundaries', () => {
  const exact = categoryReport('stale-worker', {
    finding: { consequence: 'x'.repeat(REPORT_SCHEMA.$defs.text4096.maxLength) },
  });
  assert.doesNotThrow(() => normalizeSlopReport(exact.report, exact.snapshot));

  const tooLong = categoryReport('stale-worker', {
    finding: { consequence: 'x'.repeat(REPORT_SCHEMA.$defs.text4096.maxLength + 1) },
  });
  assert.throws(
    () => normalizeSlopReport(tooLong.report, tooLong.snapshot),
    /exceeds 4096 characters/,
  );

  const snapshot = sealedSnapshot();
  const atArrayBound = report(snapshot, {
    validationPlan: Array.from(
      { length: REPORT_SCHEMA.$defs.validationPlan.maxItems },
      (_, index) => `validation-${index}`,
    ),
  });
  assert.doesNotThrow(() => normalizeSlopReport(atArrayBound, snapshot));
  assert.throws(
    () => normalizeSlopReport({
      ...atArrayBound,
      validationPlan: [...atArrayBound.validationPlan, 'one-too-many'],
    }, snapshot),
    /validationPlan exceeds 64 entries/,
  );

  assert.throws(
    () => normalizeSlopReport(report(snapshot, {
      validationPlan: ['x'.repeat(REPORT_SCHEMA['x-maxUtf8Bytes'])],
    }), snapshot),
    /report exceeds 524288 bytes/,
  );
});

test('accepts the table-driven minimum evidence projection for all 18 categories', () => {
  assert.equal(SLOP_CATEGORIES.length, 18);
  for (const category of SLOP_CATEGORIES) {
    const scenario = categoryReport(category);
    const result = normalizeSlopReport(scenario.report, scenario.snapshot);
    assert.equal(result.findings[0].category, category);
    assert.equal(result.findingAudits[0].category, category);
  }
});

test('accepts explicit resource evidence for duplicate and stale orchestration state', () => {
  for (const resourceKind of ['branch', 'change-request', 'schedule']) {
    const duplicate = categoryReport(
      'duplicate-implementation',
      {},
      resourceCategoryCase('duplicate-implementation', resourceKind),
    );
    assert.doesNotThrow(() => normalizeSlopReport(duplicate.report, duplicate.snapshot));
  }
  for (const resourceKind of ['worker', 'branch', 'change-request', 'schedule']) {
    const stale = categoryReport(
      'stale-worker',
      {},
      resourceCategoryCase('stale-worker', resourceKind),
    );
    assert.doesNotThrow(() => normalizeSlopReport(stale.report, stale.snapshot));
  }
});

test('requires the complete shared-root proof and routes one shared failure', () => {
  const scenario = categoryReport('shared-root-local-remediation');
  scenario.report.correction = {
    strategy: 'root-cause-first',
    authority: 'parent-only',
    findingIds: ['finding-1'],
    parentDirectives: [{
      action: 'consolidate-shared-root-investigation',
      targets: ['work-a', 'work-b'],
      rationale: 'Both independent heads reproduce the shared-component failure.',
      findingIds: ['finding-1'],
    }],
    humanDecisions: [],
    validation: ['Correct the common-base component, then rerun both unchanged heads.'],
  };
  const result = normalizeSlopReport(scenario.report, scenario.snapshot);
  assert.equal(result.correction.strategy, 'root-cause-first');
  assert.deepEqual(
    result.repeatedFailureClusters[0].evidenceAnchors,
    ['failure-a', 'failure-b'],
  );
});

test('enforces the schema-owned human-decision and privacy route', () => {
  const scenario = categoryReport('privacy-boundary-breach');
  const result = normalizeSlopReport(scenario.report, scenario.snapshot);
  assert.equal(result.status, OUTCOME_RULES.privacyFinding.status);
  assert.equal(result.correction.strategy, OUTCOME_RULES.privacyFinding.strategy);
  assert.equal(
    result.correction.parentDirectives[0].action,
    OUTCOME_RULES.privacyFinding.parentDirective,
  );
  assert.equal(
    result.correction.humanDecisions[0].decision,
    OUTCOME_RULES.privacyFinding.humanDecision,
  );
});
