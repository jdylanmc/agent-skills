import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  assertFleetManifest,
  validateIssueSetReceipt,
  validateSourceRevisionReceipt,
} from '../fleet-manifest/fleet-manifest.mjs';
import {
  adaptBlastRadiusEvidence,
  adaptCiEvidence,
  adaptRoastEvidence,
  deliveryStagesForManifest,
  persistedPipelinePasses,
  persistedShepherdPasses,
  validateReadinessObligation,
} from '../quality-evidence/quality-evidence.mjs';
import {
  normalizeChangeRequestRevisionObservation,
  normalizeMergeObservation,
  publicationKey,
} from '../provider-seam/provider-seam.mjs';
import { deriveFleetDisposition } from '../fleet-disposition/fleet-disposition.mjs';

export const FLEET_STATE_SCHEMA_VERSION = 4;
const ISSUE_STATUSES = new Set([
  'pending', 'active', 'completed', 'blocked', 'failed', 'timed-out', 'deferred',
]);
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
  ['pending', new Set(['blocked', 'failed', 'timed-out', 'deferred'])],
  ['active', new Set(['blocked', 'failed', 'timed-out', 'deferred'])],
  ['completed', new Set(['blocked'])],
  ['blocked', new Set(['failed', 'timed-out', 'deferred'])],
  ['failed', new Set()],
  ['timed-out', new Set()],
  ['deferred', new Set()],
]);
const PUBLICATION_STATES = new Set(['intent-recorded', 'retryable-degraded', 'confirmed']);
const PUBLICATION_ATTEMPT_STATES = new Set([
  'published', 'found-existing', 'provider-tool-unobserved',
  'provider-tool-missing', 'provider-tool-unauthenticated',
  'provider-tool-unsupported', 'provider-unsupported', 'transient-failure',
]);
const DEPENDENCY_STATES = new Set(['unclassified', 'ready', 'blocked', 'active']);
const HANDOFF_REASONS = new Set(['stalled', 'exhausted', 'timed-out', 'crashed']);
const DISPOSITIONS_BY_STATUS = Object.freeze({
  pending: new Set([null, 'not-reached']),
  active: new Set([null]),
  completed: new Set(['ready-for-human-merge', 'already-complete']),
  blocked: new Set(['blocked']),
  failed: new Set(['failed']),
  'timed-out': new Set(['timed-out-with-handoff', 'failed']),
  deferred: new Set(['deferred']),
});
const FORBIDDEN_AUTHORITIES = [
  'merge', 'approve', 'enable-auto-merge', 'accept-risk', 'force-push',
  'close-tracker-work', 'select-adjacent-work',
];
const PACKET_FIELDS = [
  'schemaVersion', 'manifestDigest', 'issue', 'sourceRevision',
  'acceptanceCriteria', 'scope', 'exclusions', 'allowedPaths',
  'verification', 'reportContract', 'forbiddenAuthorities', 'taskContract',
  'branch', 'worktree', 'baseSha', 'headSha',
];
const TASK_CONTRACT_FIELDS = [
  'goal', 'scope', 'context', 'acceptance', 'verify', 'timebox',
  'forbidden', 'report', 'standing',
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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function containsDotSegment(value) {
  return String(value).split(/[\\/]+/u).some((segment) => segment === '.' || segment === '..');
}

function alternateCasePath(value) {
  const parsed = path.parse(value);
  const parts = value.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    const character = parts[index].match(/[A-Za-z]/u)?.[0];
    if (!character) continue;
    const offset = parts[index].indexOf(character);
    const replacement = character === character.toLowerCase()
      ? character.toUpperCase()
      : character.toLowerCase();
    const alternate = [...parts];
    alternate[index] = `${parts[index].slice(0, offset)}${replacement}${parts[index].slice(offset + 1)}`;
    return path.join(parsed.root, ...alternate);
  }
  return null;
}

function filesystemIsCaseInsensitive(existingPath) {
  if (process.platform === 'win32') return true;
  let cursor = existingPath;
  while (cursor !== path.parse(cursor).root) {
    const alternate = alternateCasePath(cursor);
    if (alternate && alternate !== cursor) {
      try {
        const original = fs.statSync(cursor);
        const candidate = fs.statSync(alternate);
        return original.dev === candidate.dev && original.ino === candidate.ino;
      } catch {
        // Try a higher existing ancestor.
      }
    }
    cursor = path.dirname(cursor);
  }
  return false;
}

export function canonicalFilesystemIdentity(
  value,
  { requireExisting = false, requireCanonical = true } = {},
) {
  if (!nonEmpty(value) || !path.isAbsolute(value) || value.includes('\0')) {
    throw new Error('filesystem identity requires a non-empty absolute path');
  }
  if (containsDotSegment(value)) {
    throw new Error('filesystem identity must not contain dot segments');
  }
  const resolved = path.normalize(path.resolve(value));
  const parsed = path.parse(resolved);
  const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  let firstMissing = components.length;
  for (const [index, component] of components.entries()) {
    const candidate = path.join(cursor, component);
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error(`filesystem identity traverses a symbolic link: ${candidate}`);
      }
      cursor = candidate;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      firstMissing = index;
      break;
    }
  }
  if (requireExisting && firstMissing !== components.length) {
    throw new Error('filesystem identity path does not exist');
  }
  const existingReal = fs.realpathSync.native
    ? fs.realpathSync.native(cursor)
    : fs.realpathSync(cursor);
  const suffix = components.slice(firstMissing);
  const canonicalPath = path.join(existingReal, ...suffix);
  const caseInsensitive = filesystemIsCaseInsensitive(existingReal);
  if (suffix.length > 0
      && process.platform === 'darwin'
      && existingReal === parsed.root
      && !caseInsensitive) {
    throw new Error('not-yet-created filesystem identity has ambiguous case semantics');
  }
  if (requireCanonical && resolved !== canonicalPath) {
    throw new Error('filesystem identity must use canonical path spelling');
  }
  if (firstMissing === components.length) {
    const stat = fs.statSync(canonicalPath);
    return {
      path: canonicalPath,
      key: `inode:${String(stat.dev)}:${String(stat.ino)}`,
      exists: true,
      caseInsensitive,
    };
  }
  return {
    path: canonicalPath,
    key: `path:${caseInsensitive ? canonicalPath.toLowerCase() : canonicalPath}`,
    exists: false,
    caseInsensitive,
  };
}

function exactKeys(actual, expected, label) {
  const left = Object.keys(actual ?? {}).sort();
  const right = [...expected].sort();
  if (!same(left, right)) {
    throw new Error(`${label} keys differ: expected ${right.join(', ')}, received ${left.join(', ')}`);
  }
}

function assertStateManifestAuthority(state, manifest, label) {
  assertFleetManifest(manifest);
  if (state?.manifestDigest !== manifest.digest
      || state?.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error(`${label} is not bound to the confirmed manifest authority`);
  }
}

function assignmentList(state) {
  return Object.values(state.issues).flatMap((issue) => [
    ...(issue.assignment ? [issue.assignment] : []),
    ...issue.continuationChain,
  ]);
}

function assertAssignment(assignment, issue, manifest, state, { active }) {
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
  const expectedKeys = [
    'generation', 'workerContext', 'branch', 'worktree', 'baseSha', 'headSha',
    'packet', 'active', 'startedAt',
    ...(active ? [] : ['endReason', 'endedAt']),
    ...(!active && assignment.handoff ? ['handoff'] : []),
  ];
  exactKeys(assignment, expectedKeys, `${issue.identity} assignment`);
  if (!validTimestamp(assignment.startedAt)) throw new Error(`${issue.identity} assignment startedAt is invalid`);
  let worktreeIdentity;
  try {
    worktreeIdentity = canonicalFilesystemIdentity(assignment.worktree);
  } catch (error) {
    throw new Error(`${issue.identity} assignment worktree identity is invalid: ${error.message}`);
  }
  if (worktreeIdentity.path !== assignment.worktree) {
    throw new Error(`${issue.identity} assignment worktree is not canonical`);
  }
  if (!nonEmpty(assignment.baseSha) || !nonEmpty(assignment.headSha)) {
    throw new Error(`${issue.identity} assignment requires exact base and head revisions`);
  }
  const packet = assignment.packet;
  if (!packet || typeof packet !== 'object'
      || !same(Object.keys(packet).sort(), [...PACKET_FIELDS].sort())
      || packet.schemaVersion !== 1
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
      || packet.baseSha !== assignment.baseSha
      || packet.headSha !== assignment.headSha
      || !same(packet.verification, manifest.validationPolicy)
      || !packet.reportContract
      || !same(Object.keys(packet.reportContract).sort(), ['requiredEvidence', 'summary'])
      || !nonEmpty(packet.reportContract.summary)
      || !same(packet.reportContract.requiredEvidence, manifest.validationPolicy)
      || !packet.taskContract
      || !same(Object.keys(packet.taskContract).sort(), [...TASK_CONTRACT_FIELDS].sort())
      || packet.taskContract.goal !== manifest.goal
      || packet.taskContract.scope !== JSON.stringify(issue.scope)
      || packet.taskContract.context !== JSON.stringify(stable({
        acceptedScope: manifest.acceptedScope,
        humanBoundaries: manifest.humanBoundaries,
        issue: issue.identity,
        repository: manifest.repository.id,
        sourceRevision: issue.sourceRevision,
      }))
      || !same(packet.taskContract.acceptance, issue.acceptanceCriteria.map((entry) => entry.description))
      || packet.taskContract.verify !== packet.verification.join('\n')
      || packet.taskContract.timebox !== JSON.stringify(stable(manifest.budget))
      || packet.taskContract.forbidden !== FORBIDDEN_AUTHORITIES.join('\n')
      || packet.taskContract.report !== JSON.stringify(stable(packet.reportContract))
      || packet.taskContract.standing !== 'one-issue-one-branch-one-worktree-no-adjacent-work') {
    throw new Error(`${issue.identity} assignment packet is absent or not manifest-bound`);
  }
  if (!active) {
    if (!HANDOFF_REASONS.has(assignment.endReason)
        && !['completed', 'blocked', 'failed', 'deferred'].includes(assignment.endReason)) {
      throw new Error(`${issue.identity} inactive assignment requires a valid end reason`);
    }
    if (!validTimestamp(assignment.endedAt)) throw new Error(`${issue.identity} inactive assignment endedAt is invalid`);
    if (HANDOFF_REASONS.has(assignment.endReason) && assignment.handoff === undefined) {
      throw new Error(`${issue.identity} inactive ${assignment.endReason} assignment requires a validated handoff`);
    }
    if (assignment.handoff !== undefined) {
      const handoff = assignment.handoff;
      exactKeys(handoff, [
        'path', 'directory', 'identity', 'bindingRecord',
        'artifactSha256', 'bindingsSha256',
      ], `${issue.identity} assignment handoff`);
      exactKeys(handoff.identity, [
        'runId', 'issue', 'priorGeneration', 'sourceAgent', 'targetAgent',
      ], `${issue.identity} handoff identity`);
      exactKeys(handoff.bindingRecord, [
        'runId', 'issue', 'priorGeneration', 'branch', 'worktree', 'baseSha',
        'headSha', 'manifestDigest', 'sourceRevision', 'stateRevision',
        'sourceAgent', 'targetAgent', 'inputs',
      ], `${issue.identity} handoff binding record`);
      if (!path.isAbsolute(handoff.path)
          || path.dirname(handoff.path) !== handoff.directory
          || !/^[a-f0-9]{64}$/.test(handoff.artifactSha256)
          || handoff.bindingsSha256 !== digest(handoff.bindingRecord)
          || !same(handoff.identity, {
            runId: handoff.bindingRecord.runId,
            issue: handoff.bindingRecord.issue,
            priorGeneration: handoff.bindingRecord.priorGeneration,
            sourceAgent: handoff.bindingRecord.sourceAgent,
            targetAgent: handoff.bindingRecord.targetAgent,
          })
          || handoff.bindingRecord.issue !== issue.identity
          || handoff.bindingRecord.runId !== state.runId
          || handoff.bindingRecord.priorGeneration !== assignment.generation
          || handoff.bindingRecord.branch !== assignment.branch
          || handoff.bindingRecord.worktree !== assignment.worktree
          || handoff.bindingRecord.baseSha !== assignment.baseSha
          || handoff.bindingRecord.headSha !== assignment.headSha
          || handoff.bindingRecord.manifestDigest !== manifest.digest
          || handoff.bindingRecord.sourceRevision !== issue.sourceRevision
          || handoff.bindingRecord.sourceAgent !== assignment.workerContext
          || !nonEmpty(handoff.bindingRecord.targetAgent)
          || !Number.isInteger(handoff.bindingRecord.stateRevision)
          || handoff.bindingRecord.stateRevision < 0
          || handoff.bindingRecord.stateRevision > state.revision
          || !Array.isArray(handoff.bindingRecord.inputs)) {
        throw new Error(`${issue.identity} assignment handoff identity or binding is invalid`);
      }
      const expectedInputs = [
        ['issue', issue.identity],
        ['prior_generation', assignment.generation],
        ['branch', assignment.branch],
        ['worktree', assignment.worktree],
        ['base_sha', assignment.baseSha],
        ['head_sha', assignment.headSha],
        ['manifest_digest', manifest.digest],
        ['source_revision', issue.sourceRevision],
        ['allowed_paths', JSON.stringify(issue.allowedPaths)],
        ['state_revision', handoff.bindingRecord.stateRevision],
      ];
      if (handoff.bindingRecord.inputs.length !== expectedInputs.length
          || expectedInputs.some(([name, value], index) => {
            const binding = handoff.bindingRecord.inputs[index];
            return !binding
              || !same(Object.keys(binding).sort(), ['name', 'source', 'value'])
              || binding.name !== name
              || String(binding.value) !== String(value)
              || !nonEmpty(binding.source);
          })) {
        throw new Error(`${issue.identity} assignment handoff binding inputs are invalid`);
      }
    }
  }
}

function assertPublication(entry, manifest, state) {
  if (!entry || typeof entry !== 'object' || !nonEmpty(entry.key)) {
    throw new Error('publication entry is malformed');
  }
  exactKeys(entry, [
    'manifestDigest', 'providerConfigurationDigest', 'provider', 'repository',
    'issue', 'sourceRevision', 'headBranch', 'baseBranch',
    'key', 'identifier', 'observations',
  ], `publication ${entry.key}`);
  if (entry.manifestDigest !== manifest.digest
      || entry.providerConfigurationDigest !== manifest.providerConfigurationDigest
      || entry.provider !== manifest.provider.name
      || entry.repository !== manifest.repository.id
      || entry.baseBranch !== manifest.repository.baseBranch) {
    throw new Error(`publication ${entry.key} is not bound to persisted manifest authority`);
  }
  const issue = state.issues[entry.issue];
  if (!issue) throw new Error(`publication ${entry.key} names an unknown issue`);
  const manifestIssue = manifest.issues.find((candidate) => candidate.identity === entry.issue);
  if (!manifestIssue
      || entry.sourceRevision !== manifestIssue.sourceRevision
      || !nonEmpty(entry.headBranch)
      || (issue.branch !== null && entry.headBranch !== issue.branch)) {
    throw new Error(`publication ${entry.key} has incomplete identity`);
  }
  if (entry.key !== publicationKey(entry)) throw new Error(`publication ${entry.key} has forged stable key`);
  if (!Array.isArray(entry.observations) || entry.observations.length === 0) {
    throw new Error(`publication ${entry.key} observations are absent`);
  }
  const revisions = new Set();
  let confirmed = 0;
  for (const observation of entry.observations) {
    exactKeys(observation, [
      'baseSha', 'headSha', 'state', 'attempts', 'intentAt', 'confirmedAt',
    ], `publication ${entry.key} observation`);
    if (!nonEmpty(observation.baseSha)
        || !nonEmpty(observation.headSha)
        || !PUBLICATION_STATES.has(observation.state)
        || !validTimestamp(observation.intentAt)
        || !Array.isArray(observation.attempts)) {
      throw new Error(`publication ${entry.key} has malformed revision observation`);
    }
    const revisionKey = `${observation.baseSha}\0${observation.headSha}`;
    if (revisions.has(revisionKey)) throw new Error(`publication ${entry.key} duplicates a revision observation`);
    revisions.add(revisionKey);
    for (const attempt of observation.attempts) {
      exactKeys(attempt, [
        'invocation', 'status', 'observedAt', 'terminal', 'complete',
        'provider', 'repository', 'issue', 'baseBranch', 'headBranch',
        'baseSha', 'headSha', 'identifier',
      ], `publication ${entry.key} attempt`);
      exactKeys(attempt.invocation, ['id', 'operation', 'providerKey'], `publication ${entry.key} invocation`);
      if (!nonEmpty(attempt.invocation.id)
          || attempt.invocation.operation !== 'publish-change-request'
          || attempt.invocation.providerKey !== entry.key
          || !nonEmpty(attempt?.status)
          || !validTimestamp(attempt?.observedAt)
          || attempt.terminal !== true
          || attempt.complete !== true
          || attempt.provider !== entry.provider
          || attempt.repository !== entry.repository
          || attempt.issue !== entry.issue
          || attempt.baseBranch !== entry.baseBranch
          || attempt.headBranch !== entry.headBranch
          || attempt.baseSha !== observation.baseSha
          || attempt.headSha !== observation.headSha
          || !PUBLICATION_ATTEMPT_STATES.has(attempt.status)
          || Date.parse(attempt.observedAt) < Date.parse(observation.intentAt)) {
        throw new Error(`publication ${entry.key} contains malformed attempt evidence`);
      }
      if (['published', 'found-existing'].includes(attempt.status)) {
        if (!nonEmpty(attempt.identifier) || attempt.identifier !== entry.identifier) {
          throw new Error(`publication ${entry.key} attempt has the wrong provider identifier`);
        }
      } else if (attempt.identifier !== null) {
        throw new Error(`publication ${entry.key} degraded attempt claims an identifier`);
      }
    }
    if (observation.state === 'confirmed') {
      confirmed += 1;
      if (!nonEmpty(entry.identifier) || !validTimestamp(observation.confirmedAt)) {
        throw new Error(`publication ${entry.key} has confirmation without provider identity`);
      }
      const confirmationAttempt = observation.attempts.at(-1);
      if (!confirmationAttempt
          || !['published', 'found-existing'].includes(confirmationAttempt.status)
          || confirmationAttempt.identifier !== entry.identifier
          || confirmationAttempt.observedAt !== observation.confirmedAt) {
        throw new Error(`publication ${entry.key} lacks a complete provider confirmation attempt`);
      }
    } else if (observation.confirmedAt !== null) {
      throw new Error(`publication ${entry.key} forges revision confirmation`);
    }
  }
  if (confirmed === 0 && entry.identifier !== null) {
    throw new Error(`publication ${entry.key} has an identifier without confirmed observation`);
  }
}

function assertShepherd(issue, manifest, state) {
  if (issue.shepherd === null) return;
  const shepherd = issue.shepherd;
  if (!shepherd || typeof shepherd !== 'object') {
    throw new Error(`${issue.identity} shepherd state is malformed`);
  }
  if (shepherd.accepted !== true) {
    exactKeys(shepherd, [
      'accepted', 'ready', 'freshness', 'expiredAt', 'reason', 'generation',
    ], `${issue.identity} expired Shepherd state`);
    if (shepherd.accepted !== false
        || shepherd.ready !== false
        || shepherd.freshness !== 'expired'
        || !validTimestamp(shepherd.expiredAt)
        || !nonEmpty(shepherd.reason)
        || shepherd.generation !== issue.readinessGeneration) {
      throw new Error(`${issue.identity} unaccepted Shepherd state is not an explicit expiry`);
    }
    return;
  }
  if (!issue.changeRequest) throw new Error(`${issue.identity} shepherd state lacks a change request`);
  const receipt = shepherd.receipt;
  const obligation = shepherd.setObligation;
  if (!receipt
      || !same(Object.keys(receipt).sort(), [
        'baseSha', 'complete', 'headSha', 'observedAt', 'provider', 'upToDatePolicy',
      ])
      || receipt.baseSha !== issue.baseSha
      || receipt.headSha !== issue.headSha
      || receipt.complete !== true
      || !validTimestamp(receipt.observedAt)) {
    throw new Error(`${issue.identity} shepherd receipt is not exactly bound`);
  }
  if (validateReadinessObligation(obligation, {
    issue: issue.identity,
    provider: manifest.provider.name,
    repository: manifest.repository.id,
    changeRequest: issue.changeRequest.identifier,
    publicationKey: issue.changeRequest.publicationKey,
    baseBranch: manifest.repository.baseBranch,
    baseSha: issue.baseSha,
    headSha: issue.headSha,
  }, issue.readinessGeneration, 'invoke-fresh-shepherd', shepherd.observation?.observedAt).length) {
    throw new Error(`${issue.identity} shepherd set obligation is incomplete or forged`);
  }
  const semantic = persistedShepherdPasses(issue, state, manifest);
  if (!semantic.passed) {
    throw new Error(`${issue.identity} persisted Shepherd state is invalid: ${semantic.defects.join('; ')}`);
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
      : entry.stage === 'blast-radius-proof'
        ? entry.evidence?.revisions?.baseSha
      : record.baseSha;
    const evidenceHead = entry.stage === 'shepherd'
      ? record.shepherd?.receipt?.headSha
      : entry.stage === 'blast-radius-proof'
        ? entry.evidence?.revisions?.headSha
      : record.headSha;
    const actualBase = entry.stage === 'blast-radius-proof'
      ? entry.evidence?.revisions?.baseSha
      : entry.evidence.baseSha;
    const actualHead = entry.stage === 'blast-radius-proof'
      ? entry.evidence?.revisions?.headSha
      : entry.evidence.headSha;
    if (actualBase !== evidenceBase || actualHead !== evidenceHead) {
      throw new Error(`${record.identity} pipeline evidence is stale`);
    }
    const identity = { runId: state.runId, issue: record.identity };
    if (entry.stage === 'run-ci' && !adaptCiEvidence(entry.evidence, record, identity).passed) {
      throw new Error(`${record.identity} contains forged run-ci evidence`);
    }
    if (entry.stage === 'roast' && !adaptRoastEvidence(entry.evidence, record, identity).complete) {
      throw new Error(`${record.identity} contains forged Roast evidence`);
    }
    if (entry.stage === 'blast-radius-proof'
        && adaptBlastRadiusEvidence(entry.evidence, record, identity).readiness !== 'satisfied') {
      throw new Error(`${record.identity} contains forged blast-radius evidence`);
    }
    if (['implementation', 'diff-reconciliation', 'bounded-remediation'].includes(entry.stage)
        && (entry.evidence.complete !== true
          || entry.evidence.terminal !== true
          || !validTimestamp(entry.evidence.completedAt)
          || (entry.stage === 'implementation' && entry.evidence.status !== 'completed')
          || (entry.stage === 'diff-reconciliation' && entry.evidence.verdict !== 'reconciled')
          || (entry.stage === 'bounded-remediation'
            && (entry.evidence.status !== 'completed'
              || !Array.isArray(entry.evidence.unresolvedDefects)
              || entry.evidence.unresolvedDefects.length !== 0)))) {
      throw new Error(`${record.identity} ${entry.stage} evidence is incomplete`);
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
          const decision = manifest.humanDecisions.find((entry) => entry.id === receipt?.decisionId);
          if (!decision || !nonEmpty(receipt.actor)
              || !same(receipt, {
                decisionId: decision.id,
                actor: decision.actor,
                actorType: 'human',
                issue: decision.issue,
                criterionId: decision.criterionId,
                manifestDigest: decision.manifestDigest,
                sourceRevision: decision.sourceRevision,
                decision: decision.decision,
                decisionText: decision.decisionText,
                decidedAt: decision.decidedAt,
              })) {
            throw new Error(`${record.identity} criterion ${verdict.id} lacks a valid human decision receipt`);
          }
        } else {
          throw new Error(`${record.identity} criterion ${verdict.id} has invalid verdict`);
        }
      }
    }
    if (entry.stage === 'publication') {
      const publication = state.publications.find((candidate) =>
        candidate.key === record.changeRequest?.publicationKey
        && candidate.identifier === record.changeRequest?.identifier);
      const observation = publication?.observations.find((candidate) =>
        candidate.state === 'confirmed'
        && candidate.baseSha === record.baseSha
        && candidate.headSha === record.headSha);
      if (!record.changeRequest
          || !observation
          || entry.evidence.changeRequest !== record.changeRequest.identifier
          || entry.evidence.publicationKey !== record.changeRequest.publicationKey
          || entry.evidence.status !== 'confirmed'
          || entry.evidence.terminal !== true
          || entry.evidence.complete !== true
          || entry.evidence.provider !== manifest.provider.name
          || entry.evidence.repository !== manifest.repository.id
          || entry.evidence.issue !== record.identity
          || entry.evidence.observedAt !== observation.confirmedAt) {
        throw new Error(`${record.identity} publication stage is not reconciled`);
      }
    }
    if (entry.stage === 'shepherd' && record.shepherd?.accepted !== true) {
      throw new Error(`${record.identity} Shepherd stage lacks an accepted receipt`);
    }
  }
  if (record.pipeline.length === stages.length) {
    const semantic = persistedPipelinePasses(record, state, manifest);
    if (!semantic.passed) {
      throw new Error(`${record.identity} pipeline does not semantically pass: ${semantic.defects.join('; ')}`);
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
    'checkActivity', 'handoffObligation', 'readinessGeneration', 'readinessWatermark',
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
        || record.sourceObservation.invocation.id === record.sourceReceipt.invocation.id
        || Date.parse(record.sourceObservation.observedAt) <= Date.parse(record.sourceReceipt.observedAt)
        || !same(source, {
          invocation: record.sourceObservation.invocation,
          provider: record.sourceObservation.provider,
          repository: record.sourceObservation.repository,
          issue: record.sourceObservation.issue,
          revision: record.sourceObservation.revision,
          issueStatus: record.sourceObservation.issueStatus,
          status: record.sourceObservation.status,
          terminal: record.sourceObservation.terminal,
          complete: record.sourceObservation.complete,
          observedAt: record.sourceObservation.observedAt,
        })) {
      throw new Error(`source observation is not current for ${issue.identity}`);
    }
  }
  if (record.status === 'active') {
    assertAssignment(record.assignment, issue, manifest, state, { active: true });
    if (record.assignment.branch !== record.branch
        || record.assignment.worktree !== record.worktree
        || record.assignment.baseSha !== record.baseSha
        || record.assignment.headSha !== record.headSha) {
      throw new Error(`${issue.identity} active assignment revision differs from issue record`);
    }
  } else if (record.assignment !== null) {
    throw new Error(`${issue.identity} has mutable ownership while status is ${record.status}`);
  }
  if (record.handoffObligation !== null) {
    exactKeys(record.handoffObligation, [
      'state', 'reason', 'condition', 'generation', 'workerContext', 'requiredAt',
    ], `${issue.identity} handoff obligation`);
    if (record.status !== 'active'
        || record.assignment?.active !== true
        || record.handoffObligation.state !== 'blocked'
        || record.handoffObligation.reason !== 'handoff-required'
        || !HANDOFF_REASONS.has(record.handoffObligation.condition)
        || record.handoffObligation.generation !== record.assignment.generation
        || record.handoffObligation.workerContext !== record.assignment.workerContext
        || !validTimestamp(record.handoffObligation.requiredAt)
        || record.nextAction !== 'capture-validated-orchestration-handoff') {
      throw new Error(`${issue.identity} handoff-required obligation is malformed`);
    }
  }
  if ((record.branch === null) !== (record.worktree === null)) {
    throw new Error(`${issue.identity} branch/worktree persistence is inconsistent`);
  }
  if (record.worktree !== null) {
    const persistedWorktree = canonicalFilesystemIdentity(record.worktree);
    if (persistedWorktree.path !== record.worktree) {
      throw new Error(`${issue.identity} persisted worktree is not canonical`);
    }
  }
  for (const prior of record.continuationChain) {
    assertAssignment(prior, issue, manifest, state, { active: false });
  }
  const generations = record.continuationChain.map((entry) => entry.generation);
  if (record.assignment) generations.push(record.assignment.generation);
  if (new Set(generations).size !== generations.length) {
    throw new Error(`${issue.identity} has duplicate assignment generations`);
  }
  if (record.terminalDisposition !== null && !ISSUE_DISPOSITIONS.has(record.terminalDisposition)) {
    throw new Error(`${issue.identity} has invalid terminal disposition`);
  }
  if (!DISPOSITIONS_BY_STATUS[record.status].has(record.terminalDisposition)) {
    throw new Error(`${issue.identity} status and terminal disposition are contradictory`);
  }
  if (record.terminalDisposition === 'timed-out-with-handoff') {
    const terminal = record.continuationChain.at(-1);
    if (!terminal
        || terminal.endReason !== 'timed-out'
        || terminal.handoff === undefined) {
      throw new Error(`${issue.identity} timed-out-with-handoff lacks a validated archived handoff`);
    }
  }
  if (!Number.isInteger(record.readinessGeneration) || record.readinessGeneration < 0) {
    throw new Error(`${issue.identity} readiness generation is invalid`);
  }
  if (record.readinessWatermark !== null) {
    exactKeys(record.readinessWatermark, [
      'generation', 'observedAt', 'triggeringPublicationKey', 'triggeringMergeCommit',
    ], `${issue.identity} readiness watermark`);
    if (record.readinessWatermark.generation !== record.readinessGeneration
        || record.readinessGeneration < 1
        || !validTimestamp(record.readinessWatermark.observedAt)
        || !nonEmpty(record.readinessWatermark.triggeringPublicationKey)
        || !nonEmpty(record.readinessWatermark.triggeringMergeCommit)) {
      throw new Error(`${issue.identity} readiness watermark is malformed`);
    }
  }
  if (record.checkActivity !== null) {
    if (!record.checkActivity
        || !['quality-check', 'publication-observation', 'shepherd-check'].includes(record.checkActivity.kind)
        || !validTimestamp(record.checkActivity.startedAt)
        || (record.checkActivity.kind === 'shepherd-check'
          && record.checkActivity.generation !== record.readinessGeneration)
        || (record.checkActivity.state === 'blocked'
          ? (record.checkActivity.kind !== 'shepherd-check'
            || record.checkActivity.blocker !== 'sibling-merge-watermark')
          : record.checkActivity.state !== 'active')) {
      throw new Error(`${issue.identity} check activity is malformed`);
    }
  }
  if (record.changeRequest !== null) {
    exactKeys(record.changeRequest, [
      'identifier', 'provider', 'repository', 'baseBranch', 'headBranch',
      'baseSha', 'headSha', 'publicationKey',
    ], `${issue.identity} change request`);
    const publication = state.publications.find((entry) =>
      entry.issue === issue.identity
      && entry.identifier === record.changeRequest.identifier
      && entry.observations.some((observation) =>
        observation.state === 'confirmed'
        && observation.baseSha === record.baseSha
        && observation.headSha === record.headSha));
    if (!publication
        || record.changeRequest.provider !== manifest.provider.name
        || record.changeRequest.repository !== manifest.repository.id
        || record.changeRequest.baseBranch !== manifest.repository.baseBranch
        || record.changeRequest.headBranch !== publication.headBranch
        || record.changeRequest.baseSha !== record.baseSha
        || record.changeRequest.headSha !== record.headSha) {
      throw new Error(`${issue.identity} change request is not reconciled to confirmed publication`);
    }
  }
  assertShepherd(record, manifest, state);
  if (record.shepherd?.accepted === true
      && !same(record.setObligation, record.shepherd.setObligation)) {
    throw new Error(`${issue.identity} set obligation differs from accepted Shepherd state`);
  }
  if (record.shepherdDecision !== null) {
    const readinessPublication = state.publications.find((entry) =>
      entry.key === record.changeRequest?.publicationKey
      && entry.identifier === record.changeRequest?.identifier);
    const readinessPublicationObservation = readinessPublication?.observations.find((entry) =>
      entry.state === 'confirmed'
      && entry.baseSha === record.baseSha
      && entry.headSha === record.headSha);
    if (manifest.shepherdIntent !== 'no'
        || record.shepherdDecision.state !== 'not-required'
        || record.shepherdDecision.manifestDigest !== manifest.digest
        || validateReadinessObligation(record.setObligation, {
          issue: issue.identity,
          provider: manifest.provider.name,
          repository: manifest.repository.id,
          changeRequest: record.changeRequest?.identifier,
          publicationKey: record.changeRequest?.publicationKey,
          baseBranch: manifest.repository.baseBranch,
          baseSha: record.baseSha,
          headSha: record.headSha,
        }, record.readinessGeneration, 'rerun-quality-and-provider-observation',
        readinessPublicationObservation?.confirmedAt).length) {
      throw new Error(`${issue.identity} has forged Shepherd-not-required state`);
    }
  } else if (!record.shepherd && record.setObligation !== null) {
    throw new Error(`${issue.identity} has an obligation without an accepted readiness state`);
  }
  if (record.terminalDisposition === 'ready-for-human-merge') {
    const pipeline = persistedPipelinePasses(record, state, manifest);
    if (!pipeline.passed) {
      throw new Error(`${issue.identity} ready disposition lacks effective pipeline readiness: ${pipeline.defects.join('; ')}`);
    }
    if (record.changeRequest === null) {
      throw new Error(`${issue.identity} ready disposition lacks confirmed publication`);
    }
    if (record.readinessWatermark !== null) {
      const latestReadinessAt = manifest.shepherdIntent === 'yes'
        ? record.shepherd?.observation?.observedAt
        : record.setObligation?.createdAt;
      if (!validTimestamp(latestReadinessAt)
          || Date.parse(latestReadinessAt) <= Date.parse(record.readinessWatermark.observedAt)) {
        throw new Error(`${issue.identity} ready disposition predates the latest merge watermark`);
      }
    }
    if (manifest.shepherdIntent === 'yes') {
      const shepherd = persistedShepherdPasses(record, state, manifest);
      if (!shepherd.passed) {
        throw new Error(`${issue.identity} ready disposition lacks effective Shepherd readiness: ${shepherd.defects.join('; ')}`);
      }
    } else if (record.shepherd !== null
        || record.shepherdDecision?.state !== 'not-required'
        || record.shepherdDecision?.manifestDigest !== manifest.digest
        || record.setObligation === null) {
      throw new Error(`${issue.identity} ready disposition lacks exact no-Shepherd readiness`);
    }
  }
}

export function fleetStatePath(repositoryRoot, runId) {
  if (!path.isAbsolute(repositoryRoot)) throw new Error('repositoryRoot must be absolute');
  if (!validRunId(runId)) throw new Error('runId must be path-safe');
  return path.join(repositoryRoot, '.ship-with-squadron', runId, 'fleet-state.json');
}

export function createFleetState(manifest, runId, now = new Date().toISOString()) {
  assertFleetManifest(manifest);
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
    checkActivity: null,
    handoffObligation: null,
    readinessGeneration: 0,
    readinessWatermark: null,
    terminalDisposition: issue.status === 'completed'
      ? 'already-complete'
      : issue.status === 'failed'
        ? 'failed'
        : issue.status === 'blocked'
          ? 'blocked'
          : issue.status === 'timed-out'
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
    issueSetObservation: null,
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
  assertFleetManifest(manifest);
  if (state?.schemaVersion !== FLEET_STATE_SCHEMA_VERSION) throw new Error('unsupported fleet state schema');
  exactKeys(state, [
    'schemaVersion', 'revision', 'runId', 'manifestDigest',
    'providerConfigurationDigest', 'createdAt', 'updatedAt', 'issues',
    'readyFrontier', 'blockedSet', 'activeCapacity', 'completedWork',
    'observedHumanMerges', 'expiredReadinessClaims', 'reShepherdQueue',
    'publications', 'issueSetObservation', 'budgetUse', 'control', 'unresolvedHumanDecisions',
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
  const publicationIssues = state.publications.map((entry) => entry.issue);
  if (new Set(publicationIssues).size !== publicationIssues.length) {
    throw new Error('fleet state contains duplicate logical publications for an issue');
  }
  const publicationIdentifiers = state.publications
    .map((entry) => entry.identifier)
    .filter((identifier) => identifier !== null);
  if (new Set(publicationIdentifiers).size !== publicationIdentifiers.length) {
    throw new Error('fleet state contains duplicate provider publication identifiers');
  }
  const publicationInvocationIds = state.publications
    .flatMap((entry) => entry.observations)
    .flatMap((observation) => observation.attempts)
    .map((attempt) => attempt.invocation.id);
  if (new Set(publicationInvocationIds).size !== publicationInvocationIds.length) {
    throw new Error('fleet state contains duplicate publication invocation identities');
  }
  for (const issue of manifest.issues) assertIssueRecord(state.issues[issue.identity], issue, manifest, state);
  for (const issue of manifest.issues) {
    const record = state.issues[issue.identity];
    if (record.terminalDisposition === 'already-complete'
        && (issue.status !== 'completed'
          || issue.sourceReceipt.issueStatus !== 'completed'
          || record.status !== 'completed')) {
      throw new Error(`${issue.identity} already-complete is not sealed by the confirmed provider receipt`);
    }
  }

  const active = assignmentList(state).filter((assignment) => assignment.active);
  const workerContexts = assignmentList(state).map((assignment) => assignment.workerContext);
  if (new Set(workerContexts).size !== workerContexts.length) {
    throw new Error('worker context was reused across assignment history');
  }
  const branches = active.map((assignment) => assignment.branch);
  if (new Set(branches).size !== branches.length) {
    throw new Error('multiple active owners share branch');
  }
  const worktreeKeys = active.map((assignment) => canonicalFilesystemIdentity(assignment.worktree).key);
  if (new Set(worktreeKeys).size !== worktreeKeys.length) {
    throw new Error('multiple active owners share canonical worktree identity');
  }
  if (active.length !== Object.values(state.issues).filter((issue) => issue.status === 'active').length) {
    throw new Error('active owner count is inconsistent with issue status');
  }
  if (active.length !== state.activeCapacity || active.length > manifest.concurrency) {
    throw new Error('active owner count violates persisted capacity or manifest concurrency');
  }
  for (const merge of state.observedHumanMerges) {
    normalizeMergeObservation(state, manifest, merge);
    const issue = state.issues[merge.issue];
    if (issue.status !== 'completed'
        || !['ready-for-human-merge', 'already-complete'].includes(issue.terminalDisposition)) {
      throw new Error('observed merge contradicts the issue terminal transition matrix');
    }
    for (const record of Object.values(state.issues)) {
      if (record.readinessWatermark && !state.observedHumanMerges.some((merge) =>
        merge.publicationKey === record.readinessWatermark.triggeringPublicationKey
        && merge.mergeCommit === record.readinessWatermark.triggeringMergeCommit
        && merge.observedAt === record.readinessWatermark.observedAt)) {
        throw new Error(`${record.identity} readiness watermark has no observed merge`);
      }
    }
  }
  for (const field of ['publicationKey', 'mergeCommit']) {
    const values = state.observedHumanMerges.map((entry) => entry[field]);
    if (new Set(values).size !== values.length) throw new Error('observed merge records are not unique');
  }
  const invocationIds = state.observedHumanMerges.map((entry) => entry.invocation.id);
  if (new Set(invocationIds).size !== invocationIds.length) {
    throw new Error('observed merge invocation identities are not unique');
  }
  if (manifest.issueSet.kind === 'tracker-query' && state.issueSetObservation !== null) {
    validateIssueSetReceipt(state.issueSetObservation, manifest);
    if (state.issueSetObservation.manifestDigest !== manifest.digest
        || !validTimestamp(state.issueSetObservation.reobservedAt)
        || state.issueSetObservation.invocation.id === manifest.issueSet.receipt.invocation.id
        || Date.parse(state.issueSetObservation.observedAt)
          <= Date.parse(manifest.issueSet.receipt.observedAt)) {
      throw new Error('issue-set observation is not bound to the confirmed manifest');
    }
  } else if (manifest.issueSet.kind === 'explicit' && state.issueSetObservation !== null) {
    throw new Error('explicit issue sets must not forge query observations');
  }
  for (const queued of state.reShepherdQueue) {
    exactKeys(queued, [
      'issue', 'changeRequest', 'publicationKey', 'reason', 'generation',
      'baseSha', 'headSha', 'sourceStateRevision', 'triggeringPublicationKey',
      'triggeringMergeCommit', 'mergeObservedAt', 'revisionObservation',
      'blocker', 'queuedAt', 'action',
    ], `re-Shepherd queue ${queued.issue}`);
    const issue = state.issues[queued.issue];
    const publication = state.publications.find((entry) =>
      entry.key === queued.publicationKey && entry.identifier === queued.changeRequest);
    if (!issue
        || !publication
        || !Number.isInteger(queued.generation)
        || queued.generation < 1
        || queued.generation !== issue.readinessGeneration
        || !nonEmpty(queued.reason)
        || !Number.isInteger(queued.sourceStateRevision)
        || queued.sourceStateRevision < 0
        || queued.sourceStateRevision > state.revision
        || !validTimestamp(queued.queuedAt)
        || !nonEmpty(queued.triggeringPublicationKey)
        || !nonEmpty(queued.triggeringMergeCommit)
        || !validTimestamp(queued.mergeObservedAt)
        || Date.parse(queued.queuedAt) < Date.parse(queued.mergeObservedAt)
        || issue.readinessWatermark?.observedAt !== queued.mergeObservedAt
        || issue.readinessWatermark?.triggeringPublicationKey !== queued.triggeringPublicationKey
        || issue.readinessWatermark?.triggeringMergeCommit !== queued.triggeringMergeCommit
        || (queued.revisionObservation === null
          ? (!nonEmpty(queued.blocker)
            || queued.baseSha !== null
            || queued.headSha !== null
            || queued.action !== 'acquire-current-change-request-revision')
          : (queued.blocker !== null
            || queued.revisionObservation.status !== 'observed'
            || queued.revisionObservation.observed !== true
            || queued.revisionObservation.terminal !== true
            || queued.revisionObservation.complete !== true
            || queued.revisionObservation.issue !== queued.issue
            || queued.revisionObservation.changeRequest !== queued.changeRequest
            || queued.revisionObservation.publicationKey !== queued.publicationKey
            || queued.revisionObservation.provider !== publication.provider
            || queued.revisionObservation.repository !== publication.repository
            || queued.revisionObservation.baseBranch !== publication.baseBranch
            || queued.revisionObservation.headBranch !== publication.headBranch
            || queued.revisionObservation.baseSha !== queued.baseSha
            || queued.revisionObservation.headSha !== queued.headSha
            || !validTimestamp(queued.revisionObservation.observedAt)
            || Date.parse(queued.revisionObservation.observedAt) <= Date.parse(queued.mergeObservedAt)
            || queued.action !== (manifest.shepherdIntent === 'yes'
              ? 'invoke-fresh-shepherd'
              : 'rerun-quality-and-provider-observation')))) {
      throw new Error('re-Shepherd queue entry is incomplete or forged');
    }
    if (queued.revisionObservation !== null) {
      const normalizedRevision = normalizeChangeRequestRevisionObservation(
        state,
        manifest,
        queued.revisionObservation,
      );
      if (!same(normalizedRevision, queued.revisionObservation)) {
        throw new Error('re-Shepherd revision observation is not normalized');
      }
    }
  }
  for (const expired of state.expiredReadinessClaims) {
    exactKeys(expired, [
      'issue', 'changeRequest', 'publicationKey', 'reason', 'oldBaseSha',
      'currentBaseSha', 'currentHeadSha', 'generation', 'expiredAt',
      'sourceStateRevision', 'triggeringPublicationKey', 'triggeringMergeCommit',
      'revisionObservation',
    ], `expired readiness ${expired.issue}`);
    if (!state.issues[expired.issue]
        || !nonEmpty(expired.changeRequest)
        || !nonEmpty(expired.publicationKey)
        || !nonEmpty(expired.reason)
        || !Number.isInteger(expired.generation)
        || expired.generation < 1
        || !validTimestamp(expired.expiredAt)
        || !Number.isInteger(expired.sourceStateRevision)
        || expired.sourceStateRevision < 0
        || !nonEmpty(expired.triggeringPublicationKey)
        || !nonEmpty(expired.triggeringMergeCommit)
        || (expired.revisionObservation === null
          ? (expired.currentBaseSha !== null || expired.currentHeadSha !== null)
          : (expired.currentBaseSha !== expired.revisionObservation.baseSha
            || expired.currentHeadSha !== expired.revisionObservation.headSha))) {
      throw new Error('expired readiness claim is incomplete or forged');
    }
  }
  if (state.fleetDisposition !== null) {
    const derived = deriveFleetDisposition(state, manifest);
    if (state.fleetDisposition !== derived) {
      throw new Error(`persisted fleet disposition contradicts semantic state: ${state.fleetDisposition} != ${derived}`);
    }
  }
  return state;
}

function normalizedAbsolute(value) {
  return path.normalize(path.resolve(value));
}

function sameResolvedPath(left, right) {
  try {
    return canonicalFilesystemIdentity(left, { requireCanonical: false }).key
      === canonicalFilesystemIdentity(right, { requireCanonical: false }).key;
  } catch {
    const normalizedLeft = normalizedAbsolute(left);
    const normalizedRight = normalizedAbsolute(right);
    return process.platform === 'win32'
      ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
      : normalizedLeft === normalizedRight;
  }
}

function assertFleetStatePath(file, manifest, runId) {
  assertFleetManifest(manifest);
  if (!path.isAbsolute(file)) throw new Error('fleet state path must be absolute');
  if (!validRunId(runId)) throw new Error('fleet state path run id is invalid');
  const normalized = normalizedAbsolute(file);
  const expected = normalizedAbsolute(fleetStatePath(manifest.repository.root, runId));
  if (!sameResolvedPath(normalized, expected) || file !== normalized) {
    throw new Error('fleet state path is not bound to the manifest repository and run');
  }
  return expected;
}

function sameFileIdentity(left, right) {
  return left.isFile() === right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function openVerifiedRegularFile(file) {
  const before = fs.lstatSync(file);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error('fleet state path is not a real regular file');
  }
  const noFollow = Number.isInteger(fs.constants.O_NOFOLLOW) ? fs.constants.O_NOFOLLOW : 0;
  const handle = fs.openSync(file, fs.constants.O_RDONLY | noFollow);
  try {
    const descriptor = fs.fstatSync(handle);
    const after = fs.lstatSync(file);
    if (!sameFileIdentity(before, descriptor)
        || !sameFileIdentity(descriptor, after)
        || !sameResolvedPath(fs.realpathSync(file), file)) {
      throw new Error('fleet state file changed or resolved through a link');
    }
    return handle;
  } catch (error) {
    fs.closeSync(handle);
    throw error;
  }
}

export function loadFleetState(file, manifest) {
  const runId = path.basename(path.dirname(file));
  assertFleetStatePath(file, manifest, runId);
  const handle = openVerifiedRegularFile(file);
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) throw new Error('fleet state descriptor is not a regular file');
    const state = assertFleetState(JSON.parse(fs.readFileSync(handle, 'utf8')), manifest);
    assertFleetStatePath(file, manifest, state.runId);
    return state;
  } finally {
    fs.closeSync(handle);
  }
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

function lockOwnerPath(lockDirectory, token) {
  return path.join(lockDirectory, `owner-${token}.json`);
}

function readLockOwner(lockDirectory) {
  const directoryBefore = fs.lstatSync(lockDirectory);
  if (directoryBefore.isSymbolicLink() || !directoryBefore.isDirectory()
      || !sameResolvedPath(fs.realpathSync(lockDirectory), lockDirectory)) {
    throw new Error('fleet state lock path is unsafe');
  }
  const owners = fs.readdirSync(lockDirectory)
    .filter((entry) => /^owner-[a-f0-9]{48}\.json$/.test(entry));
  if (owners.length !== 1) throw new Error('fleet state lock metadata has no unique ownership token');
  const ownerPath = path.join(lockDirectory, owners[0]);
  const handle = openVerifiedRegularFile(ownerPath);
  try {
    const ownerStat = fs.fstatSync(handle);
    const metadata = JSON.parse(fs.readFileSync(handle, 'utf8'));
    const token = owners[0].slice('owner-'.length, -'.json'.length);
    if (!metadata
        || !same(Object.keys(metadata).sort(), ['createdAt', 'expectedRevision', 'pid', 'token'])
        || metadata.token !== token
        || !nonEmpty(token)
        || !Number.isInteger(metadata.pid)
        || metadata.pid < 1
        || !Number.isInteger(metadata.expectedRevision)
        || metadata.expectedRevision < 0
        || !validTimestamp(metadata.createdAt)) {
      throw new Error('fleet state lock metadata is malformed');
    }
    const directoryAfter = fs.lstatSync(lockDirectory);
    if (directoryBefore.dev !== directoryAfter.dev || directoryBefore.ino !== directoryAfter.ino) {
      throw new Error('fleet state lock path is unsafe');
    }
    return {
      metadata,
      token,
      directory: { dev: directoryAfter.dev, ino: directoryAfter.ino },
      owner: { dev: ownerStat.dev, ino: ownerStat.ino },
    };
  } finally {
    fs.closeSync(handle);
  }
}

function removePrivateDirectory(directory) {
  if (!fs.existsSync(directory)) return;
  fs.rmSync(directory, { recursive: true, force: true });
}

function initializeLockClaim(lockDirectory, token, expectedRevision) {
  const claim = `${lockDirectory}.claim-${process.pid}-${token}`;
  fs.mkdirSync(claim, { mode: 0o700 });
  try {
    const ownerPath = lockOwnerPath(claim, token);
    const handle = fs.openSync(ownerPath, 'wx', 0o600);
    try {
      fs.writeFileSync(handle, `${JSON.stringify({
        pid: process.pid,
        token,
        expectedRevision,
        createdAt: new Date().toISOString(),
      })}\n`);
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fsyncDirectory(claim);
    fs.renameSync(claim, lockDirectory);
    fsyncDirectory(path.dirname(lockDirectory));
    return readLockOwner(lockDirectory);
  } catch (error) {
    removePrivateDirectory(claim);
    throw error;
  }
}

function inspectLockDirectory(lockDirectory) {
  const stat = fs.lstatSync(lockDirectory);
  if (stat.isSymbolicLink() || !stat.isDirectory()
      || !sameResolvedPath(fs.realpathSync(lockDirectory), lockDirectory)) {
    throw new Error('fleet state lock path is unsafe');
  }
  return {
    directory: { dev: stat.dev, ino: stat.ino },
    mtimeMs: stat.mtimeMs,
  };
}

function acquireLock(lockDirectory, expectedRevision, options) {
  const attempts = options.lockAttempts ?? 200;
  const delayMs = options.lockDelayMs ?? 5;
  const staleLockMs = options.staleLockMs ?? 30_000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const token = crypto.randomBytes(24).toString('hex');
    try {
      return initializeLockClaim(lockDirectory, token, expectedRevision);
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
      try {
        const observed = readLockOwner(lockDirectory);
        const ownerStat = fs.lstatSync(lockOwnerPath(lockDirectory, observed.token));
        const stale = Date.now() - ownerStat.mtimeMs >= staleLockMs;
        if (stale && !processAlive(observed.metadata.pid)) {
          options.beforeStaleLockClaim?.();
          if (removeOwnedLockDirectory(lockDirectory, observed, 'stale')) continue;
        }
      } catch (inspectionError) {
        if (inspectionError.code === 'ENOENT') continue;
        if (inspectionError.message === 'fleet state lock path is unsafe') throw inspectionError;
        const malformed = inspectLockDirectory(lockDirectory);
        if (Date.now() - malformed.mtimeMs >= staleLockMs) {
          options.beforeMalformedLockClaim?.();
          if (quarantineLockDirectory(lockDirectory, malformed, 'malformed')) continue;
        }
      }
      wait(delayMs);
    }
  }
  throw new Error('fleet state write lock is busy');
}

function quarantineLockDirectory(lockDirectory, ownership, purpose) {
  const marker = path.join(
    lockDirectory,
    `${purpose}-${process.pid}-${crypto.randomBytes(16).toString('hex')}`,
  );
  try {
    const markerHandle = fs.openSync(marker, 'wx', 0o600);
    fs.closeSync(markerHandle);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const quarantine = `${lockDirectory}.${purpose}-${process.pid}-${crypto.randomBytes(16).toString('hex')}`;
  try {
    const directory = fs.lstatSync(lockDirectory);
    if (directory.dev !== ownership.directory.dev || directory.ino !== ownership.directory.ino) {
      return false;
    }
    if (ownership.token) {
      const current = readLockOwner(lockDirectory);
      if (current.token !== ownership.token
          || current.directory.dev !== ownership.directory.dev
          || current.directory.ino !== ownership.directory.ino
          || current.owner.dev !== ownership.owner.dev
          || current.owner.ino !== ownership.owner.ino) return false;
    }
    fs.renameSync(lockDirectory, quarantine);
    const moved = fs.lstatSync(quarantine);
    if (moved.dev !== ownership.directory.dev
        || moved.ino !== ownership.directory.ino
        || !fs.existsSync(path.join(quarantine, path.basename(marker)))) {
      if (!fs.existsSync(lockDirectory)) fs.renameSync(quarantine, lockDirectory);
      throw new Error('fleet state lock changed during atomic quarantine');
    }
    removePrivateDirectory(quarantine);
    fsyncDirectory(path.dirname(lockDirectory));
    return true;
  } finally {
    try {
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    } catch {
      // The canonical lock may already belong to a replacement owner.
    }
  }
}

function removeOwnedLockDirectory(lockDirectory, ownership, purpose) {
  return quarantineLockDirectory(lockDirectory, ownership, purpose);
}

function fsyncDirectory(directory) {
  if (process.platform === 'win32') return;
  const handle = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function snapshotFleetDirectoryChain(directory) {
  const resolved = path.resolve(directory);
  const parsed = path.parse(resolved);
  const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const rootStat = fs.lstatSync(parsed.root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('fleet state filesystem root is unsafe');
  }
  const snapshots = [{ path: parsed.root, dev: rootStat.dev, ino: rootStat.ino }];
  let cursor = parsed.root;
  for (const component of components) {
    cursor = path.join(cursor, component);
    if (!fs.existsSync(cursor)) {
      try {
        fs.mkdirSync(cursor, { mode: 0o700 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`fleet state directory ancestry is unsafe: ${cursor}`);
    }
    if (!sameResolvedPath(fs.realpathSync(cursor), cursor)) {
      throw new Error(`fleet state directory ancestry resolved through a link: ${cursor}`);
    }
    snapshots.push({ path: cursor, dev: stat.dev, ino: stat.ino });
  }
  return snapshots;
}

function sameFleetDirectoryChain(snapshots) {
  return snapshots.every((entry) => {
    try {
      const stat = fs.lstatSync(entry.path);
      return !stat.isSymbolicLink()
        && stat.isDirectory()
        && stat.dev === entry.dev
        && stat.ino === entry.ino;
    } catch {
      return false;
    }
  });
}

function prepareFleetStatePath(file, manifest, runId) {
  assertFleetStatePath(file, manifest, runId);
  const chain = snapshotFleetDirectoryChain(path.dirname(file));
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error('fleet state path must not be a symbolic link');
  }
  return chain;
}

function readLockedState(file, expectedRevision, manifest) {
  if (!fs.existsSync(file)) {
    if (expectedRevision !== 0) {
      throw new Error(`state revision conflict: state file absent at revision ${expectedRevision}`);
    }
    return null;
  }
  const handle = openVerifiedRegularFile(file);
  let disk;
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile()) throw new Error('fleet state descriptor is not a regular file');
    disk = JSON.parse(fs.readFileSync(handle, 'utf8'));
  } finally {
    fs.closeSync(handle);
  }
  assertFleetState(disk, manifest);
  if (disk.revision !== expectedRevision) {
    throw new Error(`state revision conflict: disk is ${disk.revision}, expected ${expectedRevision}`);
  }
  return disk;
}

function writeLockedState(file, state, expectedRevision, manifest, options, pending) {
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
}

function withFleetStateLock(file, manifest, runId, expectedRevision, options, operation) {
  const directoryChain = prepareFleetStatePath(file, manifest, runId);
  const lockFile = `${file}.lock`;
  const lock = acquireLock(lockFile, expectedRevision, options);
  const pending = `${file}.next-${process.pid}-${expectedRevision}`;
  try {
    if (!sameFleetDirectoryChain(directoryChain)) {
      throw new Error('fleet state directory ancestry changed before mutation');
    }
    return operation(pending);
  } finally {
    try {
      if (fs.existsSync(pending)) fs.unlinkSync(pending);
    } finally {
      options.beforeReleaseLockClaim?.();
      removeOwnedLockDirectory(lockFile, lock, 'release');
      if (!sameFleetDirectoryChain(directoryChain)) {
        throw new Error('fleet state directory ancestry changed during mutation');
      }
    }
  }
}

export function persistFleetState(file, state, expectedRevision, manifest, options = {}) {
  if (!manifest) throw new Error('manifest is required for every fleet state write');
  assertFleetManifest(manifest);
  assertFleetStatePath(file, manifest, state?.runId);
  if (state.revision !== expectedRevision) {
    throw new Error(`state revision conflict: expected ${expectedRevision}, received ${state.revision}`);
  }
  assertFleetState(state, manifest);
  return withFleetStateLock(file, manifest, state.runId, expectedRevision, options, (pending) => {
    readLockedState(file, expectedRevision, manifest);
    return writeLockedState(file, state, expectedRevision, manifest, options, pending);
  });
}

export function mutateFleetState(file, manifest, expectedRevision, mutate, options = {}) {
  if (!manifest) throw new Error('manifest is required for every fleet state mutation');
  assertFleetManifest(manifest);
  const runId = path.basename(path.dirname(file));
  assertFleetStatePath(file, manifest, runId);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('expected fleet state revision is invalid');
  }
  if (typeof mutate !== 'function') throw new Error('fleet state mutator is required');
  return withFleetStateLock(file, manifest, runId, expectedRevision, options, (pending) => {
    const disk = readLockedState(file, expectedRevision, manifest);
    if (!disk) throw new Error('fleet state mutation requires an existing state file');
    assertFleetStatePath(file, manifest, disk.runId);
    const next = mutate(structuredClone(disk));
    if (!next || next.revision !== expectedRevision) {
      throw new Error('fleet state mutator changed or omitted the expected revision');
    }
    assertFleetState(next, manifest);
    return writeLockedState(file, next, expectedRevision, manifest, options, pending);
  });
}

export function recordSourceRevisionObservation(state, manifest, issue, receipt, now = new Date().toISOString()) {
  assertFleetManifest(manifest);
  if (!manifest.provider.allowedOperations.includes('read-issue')) {
    throw new Error('source reobservation is blocked because read-issue is not allow-listed');
  }
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('source reobservation state is not bound to the confirmed manifest');
  }
  const normalized = validateSourceRevisionReceipt(receipt, manifest, issue);
  if (!validTimestamp(now)) throw new Error('source reobservation time is invalid');
  const record = state.issues?.[issue];
  if (!record) throw new Error(`unknown issue: ${issue}`);
  if (record.status !== 'pending' || record.assignment !== null) {
    throw new Error('source revision must be reobserved before first dispatch');
  }
  if (Date.parse(normalized.observedAt) <= Date.parse(record.sourceReceipt.observedAt)
      || normalized.invocation.id === record.sourceReceipt.invocation.id) {
    throw new Error('source revision reobservation must be a fresh provider invocation after confirmation');
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

export function recordIssueSetObservation(
  state,
  manifest,
  receipt,
  now = new Date().toISOString(),
) {
  assertFleetManifest(manifest);
  if (manifest.issueSet.kind !== 'tracker-query') {
    throw new Error('issue-set reobservation is only required for tracker-query manifests');
  }
  if (!manifest.provider.allowedOperations.includes('read-issue-set')) {
    throw new Error('issue-set reobservation is blocked because read-issue-set is not allow-listed');
  }
  if (state.manifestDigest !== manifest.digest
      || state.providerConfigurationDigest !== manifest.providerConfigurationDigest) {
    throw new Error('issue-set reobservation state is not bound to the confirmed manifest');
  }
  const normalized = validateIssueSetReceipt(receipt, manifest);
  if (!validTimestamp(now)) throw new Error('issue-set reobservation time is invalid');
  if (Date.parse(normalized.observedAt) <= Date.parse(manifest.issueSet.receipt.observedAt)
      || normalized.invocation.id === manifest.issueSet.receipt.invocation.id) {
    throw new Error('issue-set reobservation must be a fresh provider invocation after confirmation');
  }
  const next = structuredClone(state);
  next.issueSetObservation = {
    ...normalized,
    manifestDigest: manifest.digest,
    reobservedAt: now,
  };
  next.events.push({
    type: 'issue-set-reobserved',
    queryIdentity: normalized.queryIdentity,
    queryRevision: normalized.queryRevision,
    membershipDigest: normalized.membershipDigest,
  });
  return next;
}

export function reconcileFrontier(state, manifest, frontier) {
  assertStateManifestAuthority(state, manifest, 'frontier reconciliation state');
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

export function transitionIssue(state, manifest, issue, status, detail = {}) {
  assertStateManifestAuthority(state, manifest, 'issue transition state');
  const record = state.issues?.[issue];
  if (!record) throw new Error(`unknown issue: ${issue}`);
  if (status === 'active') throw new Error('active status can only be entered through validated assignment');
  if (status === 'pending') throw new Error('pending status can only be retained through validated handoff replacement');
  if (status === 'completed') {
    throw new Error('completed status can only be entered through the semantic publication/readiness pipeline');
  }
  if (!TERMINAL_TRANSITIONS.get(record.status)?.has(status)) {
    throw new Error(`invalid issue transition: ${record.status} -> ${status}`);
  }
  const next = structuredClone(state);
  if (record.status === 'active') {
    const end = detail.assignmentEnd;
    if (!end
        || end.generation !== record.assignment.generation
        || end.workerContext !== record.assignment.workerContext
        || !['completed', 'blocked', 'failed', 'deferred', ...HANDOFF_REASONS].includes(end.reason)) {
      throw new Error('active terminal transition requires exact assignment end identity');
    }
    if (HANDOFF_REASONS.has(end.reason)) {
      next.issues[issue].statusReason = detail.reason ?? end.reason;
      next.issues[issue].terminalDisposition = null;
      next.issues[issue].nextAction = 'capture-validated-orchestration-handoff';
      next.issues[issue].handoffObligation = {
        state: 'blocked',
        reason: 'handoff-required',
        condition: end.reason,
        generation: record.assignment.generation,
        workerContext: record.assignment.workerContext,
        requiredAt: end.endedAt ?? new Date().toISOString(),
      };
      next.events.push({
        type: 'handoff-required',
        issue,
        generation: record.assignment.generation,
        condition: end.reason,
      });
      return next;
    }
    const archived = {
      ...record.assignment,
      active: false,
      endReason: end.reason,
      endedAt: end.endedAt ?? new Date().toISOString(),
      ...(detail.handoff ? { handoff: structuredClone(detail.handoff) } : {}),
    };
    assertAssignment(archived, manifest.issues.find((entry) => entry.identity === issue), manifest, state, {
      active: false,
    });
    next.issues[issue].continuationChain.push(archived);
    next.issues[issue].assignment = null;
    next.issues[issue].handoffObligation = null;
  }
  if (!ISSUE_DISPOSITIONS.has(detail.terminalDisposition)) {
    throw new Error('terminal transition requires a valid issue disposition');
  }
  if (!DISPOSITIONS_BY_STATUS[status].has(detail.terminalDisposition)) {
    throw new Error(`terminal transition contradicts status ${status}`);
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

export function startCheckActivity(
  state,
  manifest,
  issue,
  kind,
  startedAt = new Date().toISOString(),
) {
  assertStateManifestAuthority(state, manifest, 'check activity state');
  const record = state.issues?.[issue];
  if (!record) throw new Error(`unknown issue: ${issue}`);
  if (!['quality-check', 'publication-observation', 'shepherd-check'].includes(kind)) {
    throw new Error('check activity kind is invalid');
  }
  if (!validTimestamp(startedAt)) throw new Error('check activity time is invalid');
  if (record.checkActivity !== null) throw new Error('issue already has an active check obligation');
  if (['failed', 'timed-out', 'deferred'].includes(record.status)
      || record.nextAction?.startsWith('await-')) {
    throw new Error('terminal or awaiting-human issue cannot start a check obligation');
  }
  const next = structuredClone(state);
  if (kind === 'shepherd-check') next.issues[issue].readinessGeneration += 1;
  next.issues[issue].checkActivity = {
    kind,
    state: 'active',
    startedAt,
    ...(kind === 'shepherd-check'
      ? { generation: next.issues[issue].readinessGeneration }
      : {}),
  };
  next.events.push({ type: 'check-activity-started', issue, kind });
  return next;
}

export function finishCheckActivity(state, manifest, issue) {
  assertStateManifestAuthority(state, manifest, 'check activity state');
  const record = state.issues?.[issue];
  if (!record?.checkActivity) throw new Error(`no explicit check activity for ${issue}`);
  const next = structuredClone(state);
  next.issues[issue].checkActivity = null;
  next.events.push({ type: 'check-activity-finished', issue, kind: record.checkActivity.kind });
  return next;
}

function markStoppedWork(next, nextAction) {
  for (const record of Object.values(next.issues)) {
    if (record.status === 'pending') {
      record.terminalDisposition = 'not-reached';
      record.nextAction = nextAction;
    } else if (record.status === 'active') {
      record.nextAction = 'capture-validated-orchestration-handoff';
      if (next.control.budgetExhausted) {
        record.handoffObligation = {
          state: 'blocked',
          reason: 'handoff-required',
          condition: 'exhausted',
          generation: record.assignment.generation,
          workerContext: record.assignment.workerContext,
          requiredAt: next.updatedAt,
        };
      }
    }
  }
}

export function consumeBudget(state, manifest, usage) {
  assertStateManifestAuthority(state, manifest, 'budget state');
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

export function cancelFleet(state, manifest, reason) {
  assertStateManifestAuthority(state, manifest, 'cancellation state');
  if (!nonEmpty(reason)) throw new Error('cancellation reason is required');
  const next = structuredClone(state);
  next.control.cancelled = true;
  next.control.cancellationReason = reason.trim();
  next.fleetDisposition = 'cancelled';
  markStoppedWork(next, 'await-new-human-invocation');
  next.events.push({ type: 'fleet-cancelled', reason: reason.trim() });
  return next;
}
