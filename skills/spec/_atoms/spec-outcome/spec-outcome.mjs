#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class SpecOutcomeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SpecOutcomeError';
    this.code = code;
  }
}

const FIELDS = [
  'sourceStatus',
  'pairStatus',
  'discoveryGaps',
  'openDecisions',
  'siblingConflicts',
  'roastStatus',
  'openMustFix',
  'approval',
];

function count(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new SpecOutcomeError('invalid-input', `${field} must be a non-negative integer`);
  }
  return value;
}

export function resolveSpecOutcome(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new SpecOutcomeError('invalid-input', 'outcome evidence must be an object');
  }
  const unknown = Object.keys(input).filter((field) => !FIELDS.includes(field)).sort();
  if (unknown.length) {
    throw new SpecOutcomeError('invalid-input', `unknown field(s): ${unknown.join(', ')}`);
  }
  for (const field of FIELDS) {
    if (!(field in input)) {
      throw new SpecOutcomeError('invalid-input', `missing field: ${field}`);
    }
  }

  const discoveryGaps = count(input.discoveryGaps, 'discoveryGaps');
  const openDecisions = count(input.openDecisions, 'openDecisions');
  const siblingConflicts = count(input.siblingConflicts, 'siblingConflicts');
  const openMustFix = count(input.openMustFix, 'openMustFix');

  if (input.sourceStatus === 'incomplete' || discoveryGaps > 0) {
    return {
      status: 'needs-discovery',
      reasons: input.sourceStatus === 'incomplete'
        ? ['the confirmed Discovery source is materially incomplete']
        : [`${discoveryGaps} Discovery gap(s) remain`],
    };
  }

  const decisions = [];
  if (openDecisions > 0) decisions.push(`${openDecisions} product decision(s) remain`);
  if (siblingConflicts > 0) decisions.push(`${siblingConflicts} sibling conflict(s) remain`);
  if (decisions.length) {
    return { status: 'needs-decision', reasons: decisions };
  }

  const blockers = [];
  if (input.sourceStatus !== 'ready') blockers.push(`source status is ${input.sourceStatus}`);
  if (input.pairStatus !== 'valid') blockers.push(`pair status is ${input.pairStatus}`);
  if (input.roastStatus !== 'complete') blockers.push(`Roast status is ${input.roastStatus}`);
  if (openMustFix > 0) blockers.push(`${openMustFix} Must fix finding(s) remain`);
  if (blockers.length) {
    return { status: 'blocked', reasons: blockers };
  }

  if (input.approval !== 'approved') {
    return {
      status: 'needs-decision',
      reasons: ['the nano specification is not human-approved'],
    };
  }

  return { status: 'complete', reasons: [] };
}

export const USAGE = 'Usage: spec-outcome.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new SpecOutcomeError('usage', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  streams.stdout.write(`${JSON.stringify(resolveSpecOutcome(input), null, 2)}\n`);
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
      error: { code: error.code ?? 'invalid-input', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
