#!/usr/bin/env node

/**
 * The remediation gate for `reinforce-skill`.
 *
 * Issue 47 asks that a reinforcement resolve roast findings "under the same
 * rules `create-skill` uses". In this repository those rules are not a
 * paragraph — they are a state machine that refuses. So this file reuses that
 * machine rather than restating it:
 * `create-skill/_atoms/roast-round-ledger/roast-round-ledger.mjs` owns the
 * head-binding that makes a superseded roast stale evidence, the routing that
 * keeps a `Must fix` finding out of the rubber duck's reach, and the
 * three-round stop that is a state the ledger is in rather than a request to
 * pause. Unit composition runs strictly downward and never crosses between
 * skills; a code dependency between unit scripts is a separate graph, and
 * duplicating the machine here would let the two copies drift until a
 * reinforcement was held to a weaker bar than a creation.
 *
 * What is genuinely different is the change set. `create-skill` writes a new
 * package into empty space, so its gate check asks only whether a correction
 * edited a repository gate. A reinforcement mutates a working package that sits
 * beside nineteen others, so a correction made to silence a finding could
 * plausibly reach for a *neighbour* — another skill's `SKILL.md`, a shared
 * `_base` unit, the intent of a skill nobody asked about. `assertGateIntegrity`
 * permits all three. This file closes that gap by layering the reinforcement
 * write boundary from `reinforcement-target.mjs` over it, so the question a
 * remediation change set must answer is both "did it weaken a gate?" and "did
 * it stay inside the one skill being reinforced?".
 *
 * Nothing here decides whether a finding is *right*. That judgement belongs to
 * a human, and to the fresh-context rubber duck for the findings a human asked
 * to have weighed. This automates the review, never the approval.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LedgerError,
  ROUNDS_BEFORE_RECONFIRMATION,
  assertGateIntegrity,
  applyEvent as sharedApplyEvent,
  createLedger,
  ledgerReport as sharedLedgerReport,
  stopReport as sharedStopReport,
  roastStatus,
  unresolvedFindings,
} from '../../../create-skill/_atoms/roast-round-ledger/roast-round-ledger.mjs';
import { auditDiff, auditRepositoryDiff, readAuditSnapshot } from '../reinforcement-target/reinforcement-target.mjs';

/**
 * The one validated implementation, re-exported so a reinforcement drives the
 * same machine a creation does. Re-exporting rather than re-implementing is
 * what makes "the same rules" a fact instead of a claim.
 */
export {
  DUCKED_PRIORITIES,
  LedgerError,
  MANDATORY_PRIORITIES,
  PRIORITIES,
  PROTECTED_GATE_PATHS,
  ROUNDS_BEFORE_RECONFIRMATION,
  VERDICTS,
  assertGateIntegrity,
  createLedger,
  isDucked,
  isMandatory,
  isProtectedGatePath,
  roastStatus,
  unresolvedFindings,
  waysForward,
} from '../../../create-skill/_atoms/roast-round-ledger/roast-round-ledger.mjs';

function cleanPause(state, error) {
  return error instanceof LedgerError && error.code === 'no_ways_forward'
    && error.message === 'ways forward were requested for a converged ledger; report the clean result instead'
    && state.roundsSinceReconfirmation === ROUNDS_BEFORE_RECONFIRMATION
    && roastStatus(state) === 'fresh' && unresolvedFindings(state).length === 0;
}

function pauseReport(state) {
  return {
    status: state.gate === 'halted' ? 'halted' : 'needs-confirmation',
    head: state.head, round: state.round, gate: state.gate,
    roast: roastStatus(state), unresolved: [],
    waysForward: state.gate === 'halted' ? [] : [{
      option: 'operator-reconfirmation',
      action: 'Zero unresolved findings. Ask the operator whether to continue; no automatic confirmation.',
    }],
    checkpoint: structuredClone(state),
    presentationRecovery: 'no_ways_forward',
  };
}

export function applyEvent(state, event) {
  const before = { gate: state?.gate, round: state?.round,
    rounds: state?.roundsSinceReconfirmation, history: state?.history?.length };
  try {
    return sharedApplyEvent(state, event);
  } catch (error) {
    if (event?.type !== 'round-closed' || before.gate !== 'open'
      || before.rounds !== ROUNDS_BEFORE_RECONFIRMATION - 1
      || state.gate !== 'awaiting-operator' || state.round !== before.round + 1
      || state.history.length !== before.history + 1
      || state.history.at(-1)?.type !== 'round-closed'
      || !cleanPause(state, error)) throw error;
    return pauseReport(state);
  }
}

export function stopReport(state) {
  try {
    return sharedStopReport(state);
  } catch (error) {
    if (state?.gate !== 'awaiting-operator' || !cleanPause(state, error)) throw error;
    return pauseReport(state);
  }
}

export function ledgerReport(state) {
  try {
    return sharedLedgerReport(state);
  } catch (error) {
    const last = state?.history?.at(-1);
    const paused = state?.gate === 'awaiting-operator' && last?.type === 'round-closed';
    const refused = state?.gate === 'halted' && last?.type === 'operator-reconfirmation'
      && last.confirmed === false;
    if ((!paused && !refused) || !cleanPause(state, error)) throw error;
    return pauseReport(state);
  }
}

/**
 * Refuse a remediation change set that weakens a repository gate **or** leaves
 * the skill being reinforced.
 *
 * Both halves are load-bearing and neither implies the other. A change set that
 * edits `skills/some-other-skill/SKILL.md` weakens no gate and passes
 * `assertGateIntegrity` cleanly; a change set that edits `scripts/` is inside
 * no skill at all and would be classified merely `outside`. Reported together,
 * with every refused path named, so a reviewer reads what was refused rather
 * than a bare verdict.
 */
export function assertReinforcementChangeSet(repositoryRoot, skillName, changedPaths, options = {}) {
  if (!Array.isArray(changedPaths)) {
    throw new LedgerError('invalid_change_set', 'changed paths must be an array');
  }

  // Gate integrity first: editing the rule you are measured by is the failure
  // mode with the worst blast radius, so it is named first when both apply.
  assertGateIntegrity(changedPaths);

  // The workflow before/after content is threaded straight through: when the
  // change set touches the shared workflow, `auditDiff` refuses it unless the
  // edit is proven a bare test registration, and refuses an unproven one whose
  // content was not supplied. So a workflow path here fails closed, exactly as
  // an out-of-target path does.
  const audit = auditDiff(repositoryRoot, skillName, changedPaths, options);
  return assertCleanAudit(audit, skillName);
}

function assertCleanAudit(audit, skillName) {
  if (!audit.clean) {
    const refusedPaths = audit.refused
      .map((entry) => `${entry.path} (${entry.writeClass})`)
      .sort();
    if (audit.workflowViolation) {
      refusedPaths.push(`${audit.workflowViolation.path} (${audit.workflowViolation.message})`);
    }
    if (audit.snapshotViolation) refusedPaths.push(audit.snapshotViolation);
    throw new LedgerError(
      'out_of_target',
      `a reinforcement remediation stays inside skills/${skillName}, proven test registrations and justified companions; refused: ${refusedPaths.join(', ')}`,
    );
  }

  return {
    status: 'intact',
    checked: audit.classified.length,
    workflow: audit.workflow.map((entry) => entry.path),
    companions: audit.companions,
  };
}

/**
 * May this reinforcement be reported complete?
 *
 * Fails closed on every route a `reinforced` status could be claimed without
 * the review having happened: no roast at all, a roast of a superseded head,
 * findings still open, and the operator's pause still outstanding. A roast that
 * did not happen is reported as one that did not happen.
 */
export function assertRoastComplete(state) {
  const problems = [];
  const status = roastStatus(state);

  if (status === 'none') {
    problems.push('no roast was recorded; a reinforcement is not complete without one');
  }
  if (status === 'stale') {
    problems.push(
      `the recorded roast reviewed head ${state.roast.head} but the package is at ${state.head}; re-roast the current head`,
    );
  }
  if (state.gate === 'awaiting-operator') {
    problems.push(
      `${ROUNDS_BEFORE_RECONFIRMATION} rounds closed without operator reconfirmation; the loop stops for the operator`,
    );
  }
  if (state.gate === 'halted') {
    problems.push('the operator declined to continue; this reinforcement is halted, not complete');
  }

  const unresolved = status === 'none' ? [] : unresolvedFindings(state);
  for (const finding of unresolved) {
    problems.push(
      `finding ${finding.id} (${finding.priority}) is ${finding.state} and has no recorded address`,
    );
  }

  return {
    remediation: problems.length ? 'blocked' : 'clean',
    roast: status,
    gate: state.gate,
    unresolved,
    problems,
  };
}

export const USAGE = `Usage: reinforce-roast.mjs --root <path> --skill <name> --changed <a,b,c>
       reinforce-roast.mjs --state <absolute-json> [--event <absolute-json>] [--report]
       reinforce-roast.mjs --root <path> --skill <name> --base <commit>
         --snapshot <json> --snapshot-digest <sha256> [--companions <json>]

  --root                Repository root the reinforcement runs against.
  --state               Persisted shared remediation ledger, outside published files.
  --event               One shared ledger event (or create); persisted before reporting.
  --report              Report the actual checkpoint, including a clean operator pause.
  --skill               The one skill being reinforced.
  --changed             Comma-separated change set to audit.
  --base                Enumerate the whole candidate against this baseline commit.
  --companions          Exact companion ledger; requires --base.
  --snapshot            Recorded immutable candidate and baseline evidence.
  --snapshot-digest     Snapshot digest pinned in the caller's run context.
  --workflow-previous   Path to the validation workflow before the edit.
  --workflow-next       Path to the validation workflow after the edit.
  --probe               Report availability and exit.`;

export function parseArguments(argv) {
  const args = {};
  const valueFlags = ['--root', '--skill', '--changed', '--base', '--companions',
    '--snapshot', '--snapshot-digest', '--workflow-previous', '--workflow-next', '--state', '--event'];
  const claim = (key, token) => {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      throw new LedgerError('usage', `${token} was given more than once\n${USAGE}`);
    }
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--probe' || token === '--report') {
      claim(token.slice(2), token);
      args[token.slice(2)] = true;
      continue;
    }
    if (!valueFlags.includes(token)) {
      throw new LedgerError('usage', `unknown argument: ${token}\n${USAGE}`);
    }
    claim(token.slice(2), token);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new LedgerError('usage', `${token} requires a value\n${USAGE}`);
    }
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

export function run(argv, streams = process) {
  const args = parseArguments(argv);
  if (args.probe) {
    streams.stdout.write('reinforce-roast: available\n');
    return 0;
  }
  if (args.state || args.event || args.report) {
    if (!args.state || (!args.event && !args.report)
      || Object.keys(args).some((key) => !['state', 'event', 'report'].includes(key))) {
      throw new LedgerError('usage', 'ledger mode requires --state and --event or --report; audit flags cannot be mixed');
    }
    const read = (file) => {
      if (!path.isAbsolute(file) || fs.lstatSync(file).isSymbolicLink() || !fs.statSync(file).isFile()) {
        throw new LedgerError('unsafe_path', 'ledger and event paths must be absolute regular files');
      }
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    };
    const event = args.event ? read(args.event) : null;
    let state;
    let outcome;
    if (event?.type === 'create') {
      if (!path.isAbsolute(args.state) || fs.existsSync(args.state)) {
        throw new LedgerError('unsafe_path', 'a new ledger requires a new absolute state path');
      }
      state = createLedger(event);
      outcome = { status: 'created', head: state.head };
    } else {
      state = read(args.state);
      outcome = event ? applyEvent(state, event) : null;
    }
    if (event) fs.writeFileSync(args.state, `${JSON.stringify(state, null, 2)}\n`,
      { flag: event.type === 'create' ? 'wx' : 'w' });
    const payload = args.report ? { ...outcome, report: ledgerReport(state) } : outcome;
    streams.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }
  if ((args.companions || args.snapshot || args['snapshot-digest']) && !args.base) {
    throw new LedgerError('usage', 'companions and snapshots require --base');
  }
  if (args.base) {
    if (!args.root || !args.skill || args.changed || args['workflow-previous'] || args['workflow-next']
      || !args.snapshot || !args['snapshot-digest']) {
      throw new LedgerError('usage', '--base requires a pinned snapshot and refuses path/content overrides');
    }
    const companions = args.companions ? JSON.parse(fs.readFileSync(args.companions, 'utf8')) : [];
    const snapshot = readAuditSnapshot(args.root, args.snapshot, args['snapshot-digest']);
    const audit = auditRepositoryDiff(args.root, args.skill, args.base,
      { companions, snapshot, snapshotDigest: args['snapshot-digest'] });
    assertGateIntegrity(audit.classified.map((entry) => entry.path));
    streams.stdout.write(`${JSON.stringify(assertCleanAudit(audit, args.skill), null, 2)}\n`);
    return 0;
  }
  if (!args.root || !args.skill || !args.changed) {
    throw new LedgerError('usage', `--root, --skill, and --changed are required\n${USAGE}`);
  }
  const changed = args.changed.split(',').map((entry) => entry.trim()).filter(Boolean);
  const hasPrevious = args['workflow-previous'] !== undefined;
  const hasNext = args['workflow-next'] !== undefined;
  if (hasPrevious !== hasNext) {
    throw new LedgerError(
      'usage',
      `--workflow-previous and --workflow-next are supplied together or not at all\n${USAGE}`,
    );
  }
  const workflow = hasPrevious
    ? {
      previous: fs.readFileSync(args['workflow-previous'], 'utf8'),
      next: fs.readFileSync(args['workflow-next'], 'utf8'),
    }
    : undefined;
  streams.stdout.write(
    `${JSON.stringify(assertReinforcementChangeSet(args.root, args.skill, changed, { workflow }), null, 2)}\n`,
  );
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
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.code ?? 'usage', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
