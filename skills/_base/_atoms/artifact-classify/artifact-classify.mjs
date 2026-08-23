#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class ArtifactClassificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ArtifactClassificationError';
    this.code = code;
  }
}

/**
 * `/roast` is one entry point with two coordination shapes. The three
 * single-artifact types share the artifact branch; code-review scope has its
 * own branch and deliberately does not share it.
 */
const ROUTES = {
  agent: 'artifact',
  skill: 'artifact',
  prompt: 'artifact',
  code: 'code',
};

const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.cs', '.css', '.go', '.h', '.hpp', '.html', '.java', '.js',
  '.jsx', '.json', '.kt', '.m', '.mm', '.php', '.ps1', '.py', '.rb', '.rs', '.sh', '.sql',
  '.swift', '.ts', '.tsx', '.vue', '.xml', '.yaml', '.yml',
]);

function evidence(rule, detail) {
  return { rule, detail };
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, '/');
}

function parseFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { fields: new Map(), body: normalized };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { fields: new Map(), body: normalized };
  }
  const fields = new Map();
  for (const line of normalized.slice(4, end).split('\n')) {
    const match = /^([A-Za-z][A-Za-z-]*):\s*(.*)$/.exec(line);
    if (match) {
      fields.set(match[1].toLowerCase(), match[2].trim());
    }
  }
  return { fields, body: normalized.slice(end + 5) };
}

function scoreFromSignals(signals) {
  if (signals.some((signal) => signal.strength === 'high')) {
    return 'high';
  }
  if (signals.some((signal) => signal.strength === 'medium')) {
    return 'medium';
  }
  return 'low';
}

function addSignal(signals, type, strength, rule, detail) {
  signals.push({ type, strength, evidence: evidence(rule, detail) });
}

function resultFromSignals(signals, locator) {
  const grouped = new Map();
  for (const signal of signals) {
    if (!grouped.has(signal.type)) {
      grouped.set(signal.type, []);
    }
    grouped.get(signal.type).push(signal);
  }

  const strongTypes = [...grouped.entries()]
    .filter(([, entries]) => entries.some((entry) => entry.strength === 'high' || entry.strength === 'medium'))
    .map(([type]) => type);

  if (strongTypes.length === 1) {
    const type = strongTypes[0];
    const entries = grouped.get(type);
    return {
      status: 'Classified',
      type,
      routeToBranch: ROUTES[type],
      confidence: scoreFromSignals(entries),
      locator,
      evidence: entries.map((entry) => entry.evidence),
    };
  }

  if (strongTypes.length > 1) {
    return {
      status: 'Refused',
      category: 'Ambiguous target',
      locator,
      candidates: strongTypes.map((type) => ({
        type,
        routeToBranch: ROUTES[type],
        evidence: grouped.get(type).map((entry) => entry.evidence),
      })),
      couldNotDistinguish: strongTypes,
    };
  }

  return {
    status: 'Refused',
    category: 'Insufficient evidence',
    locator,
    candidates: ['agent', 'skill', 'prompt', 'code'].map((type) => ({ type, routeToBranch: ROUTES[type] })),
    couldNotDistinguish: ['agent', 'skill', 'prompt', 'code'],
    evidence: signals.map((signal) => signal.evidence),
  };
}

function looksLikeDiff(text) {
  return /^(diff --git |@@ |Index: |---[ \t]+a\/|\+\+\+[ \t]+b\/)/m.test(text);
}

function looksLikeCode(text) {
  return /(^|\n)\s*(import|export|const|let|var|function|class|interface|namespace|using|#include|def|package)\b/.test(text)
    || /[{};]\s*$/.test(text.trim());
}

function classifyReference(reference) {
  const value = String(reference ?? '').trim();
  const signals = [];
  if (/\b(?:pr|pull request)\s*#?\d+\b/i.test(value) || /github\.com\/[^/]+\/[^/]+\/pull\/\d+/i.test(value)) {
    addSignal(signals, 'code', 'high', 'pull-request reference', value);
  } else if (/\b(?:branch diff|working[- ]tree|worktree changes|uncommitted changes|diff)\b/i.test(value)) {
    addSignal(signals, 'code', 'high', 'diff reference', value);
  }
  return resultFromSignals(signals, value || 'reference');
}

function classifyText(text, locator = 'supplied-text') {
  if (typeof text !== 'string' || text.length === 0) {
    throw new ArtifactClassificationError('invalid_input', 'text target must be a non-empty string');
  }
  const signals = [];
  const parsed = parseFrontmatter(text);
  if (parsed.fields.has('allowed-tools')) {
    addSignal(signals, 'skill', 'high', 'skill frontmatter', 'frontmatter declares allowed-tools');
  }
  if (parsed.fields.has('tools') && parsed.fields.has('target')) {
    addSignal(signals, 'agent', 'high', 'agent frontmatter', 'frontmatter declares target and tools');
  }
  if (looksLikeDiff(text)) {
    addSignal(signals, 'code', 'high', 'diff syntax', 'text contains unified diff markers');
  } else if (looksLikeCode(text)) {
    addSignal(signals, 'code', 'medium', 'code syntax', 'text contains source-code syntax markers');
  }
  if (signals.length === 0 && /\b(you are|your task|instructions?|respond|output|do not|never|always)\b/i.test(text)) {
    addSignal(signals, 'prompt', 'medium', 'prompt wording', 'supplied text is instructional and has no stronger artifact marker');
  }
  return resultFromSignals(signals, locator);
}

function relativePathInside(root, targetPath) {
  const absolute = path.resolve(root, targetPath);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ArtifactClassificationError('path_outside_root', 'path target must stay inside repositoryRoot');
  }
  return { absolute, relative: normalizeSlashes(relative) };
}

function classifyPath({ targetPath, repositoryRoot = process.cwd() }) {
  if (typeof targetPath !== 'string' || targetPath.trim() === '') {
    throw new ArtifactClassificationError('invalid_input', 'path target must be a non-empty string');
  }
  const { absolute, relative } = relativePathInside(repositoryRoot, targetPath);
  const signals = [];
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    return {
      status: 'Refused',
      category: 'Unreadable target',
      locator: relative,
      couldNotDistinguish: ['agent', 'skill', 'prompt', 'code'],
      evidence: [evidence('filesystem', 'path does not exist or is not readable')],
    };
  }
  if (stat.isSymbolicLink()) {
    return {
      status: 'Refused',
      category: 'Unreadable target',
      locator: relative,
      couldNotDistinguish: ['agent', 'skill', 'prompt', 'code'],
      evidence: [evidence('filesystem', 'symbolic links are not classified')],
    };
  }
  if (stat.isDirectory()) {
    if (fs.existsSync(path.join(absolute, 'SKILL.md')) && /^skills\/[^/]+$/.test(relative) && !relative.startsWith('skills/_base/')) {
      addSignal(signals, 'skill', 'high', 'skill package directory', `${relative}/SKILL.md exists`);
    }
    return resultFromSignals(signals, relative);
  }
  if (!stat.isFile()) {
    return {
      status: 'Refused',
      category: 'Unreadable target',
      locator: relative,
      couldNotDistinguish: ['agent', 'skill', 'prompt', 'code'],
      evidence: [evidence('filesystem', 'target is neither a regular file nor a directory')],
    };
  }

  const basename = path.basename(relative);
  const extension = path.extname(relative).toLowerCase();
  const text = fs.readFileSync(absolute, 'utf8');
  const parsed = parseFrontmatter(text);

  if (/^(?:agents|\.github\/agents)\/[^/]+\.agent\.md$/.test(relative)) {
    addSignal(signals, 'agent', 'high', 'agent path convention', relative);
  }
  if (parsed.fields.has('tools') && parsed.fields.has('target') && basename.endsWith('.agent.md')) {
    addSignal(signals, 'agent', 'high', 'agent frontmatter', 'frontmatter declares target and tools');
  }
  if (/^skills\/[^/]+\/SKILL\.md$/.test(relative)) {
    addSignal(signals, 'skill', 'high', 'skill entry path convention', relative);
  }
  if (parsed.fields.has('allowed-tools') && basename === 'SKILL.md') {
    addSignal(signals, 'skill', 'high', 'skill frontmatter', 'frontmatter declares allowed-tools');
  }
  if (/\.prompt\.md$/i.test(basename) || /(^|\/)prompts?\//i.test(relative)) {
    addSignal(signals, 'prompt', 'high', 'prompt path convention', relative);
  }
  if (CODE_EXTENSIONS.has(extension) && !basename.endsWith('.md')) {
    addSignal(signals, 'code', 'high', 'source extension', extension);
  }
  if (looksLikeDiff(text)) {
    addSignal(signals, 'code', 'high', 'diff syntax', 'file contains unified diff markers');
  }

  return resultFromSignals(signals, relative);
}

export function classifyArtifact(input = {}) {
  const repositoryRoot = input.repositoryRoot ?? process.cwd();
  if (input.path !== undefined) {
    return classifyPath({ targetPath: input.path, repositoryRoot });
  }
  if (input.text !== undefined || input.pastedText !== undefined) {
    return classifyText(input.text ?? input.pastedText, input.locator ?? 'supplied-text');
  }
  if (input.reference !== undefined) {
    return classifyReference(input.reference);
  }
  if (typeof input.target === 'string') {
    if (input.target.includes('\n')) {
      return classifyText(input.target, input.locator ?? 'supplied-text');
    }
    const referenceResult = classifyReference(input.target);
    if (referenceResult.status === 'Classified') {
      return referenceResult;
    }
    return classifyPath({ targetPath: input.target, repositoryRoot });
  }
  throw new ArtifactClassificationError('invalid_input', 'provide path, text, pastedText, reference, or target');
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

export function run(argv, streams = process) {
  if (argv.includes('--probe')) {
    streams.stdout.write('artifact-classify: available\n');
    return 0;
  }
  try {
    const input = JSON.parse(readStdin());
    const result = classifyArtifact(input);
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'Classified' ? 0 : 2;
  } catch (error) {
    const code = error instanceof ArtifactClassificationError ? error.code : 'invalid_input';
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
