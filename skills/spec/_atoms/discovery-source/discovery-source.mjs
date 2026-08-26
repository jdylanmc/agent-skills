#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class DiscoverySourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiscoverySourceError';
    this.code = code;
  }
}

export const SOURCE_KINDS = ['markdown', 'tracker-issue'];
export const STATE_VERSION = 1;

const FIELDS = [
  'version',
  'kind',
  'locator',
  'alignment',
  'capturedRevision',
  'currentRevision',
  'confirmedFacts',
  'decisions',
  'assumptions',
  'contradictions',
  'unresolvedQuestions',
  'scope',
  'exclusions',
];

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DiscoverySourceError('incomplete', `${field} must be non-empty text`);
  }
  return value.trim();
}

function stringArray(value, field, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new DiscoverySourceError('incomplete', `${field} must be an array of non-empty strings`);
  }
  if (nonEmpty && value.length === 0) {
    throw new DiscoverySourceError('incomplete', `${field} must not be empty`);
  }
  return value.map((entry) => entry.trim());
}

function normalizedPath(candidate) {
  return candidate.split(path.sep).join('/').replace(/^\.\//, '');
}

function validateLocator(kind, locator) {
  if (kind === 'markdown') {
    const normalized = normalizedPath(locator);
    if (
      normalized.includes('..')
      || !normalized.startsWith('docs/agent/discovery/')
      || !normalized.endsWith('.md')
    ) {
      throw new DiscoverySourceError(
        'invalid-source',
        'a Markdown Discovery source must be a .md path beneath docs/agent/discovery/',
      );
    }
    return normalized;
  }

  let parsed;
  try {
    parsed = new URL(locator);
  } catch {
    throw new DiscoverySourceError('invalid-source', 'a tracker issue locator must be an HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new DiscoverySourceError(
      'invalid-source',
      'a tracker issue locator must be an HTTPS URL without embedded credentials',
    );
  }
  return parsed.toString();
}

export function validateDiscoverySource(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DiscoverySourceError('invalid-source', 'the Discovery intake must be an object');
  }
  const unknown = Object.keys(input).filter((field) => !FIELDS.includes(field)).sort();
  if (unknown.length) {
    throw new DiscoverySourceError('invalid-source', `unknown field(s): ${unknown.join(', ')}`);
  }
  const missing = FIELDS.filter((field) => !(field in input));
  if (missing.length) {
    throw new DiscoverySourceError('invalid-source', `missing field(s): ${missing.join(', ')}`);
  }
  if (input.version !== STATE_VERSION) {
    throw new DiscoverySourceError('invalid-source', `version must be ${STATE_VERSION}`);
  }
  const kind = text(input.kind, 'kind');
  if (!SOURCE_KINDS.includes(kind)) {
    throw new DiscoverySourceError(
      'invalid-source',
      `kind must be one of ${SOURCE_KINDS.join(', ')}`,
    );
  }
  const locator = validateLocator(kind, text(input.locator, 'locator'));
  if (input.alignment !== 'confirmed') {
    throw new DiscoverySourceError(
      'unconfirmed',
      'alignment must be exactly confirmed; raw conversation and inferred agreement do not count',
    );
  }
  const capturedRevision = text(input.capturedRevision, 'capturedRevision');
  const currentRevision = text(input.currentRevision, 'currentRevision');
  if (capturedRevision !== currentRevision) {
    throw new DiscoverySourceError(
      'stale',
      `the Discovery source changed after confirmation (${capturedRevision} != ${currentRevision})`,
    );
  }
  if (kind === 'markdown' && !/^[a-f0-9]{64}$/i.test(capturedRevision)) {
    throw new DiscoverySourceError(
      'invalid-source',
      'a Markdown revision must be a SHA-256 digest',
    );
  }

  return {
    status: 'ready',
    source: {
      version: STATE_VERSION,
      kind,
      locator,
      alignment: 'confirmed',
      revision: capturedRevision,
      confirmedFacts: stringArray(input.confirmedFacts, 'confirmedFacts', { nonEmpty: true }),
      decisions: stringArray(input.decisions, 'decisions'),
      assumptions: stringArray(input.assumptions, 'assumptions'),
      contradictions: stringArray(input.contradictions, 'contradictions'),
      unresolvedQuestions: stringArray(input.unresolvedQuestions, 'unresolvedQuestions'),
      scope: stringArray(input.scope, 'scope', { nonEmpty: true }),
      exclusions: stringArray(input.exclusions, 'exclusions', { nonEmpty: true }),
    },
  };
}

export const USAGE = 'Usage: discovery-source.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new DiscoverySourceError('usage', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  streams.stdout.write(`${JSON.stringify(validateDiscoverySource(input), null, 2)}\n`);
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
      error: { code: error.code ?? 'invalid-source', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
