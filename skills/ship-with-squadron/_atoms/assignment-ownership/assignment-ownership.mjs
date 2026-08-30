import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HANDOFF_FIELDS = [
  'run_identity', 'source_agent', 'target_agent', 'task_contract', 'inputs',
  'constraints', 'assumptions', 'artifacts_and_references',
  'acceptance_criteria', 'open_questions',
];
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
  return next;
}

export function validateContinuationHandoff(handoff, expected = null) {
  const defects = [];
  if (handoff?.invocation_skill !== 'orchestration-handoff') defects.push('invocation_skill must be orchestration-handoff');
  if (handoff?.persistence_status !== 'created') defects.push('persistence_status must be created');
  if (handoff?.schema_version !== 1) defects.push('schema_version must be 1');
  for (const field of HANDOFF_FIELDS) {
    if (!(field in (handoff ?? {}))) defects.push(`${field} is absent`);
  }
  if (!nonEmpty(handoff?.path)) defects.push('path is absent');
  if (!nonEmpty(handoff?.artifact_sha256) || !/^[a-f0-9]{64}$/.test(handoff.artifact_sha256)) {
    defects.push('artifact_sha256 is absent or invalid');
  }
  if (!nonEmpty(handoff?.fresh_consolidated_brief)) {
    defects.push('fresh_consolidated_brief is absent');
  } else {
    for (const section of BRIEF_SECTIONS) {
      if (!new RegExp(`(^|\\n)${section}:`, 'm').test(handoff.fresh_consolidated_brief)) {
        defects.push(`brief section ${section} is absent`);
      }
    }
  }
  if (expected) {
    if (!handoff.bindings || typeof handoff.bindings !== 'object') {
      defects.push('handoff bindings are absent');
    } else {
      for (const [field, value] of Object.entries(expected)) {
        if (handoff.bindings[field] !== value) defects.push(`handoff binding ${field} does not match`);
      }
    }
  }
  return { valid: defects.length === 0, defects };
}

function realFileWithinRoot(file, allowedRoot) {
  if (!path.isAbsolute(file) || !path.isAbsolute(allowedRoot)) {
    return { valid: false, defects: ['artifact path and allowed root must be absolute'] };
  }
  let rootReal;
  let fileReal;
  try {
    const rootStat = fs.lstatSync(allowedRoot);
    const fileStat = fs.lstatSync(file);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      return { valid: false, defects: ['allowed handoff root must be a real directory'] };
    }
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      return { valid: false, defects: ['handoff artifact must be a regular non-symlink file'] };
    }
    rootReal = fs.realpathSync(allowedRoot);
    fileReal = fs.realpathSync(file);
  } catch (error) {
    return { valid: false, defects: [`artifact reread failed: ${error.code ?? error.message}`] };
  }
  if (fileReal !== rootReal && !fileReal.startsWith(`${rootReal}${path.sep}`)) {
    return { valid: false, defects: ['handoff artifact escapes the allowed root'] };
  }
  return { valid: true, defects: [], fileReal };
}

function bindingPatterns(expected) {
  return [
    ['runId', `- run_id: ${expected.runId}`],
    ['issue', `- issue: ${expected.issue}`],
    ['priorGeneration', `- prior_generation: ${expected.priorGeneration}`],
    ['branch', `- branch: ${expected.branch}`],
    ['worktree', `- worktree: ${expected.worktree}`],
    ['baseSha', `- base_sha: ${expected.baseSha}`],
    ['headSha', `- head_sha: ${expected.headSha}`],
    ['sourceAgent', `- id: ${expected.sourceAgent}`],
    ['targetAgent', `- id: ${expected.targetAgent}`],
  ];
}

export function validateContinuationArtifact(file, handoff, allowedRoot, expected = null) {
  if (handoff?.path !== file) return { valid: false, defects: ['artifact path does not match handoff path'] };
  const safe = realFileWithinRoot(file, allowedRoot);
  if (!safe.valid) return safe;
  let content;
  try {
    content = fs.readFileSync(safe.fileReal, 'utf8');
  } catch (error) {
    return { valid: false, defects: [`artifact reread failed: ${error.code ?? error.message}`] };
  }
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  const defects = [];
  if (digest !== handoff.artifact_sha256) defects.push('artifact SHA-256 does not match reread content');
  for (const section of BRIEF_SECTIONS) {
    if (!new RegExp(`(^|\\n)(?:#+\\s+)?${section}(?:\\s*:)?\\s*$`, 'm').test(content)) {
      defects.push(`artifact section ${section} is absent`);
    }
  }
  if (expected) {
    for (const [field, text] of bindingPatterns(expected)) {
      if (!new RegExp(`(^|\\n)${escapeRegExp(text)}\\s*$`, 'm').test(content)) {
        defects.push(`artifact binding ${field} is absent`);
      }
    }
  }
  return { valid: defects.length === 0, defects, digest, content };
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
  if (!nonEmpty(input.workerContext) || !nonEmpty(input.allowedHandoffRoot)) {
    throw new Error('continuation requires a fresh worker context and allowed handoff root');
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
  };
  const handoff = validateContinuationHandoff(input.handoff, expected);
  if (!handoff.valid) throw new Error(`invalid orchestration handoff: ${handoff.defects.join('; ')}`);
  const artifact = validateContinuationArtifact(
    input.handoff.path,
    input.handoff,
    input.allowedHandoffRoot,
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
      artifactSha256: artifact.digest,
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
