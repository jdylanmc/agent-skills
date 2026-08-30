import fs from 'node:fs';
import path from 'node:path';

export const FLEET_STATE_SCHEMA_VERSION = 1;
const TRANSITIONS = new Map([
  ['pending', new Set(['active', 'completed', 'failed', 'deferred'])],
  ['active', new Set(['pending', 'completed', 'failed', 'deferred'])],
  ['completed', new Set()],
  ['failed', new Set()],
  ['deferred', new Set()],
]);

function validRunId(runId) {
  return typeof runId === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(runId);
}

export function fleetStatePath(repositoryRoot, runId) {
  if (!path.isAbsolute(repositoryRoot)) throw new Error('repositoryRoot must be absolute');
  if (!validRunId(runId)) throw new Error('runId must be path-safe');
  return path.join(repositoryRoot, '.ship-with-squadron', runId, 'fleet-state.json');
}

export function createFleetState(manifest, runId, now = new Date().toISOString()) {
  if (!validRunId(runId)) throw new Error('runId must be path-safe');
  const issues = Object.fromEntries(manifest.issues.map((issue) => [issue.identity, {
    identity: issue.identity,
    sourceRevision: issue.sourceRevision,
    dependencyState: 'unclassified',
    acceptanceCriteria: issue.acceptanceCriteria,
    assignment: null,
    continuationChain: [],
    baseSha: null,
    headSha: null,
    status: issue.status,
    implementationStatus: 'not-started',
    qualityEvidence: {},
    changeRequest: null,
    shepherd: null,
    setObligation: null,
    terminalDisposition: issue.status === 'completed' ? 'already-complete' : null,
    nextAction: null,
  }]));
  return {
    schemaVersion: FLEET_STATE_SCHEMA_VERSION,
    revision: 0,
    runId,
    manifestDigest: manifest.digest,
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
    unresolvedHumanDecisions: [],
    fleetDisposition: null,
    events: [],
  };
}

export function assertFleetState(state, manifest) {
  if (state?.schemaVersion !== FLEET_STATE_SCHEMA_VERSION) throw new Error('unsupported fleet state schema');
  if (state.manifestDigest !== manifest.digest) throw new Error('fleet state manifest digest mismatch');
  if (!Number.isInteger(state.revision) || state.revision < 0) throw new Error('invalid fleet state revision');
  for (const issue of manifest.issues) {
    if (!state.issues?.[issue.identity]) throw new Error(`fleet state missing issue ${issue.identity}`);
    if (state.issues[issue.identity].sourceRevision !== issue.sourceRevision) {
      throw new Error(`source revision mismatch for ${issue.identity}`);
    }
  }
  return state;
}

export function loadFleetState(file, manifest) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return assertFleetState(parsed, manifest);
}

export function persistFleetState(file, state, expectedRevision) {
  if (state.revision !== expectedRevision) {
    throw new Error(`state revision conflict: expected ${expectedRevision}, received ${state.revision}`);
  }
  if (fs.existsSync(file)) {
    const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (disk.revision !== expectedRevision) {
      throw new Error(`state revision conflict: disk is ${disk.revision}, expected ${expectedRevision}`);
    }
  } else if (expectedRevision !== 0) {
    throw new Error(`state revision conflict: state file absent at revision ${expectedRevision}`);
  }
  const next = structuredClone(state);
  next.revision = expectedRevision + 1;
  next.updatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const pending = `${file}.next-${process.pid}`;
  fs.writeFileSync(pending, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(pending, file);
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
  if (!TRANSITIONS.get(record.status)?.has(status)) {
    throw new Error(`invalid issue transition: ${record.status} -> ${status}`);
  }
  const next = structuredClone(state);
  next.issues[issue].status = status;
  next.issues[issue].statusReason = detail.reason ?? null;
  if (detail.terminalDisposition !== undefined) {
    next.issues[issue].terminalDisposition = detail.terminalDisposition;
  }
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

export function consumeBudget(state, manifest, usage) {
  const next = structuredClone(state);
  for (const field of ['cost', 'timeMinutes', 'retries']) {
    const increment = usage[field] ?? 0;
    if (!Number.isFinite(increment) || increment < 0) throw new Error(`usage.${field} must be non-negative`);
    next.budgetUse[field] += increment;
  }
  const exhausted = ['cost', 'timeMinutes', 'retries']
    .filter((field) => next.budgetUse[field] > manifest.budget[field]);
  if (exhausted.length) {
    next.fleetDisposition = 'budget-exhausted';
    next.events.push({ type: 'budget-exhausted', fields: exhausted });
  }
  return { state: next, exhausted };
}

export function cancelFleet(state, reason) {
  if (typeof reason !== 'string' || reason.trim() === '') throw new Error('cancellation reason is required');
  const next = structuredClone(state);
  next.fleetDisposition = 'cancelled';
  for (const record of Object.values(next.issues)) {
    if (record.status === 'pending') {
      record.terminalDisposition = 'not-reached';
      record.nextAction = 'await-new-human-invocation';
    }
    if (record.status === 'active') {
      record.nextAction = 'capture-validated-orchestration-handoff';
    }
  }
  next.events.push({ type: 'fleet-cancelled', reason });
  return next;
}
