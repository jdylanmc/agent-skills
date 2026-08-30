const TERMINAL = new Set(['completed', 'failed', 'deferred']);

function dependencySatisfied(edge, record, observedMerges) {
  if (edge.satisfiedBy === 'completed') {
    return record.status === 'completed' || record.terminalDisposition === 'already-complete';
  }
  return observedMerges.has(edge.dependency)
    || record.terminalDisposition === 'already-complete';
}

export function computeFrontier(manifest, fleetState) {
  const records = fleetState.issues;
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
    if (!record) throw new Error(`fleet state is missing issue ${issue.identity}`);
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
      dispatch: ready.slice(0, available),
      nextReplenishment: available > 0 && ready.length > 0
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
