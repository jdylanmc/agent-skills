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
import { fileURLToPath } from 'node:url';

import {
  LedgerError,
  ROUNDS_BEFORE_RECONFIRMATION,
  assertGateIntegrity,
  roastStatus,
  unresolvedFindings,
} from '../../../create-skill/_atoms/roast-round-ledger/roast-round-ledger.mjs';
import { auditDiff } from '../reinforcement-target/reinforcement-target.mjs';

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
  applyEvent,
  assertGateIntegrity,
  createLedger,
  isDucked,
  isMandatory,
  isProtectedGatePath,
  ledgerReport,
  roastStatus,
  stopReport,
  unresolvedFindings,
  waysForward,
} from '../../../create-skill/_atoms/roast-round-ledger/roast-round-ledger.mjs';

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
export function assertReinforcementChangeSet(repositoryRoot, skillName, changedPaths) {
  if (!Array.isArray(changedPaths)) {
    throw new LedgerError('invalid_change_set', 'changed paths must be an array');
  }

  // Gate integrity first: editing the rule you are measured by is the failure
  // mode with the worst blast radius, so it is named first when both apply.
  assertGateIntegrity(changedPaths);

  const audit = auditDiff(repositoryRoot, skillName, changedPaths);
  if (!audit.clean) {
    throw new LedgerError(
      'out_of_target',
      `a reinforcement remediation stays inside skills/${skillName}; refused: ${audit.refused
        .map((entry) => `${entry.path} (${entry.writeClass})`)
        .sort()
        .join(', ')}`,
    );
  }

  return {
    status: 'intact',
    checked: changedPaths.length,
    workflow: audit.workflow.map((entry) => entry.path),
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

  --root     Repository root the reinforcement runs against.
  --skill    The one skill being reinforced.
  --changed  Comma-separated change set to audit.
  --probe    Report availability and exit.`;

export function parseArguments(argv) {
  const args = {};
  const valueFlags = ['--root', '--skill', '--changed'];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--probe') {
      args.probe = true;
      continue;
    }
    if (!valueFlags.includes(token)) {
      throw new LedgerError('usage', `unknown argument: ${token}\n${USAGE}`);
    }
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
  if (!args.root || !args.skill || !args.changed) {
    throw new LedgerError('usage', `--root, --skill, and --changed are required\n${USAGE}`);
  }
  const changed = args.changed.split(',').map((entry) => entry.trim()).filter(Boolean);
  streams.stdout.write(
    `${JSON.stringify(assertReinforcementChangeSet(args.root, args.skill, changed), null, 2)}\n`,
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
