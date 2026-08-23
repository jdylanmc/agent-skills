#!/usr/bin/env node

/**
 * The self-roast remediation ledger.
 *
 * `create-skill` roasts the package it just built. That loop needs a damper,
 * and prose is not one. Three rules in particular are unenforceable as
 * sentences and are therefore mechanical here:
 *
 * 1. A roast is bound to the package head it reviewed. Once a correction moves
 *    the head, that roast is **stale evidence** and every operation that would
 *    act on it is refused until a fresh roast is recorded. Nothing may "carry
 *    over" a finding across a head change.
 * 2. A `Must fix` finding is resolved. It can never be routed to the rubber
 *    duck, and there is no verdict that closes it without a correction. A
 *    `Should fix` or `Consider` finding is the mirror image: it can never be
 *    applied or dismissed without a recorded duck verdict and reasoning.
 * 3. The loop stops. After `ROUNDS_BEFORE_RECONFIRMATION` closed rounds the
 *    ledger enters `awaiting-operator` and **refuses every other event** until
 *    an explicit operator reconfirmation arrives. The stop is a state the
 *    machine is in, not a paragraph asking politely.
 *
 * It fails closed everywhere it could fail open. An unrecognised priority, an
 * unrecognised event type, an unknown argument, and an unknown state field are
 * each an error. The priority vocabulary is owned by the roast contract, not by
 * this file; `roast-round-ledger.drift.test.mjs` derives it from that document
 * and fails the build when the two diverge.
 *
 * It decides nothing about whether a finding is *right*. That judgement belongs
 * to a human, and to the fresh-context rubber duck for the findings a human
 * asked to have weighed. Severity stays a category; this automates the review,
 * never the approval.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class LedgerError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
  }
}

/**
 * The finding priorities the roast contract emits. Hardcoding a vocabulary a
 * Markdown document owns is exactly how the finding checker once reported
 * `Valid` on a report full of violations, so the drift test beside this file
 * derives these from `skills/roast/_atoms/roast-contract/roast-contract.md`.
 */
export const PRIORITIES = ['Must fix', 'Should fix', 'Consider'];

/** Resolved mandatorily. Never eligible for a rubber-duck verdict. */
export const MANDATORY_PRIORITIES = ['Must fix'];

/** Never applied or dismissed without a fresh-context duck verdict. */
export const DUCKED_PRIORITIES = ['Should fix', 'Consider'];

export const VERDICTS = ['apply', 'decline', 'needs-human'];

export const ROUNDS_BEFORE_RECONFIRMATION = 3;

/**
 * Paths whose whole purpose is to constrain this skill's output. Editing one
 * to clear a finding would let the package define the rule it is measured by,
 * which is the failure mode the ledger exists to make impossible.
 */
export const PROTECTED_GATE_PATHS = [
  'scripts/',
  'AGENTS.md',
  'doctrine/',
];

const EVENT_TYPES = [
  'roast-recorded',
  'duck-verdict',
  'finding-resolved',
  'finding-declined',
  'finding-deferred',
  'correction',
  'round-closed',
  'operator-reconfirmation',
];

const STATE_FIELDS = [
  'schema',
  'packagePath',
  'head',
  'roast',
  'round',
  'roundsSinceReconfirmation',
  'gate',
  'dispositions',
  'history',
];

const FINDING_FIELDS = [
  'id',
  'priority',
  'location',
  'evidence',
  'consequence',
  'recommendation',
  'validation',
  'doctrineReferences',
];

function requireText(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new LedgerError(code, message);
  }
  return value.trim();
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

/**
 * True when `candidate` names a repository gate. Compared on normalised
 * forward-slash form so a Windows-shaped path cannot slip past the check.
 */
export function isProtectedGatePath(candidate) {
  const normalised = toPosix(String(candidate)).replace(/^\.\//, '');
  return PROTECTED_GATE_PATHS.some(
    (gate) => (gate.endsWith('/') ? normalised.startsWith(gate) : normalised === gate),
  );
}

/**
 * Refuses a change set that edits a repository gate. A package that cannot
 * satisfy the validator, the deriver, or `AGENTS.md` is the thing to fix.
 */
export function assertGateIntegrity(changedPaths) {
  if (!Array.isArray(changedPaths)) {
    throw new LedgerError('invalid_change_set', 'changed paths must be an array');
  }
  const violations = changedPaths.filter((candidate) => isProtectedGatePath(candidate)).sort();
  if (violations.length) {
    throw new LedgerError(
      'gate_weakened',
      `a remediation may never edit a repository gate: ${violations.join(', ')}`,
    );
  }
  return { status: 'intact', checked: changedPaths.length };
}

export function createLedger({ packagePath, head } = {}) {
  return {
    schema: 1,
    packagePath: requireText(packagePath, 'invalid_package', 'packagePath is required'),
    head: requireText(head, 'invalid_head', 'head is required'),
    roast: null,
    round: 0,
    roundsSinceReconfirmation: 0,
    gate: 'open',
    dispositions: {},
    history: [],
  };
}

function assertState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new LedgerError('invalid_state', 'state must be an object');
  }
  if (state.schema !== 1) {
    throw new LedgerError('invalid_state', `unsupported ledger schema: ${state.schema}`);
  }
  const unknown = Object.keys(state).filter((key) => !STATE_FIELDS.includes(key)).sort();
  if (unknown.length) {
    throw new LedgerError('invalid_state', `unknown ledger field(s): ${unknown.join(', ')}`);
  }
  return state;
}

/**
 * `none` before the first roast, `fresh` while the recorded roast still names
 * the current head, `stale` once a correction moved it.
 */
export function roastStatus(state) {
  assertState(state);
  if (!state.roast) {
    return 'none';
  }
  return state.roast.head === state.head ? 'fresh' : 'stale';
}

function requireFreshRoast(state, action) {
  const status = roastStatus(state);
  if (status === 'none') {
    throw new LedgerError('no_roast', `${action} requires a recorded roast`);
  }
  if (status === 'stale') {
    throw new LedgerError(
      'stale_roast',
      `${action} was refused: the recorded roast reviewed head ${state.roast.head}, the package is now at ${state.head}, so a fresh roast is required`,
    );
  }
}

function disposition(state, findingId) {
  const found = state.dispositions[findingId];
  if (!found) {
    throw new LedgerError('unknown_finding', `no finding named ${findingId} in the current roast`);
  }
  return found;
}

function normaliseFinding(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new LedgerError('invalid_finding', 'every finding must be an object');
  }
  const unknown = Object.keys(raw).filter((key) => !FINDING_FIELDS.includes(key)).sort();
  if (unknown.length) {
    throw new LedgerError('invalid_finding', `unknown finding field(s): ${unknown.join(', ')}`);
  }
  const id = requireText(raw.id, 'invalid_finding', 'a finding requires an id');
  const priority = requireText(raw.priority, 'invalid_finding', `finding ${id} requires a priority`);
  if (!PRIORITIES.includes(priority)) {
    throw new LedgerError(
      'unknown_priority',
      `finding ${id} carries the unrecognised priority "${priority}"; recognised priorities are ${PRIORITIES.join(', ')}`,
    );
  }
  return {
    ...raw,
    id,
    priority,
    recommendation: requireText(
      raw.recommendation,
      'invalid_finding',
      `finding ${id} requires a bounded recommendation`,
    ),
  };
}

export function isMandatory(priority) {
  return MANDATORY_PRIORITIES.includes(priority);
}

export function isDucked(priority) {
  return DUCKED_PRIORITIES.includes(priority);
}

/**
 * Runs the gate check when a correction supplied its change set, and records
 * `not-supplied` when it did not.
 *
 * A caller that omits `changedPaths` is not verified, and the honest report of
 * that is `not-supplied`, surfaced in the account. Returning `intact` for a
 * check that never ran would be a guard that silently matches nothing, which
 * is the one thing worse than having no guard: a reader would trust it.
 */
function checkGate(event) {
  if (!('changedPaths' in event) || event.changedPaths === null) {
    return 'not-supplied';
  }
  assertGateIntegrity(event.changedPaths);
  return 'verified';
}

function record(state, type, detail) {
  state.history.push({ round: state.round, type, ...detail });
}

const HANDLERS = {
  'roast-recorded'(state, event) {
    const head = requireText(event.head, 'invalid_head', 'a roast records the head it reviewed');
    if (head !== state.head) {
      throw new LedgerError(
        'stale_roast',
        `the roast reviewed head ${head} but the package is at ${state.head}; re-roast the current head`,
      );
    }
    if (!Array.isArray(event.findings)) {
      throw new LedgerError('invalid_finding', 'findings must be an array');
    }
    const findings = event.findings.map(normaliseFinding);
    const seen = new Set();
    for (const finding of findings) {
      if (seen.has(finding.id)) {
        throw new LedgerError('invalid_finding', `duplicate finding id: ${finding.id}`);
      }
      seen.add(finding.id);
    }
    state.roast = { head, findings, round: state.round };
    state.dispositions = {};
    for (const finding of findings) {
      state.dispositions[finding.id] = {
        priority: finding.priority,
        route: isMandatory(finding.priority) ? 'mandatory' : 'rubber-duck',
        state: 'open',
        verdict: null,
        verdictReasoning: null,
        note: null,
      };
    }
    record(state, 'roast-recorded', { head, findings: findings.length });
    return { status: 'recorded', findings: findings.length };
  },

  'duck-verdict'(state, event) {
    requireFreshRoast(state, 'recording a rubber-duck verdict');
    const findingId = requireText(event.findingId, 'unknown_finding', 'findingId is required');
    const entry = disposition(state, findingId);
    if (isMandatory(entry.priority)) {
      throw new LedgerError(
        'mandatory_finding_not_duckable',
        `finding ${findingId} is ${entry.priority} and is resolved mandatorily; it is never routed to the rubber duck`,
      );
    }
    const verdict = requireText(event.verdict, 'invalid_verdict', 'a verdict is required');
    if (!VERDICTS.includes(verdict)) {
      throw new LedgerError(
        'invalid_verdict',
        `unrecognised verdict "${verdict}"; recognised verdicts are ${VERDICTS.join(', ')}`,
      );
    }
    entry.verdict = verdict;
    entry.verdictReasoning = requireText(
      event.reasoning,
      'missing_verdict_reasoning',
      `the duck verdict on ${findingId} must carry its reasoning`,
    );
    record(state, 'duck-verdict', { findingId, verdict });
    return { status: 'recorded', findingId, verdict };
  },

  'finding-resolved'(state, event) {
    requireFreshRoast(state, 'resolving a finding');
    const findingId = requireText(event.findingId, 'unknown_finding', 'findingId is required');
    const entry = disposition(state, findingId);
    if (isDucked(entry.priority) && entry.verdict !== 'apply') {
      throw new LedgerError(
        'verdict_required',
        `finding ${findingId} is ${entry.priority}; it is applied only on a rubber-duck verdict of apply, and the recorded verdict is ${entry.verdict ?? 'none'}`,
      );
    }
    const head = requireText(
      event.head,
      'invalid_head',
      `resolving ${findingId} changes the package, so the new head is required`,
    );
    if (head === state.head) {
      throw new LedgerError(
        'head_unchanged',
        `resolving ${findingId} must move the package head; it is still ${head}`,
      );
    }
    const gateCheck = checkGate(event);
    entry.state = 'resolved';
    entry.note = typeof event.note === 'string' ? event.note.trim() : null;
    state.head = head;
    record(state, 'finding-resolved', { findingId, head, gateCheck });
    return { status: 'resolved', findingId, roast: roastStatus(state), gateCheck };
  },

  'finding-declined'(state, event) {
    requireFreshRoast(state, 'declining a finding');
    const findingId = requireText(event.findingId, 'unknown_finding', 'findingId is required');
    const entry = disposition(state, findingId);
    if (isMandatory(entry.priority)) {
      throw new LedgerError(
        'mandatory_finding_not_duckable',
        `finding ${findingId} is ${entry.priority} and cannot be declined; it is resolved mandatorily`,
      );
    }
    if (entry.verdict !== 'decline') {
      throw new LedgerError(
        'verdict_required',
        `finding ${findingId} is declined only on a rubber-duck verdict of decline, and the recorded verdict is ${entry.verdict ?? 'none'}`,
      );
    }
    entry.state = 'declined';
    entry.note = typeof event.note === 'string' ? event.note.trim() : null;
    record(state, 'finding-declined', { findingId });
    return { status: 'declined', findingId, reasoning: entry.verdictReasoning };
  },

  'finding-deferred'(state, event) {
    requireFreshRoast(state, 'deferring a finding');
    const findingId = requireText(event.findingId, 'unknown_finding', 'findingId is required');
    const entry = disposition(state, findingId);
    if (isMandatory(entry.priority)) {
      throw new LedgerError(
        'mandatory_finding_not_duckable',
        `finding ${findingId} is ${entry.priority} and is resolved mandatorily; it is never deferred`,
      );
    }
    if (entry.verdict !== 'needs-human') {
      throw new LedgerError(
        'verdict_required',
        `finding ${findingId} is deferred only on a rubber-duck verdict of needs-human, and the recorded verdict is ${entry.verdict ?? 'none'}`,
      );
    }
    entry.state = 'deferred-to-human';
    entry.note = typeof event.note === 'string' ? event.note.trim() : null;
    record(state, 'finding-deferred', { findingId });
    return { status: 'deferred-to-human', findingId };
  },

  correction(state, event) {
    const head = requireText(event.head, 'invalid_head', 'a correction records the new head');
    if (head === state.head) {
      throw new LedgerError('head_unchanged', 'a correction must move the package head');
    }
    const gateCheck = checkGate(event);
    state.head = head;
    record(state, 'correction', { head, note: event.note ?? null, gateCheck });
    return { status: 'head-moved', head, roast: roastStatus(state), gateCheck };
  },

  'round-closed'(state) {
    if (!state.roast) {
      throw new LedgerError('no_roast', 'a round closes only after a roast was recorded in it');
    }
    state.round += 1;
    state.roundsSinceReconfirmation += 1;
    record(state, 'round-closed', { round: state.round });
    if (state.roundsSinceReconfirmation >= ROUNDS_BEFORE_RECONFIRMATION) {
      state.gate = 'awaiting-operator';
      return { status: 'awaiting-operator', ...stopReport(state) };
    }
    return { status: 'open', round: state.round };
  },

  'operator-reconfirmation'(state, event) {
    if (state.gate !== 'awaiting-operator') {
      throw new LedgerError(
        'no_reconfirmation_pending',
        'no operator reconfirmation is pending; the loop has not reached its stop',
      );
    }
    if (typeof event.confirmed !== 'boolean') {
      throw new LedgerError('invalid_reconfirmation', 'confirmed must be true or false');
    }
    state.gate = event.confirmed ? 'open' : 'halted';
    if (event.confirmed) {
      state.roundsSinceReconfirmation = 0;
    }
    record(state, 'operator-reconfirmation', {
      confirmed: event.confirmed,
      note: event.note ?? null,
    });
    return { status: state.gate, round: state.round };
  },
};

/**
 * Applies one event, mutating `state` in place and returning the outcome.
 *
 * The stop is enforced here, before dispatch, which is what makes it a stop
 * rather than a suggestion: while the gate is `awaiting-operator` the only
 * event that is accepted is the operator's answer.
 */
export function applyEvent(state, event) {
  assertState(state);
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new LedgerError('invalid_event', 'an event must be an object');
  }
  const type = requireText(event.type, 'invalid_event', 'an event requires a type');
  if (!EVENT_TYPES.includes(type)) {
    throw new LedgerError(
      'unknown_event',
      `unrecognised event type "${type}"; recognised types are ${EVENT_TYPES.join(', ')}`,
    );
  }
  if (state.gate === 'halted') {
    throw new LedgerError(
      'halted',
      'the operator declined to continue; this ledger accepts no further events',
    );
  }
  if (state.gate === 'awaiting-operator' && type !== 'operator-reconfirmation') {
    throw new LedgerError(
      'awaiting_operator_reconfirmation',
      `${ROUNDS_BEFORE_RECONFIRMATION} rounds have closed without operator reconfirmation, so "${type}" was refused; present the unresolved findings and the ways forward, then record the operator's answer`,
    );
  }
  return HANDLERS[type](state, event);
}

export function unresolvedFindings(state) {
  assertState(state);
  if (!state.roast) {
    return [];
  }
  return state.roast.findings
    .filter((finding) => {
      const entry = state.dispositions[finding.id];
      return entry.state === 'open' || entry.state === 'deferred-to-human';
    })
    .map((finding) => ({
      id: finding.id,
      priority: finding.priority,
      route: state.dispositions[finding.id].route,
      state: state.dispositions[finding.id].state,
      verdict: state.dispositions[finding.id].verdict,
      verdictReasoning: state.dispositions[finding.id].verdictReasoning,
      recommendation: finding.recommendation,
    }));
}

/**
 * Bounded ways forward for an unresolved package.
 *
 * Non-convergence must never surface as a bare failure. Every stop names at
 * least one route out, and this throws rather than returning an empty list, so
 * a caller cannot report "we could not converge" with nothing attached.
 */
export function waysForward(state) {
  assertState(state);
  const unresolved = unresolvedFindings(state);
  const options = [];

  if (unresolved.length) {
    options.push({
      option: 'further-review-rounds',
      because: `${unresolved.length} finding(s) are still open after ${state.round} round(s)`,
      action:
        'Confirm another bounded set of rounds, resolving the listed findings and re-roasting the moved head after each correction.',
    });
    options.push({
      option: 'simplify-feature',
      because:
        'A finding that survives repeated rounds is often evidence that the feature is carrying more than it needs to.',
      action:
        'Remove or narrow the capability the finding names so the finding no longer applies, then re-roast the reduced package.',
    });
  }

  const deferred = unresolved.filter((finding) => finding.state === 'deferred-to-human');
  if (deferred.length) {
    options.push({
      option: 'operator-decision',
      because: `the rubber duck returned needs-human on ${deferred.length} finding(s)`,
      action:
        'Put those findings to the operator with the duck reasoning attached and record the decision before continuing.',
    });
  }

  if (roastStatus(state) === 'none') {
    options.push({
      option: 'roast-the-package',
      because: 'no roast has been recorded for this package yet',
      action: 'Run /roast on the validated package and record the findings before reporting.',
    });
  }

  if (roastStatus(state) === 'stale') {
    options.push({
      option: 're-roast-current-head',
      because: `the recorded roast reviewed head ${state.roast.head} and the package is now at ${state.head}`,
      action: 'Re-run /roast on the current head before acting on any finding.',
    });
  }

  if (!options.length) {
    throw new LedgerError(
      'no_ways_forward',
      'ways forward were requested for a converged ledger; report the clean result instead',
    );
  }
  return options;
}

export function stopReport(state) {
  assertState(state);
  return {
    round: state.round,
    gate: state.gate,
    roast: roastStatus(state),
    unresolved: unresolvedFindings(state),
    waysForward: waysForward(state),
  };
}

/**
 * Finding identifiers a given disposition event recorded, in order, across
 * every round.
 *
 * A fresh roast replaces the current dispositions, which is correct: a roast of
 * a new head is the only evidence about that head. But the account a reader
 * needs spans the whole run, so a finding fixed in round one must not vanish
 * from the report because round two roasted a package that no longer has it.
 */
function historyIds(state, type) {
  return state.history
    .filter((entry) => entry.type === type)
    .map((entry) => ({ id: entry.findingId, round: entry.round }));
}

/**
 * The account `create-skill` presents: what was found, what was fixed, what was
 * declined with the duck's reasoning, and what remains.
 */
export function ledgerReport(state) {
  assertState(state);
  const findings = state.roast?.findings ?? [];
  const byState = (name) =>
    findings
      .filter((finding) => state.dispositions[finding.id].state === name)
      .map((finding) => ({
        id: finding.id,
        priority: finding.priority,
        recommendation: finding.recommendation,
        verdict: state.dispositions[finding.id].verdict,
        verdictReasoning: state.dispositions[finding.id].verdictReasoning,
        note: state.dispositions[finding.id].note,
      }));

  const unresolved = unresolvedFindings(state);
  const unverifiedCorrections = state.history.filter(
    (entry) => entry.gateCheck === 'not-supplied',
  ).length;
  const converged =
    state.gate === 'open' && roastStatus(state) === 'fresh' && unresolved.length === 0;

  return {
    package: state.packagePath,
    head: state.head,
    round: state.round,
    gate: state.gate,
    roast: roastStatus(state),
    status: converged ? 'clean' : 'unresolved',
    gateChecks: {
      verified: state.history.filter((entry) => entry.gateCheck === 'verified').length,
      unverified: unverifiedCorrections,
    },
    found: findings.map((finding) => ({ id: finding.id, priority: finding.priority })),
    acrossRun: {
      resolved: historyIds(state, 'finding-resolved'),
      declined: historyIds(state, 'finding-declined'),
      deferred: historyIds(state, 'finding-deferred'),
    },
    fixed: byState('resolved'),
    declined: byState('declined'),
    deferred: byState('deferred-to-human'),
    unresolved,
    waysForward: converged ? [] : waysForward(state),
  };
}

const VALUE_FLAGS = ['--state', '--event'];

export const USAGE = `Usage: roast-round-ledger.mjs --state <path> [--event <path>] [--report]

  --state   Absolute path to the ledger state JSON file. Required.
  --event   Absolute path to a JSON event to apply. The event type "create"
            initialises a new ledger from packagePath and head.
  --report  Print the remediation account for the current state.
  --probe   Report availability and exit.`;

function failUsage(message) {
  throw new LedgerError('usage', message);
}

export function parseArguments(argv) {
  const values = {};
  let report = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--probe') {
      return { probe: true };
    }
    if (flag === '--report') {
      report = true;
      continue;
    }
    if (!VALUE_FLAGS.includes(flag)) {
      failUsage(`unknown argument: ${flag}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      failUsage(`${flag} requires a value`);
    }
    const name = flag.slice(2);
    if (name in values) {
      failUsage(`${flag} was given more than once`);
    }
    values[name] = value;
    index += 1;
  }

  if (!('state' in values)) {
    failUsage('missing required argument for --state');
  }
  if (!('event' in values) && !report) {
    failUsage('nothing to do: pass --event, --report, or both');
  }
  return { probe: false, report, ...values };
}

function assertSafePath(candidate, label) {
  if (!path.isAbsolute(candidate)) {
    throw new LedgerError('unsafe_path', `${label} path must be absolute`);
  }
  if (candidate.split(path.sep).includes('..')) {
    throw new LedgerError('unsafe_path', `${label} path must not traverse upward`);
  }
  return candidate;
}

function readJson(candidate, label) {
  assertSafePath(candidate, label);
  let stats;
  try {
    stats = fs.lstatSync(candidate);
  } catch {
    throw new LedgerError('unsafe_path', `${label} does not exist: ${candidate}`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new LedgerError('unsafe_path', `${label} path must be a regular file`);
  }
  try {
    return JSON.parse(fs.readFileSync(candidate, 'utf8'));
  } catch (error) {
    throw new LedgerError('invalid_json', `${label} is not valid JSON: ${error.message}`);
  }
}

export function run(argv, streams = process) {
  let parsed;
  try {
    parsed = parseArguments(argv);
  } catch (error) {
    streams.stderr.write(`${error.code ?? 'usage'}: ${error.message}\n${USAGE}\n`);
    return 1;
  }
  if (parsed.probe) {
    streams.stdout.write('roast-round-ledger: available\n');
    return 0;
  }

  let state = null;
  let outcome = null;
  try {
    assertSafePath(parsed.state, 'state');
    if (parsed.event) {
      const event = readJson(parsed.event, 'event');
      if (event && event.type === 'create') {
        state = createLedger(event);
        outcome = { status: 'created', head: state.head };
      } else {
        state = assertState(readJson(parsed.state, 'state'));
        outcome = applyEvent(state, event);
      }
      fs.writeFileSync(parsed.state, `${JSON.stringify(state, null, 2)}\n`);
    } else {
      state = assertState(readJson(parsed.state, 'state'));
    }
  } catch (error) {
    if (error instanceof LedgerError) {
      streams.stderr.write(`${error.code}: ${error.message}\n`);
      return ['usage', 'unsafe_path', 'invalid_json'].includes(error.code) ? 1 : 2;
    }
    throw error;
  }

  const payload = parsed.report ? { ...outcome, report: ledgerReport(state) } : outcome;
  streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 0;
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
