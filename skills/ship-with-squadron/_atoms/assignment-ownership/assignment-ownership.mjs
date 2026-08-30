import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeOrchestrationPayload } from '../../../_base/_molecules/persist-orchestration-handoff/persist-orchestration-handoff.mjs';
import { computeFrontier } from '../dependency-frontier/dependency-frontier.mjs';
import { assertFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  canonicalFilesystemIdentity,
  mutateFleetState,
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
const PACKET_FIELDS = Object.freeze([
  'schemaVersion', 'manifestDigest', 'issue', 'sourceRevision',
  'acceptanceCriteria', 'scope', 'exclusions', 'allowedPaths',
  'verification', 'reportContract', 'forbiddenAuthorities', 'taskContract',
  'branch', 'worktree', 'baseSha', 'headSha',
]);
const TASK_CONTRACT_FIELDS = Object.freeze([
  'goal', 'scope', 'context', 'acceptance', 'verify', 'timebox',
  'forbidden', 'report', 'standing',
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

function canonicalTaskContext(manifest, issue) {
  return JSON.stringify(stable({
    acceptedScope: manifest.acceptedScope,
    humanBoundaries: manifest.humanBoundaries,
    issue: issue.identity,
    repository: manifest.repository.id,
    sourceRevision: issue.sourceRevision,
  }));
}

function canonicalTaskTimebox(manifest) {
  return JSON.stringify(stable(manifest.budget));
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
  assertFleetManifest(manifest);
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
  if (!exactObjectKeys(packet, PACKET_FIELDS)) {
    defects.push('implementation packet schema is not exact');
  }
  if (packet.schemaVersion !== 1) defects.push('packet schema version is invalid');
  if (packet.manifestDigest !== state.manifestDigest || packet.manifestDigest !== manifest.digest) {
    defects.push('packet manifest digest is not current');
  }
  if (packet.issue !== issue.identity) defects.push('packet issue identity does not match');
  if (packet.sourceRevision !== issue.sourceRevision) defects.push('packet source revision does not match');
  if (!same(packet.acceptanceCriteria, issue.acceptanceCriteria)) defects.push('packet criteria do not match manifest');
  if (!same(packet.scope, issue.scope)) defects.push('packet scope does not match manifest');
  if (!same(packet.exclusions, manifest.exclusions)) defects.push('packet exclusions do not match manifest');
  if (!same(packet.allowedPaths, issue.allowedPaths)) defects.push('packet allowed paths do not match manifest');
  if (!same(packet.verification, manifest.validationPolicy)) {
    defects.push('packet verification contract does not exactly match confirmed validation policy');
  }
  if (!packet.reportContract || typeof packet.reportContract !== 'object'
      || !exactObjectKeys(packet.reportContract, ['summary', 'requiredEvidence'])
      || !nonEmpty(packet.reportContract.summary)
      || !same(packet.reportContract.requiredEvidence, manifest.validationPolicy)) {
    defects.push('packet report contract does not exactly derive from confirmed validation policy');
  }
  if (!same(packet.forbiddenAuthorities, FORBIDDEN_AUTHORITIES)) {
    defects.push('packet forbidden authorities are incomplete or reordered');
  }
  const taskContract = packet.taskContract;
  if (!exactObjectKeys(taskContract, TASK_CONTRACT_FIELDS)) {
    defects.push('packet task contract schema is not exact');
  } else {
    const acceptance = issue.acceptanceCriteria.map((criterion) => criterion.description);
    if (taskContract.goal !== manifest.goal) defects.push('packet task goal does not match manifest');
    if (taskContract.scope !== JSON.stringify(issue.scope)) defects.push('packet task scope does not match manifest');
    if (taskContract.context !== canonicalTaskContext(manifest, issue)) {
      defects.push('packet task context does not match manifest');
    }
    if (!same(taskContract.acceptance, acceptance)) defects.push('packet task acceptance does not match manifest');
    if (taskContract.verify !== packet.verification.join('\n')) defects.push('packet task verify contract differs');
    if (taskContract.timebox !== canonicalTaskTimebox(manifest)) {
      defects.push('packet task timebox does not match manifest budget');
    }
    if (taskContract.forbidden !== FORBIDDEN_AUTHORITIES.join('\n')) {
      defects.push('packet task forbidden contract differs');
    }
    if (taskContract.report !== JSON.stringify(stable(packet.reportContract))) {
      defects.push('packet task report contract differs');
    }
    if (taskContract.standing !== 'one-issue-one-branch-one-worktree-no-adjacent-work') {
      defects.push('packet task standing instruction differs');
    }
  }
  if (packet.branch !== input.branch || packet.worktree !== input.worktree) {
    defects.push('packet branch/worktree binding does not match assignment');
  }
  if (packet.baseSha !== input.baseSha || packet.headSha !== input.headSha) {
    defects.push('packet base/head revision binding does not match assignment');
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
  const requested = canonicalFilesystemIdentity(input.worktree);
  for (const assignment of allAssignments(state)) {
    if (assignment.workerContext === input.workerContext) throw new Error('worker context must be fresh');
    if (assignment.active && assignment.branch === input.branch) throw new Error(`branch already owned: ${input.branch}`);
    if (assignment.active
        && canonicalFilesystemIdentity(assignment.worktree).key === requested.key) {
      throw new Error(`worktree already owned: ${input.worktree}`);
    }
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
  const worktreeIdentity = canonicalFilesystemIdentity(input.worktree);
  if (worktreeIdentity.path !== input.worktree) {
    throw new Error('assignment worktree must be a normalized canonical filesystem path');
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
  next.issues[input.issue].handoffObligation = null;
  next.events.push({ type: 'assignment', issue: input.issue, generation });
  return reconcileFrontier(next, manifest, computeFrontier(manifest, next));
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
  if (!input.schedulerLease || !Number.isInteger(input.schedulerLease.stateRevision)) {
    throw new Error('persisted assignment requires a state-revision-bound scheduler lease');
  }
  return mutateFleetState(
    file,
    manifest,
    input.schedulerLease.stateRevision,
    (state) => {
      const schedulerLease = createSchedulerLease(state, manifest, input.issue);
      if (!same(input.schedulerLease, schedulerLease)) {
        throw new Error('persisted assignment did not consume the current scheduler lease');
      }
      return assignFreshWorker(state, manifest, input);
    },
    options,
  );
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
  ['source_revision', 'sourceRevision'],
  ['allowed_paths', 'allowedPaths'],
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

function handoffBindingRecord(expected, submitted) {
  return {
    runId: expected?.runId ?? null,
    issue: expected?.issue ?? null,
    priorGeneration: expected?.priorGeneration ?? null,
    branch: expected?.branch ?? null,
    worktree: expected?.worktree ?? null,
    baseSha: expected?.baseSha ?? null,
    headSha: expected?.headSha ?? null,
    manifestDigest: expected?.manifestDigest ?? null,
    sourceRevision: expected?.sourceRevision ?? null,
    stateRevision: expected?.stateRevision ?? null,
    sourceAgent: expected?.sourceAgent ?? null,
    targetAgent: expected?.targetAgent ?? null,
    inputs: REQUIRED_HANDOFF_INPUTS.map(([name]) =>
      structuredClone(payloadBinding(submitted, name) ?? null)),
  };
}

export function validateContinuationHandoff(handoff, payload, expected = null) {
  const defects = [];
  let normalizedPayload = null;
  try {
    normalizedPayload = normalizeOrchestrationPayload(payload);
  } catch (error) {
    defects.push(`orchestration payload is invalid: ${error.code ?? error.message}`);
  }
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
  const submitted = normalizedPayload ?? payload;
  if (submitted?.schema_version !== 1) defects.push('orchestration payload schema_version must be 1');
  if (expected && submitted?.run_identity?.run_id !== expected.runId) defects.push('payload run identity does not match');
  if (expected && submitted?.source_agent?.id !== expected.sourceAgent) defects.push('payload source agent does not match');
  if (expected && submitted?.target_agent?.id !== expected.targetAgent) defects.push('payload target agent does not match');
  for (const field of [
    'task_contract', 'inputs', 'constraints', 'assumptions',
    'artifacts_and_references', 'acceptance_criteria', 'open_questions',
  ]) {
    if (!(field in (submitted ?? {}))) defects.push(`payload ${field} is absent`);
  }
  if (!Array.isArray(submitted?.acceptance_criteria)
      || submitted.acceptance_criteria.length === 0
      || submitted.acceptance_criteria.some((entry) => !nonEmpty(entry))) {
    defects.push('payload acceptance criteria are incomplete');
  }
  for (const section of BRIEF_SECTIONS) {
    const field = {
      GOAL: 'goal', SCOPE: 'scope', CONTEXT: 'context', VERIFY: 'verify',
      TIMEBOX: 'timebox', FORBIDDEN: 'forbidden', REPORT: 'report', STANDING: 'standing',
    }[section];
    if (field && !nonEmpty(submitted?.task_contract?.[field])) {
      defects.push(`payload brief section ${section} is absent`);
    }
  }
  if (expected) {
    for (const [inputName, expectedField] of REQUIRED_HANDOFF_INPUTS) {
      const bindings = submitted.inputs.filter((entry) => entry?.name === inputName);
      const binding = bindings[0];
      if (bindings.length !== 1
          || !binding
          || String(binding.value) !== String(expected[expectedField])
          || !nonEmpty(binding.source)) {
        defects.push(`payload binding ${inputName} does not match`);
      }
    }
    if (!same(submitted.acceptance_criteria, expected.acceptanceCriteria)) {
      defects.push('payload acceptance criteria do not match the confirmed issue');
    }
    const continuedContract = {
      ...submitted.task_contract,
      acceptance: submitted.acceptance_criteria,
    };
    if (!same(stable(continuedContract), stable(expected.taskContract))) {
      defects.push('payload task contract does not match the original manifest-bound assignment');
    }
  }
  return { valid: defects.length === 0, defects };
}

function directoryChain(directory) {
  const resolved = path.resolve(directory);
  const parsed = path.parse(resolved);
  const relative = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const chain = [parsed.root];
  let cursor = parsed.root;
  for (const component of relative) {
    cursor = path.join(cursor, component);
    chain.push(cursor);
  }
  return chain;
}

function snapshotDirectoryChain(directory) {
  return directoryChain(directory).map((entry) => {
    const stat = fs.lstatSync(entry, { bigint: true });
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('trusted handoff directory chain is not entirely real directories');
    }
    return {
      path: entry,
      dev: stat.dev,
      ino: stat.ino,
      mode: stat.mode,
      uid: stat.uid,
    };
  });
}

function sameDirectoryChain(before) {
  try {
    const after = snapshotDirectoryChain(before.at(-1).path);
    return before.length === after.length && before.every((entry, index) =>
      entry.path === after[index].path
      && entry.dev === after[index].dev
      && entry.ino === after[index].ino
      && entry.mode === after[index].mode
      && entry.uid === after[index].uid);
  } catch {
    return false;
  }
}

function sameResolvedPath(left, right) {
  const normalizedLeft = path.normalize(path.resolve(left));
  const normalizedRight = path.normalize(path.resolve(right));
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function trustedHandoffRoot() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const root = path.join(tempRoot, 'handoffs');
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('trusted handoff run directory must be a real non-symlink directory');
  }
  const rootReal = fs.realpathSync(root);
  if (!sameResolvedPath(rootReal, root)) {
    throw new Error('trusted handoff run directory resolved through a link or reparse point');
  }
  const chain = snapshotDirectoryChain(rootReal);
  if (typeof process.getuid === 'function') {
    const rootEntry = chain.at(-1);
    if (Number(rootEntry.uid) !== process.getuid() || (Number(rootEntry.mode) & 0o022) !== 0) {
      throw new Error('trusted handoff run directory ownership or mode is unsafe');
    }
  }
  return { root: rootReal, chain };
}

function safeReadReturnedArtifact(handoff, options = {}) {
  if (!path.isAbsolute(handoff.path) || !path.isAbsolute(handoff.directory)) {
    throw new Error('artifact path and returned directory must be absolute');
  }
  const trusted = trustedHandoffRoot();
  if (handoff.directory !== trusted.root || path.dirname(handoff.path) !== trusted.root) {
    throw new Error('handoff artifact escapes the runtime-trusted handoff directory');
  }
  if (path.basename(handoff.path) !== handoff.name
      || handoff.path !== path.join(trusted.root, handoff.name)) {
    throw new Error('handoff artifact path is not the exact returned direct child');
  }
  const beforePath = fs.lstatSync(handoff.path, { bigint: true });
  if (beforePath.isSymbolicLink() || !beforePath.isFile()
      || !sameResolvedPath(fs.realpathSync(handoff.path), handoff.path)) {
    throw new Error('handoff artifact is a link, reparse point, or non-file');
  }
  const noFollow = options.forcePortableFallback
    ? 0
    : Number.isInteger(fs.constants.O_NOFOLLOW)
      ? fs.constants.O_NOFOLLOW
      : 0;
  const flags = fs.constants.O_RDONLY | noFollow;
  const handle = fs.openSync(handoff.path, flags);
  try {
    const before = fs.fstatSync(handle, { bigint: true });
    if (!before.isFile()
        || before.dev !== beforePath.dev
        || before.ino !== beforePath.ino
        || before.size !== beforePath.size
        || before.mtimeNs !== beforePath.mtimeNs
        || before.ctimeNs !== beforePath.ctimeNs) {
      throw new Error('handoff artifact descriptor is not the same regular file');
    }
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
        || after.ctimeNs !== pathStat.ctimeNs
        || !sameResolvedPath(fs.realpathSync(handoff.path), handoff.path)
        || !sameDirectoryChain(trusted.chain)) {
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
  const submitted = normalizeOrchestrationPayload(payload);
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
      const binding = payloadBinding(submitted, inputName);
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
    bindingRecord: handoffBindingRecord(expected, submitted),
    bindingsDigest: digest(handoffBindingRecord(expected, submitted)),
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
  if (allAssignments(state).some((assignment) => assignment.workerContext === input.workerContext)) {
    throw new Error('worker context must be fresh');
  }
  const continuationIdentity = canonicalFilesystemIdentity(input.worktree);
  const ownedIdentity = canonicalFilesystemIdentity(record.assignment.worktree);
  if (continuationIdentity.key !== ownedIdentity.key
      || continuationIdentity.path !== record.assignment.worktree) {
    throw new Error('continuation worktree identity differs from the owned worktree');
  }
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
    sourceRevision: issue.sourceRevision,
    allowedPaths: JSON.stringify(issue.allowedPaths),
    taskContract: record.assignment.packet.taskContract,
  };
  const handoff = validateContinuationHandoff(input.handoff, input.handoffPayload, expected);
  if (!handoff.valid) throw new Error(`invalid orchestration handoff: ${handoff.defects.join('; ')}`);
  const artifact = validateContinuationArtifact(
    input.handoff,
    input.handoffPayload,
    expected,
  );
  if (!artifact.valid) throw new Error(`invalid orchestration handoff artifact: ${artifact.defects.join('; ')}`);
  const packet = validateBoundedPacket(input.packet, state, manifest, issue, {
    ...input,
    baseSha: record.assignment.baseSha,
    headSha: record.assignment.headSha,
  });
  if (!packet.valid) throw new Error(`invalid continuation packet: ${packet.defects.join('; ')}`);
  if (!same(stable(input.packet), stable(record.assignment.packet))) {
    throw new Error('continuation packet differs from the original manifest-bound assignment');
  }

  const next = structuredClone(state);
  const prior = {
    ...next.issues[input.issue].assignment,
    active: false,
    endReason: input.reason,
    endedAt: input.endedAt ?? new Date().toISOString(),
    handoff: {
      path: input.handoff.path,
      directory: input.handoff.directory,
      identity: {
        runId: expected.runId,
        issue: expected.issue,
        priorGeneration: expected.priorGeneration,
        sourceAgent: expected.sourceAgent,
        targetAgent: expected.targetAgent,
      },
      bindingRecord: structuredClone(artifact.bindingRecord),
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
  next.issues[input.issue].handoffObligation = null;
  next.events.push({
    type: 'assignment-continuation',
    issue: input.issue,
    fromGeneration: prior.generation,
    toGeneration: prior.generation + 1,
    reason: input.reason,
  });
  return next;
}

export function releaseAfterValidatedHandoff(state, manifest, input) {
  if (!manifest) throw new Error('confirmed manifest is required for handoff release');
  assertManifestAuthority(state, manifest);
  const record = state.issues?.[input.issue];
  const issue = manifestIssue(manifest, input.issue);
  if (!record?.assignment?.active || record.status !== 'active') {
    throw new Error('handoff release requires an active prior assignment');
  }
  if (!['stalled', 'exhausted', 'timed-out', 'crashed'].includes(input.reason)) {
    throw new Error('handoff release reason is not a terminal worker condition');
  }
  if (!nonEmpty(input.targetAgent)) {
    throw new Error('handoff release requires an explicit target agent identity');
  }
  const expected = {
    runId: state.runId,
    issue: input.issue,
    priorGeneration: record.assignment.generation,
    branch: record.assignment.branch,
    worktree: record.assignment.worktree,
    sourceAgent: record.assignment.workerContext,
    targetAgent: input.targetAgent,
    baseSha: record.assignment.baseSha,
    headSha: record.assignment.headSha,
    manifestDigest: manifest.digest,
    stateRevision: state.revision,
    acceptanceCriteria: issue.acceptanceCriteria.map((criterion) => criterion.description),
    sourceRevision: issue.sourceRevision,
    allowedPaths: JSON.stringify(issue.allowedPaths),
    taskContract: record.assignment.packet.taskContract,
  };
  const handoff = validateContinuationHandoff(input.handoff, input.handoffPayload, expected);
  if (!handoff.valid) throw new Error(`invalid orchestration handoff: ${handoff.defects.join('; ')}`);
  const artifact = validateContinuationArtifact(
    input.handoff,
    input.handoffPayload,
    expected,
  );
  if (!artifact.valid) {
    throw new Error(`invalid orchestration handoff artifact: ${artifact.defects.join('; ')}`);
  }

  const endedAt = input.endedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(endedAt))) throw new Error('handoff release time is invalid');
  const archived = {
    ...record.assignment,
    active: false,
    endReason: input.reason,
    endedAt,
    handoff: {
      path: input.handoff.path,
      directory: input.handoff.directory,
      identity: {
        runId: expected.runId,
        issue: expected.issue,
        priorGeneration: expected.priorGeneration,
        sourceAgent: expected.sourceAgent,
        targetAgent: expected.targetAgent,
      },
      bindingRecord: structuredClone(artifact.bindingRecord),
      artifactSha256: artifact.digest,
      bindingsSha256: artifact.bindingsDigest,
    },
  };
  const next = structuredClone(state);
  next.issues[input.issue].continuationChain.push(archived);
  next.issues[input.issue].assignment = null;
  next.issues[input.issue].handoffObligation = null;
  next.issues[input.issue].status = input.reason === 'timed-out' ? 'timed-out' : 'blocked';
  next.issues[input.issue].statusReason = input.reason;
  next.issues[input.issue].terminalDisposition = input.reason === 'timed-out'
    ? 'timed-out-with-handoff'
    : 'blocked';
  next.issues[input.issue].nextAction = input.nextAction ?? 'await-human-direction';
  next.events.push({
    type: 'assignment-released-after-handoff',
    issue: input.issue,
    generation: record.assignment.generation,
    reason: input.reason,
  });
  return reconcileFrontier(next, manifest, computeFrontier(manifest, next));
}

export { FORBIDDEN_AUTHORITIES };
