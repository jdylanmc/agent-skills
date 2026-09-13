#!/usr/bin/env node

const STATUS = new Map([
  ['todo', 'pending'], ['open', 'pending'], ['pending', 'pending'],
  ['not_started', 'pending'], ['not-started', 'pending'], ['ready', 'pending'],
  ['active', 'active'], ['in_progress', 'active'], ['in-progress', 'active'], ['doing', 'active'],
  ['blocked', 'blocked'],
  ['complete', 'completed'], ['completed', 'completed'], ['done', 'completed'],
  ['closed', 'completed'], ['resolved', 'completed'],
]);

function compare(a, b) {
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

function defect(code, detail, evidence = [], affectedIds = []) {
  return {
    code,
    detail,
    evidence: [...evidence].sort(compare),
    affectedIds: [...new Set(affectedIds)].sort(compare),
  };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function daysInMonth(year, month) {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  if (value.trim() !== value) return null;
  const supplied = value;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(supplied);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    fractionText = '', , offsetSign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fractionText.padEnd(3, '0'));
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);

  if (month < 1 || month > 12
    || day < 1 || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 23
    || offsetMinute > 59) {
    return null;
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  const offsetDirection = offsetSign === '+' ? 1 : offsetSign === '-' ? -1 : 0;
  const epochMilliseconds = date.getTime()
    - offsetDirection * (offsetHour * 60 + offsetMinute) * 60_000;
  if (!Number.isFinite(epochMilliseconds)) return null;
  return { supplied, epochMilliseconds };
}

function cycleComponents(ids, edges) {
  const adjacency = new Map(ids.map((id) => [id, []]));
  for (const edge of edges) adjacency.get(edge.prerequisite)?.push(edge.dependent);
  for (const targets of adjacency.values()) targets.sort(compare);
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indexes = new Map();
  const low = new Map();
  const cycles = [];

  function visit(id) {
    indexes.set(id, index);
    low.set(id, index++);
    stack.push(id);
    onStack.add(id);
    for (const target of adjacency.get(id) ?? []) {
      if (!indexes.has(target)) {
        visit(target);
        low.set(id, Math.min(low.get(id), low.get(target)));
      } else if (onStack.has(target)) {
        low.set(id, Math.min(low.get(id), indexes.get(target)));
      }
    }
    if (low.get(id) !== indexes.get(id)) return;
    const component = [];
    while (stack.length) {
      const member = stack.pop();
      onStack.delete(member);
      component.push(member);
      if (member === id) break;
    }
    component.sort(compare);
    const selfLoop = component.length === 1
      && (adjacency.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || selfLoop) cycles.push(component);
  }

  for (const id of [...ids].sort(compare)) if (!indexes.has(id)) visit(id);
  return cycles.sort((a, b) => compare(a.join('\0'), b.join('\0')));
}

function statusState(record, observation, maxAgeSeconds) {
  const supplied = typeof record.status === 'string' ? record.status.trim() : '';
  const canonical = STATUS.get(supplied.toLowerCase()) ?? 'unknown';
  const observedAt = typeof record.statusObservedAt === 'string'
    ? record.statusObservedAt
    : null;
  const parsedObservedAt = parseTimestamp(observedAt);
  let freshness = supplied && canonical !== 'unknown' ? 'current' : 'unavailable';
  let ageSeconds = null;
  let temporalDefect = null;

  if (observedAt !== null && !parsedObservedAt) {
    freshness = 'unavailable';
    temporalDefect = 'invalid';
  } else if (parsedObservedAt && observation) {
    ageSeconds = (observation.epochMilliseconds - parsedObservedAt.epochMilliseconds) / 1000;
    if (ageSeconds < 0) {
      freshness = 'unavailable';
      temporalDefect = 'future';
    } else if (maxAgeSeconds !== null && ageSeconds > maxAgeSeconds) {
      freshness = 'stale';
    }
  } else if (maxAgeSeconds !== null) {
    freshness = 'unavailable';
    temporalDefect = 'missing';
  }

  return {
    supplied: supplied || null,
    canonical,
    freshness,
    observedAt,
    ageSeconds,
    temporalDefect,
  };
}

function estimateState(estimate) {
  if (estimate === undefined || estimate === null) return { usable: false, reason: 'missing' };
  if (!isObject(estimate)
    || !Number.isFinite(estimate.value)
    || estimate.value <= 0
    || typeof estimate.unit !== 'string'
    || !estimate.unit.trim()) {
    return { usable: false, reason: 'invalid' };
  }
  if (!Number.isSafeInteger(estimate.value)) {
    return {
      usable: false,
      reason: 'non-integer',
      value: estimate.value,
      unit: estimate.unit.trim(),
      reliable: estimate.reliable === true,
    };
  }
  if (estimate.reliable !== true) {
    return {
      usable: false,
      reason: 'not-reliable',
      value: estimate.value,
      unit: estimate.unit.trim(),
      reliable: false,
    };
  }
  return { usable: true, value: estimate.value, unit: estimate.unit.trim(), reliable: true };
}

export function normalizeGraph(input) {
  const defects = [];
  const sourceValid = isObject(input);
  const source = sourceValid ? input : {};
  if (!sourceValid) {
    defects.push(defect('invalid-input', 'top-level input must be an object', ['input']));
  }

  const recordsValid = Array.isArray(source.records);
  const edgesValid = Array.isArray(source.edges);
  if (!recordsValid) {
    defects.push(defect('invalid-records-collection', 'records must be an array', ['field:records']));
  }
  if (!edgesValid) {
    defects.push(defect('invalid-edges-collection', 'edges must be an array', ['field:edges']));
  }
  const records = recordsValid ? source.records : [];
  const edges = edgesValid ? source.edges : [];

  const parsedObservationTime = parseTimestamp(source.observationTime);
  const observationTime = parsedObservationTime?.supplied ?? null;
  if (!observationTime) {
    defects.push(defect(
      'invalid-observation-time',
      'observationTime must be a valid ISO-8601 timestamp',
      ['field:observationTime'],
    ));
  }

  let maxStatusAgeSeconds = null;
  if (source.freshness !== undefined) {
    if (!isObject(source.freshness)) {
      defects.push(defect(
        'invalid-freshness-policy',
        'freshness must be an object when supplied',
        ['field:freshness'],
      ));
    } else {
      const requestedAge = source.freshness.maxStatusAgeSeconds;
      if (!Number.isSafeInteger(requestedAge) || requestedAge < 0) {
        defects.push(defect(
          'invalid-freshness-limit',
          'freshness.maxStatusAgeSeconds must be a non-negative safe integer',
          ['field:freshness.maxStatusAgeSeconds'],
        ));
      } else {
        maxStatusAgeSeconds = requestedAge;
      }
    }
  }

  const idCounts = new Map();
  records.forEach((record, recordIndex) => {
    if (!isObject(record)) {
      defects.push(defect(
        'invalid-record',
        `record[${recordIndex}] must be an object`,
        [`record:${recordIndex}`],
      ));
      return;
    }
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id) {
      defects.push(defect('missing-id', `record[${recordIndex}] has no stable identity`, [`record:${recordIndex}`]));
      return;
    }
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  });

  const duplicateIds = [...idCounts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort(compare);
  for (const id of duplicateIds) {
    defects.push(defect('duplicate-id', `identity ${id} occurs more than once`, [`record:${id}`], [id]));
  }

  const normalizedRecords = records
    .map((record) => {
      if (!isObject(record)) return null;
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      if (!id || idCounts.get(id) !== 1) return null;
      const status = statusState(record, parsedObservationTime, maxStatusAgeSeconds);
      if (status.temporalDefect === 'future') {
        defects.push(defect(
          'status-from-future',
          `status timestamp for ${id} is after observationTime`,
          [`record:${id}:statusObservedAt`, 'field:observationTime'],
          [id],
        ));
      } else if (status.temporalDefect === 'invalid') {
        defects.push(defect(
          'invalid-status-observation-time',
          `status timestamp for ${id} is invalid`,
          [`record:${id}:statusObservedAt`],
          [id],
        ));
      } else if (status.temporalDefect === 'missing') {
        defects.push(defect(
          'missing-status-observation-time',
          `freshness cannot be established for ${id} without statusObservedAt`,
          [`record:${id}:statusObservedAt`, 'field:freshness.maxStatusAgeSeconds'],
          [id],
        ));
      }
      if (status.freshness === 'unavailable') {
        defects.push(defect('status-unavailable', `status for ${id} is unavailable`, [`record:${id}:status`], [id]));
      } else if (status.freshness === 'stale') {
        defects.push(defect('status-stale', `status for ${id} is stale`, [`record:${id}:statusObservedAt`], [id]));
      }
      return {
        id,
        kind: typeof record.kind === 'string' ? record.kind : null,
        title: typeof record.title === 'string' ? record.title : null,
        revision: record.revision ?? null,
        status,
        estimate: estimateState(record.estimate),
      };
    })
    .filter(Boolean)
    .sort((a, b) => compare(a.id, b.id));

  const validIds = new Set(normalizedRecords.map(({ id }) => id));
  const acceptedEdges = [];
  const unresolvedEdges = [];
  const seenEdges = new Set();

  edges.forEach((edge, edgeIndex) => {
    if (!isObject(edge)) {
      unresolvedEdges.push({ index: edgeIndex, reason: 'invalid-edge', supplied: edge ?? null, references: [] });
      defects.push(defect('invalid-edge', `edge[${edgeIndex}] must be an object`, [`edge:${edgeIndex}`]));
      return;
    }
    const prerequisite = typeof edge.prerequisite === 'string' ? edge.prerequisite.trim() : '';
    const dependent = typeof edge.dependent === 'string' ? edge.dependent.trim() : '';
    if (!prerequisite || !dependent) {
      const references = Object.values(edge)
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => value.trim())
        .sort(compare);
      unresolvedEdges.push({
        index: edgeIndex,
        reason: 'ambiguous-direction',
        supplied: edge,
        references: [...new Set(references)],
      });
      defects.push(defect(
        'ambiguous-edge-direction',
        `edge[${edgeIndex}] must explicitly name prerequisite and dependent`,
        [`edge:${edgeIndex}`],
        references,
      ));
      return;
    }
    const absent = [prerequisite, dependent].filter((id) => !validIds.has(id)).sort(compare);
    if (absent.length) {
      unresolvedEdges.push({
        index: edgeIndex,
        reason: 'absent-endpoint',
        prerequisite,
        dependent,
        absent,
        references: [prerequisite, dependent].sort(compare),
      });
      defects.push(defect(
        'absent-edge-endpoint',
        `edge[${edgeIndex}] references absent endpoint(s): ${absent.join(', ')}`,
        [`edge:${edgeIndex}`, ...absent.map((id) => `record:${id}`)],
        [prerequisite, dependent],
      ));
      return;
    }
    const key = `${prerequisite}\0${dependent}`;
    if (seenEdges.has(key)) {
      defects.push(defect(
        'duplicate-edge',
        `duplicate edge ${prerequisite} -> ${dependent}`,
        [`edge:${edgeIndex}`],
        [prerequisite, dependent],
      ));
      return;
    }
    seenEdges.add(key);
    acceptedEdges.push({ prerequisite, dependent });
  });

  acceptedEdges.sort((a, b) =>
    compare(a.prerequisite, b.prerequisite) || compare(a.dependent, b.dependent));
  unresolvedEdges.sort((a, b) => a.index - b.index);
  const cycles = cycleComponents(normalizedRecords.map(({ id }) => id), acceptedEdges);
  for (const cycle of cycles) {
    defects.push(defect(
      'cycle',
      `directed cycle contains ${cycle.join(', ')}`,
      cycle.map((id) => `record:${id}`),
      cycle,
    ));
  }
  defects.sort((a, b) => compare(a.code, b.code) || compare(a.detail, b.detail));

  return {
    schemaVersion: 1,
    goal: typeof source.goal === 'string' && source.goal.trim() ? source.goal.trim() : null,
    revision: source.revision ?? null,
    observationTime,
    freshness: { maxStatusAgeSeconds },
    records: normalizedRecords,
    edges: acceptedEdges,
    unresolvedEdges,
    cycles,
    duplicateIds,
    defects,
    complete: defects.length === 0,
  };
}
