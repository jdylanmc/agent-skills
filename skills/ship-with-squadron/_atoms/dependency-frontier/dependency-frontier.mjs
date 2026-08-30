const TERMINAL = new Set(['completed', 'failed', 'deferred']);

function dependencySatisfied(edge, record, observedMerges) {
  if (edge.satisfiedBy === 'completed') {
    return record.status === 'completed' || record.terminalDisposition === 'already-complete';
  }
  return observedMerges.has(edge.dependency)
    || record.terminalDisposition === 'already-complete';
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
    && receipt?.manifestDigest === manifest.digest;
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
  const observedMerges = new Set(fleetState.observedHumanMerges.map((entry) => entry.issue));
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
    if (record.status === 'deferred') {
      deferred.push({ issue: issue.identity, reason: record.statusReason ?? 'issue-deferred' });
      continue;
    }
    if (record.status !== 'pending' || record.assignment !== null) {
      throw new Error(`pending frontier issue ${issue.identity} has inconsistent ownership state`);
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
      .filter((edge) => !dependencySatisfied(edge, records[edge.dependency], observedMerges))
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
