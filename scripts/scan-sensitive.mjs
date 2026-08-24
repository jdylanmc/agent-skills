#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  findConfiguredIdentifiers,
  loadIdentifierConfig,
} from '../skills/_base/_atoms/redact-sensitive/redact-sensitive.config.mjs';
import {
  redactText,
} from '../skills/_base/_molecules/persist-bounded-handoff/persist-bounded-handoff.mjs';

const MAX_REDACTION_CHUNK_BYTES = 60_000;
const ZERO_SHA = /^0+$/;

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function git(repository, args, options = {}) {
  return execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function lineAt(text, offset, firstLine = 1) {
  let line = firstLine;
  for (let index = 0; index < offset; index += 1) {
    if (text[index] === '\n') {
      line += 1;
    }
  }
  return line;
}

function finding(anchor, evidenceType, count = 1) {
  return { anchor, evidenceType, count };
}

function chunksByLine(text, firstLine) {
  const chunks = [];
  const lines = text.split(/(?<=\n)/);
  let current = '';
  let currentLine = firstLine;
  let nextLine = firstLine;

  for (const line of lines) {
    if (
      current
      && Buffer.byteLength(current, 'utf8') + Buffer.byteLength(line, 'utf8')
        > MAX_REDACTION_CHUNK_BYTES
    ) {
      chunks.push({ text: current, firstLine: currentLine });
      current = '';
      currentLine = nextLine;
    }
    if (Buffer.byteLength(line, 'utf8') > MAX_REDACTION_CHUNK_BYTES) {
      chunks.push({ text: null, firstLine: nextLine });
    } else {
      current += line;
    }
    nextLine += (line.match(/\n/g) ?? []).length;
  }
  if (current) {
    chunks.push({ text: current, firstLine: currentLine });
  }
  return chunks;
}

export function scanText(text, baseAnchor, identifiers, firstLine = 1) {
  const findings = [];
  const unscanned = [];

  const lines = text.split(/(?<=\n)/);
  let nextLine = firstLine;
  for (const line of lines) {
    const lineNumber = nextLine;
    nextLine += (line.match(/\n/g) ?? []).length;
    if (Buffer.byteLength(line, 'utf8') > MAX_REDACTION_CHUNK_BYTES) {
      unscanned.push({
        anchor: { ...baseAnchor, lineStart: lineNumber, lineEnd: lineNumber },
        reason: 'line exceeds the bounded redaction input',
      });
      continue;
    }
    const result = redactText(line);
    for (const entry of result.redactions.filter(({ category }) => category !== 'private-key')) {
      findings.push(finding(
        { ...baseAnchor, lineStart: lineNumber, lineEnd: lineNumber },
        entry.category,
        entry.count,
      ));
    }
  }

  for (const chunk of chunksByLine(text, firstLine)) {
    if (chunk.text === null) {
      continue;
    }
    const result = redactText(chunk.text);
    const lineEnd = lineAt(chunk.text, chunk.text.length, chunk.firstLine);
    for (const entry of result.redactions.filter(({ category }) => category === 'private-key')) {
      findings.push(finding(
        { ...baseAnchor, lineStart: chunk.firstLine, lineEnd },
        entry.category,
        entry.count,
      ));
    }
  }

  for (const match of findConfiguredIdentifiers(text, identifiers)) {
    findings.push(finding(
      {
        ...baseAnchor,
        lineStart: lineAt(text, match.start, firstLine),
        lineEnd: lineAt(text, match.end, firstLine),
      },
      match.evidenceType,
    ));
  }

  return { findings, unscanned };
}

export function parseAddedHunks(diff) {
  const hunks = [];
  let file = null;
  let current = null;
  let awaitingNewPath = false;
  let inHunk = false;
  let nextLine = 0;

  const flush = () => {
    if (current?.lines.length) {
      hunks.push({
        path: current.path,
        firstLine: current.firstLine,
        text: `${current.lines.join('\n')}\n`,
      });
    }
    current = null;
  };

  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      file = null;
      awaitingNewPath = false;
      inHunk = false;
      continue;
    }
    if (!inHunk && line.startsWith('--- ')) {
      awaitingNewPath = true;
      continue;
    }
    if (!inHunk && awaitingNewPath && line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? null : line.slice(6);
      awaitingNewPath = false;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      flush();
      inHunk = true;
      nextLine = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (file === null || line.startsWith('\\ No newline')) {
      continue;
    }
    if (line.startsWith('+')) {
      if (current === null) {
        current = { path: file, firstLine: nextLine, lines: [] };
      }
      current.lines.push(line.slice(1));
      nextLine += 1;
      continue;
    }
    flush();
    if (line.startsWith(' ')) {
      nextLine += 1;
    }
  }
  flush();
  return hunks;
}

function eventRange(event) {
  if (event?.pull_request?.base?.sha && event?.pull_request?.head?.sha) {
    return {
      base: event.pull_request.base.sha,
      head: event.pull_request.head.sha,
    };
  }
  if (event?.before && event?.after && !ZERO_SHA.test(event.before)) {
    return { base: event.before, head: event.after };
  }
  return null;
}

function changedPaths(repository, range) {
  return git(repository, [
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    '-z',
    `${range.base}...${range.head}`,
    '--',
  ])
    .split('\0')
    .filter(Boolean)
    .map(toPosix);
}

function binaryPaths(repository, range) {
  return git(repository, [
    'diff',
    '--numstat',
    '--no-renames',
    '-z',
    `${range.base}...${range.head}`,
    '--',
  ])
    .split('\0')
    .filter(Boolean)
    .flatMap((record) => {
      const match = /^-\t-\t(.+)$/.exec(record);
      return match ? [toPosix(match[1])] : [];
    });
}

function scanSource(text, anchor, identifiers, firstLine = 1, configuredOnly = false) {
  if (configuredOnly) {
    return {
      findings: findConfiguredIdentifiers(text, identifiers).map((match) => finding(
        {
          ...anchor,
          lineStart: lineAt(text, match.start, firstLine),
          lineEnd: lineAt(text, match.end, firstLine),
        },
        match.evidenceType,
      )),
      unscanned: [],
    };
  }
  return scanText(text, anchor, identifiers, firstLine);
}

function merge(target, result) {
  target.findings.push(...result.findings);
  target.unscanned.push(...result.unscanned);
}

function scanPathNames(paths, identifiers, result) {
  for (const file of paths) {
    merge(result, scanSource(
      file,
      { source: 'tracked-filename', path: file },
      identifiers,
    ));
  }
}

function scanChangedContent(repository, range, identifiers, result) {
  const diff = git(repository, [
    '-c',
    'core.quotePath=false',
    'diff',
    '--no-ext-diff',
    '--unified=0',
    '--no-color',
    '--no-renames',
    `${range.base}...${range.head}`,
    '--',
  ]);
  for (const hunk of parseAddedHunks(diff)) {
    merge(result, scanSource(
      hunk.text,
      { source: 'added-content', path: hunk.path },
      identifiers,
      hunk.firstLine,
    ));
  }
  for (const file of binaryPaths(repository, range)) {
    result.unscanned.push({
      anchor: { source: 'added-binary', path: file },
      reason: 'binary content requires an explicit human review',
    });
  }
}

function scanTrackedTree(repository, identifiers, result) {
  const paths = git(repository, ['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .map(toPosix);
  scanPathNames(paths, identifiers, result);

  for (const file of paths) {
    const absolute = path.join(repository, ...file.split('/'));
    const content = fs.readFileSync(absolute);
    if (content.includes(0)) {
      result.unscanned.push({
        anchor: { source: 'tracked-binary', path: file },
        reason: 'binary content requires an explicit human review',
      });
      continue;
    }
    merge(result, scanSource(
      content.toString('utf8'),
      { source: 'tracked-content', path: file },
      identifiers,
    ));
  }
}

function scanEventMetadata(event, identifiers, result) {
  if (event?.pull_request) {
    merge(result, scanSource(
      event.pull_request.title ?? '',
      { source: 'pull-request-title' },
      identifiers,
    ));
    merge(result, scanSource(
      event.pull_request.body ?? '',
      { source: 'pull-request-body' },
      identifiers,
    ));
  }
}

function scanCommitMetadata(repository, range, identifiers, result) {
  const records = git(repository, [
    'log',
    '--format=%H%x1f%an%x1f%ae%x1f%B%x1e',
    `${range.base}..${range.head}`,
  ]).split('\x1e').filter((record) => record.trim());

  for (const record of records) {
    const [sha, authorName, authorEmail, ...messageParts] = record.split('\x1f');
    const shortSha = sha.trim().slice(0, 12);
    const message = messageParts.join('\x1f');
    const trailerLines = [];
    const messageLines = [];
    for (const line of message.split('\n')) {
      if (/^(?:Co-authored-by|Signed-off-by):/i.test(line)) {
        trailerLines.push(line);
      } else {
        messageLines.push(line);
      }
    }
    merge(result, scanSource(
      messageLines.join('\n'),
      { source: 'commit-message', commit: shortSha },
      identifiers,
    ));
    merge(result, scanSource(
      trailerLines.join('\n'),
      { source: 'commit-identity-trailer', commit: shortSha },
      identifiers,
      1,
      true,
    ));
    merge(result, scanSource(
      `${authorName}\n${authorEmail}`,
      { source: 'commit-author', commit: shortSha },
      identifiers,
      1,
      true,
    ));
  }
}

function parseArguments(argv) {
  const parsed = {
    repository: process.cwd(),
    config: null,
    event: process.env.GITHUB_EVENT_PATH ?? null,
    all: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--all') {
      parsed.all = true;
      continue;
    }
    if (['--repository', '--config', '--event'].includes(argument)) {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a value`);
      }
      parsed[argument.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  return parsed;
}

export function scanRepository({
  repository,
  identifiers,
  event = null,
  all = false,
}) {
  const result = { findings: [], unscanned: [] };
  let range = eventRange(event);

  if (all) {
    scanTrackedTree(repository, identifiers, result);
  } else {
    if (range === null) {
      range = {
        base: git(repository, ['rev-parse', 'HEAD^']).trim(),
        head: git(repository, ['rev-parse', 'HEAD']).trim(),
      };
    }
    const paths = changedPaths(repository, range);
    scanPathNames(paths, identifiers, result);
    scanChangedContent(repository, range, identifiers, result);
    scanCommitMetadata(repository, range, identifiers, result);
  }
  scanEventMetadata(event, identifiers, result);

  result.findings.sort((left, right) => (
    JSON.stringify(left.anchor).localeCompare(JSON.stringify(right.anchor))
      || left.evidenceType.localeCompare(right.evidenceType)
  ));
  result.unscanned.sort((left, right) => (
    JSON.stringify(left.anchor).localeCompare(JSON.stringify(right.anchor))
  ));
  return result;
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
    const args = parseArguments(process.argv.slice(2));
    const config = loadIdentifierConfig({
      file: args.config,
      json: process.env.REDACT_SENSITIVE_CONFIG_JSON,
    });
    const event = args.event ? JSON.parse(fs.readFileSync(args.event, 'utf8')) : null;
    const result = scanRepository({
      repository: path.resolve(args.repository),
      identifiers: config.identifiers,
      event,
      all: args.all,
    });
    result.configuration = {
      identifierCount: config.identifiers.length,
      source: args.config
        ? 'file'
        : (process.env.REDACT_SENSITIVE_CONFIG_JSON ? 'environment' : 'none'),
    };
    result.warnings = config.identifiers.length === 0
      ? ['repository-specific identifier configuration is not present']
      : [];
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (
      config.identifiers.length === 0
      && process.env.GITHUB_ACTIONS === 'true'
    ) {
      process.stderr.write(
        '::warning title=Sensitive identifier configuration missing::'
          + 'Only the deterministic secret and personal-data floor ran.\n',
      );
    }
    if (result.findings.length || result.unscanned.length) {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: {
        code: error.code ?? 'scan_failed',
        message: error.message,
      },
    })}\n`);
    process.exitCode = 1;
  }
}
