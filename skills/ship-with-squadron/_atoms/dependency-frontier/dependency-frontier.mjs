import { validateIssueSetReceipt } from '../fleet-manifest/fleet-manifest.mjs';
import { normalizeMergeObservation } from '../provider-seam/provider-seam.mjs';
import { effectiveIssueReadiness } from '../fleet-disposition/fleet-disposition.mjs';

const TERMINAL = new Set(['completed', 'blocked', 'failed', 'timed-out', 'deferred']);

function dependencySatisfied(edge, record, observedMerges, fleetState, manifest) {
  const alreadyComplete = record.status === 'completed'
    && record.terminalDisposition === 'already-complete'
    && manifest.issues.find((entry) => entry.identity === record.identity)?.status === 'completed'
    && record.sourceReceipt?.issueStatus === 'completed';
  if (edge.satisfiedBy === 'completed') {
    return alreadyComplete || effectiveIssueReadiness(record, fleetState, manifest);
  }
  return (observedMerges.has(edge.dependency)
      && record.status === 'completed'
      && record.terminalDisposition === 'ready-for-human-merge')
    || alreadyComplete;
}

function queryMembershipIsCurrent(manifest, fleetState) {
  if (manifest.issueSet.kind === 'explicit') return true;
  try {
    const normalized = validateIssueSetReceipt(fleetState.issueSetObservation, manifest);
    return fleetState.issueSetObservation?.manifestDigest === manifest.digest
      && normalized.membershipDigest === manifest.issueSet.membershipDigest
      && normalized.invocation.id !== manifest.issueSet.receipt.invocation.id
      && Date.parse(normalized.observedAt) > Date.parse(manifest.issueSet.receipt.observedAt)
      && Number.isFinite(Date.parse(fleetState.issueSetObservation.reobservedAt));
  } catch {
    return false;
  }
}

function sourceIsCurrent(issue, record, manifest) {
  const receipt = record.sourceObservation;
  return receipt?.status === 'observed'
    && receipt?.terminal === true
    && receipt?.complete === true
    && receipt?.provider === manifest.provider.name
    && receipt?.repository === manifest.repository.id
    && receipt?.issue === issue.identity
    && receipt?.revision === issue.sourceRevision
    && receipt?.manifestDigest === manifest.digest
    && receipt?.invocation?.id !== record.sourceReceipt?.invocation?.id
    && Date.parse(receipt?.observedAt) > Date.parse(record.sourceReceipt?.observedAt)
    && Number.isFinite(Date.parse(receipt?.reobservedAt));
}

export function dispatchBlockReason(fleetState) {
  if (fleetState.control?.cancelled === true || fleetState.fleetDisposition === 'cancelled') {
    return 'fleet-cancelled';
  }
  if (fleetState.control?.budgetExhausted === true || fleetState.fleetDisposition === 'budget-exhausted') {
    return 'budget-exhausted';
  }
  return null;
}

export function computeFrontier(manifest, fleetState) {
  if (fleetState.manifestDigest !== manifest.digest
      || fleetState.providerConfigurationDigest !== manifest.providerConfigurationDigest
      || !fleetState.control
      || typeof fleetState.control.cancelled !== 'boolean'
      || typeof fleetState.control.budgetExhausted !== 'boolean') {
    throw new Error('frontier state is not bound to validated fleet control');
  }
  const records = fleetState.issues;
  const stateKeys = Object.keys(records).sort();
  const manifestKeys = manifest.issues.map((issue) => issue.identity).sort();
  if (JSON.stringify(stateKeys) !== JSON.stringify(manifestKeys)) {
    throw new Error('fleet state issue set differs from the confirmed closed manifest');
  }
  const observedMerges = new Set();
  for (const entry of fleetState.observedHumanMerges) {
    try {
      observedMerges.add(normalizeMergeObservation(fleetState, manifest, entry).issue);
    } catch (error) {
      throw new Error(`scheduler rejected invalid persisted merge observation: ${error.message}`);
    }
  }
  const incoming = new Map(manifest.issues.map((issue) => [issue.identity, []]));
  for (const edge of manifest.dependencies) incoming.get(edge.dependent).push(edge);

  const ready = [];
  const blocked = [];
  const active = [];
  const completed = [];
  const failed = [];
  const deferred = [];

  for (const issue of manifest.issues) {
    const record = records[issue.identity];
    if (record.status === 'active') {
      active.push({ issue: issue.identity, reason: 'worker-assignment-active' });
      continue;
    }
    if (record.status === 'completed') {
      completed.push({ issue: issue.identity, reason: 'issue-work-completed' });
      continue;
    }
    if (record.status === 'failed') {
      failed.push({ issue: issue.identity, reason: record.statusReason ?? 'issue-failed' });
      continue;
    }
    if (record.status === 'blocked') {
      blocked.push({
        issue: issue.identity,
        reason: record.statusReason ?? 'issue-blocked',
        blockers: [],
      });
      continue;
    }
    if (record.status === 'timed-out') {
      deferred.push({ issue: issue.identity, reason: record.statusReason ?? 'issue-timed-out' });
      continue;
    }
    if (record.status === 'deferred') {
      deferred.push({ issue: issue.identity, reason: record.statusReason ?? 'issue-deferred' });
      continue;
    }
    if (record.status !== 'pending' || record.assignment !== null) {
      throw new Error(`pending frontier issue ${issue.identity} has inconsistent ownership state`);
    }

    if (!queryMembershipIsCurrent(manifest, fleetState)) {
      blocked.push({
        issue: issue.identity,
        reason: 'awaiting-query-membership-reobservation',
        blockers: [{ dependency: issue.identity, reason: 'awaiting-query-membership-reobservation' }],
      });
      continue;
    }

    if (!sourceIsCurrent(issue, record, manifest)) {
      blocked.push({
        issue: issue.identity,
        reason: `awaiting-source-reobservation:${issue.identity}`,
        blockers: [{ dependency: issue.identity, reason: `awaiting-source-reobservation:${issue.identity}` }],
      });
      continue;
    }

    const blockers = incoming.get(issue.identity)
      .filter((edge) => !dependencySatisfied(
        edge,
        records[edge.dependency],
        observedMerges,
        fleetState,
        manifest,
      ))
      .map((edge) => ({
        dependency: edge.dependency,
        reason: edge.satisfiedBy === 'human-merge'
          ? `awaiting-observed-human-merge:${edge.dependency}`
          : `awaiting-completion:${edge.dependency}`,
      }));
    if (blockers.length) {
      blocked.push({ issue: issue.identity, reason: blockers.map((entry) => entry.reason).join(','), blockers });
    } else {
      ready.push({ issue: issue.identity, reason: 'all-blocking-dependencies-satisfied' });
    }
  }

  const available = Math.max(0, manifest.concurrency - active.length);
  if (active.length > manifest.concurrency) {
    throw new Error('active assignments exceed confirmed manifest concurrency');
  }
  const stopReason = dispatchBlockReason(fleetState);
  const dispatch = stopReason ? [] : ready.slice(0, available);
  return {
    ready,
    blocked,
    active,
    completed,
    failed,
    deferred,
    capacity: {
      ceiling: manifest.concurrency,
      active: active.length,
      available,
      dispatch,
      dispatchBlockedBy: stopReason,
      nextReplenishment: stopReason
        ? 'none'
        : available > 0 && ready.length > 0
          ? 'dispatch-ready-frontier'
          : active.length > 0
            ? 'worker-terminal-transition'
            : 'none',
    },
  };
}

export function isWorkerTerminal(status) {
  return TERMINAL.has(status);
}
