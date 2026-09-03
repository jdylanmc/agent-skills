#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  redactTextWithConfiguredIdentifiers,
} from '../../../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';
import {
  assertSlopSnapshot,
  WORK_STATES,
} from '../snapshot-contract/snapshot-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPORT_SCHEMA_PATH = path.join(HERE, 'report-contract.schema.json');
const REPORT_SCHEMA_TEXT = fs.readFileSync(REPORT_SCHEMA_PATH, 'utf8');

export const REPORT_SCHEMA = Object.freeze(
  JSON.parse(REPORT_SCHEMA_TEXT),
);
export const SPECIALIST_PROMPT_BINDING_RULES = Object.freeze(
  REPORT_SCHEMA['x-specialistPromptBinding'],
);
export const RELATIONAL_RULES = Object.freeze(REPORT_SCHEMA['x-relationalRules']);
export const CATEGORY_EVIDENCE_RULES = Object.freeze(
  REPORT_SCHEMA['x-categoryEvidenceRules'],
);
export const OUTCOME_RULES = Object.freeze(REPORT_SCHEMA['x-outcomeRules']);
export const FINDING_AUDIT_RULES = Object.freeze(REPORT_SCHEMA['x-findingAuditRules']);
export const FAILURE_CLUSTER_RULES = Object.freeze(
  REPORT_SCHEMA['x-repeatedFailureClusterRules'],
);
export const SLOP_CATEGORIES = Object.freeze([...REPORT_SCHEMA.$defs.category.enum]);
export const CORRECTION_STRATEGIES = Object.freeze([
  ...REPORT_SCHEMA.$defs.correctionStrategy.enum,
]);
export const PARENT_DIRECTIVES = Object.freeze([
  ...REPORT_SCHEMA.$defs.parentDirectiveAction.enum,
]);
export const HUMAN_DECISIONS = Object.freeze([...REPORT_SCHEMA.$defs.humanDecision.enum]);
export const REPORT_STATUSES = Object.freeze([...REPORT_SCHEMA.$defs.reportStatus.enum]);
export const SEVERITIES = Object.freeze([...REPORT_SCHEMA.$defs.severity.enum]);
export const CONFIDENCE_LEVELS = Object.freeze([...REPORT_SCHEMA.$defs.confidence.enum]);
export const PRIVACY_HANDLING = Object.freeze([
  ...REPORT_SCHEMA.$defs.privacyHandling.enum,
]);

export const REPORT_OBJECT_KEYS = Object.freeze({
  report: Object.freeze([...REPORT_SCHEMA.required]),
  snapshotReference: Object.freeze([...REPORT_SCHEMA.$defs.snapshotReference.required]),
  currentWorkInventoryItem: Object.freeze([
    ...REPORT_SCHEMA.$defs.currentWorkInventoryItem.required,
  ]),
  finding: Object.freeze([...REPORT_SCHEMA.$defs.finding.required]),
  findingAudit: Object.freeze([...REPORT_SCHEMA.$defs.findingAudit.required]),
  evidenceRole: Object.freeze([...REPORT_SCHEMA.$defs.evidenceRole.required]),
  repeatedFailureCluster: Object.freeze([
    ...REPORT_SCHEMA.$defs.repeatedFailureCluster.required,
  ]),
  correction: Object.freeze([...REPORT_SCHEMA.$defs.correction.required]),
  parentDirective: Object.freeze([...REPORT_SCHEMA.$defs.parentDirective.required]),
  humanDecision: Object.freeze([...REPORT_SCHEMA.$defs.humanDecisionRequest.required]),
});

const STATUSES = new Set(REPORT_STATUSES);
const SEVERITY_SET = new Set(SEVERITIES);
const CONFIDENCE_SET = new Set(CONFIDENCE_LEVELS);
const WORK_STATE_SET = new Set(WORK_STATES);
const PRIVACY_HANDLING_SET = new Set(PRIVACY_HANDLING);
const CATEGORY_SET = new Set(SLOP_CATEGORIES);
const STRATEGY_SET = new Set(CORRECTION_STRATEGIES);
const DIRECTIVE_SET = new Set(PARENT_DIRECTIVES);
const HUMAN_DECISION_SET = new Set(HUMAN_DECISIONS);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

export const REPORT_SCHEMA_SHA256 = sha256(REPORT_SCHEMA_TEXT);

function invalidSpecialistMaterials(message) {
  const error = new Error(message);
  error.code = 'invalid-specialist-materials';
  return error;
}

function specialistObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidSpecialistMaterials(`${field} must be an object`);
  }
  return value;
}

function specialistOnlyKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw invalidSpecialistMaterials(`${field} has ${unknown.length} unknown field(s)`);
  }
}

function materialText(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalidSpecialistMaterials(`${field} must contain the exact UTF-8 source text`);
  }
  return value;
}

function specialistDigest(value, field) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw invalidSpecialistMaterials(`${field} must be a lowercase SHA-256 digest`);
  }
  return value;
}

export function createSpecialistPromptBinding(input) {
  const materials = specialistObject(input, 'specialistMaterials');
  specialistOnlyKeys(
    materials,
    new Set(['personaText', 'reportSchemaText']),
    'specialistMaterials',
  );
  const personaText = materialText(materials.personaText, 'specialistMaterials.personaText');
  const reportSchemaText = materialText(
    materials.reportSchemaText,
    'specialistMaterials.reportSchemaText',
  );
  const personaSha256 = sha256(personaText);
  if (personaSha256 !== SPECIALIST_PROMPT_BINDING_RULES.personaSha256) {
    throw invalidSpecialistMaterials('specialist persona bytes do not match the canonical digest');
  }
  if (reportSchemaText !== REPORT_SCHEMA_TEXT) {
    throw invalidSpecialistMaterials('specialist report schema bytes do not match the validator');
  }
  return Object.freeze({
    personaSha256,
    reportSchemaSha256: sha256(reportSchemaText),
  });
}

export function assertSpecialistPromptBinding(input) {
  const binding = specialistObject(input, 'specialistPromptBinding');
  specialistOnlyKeys(
    binding,
    new Set(['personaSha256', 'reportSchemaSha256']),
    'specialistPromptBinding',
  );
  const personaSha256 = specialistDigest(
    binding.personaSha256,
    'specialistPromptBinding.personaSha256',
  );
  const reportSchemaSha256 = specialistDigest(
    binding.reportSchemaSha256,
    'specialistPromptBinding.reportSchemaSha256',
  );
  if (personaSha256 !== SPECIALIST_PROMPT_BINDING_RULES.personaSha256
      || reportSchemaSha256 !== REPORT_SCHEMA_SHA256) {
    throw invalidSpecialistMaterials('specialist prompt binding does not match canonical materials');
  }
  return binding;
}

function definition(name) {
  return REPORT_SCHEMA.$defs[name];
}

function propertySchema(objectName, property) {
  const root = objectName === 'report' ? REPORT_SCHEMA : definition(objectName);
  return root.properties[property];
}

function referencedDefinition(schema) {
  const prefix = '#/$defs/';
  return schema?.$ref?.startsWith(prefix)
    ? definition(schema.$ref.slice(prefix.length))
    : schema;
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function onlyKeys(value, allowed, field) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new Error(`${field} has ${unknown.length} unknown field(s)`);
  }
}

function string(value, field, schemaName = 'text2048') {
  const schema = definition(schemaName);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > schema.maxLength) {
    throw new Error(`${field} exceeds ${schema.maxLength} characters`);
  }
  if (redactTextWithConfiguredIdentifiers(normalized).text !== normalized) {
    throw new Error(`${field} contains sensitive content; use a redacted evidence anchor`);
  }
  return normalized;
}

function enumValue(value, allowed, field) {
  const normalized = string(value, field, 'roleName');
  if (!allowed.has(normalized)) throw new Error(`${field} has unsupported value: ${normalized}`);
  return normalized;
}

function boundedArray(value, field, schema) {
  const resolved = referencedDefinition(schema);
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (resolved.maxItems !== undefined && value.length > resolved.maxItems) {
    throw new Error(`${field} exceeds ${resolved.maxItems} entries`);
  }
  if (resolved.minItems !== undefined && value.length < resolved.minItems) {
    throw new Error(`${field} must contain at least ${resolved.minItems} entries`);
  }
  return value;
}

function stringArray(value, field, schemaName) {
  const schema = definition(schemaName);
  const itemSchema = referencedDefinition(schema.items);
  const itemDefinitionName = schema.items.$ref.slice('#/$defs/'.length);
  const normalized = boundedArray(value, field, schema)
    .map((entry, index) => string(entry, `${field}[${index}]`, itemDefinitionName));
  if (schema.uniqueItems && new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} contains duplicate values`);
  }
  if (itemSchema.maxLength === undefined) throw new Error(`${schemaName} lacks a string bound`);
  return normalized;
}

function findingIds(value, field, known) {
  const normalized = stringArray(value, field, 'identifierList128');
  for (const id of normalized) {
    if (!known.has(id)) throw new Error(`${field} names unknown finding: ${id}`);
  }
  return normalized.sort();
}

function evidenceAnchors(value, field, observations, { nonEmpty = true } = {}) {
  const schemaName = nonEmpty ? 'nonEmptyIdentifierList128' : 'identifierList128';
  const normalized = stringArray(value, field, schemaName);
  for (const id of normalized) {
    if (!observations.has(id)) throw new Error(`${field} names unknown observation: ${id}`);
  }
  return normalized.sort();
}

function normalizeSnapshotReference(input, snapshot) {
  const reference = object(input, 'report.snapshot');
  onlyKeys(reference, new Set(REPORT_OBJECT_KEYS.snapshotReference), 'report.snapshot');
  const expected = {
    snapshotId: snapshot.snapshotId,
    bindingDigest: snapshot.bindingDigest,
    goalRevision: snapshot.goal.revision,
    manifestRevision: snapshot.manifest.revision,
    fleetRevision: snapshot.fleet.revision,
    repositoryRevision: snapshot.repository.revision,
    observedAt: snapshot.observation.observedAt,
    completeness: snapshot.observation.completeness,
  };
  if (!isDeepStrictEqual(reference, expected)) {
    throw new Error('report snapshot reference does not match the sealed snapshot');
  }
  return expected;
}

function validateFindingConfidence(finding, anchored) {
  if (finding.confidence === 'high'
      && anchored.some((observation) =>
        observation.completeness !== RELATIONAL_RULES.highConfidenceEvidenceCompleteness)) {
    throw new Error(`finding ${finding.id} cannot claim high confidence from partial evidence`);
  }
}

function validateAffectedWork(finding, anchored) {
  const anchoredWork = new Set(anchored.flatMap((observation) => observation.workIds));
  const unanchoredWork = finding.affectedWork.filter((workId) => !anchoredWork.has(workId));
  if (unanchoredWork.length) {
    throw new Error(
      `finding ${finding.id} names work absent from its evidence: ${unanchoredWork.join(', ')}`,
    );
  }
}

function validatePrivacyHandling(finding) {
  const conditional = definition('finding').allOf[0];
  const expected = finding.category === conditional.if.properties.category.const
    ? conditional.then.properties.privacyHandling.const
    : conditional.else.properties.privacyHandling.const;
  if (finding.privacyHandling !== expected) {
    throw new Error(`finding ${finding.id} must use privacy handling ${expected}`);
  }
}

function uniqueFindingId(entry, index, ids) {
  const id = string(entry.id, `findings[${index}].id`, 'identifier');
  if (ids.has(id)) throw new Error(`duplicate finding id: ${id}`);
  ids.add(id);
  return id;
}

function normalizeFinding(entry, index, context) {
  object(entry, `findings[${index}]`);
  onlyKeys(entry, new Set(REPORT_OBJECT_KEYS.finding), `findings[${index}]`);
  const finding = {
    id: uniqueFindingId(entry, index, context.ids),
    category: enumValue(entry.category, CATEGORY_SET, `findings[${index}].category`),
    severity: enumValue(entry.severity, SEVERITY_SET, `findings[${index}].severity`),
    evidenceAnchors: evidenceAnchors(
      entry.evidenceAnchors,
      `findings[${index}].evidenceAnchors`,
      context.observations,
    ),
    affectedWork: stringArray(
      entry.affectedWork,
      `findings[${index}].affectedWork`,
      'nonEmptyIdentifierList128',
    ).sort(),
    consequence: string(entry.consequence, `findings[${index}].consequence`, 'text4096'),
    confidence: enumValue(
      entry.confidence,
      CONFIDENCE_SET,
      `findings[${index}].confidence`,
    ),
    disconfirmingEvidence: evidenceAnchors(
      entry.disconfirmingEvidence,
      `findings[${index}].disconfirmingEvidence`,
      context.observations,
      { nonEmpty: false },
    ),
    rootCorrection: string(
      entry.rootCorrection,
      `findings[${index}].rootCorrection`,
      'text4096',
    ),
    localActionsToStop: stringArray(
      entry.localActionsToStop,
      `findings[${index}].localActionsToStop`,
      'textList32',
    ),
    validation: stringArray(
      entry.validation,
      `findings[${index}].validation`,
      'nonEmptyTextList32',
    ),
    privacyHandling: enumValue(
      entry.privacyHandling,
      PRIVACY_HANDLING_SET,
      `findings[${index}].privacyHandling`,
    ),
  };
  const anchored = finding.evidenceAnchors.map((anchor) => context.observations.get(anchor));
  validateFindingConfidence(finding, anchored);
  validateAffectedWork(finding, anchored);
  validatePrivacyHandling(finding);
  return finding;
}

function normalizeFindings(input, snapshot) {
  boundedArray(input, 'findings', propertySchema('report', 'findings'));
  const context = {
    observations: new Map(snapshot.observations.map((entry) => [entry.id, entry])),
    ids: new Set(),
  };
  return input.map((entry, index) => normalizeFinding(entry, index, context));
}

function normalizeInventory(input, observations) {
  boundedArray(
    input,
    'currentWorkInventory',
    propertySchema('report', 'currentWorkInventory'),
  );
  const ids = new Set();
  return input.map((entry, index) => {
    object(entry, `currentWorkInventory[${index}]`);
    onlyKeys(
      entry,
      new Set(REPORT_OBJECT_KEYS.currentWorkInventoryItem),
      `currentWorkInventory[${index}]`,
    );
    const workId = string(entry.workId, `currentWorkInventory[${index}].workId`, 'identifier');
    if (ids.has(workId)) throw new Error(`duplicate work inventory id: ${workId}`);
    ids.add(workId);
    const anchors = evidenceAnchors(
      entry.evidenceAnchors,
      `currentWorkInventory[${index}].evidenceAnchors`,
      observations,
    );
    const state = enumValue(
      entry.state,
      WORK_STATE_SET,
      `currentWorkInventory[${index}].state`,
    );
    if (!anchors.some((id) => {
      const observation = observations.get(id);
      return observation.workIds.includes(workId) && observation.state === state;
    })) {
      throw new Error(`currentWorkInventory ${workId} lacks an anchored ${state} state`);
    }
    return { workId, state, evidenceAnchors: anchors };
  });
}

const ROLE_FILTERS = Object.freeze({
  assertions: 'assertion',
  kinds: 'kind',
  sourceKinds: 'sourceKind',
  states: 'state',
  completeness: 'completeness',
  sensitivity: 'sensitivity',
});

function validateRoleObservation(observation, spec, findingId, role) {
  for (const [constraint, property] of Object.entries(ROLE_FILTERS)) {
    if (spec[constraint] && !spec[constraint].includes(observation[property])) {
      throw new Error(
        `finding ${findingId} role ${role} has incompatible observation ${observation.id}`,
      );
    }
  }
  if (spec.singleWork && observation.workIds.length !== 1) {
    throw new Error(`finding ${findingId} role ${role} requires one work per observation`);
  }
}

function validateRoleCoverage(observations, spec, finding, role) {
  if (!spec.coversAffectedWork) return;
  const observedWork = new Set(observations.flatMap((entry) => entry.workIds));
  const missing = finding.affectedWork.filter((workId) => !observedWork.has(workId));
  if (missing.length) {
    throw new Error(`finding ${finding.id} role ${role} does not cover ${missing.join(', ')}`);
  }
}

function observationsForRoles(roleMap, roleNames) {
  return roleNames.flatMap((role) => roleMap.get(role) ?? []);
}

function requiredPropertyValues(observations, relation, findingId) {
  const values = observations.map((entry) => entry[relation.property]);
  if (values.some((value) => value === null || value === undefined || value === '')) {
    throw new Error(
      `finding ${findingId} relation ${relation.type} requires ${relation.property}`,
    );
  }
  return values;
}

function validateSameProperty(observations, relation, finding) {
  const values = requiredPropertyValues(observations, relation, finding.id);
  if (new Set(values).size !== 1) {
    throw new Error(`finding ${finding.id} requires matching ${relation.property}`);
  }
}

function validateDistinctProperty(observations, relation, finding) {
  const values = requiredPropertyValues(observations, relation, finding.id);
  if (new Set(values).size !== values.length) {
    throw new Error(`finding ${finding.id} requires distinct ${relation.property}`);
  }
}

function validateSameSubject(observations, _relation, finding) {
  if (new Set(observations.map((entry) => entry.subject)).size !== 1) {
    throw new Error(`finding ${finding.id} requires one matching evidence subject`);
  }
}

function validateDistinctWork(observations, _relation, finding) {
  const work = new Set(observations.flatMap((entry) => entry.workIds));
  if (finding.affectedWork.length < 2 || work.size < 2) {
    throw new Error(`finding ${finding.id} requires independent work identities`);
  }
}

function validateDistinctSourceKind(observations, _relation, finding) {
  if (new Set(observations.map((entry) => entry.sourceKind)).size < 2) {
    throw new Error(`finding ${finding.id} requires distinct evidence source kinds`);
  }
}

function activityEnd(observation) {
  return Date.parse(observation.activeUntil ?? observation.observedAt);
}

function validateOverlappingActivity(observations, relation, finding) {
  if (observations.some((entry) => entry.activeFrom === null)) {
    throw new Error(`finding ${finding.id} relation ${relation.type} requires activeFrom`);
  }
  const latestStart = Math.max(...observations.map((entry) => Date.parse(entry.activeFrom)));
  const earliestEnd = Math.min(...observations.map(activityEnd));
  if (latestStart >= earliestEnd) {
    throw new Error(`finding ${finding.id} requires overlapping activity`);
  }
}

function validateActivitySpansTerminal(_observations, relation, finding, context) {
  const [terminalRole, activityRole] = relation.roles;
  const terminals = context.roleMap.get(terminalRole);
  const activity = context.roleMap.get(activityRole);
  const terminalAt = Math.max(...terminals.map((entry) => Date.parse(entry.observedAt)));
  const spansTerminal = activity.every((entry) =>
    entry.activeFrom !== null
    && Date.parse(entry.activeFrom) < terminalAt
    && activityEnd(entry) > terminalAt);
  if (!spansTerminal) {
    throw new Error(`finding ${finding.id} requires post-terminal continuation`);
  }
}

function validateOutsideManifest(observations, _relation, finding, context) {
  const observed = new Set(observations.flatMap((entry) => entry.workIds));
  const outside = finding.affectedWork.filter(
    (workId) => observed.has(workId) && !context.approved.has(workId),
  );
  if (outside.length === 0) {
    throw new Error(`finding ${finding.id} names no observed work outside the manifest`);
  }
}

const RELATION_VALIDATORS = Object.freeze({
  'same-property': validateSameProperty,
  'distinct-property': validateDistinctProperty,
  'same-subject': validateSameSubject,
  'distinct-work': validateDistinctWork,
  'distinct-source-kind': validateDistinctSourceKind,
  'overlapping-activity': validateOverlappingActivity,
  'activity-spans-terminal': validateActivitySpansTerminal,
  'outside-manifest': validateOutsideManifest,
});

function relationRolesPresent(relation, roleMap) {
  return relation.roles.every((role) => roleMap.has(role));
}

function validateRelations(rule, roleMap, finding, context) {
  for (const relation of rule.relations) {
    if (relation.optional && !relationRolesPresent(relation, roleMap)) continue;
    const validator = RELATION_VALIDATORS[relation.type];
    if (!validator) throw new Error(`unsupported category relation: ${relation.type}`);
    validator(
      observationsForRoles(roleMap, relation.roles),
      relation,
      finding,
      { ...context, roleMap },
    );
  }
}

function normalizeEvidenceRole(entry, index, finding, rule, observations, roleMap) {
  const field = `findingAudit ${finding.id}.evidenceRoles[${index}]`;
  object(entry, field);
  onlyKeys(entry, new Set(REPORT_OBJECT_KEYS.evidenceRole), field);
  const role = string(entry.role, `${field}.role`, 'roleName');
  const spec = Object.hasOwn(rule.roles, role) ? rule.roles[role] : undefined;
  if (FINDING_AUDIT_RULES.requiredRolesMustMatchCategory && !spec) {
    throw new Error(`finding ${finding.id} has unsupported evidence role: ${role}`);
  }
  if (roleMap.has(role)) throw new Error(`finding ${finding.id} duplicates evidence role: ${role}`);
  const ids = evidenceAnchors(entry.observationIds, `${field}.observationIds`, observations);
  if (ids.length < spec.minItems) {
    throw new Error(`finding ${finding.id} role ${role} requires ${spec.minItems} observations`);
  }
  if (ids.some((id) => !finding.evidenceAnchors.includes(id))) {
    throw new Error(`finding ${finding.id} role ${role} cites evidence outside the finding`);
  }
  const roleObservations = ids.map((id) => observations.get(id));
  for (const observation of roleObservations) {
    validateRoleObservation(observation, spec, finding.id, role);
  }
  validateRoleCoverage(roleObservations, spec, finding, role);
  roleMap.set(role, roleObservations);
  return { role, observationIds: ids };
}

function requiredRoles(rule) {
  if (rule.requiredRoles) return rule.requiredRoles;
  return rule.roleSets ? [] : Object.keys(rule.roles);
}

function validateRequiredRoles(finding, rule, roleMap) {
  const missing = requiredRoles(rule).filter((role) => !roleMap.has(role));
  if (FINDING_AUDIT_RULES.requiredRolesMustMatchCategory && missing.length) {
    throw new Error(`finding ${finding.id} lacks evidence role: ${missing.join(', ')}`);
  }
}

function roleSetComplete(roleSet, roleMap) {
  const present = roleSet.filter((role) => roleMap.has(role)).length;
  return present === roleSet.length;
}

function roleSetPartial(roleSet, roleMap) {
  const present = roleSet.filter((role) => roleMap.has(role)).length;
  return present > 0 && present < roleSet.length;
}

function validateRoleSets(finding, rule, roleMap) {
  if (!rule.roleSets) return;
  if (rule.roleSets.sets.some((roleSet) => roleSetPartial(roleSet, roleMap))) {
    throw new Error(`finding ${finding.id} has an incomplete resource evidence role set`);
  }
  const complete = rule.roleSets.sets.filter(
    (roleSet) => roleSetComplete(roleSet, roleMap),
  ).length;
  if (rule.roleSets.mode === 'exactly-one' && complete !== 1) {
    throw new Error(`finding ${finding.id} requires exactly one resource evidence role set`);
  }
}

function validateExactEvidenceProjection(finding, roleMap) {
  const projected = [...new Set([...roleMap.values()].flat().map((entry) => entry.id))].sort();
  if (FINDING_AUDIT_RULES.allAndOnlyFindingEvidenceAnchors
      && !isDeepStrictEqual(projected, finding.evidenceAnchors)) {
    throw new Error(`finding ${finding.id} audit must project every evidence anchor exactly`);
  }
}

function normalizeEvidenceRoles(input, finding, rule, observations) {
  boundedArray(
    input,
    `findingAudit ${finding.id}.evidenceRoles`,
    propertySchema('findingAudit', 'evidenceRoles'),
  );
  const roleMap = new Map();
  const normalizedRoles = input.map((entry, index) =>
    normalizeEvidenceRole(entry, index, finding, rule, observations, roleMap));
  validateRequiredRoles(finding, rule, roleMap);
  validateRoleSets(finding, rule, roleMap);
  validateExactEvidenceProjection(finding, roleMap);
  return { normalized: normalizedRoles, roleMap };
}

const DIRECTIVE_TARGET_RESOLVERS = Object.freeze({
  'referenced-finding-affected-work': (findingIds, findingMap) =>
    findingIds.flatMap((findingId) => findingMap.get(findingId).affectedWork),
  'current-work-inventory': (_findingIds, _findingMap, currentWorkInventory) =>
    currentWorkInventory.map((entry) => entry.workId),
});

function allowedDirectiveTargets(directiveFindingIds, findingMap, currentWorkInventory) {
  const allowed = new Set();
  const context = [directiveFindingIds, findingMap, currentWorkInventory];
  for (const source of RELATIONAL_RULES.directiveTargetSources) {
    const resolve = DIRECTIVE_TARGET_RESOLVERS[source];
    if (!resolve) throw new Error(`unsupported directive target source: ${source}`);
    for (const target of resolve(...context)) allowed.add(target);
  }
  return allowed;
}

function normalizeParentDirective(entry, index, findingMap, findingSet, currentWorkInventory) {
  const field = `correction.parentDirectives[${index}]`;
  object(entry, field);
  onlyKeys(entry, new Set(REPORT_OBJECT_KEYS.parentDirective), field);
  const directiveFindingIds = findingIds(entry.findingIds, `${field}.findingIds`, findingSet);
  const targets = stringArray(
    entry.targets,
    `${field}.targets`,
    'nonEmptyIdentifierList128',
  ).sort();
  const allowedTargets = allowedDirectiveTargets(
    directiveFindingIds,
    findingMap,
    currentWorkInventory,
  );
  const outside = targets.filter((target) => !allowedTargets.has(target));
  if (outside.length) {
    throw new Error(`correction directive targets are outside affected/current work: ${outside.join(', ')}`);
  }
  return {
    action: enumValue(entry.action, DIRECTIVE_SET, `${field}.action`),
    targets,
    rationale: string(entry.rationale, `${field}.rationale`, 'text2048'),
    findingIds: directiveFindingIds,
  };
}

function normalizeHumanDecision(entry, index, findingSet) {
  const field = `correction.humanDecisions[${index}]`;
  object(entry, field);
  onlyKeys(entry, new Set(REPORT_OBJECT_KEYS.humanDecision), field);
  return {
    decision: enumValue(entry.decision, HUMAN_DECISION_SET, `${field}.decision`),
    rationale: string(entry.rationale, `${field}.rationale`, 'text2048'),
    findingIds: findingIds(entry.findingIds, `${field}.findingIds`, findingSet),
  };
}

function validateCorrectionFindingCoverage(ids, findingSet) {
  if (RELATIONAL_RULES.correctionFindingIds === 'exactly-all-findings'
      && !isDeepStrictEqual(ids, [...findingSet].sort())) {
    throw new Error('the one correction must account for every finding');
  }
}

function normalizeCorrection(input, findings, currentWorkInventory) {
  const findingMap = new Map(findings.map((finding) => [finding.id, finding]));
  const findingSet = new Set(findingMap.keys());
  const correction = object(input, 'correction');
  onlyKeys(correction, new Set(REPORT_OBJECT_KEYS.correction), 'correction');
  if (correction.authority !== 'parent-only') {
    throw new Error('correction.authority must be parent-only');
  }
  const ids = findingIds(correction.findingIds, 'correction.findingIds', findingSet);
  validateCorrectionFindingCoverage(ids, findingSet);
  boundedArray(
    correction.parentDirectives,
    'correction.parentDirectives',
    propertySchema('correction', 'parentDirectives'),
  );
  const parentDirectives = correction.parentDirectives.map((entry, index) =>
    normalizeParentDirective(entry, index, findingMap, findingSet, currentWorkInventory));
  boundedArray(
    correction.humanDecisions,
    'correction.humanDecisions',
    propertySchema('correction', 'humanDecisions'),
  );
  const humanDecisions = correction.humanDecisions.map((entry, index) =>
    normalizeHumanDecision(entry, index, findingSet));
  return {
    strategy: enumValue(correction.strategy, STRATEGY_SET, 'correction.strategy'),
    authority: 'parent-only',
    findingIds: ids,
    parentDirectives,
    humanDecisions,
    validation: stringArray(
      correction.validation,
      'correction.validation',
      'nonEmptyTextList32',
    ),
  };
}

function normalizeFindingAudits(input, findings, snapshot, observations) {
  boundedArray(input, 'findingAudits', propertySchema('report', 'findingAudits'));
  const findingMap = new Map(findings.map((finding) => [finding.id, finding]));
  const approved = new Set(snapshot.manifest.approvedWork.map((entry) => entry.id));
  const seen = new Set();
  const normalized = input.map((entry, index) => {
    object(entry, `findingAudits[${index}]`);
    onlyKeys(entry, new Set(REPORT_OBJECT_KEYS.findingAudit), `findingAudits[${index}]`);
    const findingId = string(entry.findingId, `findingAudits[${index}].findingId`, 'identifier');
    const finding = findingMap.get(findingId);
    if (!finding) throw new Error(`findingAudits names unknown finding: ${findingId}`);
    if (seen.has(findingId)) throw new Error(`duplicate finding audit: ${findingId}`);
    seen.add(findingId);
    const category = enumValue(entry.category, CATEGORY_SET, `findingAudits[${index}].category`);
    if (FINDING_AUDIT_RULES.categoryMustMatch && category !== finding.category) {
      throw new Error(`finding audit ${findingId} category does not match its finding`);
    }
    const rule = CATEGORY_EVIDENCE_RULES[category];
    const roles = normalizeEvidenceRoles(entry.evidenceRoles, finding, rule, observations);
    validateRelations(rule, roles.roleMap, finding, { approved });
    return {
      findingId,
      category,
      evidenceRoles: roles.normalized,
      roleMap: roles.roleMap,
    };
  });
  const missing = findings.filter((finding) => !seen.has(finding.id)).map((finding) => finding.id);
  if (FINDING_AUDIT_RULES.exactlyOnePerFinding && missing.length) {
    throw new Error(`missing finding audit: ${missing.join(', ')}`);
  }
  return normalized;
}

function normalizeRepeatedFailures(input, observations) {
  boundedArray(
    input,
    'repeatedFailureClusters',
    propertySchema('report', 'repeatedFailureClusters'),
  );
  const fingerprints = new Set();
  return input.map((entry, index) => {
    object(entry, `repeatedFailureClusters[${index}]`);
    onlyKeys(
      entry,
      new Set(REPORT_OBJECT_KEYS.repeatedFailureCluster),
      `repeatedFailureClusters[${index}]`,
    );
    const fingerprint = string(
      entry.fingerprint,
      `repeatedFailureClusters[${index}].fingerprint`,
      'fingerprint',
    );
    if (fingerprints.has(fingerprint)) {
      throw new Error(`duplicate repeated failure cluster: ${fingerprint}`);
    }
    fingerprints.add(fingerprint);
    const anchors = evidenceAnchors(
      entry.evidenceAnchors,
      `repeatedFailureClusters[${index}].evidenceAnchors`,
      observations,
    );
    const failures = anchors.map((id) => observations.get(id));
    if (FAILURE_CLUSTER_RULES.anchorsAreMatchingFailuresOnly
        && (failures.length < 2
        || failures.some((observation) =>
          observation.kind !== 'failure' || observation.fingerprint !== fingerprint))) {
      throw new Error(
        `repeated failure cluster ${fingerprint} must contain only matching failures`,
      );
    }
    const affectedWork = stringArray(
      entry.affectedWork,
      `repeatedFailureClusters[${index}].affectedWork`,
      'nonEmptyIdentifierList128',
    ).sort();
    const derivedWork = [...new Set(failures.flatMap((observation) => observation.workIds))].sort();
    if (FAILURE_CLUSTER_RULES.affectedWorkIsFailureWorkUnion
        && !isDeepStrictEqual(affectedWork, derivedWork)) {
      throw new Error(
        `repeated failure cluster ${fingerprint} membership must derive from matching failures`,
      );
    }
    return { fingerprint, affectedWork, evidenceAnchors: anchors };
  });
}

function validateRequiredFailureClusters(findings, audits, clusters) {
  const clusterMap = new Map(clusters.map((cluster) => [cluster.fingerprint, cluster]));
  for (const audit of audits) {
    const rule = CATEGORY_EVIDENCE_RULES[audit.category];
    if (!rule.repeatedFailureClusterRequired) continue;
    const finding = findings.find((entry) => entry.id === audit.findingId);
    const failures = audit.roleMap.get('failures');
    const fingerprints = new Set(failures.map((entry) => entry.fingerprint));
    const fingerprint = fingerprints.size === 1 ? [...fingerprints][0] : null;
    const cluster = fingerprint ? clusterMap.get(fingerprint) : null;
    const failureIds = failures.map((entry) => entry.id).sort();
    if (FAILURE_CLUSTER_RULES.sharedRootClusterMatchesFindingExactly
        && (!cluster
        || !isDeepStrictEqual(cluster.affectedWork, finding.affectedWork)
        || !isDeepStrictEqual(cluster.evidenceAnchors, failureIds))) {
      throw new Error(`finding ${finding.id} requires its exact repeatedFailureCluster`);
    }
  }
}

function matchesCleanContract(report, snapshot) {
  const clean = OUTCOME_RULES.clean;
  return snapshot.observation.completeness === clean.snapshotCompleteness
    && report.findings.length === clean.findingCount
    && report.correction.strategy === clean.strategy
    && report.correction.parentDirectives.length === clean.parentDirectiveCount
    && report.correction.humanDecisions.length === clean.humanDecisionCount;
}

function validateCleanOutcome(report, snapshot) {
  if (report.status === 'clean' && !matchesCleanContract(report, snapshot)) {
    throw new Error('clean outcome violates the canonical clean contract');
  }
}

function validateFindingPresence(report) {
  if (OUTCOME_RULES.statusesRequiringFindings.includes(report.status)
      && report.findings.length === 0) {
    throw new Error(`${report.status} requires at least one evidence-backed finding`);
  }
}

function validateStrategyStatus(report) {
  const statuses = OUTCOME_RULES.strategyStatuses[report.correction.strategy];
  if (statuses && !statuses.includes(report.status)) {
    throw new Error(
      `${report.correction.strategy} requires status ${statuses.join(' or ')}`,
    );
  }
}

function validateHumanDecisionOutcome(report) {
  const rule = OUTCOME_RULES.humanDecisions;
  const namesDecision = report.correction.humanDecisions.length > 0;
  const usesStatus = report.status === rule.status;
  if (rule.nonEmptyIfAndOnlyIfStatus && namesDecision !== usesStatus) {
    throw new Error(`${rule.status} and named human decisions must occur together`);
  }
}

function validateCriticalOutcome(report) {
  const hasCritical = report.findings.some((finding) => finding.severity === 'critical');
  if (hasCritical && !OUTCOME_RULES.criticalFindingStatuses.includes(report.status)) {
    throw new Error('critical finding status is incompatible with the canonical contract');
  }
}

function pausesPrivacyPublication(finding, correction, rule) {
  return correction.parentDirectives.some((directive) =>
    directive.action === rule.parentDirective
    && directive.findingIds.includes(finding.id)
    && finding.affectedWork.every((workId) => directive.targets.includes(workId)));
}

function requestsPrivacyDecision(finding, correction, rule) {
  return correction.humanDecisions.some((decision) =>
    decision.decision === rule.humanDecision
    && decision.findingIds.includes(finding.id));
}

function validatePrivacyOutcome(report) {
  const rule = OUTCOME_RULES.privacyFinding;
  const privacy = report.findings.filter(
    (finding) => finding.category === 'privacy-boundary-breach',
  );
  for (const finding of privacy) {
    if (report.status !== rule.status
        || report.correction.strategy !== rule.strategy
        || !pausesPrivacyPublication(finding, report.correction, rule)
        || !requestsPrivacyDecision(finding, report.correction, rule)) {
      throw new Error(`privacy finding ${finding.id} violates the canonical privacy route`);
    }
  }
}

const OUTCOME_VALIDATORS = Object.freeze([
  validateCleanOutcome,
  validateFindingPresence,
  validateStrategyStatus,
  validateHumanDecisionOutcome,
  validateCriticalOutcome,
  validatePrivacyOutcome,
]);

function enforceOutcome(report, snapshot) {
  for (const validator of OUTCOME_VALIDATORS) validator(report, snapshot);
}

export function normalizeSlopReport(input, sealedSnapshot, specialistPromptBinding) {
  assertSpecialistPromptBinding(specialistPromptBinding);
  const snapshot = assertSlopSnapshot(sealedSnapshot);
  object(input, 'report');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > REPORT_SCHEMA['x-maxUtf8Bytes']) {
    throw new Error(`report exceeds ${REPORT_SCHEMA['x-maxUtf8Bytes']} bytes`);
  }
  onlyKeys(input, new Set(REPORT_OBJECT_KEYS.report), 'report');
  if (input.schemaVersion !== 1) throw new Error('report.schemaVersion must be 1');
  const observations = new Map(snapshot.observations.map((entry) => [entry.id, entry]));
  const findings = normalizeFindings(input.findings, snapshot);
  const audits = normalizeFindingAudits(input.findingAudits, findings, snapshot, observations);
  const clusters = normalizeRepeatedFailures(input.repeatedFailureClusters, observations);
  validateRequiredFailureClusters(findings, audits, clusters);
  const currentWorkInventory = normalizeInventory(input.currentWorkInventory, observations);
  const normalized = {
    schemaVersion: 1,
    snapshot: normalizeSnapshotReference(input.snapshot, snapshot),
    currentWorkInventory,
    findings,
    findingAudits: audits.map(({ roleMap: _roleMap, ...audit }) => audit),
    repeatedFailureClusters: clusters,
    correction: normalizeCorrection(input.correction, findings, currentWorkInventory),
    validationPlan: stringArray(input.validationPlan, 'validationPlan', 'validationPlan'),
    status: enumValue(input.status, STATUSES, 'status'),
  };
  enforceOutcome(normalized, snapshot);
  return normalized;
}

export function assertSlopReport(input, sealedSnapshot, specialistPromptBinding) {
  const normalized = normalizeSlopReport(input, sealedSnapshot, specialistPromptBinding);
  if (!isDeepStrictEqual(input, normalized)) {
    throw new Error('report is not in normalized validated form');
  }
  return input;
}

export const USAGE =
  'Usage: report-contract.mjs --snapshot <absolute-json-path> --report <absolute-json-path> --persona-digest <sha256> --schema-digest <sha256>';

export function run(argv, streams = process) {
  if (argv.length !== 8
      || argv[0] !== '--snapshot'
      || !path.isAbsolute(argv[1])
      || argv[2] !== '--report'
      || !path.isAbsolute(argv[3])
      || argv[4] !== '--persona-digest'
      || argv[6] !== '--schema-digest') {
    throw new Error(USAGE);
  }
  const snapshot = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  const report = JSON.parse(fs.readFileSync(argv[3], 'utf8'));
  const binding = {
    personaSha256: argv[5],
    reportSchemaSha256: argv[7],
  };
  streams.stdout.write(
    `${JSON.stringify(normalizeSlopReport(report, snapshot, binding), null, 2)}\n`,
  );
  return 0;
}

function direct() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (direct()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.code ?? 'invalid-report', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
