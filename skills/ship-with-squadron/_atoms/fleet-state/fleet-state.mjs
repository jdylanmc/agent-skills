import fs from 'node:fs';
import path from 'node:path';

import { validateSourceRevisionReceipt } from '../fleet-manifest/fleet-manifest.mjs';
import {
  adaptBlastRadiusEvidence,
  adaptCiEvidence,
  adaptRoastEvidence,
  deliveryStagesForManifest,
} from '../quality-evidence/quality-evidence.mjs';
import { publicationKey } from '../provider-seam/provider-seam.mjs';

export const FLEET_STATE_SCHEMA_VERSION = 1;
const ISSUE_STATUSES = new Set(['pending', 'active', 'completed', 'failed', 'deferred']);
const ISSUE_DISPOSITIONS = new Set([
  'ready-for-human-merge',
  'blocked',
  'failed',
  'timed-out-with-handoff',
  'deferred',
  'not-reached',
  'already-complete',
]);
const TERMINAL_TRANSITIONS = new Map([
  ['pending', new Set(['completed', 'failed', 'deferred'])],
  ['active', new Set(['completed', 'failed', 'deferred'])],
  ['completed', new Set()],
  ['failed', new Set()],
  ['deferred', new Set()],
]);
const PUBLICATION_STATES = new Set(['intent-recorded', 'retryable-degraded', 'confirmed']);
const DEPENDENCY_STATES = new Set(['unclassified', 'ready', 'blocked', 'active']);
const HANDOFF_REASONS = new Set(['stalled', 'exhausted', 'timed-out', 'crashed']);
const FORBIDDEN_AUTHORITIES = [
  'merge', 'approve', 'enable-auto-merge', 'accept-risk', 'force-push',
  'close-tracker-work', 'select-adjacent-work',
];

function validRunId(runId) {
  return typeof runId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validTimestamp(value) {
  return nonEmpty(value) && Number.isFinite(Date.parse(value));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactKeys(actual, expected, label) {
  const left = Object.keys(actual ?? {}).sort();
  const right = [...expected].sort();
  if (!same(left, right)) {
    throw new Error(`${label} keys differ: expected ${right.join(', ')}, received ${left.join(', ')}`);
  }
}

function assignmentList(state) {
  return Object.values(state.issues).flatMap((issue) => [
    ...(issue.assignment ? [issue.assignment] : []),
    ...issue.continuationChain,
  ]);
}

function assertAssignment(assignment, issue, manifest, { active }) {
  if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
    throw new Error(`${issue} assignment must be an object`);
  }
  for (const field of ['generation', 'workerContext', 'branch', 'worktree', 'startedAt']) {
    if (field === 'generation') {
      if (!Number.isInteger(assignment[field]) || assignment[field] < 1) {
        throw new Error(`${issue.identity} assignment generation is invalid`);
      }
    } else if (!nonEmpty(assignment[field])) {
      throw new Error(`${issue.identity} assignment ${field} is invalid`);
    }
  }
  if (assignment.active !== active) throw new Error(`${issue.identity} assignment active flag is inconsistent`);
  if (!validTimestamp(assignment.startedAt)) throw new Error(`${issue.identity} assignment startedAt is invalid`);
  if (!nonEmpty(assignment.baseSha) || !nonEmpty(assignment.headSha)) {
    throw new Error(`${issue.identity} assignment requires exact base and head revisions`);
  }
  const packet = assignment.packet;
  if (!packet || typeof packet !== 'object'
      || packet.manifestDigest !== manifest.digest
      || packet.issue !== issue.identity
      || packet.sourceRevision !== issue.sourceRevision
      || !same(packet.acceptanceCriteria, issue.acceptanceCriteria)
      || !same(packet.scope, issue.scope)
      || !same(packet.exclusions, manifest.exclusions)
      || !same(packet.allowedPaths, issue.allowedPaths)
      || !same(packet.forbiddenAuthorities, FORBIDDEN_AUTHORITIES)
      || packet.branch !== assignment.branch
      || packet.worktree !== assignment.worktree
      || !Array.isArray(packet.verification)
      || packet.verification.length === 0
      || !packet.reportContract
      || !nonEmpty(packet.reportContract.summary)
      || !Array.isArray(packet.reportContract.requiredEvidence)
      || packet.reportContract.requiredEvidence.length === 0) {
    throw new Error(`${issue.identity} assignment packet is absent or not manifest-bound`);
  }
  if (!active) {
    if (!HANDOFF_REASONS.has(assignment.endReason) && !['completed', 'failed', 'deferred'].includes(assignment.endReason)) {
      throw new Error(`${issue.identity} inactive assignment requires a valid end reason`);
    }
    if (!validTimestamp(assignment.endedAt)) throw new Error(`${issue.identity} inactive assignment endedAt is invalid`);
  }
}

function assertPublication(entry, manifest, state) {
  if (!entry || typeof entry !== 'object' || !nonEmpty(entry.key)) {
    throw new Error('publication entry is malformed');
  }
  exactKeys(entry, [
    'manifestDigest', 'providerConfigurationDigest', 'provider', 'repository',
    'issue', 'sourceRevision', 'headBranch', 'baseBranch', 'baseSha', 'headSha',
    'key', 'state', 'attempts', 'identifier', 'intentAt', 'confirmedAt',
  ], `publication ${entry.key}`);
  if (!PUBLICATION_STATES.has(entry.state)) throw new Error(`publication ${entry.key} has invalid state`);
  if (entry.manifestDigest !== manifest.digest
      || entry.providerConfigurationDigest !== manifest.providerConfigurationDigest
      || entry.provider !== manifest.provider.name
      || entry.repository !== manifest.repository.id
      || entry.baseBranch !== manifest.repository.baseBranch) {
    throw new Error(`publication ${entry.key} is not bound to persisted manifest authority`);
  }
  const issue = state.issues[entry.issue];
  if (!issue) throw new Error(`publication ${entry.key} names an unknown issue`);
  if (!nonEmpty(entry.headBranch) || !nonEmpty(entry.headSha) || !validTimestamp(entry.intentAt)) {
    throw new Error(`publication ${entry.key} has incomplete identity`);
  }
  if (entry.key !== publicationKey(entry)) throw new Error(`publication ${entry.key} has forged stable key`);
  if (!Array.isArray(entry.attempts)) throw new Error(`publication ${entry.key} attempts are invalid`);
  for (const attempt of entry.attempts) {
    if (!nonEmpty(attempt?.invocationId)
        || !nonEmpty(attempt?.status)
        || !validTimestamp(attempt?.observedAt)) {
      throw new Error(`publication ${entry.key} contains malformed attempt evidence`);
    }
  }
  if (entry.state === 'confirmed') {
    if (!nonEmpty(entry.identifier) || !validTimestamp(entry.confirmedAt)) {
      throw new Error(`publication ${entry.key} is not confirmed by provider identity`);
    }
  } else if (entry.identifier !== null || entry.confirmedAt !== null) {
    throw new Error(`publication ${entry.key} forges confirmation fields`);
  }
}

function assertShepherd(issue, manifest) {
  if (issue.shepherd === null) return;
  const shepherd = issue.shepherd;
  if (!shepherd || typeof shepherd !== 'object') {
    throw new Error(`${issue.identity} shepherd state is malformed`);
  }
  if (shepherd.accepted !== true) {
    if (shepherd.accepted !== false || shepherd.ready !== false || shepherd.freshness !== 'stale') {
      throw new Error(`${issue.identity} unaccepted Shepherd state is not an explicit expiry`);
    }
    return;
  }
  if (!issue.changeRequest) throw new Error(`${issue.identity} shepherd state lacks a change request`);
  const receipt = shepherd.receipt;
  const obligation = shepherd.setObligation;
  if (!receipt || receipt.provider !== manifest.provider.name
      || receipt.changeRequest !== issue.changeRequest.identifier
      || receipt.headSha !== issue.headSha
      || receipt.complete !== true
      || !validTimestamp(receipt.observedAt)) {
    throw new Error(`${issue.identity} shepherd receipt is not exactly bound`);
  }
  if (!obligation
      || obligation.owner !== issue.identity
      || obligation.changeRequest !== issue.changeRequest.identifier
      || obligation.baseBranch !== manifest.repository.baseBranch
      || obligation.baseSha !== receipt.baseSha
      || obligation.headSha !== receipt.headSha
      || obligation.expiresWhen !== 'sibling-merge-into-base'
      || obligation.reinvocation !== 'invoke-fresh-shepherd'
      || !Number.isInteger(obligation.generation)
      || obligation.generation < 1
      || !validTimestamp(obligation.createdAt)) {
    throw new Error(`${issue.identity} shepherd set obligation is incomplete or forged`);
  }
}

function assertPipeline(record, manifest, state) {
  const stages = deliveryStagesForManifest(manifest);
  if (record.pipeline.length > stages.length) throw new Error(`${record.identity} pipeline is too long`);
  for (const [index, entry] of record.pipeline.entries()) {
    if (!entry || entry.stage !== stages[index] || !entry.evidence) {
      throw new Error(`${record.identity} pipeline order or evidence is invalid`);
    }
    const evidenceBase = entry.stage === 'shepherd'
      ? record.shepherd?.receipt?.baseSha
      : record.baseSha;
    const evidenceHead = entry.stage === 'shepherd'
      ? record.shepherd?.receipt?.headSha
      : record.headSha;
    if (entry.evidence.baseSha !== evidenceBase || entry.evidence.headSha !== evidenceHead) {
      throw new Error(`${record.identity} pipeline evidence is stale`);
    }
    const identity = { runId: state.runId, issue: record.identity };
    if (entry.stage === 'run-ci' && !adaptCiEvidence(entry.evidence, record, identity).valid) {
      throw new Error(`${record.identity} contains forged run-ci evidence`);
    }
    if (entry.stage === 'roast' && !adaptRoastEvidence(entry.evidence, record, identity).valid) {
      throw new Error(`${record.identity} contains forged Roast evidence`);
    }
    if (entry.stage === 'blast-radius-proof'
        && !adaptBlastRadiusEvidence(entry.evidence, record, identity).valid) {
      throw new Error(`${record.identity} contains forged blast-radius evidence`);
    }
    if (entry.stage === 'criterion-verdict') {
      const verdicts = entry.evidence.verdicts;
      if (!Array.isArray(verdicts) || verdicts.length !== record.acceptanceCriteria.length) {
        throw new Error(`${record.identity} criterion verdict set is incomplete`);
      }
      const expected = new Set(record.acceptanceCriteria.map((criterion) => criterion.id));
      const seen = new Set();
      for (const verdict of verdicts) {
        if (!expected.has(verdict?.id) || seen.has(verdict?.id)) {
          throw new Error(`${record.identity} criterion verdict identity is invalid`);
        }
        seen.add(verdict.id);
        if (verdict.verdict === 'satisfied') {
          if (verdict.evidence?.complete !== true
              || verdict.evidence.baseSha !== record.baseSha
              || verdict.evidence.headSha !== record.headSha
              || !nonEmpty(verdict.evidence.summary)) {
            throw new Error(`${record.identity} criterion ${verdict.id} is unproven`);
          }
        } else if (verdict.verdict === 'descoped-by-human') {
          const receipt = verdict.decisionReceipt;
          if (!receipt
              || receipt.criterionId !== verdict.id
              || receipt.manifestDigest !== manifest.digest
              || receipt.sourceRevision !== record.sourceRevision
              || receipt.decision !== 'descoped'
              || receipt.actorType !== 'human'
              || !nonEmpty(receipt.decisionId)
              || !validTimestamp(receipt.decidedAt)) {
            throw new Error(`${record.identity} criterion ${verdict.id} lacks a valid human decision receipt`);
          }
        } else {
          throw new Error(`${record.identity} criterion ${verdict.id} has invalid verdict`);
        }
      }
    }
    if (entry.stage === 'publication') {
      if (!record.changeRequest
          || entry.evidence.changeRequest !== record.changeRequest.identifier
          || entry.evidence.publicationKey !== record.changeRequest.publicationKey) {
        throw new Error(`${record.identity} publication stage is not reconciled`);
      }
    }
    if (entry.stage === 'shepherd' && record.shepherd?.accepted !== true) {
      throw new Error(`${record.identity} Shepherd stage lacks an accepted receipt`);
    }
  }
}

function assertIssueRecord(record, issue, manifest, state) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`fleet state issue ${issue.identity} must be an object`);
  }
  exactKeys(record, [
    'identity', 'sourceRevision', 'sourceReceipt', 'sourceObservation',
    'dependencyState', 'acceptanceCriteria', 'assignment', 'continuationChain',
    'branch', 'worktree', 'baseSha', 'headSha', 'status', 'statusReason', 'implementationStatus',
    'qualityEvidence', 'pipeline', 'changeRequest', 'shepherd',
    'shepherdDecision', 'setObligation', 'terminalDisposition', 'nextAction',
  ], `fleet state issue ${issue.identity}`);
  if (record.identity !== issue.identity) throw new Error(`identity mismatch for ${issue.identity}`);
  if (record.sourceRevision !== issue.sourceRevision) {
    throw new Error(`source revision mismatch for ${issue.identity}`);
  }
  if (!same(record.sourceReceipt, issue.sourceReceipt)) {
    throw new Error(`source receipt mismatch for ${issue.identity}`);
  }
  if (!same(record.acceptanceCriteria, issue.acceptanceCriteria)) {
    throw new Error(`acceptance criteria mismatch for ${issue.identity}`);
  }
  if (!ISSUE_STATUSES.has(record.status)) throw new Error(`invalid status for ${issue.identity}`);
  if (!DEPENDENCY_STATES.has(record.dependencyState)) {
    throw new Error(`invalid dependency state for ${issue.identity}`);
  }
  if (!Array.isArray(record.continuationChain)
      || !Array.isArray(record.pipeline)
      || !record.qualityEvidence
      || typeof record.qualityEvidence !== 'object'
      || Array.isArray(record.qualityEvidence)) {
    throw new Error(`invalid evidence or continuation shape for ${issue.identity}`);
  }
  assertPipeline(record, manifest, state);
  if (record.sourceObservation !== null) {
    const source = validateSourceRevisionReceipt(record.sourceObservation, manifest, issue.identity);
    if (record.sourceObservation.manifestDigest !== manifest.digest
        || !validTimestamp(record.sourceObservation.reobservedAt)
        || !same(source, {
          invocation: record.sourceObservation.invocation,
          provider: record.sourceObservation.provider,
          repository: record.sourceObservation.repository,
          issue: record.sourceObservation.issue,
          revision: record.sourceObservation.revision,
          status: record.sourceObservation.status,
          terminal: record.sourceObservation.terminal,
          complete: record.sourceObservation.complete,
          observedAt: record.sourceObservation.observedAt,
        })) {
      throw new Error(`source observation is not current for ${issue.identity}`);
    }
  }
  if (record.status === 'active') {
    assertAssignment(record.assignment, issue, manifest, { active: true });
    if (record.assignment.branch !== record.branch
        || record.assignment.worktree !== record.worktree
        || record.assignment.baseSha !== record.baseSha
        || record.assignment.headSha !== record.headSha) {
      throw new Error(`${issue.identity} active assignment revision differs from issue record`);
    }
  } else if (record.assignment !== null) {
    throw new Error(`${issue.identity} has mutable ownership while status is ${record.status}`);
  }
  if ((record.branch === null) !== (record.worktree === null)) {
    throw new Error(`${issue.identity} branch/worktree persistence is inconsistent`);
  }
  for (const prior of record.continuationChain) {
    assertAssignment(prior, issue, manifest, { active: false });
  }
  const generations = record.continuationChain.map((entry) => entry.generation);
  if (record.assignment) generations.push(record.assignment.generation);
  if (new Set(generations).size !== generations.length) {
    throw new Error(`${issue.identity} has duplicate assignment generations`);
  }
  if (record.terminalDisposition !== null && !ISSUE_DISPOSITIONS.has(record.terminalDisposition)) {
    throw new Error(`${issue.identity} has invalid terminal disposition`);
  }
  if (record.status === 'completed' && record.terminalDisposition === null) {
    throw new Error(`${issue.identity} completed without terminal disposition`);
  }
  if (record.status === 'failed' && record.terminalDisposition !== 'failed') {
    throw new Error(`${issue.identity} failed status must carry failed disposition`);
  }
  if (record.status === 'deferred' && record.terminalDisposition !== 'deferred') {
    throw new Error(`${issue.identity} deferred status must carry deferred disposition`);
  }
  if (record.changeRequest !== null) {
    const publication = state.publications.find((entry) =>
      entry.state === 'confirmed'
      && entry.issue === issue.identity
      && entry.identifier === record.changeRequest.identifier);
    if (!publication
        || record.changeRequest.provider !== manifest.provider.name
        || record.changeRequest.repository !== manifest.repository.id
        || record.changeRequest.baseBranch !== manifest.repository.baseBranch
        || record.changeRequest.headSha !== record.headSha) {
      throw new Error(`${issue.identity} change request is not reconciled to confirmed publication`);
    }
  }
  assertShepherd(record, manifest);
  if (record.shepherd && !same(record.setObligation, record.shepherd.setObligation)) {
    throw new Error(`${issue.identity} set obligation differs from accepted Shepherd state`);
  }
  if (record.shepherdDecision !== null) {
    if (manifest.shepherdIntent !== 'no'
        || record.shepherdDecision.state !== 'not-required'
        || record.shepherdDecision.manifestDigest !== manifest.digest
        || !record.setObligation
        || record.setObligation.owner !== issue.identity
        || record.setObligation.changeRequest !== record.changeRequest?.identifier
        || record.setObligation.baseSha !== record.baseSha
        || record.setObligation.headSha !== record.headSha
        || record.setObligation.expiresWhen !== 'sibling-merge-into-base'
        || record.setObligation.reinvocation !== 'rerun-quality-and-provider-observation') {
      throw new Error(`${issue.identity} has forged Shepherd-not-required state`);
    }
  } else if (!record.shepherd && record.setObligation !== null) {
    throw new Error(`${issue.identity} has an obligation without an accepted readiness state`);
  }
}

export function fleetStatePath(repositoryRoot, runId) {
  if (!path.isAbsolute(repositoryRoot)) throw new Error('repositoryRoot must be absolute');
  if (!validRunId(runId)) throw new Error('runId must be path-safe');
  return path.join(repositoryRoot, '.ship-with-squadron', runId, 'fleet-state.json');
}

export function createFleetState(manifest, runId, now = new Date().toISOString()) {
  if (!validRunId(runId)) throw new Error('runId must be path-safe');
  if (!validTimestamp(now)) throw new Error('state creation time is invalid');
  const exhaustedFields = ['cost', 'timeMinutes', 'retries']
    .filter((field) => 0 >= manifest.budget[field]);
  const issues = Object.fromEntries(manifest.issues.map((issue) => [issue.identity, {
    identity: issue.identity,
    sourceRevision: issue.sourceRevision,
    sourceReceipt: issue.sourceReceipt,
    sourceObservation: null,
    dependencyState: 'unclassified',
    acceptanceCriteria: issue.acceptanceCriteria,
    assignment: null,
    continuationChain: [],
    branch: null,
    worktree: null,
    baseSha: null,
    headSha: null,
    status: issue.status,
    statusReason: null,
    implementationStatus: 'not-started',
    qualityEvidence: {},
    pipeline: [],
    changeRequest: null,
    shepherd: null,
    shepherdDecision: null,
    setObligation: null,
    terminalDisposition: issue.status === 'completed'
      ? 'already-complete'
      : issue.status === 'failed'
        ? 'failed'
        : issue.status === 'deferred'
          ? 'deferred'
          : null,
    nextAction: exhaustedFields.length && issue.status === 'pending'
      ? 'await-renewed-human-confirmation'
      : null,
  }]));
  return {
    schemaVersion: FLEET_STATE_SCHEMA_VERSION,
    revision: 0,
    runId,
    manifestDigest: manifest.digest,
    providerConfigurationDigest: manifest.providerConfigurationDigest,
    createdAt: now,
    updatedAt: now,
    issues,
    readyFrontier: [],
    blockedSet: [],
    activeCapacity: 0,
    completedWork: [],
    observedHumanMerges: [],
    expiredReadinessClaims: [],
    reShepherdQueue: [],
    publications: [],
    budgetUse: { cost: 0, timeMinutes: 0, retries: 0 },
    control: {
      cancelled: false,
      cancellationReason: null,
      budgetExhausted: exhaustedFields.length > 0,
      exhaustedFields,
    },
    unresolvedHumanDecisions: [],
    fleetDisposition: exhaustedFields.length ? 'budget-exhausted' : null,
    events: [],
  };
}

export function assertFleetState(state, manifest) {
  if (state?.schemaVersion !== FLEET_STATE_SCHEMA_VERSION) throw new Error('unsupported fleet state schema');
  exactKeys(state, [
    'schemaVersion', 'revision', 'runId', 'manifestDigest',
    'providerConfigurationDigest', 'createdAt', 'updatedAt', 'issues',
    'readyFrontier', 'blockedSet', 'activeCapacity', 'completedWork',
    'observedHumanMerges', 'expiredReadinessClaims', 'reShepherdQueue',
    'publications', 'budgetUse', 'control', 'unresolvedHumanDecisions',
    'fleetDisposition', 'events',
  ], 'fleet state');
  if (state.manifestDigest !== manifest.digest) throw new Error('fleet state manifest digest mismatch');
  if (state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('fleet state provider configuration digest mismatch');
  }
  if (!validRunId(state.runId)) throw new Error('invalid fleet state run id');
  if (!Number.isInteger(state.revision) || state.revision < 0) throw new Error('invalid fleet state revision');
  if (!validTimestamp(state.createdAt) || !validTimestamp(state.updatedAt)) {
    throw new Error('invalid fleet state timestamps');
  }
  const stateKeys = Object.keys(state.issues ?? {}).sort();
  const manifestKeys = manifest.issues.map((issue) => issue.identity).sort();
  if (!same(stateKeys, manifestKeys)) {
    throw new Error('fleet state issue keys must exactly equal the confirmed closed issue set');
  }
  if (!Array.isArray(state.publications)
      || !Array.isArray(state.observedHumanMerges)
      || !Array.isArray(state.expiredReadinessClaims)
      || !Array.isArray(state.reShepherdQueue)
      || !Array.isArray(state.events)
      || !Array.isArray(state.unresolvedHumanDecisions)) {
    throw new Error('fleet state collection schema is invalid');
  }
  if (!state.control || typeof state.control !== 'object') throw new Error('fleet state control is absent');
  if (state.control.cancelled !== true && state.control.cancelled !== false) {
    throw new Error('fleet state cancellation flag is invalid');
  }
  if (state.control.budgetExhausted !== true && state.control.budgetExhausted !== false) {
    throw new Error('fleet state budget flag is invalid');
  }
  if (!Array.isArray(state.control.exhaustedFields)) throw new Error('fleet state exhausted fields are invalid');
  for (const field of ['cost', 'timeMinutes', 'retries']) {
    if (!Number.isFinite(state.budgetUse?.[field]) || state.budgetUse[field] < 0) {
      throw new Error(`fleet state budgetUse.${field} is invalid`);
    }
  }
  const computedExhausted = ['cost', 'timeMinutes', 'retries']
    .filter((field) => state.budgetUse[field] >= manifest.budget[field]);
  if (state.control.budgetExhausted !== (computedExhausted.length > 0)
      || !same([...state.control.exhaustedFields].sort(), computedExhausted.sort())) {
    throw new Error('fleet state budget exhaustion is inconsistent with at-ceiling semantics');
  }
  for (const entry of state.publications) assertPublication(entry, manifest, state);
  const publicationKeys = state.publications.map((entry) => entry.key);
  if (new Set(publicationKeys).size !== publicationKeys.length) {
    throw new Error('fleet state contains duplicate publication keys');
  }
  for (const issue of manifest.issues) assertIssueRecord(state.issues[issue.identity], issue, manifest, state);

  const active = assignmentList(state).filter((assignment) => assignment.active);
  const workerContexts = assignmentList(state).map((assignment) => assignment.workerContext);
  if (new Set(workerContexts).size !== workerContexts.length) {
    throw new Error('worker context was reused across assignment history');
  }
  for (const field of ['branch', 'worktree']) {
    const values = active.map((assignment) => assignment[field]);
    if (new Set(values).size !== values.length) throw new Error(`multiple active owners share ${field}`);
  }
  if (active.length !== Object.values(state.issues).filter((issue) => issue.status === 'active').length) {
    throw new Error('active owner count is inconsistent with issue status');
  }
  for (const merge of state.observedHumanMerges) {
    const publication = state.publications.find((entry) =>
      entry.state === 'confirmed'
      && entry.issue === merge.issue
      && entry.identifier === merge.changeRequest);
    if (!publication) throw new Error('observed merge is not reconciled to a confirmed publication');
  }
  for (const queued of state.reShepherdQueue) {
    const issue = state.issues[queued.issue];
    if (!issue?.changeRequest
        || queued.changeRequest !== issue.changeRequest.identifier
        || !Number.isInteger(queued.generation)
        || queued.generation < 1
        || !nonEmpty(queued.baseSha)
        || !nonEmpty(queued.headSha)) {
      throw new Error('re-Shepherd queue entry is incomplete or forged');
    }
  }
  return state;
}

export function loadFleetState(file, manifest) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return assertFleetState(parsed, manifest);
}

function wait(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function acquireLock(lockFile, expectedRevision, options) {
  const attempts = options.lockAttempts ?? 200;
  const delayMs = options.lockDelayMs ?? 5;
  const staleLockMs = options.staleLockMs ?? 30_000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const handle = fs.openSync(lockFile, 'wx', 0o600);
      const body = `${JSON.stringify({
        pid: process.pid,
        expectedRevision,
        createdAt: new Date().toISOString(),
      })}\n`;
      fs.writeFileSync(handle, body);
      fs.fsyncSync(handle);
      return handle;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const stat = fs.lstatSync(lockFile);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw new Error('fleet state lock path is unsafe');
        }
        const stale = Date.now() - stat.mtimeMs >= staleLockMs;
        let metadata = null;
        try {
          metadata = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
        } catch {
          if (stale) {
            fs.unlinkSync(lockFile);
            continue;
          }
        }
        if (stale && metadata && !processAlive(metadata.pid)) {
          fs.unlinkSync(lockFile);
          continue;
        }
      } catch (inspectionError) {
        if (inspectionError.code === 'ENOENT') continue;
        if (inspectionError.message === 'fleet state lock path is unsafe') throw inspectionError;
      }
      wait(delayMs);
    }
  }
  throw new Error('fleet state write lock is busy');
}

function fsyncDirectory(directory) {
  const handle = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

export function persistFleetState(file, state, expectedRevision, manifest, options = {}) {
  if (!manifest) throw new Error('manifest is required for every fleet state write');
  if (!path.isAbsolute(file)) throw new Error('fleet state path must be absolute');
  if (state.revision !== expectedRevision) {
    throw new Error(`state revision conflict: expected ${expectedRevision}, received ${state.revision}`);
  }
  assertFleetState(state, manifest);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const parent = fs.lstatSync(path.dirname(file));
  if (!parent.isDirectory() || parent.isSymbolicLink()) {
    throw new Error('fleet state parent must be a real directory');
  }
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error('fleet state path must not be a symbolic link');
  }
  const lockFile = `${file}.lock`;
  const lockHandle = acquireLock(lockFile, expectedRevision, options);
  const pending = `${file}.next-${process.pid}-${expectedRevision}`;
  try {
    if (fs.existsSync(file)) {
      const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
      assertFleetState(disk, manifest);
      if (disk.revision !== expectedRevision) {
        throw new Error(`state revision conflict: disk is ${disk.revision}, expected ${expectedRevision}`);
      }
    } else if (expectedRevision !== 0) {
      throw new Error(`state revision conflict: state file absent at revision ${expectedRevision}`);
    }
    const next = structuredClone(state);
    next.revision = expectedRevision + 1;
    next.updatedAt = options.now ?? new Date().toISOString();
    assertFleetState(next, manifest);
    const pendingHandle = fs.openSync(pending, 'wx', 0o600);
    try {
      fs.writeFileSync(pendingHandle, `${JSON.stringify(next, null, 2)}\n`);
      fs.fsyncSync(pendingHandle);
    } finally {
      fs.closeSync(pendingHandle);
    }
    fs.renameSync(pending, file);
    fsyncDirectory(path.dirname(file));
    return loadFleetState(file, manifest);
  } finally {
    try {
      if (fs.existsSync(pending)) fs.unlinkSync(pending);
    } finally {
      fs.closeSync(lockHandle);
      if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
    }
  }
}

export function recordSourceRevisionObservation(state, manifest, issue, receipt, now = new Date().toISOString()) {
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('source reobservation state is not bound to the confirmed manifest');
  }
  const normalized = validateSourceRevisionReceipt(receipt, manifest, issue);
  const record = state.issues?.[issue];
  if (!record) throw new Error(`unknown issue: ${issue}`);
  if (record.status !== 'pending' || record.assignment !== null) {
    throw new Error('source revision must be reobserved before first dispatch');
  }
  if (Date.parse(normalized.observedAt) < Date.parse(record.sourceReceipt.observedAt)) {
    throw new Error('source revision reobservation predates the confirmed manifest receipt');
  }
  const next = structuredClone(state);
  next.issues[issue].sourceObservation = {
    ...normalized,
    manifestDigest: manifest.digest,
    reobservedAt: now,
  };
  next.events.push({ type: 'source-reobserved', issue, revision: normalized.revision });
  return next;
}

export function reconcileFrontier(state, frontier) {
  const next = structuredClone(state);
  next.readyFrontier = frontier.ready;
  next.blockedSet = frontier.blocked;
  next.activeCapacity = frontier.capacity.active;
  next.completedWork = frontier.completed;
  for (const entry of frontier.ready) next.issues[entry.issue].dependencyState = 'ready';
  for (const entry of frontier.blocked) next.issues[entry.issue].dependencyState = 'blocked';
  for (const entry of frontier.active) next.issues[entry.issue].dependencyState = 'active';
  return next;
}

export function transitionIssue(state, issue, status, detail = {}) {
  const record = state.issues?.[issue];
  if (!record) throw new Error(`unknown issue: ${issue}`);
  if (status === 'active') throw new Error('active status can only be entered through validated assignment');
  if (status === 'pending') throw new Error('pending status can only be retained through validated handoff replacement');
  if (!TERMINAL_TRANSITIONS.get(record.status)?.has(status)) {
    throw new Error(`invalid issue transition: ${record.status} -> ${status}`);
  }
  if (!ISSUE_DISPOSITIONS.has(detail.terminalDisposition)) {
    throw new Error('terminal transition requires a valid issue disposition');
  }
  const next = structuredClone(state);
  if (record.status === 'active') {
    const end = detail.assignmentEnd;
    if (!end
        || end.generation !== record.assignment.generation
        || end.workerContext !== record.assignment.workerContext
        || !['completed', 'failed', 'deferred'].includes(end.reason)) {
      throw new Error('active terminal transition requires exact assignment end identity');
    }
    next.issues[issue].continuationChain.push({
      ...record.assignment,
      active: false,
      endReason: end.reason,
      endedAt: end.endedAt ?? new Date().toISOString(),
    });
    next.issues[issue].assignment = null;
  }
  next.issues[issue].status = status;
  next.issues[issue].statusReason = detail.reason ?? null;
  next.issues[issue].terminalDisposition = detail.terminalDisposition;
  next.issues[issue].nextAction = detail.nextAction ?? null;
  next.events.push({
    type: 'issue-transition',
    issue,
    from: record.status,
    to: status,
    reason: detail.reason ?? null,
  });
  return next;
}

function markStoppedWork(next, nextAction) {
  for (const record of Object.values(next.issues)) {
    if (record.status === 'pending') {
      record.terminalDisposition = 'not-reached';
      record.nextAction = nextAction;
    } else if (record.status === 'active') {
      record.nextAction = 'capture-validated-orchestration-handoff';
    }
  }
}

export function consumeBudget(state, manifest, usage) {
  if (state.control.cancelled) throw new Error('cannot consume fleet budget after cancellation');
  const next = structuredClone(state);
  for (const field of ['cost', 'timeMinutes', 'retries']) {
    const increment = usage[field] ?? 0;
    if (!Number.isFinite(increment) || increment < 0) throw new Error(`usage.${field} must be non-negative`);
    next.budgetUse[field] += increment;
  }
  const exhausted = ['cost', 'timeMinutes', 'retries']
    .filter((field) => next.budgetUse[field] >= manifest.budget[field]);
  next.control.budgetExhausted = exhausted.length > 0;
  next.control.exhaustedFields = exhausted;
  if (exhausted.length) {
    next.fleetDisposition = 'budget-exhausted';
    markStoppedWork(next, 'await-renewed-human-confirmation');
    next.events.push({ type: 'budget-exhausted', fields: exhausted, semantics: 'at-ceiling' });
  }
  return { state: next, exhausted };
}

export function cancelFleet(state, reason) {
  if (!nonEmpty(reason)) throw new Error('cancellation reason is required');
  const next = structuredClone(state);
  next.control.cancelled = true;
  next.control.cancellationReason = reason.trim();
  next.fleetDisposition = 'cancelled';
  markStoppedWork(next, 'await-new-human-invocation');
  next.events.push({ type: 'fleet-cancelled', reason: reason.trim() });
  return next;
}
