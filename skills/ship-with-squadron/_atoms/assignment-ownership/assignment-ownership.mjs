import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const HANDOFF_FIELDS = [
  'run_identity', 'source_agent', 'target_agent', 'task_contract', 'inputs',
  'constraints', 'assumptions', 'artifacts_and_references',
  'acceptance_criteria', 'open_questions',
];
const BRIEF_SECTIONS = ['GOAL', 'SCOPE', 'CONTEXT', 'ACCEPTANCE', 'VERIFY', 'TIMEBOX', 'FORBIDDEN', 'REPORT', 'STANDING'];

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function allAssignments(state) {
  return Object.values(state.issues).flatMap((issue) => [
    ...(issue.assignment ? [issue.assignment] : []),
    ...(issue.continuationChain ?? []),
  ]);
}

export function assignFreshWorker(state, input) {
  const record = state.issues?.[input.issue];
  if (!record) throw new Error(`unknown issue: ${input.issue}`);
  if (record.status === 'active') throw new Error(`issue already has active mutable ownership: ${input.issue}`);
  for (const assignment of allAssignments(state)) {
    if (assignment.workerContext === input.workerContext) throw new Error('worker context must be fresh');
    if (assignment.active && assignment.branch === input.branch) throw new Error(`branch already owned: ${input.branch}`);
    if (assignment.active && assignment.worktree === input.worktree) throw new Error(`worktree already owned: ${input.worktree}`);
  }
  if (!nonEmpty(input.branch) || !nonEmpty(input.worktree) || !nonEmpty(input.workerContext)) {
    throw new Error('assignment requires branch, worktree, and workerContext');
  }
  const next = structuredClone(state);
  const generation = (record.assignment?.generation ?? record.continuationChain?.at(-1)?.generation ?? 0) + 1;
  next.issues[input.issue].assignment = {
    generation,
    workerContext: input.workerContext,
    branch: input.branch,
    worktree: input.worktree,
    baseSha: input.baseSha ?? null,
    headSha: input.headSha ?? null,
    active: true,
    startedAt: input.startedAt ?? new Date().toISOString(),
  };
  next.issues[input.issue].status = 'active';
  next.events.push({ type: 'assignment', issue: input.issue, generation });
  return next;
}

export function validateContinuationHandoff(handoff) {
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
  if (handoff?.reread_verified !== true) defects.push('reread_verified must be true');
  if (!nonEmpty(handoff?.fresh_consolidated_brief)) {
    defects.push('fresh_consolidated_brief is absent');
  } else {
    for (const section of BRIEF_SECTIONS) {
      if (!new RegExp(`(^|\\n)${section}:`, 'm').test(handoff.fresh_consolidated_brief)) {
        defects.push(`brief section ${section} is absent`);
      }
    }
  }
  return { valid: defects.length === 0, defects };
}

export function validateContinuationArtifact(file, handoff) {
  if (!path.isAbsolute(file)) return { valid: false, defects: ['artifact path must be absolute'] };
  if (handoff?.path !== file) return { valid: false, defects: ['artifact path does not match handoff path'] };
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { valid: false, defects: [`artifact reread failed: ${error.code ?? error.message}`] };
  }
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  const defects = [];
  if (digest !== handoff.artifact_sha256) defects.push('artifact SHA-256 does not match reread content');
  for (const section of BRIEF_SECTIONS) {
    if (!new RegExp(`(^|\\n)#+\\s+${section}\\b`, 'm').test(content)) {
      defects.push(`artifact section ${section} is absent`);
    }
  }
  return { valid: defects.length === 0, defects, digest };
}

export function continueWithFreshWorker(state, input) {
  const record = state.issues?.[input.issue];
  if (!record?.assignment?.active) throw new Error('continuation requires an active prior assignment');
  if (!['stalled', 'exhausted', 'timed-out', 'crashed'].includes(input.reason)) {
    throw new Error('continuation reason is not a terminal worker condition');
  }
  const handoff = validateContinuationHandoff(input.handoff);
  if (!handoff.valid) throw new Error(`invalid orchestration handoff: ${handoff.defects.join('; ')}`);
  if (input.branch !== record.assignment.branch || input.worktree !== record.assignment.worktree) {
    throw new Error('continuation must retain the owned branch and worktree');
  }
  const next = structuredClone(state);
  const prior = { ...next.issues[input.issue].assignment, active: false, endReason: input.reason };
  next.issues[input.issue].continuationChain.push(prior);
  next.issues[input.issue].assignment = null;
  next.issues[input.issue].status = 'pending';
  return assignFreshWorker(next, {
    issue: input.issue,
    branch: input.branch,
    worktree: input.worktree,
    workerContext: input.workerContext,
    baseSha: prior.baseSha,
    headSha: prior.headSha,
  });
}
