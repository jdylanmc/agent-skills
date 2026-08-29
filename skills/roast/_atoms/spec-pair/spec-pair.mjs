#!/usr/bin/env node

/**
 * The specification pair.
 *
 * A product specification is two files, and only one of them is authority:
 * `<spec>.nano.md` holds the durable intention and the stable acceptance
 * criteria, and `<spec>.full.md` holds linked, non-authoritative context that
 * may elaborate the nano artifact and may never override it.
 *
 * That rule is easy to state and easy to lose. A requirement drifts into the
 * full document, nobody notices it was never in the nano artifact, and
 * downstream work starts citing a requirement no human approved. This module
 * is the mechanical half of catching that: it resolves both siblings, pins
 * their identities, extracts the stable identifiers, and records every place
 * the pair breaks its own contract.
 *
 * It records observations. It raises no finding, carries no severity, ranks
 * nothing, and approves nothing. Judging what an observation means belongs to
 * the review that reads this record.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class SpecPairError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpecPairError';
    this.code = code;
  }
}

export const NANO_SUFFIX = '.nano.md';
export const FULL_SUFFIX = '.full.md';

/**
 * The vocabulary below is owned by `spec-pair.md`. The document states each
 * list for a reader; these constants hold the same tokens so the resolver runs
 * without parsing Markdown, and `spec-pair.test.mjs` derives the document's
 * lists and fails when the two disagree in either direction.
 */

/** Sections a nano specification may carry. Anything else widens the artifact. */
export const PERMITTED_NANO_SECTIONS = [
  'intention',
  'acceptance criteria',
  'non-goals',
  'source',
  'full specification',
];

/** Phrases that give a line requirement force. */
export const REQUIREMENT_TERMS = [
  'must',
  'shall',
  'is required to',
  'are required to',
  'has to',
  'have to',
];

/** Phrases in which the full specification claims authority over the nano one. */
export const PRECEDENCE_TERMS = [
  'overrides',
  'supersedes',
  'takes precedence over',
  'replaces',
  'instead of',
];

/** Every observation this atom can record. */
export const OBSERVATION_RULES = [
  'missing-sibling',
  'unreadable-sibling',
  'broken-full-link',
  'missing-spec-identifier',
  'no-acceptance-criteria',
  'duplicate-criterion-id',
  'unknown-criterion-reference',
  'unresolved-trace-reference',
  'untraced-requirement',
  'authority-conflict',
  'nano-section-outside-contract',
];

/** Trace targets that resolve to the nano artifact without naming a criterion. */
export const INTENTION_TARGETS = ['intention'];

const CRITERION_LINE =
  /^\s*(?:[-*+]|\d+\.)\s*(?:\[[ xX]\]\s*)?\*{0,2}\s*(AC-?\d+)\s*\*{0,2}\s*(?:[.:)]|\u2014|-)?\s*(.*)$/i;
/**
 * The same statement without a list marker. A separator is required here, so
 * `AC-1: sixty minutes` is a restatement and `AC-1 is elaborated below` is a
 * reference.
 */
const BARE_RESTATEMENT_LINE =
  /^\s*\*{0,2}\s*(AC-?\d+)\s*\*{0,2}\s*(?:[.:)]|\u2014)\s*(.*)$/i;
const CRITERION_TOKEN = /\bAC-?\d+\b/gi;
const SPEC_IDENTIFIER_LINE =
  /^\s*(?:[-*+]\s*)?\*{0,2}(?:(?:specification|spec)\s+identifier|spec\s+id)\*{0,2}\s*:\s*(\S.*?)\s*$/i;
const TRACE_LINE = /^\s*(?:[-*+]\s*)?\*{0,2}(?:traces? to|elaborates)\*{0,2}\s*:\s*(\S.*?)\s*$/i;
const INTENT_MARKER = /\[INTENT\]/i;
const MATERIAL_IDENTIFIER_LINE =
  /^\s*(?:[-*+]|\d+\.)?\s*(?:\[[ xX]\]\s*)?\*{0,2}(?:REQ|DEC)-\d+\b/i;
const LIST_ITEM_LINE = /^\s*(?:[-*+]|\d+\.)\s+\S/;
const MARKDOWN_LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const HEADING_LINE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_LINE = /^\s*(`{3,}|~{3,})/;
const SPEC_IDENTIFIER_CHARACTER = /[A-Za-z0-9._-]/;

function normalizeCriterionId(raw) {
  return raw.toUpperCase().replace(/^AC-?/, 'AC-');
}

function normalizeHeading(text) {
  return text
    .replace(/[`*_]/g, '')
    .replace(/\bnon\s+goals\b/i, 'non-goals')
    .trim()
    .toLowerCase()
    .replace(/[.:]+$/, '');
}

function normalizeCriterionText(text) {
  return text.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.]+$/, '');
}

function containsPhrase(haystack, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^A-Za-z0-9])${escaped}([^A-Za-z0-9]|$)`, 'i').test(haystack);
}

function containsSpecIdentifier(haystack, specId) {
  const lowered = haystack.toLowerCase();
  const needle = specId.toLowerCase();
  let from = 0;
  for (;;) {
    const index = lowered.indexOf(needle, from);
    if (index === -1) {
      return false;
    }
    const before = haystack[index - 1] ?? '';
    const after = haystack[index + specId.length] ?? '';
    if (!SPEC_IDENTIFIER_CHARACTER.test(before) && !SPEC_IDENTIFIER_CHARACTER.test(after)) {
      return true;
    }
    from = index + 1;
  }
}

function isAbsoluteLinkTarget(target) {
  return path.isAbsolute(target) || path.posix.isAbsolute(target) || path.win32.isAbsolute(target);
}

/** Every declared criterion identifier a line names, normalized. */
function criterionTokens(text) {
  return [...text.matchAll(CRITERION_TOKEN)].map((match) => normalizeCriterionId(match[0]));
}

/**
 * Splits a trace line's target list into individual targets. `Traces to: AC-1
 * and AC-2` names two, and each is resolved on its own.
 */
function traceTargets(text) {
  const match = TRACE_LINE.exec(text);
  if (!match) {
    return null;
  }
  return match[1]
    .split(/[,;]|\band\b/i)
    .map((target) => target.replace(/[`*_]/g, '').replace(/[.]+$/, '').trim())
    .filter((target) => target !== '');
}

/** A trace target resolves to a declared criterion, the identifier, or the intention. */
function resolveTraceTarget(target, declaredIds, specId) {
  if (/^INTENT$/i.test(target.replace(/[\[\]`*_]/g, '').trim())) {
    return true;
  }
  for (const id of criterionTokens(target)) {
    if (declaredIds.has(id)) {
      return true;
    }
  }
  if (specId !== null && containsSpecIdentifier(target, specId)) {
    return true;
  }
  return INTENTION_TARGETS.some((name) => containsPhrase(target, name));
}

function excerpt(text, limit = 160) {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 3)}...` : collapsed;
}

/**
 * Splits a document into lines that carry prose and lines that do not. Fenced
 * blocks are excluded from every textual rule below, so a quoted example of a
 * requirement is never read as one.
 */
function scan(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const records = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const fenceMatch = FENCE_LINE.exec(raw);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = marker;
      } else if (marker[0] === fence[0] && marker.length >= fence.length) {
        fence = null;
      }
      records.push({ number: index + 1, text: raw, fenced: true });
      continue;
    }
    records.push({ number: index + 1, text: raw, fenced: fence !== null });
  }
  return records;
}

function sectionsOf(records) {
  const sections = [];
  let current = { heading: null, normalized: null, level: 0, line: 0, lines: [] };
  for (const record of records) {
    const heading = record.fenced ? null : HEADING_LINE.exec(record.text);
    if (heading) {
      sections.push(current);
      current = {
        heading: heading[2],
        normalized: normalizeHeading(heading[2]),
        level: heading[1].length,
        line: record.number,
        lines: [],
      };
      continue;
    }
    current.lines.push(record);
  }
  sections.push(current);
  return sections.filter((section) => section.heading !== null || section.lines.length > 0);
}

function observation(rule, locator, line, detail, extra = {}) {
  return { rule, locator, line, detail, ...extra };
}

/**
 * The nearest existing ancestor of a path, canonicalized. A missing sibling
 * still has to be checked against a real location: comparing the path text
 * alone would let a directory symlink inside the root point anywhere.
 */
function canonicalContainer(directory) {
  let current = path.resolve(directory);
  for (;;) {
    try {
      return fs.realpathSync(current);
    } catch (error) {
      // A path whose ancestor is a regular file is as absent as one whose
      // ancestor does not exist. Both keep ascending; anything else is a real
      // resolution failure and refuses.
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
        throw new SpecPairError('unsafe_path', `${directory} could not be resolved: ${error.code}`);
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return current;
      }
      current = parent;
    }
  }
}

function assertInsideRoot(absolutePath, boundaryRoot, layer) {
  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync(boundaryRoot);
  } catch (error) {
    throw new SpecPairError('unsafe_path', `the declared root could not be resolved: ${error.code}`);
  }
  const container = canonicalContainer(path.dirname(absolutePath));
  const relative = path.relative(canonicalRoot, container);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SpecPairError('unsafe_path', `${layer} path escapes the declared root`);
  }
}

function readMember(absolutePath, layer, repositoryRoot, boundaryRoot) {
  const locator = repositoryRoot
    ? path.relative(repositoryRoot, absolutePath).split(path.sep).join('/')
    : absolutePath;
  const member = { layer, locator, status: 'Missing', bytes: null, lines: null, digest: null };
  if (boundaryRoot) {
    assertInsideRoot(absolutePath, boundaryRoot, layer);
  }
  let stats;
  try {
    stats = fs.lstatSync(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      member.reason = 'no file at the declared sibling path';
      return { member, text: null };
    }
    // Absence and inaccessibility are different facts. Collapsing a permission
    // failure into "missing" tells a reader the file is not there when it is.
    member.status = 'Unreadable';
    member.reason = `the sibling path could not be inspected: ${error.code ?? 'unknown error'}`;
    return { member, text: null };
  }
  if (stats.isSymbolicLink()) {
    member.status = 'Unreadable';
    member.reason = 'the sibling path is a symbolic link';
    return { member, text: null };
  }
  if (!stats.isFile()) {
    member.status = 'Unreadable';
    member.reason = 'the sibling path is not a regular file';
    return { member, text: null };
  }
  let buffer;
  try {
    buffer = fs.readFileSync(absolutePath);
  } catch (error) {
    member.status = 'Unreadable';
    member.reason = `the sibling file could not be read: ${error.code ?? 'unknown error'}`;
    return { member, text: null };
  }
  const text = buffer.toString('utf8').replace(/\r\n/g, '\n');
  member.status = 'Present';
  member.bytes = buffer.byteLength;
  member.lines = text === '' ? 0 : text.split('\n').length;
  member.digest = crypto.createHash('sha256').update(buffer).digest('hex');
  return { member, text };
}

function resolvePaths(input) {
  const { specPath, nanoPath, fullPath } = input;
  let nano = nanoPath ?? null;
  let full = fullPath ?? null;
  if (specPath) {
    if (nano || full) {
      throw new SpecPairError(
        'usage',
        'supply either one specification path or an explicit nano and full pair, never both',
      );
    }
    if (specPath.endsWith(NANO_SUFFIX)) {
      nano = specPath;
    } else if (specPath.endsWith(FULL_SUFFIX)) {
      full = specPath;
      nano = `${specPath.slice(0, -FULL_SUFFIX.length)}${NANO_SUFFIX}`;
    } else {
      throw new SpecPairError(
        'usage',
        `a specification path must end with ${NANO_SUFFIX} or ${FULL_SUFFIX}`,
      );
    }
  }
  if (!nano) {
    throw new SpecPairError('usage', 'supply the nano specification path');
  }
  if (!nano.endsWith(NANO_SUFFIX)) {
    throw new SpecPairError('usage', `the nano specification path must end with ${NANO_SUFFIX}`);
  }
  full = full ?? `${nano.slice(0, -NANO_SUFFIX.length)}${FULL_SUFFIX}`;
  if (!full.endsWith(FULL_SUFFIX)) {
    throw new SpecPairError('usage', `the full specification path must end with ${FULL_SUFFIX}`);
  }
  if (!path.isAbsolute(nano) || !path.isAbsolute(full)) {
    throw new SpecPairError('unsafe_path', 'specification paths must be absolute');
  }
  nano = path.normalize(nano);
  full = path.normalize(full);
  if (nano.slice(0, -NANO_SUFFIX.length) !== full.slice(0, -FULL_SUFFIX.length)) {
    throw new SpecPairError(
      'usage',
      'sibling mismatch: the nano and full specification paths must share one directory and stem',
    );
  }
  return { nano, full };
}

function collectNano(records, locator) {
  const observations = [];
  const sections = sectionsOf(records);
  let specId = null;
  let specIdLine = null;

  for (const record of records) {
    if (record.fenced) {
      continue;
    }
    const identifier = SPEC_IDENTIFIER_LINE.exec(record.text);
    if (identifier && specId === null) {
      specId = identifier[1].replace(/[`*_]/g, '').trim();
      specIdLine = record.number;
    }
  }
  if (specId === null) {
    observations.push(
      observation(
        'missing-spec-identifier',
        locator,
        null,
        'the nano specification declares no stable specification identifier, so downstream work has nothing durable to cite',
      ),
    );
  }

  for (const section of sections) {
    if (section.heading === null || section.level <= 1) {
      continue;
    }
    const permitted = PERMITTED_NANO_SECTIONS.some((name) =>
      containsPhrase(section.normalized, name),
    );
    if (!permitted) {
      observations.push(
        observation(
          'nano-section-outside-contract',
          locator,
          section.line,
          `the nano specification carries the section "${excerpt(section.heading, 60)}", which is outside the sections a nano artifact may hold`,
          { section: section.heading },
        ),
      );
    }
  }

  const criteriaSection = sections.find(
    (section) => section.normalized !== null && containsPhrase(section.normalized, 'acceptance criteria'),
  );
  const criteria = [];
  const seen = new Map();
  if (!criteriaSection) {
    observations.push(
      observation(
        'no-acceptance-criteria',
        locator,
        null,
        'the nano specification declares no acceptance-criteria section, so there is no stated way to determine whether the intention was met',
      ),
    );
  } else {
    for (const record of criteriaSection.lines) {
      if (record.fenced) {
        continue;
      }
      const match = CRITERION_LINE.exec(record.text);
      if (!match) {
        continue;
      }
      const id = normalizeCriterionId(match[1]);
      const entry = { id, line: record.number, text: excerpt(match[2]) };
      if (seen.has(id)) {
        observations.push(
          observation(
            'duplicate-criterion-id',
            locator,
            record.number,
            `criterion ${id} is declared more than once, so a downstream citation of it is ambiguous`,
            { criterionId: id, firstDeclaredAt: seen.get(id) },
          ),
        );
        continue;
      }
      seen.set(id, record.number);
      criteria.push(entry);
    }
    if (criteria.length === 0) {
      observations.push(
        observation(
          'no-acceptance-criteria',
          locator,
          criteriaSection.line,
          'the acceptance-criteria section declares no criterion carrying a stable identifier, so downstream work cannot cite one',
        ),
      );
    }
  }

  return { specId, specIdLine, criteria, observations };
}

function checkLink(records, nanoLocator, nanoAbsolute, fullAbsolute) {
  const candidates = [];
  for (const record of records) {
    if (record.fenced) {
      continue;
    }
    for (const match of record.text.matchAll(MARKDOWN_LINK)) {
      const target = match[1].split('#')[0];
      if (target === '') {
        continue;
      }
      let decoded = target;
      try {
        decoded = decodeURIComponent(target);
      } catch {
        decoded = target;
      }
      if (isAbsoluteLinkTarget(target) || isAbsoluteLinkTarget(decoded)) {
        candidates.push({ declared: target, resolved: null, line: record.number, relative: false });
        continue;
      }
      const resolved = path.resolve(path.dirname(nanoAbsolute), decoded);
      candidates.push({ declared: target, resolved, line: record.number, relative: true });
    }
  }
  const exact = candidates.find((candidate) => candidate.relative && candidate.resolved === fullAbsolute);
  if (exact) {
    return {
      link: { declared: exact.declared, line: exact.line, status: 'Resolved', reason: null },
      observations: [],
    };
  }
  const nearMiss = candidates.find((candidate) => candidate.declared.endsWith(FULL_SUFFIX));
  if (nearMiss) {
    return {
      link: {
        declared: nearMiss.declared,
        line: nearMiss.line,
        status: 'Broken',
        reason: 'the declared full-specification link is not relative or does not resolve to the sibling file',
      },
      observations: [
        observation(
          'broken-full-link',
          nanoLocator,
          nearMiss.line,
          `the nano specification links to "${nearMiss.declared}", which is not a relative link to its full sibling`,
        ),
      ],
    };
  }
  return {
    link: {
      declared: null,
      line: null,
      status: 'Missing',
      reason: 'the nano specification declares no relative link to its full sibling',
    },
    observations: [
      observation(
        'broken-full-link',
        nanoLocator,
        null,
        'the nano specification declares no relative link to its full sibling, so the pair is not linked',
      ),
    ],
  };
}

/**
 * The restatement a full-specification line makes of one declared criterion,
 * or `null`. A list item and a bare `AC-1:` line are both restatements; a
 * sentence that merely names an identifier is not.
 *
 * The text taken is the criterion line's own, and the following line only when
 * the criterion line carries none. Joining an item's whole body would report
 * every legitimate elaboration under a criterion as a contradiction, which is
 * the judgement this atom deliberately leaves to the lens.
 */
function restatementAt(records, index) {
  const record = records[index];
  const match = CRITERION_LINE.exec(record.text) ?? BARE_RESTATEMENT_LINE.exec(record.text);
  if (!match) {
    return null;
  }
  let text = match[2];
  let line = record.number;
  if (normalizeCriterionText(text) === '') {
    const continuation = records[index + 1];
    const usable =
      continuation !== undefined &&
      !continuation.fenced &&
      /^\s+\S/.test(continuation.text) &&
      !HEADING_LINE.test(continuation.text) &&
      !CRITERION_LINE.test(continuation.text) &&
      !BARE_RESTATEMENT_LINE.test(continuation.text);
    if (usable) {
      text = continuation.text;
      line = continuation.number;
    }
  }
  return { id: normalizeCriterionId(match[1]), text, line };
}

function collectFull(records, locator, criteria, specId) {
  const observations = [];
  const declaredIds = new Set(criteria.map((entry) => entry.id));
  const criterionText = new Map(criteria.map((entry) => [entry.id, normalizeCriterionText(entry.text)]));
  const referencedIds = new Set();
  const unknownReferences = [];
  const untracedRequirements = [];
  const unresolvedTraceLines = new Set();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.fenced) {
      continue;
    }
    for (const id of criterionTokens(record.text)) {
      if (declaredIds.has(id)) {
        referencedIds.add(id);
      } else {
        unknownReferences.push({ id, line: record.number });
        observations.push(
          observation(
            'unknown-criterion-reference',
            locator,
            record.number,
            `the full specification cites ${id}, which the nano specification does not declare`,
            { criterionId: id },
          ),
        );
      }
    }

    const targets = traceTargets(record.text);
    if (targets !== null) {
      const resolved = targets.filter((target) => resolveTraceTarget(target, declaredIds, specId));
      if (resolved.length === 0) {
        unresolvedTraceLines.add(record.number);
        observations.push(
          observation(
            'unresolved-trace-reference',
            locator,
            record.number,
            `the full specification declares a trace to ${targets.map((target) => `"${excerpt(target, 40)}"`).join(', ')}, which names no declared criterion, the specification identifier, or the intention`,
            { targets },
          ),
        );
      }
    }

    const restatement = restatementAt(records, index);
    if (restatement) {
      const declared = criterionText.get(restatement.id);
      const restated = normalizeCriterionText(restatement.text);
      if (declared !== undefined && restated !== '' && restated !== declared) {
        observations.push(
          observation(
            'authority-conflict',
            locator,
            restatement.line,
            `the full specification restates ${restatement.id} with different text, which contradicts the nano authority`,
            {
              criterionId: restatement.id,
              nanoText: criteria.find((entry) => entry.id === restatement.id).text,
              fullText: excerpt(restatement.text),
            },
          ),
        );
      }
    }

    if (
      containsPhrase(record.text, 'nano') &&
      PRECEDENCE_TERMS.some((term) => containsPhrase(record.text, term))
    ) {
      observations.push(
        observation(
          'authority-conflict',
          locator,
          record.number,
          'the full specification claims precedence over the nano specification, which is never available to it',
          { excerpt: excerpt(record.text) },
        ),
      );
    }
  }

  const traces = (record) => {
    const text = typeof record === 'string' ? record : record.text;
    if (criterionTokens(text).some((id) => declaredIds.has(id))) {
      return true;
    }
    if (INTENT_MARKER.test(text)) {
      return true;
    }
    if (specId !== null && containsSpecIdentifier(text, specId)) {
      return true;
    }
    const targets = traceTargets(text);
    return targets !== null && targets.some((target) => resolveTraceTarget(target, declaredIds, specId));
  };
  const materialRequirement = (record, section) => {
    if (REQUIREMENT_TERMS.some((term) => containsPhrase(record.text, term))) {
      return true;
    }
    if (MATERIAL_IDENTIFIER_LINE.test(record.text)) {
      return true;
    }
    return (
      section.normalized !== null &&
      containsPhrase(section.normalized, 'product decisions') &&
      LIST_ITEM_LINE.test(record.text)
    );
  };

  for (const section of sectionsOf(records)) {
    let pendingTrace = section.heading !== null && traces(section.heading);
    for (const record of section.lines) {
      if (record.fenced || /^\s*>/.test(record.text) || unresolvedTraceLines.has(record.number)) {
        continue;
      }
      const targets = traceTargets(record.text);
      if (targets !== null) {
        pendingTrace = targets.some((target) => resolveTraceTarget(target, declaredIds, specId));
        continue;
      }
      if (!materialRequirement(record, section)) {
        continue;
      }
      if (traces(record) || pendingTrace) {
        pendingTrace = false;
        continue;
      }
      pendingTrace = false;
      const entry = {
        line: record.number,
        section: section.heading,
        text: excerpt(record.text),
      };
      untracedRequirements.push(entry);
      observations.push(
        observation(
          'untraced-requirement',
          locator,
          record.number,
          `the full specification states a requirement that traces to no nano identifier, so it reads as authority the nano specification never granted`,
          { section: section.heading, excerpt: entry.text },
        ),
      );
    }
  }

  return {
    observations,
    traceability: {
      referencedIds: [...referencedIds].sort(),
      uncitedCriteria: criteria.map((entry) => entry.id).filter((id) => !referencedIds.has(id)),
      unknownReferences,
      untracedRequirements,
    },
  };
}

/**
 * Stages one specification pair and returns the record. A missing sibling, a
 * broken link, and a contradicted criterion are all recorded and none of them
 * is an error: the review needs the record most in exactly those cases.
 */
export function stageSpecPair(input = {}) {
  const repositoryRoot = input.repositoryRoot ?? null;
  if (repositoryRoot !== null && !path.isAbsolute(repositoryRoot)) {
    throw new SpecPairError('unsafe_path', 'repository root must be absolute');
  }
  const { nano: nanoAbsolute, full: fullAbsolute } = resolvePaths({
    specPath: input.specPath ?? null,
    nanoPath: input.nanoPath ?? null,
    fullPath: input.fullPath ?? null,
  });

  const nano = readMember(nanoAbsolute, 'nano', repositoryRoot, repositoryRoot);
  const full = readMember(fullAbsolute, 'full', repositoryRoot, repositoryRoot);
  const observations = [];

  for (const { member } of [nano, full]) {
    if (member.status === 'Missing') {
      observations.push(
        observation(
          'missing-sibling',
          member.locator,
          null,
          `the ${member.layer} specification of this pair is absent, so the pair is incomplete`,
          { layer: member.layer },
        ),
      );
    } else if (member.status === 'Unreadable') {
      observations.push(
        observation(
          'unreadable-sibling',
          member.locator,
          null,
          `the ${member.layer} specification exists and was not read: ${member.reason}`,
          { layer: member.layer },
        ),
      );
    }
  }

  let specId = null;
  let criteria = [];
  let link = {
    declared: null,
    line: null,
    status: 'Unresolved',
    reason: 'the nano specification was not read',
  };
  let traceability = {
    referencedIds: [],
    uncitedCriteria: [],
    unknownReferences: [],
    untracedRequirements: [],
  };

  if (nano.text !== null) {
    const nanoRecords = scan(nano.text);
    const collected = collectNano(nanoRecords, nano.member.locator);
    specId = collected.specId;
    criteria = collected.criteria;
    observations.push(...collected.observations);

    if (full.member.status === 'Present') {
      const linked = checkLink(nanoRecords, nano.member.locator, nanoAbsolute, fullAbsolute);
      link = linked.link;
      observations.push(...linked.observations);

      const fullCollected = collectFull(scan(full.text), full.member.locator, criteria, specId);
      traceability = fullCollected.traceability;
      observations.push(...fullCollected.observations);
    } else {
      link = {
        declared: null,
        line: null,
        status: 'Unresolved',
        reason: 'the full specification is not available to link to',
      };
    }
  }

  let status = 'Paired';
  if (nano.member.status === 'Unreadable' || full.member.status === 'Unreadable') {
    status = 'Unreadable';
  } else if (nano.member.status !== 'Present' || full.member.status !== 'Present') {
    status = 'Incomplete pair';
  }

  return {
    schemaVersion: 1,
    status,
    blocking: false,
    authority: { layer: 'nano', locator: nano.member.locator },
    specId,
    files: { nano: nano.member, full: full.member },
    link,
    criteria,
    traceability,
    observations,
    observation:
      status === 'Paired' && observations.length === 0
        ? 'The pair is linked, and every mechanical pair check passed.'
        : `The pair is ${status.toLowerCase()} with ${observations.length} recorded observation(s).`,
  };
}

function usage(streams) {
  streams.stderr.write(
    'usage: spec-pair.mjs (--spec <absolute-path> | --nano <absolute-path> [--full <absolute-path>])'
      + ' --repository-root <absolute-path>\n',
  );
  return 1;
}

const OPTIONS = new Set(['--spec', '--nano', '--full', '--repository-root']);

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!OPTIONS.has(token)) {
      throw new SpecPairError('usage', `unknown argument: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || OPTIONS.has(value)) {
      throw new SpecPairError('usage', `${token} requires a value`);
    }
    if (token in values) {
      throw new SpecPairError('usage', `${token} was given more than once`);
    }
    values[token] = value;
    index += 1;
  }
  return values;
}

export function run(argv, streams = process) {
  if (argv.includes('--probe')) {
    streams.stdout.write('spec-pair: available\n');
    return 0;
  }
  try {
    const values = parseArguments(argv);
    const specPath = values['--spec'] ?? null;
    const nanoPath = values['--nano'] ?? null;
    const fullPath = values['--full'] ?? null;
    const repositoryRoot = values['--repository-root'] ?? null;
    if (!specPath && !nanoPath) {
      return usage(streams);
    }
    // A conflicting target combination is the more fundamental usage error;
    // let stageSpecPair report it. Otherwise the boundary root is required:
    // guarantee 5 states containment has no silent fall back to a default, so
    // the flag cannot be omitted into an unbounded resolution.
    if (!(specPath && (nanoPath || fullPath)) && !repositoryRoot) {
      throw new SpecPairError(
        'unsafe_path',
        '--repository-root is required so both paths resolve inside a declared boundary; there is no default',
      );
    }
    const record = stageSpecPair({ specPath, nanoPath, fullPath, repositoryRoot });
    streams.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    return 0;
  } catch (error) {
    const code = error instanceof SpecPairError ? error.code : 'usage';
    streams.stderr.write(`${code}: ${error.message}\n`);
    return 1;
  }
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
  process.exitCode = run(process.argv.slice(2));
}
