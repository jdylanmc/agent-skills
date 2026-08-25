#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Reconcile the execution constraints declared by planned evidence producers.
 *
 * This helper reports which producers may never run at the same time and which
 * must run in a declared order. It deliberately does not build a schedule. A
 * schedule is an execution decision owned by whoever runs the evidence, and
 * emitting one here would let a design artifact quietly acquire orchestration
 * authority.
 *
 * `concurrencySafe` and `isolation` constrain different things and are not
 * interchangeable. `concurrencySafe: false` means the producer runs alone,
 * whatever else is going on. `isolation: exclusive` means it needs its own
 * environment, and says nothing about work happening elsewhere.
 */

export class ExecutionConstraintError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExecutionConstraintError';
    this.code = code;
  }
}

export const PRODUCER_KINDS = ['deterministic-check', 'gherkin-scenario', 'system-procedure'];
export const ISOLATION_MODES = ['shared', 'isolated', 'exclusive'];

/**
 * Uniform across every helper in this package: 0 when the input was accepted
 * with nothing to resolve, 2 when it was accepted and raised findings, 1 when
 * it was refused. The code reports findings, not disposition; a constrained but
 * correct declaration set exits 0 and says `constrained` in `status`.
 */
export const EXIT_ACCEPTED = 0;
export const EXIT_REFUSED = 1;
export const EXIT_FINDINGS = 2;

export function exitCodeFor(result) {
  return result.findings.length ? EXIT_FINDINGS : EXIT_ACCEPTED;
}

/**
 * Every field is required, including the empty-list cases. An absent
 * `mutableResources` and an explicitly empty one mean different things: the
 * first is an omission, and defaulting it to "conflicts with nothing" is how a
 * state-conflicting procedure gets scheduled in parallel later.
 */
const REQUIRED_FIELDS = [
  'id',
  'kind',
  'requirementIds',
  'traceabilityIds',
  'environment',
  'accounts',
  'data',
  'mutableResources',
  'isolation',
  'expectedDurationMinutes',
  'concurrencySafe',
  'runAfter',
];

const LIST_FIELDS = ['requirementIds', 'traceabilityIds', 'accounts', 'data', 'mutableResources', 'runAfter'];

function finding(code, severity, subject, detail) {
  return { code, severity, subject, detail };
}

function isStringList(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.trim() !== '');
}

function missingFieldsOf(producer) {
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    const value = producer[field];
    if (value === undefined || value === null) {
      missing.push(field);
      continue;
    }
    if (LIST_FIELDS.includes(field) && !isStringList(value)) {
      missing.push(field);
      continue;
    }
    if (field === 'expectedDurationMinutes' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) {
      missing.push(field);
      continue;
    }
    if (field === 'concurrencySafe' && typeof value !== 'boolean') {
      missing.push(field);
      continue;
    }
    if (['id', 'kind', 'environment', 'isolation'].includes(field) && (typeof value !== 'string' || value.trim() === '')) {
      missing.push(field);
    }
  }
  return missing;
}

function sharedEntries(left, right) {
  const rightSet = new Set(right);
  return left.filter((entry) => rightSet.has(entry)).sort();
}

function conflictReasons(a, b) {
  const reasons = [];
  if (!a.concurrencySafe) {
    reasons.push(`declared-not-concurrency-safe:${a.id}`);
  }
  if (!b.concurrencySafe) {
    reasons.push(`declared-not-concurrency-safe:${b.id}`);
  }
  if (a.environment === b.environment) {
    if (a.isolation === 'exclusive') {
      reasons.push(`exclusive-environment:${a.id}`);
    }
    if (b.isolation === 'exclusive') {
      reasons.push(`exclusive-environment:${b.id}`);
    }
  }
  for (const resource of sharedEntries(a.mutableResources, b.mutableResources)) {
    reasons.push(`shared-mutable-resource:${resource}`);
  }
  for (const account of sharedEntries(a.accounts, b.accounts)) {
    reasons.push(`shared-account:${account}`);
  }
  for (const fixture of sharedEntries(a.data, b.data)) {
    reasons.push(`shared-data:${fixture}`);
  }
  return [...new Set(reasons)].sort();
}

function detectOrderingCycle(producers) {
  // A self-edge already has its own finding, and an unknown target already has
  // one too. Reporting them again as cycles would name one defect twice.
  const edges = new Map(producers.map((producer) => [
    producer.id,
    producer.runAfter.filter((id) => id !== producer.id && producers.some((entry) => entry.id === id)),
  ]));
  const state = new Map();
  const cycles = [];

  const visit = (id, trail) => {
    const mark = state.get(id);
    if (mark === 'done') {
      return;
    }
    if (mark === 'visiting') {
      cycles.push([...trail.slice(trail.indexOf(id)), id].join(' -> '));
      return;
    }
    state.set(id, 'visiting');
    for (const next of edges.get(id) ?? []) {
      visit(next, [...trail, id]);
    }
    state.set(id, 'done');
  };

  for (const producer of producers) {
    visit(producer.id, []);
  }
  return [...new Set(cycles)].sort();
}

export function reconcileExecutionConstraints(input = {}) {
  const producers = input.producers;
  if (!Array.isArray(producers)) {
    throw new ExecutionConstraintError('invalid_input', 'producers must be an array');
  }
  if (producers.length === 0) {
    throw new ExecutionConstraintError('invalid_input', 'declare at least one evidence producer');
  }

  const findings = [];
  const complete = [];
  const seenIds = new Set();

  for (const [index, producer] of producers.entries()) {
    if (!producer || typeof producer !== 'object' || Array.isArray(producer)) {
      throw new ExecutionConstraintError('invalid_input', `producer ${index + 1} must be an object`);
    }
    const missing = missingFieldsOf(producer);
    const subject = typeof producer.id === 'string' && producer.id.trim() ? producer.id.trim() : `producer ${index + 1}`;
    if (missing.length) {
      findings.push(finding('incomplete-declaration', 'high', subject, `missing or malformed: ${missing.join(', ')}`));
      continue;
    }

    const id = producer.id.trim();
    if (seenIds.has(id)) {
      findings.push(finding('duplicate-producer-id', 'high', id, 'an evidence producer identity must be unique'));
      continue;
    }
    seenIds.add(id);

    if (!PRODUCER_KINDS.includes(producer.kind)) {
      findings.push(finding('unknown-producer-kind', 'high', id, `kind must be one of ${PRODUCER_KINDS.join(', ')}`));
    }
    if (!ISOLATION_MODES.includes(producer.isolation)) {
      findings.push(finding('unknown-isolation-mode', 'high', id, `isolation must be one of ${ISOLATION_MODES.join(', ')}`));
    }
    if (producer.requirementIds.length === 0) {
      findings.push(finding('missing-report-identity', 'high', id, 'declare the requirement identities the later report must carry'));
    }
    if (producer.traceabilityIds.length === 0) {
      findings.push(finding('missing-report-identity', 'high', id, 'declare the traceability identities the later report must carry'));
    }
    if (producer.runAfter.includes(id)) {
      findings.push(finding('self-ordering-dependency', 'high', id, 'a producer cannot run after itself'));
    }

    complete.push({
      id,
      kind: producer.kind,
      environment: producer.environment.trim(),
      isolation: producer.isolation,
      concurrencySafe: producer.concurrencySafe,
      expectedDurationMinutes: producer.expectedDurationMinutes,
      requirementIds: [...producer.requirementIds].sort(),
      traceabilityIds: [...producer.traceabilityIds].sort(),
      accounts: [...producer.accounts].sort(),
      data: [...producer.data].sort(),
      mutableResources: [...producer.mutableResources].sort(),
      runAfter: [...producer.runAfter].sort(),
    });
  }

  const knownIds = new Set(complete.map((producer) => producer.id));
  const orderingEdges = [];
  for (const producer of complete) {
    for (const dependency of producer.runAfter) {
      if (dependency === producer.id) {
        continue;
      }
      if (!knownIds.has(dependency)) {
        findings.push(finding('unknown-ordering-dependency', 'high', producer.id, `runAfter names an undeclared producer: ${dependency}`));
        continue;
      }
      orderingEdges.push({ producer: producer.id, runsAfter: dependency });
    }
  }

  for (const cycle of detectOrderingCycle(complete)) {
    findings.push(finding('ordering-cycle', 'high', cycle, 'the declared ordering cannot be satisfied'));
  }

  const mustNotRunConcurrently = [];
  for (let i = 0; i < complete.length; i += 1) {
    for (let j = i + 1; j < complete.length; j += 1) {
      const reasons = conflictReasons(complete[i], complete[j]);
      if (!reasons.length) {
        continue;
      }
      const pair = [complete[i].id, complete[j].id].sort();
      mustNotRunConcurrently.push({ producers: pair, reasons });
      if (complete[i].concurrencySafe && complete[j].concurrencySafe) {
        findings.push(finding(
          'undeclared-conflict',
          'high',
          pair.join(' + '),
          `both are declared concurrency safe but share state: ${reasons.join(', ')}`,
        ));
      }
    }
  }
  mustNotRunConcurrently.sort((a, b) => a.producers.join().localeCompare(b.producers.join()));

  const serialOnly = complete.filter((producer) => !producer.concurrencySafe).map((producer) => producer.id).sort();

  const hasBlockingFinding = findings.some((entry) => entry.severity === 'high');
  // A producer that declared itself serial constrains the run even when it is
  // the only producer and therefore has no pair to conflict with. Reporting
  // `parallel-safe` there would answer a question nobody asked and lose the one
  // declaration that mattered.
  const constrained = mustNotRunConcurrently.length > 0
    || orderingEdges.length > 0
    || serialOnly.length > 0;
  const status = hasBlockingFinding ? 'invalid' : (constrained ? 'constrained' : 'parallel-safe');

  return {
    status,
    producers: complete,
    exclusiveAccess: complete.filter((producer) => producer.isolation === 'exclusive').map((producer) => producer.id).sort(),
    serialOnly,
    mustNotRunConcurrently,
    orderingEdges: orderingEdges.sort((a, b) => `${a.producer}${a.runsAfter}`.localeCompare(`${b.producer}${b.runsAfter}`)),
    findings,
    scheduling: {
      schedule: null,
      statement: 'these are constraints for whoever executes the evidence; this capability does not schedule, parallelize, or run anything',
    },
  };
}

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

export function run(argv, streams = process) {
  if (argv.includes('--probe')) {
    streams.stdout.write('execution-constraints: available\n');
    return 0;
  }
  try {
    const result = reconcileExecutionConstraints(JSON.parse(readStdin()));
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return exitCodeFor(result);
  } catch (error) {
    const code = error instanceof ExecutionConstraintError ? error.code : 'invalid_input';
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
