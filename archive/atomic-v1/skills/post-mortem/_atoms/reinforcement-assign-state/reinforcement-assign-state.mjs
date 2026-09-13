#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The lifecycle gate, made decidable.
 *
 * Whether a candidate may advance past `PROPOSED` is the one judgement in this
 * skill most likely to drift under pressure, because advancing it always looks
 * defensible in the moment: the pattern really did appear twice, the operator
 * really did select two logs. So the rule is arithmetic rather than prose.
 *
 * Recurrence is measured over **evidence bundles**. A bundle is one selected
 * Skill Run Log paired with the native session evidence for the session that
 * run itself names, and it counts only when that pair agrees. Two bundles are
 * independent when they are different runs in different sessions. Anything
 * short of that stays `PROPOSED` with the reason recorded.
 *
 * The alternative - correlating every selected run against the session being
 * analyzed - asks each of them the wrong question, since an earlier run belongs
 * to an earlier session and can only answer `different-session`.
 */

export const LIFECYCLE_STATES = ['PROPOSED', 'OBSERVED'];

/** States this skill may never assign, whatever the evidence looks like. */
export const FORBIDDEN_STATES = ['VALIDATED', 'PROMOTED'];

/** The only correlation verdict that makes a selected run usable as evidence. */
export const USABLE_CORRELATION = 'same-session';

function identityOf(bundle) {
  // A bundle carries its verdict and its two identities; a bare run object with
  // the same fields is accepted so a caller can assemble one by hand.
  const runLog = bundle?.run_log ?? bundle ?? {};
  const evidence = bundle?.session_evidence ?? null;
  const runId = typeof runLog.run_id === 'string' && runLog.run_id.trim() !== '' ? runLog.run_id : null;
  const claimed = typeof runLog.session_id === 'string' && runLog.session_id.trim() !== ''
    ? runLog.session_id
    : null;
  const native = typeof evidence?.session_id === 'string' && evidence.session_id.trim() !== ''
    ? evidence.session_id
    : claimed;
  return {
    runId,
    sessionId: native,
    correlation: typeof bundle?.correlation === 'string' ? bundle.correlation : 'unknown',
  };
}

/**
 * Decides whether a set of operator-selected runs establishes recurrence.
 * Returns the decision and the reason, because "no" is the common answer and a
 * reader is owed the grounds for it.
 */
export function assessRecurrence(bundles = []) {
  if (!Array.isArray(bundles)) {
    return { recurrence: false, independent_runs: 0, reason: 'no runs were selected' };
  }
  const selected = bundles.map(identityOf);

  if (selected.length === 0) {
    return {
      recurrence: false,
      independent_runs: 0,
      reason: 'no run log was selected, so only the current session supports the candidate',
    };
  }
  if (selected.length === 1) {
    return {
      recurrence: false,
      independent_runs: 1,
      reason: 'one run cannot corroborate itself; repetition inside a run is not recurrence',
    };
  }

  // A run is evidence only when it was positively correlated with the session
  // evidence it claims. `unknown` is the common case for an uncorrelated log,
  // and treating it as corroboration is exactly how a recurrence claim gets
  // made from two logs that might be the same run seen twice.
  const usable = selected.filter(
    (run) => run.runId !== null && run.correlation === USABLE_CORRELATION,
  );
  if (usable.length < 2) {
    return {
      recurrence: false,
      independent_runs: usable.length,
      reason: 'fewer than two selected bundles held together: a run and the session it names must agree',
    };
  }

  const distinctRuns = new Set(usable.map((run) => run.runId));
  if (distinctRuns.size < 2) {
    return {
      recurrence: false,
      independent_runs: distinctRuns.size,
      reason: 'the selected logs record the same run, which is one attempt seen twice',
    };
  }

  const sessions = usable.map((run) => run.sessionId);
  if (sessions.some((sessionId) => sessionId === null)) {
    return {
      recurrence: false,
      independent_runs: distinctRuns.size,
      reason: 'a selected bundle names no session, so independence cannot be established',
    };
  }
  if (new Set(sessions).size < 2) {
    return {
      recurrence: false,
      independent_runs: distinctRuns.size,
      reason: 'the selected runs happened in one session, which is two attempts at the same work',
    };
  }

  return {
    recurrence: true,
    independent_runs: distinctRuns.size,
    reason: 'the pattern appears in runs that are independent of each other',
  };
}

/**
 * Assigns the lifecycle state a candidate is entitled to. `VALIDATED` and
 * `PROMOTED` are unreachable from here by construction: there is no input that
 * produces them, because producing them requires evidence this skill cannot
 * gather and an approval it cannot give.
 */
export function assignLifecycleState({ recurrence = null } = {}) {
  const decided = recurrence ?? { recurrence: false, reason: 'no recurrence assessment was supplied' };
  const state = decided.recurrence === true ? 'OBSERVED' : 'PROPOSED';
  return {
    status: state,
    reason: decided.reason,
    ready_for_promotion: false,
    validation_requirements: {
      independent_evidence_required: state === 'OBSERVED'
        ? 'a trial that measures the proposed behavior against its evaluator'
        : 'the same pattern in an independent later run',
      human_approval_required: true,
    },
  };
}

/**
 * The gate a rendered lifecycle record must pass. It exists so a record cannot
 * acquire a state this skill may not assign by being edited after the decision
 * was made - the assertion is on the artifact, not on the code path that
 * produced it.
 */
export function assertLifecycleRecord(record) {
  const problems = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return ['a lifecycle record must be an object'];
  }
  if (!LIFECYCLE_STATES.includes(record.status)) {
    problems.push(
      FORBIDDEN_STATES.includes(record.status)
        ? `${record.status} is not a state this skill may assign`
        : `status must be one of ${LIFECYCLE_STATES.join(', ')}`,
    );
  }
  if (record.ready_for_promotion !== false) {
    problems.push('ready_for_promotion must be false');
  }
  if (record.validation_requirements?.human_approval_required !== true) {
    problems.push('human_approval_required must be true');
  }
  return problems;
}

function main(argv) {
  if (argv.includes('--probe')) {
    console.log('reinforcement-assign-state: available');
    return 0;
  }
  const index = argv.indexOf('--runs');
  if (index === -1 || argv[index + 1] === undefined) {
    console.error(JSON.stringify({ error: { code: 'usage', message: '--runs requires JSON' } }));
    return 1;
  }
  let runs;
  try {
    runs = JSON.parse(argv[index + 1]);
  } catch (error) {
    console.error(JSON.stringify({ error: { code: 'usage', message: error.message } }));
    return 1;
  }
  const recurrence = assessRecurrence(runs);
  console.log(JSON.stringify({ recurrence, lifecycle: assignLifecycleState({ recurrence }) }, null, 2));
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
  process.exitCode = main(process.argv.slice(2));
}
