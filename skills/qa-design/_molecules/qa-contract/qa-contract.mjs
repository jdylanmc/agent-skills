#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Resolve one QA contract's status from the reports its parts produced.
 *
 * The status is computed rather than asserted because the parts can each look
 * finished while the contract is not. A feature file that still carries a
 * scenario with no Then, a procedure missing its pass/fail condition, and a
 * producer proving a requirement the map has never heard of are all invisible
 * to the part that produced them, and a contract that reported `designed`
 * anyway would be a confident wrapper around unfinished work.
 */

export class ContractResolutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ContractResolutionError';
    this.code = code;
  }
}

/** The sections a system-test procedure is not complete without. */
export const PROCEDURE_SECTIONS = [
  'identity',
  'target-surface',
  'prerequisites',
  'required-data',
  'actions',
  'checkpoints',
  'expected-results',
  'cleanup',
  'pass-fail',
];

/**
 * Ordered worst to best. The first status whose condition holds is the
 * contract's status, so an undecidable specification outranks a broken map,
 * which outranks unfinished parts, which outranks a declared gap.
 */
export const CONTRACT_STATUSES = ['underspecified', 'inconsistent', 'unresolved', 'gaps', 'designed'];

const IDENTITY_VALUE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const EXIT_ACCEPTED = 0;
export const EXIT_REFUSED = 1;
export const EXIT_FINDINGS = 2;

export function exitCodeFor(result) {
  return result.findings.length ? EXIT_FINDINGS : EXIT_ACCEPTED;
}

function finding(code, severity, subject, detail) {
  return { code, severity, subject, detail };
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractResolutionError('invalid_input', `${field} must be an object`);
  }
  return value;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new ContractResolutionError('invalid_input', `${field} must be an array`);
  }
  return value;
}

function requireToken(value, field) {
  if (typeof value !== 'string' || !IDENTITY_VALUE.test(value.trim())) {
    throw new ContractResolutionError(
      'invalid_input',
      `${field} must be a stable token matching ${IDENTITY_VALUE.source}`,
    );
  }
  return value.trim();
}

function requireReport(value, field, statuses) {
  const report = requireObject(value, field);
  if (!statuses.includes(report.status)) {
    throw new ContractResolutionError(
      'invalid_input',
      `${field}.status must be one of ${statuses.join(', ')}`,
    );
  }
  if (!Array.isArray(report.findings)) {
    throw new ContractResolutionError('invalid_input', `${field}.findings must be an array`);
  }
  return report;
}

function reviewProcedures(procedures, findings) {
  const resolved = [];
  const seen = new Set();

  for (const [index, procedure] of procedures.entries()) {
    requireObject(procedure, `procedure ${index + 1}`);
    const id = requireToken(procedure.id, `procedure ${index + 1} id`);
    const revision = requireToken(procedure.revision, `procedure ${id} revision`);
    const sections = requireArray(procedure.sections, `procedure ${id} sections`)
      .map((section) => String(section).trim());

    if (seen.has(id)) {
      findings.push(finding('duplicate-procedure-id', 'high', id, 'a procedure identity must be unique'));
      continue;
    }
    seen.add(id);

    const missing = PROCEDURE_SECTIONS.filter((section) => !sections.includes(section));
    if (missing.length) {
      findings.push(finding(
        'incomplete-procedure',
        'high',
        id,
        `the procedure is missing: ${missing.join(', ')}`,
      ));
    }
    resolved.push({ id, revision, missingSections: missing });
  }

  return resolved;
}

export function resolveContract(input = {}) {
  requireObject(input, 'input');
  const contract = requireObject(input.contract, 'contract');
  const identity = {
    id: requireToken(contract.id, 'contract.id'),
    revision: requireToken(contract.revision, 'contract.revision'),
  };

  const rules = requireArray(input.rules, 'rules');
  const procedures = requireArray(input.procedures, 'procedures');
  const traceability = requireReport(input.traceability, 'traceability', ['complete', 'gaps', 'invalid']);
  const constraints = requireReport(input.constraints, 'constraints', ['parallel-safe', 'constrained', 'invalid']);
  const gherkin = input.gherkin === null || input.gherkin === undefined
    ? null
    : requireReport(input.gherkin, 'gherkin', ['clean', 'findings', 'parse-failed']);

  const findings = [];

  for (const [index, rule] of rules.entries()) {
    requireObject(rule, `rule ${index + 1}`);
    requireToken(rule.id, `rule ${index + 1} id`);
    if (typeof rule.decidable !== 'boolean') {
      throw new ContractResolutionError('invalid_input', `rule ${rule.id} must declare decidable as a boolean`);
    }
  }
  const undecidable = rules.filter((rule) => !rule.decidable).map((rule) => rule.id.trim()).sort();

  const unresolvedGherkin = (gherkin?.findings ?? []).filter((entry) => entry.severity === 'high');
  for (const entry of unresolvedGherkin) {
    findings.push(finding(
      'unresolved-gherkin-finding',
      'high',
      entry.location ?? 'gherkin',
      `${entry.code}: ${entry.detail ?? 'unresolved before the contract was assembled'}`,
    ));
  }

  const resolvedProcedures = reviewProcedures(procedures, findings);

  // Cross-checks between the parts. Each one is invisible to the part that
  // produced it, which is why the contract is where they are caught.
  const requirementIds = new Set((traceability.rows ?? []).map((row) => row.requirement));
  const ruleIds = new Set(rules.map((rule) => rule.id.trim()));
  const producers = constraints.producers ?? [];
  const producerIds = new Set(producers.map((producer) => producer.id));

  // The rule set and the map are checked in both directions. One direction
  // alone leaves the other half of the disagreement invisible: a rule nobody
  // traced looks like a complete map, and a row nobody declared looks like a
  // complete rule set.
  for (const id of [...ruleIds].sort()) {
    if (!requirementIds.has(id)) {
      findings.push(finding(
        'rule-outside-map',
        'high',
        id,
        'the rule was designed for and the traceability map never mentions it',
      ));
    }
  }
  for (const id of [...requirementIds].sort()) {
    if (!ruleIds.has(id)) {
      findings.push(finding(
        'requirement-outside-rules',
        'high',
        id,
        'the traceability map traces a requirement the rule set never declared',
      ));
    }
  }

  for (const producer of producers) {
    const strays = (producer.requirementIds ?? []).filter((id) => !requirementIds.has(id)).sort();
    if (strays.length) {
      findings.push(finding(
        'producer-outside-contract',
        'high',
        producer.id,
        `the producer claims requirements the traceability map does not declare: ${strays.join(', ')}`,
      ));
    }
  }

  for (const scenario of gherkin?.scenarios ?? []) {
    if (scenario.identity && !producerIds.has(scenario.identity)) {
      findings.push(finding(
        'scenario-without-producer',
        'high',
        scenario.identity,
        'the scenario declares no execution constraints, so nothing downstream knows what it needs to run',
      ));
    }
  }

  for (const procedure of resolvedProcedures) {
    if (!producerIds.has(procedure.id)) {
      findings.push(finding(
        'procedure-without-producer',
        'high',
        procedure.id,
        'the procedure declares no execution constraints, so nothing downstream knows what it needs to run',
      ));
    }
  }

  const reportIdentities = producers.map((producer) => ({
    producer: producer.id,
    contractId: identity.id,
    contractRevision: identity.revision,
    requirementIds: [...(producer.requirementIds ?? [])].sort(),
    traceabilityIds: [...(producer.traceabilityIds ?? [])].sort(),
  }));

  const inconsistent = traceability.status === 'invalid'
    || constraints.status === 'invalid'
    || gherkin?.status === 'parse-failed'
    || findings.some((entry) => [
      'producer-outside-contract',
      'scenario-without-producer',
      'procedure-without-producer',
      'duplicate-procedure-id',
      'rule-outside-map',
      'requirement-outside-rules',
    ].includes(entry.code));
  const unresolved = unresolvedGherkin.length > 0
    || resolvedProcedures.some((procedure) => procedure.missingSections.length > 0);

  let status;
  if (rules.length === 0 || undecidable.length) {
    status = 'underspecified';
  } else if (inconsistent) {
    status = 'inconsistent';
  } else if (unresolved) {
    status = 'unresolved';
  } else if (traceability.status === 'gaps') {
    status = 'gaps';
  } else {
    status = 'designed';
  }

  return {
    status,
    contract: identity,
    rules: { declared: rules.length, undecidable },
    parts: {
      gherkin: gherkin?.status ?? 'not-applicable',
      procedures: resolvedProcedures,
      traceability: traceability.status,
      constraints: constraints.status,
    },
    reportIdentities,
    findings,
    proof: {
      designedOnly: true,
      statement: 'this contract states how the behavior will be proven; nothing here has been implemented, executed, or judged',
    },
  };
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

export function run(argv, streams = process) {
  if (argv.includes('--probe')) {
    streams.stdout.write('qa-contract: available\n');
    return EXIT_ACCEPTED;
  }
  try {
    const result = resolveContract(JSON.parse(readStdin()));
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return exitCodeFor(result);
  } catch (error) {
    const code = error instanceof ContractResolutionError ? error.code : 'invalid_input';
    streams.stderr.write(`${code}: ${error.message}\n`);
    return EXIT_REFUSED;
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
