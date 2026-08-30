import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeFrontier } from '../dependency-frontier/dependency-frontier.mjs';
import {
  loadFleetState,
  persistFleetState,
  reconcileFrontier,
} from '../fleet-state/fleet-state.mjs';

const BRIEF_SECTIONS = ['GOAL', 'SCOPE', 'CONTEXT', 'ACCEPTANCE', 'VERIFY', 'TIMEBOX', 'FORBIDDEN', 'REPORT', 'STANDING'];
const FORBIDDEN_AUTHORITIES = Object.freeze([
  'merge',
  'approve',
  'enable-auto-merge',
  'accept-risk',
  'force-push',
  'close-tracker-work',
  'select-adjacent-work',
]);

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function allAssignments(state) {
  return Object.values(state.issues).flatMap((issue) => [
    ...(issue.assignment ? [issue.assignment] : []),
    ...(issue.continuationChain ?? []),
  ]);
}

function manifestIssue(manifest, issue) {
  const record = manifest?.issues?.find((entry) => entry.identity === issue);
  if (!record) throw new Error(`unknown manifest issue: ${issue}`);
  return record;
}

function assertManifestAuthority(state, manifest) {
  if (state.manifestDigest !== manifest?.digest
      || state.providerConfigurationDigest !== manifest?.providerConfigurationDigest) {
    throw new Error('assignment state is not bound to the confirmed manifest');
  }
  if (!state.control
      || typeof state.control.cancelled !== 'boolean'
      || typeof state.control.budgetExhausted !== 'boolean') {
    throw new Error('assignment state has no validated fleet control');
  }
}

function validateBoundedPacket(packet, state, manifest, issue, input) {
  const defects = [];
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) {
    return { valid: false, defects: ['implementation packet is absent'] };
  }
  if (packet.manifestDigest !== state.manifestDigest || packet.manifestDigest !== manifest.digest) {
    defects.push('packet manifest digest is not current');
  }
  if (packet.issue !== issue.identity) defects.push('packet issue identity does not match');
  if (packet.sourceRevision !== issue.sourceRevision) defects.push('packet source revision does not match');
  if (!same(packet.acceptanceCriteria, issue.acceptanceCriteria)) defects.push('packet criteria do not match manifest');
  if (!same(packet.scope, issue.scope)) defects.push('packet scope does not match manifest');
  if (!same(packet.exclusions, manifest.exclusions)) defects.push('packet exclusions do not match manifest');
  if (!same(packet.allowedPaths, issue.allowedPaths)) defects.push('packet allowed paths do not match manifest');
  if (!Array.isArray(packet.verification) || packet.verification.length === 0
      || packet.verification.some((entry) => !nonEmpty(entry))) {
    defects.push('packet verification contract is incomplete');
  }
  if (!packet.reportContract || typeof packet.reportContract !== 'object'
      || !nonEmpty(packet.reportContract.summary)
      || !Array.isArray(packet.reportContract.requiredEvidence)
      || packet.reportContract.requiredEvidence.length === 0) {
    defects.push('packet report contract is incomplete');
  }
  if (!same(packet.forbiddenAuthorities, FORBIDDEN_AUTHORITIES)) {
    defects.push('packet forbidden authorities are incomplete or reordered');
  }
  if (packet.branch !== input.branch || packet.worktree !== input.worktree) {
    defects.push('packet branch/worktree binding does not match assignment');
  }
  return { valid: defects.length === 0, defects };
}

function validateSourceObservation(record, state, manifest, issue) {
  const source = record.sourceObservation;
  return source?.status === 'observed'
    && source?.terminal === true
    && source?.complete === true
    && source?.provider === manifest.provider.name
    && source?.repository === manifest.repository.id
    && source?.issue === issue.identity
    && source?.revision === issue.sourceRevision
    && source?.manifestDigest === state.manifestDigest;
}

function ensureFreshOwnership(state, input) {
  for (const assignment of allAssignments(state)) {
    if (assignment.workerContext === input.workerContext) throw new Error('worker context must be fresh');
    if (assignment.active && assignment.branch === input.branch) throw new Error(`branch already owned: ${input.branch}`);
    if (assignment.active && assignment.worktree === input.worktree) throw new Error(`worktree already owned: ${input.worktree}`);
  }
}

export function assignFreshWorker(state, manifest, input) {
  if (!manifest) throw new Error('confirmed manifest is required for assignment');
  assertManifestAuthority(state, manifest);
  const record = state.issues?.[input.issue];
  const issue = manifestIssue(manifest, input.issue);
  if (!record) throw new Error(`unknown issue: ${input.issue}`);
  if (state.control?.cancelled || state.control?.budgetExhausted) {
    throw new Error('new assignments are forbidden after cancellation or budget exhaustion');
  }
  if (record.status !== 'pending' || record.assignment !== null) {
    throw new Error(`issue is not pending and unowned: ${input.issue}`);
  }
  if (record.terminalDisposition !== null) {
    throw new Error(`terminal issue cannot be reassigned: ${input.issue}`);
  }
  const frontier = computeFrontier(manifest, state);
  const expectedLease = createSchedulerLease(state, manifest, input.issue, frontier);
  if (!same(input.schedulerLease, expectedLease)) {
    throw new Error('assignment scheduler lease is stale, forged, or not dispatchable');
  }
  if (!validateSourceObservation(record, state, manifest, issue)) {
    throw new Error(`source revision is not reobserved for ${input.issue}`);
  }
  if (!nonEmpty(input.branch) || !nonEmpty(input.worktree) || !nonEmpty(input.workerContext)
      || !nonEmpty(input.baseSha) || !nonEmpty(input.headSha)) {
    throw new Error('assignment requires branch, worktree, workerContext, baseSha, and headSha');
  }
  ensureFreshOwnership(state, input);
  const packet = validateBoundedPacket(input.packet, state, manifest, issue, input);
  if (!packet.valid) throw new Error(`invalid implementation packet: ${packet.defects.join('; ')}`);

  const next = structuredClone(state);
  const generation = (record.continuationChain?.at(-1)?.generation ?? 0) + 1;
  next.issues[input.issue].assignment = {
    generation,
    workerContext: input.workerContext,
    branch: input.branch,
    worktree: input.worktree,
    baseSha: input.baseSha,
    headSha: input.headSha,
    packet: structuredClone(input.packet),
    active: true,
    startedAt: input.startedAt ?? new Date().toISOString(),
  };
  next.issues[input.issue].baseSha = input.baseSha;
  next.issues[input.issue].headSha = input.headSha;
  next.issues[input.issue].branch = input.branch;
  next.issues[input.issue].worktree = input.worktree;
  next.issues[input.issue].status = 'active';
  next.issues[input.issue].dependencyState = 'active';
  next.events.push({ type: 'assignment', issue: input.issue, generation });
  return reconcileFrontier(next, computeFrontier(manifest, next));
}

export function createSchedulerLease(state, manifest, issue, frontier = computeFrontier(manifest, state)) {
  const dispatch = frontier.capacity.dispatch.map((entry) => entry.issue);
  if (!dispatch.includes(issue)) throw new Error(`issue is not in current capacity.dispatch: ${issue}`);
  return {
    schemaVersion: 1,
    manifestDigest: manifest.digest,
    providerConfigurationDigest: manifest.providerConfigurationDigest,
    stateRevision: state.revision,
    issue,
    concurrency: manifest.concurrency,
    activeCount: frontier.capacity.active,
    dispatchDigest: digest({
      stateRevision: state.revision,
      dispatch,
      ready: frontier.ready,
      blocked: frontier.blocked,
      observedHumanMerges: state.observedHumanMerges,
      issueSetObservation: state.issueSetObservation,
    }),
  };
}

export function assignFreshWorkerPersisted(file, manifest, input, options = {}) {
  const state = loadFleetState(file, manifest);
  const schedulerLease = createSchedulerLease(state, manifest, input.issue);
  const assigned = assignFreshWorker(state, manifest, { ...input, schedulerLease });
  return persistFleetState(file, assigned, schedulerLease.stateRevision, manifest, options);
}

const HANDOFF_RESULT_KEYS = [
  'path', 'directory', 'name', 'bytes', 'headings', 'redactions',
  'suggested_skills_included',
];
const REQUIRED_HANDOFF_INPUTS = [
  ['issue', 'issue'],
  ['prior_generation', 'priorGeneration'],
  ['branch', 'branch'],
  ['worktree', 'worktree'],
  ['base_sha', 'baseSha'],
  ['head_sha', 'headSha'],
  ['manifest_digest', 'manifestDigest'],
  ['state_revision', 'stateRevision'],
];

function exactObjectKeys(value, expected) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && same(Object.keys(value).sort(), [...expected].sort());
}

function payloadBinding(payload, name) {
  return payload?.inputs?.find((entry) => entry?.name === name);
}

export function validateContinuationHandoff(handoff, payload, expected = null) {
  const defects = [];
  if (!exactObjectKeys(handoff, HANDOFF_RESULT_KEYS)) {
    defects.push('handoff result does not match the persisted orchestration result contract');
  }
  if (!nonEmpty(handoff?.path) || !nonEmpty(handoff?.directory) || !nonEmpty(handoff?.name)) {
    defects.push('handoff result path, directory, or name is absent');
  }
  if (!Number.isInteger(handoff?.bytes) || handoff.bytes < 1) defects.push('handoff result bytes are invalid');
  if (!Array.isArray(handoff?.headings)
      || !Array.isArray(handoff?.redactions)
      || typeof handoff?.suggested_skills_included !== 'boolean') {
    defects.push('handoff result metadata is malformed');
  }
  if (path.dirname(handoff?.path ?? '') !== handoff?.directory
      || path.basename(handoff?.path ?? '') !== handoff?.name) {
    defects.push('handoff result directory/name do not bind the returned path');
  }
  if (payload?.schema_version !== 1) defects.push('orchestration payload schema_version must be 1');
  if (expected && payload?.run_identity?.run_id !== expected.runId) defects.push('payload run identity does not match');
  if (expected && payload?.source_agent?.id !== expected.sourceAgent) defects.push('payload source agent does not match');
  if (expected && payload?.target_agent?.id !== expected.targetAgent) defects.push('payload target agent does not match');
  for (const field of [
    'task_contract', 'inputs', 'constraints', 'assumptions',
    'artifacts_and_references', 'acceptance_criteria', 'open_questions',
  ]) {
    if (!(field in (payload ?? {}))) defects.push(`payload ${field} is absent`);
  }
  if (!Array.isArray(payload?.acceptance_criteria)
      || payload.acceptance_criteria.length === 0
      || payload.acceptance_criteria.some((entry) => !nonEmpty(entry))) {
    defects.push('payload acceptance criteria are incomplete');
  }
  for (const section of BRIEF_SECTIONS) {
    const field = {
      GOAL: 'goal', SCOPE: 'scope', CONTEXT: 'context', VERIFY: 'verify',
      TIMEBOX: 'timebox', FORBIDDEN: 'forbidden', REPORT: 'report', STANDING: 'standing',
    }[section];
    if (field && !nonEmpty(payload?.task_contract?.[field])) {
      defects.push(`payload brief section ${section} is absent`);
    }
  }
  if (expected) {
    for (const [inputName, expectedField] of REQUIRED_HANDOFF_INPUTS) {
      const bindings = payload.inputs.filter((entry) => entry?.name === inputName);
      const binding = bindings[0];
      if (bindings.length !== 1
          || !binding
          || String(binding.value) !== String(expected[expectedField])
          || !nonEmpty(binding.source)) {
        defects.push(`payload binding ${inputName} does not match`);
      }
    }
    if (!same(payload.acceptance_criteria, expected.acceptanceCriteria)) {
      defects.push('payload acceptance criteria do not match the confirmed issue');
    }
  }
  return { valid: defects.length === 0, defects };
}

function trustedHandoffRoot() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const root = path.join(tempRoot, 'handoffs');
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('trusted handoff run directory must be a real non-symlink directory');
  }
  const rootReal = fs.realpathSync(root);
  if (rootReal !== root) throw new Error('trusted handoff run directory resolved through a link');
  return rootReal;
}

function safeReadReturnedArtifact(handoff, options = {}) {
  if (!path.isAbsolute(handoff.path) || !path.isAbsolute(handoff.directory)) {
    throw new Error('artifact path and returned directory must be absolute');
  }
  const trusted = trustedHandoffRoot();
  if (handoff.directory !== trusted || path.dirname(handoff.path) !== trusted) {
    throw new Error('handoff artifact escapes the runtime-trusted handoff directory');
  }
  if (path.basename(handoff.path) !== handoff.name || handoff.path !== path.join(trusted, handoff.name)) {
    throw new Error('handoff artifact path is not the exact returned direct child');
  }
  if (!Number.isInteger(fs.constants.O_NOFOLLOW) || fs.constants.O_NOFOLLOW === 0) {
    throw new Error('runtime cannot establish O_NOFOLLOW handoff containment');
  }
  const flags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW;
  const handle = fs.openSync(handoff.path, flags);
  try {
    const before = fs.fstatSync(handle, { bigint: true });
    if (!before.isFile()) throw new Error('handoff artifact descriptor is not a regular file');
    options.afterOpen?.();
    const content = fs.readFileSync(handle);
    const after = fs.fstatSync(handle, { bigint: true });
    const pathStat = fs.lstatSync(handoff.path, { bigint: true });
    if (pathStat.isSymbolicLink() || !pathStat.isFile()
        || before.dev !== after.dev || before.ino !== after.ino
        || before.size !== after.size || before.mtimeNs !== after.mtimeNs
        || before.ctimeNs !== after.ctimeNs
        || after.dev !== pathStat.dev || after.ino !== pathStat.ino
        || after.size !== pathStat.size || after.mtimeNs !== pathStat.mtimeNs
        || after.ctimeNs !== pathStat.ctimeNs) {
      throw new Error('handoff artifact changed while being verified');
    }
    return content;
  } finally {
    fs.closeSync(handle);
  }
}

export function validateContinuationArtifact(handoff, payload, expected = null, options = {}) {
  const result = validateContinuationHandoff(handoff, payload, expected);
  if (!result.valid) return result;
  let bytes;
  try {
    bytes = safeReadReturnedArtifact(handoff, options);
  } catch (error) {
    return { valid: false, defects: [`artifact reread failed: ${error.code ?? error.message}`] };
  }
  const content = bytes.toString('utf8');
  const artifactDigest = crypto.createHash('sha256').update(bytes).digest('hex');
  const defects = [];
  if (bytes.length !== handoff.bytes) defects.push('artifact byte count does not match returned metadata');
  const headings = content.split('\n').filter((line) => line.startsWith('## ')).map((line) => line.slice(3));
  if (!same(headings, handoff.headings)) defects.push('artifact headings do not match returned metadata');
  for (const section of BRIEF_SECTIONS) {
    if (!new RegExp(`(^|\\n)(?:#+\\s+)?${section}(?:\\s*:)?\\s*$`, 'm').test(content)) {
      defects.push(`artifact section ${section} is absent`);
    }
  }
  if (expected) {
    for (const [inputName, expectedField] of REQUIRED_HANDOFF_INPUTS) {
      const binding = payloadBinding(payload, inputName);
      const rendered = `- ${inputName}: ${binding.value} (source: ${binding.source})`;
      if (!new RegExp(`(^|\\n)${escapeRegExp(rendered)}\\s*$`, 'm').test(content)) {
        defects.push(`artifact binding ${inputName} is absent`);
      }
    }
    for (const id of [expected.sourceAgent, expected.targetAgent]) {
      if (!new RegExp(`(^|\\n)- id: ${escapeRegExp(id)}\\s*$`, 'm').test(content)) {
        defects.push(`artifact agent binding ${id} is absent`);
      }
    }
  }
  return {
    valid: defects.length === 0,
    defects,
    digest: artifactDigest,
    bindingsDigest: digest({
      runId: expected?.runId,
      sourceAgent: expected?.sourceAgent,
      targetAgent: expected?.targetAgent,
      inputs: REQUIRED_HANDOFF_INPUTS.map(([name]) => payloadBinding(payload, name)),
    }),
    content,
  };
}

export function continueWithFreshWorker(state, manifest, input) {
  if (!manifest) throw new Error('confirmed manifest is required for continuation');
  assertManifestAuthority(state, manifest);
  const record = state.issues?.[input.issue];
  const issue = manifestIssue(manifest, input.issue);
  if (!record?.assignment?.active || record.status !== 'active') {
    throw new Error('continuation requires an active prior assignment');
  }
  if (state.control?.cancelled || state.control?.budgetExhausted) {
    throw new Error('handoff remains required but continuation dispatch is forbidden after fleet stop');
  }
  if (!['stalled', 'exhausted', 'timed-out', 'crashed'].includes(input.reason)) {
    throw new Error('continuation reason is not a terminal worker condition');
  }
  if (input.branch !== record.assignment.branch || input.worktree !== record.assignment.worktree) {
    throw new Error('continuation must retain the owned branch and worktree');
  }
  if (!nonEmpty(input.workerContext)) {
    throw new Error('continuation requires a fresh worker context');
  }
  ensureFreshOwnership(state, {
    workerContext: input.workerContext,
    branch: `${input.branch}\0continuation`,
    worktree: `${input.worktree}\0continuation`,
  });
  const expected = {
    runId: state.runId,
    issue: input.issue,
    priorGeneration: record.assignment.generation,
    branch: record.assignment.branch,
    worktree: record.assignment.worktree,
    sourceAgent: record.assignment.workerContext,
    targetAgent: input.workerContext,
    baseSha: record.assignment.baseSha,
    headSha: record.assignment.headSha,
    manifestDigest: manifest.digest,
    stateRevision: state.revision,
    acceptanceCriteria: issue.acceptanceCriteria.map((criterion) => criterion.description),
  };
  const handoff = validateContinuationHandoff(input.handoff, input.handoffPayload, expected);
  if (!handoff.valid) throw new Error(`invalid orchestration handoff: ${handoff.defects.join('; ')}`);
  const artifact = validateContinuationArtifact(
    input.handoff,
    input.handoffPayload,
    expected,
  );
  if (!artifact.valid) throw new Error(`invalid orchestration handoff artifact: ${artifact.defects.join('; ')}`);
  const packet = validateBoundedPacket(input.packet, state, manifest, issue, input);
  if (!packet.valid) throw new Error(`invalid continuation packet: ${packet.defects.join('; ')}`);

  const next = structuredClone(state);
  const prior = {
    ...next.issues[input.issue].assignment,
    active: false,
    endReason: input.reason,
    endedAt: input.endedAt ?? new Date().toISOString(),
    handoff: {
      path: input.handoff.path,
      directory: input.handoff.directory,
      artifactSha256: artifact.digest,
      bindingsSha256: artifact.bindingsDigest,
    },
  };
  next.issues[input.issue].continuationChain.push(prior);
  next.issues[input.issue].assignment = {
    generation: prior.generation + 1,
    workerContext: input.workerContext,
    branch: prior.branch,
    worktree: prior.worktree,
    baseSha: prior.baseSha,
    headSha: prior.headSha,
    packet: structuredClone(input.packet),
    active: true,
    startedAt: input.startedAt ?? new Date().toISOString(),
  };
  next.issues[input.issue].status = 'active';
  next.issues[input.issue].dependencyState = 'active';
  next.events.push({
    type: 'assignment-continuation',
    issue: input.issue,
    fromGeneration: prior.generation,
    toGeneration: prior.generation + 1,
    reason: input.reason,
  });
  return next;
}

export { FORBIDDEN_AUTHORITIES };
