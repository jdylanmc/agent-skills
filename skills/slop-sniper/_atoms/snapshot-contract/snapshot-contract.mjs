#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  redactTextWithConfiguredIdentifiers,
} from '../../../_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

export const SNAPSHOT_COVERAGE_AREAS = Object.freeze([
  'human-decisions-and-authority',
  'dependency-frontier',
  'assignments',
  'worker-generations-and-handoffs',
  'branches-and-worktrees',
  'change-requests-and-checks',
  'failure-fingerprints',
  'remediation-and-retries',
  'status-receipts',
  'schedules-and-processes',
  'repository-privacy',
  'created-artifacts',
  'budgets-and-elapsed-time',
]);

export const OBSERVATION_KINDS = Object.freeze([
  'goal',
  'manifest',
  'dependency',
  'issue',
  'assignment',
  'worker',
  'handoff',
  'branch',
  'worktree',
  'change-request',
  'check',
  'failure',
  'retry',
  'status',
  'schedule',
  'process',
  'repository-privacy',
  'artifact',
  'budget',
  'elapsed-time',
  'authority',
  'interruption',
  'claim',
  'file-change',
  'validation',
]);

export const SOURCE_KINDS = Object.freeze([
  'provider',
  'git',
  'filesystem',
  'runtime',
  'human',
  'worker-report',
  'issue',
  'comment',
  'log',
  'status-receipt',
  'schedule',
  'process',
]);

export const WORK_STATES = Object.freeze([
  'active',
  'queued',
  'blocked',
  'terminal',
  'unverified',
]);

export const EVIDENCE_ASSERTIONS = Object.freeze([
  'independent-branch',
  'related-branch',
  'changed-path',
  'shared-component-owner',
  'local-component-owner',
  'repeated-failure',
  'investigation-active',
  'implementation-active',
  'assignment-active',
  'work-terminal',
  'readiness-claim',
  'readiness-contradiction',
  'retry-unchanged',
  'observed-work',
  'goal-boundary',
  'goal-mismatch',
  'shared-abstraction',
  'second-consumer-absent',
  'optimization-change',
  'measured-baseline-absent',
  'bottleneck-absent',
  'target-absent',
  'authority-boundary',
  'authority-exceeded',
  'routine-engineering-question',
  'parent-authority',
  'mutation-owner-active',
  'state-claim',
  'state-contradiction',
  'verification-claim',
  'incomplete-evidence',
  'privacy-boundary',
  'cross-boundary-publication',
  'context-transition',
  'handoff-state-missing',
  'work-active',
  'execution-bound-missing',
  'worker-active',
  'worker-terminal',
  'branch-active',
  'branch-terminal',
  'change-request-active',
  'change-request-terminal',
  'schedule-active',
  'schedule-terminal',
]);

const AREA_EVIDENCE = new Map([
  ['human-decisions-and-authority', {
    kinds: ['goal', 'manifest', 'authority', 'interruption'],
    sources: ['human', 'issue', 'comment'],
  }],
  ['dependency-frontier', {
    kinds: ['manifest', 'dependency', 'issue', 'status'],
    sources: ['issue', 'provider', 'status-receipt'],
  }],
  ['assignments', {
    kinds: ['assignment', 'status'],
    sources: ['worker-report', 'runtime', 'status-receipt'],
  }],
  ['worker-generations-and-handoffs', {
    kinds: ['assignment', 'worker', 'handoff', 'status'],
    sources: ['worker-report', 'runtime', 'provider', 'status-receipt'],
  }],
  ['branches-and-worktrees', {
    kinds: ['branch', 'worktree', 'file-change', 'status'],
    sources: ['git', 'filesystem'],
  }],
  ['change-requests-and-checks', {
    kinds: ['change-request', 'check', 'claim', 'status'],
    sources: ['provider', 'runtime', 'worker-report', 'status-receipt'],
  }],
  ['failure-fingerprints', {
    kinds: ['failure', 'validation', 'check'],
    sources: ['runtime', 'log', 'status-receipt'],
  }],
  ['remediation-and-retries', {
    kinds: ['retry', 'status'],
    sources: ['runtime', 'log', 'worker-report', 'status-receipt'],
  }],
  ['status-receipts', {
    kinds: ['claim', 'status'],
    sources: ['provider', 'runtime', 'worker-report', 'status-receipt'],
  }],
  ['schedules-and-processes', {
    kinds: ['schedule', 'process', 'status'],
    sources: ['schedule', 'process', 'runtime', 'status-receipt'],
  }],
  ['repository-privacy', {
    kinds: ['repository-privacy', 'artifact', 'authority'],
    sources: ['provider', 'filesystem', 'human'],
  }],
  ['created-artifacts', {
    kinds: ['artifact', 'file-change', 'change-request'],
    sources: ['filesystem', 'git', 'provider'],
  }],
  ['budgets-and-elapsed-time', {
    kinds: ['budget', 'elapsed-time', 'status'],
    sources: ['runtime', 'log', 'status-receipt'],
  }],
]);

const OBSERVATION_COMPLETENESS = new Set(['complete', 'partial']);
const COVERAGE_STATUSES = new Set(['complete', 'partial', 'unavailable']);
const VISIBILITY = new Set(['public', 'private', 'internal']);
const SENSITIVITY = new Set(['public', 'private', 'restricted', 'unknown']);
const FINGERPRINTED_OBSERVATION_KINDS = new Set(['failure', 'retry']);
const EVIDENCE_ASSERTION_SET = new Set(EVIDENCE_ASSERTIONS);
const WORK_STATE_SET = new Set(WORK_STATES);
const WORK_KINDS = new Set([
  'issue',
  'assignment',
  'branch',
  'worktree',
  'change-request',
  'schedule',
  'process',
  'artifact',
]);
const MAX_SNAPSHOT_BYTES = 1024 * 1024;
const MAX_OBSERVATIONS = 1000;
const ZONED_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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

function string(value, field, maximum = 2048) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new Error(`${field} exceeds ${maximum} characters`);
  }
  if (redactTextWithConfiguredIdentifiers(normalized).text !== normalized) {
    throw new Error(`${field} contains sensitive content; use a redacted identifier or summary`);
  }
  return normalized;
}

function optionalString(value, field, maximum = 2048) {
  return value === undefined || value === null ? null : string(value, field, maximum);
}

function timestampComponents(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  return match.slice(1).map(Number);
}

function timestampOffset(value) {
  const match = /([+-])(\d{2}):(\d{2})$/.exec(value);
  return match ? match.slice(2).map(Number) : null;
}

function inRange(value, minimum, maximum) {
  return value >= minimum && value <= maximum;
}

function isRealCalendarInstant([year, month, day, hour, minute, second]) {
  if (!inRange(month, 1, 12)) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return [
    [day, 1, daysInMonth],
    [hour, 0, 23],
    [minute, 0, 59],
    [second, 0, 59],
  ].every(([value, minimum, maximum]) => inRange(value, minimum, maximum));
}

function isValidOffset(offset) {
  return offset === null || (offset[0] <= 23 && offset[1] <= 59);
}

function timestamp(value, field) {
  const normalized = string(value, field, 128);
  if (!ZONED_TIMESTAMP_PATTERN.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    throw new Error(`${field} must be a valid ISO-8601 timestamp with Z or a numeric offset`);
  }
  if (!isRealCalendarInstant(timestampComponents(normalized))
      || !isValidOffset(timestampOffset(normalized))) {
    throw new Error(`${field} must name a real calendar instant`);
  }
  return normalized;
}

function enumValue(value, allowed, field) {
  const normalized = string(value, field, 128);
  if (!allowed.has(normalized)) {
    throw new Error(`${field} has unsupported value: ${normalized}`);
  }
  return normalized;
}

function optionalEnum(value, allowed, field) {
  return value === undefined || value === null ? null : enumValue(value, allowed, field);
}

function stringArray(value, field, maximum = 256) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > maximum) throw new Error(`${field} exceeds ${maximum} entries`);
  const normalized = value.map((entry, index) => string(entry, `${field}[${index}]`, 512));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${field} contains duplicate values`);
  }
  return normalized;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function snapshotDigest(snapshot) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(snapshot))).digest('hex');
}

function normalizeGoal(input) {
  const goal = object(input, 'goal');
  onlyKeys(goal, new Set(['id', 'revision', 'statement']), 'goal');
  return {
    id: string(goal.id, 'goal.id', 256),
    revision: string(goal.revision, 'goal.revision', 256),
    statement: string(goal.statement, 'goal.statement', 4096),
  };
}

function normalizeManifest(input) {
  const manifest = object(input, 'manifest');
  onlyKeys(manifest, new Set(['revision', 'approvedWork', 'exclusions']), 'manifest');
  if (!Array.isArray(manifest.approvedWork) || manifest.approvedWork.length > 256) {
    throw new Error('manifest.approvedWork must be an array of at most 256 entries');
  }
  const ids = new Set();
  const approvedWork = manifest.approvedWork.map((entry, index) => {
    object(entry, `manifest.approvedWork[${index}]`);
    onlyKeys(entry, new Set(['id', 'kind', 'owner']), `manifest.approvedWork[${index}]`);
    const id = string(entry.id, `manifest.approvedWork[${index}].id`, 256);
    if (ids.has(id)) throw new Error(`duplicate approved work id: ${id}`);
    ids.add(id);
    return {
      id,
      kind: enumValue(entry.kind, WORK_KINDS, `manifest.approvedWork[${index}].kind`),
      owner: optionalString(entry.owner, `manifest.approvedWork[${index}].owner`, 256),
    };
  });
  return {
    revision: string(manifest.revision, 'manifest.revision', 256),
    approvedWork,
    exclusions: stringArray(manifest.exclusions, 'manifest.exclusions', 128),
  };
}

function normalizeFleet(input) {
  const fleet = object(input, 'fleet');
  onlyKeys(fleet, new Set(['revision']), 'fleet');
  return { revision: string(fleet.revision, 'fleet.revision', 256) };
}

function normalizeRepository(input) {
  const repository = object(input, 'repository');
  onlyKeys(repository, new Set(['id', 'revision', 'visibility']), 'repository');
  return {
    id: string(repository.id, 'repository.id', 512),
    revision: string(repository.revision, 'repository.revision', 256),
    visibility: enumValue(repository.visibility, VISIBILITY, 'repository.visibility'),
  };
}

function normalizeObservationBoundary(input) {
  const observation = object(input, 'observation');
  onlyKeys(
    observation,
    new Set(['observedAt', 'completeness', 'priorSnapshotId']),
    'observation',
  );
  return {
    observedAt: timestamp(observation.observedAt, 'observation.observedAt'),
    completeness: enumValue(
      observation.completeness,
      new Set(['complete', 'partial']),
      'observation.completeness',
    ),
    priorSnapshotId: optionalString(
      observation.priorSnapshotId,
      'observation.priorSnapshotId',
      256,
    ),
  };
}

function normalizeObservationFingerprint(entry, index, kind) {
  const field = `observations[${index}].fingerprint`;
  const fingerprint = optionalString(entry.fingerprint, field, 512);
  if (FINGERPRINTED_OBSERVATION_KINDS.has(kind) && fingerprint === null) {
    throw new Error(`${field} is required for ${kind} observations`);
  }
  return fingerprint;
}

function optionalTimestamp(value, field) {
  return value === undefined || value === null ? null : timestamp(value, field);
}

function requireActivityStart(activeFrom, activeUntil, index) {
  if (activeUntil !== null && activeFrom === null) {
    throw new Error(`observations[${index}].activeUntil requires activeFrom`);
  }
}

function rejectFutureActivity(value, observedAt, field) {
  if (value !== null && Date.parse(value) > Date.parse(observedAt)) {
    throw new Error(`${field} is later than its observation`);
  }
}

function rejectInvertedActivity(activeFrom, activeUntil, index) {
  if (activeUntil !== null && Date.parse(activeFrom) > Date.parse(activeUntil)) {
    throw new Error(`observations[${index}] has an inverted activity interval`);
  }
}

function normalizeActivityInterval(entry, index, observedAt) {
  const activeFrom = optionalTimestamp(
    entry.activeFrom,
    `observations[${index}].activeFrom`,
  );
  const activeUntil = optionalTimestamp(
    entry.activeUntil,
    `observations[${index}].activeUntil`,
  );
  requireActivityStart(activeFrom, activeUntil, index);
  rejectFutureActivity(activeFrom, observedAt, `observations[${index}].activeFrom`);
  rejectFutureActivity(activeUntil, observedAt, `observations[${index}].activeUntil`);
  rejectInvertedActivity(activeFrom, activeUntil, index);
  return { activeFrom, activeUntil };
}

function normalizeObservations(input, observedAt) {
  if (!Array.isArray(input) || input.length > MAX_OBSERVATIONS) {
    throw new Error(`observations must be an array of at most ${MAX_OBSERVATIONS} entries`);
  }
  const ids = new Set();
  return input.map((entry, index) => {
    object(entry, `observations[${index}]`);
    onlyKeys(entry, new Set([
      'id',
      'area',
      'kind',
      'sourceKind',
      'observedAt',
      'completeness',
      'subject',
      'workIds',
      'revision',
      'baseRevision',
      'fingerprint',
      'state',
      'assertion',
      'activeFrom',
      'activeUntil',
      'hypothesis',
      'scope',
      'validationPurpose',
      'statement',
      'locator',
      'sensitivity',
    ]), `observations[${index}]`);
    const id = string(entry.id, `observations[${index}].id`, 256);
    if (ids.has(id)) throw new Error(`duplicate observation id: ${id}`);
    ids.add(id);
    const entryObservedAt = timestamp(entry.observedAt, `observations[${index}].observedAt`);
    if (Date.parse(entryObservedAt) > Date.parse(observedAt)) {
      throw new Error(`observation ${id} is later than the snapshot observation time`);
    }
    const kind = enumValue(
      entry.kind,
      new Set(OBSERVATION_KINDS),
      `observations[${index}].kind`,
    );
    const activity = normalizeActivityInterval(entry, index, entryObservedAt);
    const state = optionalEnum(
      entry.state,
      WORK_STATE_SET,
      `observations[${index}].state`,
    );
    if (state === 'active' && activity.activeUntil !== null) {
      throw new Error(`observations[${index}] cannot be active after its activity ended`);
    }
    return {
      id,
      area: enumValue(
        entry.area,
        new Set(SNAPSHOT_COVERAGE_AREAS),
        `observations[${index}].area`,
      ),
      kind,
      sourceKind: enumValue(
        entry.sourceKind,
        new Set(SOURCE_KINDS),
        `observations[${index}].sourceKind`,
      ),
      observedAt: entryObservedAt,
      completeness: enumValue(
        entry.completeness,
        OBSERVATION_COMPLETENESS,
        `observations[${index}].completeness`,
      ),
      subject: string(entry.subject, `observations[${index}].subject`, 512),
      workIds: stringArray(entry.workIds, `observations[${index}].workIds`, 32),
      revision: optionalString(entry.revision, `observations[${index}].revision`, 256),
      baseRevision: optionalString(
        entry.baseRevision,
        `observations[${index}].baseRevision`,
        256,
      ),
      fingerprint: normalizeObservationFingerprint(entry, index, kind),
      state,
      assertion: optionalEnum(
        entry.assertion,
        EVIDENCE_ASSERTION_SET,
        `observations[${index}].assertion`,
      ),
      ...activity,
      hypothesis: optionalString(
        entry.hypothesis,
        `observations[${index}].hypothesis`,
        1024,
      ),
      scope: optionalString(entry.scope, `observations[${index}].scope`, 1024),
      validationPurpose: optionalString(
        entry.validationPurpose,
        `observations[${index}].validationPurpose`,
        1024,
      ),
      statement: string(entry.statement, `observations[${index}].statement`, 4096),
      locator: string(entry.locator, `observations[${index}].locator`, 1024),
      sensitivity: enumValue(
        entry.sensitivity,
        SENSITIVITY,
        `observations[${index}].sensitivity`,
      ),
    };
  });
}

function validateCoverageSource(sourceId, area, status, observationMap) {
  const source = observationMap.get(sourceId);
  if (!source) throw new Error(`coverage ${area} names unknown source: ${sourceId}`);
  if (source.area !== area) {
    throw new Error(`coverage ${area} cites observation ${sourceId} bound to ${source.area}`);
  }
  const compatible = AREA_EVIDENCE.get(area);
  if (!compatible.kinds.includes(source.kind) || !compatible.sources.includes(source.sourceKind)) {
    throw new Error(`observation ${sourceId} is incompatible with coverage ${area}`);
  }
  if (status === 'complete' && source.completeness !== 'complete') {
    throw new Error(`coverage ${area} is complete but source ${sourceId} is not complete`);
  }
}

function validateCoverageSourceCount(area, status, sourceIds) {
  if (status === 'unavailable' && sourceIds.length !== 0) {
    throw new Error(`coverage ${area} is unavailable but names sources`);
  }
  if (status !== 'unavailable' && sourceIds.length === 0) {
    throw new Error(`coverage ${area} must name at least one source`);
  }
}

function coverageArea(entry, index) {
  const field = `coverage[${index}]`;
  object(entry, field);
  onlyKeys(entry, new Set(['area', 'status', 'sourceIds']), field);
  return enumValue(entry.area, new Set(SNAPSHOT_COVERAGE_AREAS), `${field}.area`);
}

function normalizeCoverageEntry(entry, index, area, observationMap, covered) {
  const field = `coverage[${index}]`;
  const status = enumValue(entry.status, COVERAGE_STATUSES, `${field}.status`);
  const sourceIds = stringArray(entry.sourceIds, `${field}.sourceIds`, 128).sort();
  validateCoverageSourceCount(area, status, sourceIds);
  for (const sourceId of sourceIds) {
    validateCoverageSource(sourceId, area, status, observationMap);
    covered.add(sourceId);
  }
  return { area, status, sourceIds };
}

function assertCoverageComplete(observations, covered) {
  const uncovered = observations.filter((entry) => !covered.has(entry.id)).map((entry) => entry.id);
  if (uncovered.length) {
    throw new Error(`observations are outside declared coverage: ${uncovered.join(', ')}`);
  }
}

function normalizeCoverage(input, observations) {
  if (!Array.isArray(input) || input.length !== SNAPSHOT_COVERAGE_AREAS.length) {
    throw new Error(`coverage must declare exactly ${SNAPSHOT_COVERAGE_AREAS.length} areas`);
  }
  const observationMap = new Map(observations.map((entry) => [entry.id, entry]));
  const covered = new Set();
  const byArea = new Map();
  for (const [index, entry] of input.entries()) {
    const area = coverageArea(entry, index);
    if (byArea.has(area)) {
      throw new Error(`duplicate coverage area: ${area}`);
    }
    const normalized = normalizeCoverageEntry(entry, index, area, observationMap, covered);
    byArea.set(normalized.area, normalized);
  }
  assertCoverageComplete(observations, covered);
  return SNAPSHOT_COVERAGE_AREAS.map((area) => byArea.get(area));
}

export function normalizeSlopSnapshot(input) {
  object(input, 'snapshot');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error(`snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes`);
  }
  onlyKeys(input, new Set([
    'schemaVersion',
    'snapshotId',
    'goal',
    'manifest',
    'fleet',
    'repository',
    'observation',
    'coverage',
    'observations',
    'bindingDigest',
  ]), 'snapshot');
  if (input.schemaVersion !== 1) throw new Error('snapshot.schemaVersion must be 1');

  const observation = normalizeObservationBoundary(input.observation);
  const observations = normalizeObservations(input.observations, observation.observedAt);
  const coverage = normalizeCoverage(input.coverage, observations);
  const derivedCompleteness = coverage.every((entry) => entry.status === 'complete')
    ? 'complete'
    : 'partial';
  if (observation.completeness !== derivedCompleteness) {
    throw new Error(`observation.completeness must be ${derivedCompleteness}`);
  }

  const normalized = {
    schemaVersion: 1,
    snapshotId: string(input.snapshotId, 'snapshotId', 256),
    goal: normalizeGoal(input.goal),
    manifest: normalizeManifest(input.manifest),
    fleet: normalizeFleet(input.fleet),
    repository: normalizeRepository(input.repository),
    observation,
    coverage,
    observations,
  };
  const bindingDigest = snapshotDigest(normalized);
  if (input.bindingDigest !== undefined && input.bindingDigest !== bindingDigest) {
    throw new Error('snapshot bindingDigest does not match the bounded snapshot');
  }
  return { ...normalized, bindingDigest };
}

export function assertSlopSnapshot(input) {
  if (typeof input?.bindingDigest !== 'string') {
    throw new Error('sealed snapshot requires bindingDigest');
  }
  const normalized = normalizeSlopSnapshot(input);
  if (!isDeepStrictEqual(input, normalized)) {
    throw new Error('snapshot is not in normalized sealed form');
  }
  return input;
}

export const USAGE = 'Usage: snapshot-contract.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new Error(USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  streams.stdout.write(`${JSON.stringify(normalizeSlopSnapshot(input), null, 2)}\n`);
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
      error: { code: 'invalid-snapshot', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
