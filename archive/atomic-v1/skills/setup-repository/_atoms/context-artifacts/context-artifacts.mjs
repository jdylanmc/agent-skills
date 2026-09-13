/**
 * Deterministic rendering of the three repository-context artifacts.
 *
 * Rendering is a pure function of one normalized context. The same context
 * produces byte-identical output every time: no timestamps, run identifiers,
 * random values, absolute paths, or account names enter the bytes. That is
 * what lets a downstream skill trust that a regenerated file with no diff means
 * nothing changed, rather than that the render happened to match.
 *
 * The generated files are configuration a later tracker adapter reads, not a
 * template copied from another repository. The machine-resolvable identity in
 * each file lives in a fenced, JSON-encoded block with an exact grammar and a
 * parser (`parseIssueTracker`, `parseDomain`). Every scalar and list value is
 * JSON-encoded, so a pipe, newline, comma, or backtick in a value cannot break
 * a row or merge two entries. `renderArtifacts` round-trips its own output
 * through those parsers and refuses to emit bytes it cannot read back. It
 * also runs `verifyAdapterContract` before returning, so bytes that leave an
 * adapter-contract field unresolved are refused rather than emitted.
 *
 * `verifyProvenance` is a PUBLIC HELPER for validating FOREIGN bytes — bytes
 * a caller obtained from somewhere other than a fresh `renderArtifacts` call.
 * It is deliberately NOT invoked from inside `renderArtifacts`: bytes just
 * produced by the same renderer would compare byte-identical to the reference
 * pure render by construction, so re-running the check from that call site
 * would prove nothing. The provenance proof matters when a caller has bytes
 * that MIGHT have been tampered with in transit — a persisted file, a
 * transported blob, or a payload from another process — and needs to confirm
 * the identity in them still resolves only from a given context. Rendering
 * is bounded by round-trip and adapter-contract enforcement; provenance
 * verification is a separate, opt-in check available to callers who need it.
 *
 * The provenance proof is bounded, and the docs state the boundary rather
 * than claim more. `verifyProvenance` proves POSITIONALLY that identity
 * values flow only through sentinelled slots and that the fixed template
 * skeleton contains none of the finite `FORBIDDEN_LITERALS` set. It does
 * not, and cannot without a positive template allowlist, prove the template
 * skeleton is free of an arbitrary hardcoded identity outside that set.
 * `findForeignIdentities` remains as defense in depth against that residual.
 */

import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

export const EXIT_ACCEPTED = 0;
export const EXIT_REFUSED = 1;
export const EXIT_FINDINGS = 2;

export class ContextArtifactsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContextArtifactsError';
    this.code = code;
  }
}

/**
 * Every field a downstream tracker adapter must resolve from `issue-tracker.md`
 * without guessing. The adapter reads these, so if one is absent or unresolved
 * the adapter is back to inference, which is the failure this contract exists
 * to prevent.
 */
export const TRACKER_ADAPTER_CONTRACT = Object.freeze([
  'provider',
  'host',
  'organization',
  'project',
  'repository',
  'default-branch',
  'item-types',
  'tracker-operations',
  'relationship-kinds',
  'mutation-vocabulary',
  'label-vocabulary',
  'state-vocabulary',
]);

/**
 * Literals that must never appear in generated output unless the supplied
 * context itself carries them. They are the identities most likely to leak
 * from the open-source template's own home, or from one provider's host into
 * another provider's configuration. This set is defense in depth. The proof
 * that output carries no hardcoded identity is `verifyProvenance`.
 */
export const FORBIDDEN_LITERALS = Object.freeze([
  'jdylanmc',
  'agent-skills',
  'gaming-microsoft',
  'microsoft',
  'dev.azure.com',
  'visualstudio.com',
  'gitlab.com',
  'github.com',
]);

/** Providers that carry a project layer between organization and repository. */
const PROJECT_LAYER_PROVIDERS = Object.freeze(new Set(['azure-devops']));

/** The fenced block that carries the machine-resolvable tracker identity. */
const ADAPTER_FENCE = 'tracker-adapter-v1';
/** The fenced block that carries the machine-resolvable domain identity. */
const DOMAIN_FENCE = 'domain-identity-v1';

const ARTIFACT_ORDER = Object.freeze(['issue-tracker.md', 'domain.md', 'triage-labels.md']);

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function requireContext(context) {
  if (!context || typeof context !== 'object') {
    throw new ContextArtifactsError('usage', 'a normalized context object is required');
  }
  validateTargetDirectory(context.targetDirectory);
  if (typeof context.provider !== 'string' || !context.provider.trim()) {
    throw new ContextArtifactsError('usage', 'context.provider is required');
  }
  // A normalized context carries `labels` and `states` as arrays of
  // `{ name, meaning }`. When the upstream normalizer could not settle an
  // entry it carries the partial one through with an explicit
  // `meaning: null` (or `name: null`) so a later pass sees the same
  // unresolved state. Rendering such a context would still succeed by
  // stringifying `null` into JSON in the fenced block, but the display
  // table would then carry a `| bug | null |` row and the fenced block
  // would carry `"meaning":"null"` — an unsettled context rendered as if
  // it were settled. Refuse before rendering so the atom does not depend
  // on the caller having already refused.
  for (const field of ['labels', 'states']) {
    const value = context[field];
    if (!Array.isArray(value)) {
      continue;
    }
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      if (!entry || typeof entry !== 'object') {
        throw new ContextArtifactsError(
          'usage',
          `context.${field}[${index}] is unresolved: entry is not an object`,
        );
      }
      if (typeof entry.name !== 'string' || !entry.name.trim()) {
        throw new ContextArtifactsError(
          'usage',
          `context.${field}[${index}].name is unresolved`,
        );
      }
      if (typeof entry.meaning !== 'string' || !entry.meaning.trim()) {
        throw new ContextArtifactsError(
          'usage',
          `context.${field}[${index}].meaning is unresolved`,
        );
      }
    }
  }
}

function targetPath(context, name) {
  const directory = validateTargetDirectory(context.targetDirectory);
  return directory ? `${directory}/${name}` : name;
}

/**
 * Refuse a target directory that would escape or evade repository-relative
 * placement. The validation is bilingual, applying both POSIX and Windows
 * semantics so an operator on either platform cannot slip an absolute, UNC,
 * drive-qualified, NUL-containing, or `..`-escaping path through as a
 * repository-relative string. The atom refuses rather than rewriting; the
 * write gate then observes the same rules a second time as defense in depth.
 */
export function validateTargetDirectory(rawDirectory) {
  if (typeof rawDirectory !== 'string' || !rawDirectory.trim()) {
    throw new ContextArtifactsError('usage', 'context.targetDirectory is required to place the artifacts');
  }
  const value = rawDirectory.trim();
  if (value.includes('\u0000')) {
    throw new ContextArtifactsError('unsafe-target', 'targetDirectory contains a NUL byte');
  }
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw new ContextArtifactsError('unsafe-target', `targetDirectory ${JSON.stringify(rawDirectory)} is absolute`);
  }
  if (/^[a-zA-Z]:/.test(value)) {
    throw new ContextArtifactsError('unsafe-target', `targetDirectory ${JSON.stringify(rawDirectory)} is drive-qualified`);
  }
  if (value.startsWith('\\\\') || value.startsWith('//')) {
    throw new ContextArtifactsError('unsafe-target', `targetDirectory ${JSON.stringify(rawDirectory)} is a UNC path`);
  }
  const posixSegments = value.replace(/\\/g, '/').split('/').filter(Boolean);
  for (const segment of posixSegments) {
    if (segment === '..' || segment === '.') {
      if (segment === '..') {
        throw new ContextArtifactsError('unsafe-target', `targetDirectory ${JSON.stringify(rawDirectory)} escapes the repository root`);
      }
    }
  }
  // Normalize using POSIX semantics; refuse if normalization would climb.
  const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
  if (normalized.startsWith('../') || normalized === '..') {
    throw new ContextArtifactsError('unsafe-target', `targetDirectory ${JSON.stringify(rawDirectory)} escapes the repository root`);
  }
  return normalized.replace(/^\.\/+/, '').replace(/\/+$/, '').replace(/^\.$/, '');
}

/**
 * Escape a scalar for display inside a Markdown table cell so a pipe, a
 * newline, or a backslash cannot break the row. Display cells are for humans;
 * the authoritative, machine-resolvable copy is the JSON block.
 */
function encodeCell(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

/** Encode one bullet-list entry so a newline cannot split it into two bullets. */
function encodeBullet(value) {
  return String(value).replace(/\r?\n/g, '<br>');
}

function stringList(values) {
  return Array.isArray(values) ? values.map((entry) => String(entry)) : [];
}

function namedList(values) {
  return Array.isArray(values)
    ? values.map((entry) => ({ name: String(entry.name), meaning: String(entry.meaning) }))
    : [];
}

function projectValue(context) {
  return typeof context.project === 'string' && context.project.trim() ? context.project : null;
}

/**
 * The machine-resolvable projection of a context, mapped to the field names a
 * downstream adapter reads. `parseIssueTracker` returns this same shape, so a
 * rendered file round-trips to structural equality with its context.
 */
export function issueTrackerProjection(context) {
  return {
    provider: context.provider,
    host: context.host ?? null,
    organization: context.organization ?? null,
    project: projectValue(context),
    repository: context.repository ?? null,
    defaultBranch: context.defaultBranch ?? null,
    itemTypes: stringList(context.itemTypes),
    trackerOperations: stringList(context.trackerOperations),
    relationshipKinds: stringList(context.relationshipKinds),
    mutationVocabulary: stringList(context.mutationVocabulary),
    labels: namedList(context.labels),
    states: namedList(context.states),
    customTrackerInstructions: typeof context.customTrackerInstructions === 'string'
      && context.customTrackerInstructions.trim()
      ? context.customTrackerInstructions
      : null,
  };
}

/** The machine-resolvable projection of the domain identity. */
export function domainProjection(context) {
  const domain = context.domain ?? null;
  if (!domain) {
    return { name: null, summary: null, vocabularySources: [] };
  }
  return {
    name: domain.name ?? null,
    summary: domain.summary ?? null,
    vocabularySources: stringList(domain.vocabularySources),
  };
}

function contractValue(context, field) {
  const projection = issueTrackerProjection(context);
  switch (field) {
    case 'provider':
      return projection.provider;
    case 'host':
      return projection.host;
    case 'organization':
      return projection.organization;
    case 'project':
      return projection.project;
    case 'repository':
      return projection.repository;
    case 'default-branch':
      return projection.defaultBranch;
    case 'item-types':
      return projection.itemTypes;
    case 'tracker-operations':
      return projection.trackerOperations;
    case 'relationship-kinds':
      return projection.relationshipKinds;
    case 'mutation-vocabulary':
      return projection.mutationVocabulary;
    case 'label-vocabulary':
      return projection.labels;
    case 'state-vocabulary':
      return projection.states;
    default:
      throw new ContextArtifactsError('usage', `unknown contract field ${field}`);
  }
}

function renderKeyedBlock(fence, pairs) {
  const lines = ['```' + fence];
  for (const [key, value] of pairs) {
    lines.push(`${key} = ${JSON.stringify(value)}`);
  }
  lines.push('```');
  return lines.join('\n');
}

function renderAdapterBlock(context) {
  const pairs = TRACKER_ADAPTER_CONTRACT.map((field) => [field, contractValue(context, field)]);
  const custom = issueTrackerProjection(context).customTrackerInstructions;
  pairs.push(['custom-tracker-instructions', custom]);
  return renderKeyedBlock(ADAPTER_FENCE, pairs);
}

function renderDomainBlock(context) {
  const domain = domainProjection(context);
  return renderKeyedBlock(DOMAIN_FENCE, [
    ['name', domain.name],
    ['summary', domain.summary],
    ['vocabulary-sources', domain.vocabularySources],
  ]);
}

function renderIssueTracker(context) {
  const projection = issueTrackerProjection(context);
  const lines = [];
  lines.push('# Issue Tracker');
  lines.push('');
  lines.push('Repository tracker configuration for agent skills that read work');
  lines.push('items. Values are resolved from repository detection and operator');
  lines.push('confirmation, not copied from any other repository.');
  lines.push('');
  lines.push('## Adapter Resolution');
  lines.push('');
  lines.push('A downstream tracker adapter resolves its configuration from the');
  lines.push('fenced `' + ADAPTER_FENCE + '` block below. Each line is');
  lines.push('`field = <json>`, so a pipe, newline, comma, or backtick inside a');
  lines.push('value cannot break the structure. An absent scalar is the JSON');
  lines.push('literal `null`, which is distinct from a value literally named');
  lines.push('`none`.');
  lines.push('');
  lines.push(renderAdapterBlock(context));
  lines.push('');
  lines.push('## Tracker Operations');
  lines.push('');
  lines.push('Read operations downstream work relies on:');
  lines.push('');
  for (const operation of projection.trackerOperations) {
    lines.push(`- ${encodeBullet(operation)}`);
  }
  lines.push('');
  lines.push('## Relationships');
  lines.push('');
  lines.push('Work-item relationship kinds this tracker supports:');
  lines.push('');
  for (const kind of projection.relationshipKinds) {
    lines.push(`- ${encodeBullet(kind)}`);
  }
  lines.push('');
  lines.push('## Mutation Vocabulary');
  lines.push('');
  lines.push('The verbs this tracker uses for work-item changes. This file');
  lines.push('documents the vocabulary; it does not authorize any mutation.');
  lines.push('');
  for (const verb of projection.mutationVocabulary) {
    lines.push(`- ${encodeBullet(verb)}`);
  }
  if (projection.customTrackerInstructions) {
    lines.push('');
    lines.push('## Custom Tracker Instructions');
    lines.push('');
    lines.push(projection.customTrackerInstructions);
  }
  lines.push('');
  return lines.join('\n');
}

function renderDomain(context) {
  const domain = domainProjection(context);
  const lines = [];
  lines.push('# Domain');
  lines.push('');
  lines.push('The product and domain identity of this repository, for agent');
  lines.push('skills that need to speak in its terms.');
  lines.push('');
  lines.push('## Identity');
  lines.push('');
  lines.push('The machine-resolvable identity is the fenced `' + DOMAIN_FENCE + '`');
  lines.push('block. The prose below repeats it for a human reader.');
  lines.push('');
  lines.push(renderDomainBlock(context));
  lines.push('');
  lines.push(`- **Name:** ${encodeBullet(domain.name ?? 'none')}`);
  lines.push(`- **Summary:** ${encodeBullet(domain.summary ?? 'none')}`);
  lines.push('');
  lines.push('## Authoritative Vocabulary');
  lines.push('');
  lines.push('Pointers to the sources that define this domain\'s vocabulary:');
  lines.push('');
  for (const source of domain.vocabularySources) {
    lines.push(`- ${encodeBullet(source)}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderTriageLabels(context) {
  const projection = issueTrackerProjection(context);
  const lines = [];
  lines.push('# Triage Labels');
  lines.push('');
  lines.push('The labels, item types, and workflow states available on this');
  lines.push('repository\'s tracker, with what each one means. The authoritative,');
  lines.push('machine-resolvable copy of the label and state vocabulary is the');
  lines.push('`' + ADAPTER_FENCE + '` block in `issue-tracker.md`.');
  lines.push('');
  lines.push('## Labels');
  lines.push('');
  lines.push('| Label | Meaning |');
  lines.push('| --- | --- |');
  for (const label of projection.labels) {
    lines.push(`| ${encodeCell(label.name)} | ${encodeCell(label.meaning)} |`);
  }
  lines.push('');
  lines.push('## Item Types');
  lines.push('');
  for (const type of projection.itemTypes) {
    lines.push(`- ${encodeBullet(type)}`);
  }
  lines.push('');
  lines.push('## States');
  lines.push('');
  lines.push('| State | Meaning |');
  lines.push('| --- | --- |');
  for (const state of projection.states) {
    lines.push(`| ${encodeCell(state.name)} | ${encodeCell(state.meaning)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

const RENDERERS = Object.freeze({
  'issue-tracker.md': renderIssueTracker,
  'domain.md': renderDomain,
  'triage-labels.md': renderTriageLabels,
});

// --- The machine-resolvable grammar and its parsers ------------------------

function extractFencedBlock(content, fence) {
  const lines = String(content).split('\n');
  const open = `\`\`\`${fence}`;
  const opens = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === open) {
      opens.push(index);
    }
  }
  if (opens.length === 0) {
    throw new ContextArtifactsError('unparseable', `no \`${fence}\` block found`);
  }
  if (opens.length > 1) {
    throw new ContextArtifactsError('unparseable', `more than one \`${fence}\` block found`);
  }
  const start = opens[0];
  let end = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index] === '```') {
      end = index;
      break;
    }
  }
  if (end === -1) {
    throw new ContextArtifactsError('unparseable', `\`${fence}\` block is not closed`);
  }
  return lines.slice(start + 1, end);
}

function parseKeyedBlock(blockLines, fence) {
  const fields = new Map();
  for (const line of blockLines) {
    if (line.trim() === '') {
      continue;
    }
    const match = /^([a-z][a-z0-9-]*) = (.*)$/.exec(line);
    if (!match) {
      throw new ContextArtifactsError('unparseable', `malformed line in \`${fence}\`: ${line}`);
    }
    const key = match[1];
    if (fields.has(key)) {
      throw new ContextArtifactsError('unparseable', `duplicate field \`${key}\` in \`${fence}\``);
    }
    let value;
    try {
      value = JSON.parse(match[2]);
    } catch {
      throw new ContextArtifactsError('unparseable', `field \`${key}\` in \`${fence}\` is not valid JSON`);
    }
    fields.set(key, value);
  }
  return fields;
}

function requireNullableString(value, field) {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new ContextArtifactsError('unparseable', `field \`${field}\` must be a string or null`);
  }
  return value;
}

function requireProvider(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ContextArtifactsError('unparseable', 'field `provider` must be a non-empty string');
  }
  return value;
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ContextArtifactsError('unparseable', `field \`${field}\` must be an array of strings`);
  }
  return value.map((entry) => String(entry));
}

function requireNamedArray(value, field) {
  if (!Array.isArray(value)) {
    throw new ContextArtifactsError('unparseable', `field \`${field}\` must be an array`);
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ContextArtifactsError('unparseable', `field \`${field}\` entries must be objects`);
    }
    const keys = Object.keys(entry).sort();
    if (keys.length !== 2 || keys[0] !== 'meaning' || keys[1] !== 'name') {
      throw new ContextArtifactsError('unparseable', `field \`${field}\` entries need exactly name and meaning`);
    }
    if (typeof entry.name !== 'string' || typeof entry.meaning !== 'string') {
      throw new ContextArtifactsError('unparseable', `field \`${field}\` name and meaning must be strings`);
    }
    return { name: entry.name, meaning: entry.meaning };
  });
}

/**
 * Parse the machine-resolvable tracker identity out of a rendered
 * `issue-tracker.md`. Returns the same shape as `issueTrackerProjection`, so a
 * downstream adapter resolves every field from a typed value rather than by
 * scraping prose. Malformed input is rejected, never partially parsed.
 */
export function parseIssueTracker(content) {
  if (typeof content !== 'string') {
    throw new ContextArtifactsError('usage', 'rendered issue-tracker content string is required');
  }
  const fields = parseKeyedBlock(extractFencedBlock(content, ADAPTER_FENCE), ADAPTER_FENCE);
  const allowed = new Set([...TRACKER_ADAPTER_CONTRACT, 'custom-tracker-instructions']);
  for (const key of fields.keys()) {
    if (!allowed.has(key)) {
      throw new ContextArtifactsError('unparseable', `unknown field \`${key}\` in \`${ADAPTER_FENCE}\``);
    }
  }
  for (const field of TRACKER_ADAPTER_CONTRACT) {
    if (!fields.has(field)) {
      throw new ContextArtifactsError('unparseable', `missing field \`${field}\` in \`${ADAPTER_FENCE}\``);
    }
  }

  const provider = requireProvider(fields.get('provider'));
  const project = requireNullableString(fields.get('project'), 'project');
  if (PROJECT_LAYER_PROVIDERS.has(provider)) {
    if (typeof project !== 'string' || !project.trim()) {
      throw new ContextArtifactsError('unparseable', `provider \`${provider}\` requires a project`);
    }
  } else if (project !== null) {
    throw new ContextArtifactsError('unparseable', `provider \`${provider}\` must resolve project to null`);
  }

  return {
    provider,
    host: requireNullableString(fields.get('host'), 'host'),
    organization: requireNullableString(fields.get('organization'), 'organization'),
    project,
    repository: requireNullableString(fields.get('repository'), 'repository'),
    defaultBranch: requireNullableString(fields.get('default-branch'), 'default-branch'),
    itemTypes: requireStringArray(fields.get('item-types'), 'item-types'),
    trackerOperations: requireStringArray(fields.get('tracker-operations'), 'tracker-operations'),
    relationshipKinds: requireStringArray(fields.get('relationship-kinds'), 'relationship-kinds'),
    mutationVocabulary: requireStringArray(fields.get('mutation-vocabulary'), 'mutation-vocabulary'),
    labels: requireNamedArray(fields.get('label-vocabulary'), 'label-vocabulary'),
    states: requireNamedArray(fields.get('state-vocabulary'), 'state-vocabulary'),
    customTrackerInstructions: fields.has('custom-tracker-instructions')
      ? requireNullableString(fields.get('custom-tracker-instructions'), 'custom-tracker-instructions')
      : null,
  };
}

/** Parse the machine-resolvable domain identity out of a rendered `domain.md`. */
export function parseDomain(content) {
  if (typeof content !== 'string') {
    throw new ContextArtifactsError('usage', 'rendered domain content string is required');
  }
  const fields = parseKeyedBlock(extractFencedBlock(content, DOMAIN_FENCE), DOMAIN_FENCE);
  const allowed = new Set(['name', 'summary', 'vocabulary-sources']);
  for (const key of fields.keys()) {
    if (!allowed.has(key)) {
      throw new ContextArtifactsError('unparseable', `unknown field \`${key}\` in \`${DOMAIN_FENCE}\``);
    }
  }
  for (const field of allowed) {
    if (!fields.has(field)) {
      throw new ContextArtifactsError('unparseable', `missing field \`${field}\` in \`${DOMAIN_FENCE}\``);
    }
  }
  return {
    name: requireNullableString(fields.get('name'), 'name'),
    summary: requireNullableString(fields.get('summary'), 'summary'),
    vocabularySources: requireStringArray(fields.get('vocabulary-sources'), 'vocabulary-sources'),
  };
}

/**
 * Public validation boundary: assert that the supplied rendered artifact
 * bytes round-trip back to their expected projections. `renderArtifacts` uses
 * this exact function, so bypassing it would let bytes it cannot parse be
 * emitted. Tests use it to prove that malformed rendered content is refused
 * with `round-trip-failed`.
 */
export function assertRoundTrip({ issueTrackerContent, domainContent, context }) {
  requireContext(context);
  if (typeof issueTrackerContent !== 'string' || typeof domainContent !== 'string') {
    throw new ContextArtifactsError('usage', 'issueTrackerContent and domainContent strings are required');
  }
  let parsedTracker;
  try {
    parsedTracker = parseIssueTracker(issueTrackerContent);
  } catch (error) {
    throw new ContextArtifactsError(
      'round-trip-failed',
      `issue-tracker.md does not parse: ${error.message}`,
    );
  }
  if (!deepEqual(parsedTracker, issueTrackerProjection(context))) {
    throw new ContextArtifactsError(
      'round-trip-failed',
      'issue-tracker.md does not parse back to its context; refusing to emit',
    );
  }
  let parsedDomain;
  try {
    parsedDomain = parseDomain(domainContent);
  } catch (error) {
    throw new ContextArtifactsError(
      'round-trip-failed',
      `domain.md does not parse: ${error.message}`,
    );
  }
  if (!deepEqual(parsedDomain, domainProjection(context))) {
    throw new ContextArtifactsError(
      'round-trip-failed',
      'domain.md does not parse back to its context; refusing to emit',
    );
  }
}

/**
 * Render the three artifacts in stable order. Each entry carries the
 * repository-relative path, the exact bytes, and their sha256. The render
 * refuses to emit bytes it cannot parse back to structural equality with the
 * context, and refuses bytes that leave any adapter-contract field
 * unresolved. `verifyProvenance` is exposed as a separate public helper for
 * checking FOREIGN bytes; it is not run from this call site because the
 * artifacts here are byte-identical to the reference pure render by
 * construction and could not fail the check.
 */
export function renderArtifacts(context) {
  requireContext(context);
  const artifacts = ARTIFACT_ORDER.map((name) => {
    const content = RENDERERS[name](context);
    return {
      path: targetPath(context, name),
      content,
      sha256: sha256(content),
    };
  });

  const issueTracker = artifacts.find((entry) => entry.path.endsWith('issue-tracker.md'));
  const domainArtifact = artifacts.find((entry) => entry.path.endsWith('domain.md'));
  assertRoundTrip({
    issueTrackerContent: issueTracker.content,
    domainContent: domainArtifact.content,
    context,
  });

  // `renderArtifacts` refuses to emit bytes that fail the adapter-contract
  // check the documentation says rendering enforces. Calling that helper
  // only from tests would leave the production path relying on round-trip
  // alone, so the docs would overclaim.
  //
  // `verifyProvenance` is deliberately NOT invoked here: the artifacts we
  // just produced are byte-identical to `RENDERERS[name](context)` by
  // construction, so its byte-equality and identity-projection checks
  // cannot fail from this call site. It remains a public helper for
  // callers who need to check FOREIGN bytes.
  const contract = verifyAdapterContract(issueTracker.content);
  if (!contract.satisfied) {
    throw new ContextArtifactsError(
      'contract-unsatisfied',
      `adapter contract is not satisfied: ${contract.missing.join(', ')}`,
    );
  }

  return artifacts;
}

/**
 * Verify that a rendered `issue-tracker.md` resolves every adapter-contract
 * field to a concrete value: required scalars are non-null, required lists are
 * non-empty, and the project field obeys the provider's layer rule. Unparseable
 * content reports every field missing rather than a partial pass.
 */
export function verifyAdapterContract(renderedIssueTrackerContent) {
  if (typeof renderedIssueTrackerContent !== 'string') {
    throw new ContextArtifactsError('usage', 'rendered issue-tracker content string is required');
  }
  let parsed;
  try {
    parsed = parseIssueTracker(renderedIssueTrackerContent);
  } catch {
    return { satisfied: false, missing: [...TRACKER_ADAPTER_CONTRACT] };
  }

  const missing = [];
  const scalarNonNull = {
    provider: parsed.provider,
    host: parsed.host,
    organization: parsed.organization,
    repository: parsed.repository,
    'default-branch': parsed.defaultBranch,
  };
  for (const [field, value] of Object.entries(scalarNonNull)) {
    if (typeof value !== 'string' || !value.trim()) {
      missing.push(field);
    }
  }
  if (PROJECT_LAYER_PROVIDERS.has(parsed.provider)) {
    if (typeof parsed.project !== 'string' || !parsed.project.trim()) {
      missing.push('project');
    }
  }
  const nonEmptyLists = {
    'item-types': parsed.itemTypes,
    'tracker-operations': parsed.trackerOperations,
    'relationship-kinds': parsed.relationshipKinds,
    'mutation-vocabulary': parsed.mutationVocabulary,
    'label-vocabulary': parsed.labels,
    'state-vocabulary': parsed.states,
  };
  for (const [field, value] of Object.entries(nonEmptyLists)) {
    if (!Array.isArray(value) || value.length === 0) {
      missing.push(field);
    }
  }
  const order = [...TRACKER_ADAPTER_CONTRACT];
  missing.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { satisfied: missing.length === 0, missing };
}

// --- Identity provenance ----------------------------------------------------

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Build a call-local sentinel allocator. Each `verifyProvenance` call gets its
 * own counter so repeated validation of the same input yields byte-identical
 * intermediate renders. A module-level counter would make the render depend on
 * call order, which is neither deterministic nor useful for the positional
 * proof below.
 */
function makeSentinelAllocator(prefix) {
  let counter = 0;
  return function sentinelFor(value) {
    if (typeof value !== 'string' || !value.trim()) {
      return value;
    }
    counter += 1;
    return `${prefix}${counter}`;
  };
}

/**
 * A context of the same shape as the input, with every free identity value
 * replaced by a distinct neutral sentinel and provider preserved. Rendering it
 * yields the fixed template with sentinels standing in every identity slot, so
 * any of the real context's identity values that survive into it were emitted
 * from a fixed literal rather than from the context.
 */
function sentinelContextLike(context, sentinelFor) {
  const domain = context.domain
    ? {
      name: sentinelFor(context.domain.name),
      summary: sentinelFor(context.domain.summary),
      vocabularySources: stringList(context.domain.vocabularySources).map((entry) => sentinelFor(entry)),
    }
    : context.domain;
  return {
    ...context,
    host: sentinelFor(context.host),
    organization: sentinelFor(context.organization),
    project: projectValue(context) === null ? context.project : sentinelFor(context.project),
    repository: sentinelFor(context.repository),
    defaultBranch: sentinelFor(context.defaultBranch),
    itemTypes: stringList(context.itemTypes).map((entry) => sentinelFor(entry)),
    trackerOperations: stringList(context.trackerOperations).map((entry) => sentinelFor(entry)),
    relationshipKinds: stringList(context.relationshipKinds).map((entry) => sentinelFor(entry)),
    mutationVocabulary: stringList(context.mutationVocabulary).map((entry) => sentinelFor(entry)),
    labels: namedList(context.labels).map((entry) => ({
      name: sentinelFor(entry.name),
      meaning: sentinelFor(entry.meaning),
    })),
    states: namedList(context.states).map((entry) => ({
      name: sentinelFor(entry.name),
      meaning: sentinelFor(entry.meaning),
    })),
    domain,
    customTrackerInstructions: typeof context.customTrackerInstructions === 'string'
      && context.customTrackerInstructions.trim()
      ? sentinelFor(context.customTrackerInstructions)
      : context.customTrackerInstructions,
  };
}

/**
 * Prove that a rendered artifact set carries only identity the context supplied.
 *
 * The proof combines:
 *   1. Byte equality with the pure render of the context (an appended comment
 *      or a tampered field is a violation).
 *   2. Structural equality of the fenced identity blocks with the projection
 *      of the context (a value changed inside a block is a violation).
 *   3. A two-render sentinel comparison. The renderer is invoked twice, once
 *      with prefix `A` and once with prefix `B`, so the sentinel VALUES differ
 *      between the two renders. After stripping the sentinel strings from
 *      both, the remaining bytes must be byte-identical — proving that the
 *      only positions that depend on identity values are the sentinelled
 *      positions, so the identity flow is positional.
 *   4. A known-dangerous-literal backstop. The sentinel-rendered skeleton is
 *      scanned for `FORBIDDEN_LITERALS` (host names most likely to bleed
 *      between provider configurations). This backstop is finite by
 *      construction and does not detect an arbitrary hardcoded identity that
 *      is not in the literal set; the surrounding documentation states this
 *      limitation.
 *
 * An empty `violations` list means every check the code performs passed.
 */
export function verifyProvenance(artifacts, context) {
  if (!Array.isArray(artifacts)) {
    throw new ContextArtifactsError('usage', 'an array of rendered artifacts is required');
  }
  requireContext(context);
  const violations = [];
  const byName = new Map();
  for (const entry of artifacts) {
    if (!entry || typeof entry.path !== 'string' || typeof entry.content !== 'string') {
      throw new ContextArtifactsError('usage', 'each artifact needs a path and string content');
    }
    const name = entry.path.split('/').pop();
    byName.set(name, entry);
  }

  for (const name of ARTIFACT_ORDER) {
    const entry = byName.get(name);
    if (!entry) {
      violations.push({ artifact: name, reason: 'missing-artifact' });
      continue;
    }
    if (entry.content !== RENDERERS[name](context)) {
      violations.push({ artifact: name, reason: 'not-pure-render-of-context' });
    }
  }

  const issueTracker = byName.get('issue-tracker.md');
  if (issueTracker) {
    try {
      if (!deepEqual(parseIssueTracker(issueTracker.content), issueTrackerProjection(context))) {
        violations.push({ artifact: 'issue-tracker.md', reason: 'tracker-identity-not-from-context' });
      }
    } catch {
      violations.push({ artifact: 'issue-tracker.md', reason: 'tracker-block-unparseable' });
    }
  }
  const domainArtifact = byName.get('domain.md');
  if (domainArtifact) {
    try {
      if (!deepEqual(parseDomain(domainArtifact.content), domainProjection(context))) {
        violations.push({ artifact: 'domain.md', reason: 'domain-identity-not-from-context' });
      }
    } catch {
      violations.push({ artifact: 'domain.md', reason: 'domain-block-unparseable' });
    }
  }

  const allocateA = makeSentinelAllocator('AAA_SENTINEL_');
  const allocateB = makeSentinelAllocator('BBB_SENTINEL_');
  const contextA = sentinelContextLike(context, allocateA);
  const contextB = sentinelContextLike(context, allocateB);
  for (const name of ARTIFACT_ORDER) {
    const renderA = RENDERERS[name](contextA);
    const renderB = RENDERERS[name](contextB);

    // Strip the sentinels from both renders. Since only sentinel VALUES differ
    // between contextA and contextB, everything but the sentinelled positions
    // must be byte-identical after stripping. A byte that varies between the
    // two renders elsewhere would mean an identity value took a path other
    // than a sentinel slot.
    const strippedA = renderA.replace(/AAA_SENTINEL_\d+/g, '');
    const strippedB = renderB.replace(/BBB_SENTINEL_\d+/g, '');
    if (strippedA !== strippedB) {
      violations.push({ artifact: name, reason: 'identity-flow-not-positional' });
    }

    // Known-dangerous-literal backstop on the identity-neutralized skeleton.
    // This is finite and documented; it catches only literals in
    // FORBIDDEN_LITERALS, not an arbitrary hardcoded identity.
    const lowerSkeleton = strippedA.toLowerCase();
    for (const literal of FORBIDDEN_LITERALS) {
      if (lowerSkeleton.includes(literal)) {
        violations.push({ artifact: name, reason: `template-carries-forbidden-literal:${literal}` });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function collectContextTokens(context) {
  return JSON.stringify(context ?? {}).toLowerCase();
}

/**
 * Defense in depth. Flag any forbidden identity literal present in the rendered
 * bytes that the supplied context does not itself carry. This is a backstop for
 * the known-dangerous identities, not the provenance proof; that is
 * `verifyProvenance`.
 */
export function findForeignIdentities(rendered, context) {
  const renderedBlob = String(rendered ?? '').toLowerCase();
  const contextBlob = collectContextTokens(context);
  return FORBIDDEN_LITERALS.filter(
    (literal) => renderedBlob.includes(literal) && !contextBlob.includes(literal),
  );
}

export function exitCodeFor(report) {
  if (!report || (report.missing?.length ?? 0) === 0) {
    return EXIT_ACCEPTED;
  }
  return EXIT_FINDINGS;
}

export { sha256 };

function main(argv) {
  if (argv.includes('--probe')) {
    process.stdout.write('context-artifacts: available\n');
    return;
  }
  throw new ContextArtifactsError('usage', 'context-artifacts is a library; use --probe to check availability');
}

function isDirectInvocation() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { code: error.code ?? 'usage', message: error.message } })}\n`);
    process.exitCode = 1;
  }
}
