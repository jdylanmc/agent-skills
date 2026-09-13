#!/usr/bin/env node

/**
 * Deterministic specification-outcome resolver.
 *
 * Approval is resolved from default-branch observation, not from narration.
 * Only 'approved' and 'draft' are accepted — any other string, including
 * values that look like narration ('pending', 'yes', 'confirmed'), is refused
 * as invalid-input. This closes the hole where a narrated value could enter.
 *
 * The contradiction seam consumes a verdict from companion issue #123 without
 * deciding it: 'not-checked' and 'none' both hold (failing toward silence),
 * and 'escalated' returns 'needs-decision' because a contradiction is a
 * question for a human.
 *
 * When sourceStatus is 'held', the run re-derived nothing, so pair, Roast,
 * gap, and decision counts are irrelevant — only approval and contradiction
 * matter. 'held' without 'approved' is a contract violation.
 */

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
  'contradiction',
];

const VALID_APPROVALS = ['approved', 'draft'];
const VALID_CONTRADICTIONS = ['not-checked', 'none', 'escalated'];
const VALID_SOURCE_STATUSES = ['ready', 'incomplete', 'held'];

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

  if (!VALID_APPROVALS.includes(input.approval)) {
    throw new SpecOutcomeError('invalid-input', `approval must be one of ${VALID_APPROVALS.join(', ')}; got ${input.approval}`);
  }

  if (!VALID_CONTRADICTIONS.includes(input.contradiction)) {
    throw new SpecOutcomeError('invalid-input', `contradiction must be one of ${VALID_CONTRADICTIONS.join(', ')}; got ${input.contradiction}`);
  }

  // Resolve held FIRST, before the blocker checks.
  if (input.sourceStatus === 'held') {
    if (input.approval !== 'approved') {
      throw new SpecOutcomeError(
        'invalid-input',
        'held is unreachable without an approved specification',
      );
    }
    if (input.contradiction === 'escalated') {
      return {
        status: 'needs-decision',
        reasons: ['enriched Discovery evidence contradicts the approved specification'],
      };
    }
    return { status: 'held', reasons: [] };
  }

  const discoveryGaps = count(input.discoveryGaps, 'discoveryGaps');
  const openDecisions = count(input.openDecisions, 'openDecisions');
  const siblingConflicts = count(input.siblingConflicts, 'siblingConflicts');
  const openMustFix = count(input.openMustFix, 'openMustFix');

  const blockers = [];
  if (!VALID_SOURCE_STATUSES.includes(input.sourceStatus)) {
    blockers.push(`source status is ${input.sourceStatus}`);
  }
  if (input.pairStatus !== 'valid') blockers.push(`pair status is ${input.pairStatus}`);
  if (input.roastStatus !== 'complete') blockers.push(`Roast status is ${input.roastStatus}`);
  if (openMustFix > 0) blockers.push(`${openMustFix} Must fix finding(s) remain`);
  if (blockers.length) {
    return { status: 'blocked', reasons: blockers };
  }

  if (input.sourceStatus === 'incomplete' || discoveryGaps > 0) {
    return {
      status: 'needs-discovery',
      reasons: input.sourceStatus === 'incomplete'
        ? ['the confirmed Discovery source is materially incomplete']
        : [`${discoveryGaps} Discovery gap(s) remain`],
    };
  }

  // An escalated contradiction is a question for a human and must never be
  // silently dropped, regardless of source state. It produces needs-decision
  // on every path where the run is not already blocked or needs-discovery.
  const decisions = [];
  if (input.contradiction === 'escalated') {
    decisions.push('enriched Discovery evidence contradicts the approved specification');
  }
  if (openDecisions > 0) decisions.push(`${openDecisions} product decision(s) remain`);
  if (siblingConflicts > 0) decisions.push(`${siblingConflicts} sibling conflict(s) remain`);
  if (decisions.length) {
    return { status: 'needs-decision', reasons: decisions };
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
