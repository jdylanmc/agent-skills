#!/usr/bin/env node

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { normalizeGraph } from '../graph-normalization/graph-normalization.mjs';

function compare(a, b) {
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function unique(values) {
  return [...new Set(values)].sort(compare);
}

function conclusion(value, confidence, evidence) {
  return { value, confidence, evidence: unique(evidence) };
}

function leastConfidence(...values) {
  const rank = new Map([['none', 0], ['low', 1], ['medium', 2], ['high', 3]]);
  return values.reduce(
    (least, value) => (rank.get(value) < rank.get(least) ? value : least),
    'high',
  );
}

function prerequisitesByDependent(ids, edges) {
  const result = new Map(ids.map((id) => [id, []]));
  for (const edge of edges) result.get(edge.dependent)?.push(edge.prerequisite);
  for (const dependencies of result.values()) dependencies.sort(compare);
  return result;
}

function gatingClosure(goal, prerequisites) {
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const prerequisite of prerequisites.get(id) ?? []) visit(prerequisite);
  };
  visit(goal);
  return [...seen].sort(compare);
}

function longestPathsToGoal(ids, edges, goal, weightFor) {
  const included = new Set(ids);
  const outgoing = new Map(ids.map((id) => [id, []]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  for (const edge of edges) {
    if (!included.has(edge.prerequisite) || !included.has(edge.dependent)) continue;
    outgoing.get(edge.prerequisite).push(edge.dependent);
    indegree.set(edge.dependent, indegree.get(edge.dependent) + 1);
  }
  for (const targets of outgoing.values()) targets.sort(compare);
  const queue = ids.filter((id) => indegree.get(id) === 0).sort(compare);
  const topological = [];
  while (queue.length) {
    const id = queue.shift();
    topological.push(id);
    for (const target of outgoing.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) {
        queue.push(target);
        queue.sort(compare);
      }
    }
  }
  if (topological.length !== ids.length) return null;

  const best = new Map();
  for (const id of topological) {
    const own = weightFor(id);
    if (!best.has(id)) best.set(id, { score: own, paths: [[id]] });
    for (const target of outgoing.get(id)) {
      const candidateScore = best.get(id).score + weightFor(target);
      const current = best.get(target);
      const candidatePaths = best.get(id).paths.map((path) => [...path, target]);
      if (!current || candidateScore > current.score) {
        best.set(target, { score: candidateScore, paths: candidatePaths });
      } else if (candidateScore === current.score) {
        current.paths.push(...candidatePaths);
      }
    }
  }
  const result = best.get(goal);
  if (!result) return { score: 0n, paths: [] };
  return {
    score: result.score,
    paths: unique(result.paths.map((path) => path.join('\0'))).map((path) => path.split('\0')),
  };
}

function jsonSafeScore(score) {
  if (score <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return { value: Number(score), valueEncoding: 'number' };
  }
  return { value: score.toString(), valueEncoding: 'decimal-string' };
}

function recordEvidence(record, freshness) {
  const evidence = [
    `record:${record.id}`,
    `record:${record.id}:status=${record.status.supplied ?? 'missing'}`,
    `record:${record.id}:statusFreshness=${record.status.freshness}`,
    `policy:observationTime=${freshness.observationTime ?? 'invalid'}`,
    `policy:maxStatusAgeSeconds=${freshness.maxStatusAgeSeconds ?? 'none'}`,
  ];
  if (record.status.observedAt) evidence.push(`record:${record.id}:statusObservedAt=${record.status.observedAt}`);
  if (record.estimate.usable) {
    evidence.push(
      `record:${record.id}:estimateValue=${record.estimate.value}`,
      `record:${record.id}:estimateUnit=${record.estimate.unit}`,
      `record:${record.id}:estimateReliable=true`,
    );
  } else {
    evidence.push(`record:${record.id}:estimateUsable=false:${record.estimate.reason}`);
    if (record.estimate.value !== undefined) evidence.push(`record:${record.id}:estimateValue=${record.estimate.value}`);
    if (record.estimate.unit) evidence.push(`record:${record.id}:estimateUnit=${record.estimate.unit}`);
    if (record.estimate.reliable !== undefined) {
      evidence.push(`record:${record.id}:estimateReliable=${record.estimate.reliable}`);
    }
  }
  return evidence;
}

function isCurrentlyCompleted(record) {
  return record.status.freshness === 'current' && record.status.canonical === 'completed';
}

function unresolvedAffectingGoal(unresolvedEdges, initialGatingIds) {
  const risky = new Set(initialGatingIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of unresolvedEdges) {
      if (edge.reason !== 'absent-endpoint' || !risky.has(edge.dependent)) continue;
      if (!risky.has(edge.prerequisite)) {
        risky.add(edge.prerequisite);
        changed = true;
      }
    }
  }
  return unresolvedEdges.filter((edge) => {
    if (edge.reason === 'absent-endpoint') return risky.has(edge.dependent);
    const references = edge.references ?? [];
    return references.length === 0 || references.some((id) => risky.has(id));
  });
}

function onePlanningAction(normalized, unsafeReasons, reorderUnknowns, ready, unknownEvidence) {
  if (unsafeReasons.length) {
    return {
      action: `Resolve graph defect: ${unsafeReasons[0]}`,
      authority: 'planning-only',
      confidence: 'high',
      evidence: unknownEvidence.get(unsafeReasons[0]) ?? [`defect:${unsafeReasons[0]}`],
    };
  }
  if (reorderUnknowns.length) {
    return {
      action: `Resolve course unknown: ${reorderUnknowns[0]}`,
      authority: 'planning-only',
      confidence: 'high',
      evidence: unknownEvidence.get(reorderUnknowns[0]) ?? [],
    };
  }
  if (ready.length) {
    return {
      action: `Review the ready frontier against goal ${normalized.goal}`,
      authority: 'planning-only',
      confidence: 'high',
      evidence: unique(ready.flatMap(({ evidence }) => evidence)),
    };
  }
  return {
    action: `Review the completed course for goal ${normalized.goal}`,
    authority: 'planning-only',
    confidence: 'high',
    evidence: [`record:${normalized.goal}`],
  };
}

function analyzeReadiness(normalized, safe, qualifiedConfidence, ready, blocked, completed) {
  const goal = normalized.goal;
  const goalReady = ready.some(({ id }) => id === goal);
  const goalBlocked = blocked.some(({ id }) => id === goal);
  const goalCompleted = completed.some(({ id }) => id === goal);
  const goalRecord = normalized.records.find(({ id }) => id === goal);
  let dependencyStatus = 'not-ready';
  if (!safe) dependencyStatus = 'uncertain';
  else if (goalCompleted) dependencyStatus = 'completed';
  else if (goalReady) dependencyStatus = 'ready';
  else if (goalBlocked) dependencyStatus = 'blocked';
  else if (goalRecord?.status.canonical === 'active') dependencyStatus = 'active';

  const goalClassification = ready.find(({ id }) => id === goal)
    ?? blocked.find(({ id }) => id === goal)
    ?? completed.find(({ id }) => id === goal);
  const dependencyEvidence = goalClassification?.evidence ?? (goalRecord
    ? recordEvidence(goalRecord, {
      observationTime: normalized.observationTime,
      maxStatusAgeSeconds: normalized.freshness.maxStatusAgeSeconds,
    })
    : [`goal:${goal ?? 'missing'}`]);
  const acceptedEdges = new Set(
    normalized.edges.map(({ prerequisite, dependent }) => `${prerequisite}\0${dependent}`),
  );
  const readiness = normalized.readiness ?? {
    observations: [],
    requirements: [],
    coverageDeclared: false,
    missingRequirementIds: [],
    defects: [],
    complete: true,
  };
  const prerequisites = readiness.observations.map((observation) => {
    const matchingRecord = observation.matchingRecord;
    const edgeKey = matchingRecord ? `${matchingRecord.id}\0${goal}` : null;
    const explicit = edgeKey !== null && acceptedEdges.has(edgeKey);
    const matchingEvidence = matchingRecord
      ? [
        `readiness:${observation.id}:matchingRecord=${matchingRecord.id}`,
        ...(matchingRecord.title
          ? [`readiness:${observation.id}:matchingRecordTitle=${matchingRecord.title}`]
          : []),
        ...(matchingRecord.url
          ? [`readiness:${observation.id}:matchingRecordUrl=${matchingRecord.url}`]
          : []),
      ]
      : [];
    const providerEvidence = observation.evidence.map(
      (item) => `provider-evidence:${JSON.stringify(item)}`,
    );
    return {
      ...observation,
      required: readiness.requirements.includes(observation.id),
      evidence: unique([
        ...providerEvidence,
        ...matchingEvidence,
        `readiness:${observation.id}:source=${observation.source ?? 'missing'}`,
        `readiness:${observation.id}:sourceRevision=${
          observation.sourceRevision
            ? `${observation.sourceRevision.algorithm}:${observation.sourceRevision.digest}`
            : 'missing'
        }`,
        `readiness:${observation.id}:observedAt=${observation.observedAt ?? 'missing'}`,
        `readiness:${observation.id}:freshness=${observation.freshness}`,
        `policy:readinessMaxObservationAgeSeconds=${readiness.freshness.maxObservationAgeSeconds ?? 'missing'}`,
      ]),
      dependencyEdge: matchingRecord
        ? {
          prerequisite: matchingRecord.id,
          dependent: goal,
          explicit,
          confirmationRequired: !explicit,
          status: explicit ? 'explicit-edge-present' : 'human-confirmation-required',
        }
        : null,
    };
  });
  const requiredPrerequisites = prerequisites.filter(({ required }) => required);
  const requirementSet = new Set(readiness.requirements);
  const globalGatingCodes = new Set([
    'invalid-readiness-observations-collection',
    'invalid-readiness-requirements-collection',
    'invalid-readiness-requirement-id',
    'duplicate-readiness-requirement-id',
  ]);
  const freshnessPolicyCodes = new Set([
    'missing-readiness-freshness-policy',
    'invalid-readiness-freshness-limit',
  ]);
  const citationCodes = new Set([
    'invalid-readiness-matching-record',
    'invalid-readiness-matching-record-title',
    'invalid-readiness-matching-record-url',
  ]);
  const requiredDefects = readiness.defects.filter((entry) =>
    entry.affectedIds.some((id) => requirementSet.has(id)));
  const gatingDefects = readiness.defects.filter((entry) =>
    globalGatingCodes.has(entry.code)
      || (freshnessPolicyCodes.has(entry.code) && readiness.requirements.length > 0)
      || (entry.affectedIds.some((id) => requirementSet.has(id))
        && !citationCodes.has(entry.code)));
  const supplementalDefects = readiness.defects.filter((entry) =>
    entry.affectedIds.length > 0
      && !entry.affectedIds.some((id) => requirementSet.has(id)));
  const nonGatingDefects = readiness.defects.filter((entry) => !gatingDefects.includes(entry));

  let operationalStatus = 'not-assessed';
  let operationalConfidence = 'none';
  if (requiredPrerequisites.some(
    ({ state, freshness }) => state === 'unsatisfied' && freshness === 'current',
  )) {
    operationalStatus = 'blocked';
    operationalConfidence = requiredDefects.length || readiness.missingRequirementIds.length
      ? 'medium'
      : 'high';
  } else if (gatingDefects.length
    || readiness.missingRequirementIds.length
    || requiredPrerequisites.some(({ state, freshness }) =>
      state === 'unknown' || freshness !== 'current')
    || (readiness.assessmentRequested && !readiness.coverageDeclared)) {
    operationalStatus = 'uncertain';
    operationalConfidence = gatingDefects.length ? 'none' : 'medium';
  } else if (readiness.coverageDeclared) {
    operationalStatus = 'ready';
    operationalConfidence = 'high';
  }

  const operationalEvidence = unique([
    ...prerequisites.flatMap(({ evidence }) => evidence),
    ...readiness.defects.flatMap(({ evidence }) => evidence),
    ...readiness.requirements.map((id) => `readiness:required=${id}`),
    ...readiness.missingRequirementIds.map((id) => `readiness:missing-required=${id}`),
    `readiness:coverage=${readiness.coverageDeclared ? 'declared' : 'undeclared'}`,
  ]);
  let implementationStatus = 'not-assessed';
  let readyForImplementation = null;
  let implementationConfidence = 'none';
  if (dependencyStatus === 'completed') {
    implementationStatus = 'completed';
    readyForImplementation = false;
    implementationConfidence = safe ? qualifiedConfidence : 'none';
  } else if (operationalStatus === 'blocked') {
    implementationStatus = dependencyStatus === 'uncertain'
      ? 'operationally-blocked-with-dependency-uncertainty'
      : 'operationally-blocked';
    readyForImplementation = false;
    implementationConfidence = operationalConfidence;
  } else if (dependencyStatus === 'blocked' || dependencyStatus === 'active' || dependencyStatus === 'not-ready') {
    implementationStatus = 'dependency-blocked';
    readyForImplementation = false;
    implementationConfidence = safe ? qualifiedConfidence : 'none';
  } else if (dependencyStatus === 'uncertain') {
    implementationStatus = 'uncertain';
  } else if (operationalStatus === 'uncertain') {
    implementationStatus = 'uncertain';
  } else if (operationalStatus === 'ready') {
    implementationStatus = 'ready';
    readyForImplementation = true;
    implementationConfidence = leastConfidence(qualifiedConfidence, operationalConfidence);
  } else if (dependencyStatus === 'ready') {
    implementationStatus = 'dependency-ready-only';
  }

  return {
    dependency: conclusion(
      { status: dependencyStatus },
      safe ? qualifiedConfidence : 'none',
      [...dependencyEvidence, ...normalized.sourceRevision.evidence],
    ),
    operational: conclusion(
      {
        status: operationalStatus,
        prerequisites,
        defects: readiness.defects,
        gatingDefects,
        supplementalDefects,
        nonGatingDefects,
        coverage: {
          assessmentRequested: readiness.assessmentRequested,
          declared: readiness.coverageDeclared,
          requiredIds: readiness.requirements,
          missingRequirementIds: readiness.missingRequirementIds,
        },
      },
      operationalConfidence,
      operationalEvidence,
    ),
    implementation: conclusion(
      { status: implementationStatus, readyForImplementation },
      implementationConfidence,
      [...dependencyEvidence, ...operationalEvidence, ...normalized.sourceRevision.evidence],
    ),
  };
}

export function chartCourse(input) {
  const normalized = normalizeGraph(input);
  const recordsById = new Map(normalized.records.map((record) => [record.id, record]));
  const goalExists = Boolean(normalized.goal && recordsById.has(normalized.goal));
  const prerequisites = prerequisitesByDependent(normalized.records.map(({ id }) => id), normalized.edges);
  const gatingIds = goalExists ? gatingClosure(normalized.goal, prerequisites) : [];
  const gatingSet = new Set(gatingIds);
  const affectingUnresolved = unresolvedAffectingGoal(normalized.unresolvedEdges, gatingIds);
  const affectingUnresolvedIndexes = new Set(affectingUnresolved.map(({ index }) => index));
  const globalCodes = new Set([
    'invalid-input',
    'invalid-records-collection',
    'invalid-edges-collection',
    'invalid-observation-time',
    'invalid-freshness-policy',
    'invalid-freshness-limit',
  ]);
  const affectingDefects = normalized.defects.filter((entry) => {
    if (globalCodes.has(entry.code)) return true;
    if (entry.code === 'cycle') return entry.affectedIds.some((id) => gatingSet.has(id));
    if (entry.code === 'duplicate-id') return entry.affectedIds.some((id) => gatingSet.has(id) || id === normalized.goal);
    if (['status-from-future', 'invalid-status-observation-time',
      'missing-status-observation-time', 'status-stale', 'status-unavailable'].includes(entry.code)) {
      return entry.affectedIds.some((id) => gatingSet.has(id));
    }
    if (['absent-edge-endpoint', 'ambiguous-edge-direction', 'invalid-edge'].includes(entry.code)) {
      const edgeIndex = Number(entry.evidence.find((item) => item.startsWith('edge:'))?.split(':')[1]);
      return affectingUnresolvedIndexes.has(edgeIndex);
    }
    return false;
  });

  const unsafeReasons = [];
  const unknownEvidence = new Map();
  if (!goalExists) {
    unsafeReasons.push('goal-outside-graph');
    unknownEvidence.set('goal-outside-graph', [`goal:${normalized.goal ?? 'missing'}`]);
  }
  for (const entry of affectingDefects) {
    const reason = entry.code === 'cycle' ? 'gating-cycle' : entry.code;
    unsafeReasons.push(reason);
    unknownEvidence.set(reason, entry.evidence);
  }
  const uniqueUnsafeReasons = unique(unsafeReasons);
  const safe = uniqueUnsafeReasons.length === 0;
  const nonBlockingDefects = normalized.defects.filter((entry) => !affectingDefects.includes(entry));
  const outsideDefects = nonBlockingDefects.filter((entry) =>
    entry.affectedIds.length === 0 || !entry.affectedIds.some((id) => gatingSet.has(id)));
  const qualifiedConfidence = nonBlockingDefects.length || !normalized.sourceRevision.available
    ? 'medium'
    : 'high';

  const outsideIds = normalized.records.map(({ id }) => id).filter((id) => !gatingSet.has(id)).sort(compare);
  const outsideEvidence = outsideIds.flatMap((id) =>
    recordEvidence(recordsById.get(id), {
      observationTime: normalized.observationTime,
      maxStatusAgeSeconds: normalized.freshness.maxStatusAgeSeconds,
    }));
  const outsideWork = conclusion(
    outsideIds.map((id) => recordsById.get(id)),
    normalized.defects.length ? 'medium' : 'high',
    [...outsideEvidence, ...outsideDefects.flatMap(({ evidence }) => evidence)],
  );

  const completed = [];
  const ready = [];
  const blocked = [];
  const reorderUnknowns = [];
  const freshnessEvidence = {
    observationTime: normalized.observationTime,
    maxStatusAgeSeconds: normalized.freshness.maxStatusAgeSeconds,
  };

  for (const id of gatingIds) {
    const record = recordsById.get(id);
    if (record.status.freshness === 'current') continue;
    const unknown = `${id}:status-${record.status.freshness}`;
    reorderUnknowns.push(unknown);
    unknownEvidence.set(unknown, recordEvidence(record, freshnessEvidence));
  }

  if (safe) {
    for (const id of gatingIds) {
      const record = recordsById.get(id);
      const evidence = recordEvidence(record, freshnessEvidence);
      if (record.status.canonical === 'completed') {
        completed.push({ id, confidence: qualifiedConfidence, evidence });
        continue;
      }
      if (record.status.canonical === 'active') {
        const unknown = `${id}:already-active`;
        reorderUnknowns.push(unknown);
        unknownEvidence.set(unknown, evidence);
        continue;
      }
      const blockers = (prerequisites.get(id) ?? []).filter((prerequisite) => {
        const state = recordsById.get(prerequisite)?.status;
        return state?.freshness !== 'current' || state.canonical !== 'completed';
      });
      const blockerEvidence = blockers.flatMap((blocker) => [
        `edge:${blocker}->${id}`,
        ...recordEvidence(recordsById.get(blocker), freshnessEvidence),
      ]);
      if (record.status.canonical === 'blocked' || blockers.length) {
        blocked.push({
          id,
          blockers,
          explicitlyBlocked: record.status.canonical === 'blocked',
          confidence: qualifiedConfidence,
          evidence: unique([...evidence, ...blockerEvidence]),
        });
      } else {
        const prerequisiteEvidence = (prerequisites.get(id) ?? []).flatMap((dependency) => [
          `edge:${dependency}->${id}`,
          ...recordEvidence(recordsById.get(dependency), freshnessEvidence),
        ]);
        ready.push({
          id,
          confidence: qualifiedConfidence,
          evidence: unique([...evidence, ...prerequisiteEvidence]),
        });
      }
    }
  }

  const estimates = gatingIds
    .filter((id) => !isCurrentlyCompleted(recordsById.get(id)))
    .map((id) => recordsById.get(id).estimate);
  const estimateUnits = unique(estimates.filter(({ usable }) => usable).map(({ unit }) => unit));
  const weighted = gatingIds.length > 0
    && estimates.every(({ usable }) => usable)
    && estimateUnits.length === 1;
  const estimateModeUncertain = estimates.some(({ usable }) => !usable) || estimateUnits.length > 1;

  for (const id of gatingIds) {
    const record = recordsById.get(id);
    if (isCurrentlyCompleted(record)) continue;
    if (!record.estimate.usable) {
      const unknown = `${id}:estimate-${record.estimate.reason}`;
      reorderUnknowns.push(unknown);
      unknownEvidence.set(unknown, recordEvidence(record, freshnessEvidence));
    }
  }
  if (estimateUnits.length > 1) {
    const unknown = `mixed-estimate-units:${estimateUnits.join(',')}`;
    reorderUnknowns.push(unknown);
    unknownEvidence.set(unknown, gatingIds.flatMap((id) => recordEvidence(recordsById.get(id), freshnessEvidence)));
  }
  for (const edge of affectingUnresolved) {
    const unknown = `unresolved-edge:${edge.index}-may-change-goal-membership`;
    reorderUnknowns.push(unknown);
    unknownEvidence.set(unknown, [`edge:${edge.index}`]);
  }
  if (outsideDefects.length) {
    const unknown = 'outside-defects-excluded-from-course';
    reorderUnknowns.push(unknown);
    unknownEvidence.set(unknown, outsideDefects.flatMap(({ evidence }) => evidence));
  }
  if (normalized.cycles.some((cycle) => !cycle.some((id) => gatingSet.has(id)))) {
    const unknown = 'outside-cycle-excluded-from-course';
    reorderUnknowns.push(unknown);
    unknownEvidence.set(unknown, normalized.cycles
      .filter((cycle) => !cycle.some((id) => gatingSet.has(id)))
      .flatMap((cycle) => cycle.map((id) => `record:${id}`)));
  }

  const gatingEdges = normalized.edges.filter(
    ({ prerequisite, dependent }) => gatingSet.has(prerequisite) && gatingSet.has(dependent),
  );
  const pathEvidence = [
    ...normalized.sourceRevision.evidence,
    ...gatingIds.flatMap((id) => recordEvidence(recordsById.get(id), freshnessEvidence)),
    ...gatingEdges.map(({ prerequisite, dependent }) => `edge:${prerequisite}->${dependent}`),
    ...nonBlockingDefects.flatMap(({ evidence }) => evidence),
  ];
  let pathResult;
  if (!safe) {
    pathResult = {
      mode: 'refused',
      label: 'unsafe to calculate a gating path',
      chains: [],
      value: null,
      valueEncoding: null,
      unit: null,
      confidence: 'none',
      evidence: uniqueUnsafeReasons.flatMap((reason) => unknownEvidence.get(reason) ?? [`defect:${reason}`]),
    };
  } else {
    const longest = longestPathsToGoal(
      gatingIds,
      gatingEdges,
      normalized.goal,
      weighted
        ? (id) => isCurrentlyCompleted(recordsById.get(id))
          ? 0n
          : BigInt(recordsById.get(id).estimate.value)
        : (id) => isCurrentlyCompleted(recordsById.get(id)) ? 0n : 1n,
    );
    const score = jsonSafeScore(longest?.score ?? 0n);
    pathResult = {
      mode: weighted ? 'weighted' : 'structural',
      label: weighted ? 'weighted longest gating path' : 'structural longest chain; not a calendar or time critical path',
      chains: longest?.paths ?? [],
      value: score.value,
      valueEncoding: score.valueEncoding,
      unit: weighted ? estimateUnits[0] : 'remaining-records',
      confidence: estimateModeUncertain ? 'medium' : qualifiedConfidence,
      evidence: unique(pathEvidence),
    };
    if (pathResult.chains.length > 1) {
      reorderUnknowns.push('tied-longest-chains');
      unknownEvidence.set('tied-longest-chains', pathResult.evidence);
    }
  }

  const uniqueUnknowns = unique(reorderUnknowns);
  const gatingEvidence = [
    ...normalized.sourceRevision.evidence,
    ...gatingIds.flatMap((id) => recordEvidence(recordsById.get(id), freshnessEvidence)),
    ...gatingEdges.map(({ prerequisite, dependent }) => `edge:${prerequisite}->${dependent}`),
    ...nonBlockingDefects.flatMap(({ evidence }) => evidence),
  ];
  const readiness = analyzeReadiness(
    normalized,
    safe,
    qualifiedConfidence,
    ready,
    blocked,
    completed,
  );
  const operationalComplete = readiness.operational.value.coverage.assessmentRequested
    && readiness.operational.value.defects.length === 0
    && readiness.operational.value.coverage.declared
    && readiness.operational.value.coverage.missingRequirementIds.length === 0
    && readiness.operational.value.prerequisites.every(
      ({ freshness }) => freshness === 'current',
    );

  return {
    schemaVersion: 1,
    goal: normalized.goal,
    revision: normalized.revision,
    sourceRevision: normalized.sourceRevision,
    observationTime: normalized.observationTime,
    freshness: normalized.freshness,
    completeness: {
      complete: normalized.complete
        && operationalComplete,
      safeToConclude: safe,
      defects: normalized.defects,
      affectingDefects,
      graph: {
        complete: normalized.complete,
        defects: normalized.defects,
      },
      operational: {
        complete: operationalComplete,
        defects: readiness.operational.value.defects,
      },
    },
    gatingSubgraph: conclusion(
      { records: gatingIds.map((id) => recordsById.get(id)), edges: gatingEdges },
      safe ? qualifiedConfidence : 'none',
      gatingEvidence,
    ),
    pathResult,
    readyFrontier: conclusion(ready, safe ? qualifiedConfidence : 'none', ready.flatMap(({ evidence }) => evidence)),
    blocked: conclusion(blocked, safe ? qualifiedConfidence : 'none', blocked.flatMap(({ evidence }) => evidence)),
    completed: conclusion(completed, safe ? qualifiedConfidence : 'none', completed.flatMap(({ evidence }) => evidence)),
    outsideWork,
    readiness,
    cycles: normalized.cycles,
    unresolvedEdges: normalized.unresolvedEdges,
    reorderingUnknowns: conclusion(
      uniqueUnknowns,
      uniqueUnknowns.length ? qualifiedConfidence : 'high',
      uniqueUnknowns.flatMap((unknown) => unknownEvidence.get(unknown) ?? []),
    ),
    planningAction: onePlanningAction(normalized, uniqueUnsafeReasons, uniqueUnknowns, ready, unknownEvidence),
  };
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error('usage: node course-analysis.mjs <input.json>');
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  process.stdout.write(`${JSON.stringify(chartCourse(input), null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
