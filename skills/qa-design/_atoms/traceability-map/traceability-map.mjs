#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reconcile a designed traceability map.
 *
 * Two things are decidable here and nothing else is. Whether every requirement
 * is linked to at least one planned proof, and whether every planned proof is
 * linked to a requirement. Whether the linked proof exists, runs, or passes is
 * not decidable from a map, so every report carries `proof.linkageOnly`.
 */

export class TraceabilityError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TraceabilityError';
    this.code = code;
  }
}

export const EVIDENCE_KINDS = [
  'deterministic-check',
  'example-rule',
  'gherkin-scenario',
  'system-procedure',
];

/**
 * Findings that make the map itself untrustworthy, rather than incomplete.
 * Every one of these is raised at `high` severity, because each one alone is
 * enough to make the reconciliation `invalid`.
 */
const INTEGRITY_CODES = new Set([
  'duplicate-requirement-id',
  'duplicate-evidence-id',
  'unknown-requirement',
  'unknown-evidence',
  'unknown-evidence-kind',
  'unknown-gap-requirement',
  'duplicate-row',
  'empty-row',
  'orphan-evidence',
  'contradictory-gap',
  'gap-without-reason',
]);

function finding(code, severity, subject, detail) {
  return { code, severity, subject, detail };
}

function requireArray(input, field) {
  const value = input[field];
  if (!Array.isArray(value)) {
    throw new TraceabilityError('invalid_input', `${field} must be an array`);
  }
  return value;
}

function requireId(entry, field, context) {
  const value = entry?.[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TraceabilityError('invalid_input', `${context} requires a non-empty ${field}`);
  }
  return value.trim();
}

export function reconcileTraceability(input = {}) {
  const requirements = requireArray(input, 'requirements');
  const evidence = requireArray(input, 'evidence');
  const rows = requireArray(input, 'rows');
  const gaps = input.gaps === undefined ? [] : requireArray(input, 'gaps');
  const findings = [];

  const requirementIds = new Set();
  for (const entry of requirements) {
    const id = requireId(entry, 'id', 'every requirement');
    if (requirementIds.has(id)) {
      findings.push(finding('duplicate-requirement-id', 'high', id, 'a requirement identity must be unique'));
      continue;
    }
    requirementIds.add(id);
  }

  const evidenceKinds = new Map();
  for (const entry of evidence) {
    const id = requireId(entry, 'id', 'every evidence entry');
    const kind = requireId(entry, 'kind', `evidence ${id}`);
    if (evidenceKinds.has(id)) {
      findings.push(finding('duplicate-evidence-id', 'high', id, 'an evidence identity must be unique'));
      continue;
    }
    if (!EVIDENCE_KINDS.includes(kind)) {
      findings.push(finding('unknown-evidence-kind', 'high', id, `kind must be one of ${EVIDENCE_KINDS.join(', ')}`));
    }
    evidenceKinds.set(id, kind);
  }

  const coveredBy = new Map([...requirementIds].map((id) => [id, []]));
  const referencedEvidence = new Set();
  const seenRows = new Set();

  for (const [index, row] of rows.entries()) {
    const requirement = requireId(row, 'requirement', `row ${index + 1}`);
    const linked = requireArray(row, 'evidence');
    const signature = `${requirement}::${[...linked].sort().join(',')}`;
    if (seenRows.has(signature)) {
      findings.push(finding('duplicate-row', 'high', requirement, 'the same requirement and evidence pairing is listed twice'));
      continue;
    }
    seenRows.add(signature);

    if (!requirementIds.has(requirement)) {
      findings.push(finding('unknown-requirement', 'high', requirement, 'the row points at a requirement that is not declared'));
    }
    if (linked.length === 0) {
      findings.push(finding('empty-row', 'high', requirement, 'the row names no proving scenario, procedure, or deterministic check'));
      continue;
    }
    for (const evidenceId of linked) {
      if (typeof evidenceId !== 'string' || evidenceId.trim() === '') {
        throw new TraceabilityError('invalid_input', `row ${index + 1} contains a non-string evidence identity`);
      }
      const id = evidenceId.trim();
      if (!evidenceKinds.has(id)) {
        findings.push(finding('unknown-evidence', 'high', id, `the row for ${requirement} points at undeclared evidence`));
        continue;
      }
      referencedEvidence.add(id);
      coveredBy.get(requirement)?.push(id);
    }
  }

  for (const [id] of evidenceKinds) {
    if (!referencedEvidence.has(id)) {
      findings.push(finding('orphan-evidence', 'high', id, 'the planned proof is not traced to any requirement'));
    }
  }

  const declaredGaps = new Map();
  for (const [index, gap] of gaps.entries()) {
    const requirement = requireId(gap, 'requirement', `gap ${index + 1}`);
    if (!requirementIds.has(requirement)) {
      findings.push(finding('unknown-gap-requirement', 'high', requirement, 'the declared gap points at a requirement that is not declared'));
      continue;
    }
    if (typeof gap.reason !== 'string' || gap.reason.trim() === '') {
      findings.push(finding('gap-without-reason', 'high', requirement, 'a known verification gap must say why no practical proof was designed'));
    }
    declaredGaps.set(requirement, typeof gap.reason === 'string' ? gap.reason.trim() : null);
  }

  const uncovered = [];
  for (const id of [...requirementIds].sort()) {
    const linked = coveredBy.get(id) ?? [];
    if (linked.length === 0) {
      uncovered.push(id);
      if (!declaredGaps.has(id)) {
        findings.push(finding('undeclared-gap', 'high', id, 'the requirement has no proving evidence and no declared verification gap'));
      }
      continue;
    }
    if (declaredGaps.has(id)) {
      findings.push(finding('contradictory-gap', 'high', id, 'the requirement is declared as a verification gap and also traced to evidence'));
    }
  }

  const kindTotals = {};
  for (const kind of EVIDENCE_KINDS) {
    kindTotals[kind] = [...evidenceKinds.values()].filter((value) => value === kind).length;
  }

  const hasIntegrityFinding = findings.some((entry) => INTEGRITY_CODES.has(entry.code));
  const status = hasIntegrityFinding
    ? 'invalid'
    : (uncovered.length || declaredGaps.size ? 'gaps' : 'complete');

  return {
    status,
    coverage: {
      requirements: requirementIds.size,
      covered: requirementIds.size - uncovered.length,
      uncovered,
    },
    evidence: {
      declared: evidenceKinds.size,
      referenced: referencedEvidence.size,
      byKind: kindTotals,
    },
    rows: [...requirementIds].sort().map((id) => ({
      requirement: id,
      evidence: [...new Set(coveredBy.get(id) ?? [])].sort(),
      declaredGap: declaredGaps.has(id) ? declaredGaps.get(id) : null,
    })),
    declaredGaps: [...declaredGaps.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([requirement, reason]) => ({ requirement, reason })),
    findings,
    proof: {
      linkageOnly: true,
      statement: 'a traceability row records intended linkage; it is not evidence that the linked check exists, ran, or passed',
    },
  };
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

export function run(argv, streams = process) {
  if (argv.includes('--probe')) {
    streams.stdout.write('traceability-map: available\n');
    return 0;
  }
  try {
    const result = reconcileTraceability(JSON.parse(readStdin()));
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === 'complete' ? 0 : 2;
  } catch (error) {
    const code = error instanceof TraceabilityError ? error.code : 'invalid_input';
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
