#!/usr/bin/env node

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

const NANO_HEADINGS = ['Intention', 'Acceptance Criteria', 'Non-goals'];
const FULL_REQUIRED_HEADINGS = [
  'Authority',
  'Problem and Users',
  'Outcomes and Success',
  'Scope and Non-goals',
  'Constraints and Dependencies',
  'Confirmed Facts',
  'Assumptions',
  'Contradictions',
  'Alternatives and Examples',
  'Product Requirements',
  'Product Decisions',
  'Traceability',
  'Open Questions',
];

function slash(candidate) {
  return candidate.split(path.sep).join('/');
}

function pairPaths(repositoryRoot, nanoPath, fullPath) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.trim() === '') {
    throw new SpecPairError('invalid-input', 'repositoryRoot is required');
  }
  const root = slash(path.resolve(repositoryRoot));
  const expectedDirectory = `${root}/docs/agent/specs`;
  const nano = slash(path.resolve(nanoPath));
  const full = slash(path.resolve(fullPath));
  const nanoMatch = nano.match(/\/([a-z0-9]+(?:-[a-z0-9]+)*)\.nano\.md$/);
  const fullMatch = full.match(/\/([a-z0-9]+(?:-[a-z0-9]+)*)\.full\.md$/);
  if (!nanoMatch || !fullMatch || nanoMatch[1] !== fullMatch[1]) {
    throw new SpecPairError(
      'invalid-path',
      'the pair must be same-slug .nano.md and .full.md siblings beneath docs/agent/specs/',
    );
  }
  if (path.dirname(nano) !== path.dirname(full)) {
    throw new SpecPairError('invalid-path', 'the nano and full documents must be siblings');
  }
  if (path.dirname(nano) !== expectedDirectory || path.dirname(full) !== expectedDirectory) {
    throw new SpecPairError(
      'invalid-path',
      `the pair must be directly beneath ${expectedDirectory}`,
    );
  }
  return { root, nano, full, slug: nanoMatch[1] };
}

function withoutFencedBlocks(text) {
  const output = [];
  let fence = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*(```+|~~~+)/)?.[1] ?? null;
    if (marker) {
      if (fence === null) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      output.push('');
      continue;
    }
    output.push(fence === null ? line : '');
  }
  return output.join('\n');
}

function lineValue(text, label) {
  const visible = withoutFencedBlocks(text);
  const matches = [...visible.matchAll(new RegExp(`^- ${label}:\\s*(.+)$`, 'gm'))];
  if (matches.length !== 1) {
    throw new SpecPairError('invalid-shape', `${label} must appear exactly once`);
  }
  return matches[0][1].trim();
}

function headings(text) {
  return [...withoutFencedBlocks(text).matchAll(/^##\s+(.+?)\s*$/gm)].map((match) => match[1]);
}

function section(text, heading) {
  const lines = withoutFencedBlocks(text).split(/\r?\n/);
  const marker = `## ${heading}`;
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start === -1) return null;
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, next === -1 ? lines.length : next).join('\n').trim();
}

function relativeLink(value) {
  const match = value.match(/^\[[^\]]+\]\((\.\/[^)]+)\)$/);
  return match ? match[1] : null;
}

function acceptanceCriteria(nanoText) {
  const body = section(nanoText, 'Acceptance Criteria');
  if (!body) {
    throw new SpecPairError('invalid-nano', 'Acceptance Criteria must be non-empty');
  }
  const entries = body.split('\n').filter((line) => line.trim() !== '');
  const ids = [];
  for (const line of entries) {
    const match = line.match(/^- (AC-\d{3}):\s+(.+)$/);
    if (!match) {
      throw new SpecPairError(
        'invalid-nano',
        `acceptance criteria must use "- AC-###: outcome": ${line}`,
      );
    }
    ids.push(match[1]);
  }
  if (new Set(ids).size !== ids.length) {
    throw new SpecPairError('invalid-nano', 'acceptance-criteria identifiers must be unique');
  }
  return ids;
}

function validateNano(text, slug) {
  const actualHeadings = headings(text);
  const expectedHeadings = actualHeadings.includes('Non-goals')
    ? NANO_HEADINGS
    : NANO_HEADINGS.slice(0, 2);
  if (
    actualHeadings.length !== expectedHeadings.length
    || actualHeadings.some((heading, index) => heading !== expectedHeadings[index])
  ) {
    throw new SpecPairError(
      'invalid-nano',
      `nano headings must be exactly ${NANO_HEADINGS.join(', ')} in order, with Non-goals optional`,
    );
  }
  const intent = section(text, 'Intention');
  if (!intent) {
    throw new SpecPairError('invalid-nano', 'Intention must be non-empty');
  }
  const fullLink = relativeLink(lineValue(text, 'Full specification'));
  if (fullLink !== `./${slug}.full.md`) {
    throw new SpecPairError('invalid-link', `nano must link to ./${slug}.full.md`);
  }
  return {
    specId: lineValue(text, 'Spec ID'),
    source: lineValue(text, 'Source'),
    revision: lineValue(text, 'Source revision'),
    acceptanceCriteria: acceptanceCriteria(text),
  };
}

function authoritativeEntries(text, heading, authorityIds) {
  const body = section(text, heading);
  if (body === null) {
    throw new SpecPairError('invalid-full', `${heading} is required`);
  }
  if (body === '' || body === 'None.') return [];
  const entries = body.split('\n').filter((line) => line.trim() !== '');
  for (const line of entries) {
    const match = line.match(/^- [A-Z]+-\d{3}\s+\[(INTENT|AC-\d{3})\]:\s+(.+)$/);
    if (!match) {
      throw new SpecPairError(
        'untraceable-authority',
        `${heading} entries must use "- ID [INTENT|AC-###]: detail": ${line}`,
      );
    }
    if (match[1] !== 'INTENT' && !authorityIds.has(match[1])) {
      throw new SpecPairError(
        'untraceable-authority',
        `${heading} references unknown nano authority ${match[1]}`,
      );
    }
  }
  return entries;
}

function validateFull(text, slug, nano) {
  const actualHeadings = headings(text);
  if (
    actualHeadings.length !== FULL_REQUIRED_HEADINGS.length
    || actualHeadings.some((heading, index) => heading !== FULL_REQUIRED_HEADINGS[index])
  ) {
    throw new SpecPairError(
      'invalid-full',
      `full headings must be exactly ${FULL_REQUIRED_HEADINGS.join(', ')} in order`,
    );
  }
  for (const heading of FULL_REQUIRED_HEADINGS) {
    if (section(text, heading) === null) {
      throw new SpecPairError('invalid-full', `${heading} is required`);
    }
  }
  const nanoLink = relativeLink(lineValue(text, 'Nano authority'));
  if (nanoLink !== `./${slug}.nano.md`) {
    throw new SpecPairError('invalid-link', `full must link to ./${slug}.nano.md`);
  }
  const identity = {
    specId: lineValue(text, 'Spec ID'),
    source: lineValue(text, 'Source'),
    revision: lineValue(text, 'Source revision'),
  };
  for (const field of Object.keys(identity)) {
    if (identity[field] !== nano[field]) {
      throw new SpecPairError('identity-mismatch', `${field} differs between nano and full`);
    }
  }
  if (!/^SPEC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(identity.specId)) {
    throw new SpecPairError(
      'invalid-identity',
      'Spec ID must use stable uppercase SPEC-SEGMENT form',
    );
  }
  const authorityIds = new Set(nano.acceptanceCriteria);
  const requirements = authoritativeEntries(text, 'Product Requirements', authorityIds);
  const decisions = authoritativeEntries(text, 'Product Decisions', authorityIds);
  const traceability = section(text, 'Traceability');
  for (const id of authorityIds) {
    if (!new RegExp(`\\b${id}\\b`).test(traceability)) {
      throw new SpecPairError(
        'missing-traceability',
        `Traceability does not account for nano authority ${id}`,
      );
    }
  }
  return { requirements, decisions };
}

export function validateSpecPair({
  repositoryRoot,
  nanoPath,
  fullPath,
  nanoText,
  fullText,
  expectedSource,
  expectedRevision,
}) {
  const resolved = pairPaths(repositoryRoot, nanoPath, fullPath);
  if (typeof nanoText !== 'string' || typeof fullText !== 'string') {
    throw new SpecPairError('invalid-input', 'nanoText and fullText must be strings');
  }
  const nano = validateNano(nanoText, resolved.slug);
  const full = validateFull(fullText, resolved.slug, nano);
  if (nano.source !== expectedSource || nano.revision !== expectedRevision) {
    throw new SpecPairError(
      'identity-mismatch',
      'the specification provenance does not match the validated Discovery source',
    );
  }
  return {
    status: 'valid',
    slug: resolved.slug,
    specId: nano.specId,
    source: nano.source,
    revision: nano.revision,
    acceptanceCriteria: nano.acceptanceCriteria,
    requirements: full.requirements.length,
    decisions: full.decisions.length,
    nanoPath: resolved.nano,
    fullPath: resolved.full,
  };
}

function refuseSymlinkPath(repositoryRoot, candidate) {
  const root = path.resolve(repositoryRoot);
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new SpecPairError('invalid-path', `path escapes the repository: ${candidate}`);
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new SpecPairError('unsafe-path', `symbolic links are refused: ${current}`);
    }
  }
}

export function validateFiles(repositoryRoot, nanoPath, fullPath, expectedSource, expectedRevision) {
  const paths = pairPaths(repositoryRoot, nanoPath, fullPath);
  for (const candidate of [paths.nano, paths.full]) {
    if (!fs.existsSync(candidate)) {
      throw new SpecPairError('unreadable', `specification artifact does not exist: ${candidate}`);
    }
    refuseSymlinkPath(repositoryRoot, candidate);
    if (!fs.lstatSync(candidate).isFile()) {
      throw new SpecPairError('unreadable', `specification artifact is not a regular file: ${candidate}`);
    }
  }
  return validateSpecPair({
    repositoryRoot,
    nanoPath: paths.nano,
    fullPath: paths.full,
    nanoText: fs.readFileSync(paths.nano, 'utf8'),
    fullText: fs.readFileSync(paths.full, 'utf8'),
    expectedSource,
    expectedRevision,
  });
}

export const USAGE = 'Usage: spec-pair.mjs --root <absolute-path> --nano <absolute-path> --full <absolute-path> --source <locator> --revision <revision>';

export function run(argv, streams = process) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--root', '--nano', '--full', '--source', '--revision'].includes(flag) || !value) {
      throw new SpecPairError('usage', USAGE);
    }
    if (['--root', '--nano', '--full'].includes(flag) && !path.isAbsolute(value)) {
      throw new SpecPairError('usage', USAGE);
    }
    args[flag.slice(2)] = value;
  }
  if (!args.root || !args.nano || !args.full || !args.source || !args.revision || argv.length !== 10) {
    throw new SpecPairError('usage', USAGE);
  }
  streams.stdout.write(`${JSON.stringify(
    validateFiles(args.root, args.nano, args.full, args.source, args.revision),
    null,
    2,
  )}\n`);
  return 0;
}

function direct() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (direct()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.code ?? 'invalid-pair', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
