#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const MAX_INPUT_BYTES = 256 * 1024;
export const LIMITS = Object.freeze({
  objective: 360, prose: 180, reason: 180, identity: 100,
  progressItems: 5, tickets: 2, coreReport: 2400,
  agents: 1000, ancestors: 64, events: 2048,
});
const COVERAGE = ['complete', 'partial', 'unavailable'];
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/u;
const REF_BODY = '(?:[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*)?[#!][0-9]+';
const REF_LABEL = '(?:tickets?|issues?|prs?|pull requests?|work items?)';
const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });

export class SnapshotError extends Error {}

function requireValue(condition, location, message) {
  if (!condition) throw new SnapshotError(`${location}: ${message}`);
}

function object(value, fields, location) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value),
    location, 'expected an object');
  requireValue([Object.prototype, null].includes(Object.getPrototypeOf(value)),
    location, 'expected a plain object');
  for (const key of Reflect.ownKeys(value)) {
    requireValue(typeof key === 'string' && fields.includes(key), location, 'unknown field');
    requireValue('value' in Object.getOwnPropertyDescriptor(value, key),
      location, 'accessor fields are not supported');
  }
  return value;
}

function text(value, location, max = LIMITS.reason) {
  requireValue(typeof value === 'string' && value.trim().length > 0, location, 'expected nonempty text');
  requireValue(value.length <= max, location, `text exceeds ${max} characters; resummarize without truncating facts`);
  requireValue(!CONTROLS.test(value), location, 'control characters, hidden directionality, and line breaks are not allowed');
  return value.trim();
}

function identity(value, location) {
  const result = text(value, location, LIMITS.identity);
  requireValue(result === value, location, 'identity must not have surrounding whitespace');
  return result;
}

function inline(value) {
  return value.replace(/[\\`*_[\]<>|]/gu, '\\$&');
}

function prose(value, location, max = LIMITS.reason) {
  const result = text(value, location, max);
  requireValue(!hasBareReference(result), location,
    'put ticket references in structured work metadata with their titles, not bare in prose or reasons');
  return result;
}

function noLimitation(value, location) {
  requireValue(value.reason === undefined || value.reason === null,
    location, 'known or complete evidence cannot carry a limitation reason');
}

function timestamp(value, location) {
  text(value, location, 24);
  requireValue(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value),
    location, 'expected a UTC timestamp with millisecond precision');
  const milliseconds = Date.parse(value);
  requireValue(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value,
    location, 'invalid calendar timestamp');
  return milliseconds;
}

function array(value, location, limit) {
  requireValue(Array.isArray(value), location, 'expected an array');
  requireValue(value.length <= limit, location, `list exceeds ${limit} items; resummarize or report unavailable coverage, never silently omit items`);
  return value;
}

function parseReference(value) {
  const labelled = value.match(new RegExp(`^(${REF_LABEL})\\s+(.+)$`, 'iu'));
  const label = labelled?.[1] ?? '';
  let token = labelled?.[2] ?? value;
  if (label && /^\d+$/u.test(token)) token = `#${token}`;
  const match = token.match(/^([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)?([#!])(\d+)$/u);
  if (!match || (match[1] ?? '').split('/').some((part) => part === '.' || part === '..')) return null;
  const number = BigInt(match[3]);
  if (number === 0n) return null;
  const qualifier = /^ab$/iu.test(match[1] ?? '') ? 'AB' : match[1] ?? '';
  const key = `${qualifier}${match[2]}${number}`;
  return { key, display: `${label ? `${label} ` : ''}${key}` };
}

function hasBareReference(summary) {
  const masked = summary
    .replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>()"'`]+/giu, (match) => ' '.repeat(match.length))
    .replace(/\b(?:CSS\s+)?(?:colou?r|hex(?:adecimal)?)(?:\s*:\s*|\s+)["'`(\[]?#(?:[a-f0-9]{8}|[a-f0-9]{6}|[a-f0-9]{3})\b/giu,
      (match) => ' '.repeat(match.length));
  const tokens = new RegExp(`(?<![A-Za-z0-9_./#!-])(${REF_LABEL}\\s+(?:${REF_BODY}|[0-9]+)|${REF_BODY})(?![\\p{L}\\p{N}_/#!-]|\\.[\\p{L}\\p{N}])`, 'giu');
  return [...masked.matchAll(tokens)].some((match) => parseReference(match[1]) !== null);
}

function work(value, location, { objective = false } = {}) {
  object(value, ['text', 'tickets'], location);
  const summary = prose(value.text, `${location}.text`, objective ? LIMITS.objective : LIMITS.prose);
  if (objective) {
    const sentences = [...sentenceSegmenter.segment(summary)].filter((part) => part.segment.trim());
    requireValue(sentences.length <= 3, location, 'objective exceeds three sentences');
  }
  const seen = new Set();
  const references = array(value.tickets, `${location}.tickets`, LIMITS.tickets).map((ticket, index) => {
    const at = `${location}.tickets[${index}]`;
    object(ticket, ['ref', 'title'], at);
    const ref = parseReference(text(ticket.ref, `${at}.ref`, 120));
    requireValue(ref !== null, at, 'expected a supported numbered ticket reference, not a URL');
    requireValue(!seen.has(ref.key), at, 'duplicate ticket reference');
    seen.add(ref.key);
    if (ticket.title !== null) text(ticket.title, `${at}.title`, MAX_INPUT_BYTES);
    const title = ticket.title === null ? 'title unavailable' : ticket.title;
    return `${inline(ref.display)} - ${inline(title)}`;
  });
  const referenceText = references.length ? ` (${references.join('; ')})` : '';
  return { rendered: `${inline(summary)}${referenceText}`, referenceLength: referenceText.length };
}

function scoped(value, scope, location, { caller = false } = {}) {
  requireValue(scope !== null, location, 'known observations require established objective scope');
  requireValue(identity(value.objectiveId, `${location}.objectiveId`) === scope.objectiveId, location, 'objective identity does not match');
  if (caller) {
    requireValue(identity(value.agentId, `${location}.agentId`) === scope.agentId,
      location, 'reporting agent identity does not match');
  }
  text(value.source, `${location}.source`);
}

function cutoffTime(value) {
  object(value, ['time', 'source', 'reason'], 'asOf');
  if (value.time === null) {
    object(value, ['time', 'reason'], 'asOf');
    return { milliseconds: null, text: `Unavailable - ${inline(prose(value.reason, 'asOf.reason'))}` };
  }
  noLimitation(value, 'asOf');
  text(value.source, 'asOf.source');
  return { milliseconds: timestamp(value.time, 'asOf.time'), text: value.time };
}

function list(value, scope, cutoff, location) {
  object(value, ['coverage', 'items', 'reason', 'objectiveId', 'observedAt', 'source'], location);
  requireValue(COVERAGE.includes(value.coverage), location, 'invalid coverage');
  const items = array(value.items, `${location}.items`, LIMITS.progressItems);
  if (value.coverage !== 'complete') prose(value.reason, `${location}.reason`);
  else noLimitation(value, location);
  requireValue(value.coverage !== 'unavailable' || items.length === 0,
    location, 'unavailable lists cannot contain asserted items');
  if (value.coverage === 'unavailable') {
    object(value, ['coverage', 'items', 'reason'], location);
  } else {
    scoped(value, scope, location);
    timestamp(value.observedAt, `${location}.observedAt`);
    if (value.coverage === 'complete') {
      requireValue(cutoff !== null && value.observedAt === cutoff, location, 'complete progress must represent the reporting cutoff');
    }
  }
  return { ...value, items: items.map((item, index) => work(item, `${location}[${index}]`)) };
}

function progress(label, value) {
  if (value.coverage === 'unavailable') return [`**${label}**`, `- Unavailable - ${inline(value.reason)}`];
  const heading = `**${label}**${value.coverage === 'partial'
    ? ` (partial - ${inline(value.reason)}; observed ${value.observedAt})` : ''}`;
  return [heading, ...(value.items.length
    ? value.items.map((item) => `- ${item.rendered}`)
    : [value.coverage === 'complete' ? '- None recorded.' : '- No items visible in the partial view.'])];
}

export function formatDuration(milliseconds) {
  requireValue(Number.isSafeInteger(milliseconds) && milliseconds >= 0, 'elapsed', 'invalid duration');
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ${minutes % 60}m`;
}

function countEvents(value, scope, cutoff, timing) {
  const from = timestamp(value.from, 'toolCalls.from');
  requireValue(timing.startedAt !== null && value.from === timing.startedAt,
    'toolCalls', 'event slice must begin at the proven objective start');
  const through = timestamp(cutoff, 'toolCalls.through');
  const calls = new Map();
  const reportMembership = new Map();
  for (const [index, event] of array(value.events, 'toolCalls.events', LIMITS.events).entries()) {
    const at = `toolCalls.events[${index}]`;
    object(event, ['callId', 'agentId', 'objectiveId', 'timestamp', 'phase', 'report'], at);
    const callId = identity(event.callId, `${at}.callId`);
    identity(event.agentId, `${at}.agentId`);
    identity(event.objectiveId, `${at}.objectiveId`);
    requireValue(['start', 'complete'].includes(event.phase), at, 'invalid native call phase');
    requireValue(typeof event.report === 'boolean', at, 'report-call membership must be explicit');
    const when = timestamp(event.timestamp, `${at}.timestamp`);
    if (event.agentId !== scope.agentId || event.objectiveId !== scope.objectiveId) continue;
    requireValue(!reportMembership.has(callId) || reportMembership.get(callId) === event.report,
      'toolCalls', 'native call records disagree on reporting-invocation membership');
    reportMembership.set(callId, event.report);
    if (when < from || when > through || event.report) continue;
    const record = calls.get(callId) ?? { starts: new Set(), completions: [] };
    if (event.phase === 'start') record.starts.add(when);
    else record.completions.push(when);
    calls.set(callId, record);
  }
  for (const record of calls.values()) {
    requireValue(record.starts.size === 1, 'toolCalls', 'native call identity has no unique attempt timestamp');
    const [start] = record.starts;
    requireValue(record.completions.every((time) => time >= start), 'toolCalls', 'completion precedes its attempt');
  }
  return calls.size;
}

function toolCount(value, scope, cutoff, timing) {
  object(value, ['kind', 'count', 'reason', 'objectiveId', 'agentId', 'through', 'source',
    'unit', 'complete', 'excludesDescendants', 'excludesReport', 'from', 'events'], 'toolCalls');
  if (value.kind === 'unavailable') {
    object(value, ['kind', 'count', 'reason'], 'toolCalls');
    requireValue(value.count === null, 'toolCalls', 'unavailable count must be null');
    return `Unavailable - ${inline(prose(value.reason, 'toolCalls.reason'))}`;
  }
  requireValue(['authoritative', 'events'].includes(value.kind), 'toolCalls', 'expected authoritative, events, or unavailable evidence');
  scoped(value, scope, 'toolCalls', { caller: true });
  requireValue(cutoff !== null && value.through === cutoff, 'toolCalls', 'count must cover the reporting cutoff');
  requireValue(value.complete === true, 'toolCalls', 'incomplete evidence cannot establish a total; use unavailable');
  if (value.kind === 'authoritative') {
    object(value, ['kind', 'count', 'objectiveId', 'agentId', 'through', 'source',
      'unit', 'complete', 'excludesDescendants', 'excludesReport'], 'toolCalls');
    requireValue(value.unit === 'attempts' && value.excludesDescendants === true && value.excludesReport === true,
      'toolCalls', 'authoritative counter must count attempts and exclude descendants and report calls');
    requireValue(Number.isSafeInteger(value.count) && value.count >= 0,
      'toolCalls', 'count must be a nonnegative safe integer');
    return String(value.count);
  }
  object(value, ['kind', 'objectiveId', 'agentId', 'through', 'source', 'complete', 'from', 'events'], 'toolCalls');
  return String(countEvents(value, scope, cutoff, timing));
}

function runningAgents(value, scope, cutoff) {
  object(value, ['coverage', 'items', 'objectiveId', 'through', 'source', 'reason'], 'subagents');
  requireValue(COVERAGE.includes(value.coverage), 'subagents', 'invalid coverage');
  const agents = array(value.items, 'subagents.items', LIMITS.agents);
  if (value.coverage !== 'complete') prose(value.reason, 'subagents.reason');
  else noLimitation(value, 'subagents');
  requireValue(value.coverage !== 'unavailable' || agents.length === 0,
    'subagents', 'unavailable agent lists cannot contain asserted agents');
  if (value.coverage === 'unavailable') {
    object(value, ['coverage', 'items', 'reason'], 'subagents');
  } else {
    scoped(value, scope, 'subagents');
    const observed = timestamp(value.through, 'subagents.through');
    requireValue(cutoff !== null, 'subagents', 'running observations require a reporting cutoff');
    const atCutoff = timestamp(cutoff, 'asOf.time');
    requireValue(observed >= atCutoff, 'subagents', 'older worker observations cannot assert current running state');
    if (value.coverage === 'complete') {
      requireValue(value.through === cutoff, 'subagents', 'complete agent list must represent the reporting cutoff');
    }
  }
  const byId = new Map();
  for (const [index, agent] of agents.entries()) {
    const at = `subagents.items[${index}]`;
    object(agent, ['id', 'objectiveId', 'state', 'ancestors', 'work'], at);
    const id = identity(agent.id, `${at}.id`);
    identity(agent.objectiveId, `${at}.objectiveId`);
    requireValue(scope !== null && id !== scope.agentId && agent.objectiveId === scope.objectiveId,
      at, 'agent must belong to the objective and must not be the reporting agent');
    requireValue(agent.state === 'running', at, 'only currently running subagents belong in this list');
    requireValue(!byId.has(id), at, 'duplicate subagent identity');
    const chain = array(agent.ancestors, `${at}.ancestors`, LIMITS.ancestors);
    chain.forEach((ancestor, position) => identity(ancestor, `${at}.ancestors[${position}]`));
    requireValue(chain.length > 0 && chain[0] === scope.agentId &&
      !chain.includes(id) && new Set(chain).size === chain.length,
    at, 'ancestry must be an acyclic parent chain rooted at the reporting agent');
    byId.set(id, agent);
  }
  for (const agent of agents) {
    for (let index = 1; index < agent.ancestors.length; index += 1) {
      const represented = byId.get(agent.ancestors[index]);
      if (!represented) continue;
      requireValue(JSON.stringify(represented.ancestors) === JSON.stringify(agent.ancestors.slice(0, index)),
        'subagents', 'represented parent chains contradict each other');
    }
  }
  const lines = agents.map((agent, index) => {
    const label = hasBareReference(agent.id) ? `worker ${index + 1}` : inline(agent.id);
    const assignment = agent.work === null ? 'assignment unavailable'
      : work(agent.work, `subagents.items[${index}].work`).rendered;
    return `- ${label} - ${assignment}`;
  });
  const heading = value.coverage === 'complete' ? String(agents.length)
    : value.coverage === 'partial'
      ? `Total unavailable; ${agents.length} visible - ${inline(value.reason)} (observed ${value.through})`
      : `Unavailable - ${inline(value.reason)}`;
  return [`**Running subagents:** ${heading}`, ...lines];
}

export function renderStatus(snapshot) {
  object(snapshot, ['scope', 'asOf', 'objective', 'completed', 'remaining', 'timing', 'toolCalls', 'subagents'], 'snapshot');
  const { scope, asOf, timing, toolCalls, subagents } = snapshot;
  if (scope !== null) {
    object(scope, ['objectiveId', 'agentId'], 'scope');
    identity(scope.objectiveId, 'scope.objectiveId');
    identity(scope.agentId, 'scope.agentId');
    requireValue(snapshot.objective !== null, 'objective', 'established scope requires an objective summary');
  }
  const cutoff = cutoffTime(asOf);
  const objective = snapshot.objective === null
    ? { rendered: 'Unavailable - current objective summary is not established.', referenceLength: 0 }
    : work(snapshot.objective, 'objective', { objective: true });
  const completed = list(snapshot.completed, scope, asOf.time, 'completed');
  const remaining = list(snapshot.remaining, scope, asOf.time, 'remaining');
  object(timing, ['startedAt', 'objectiveId', 'source', 'reason'], 'timing');
  let elapsed;
  if (timing.startedAt === null) {
    object(timing, ['startedAt', 'reason'], 'timing');
    elapsed = `Unavailable - ${inline(prose(timing.reason, 'timing.reason'))}`;
  } else {
    noLimitation(timing, 'timing');
    scoped(timing, scope, 'timing');
    const start = timestamp(timing.startedAt, 'timing.startedAt');
    requireValue(cutoff.milliseconds !== null && start <= cutoff.milliseconds,
      'timing', 'start must not follow an established reporting cutoff');
    elapsed = formatDuration(cutoff.milliseconds - start);
  }
  const calls = toolCount(toolCalls, scope, asOf.time, timing);
  const workers = runningAgents(subagents, scope, asOf.time);
  if (scope === null) {
    requireValue(snapshot.objective === null && completed.coverage === 'unavailable' &&
      remaining.coverage === 'unavailable' && timing.startedAt === null &&
      toolCalls.count === null && subagents.coverage === 'unavailable',
    'scope', 'unestablished scope cannot carry asserted objective work or metrics');
  }
  const core = [
    `**Objective:** ${objective.rendered}`, '',
    ...progress('Completed', completed), '',
    ...progress('Remaining', remaining), '',
    `**Snapshot:** ${cutoff.text} | **Elapsed (wall clock):** ${elapsed} | **Tool calls (this agent):** ${calls}`,
  ].join('\n');
  const references = objective.referenceLength + [...completed.items, ...remaining.items]
    .reduce((length, item) => length + item.referenceLength, 0);
  requireValue(core.length - references <= LIMITS.coreReport, 'report',
    'authored overview exceeds 2400 characters; resummarize prose without shortening known titles or omitting workers');
  return [core, ...workers].join('\n') + '\n';
}

export function diagnostic(failure) {
  if (failure instanceof SyntaxError) return 'status-report: invalid_json: malformed snapshot input\n';
  const safe = failure.message.replace(new RegExp(CONTROLS.source, 'gu'), '?').slice(0, 300);
  return `status-report: invalid_snapshot: ${safe}\n`;
}

export async function main(input = process.stdin, output = process.stdout, error = process.stderr) {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of input) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      requireValue(bytes <= MAX_INPUT_BYTES, 'input', 'snapshot exceeds 256 KiB');
      chunks.push(buffer);
    }
    output.write(renderStatus(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    return 0;
  } catch (failure) {
    if (!(failure instanceof SnapshotError) && !(failure instanceof SyntaxError)) throw failure;
    error.write(diagnostic(failure));
    return 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
