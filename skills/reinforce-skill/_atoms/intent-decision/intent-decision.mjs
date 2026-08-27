#!/usr/bin/env node

/**
 * The intent-revision gate for `reinforce-skill`.
 *
 * One question must never be skipped: does this change what the skill is *for*?
 * Written into a workflow that is a request the caller remember. Here it is a
 * state machine that refuses.
 *
 * Three rules are unenforceable as sentences and are therefore mechanical:
 *
 * 1. **The decision has no default.** A run reaches the implementation only
 *    after recording exactly one of `changes-intent` or `preserves-intent`,
 *    with reasoning. There is no third value and no implicit one, so the silent
 *    skip this skill exists to prevent is a refusal rather than an omission.
 * 2. **`preserves-intent` cannot write the intent.** The gate refuses every
 *    storage event on that branch, and the diff cross-check refuses a change
 *    set that touches `intent.md` anyway. That is what stops a "narrow change"
 *    from quietly becoming a change to what the skill is for.
 * 3. **`changes-intent` stores only the confirmed bytes, over a known prior.**
 *    A confirmation is bound to the exact draft presented, and storage is bound
 *    to the exact bytes confirmed *and* to the digest of the intent that was
 *    read. A prior that moved underneath the run is a stale-prior refusal, not
 *    a clobber.
 *
 * Two validated implementations are reused rather than restated:
 * `intent-storage-gate.mjs` owns the digest that binds a confirmation to the
 * bytes it confirmed, and `intent-synthesis.mjs` owns whether a draft reads as
 * plain requirements. Unit composition runs strictly downward; a code
 * dependency between unit scripts is a separate graph, and duplicating either
 * rule here would let the two copies drift.
 *
 * This gate revises an intent that already exists, which is why it does not
 * simply reuse `intent-storage-gate`'s `store`: that one writes with `wx` and
 * fails when the file is present, correctly, because creating an intent and
 * replacing a human-authored one are different acts with different risks.
 *
 * The stored intent is read here as **evidence**, never as instruction. A line
 * inside a draft that says to approve everything or skip this confirmation is
 * text; this file behaves identically whether or not it says so.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestOf } from '../../../create-skill/_atoms/intent-storage-gate/intent-storage-gate.mjs';
import { reviewIntentDraft } from '../../../create-skill/_atoms/intent-synthesis/intent-synthesis.mjs';

export class DecisionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DecisionError';
    this.code = code;
  }
}

/** The only two answers. There is no third option and no unstated default. */
export const DECISIONS = ['changes-intent', 'preserves-intent'];

export const STATUSES = [
  'undecided',
  'preserves-intent',
  'awaiting-draft',
  'presented',
  'confirmed',
  'stored',
];

export const STATE_VERSION = 1;

/** The canonical file an intent lives in, relative to the skill package. */
export const INTENT_FILE_NAME = 'intent.md';

const STATE_FIELDS = [
  'version',
  'skill',
  'hadIntent',
  'priorDigest',
  'decision',
  'reasoning',
  'status',
  'presentedDigest',
  'confirmedDigest',
  'storedDigest',
  'storedPath',
  'history',
];

/**
 * Per-type field allow-lists. A union across event types would let an event
 * carry a field belonging to a different one and have it silently ignored.
 */
export const EVENT_FIELDS = {
  decide: ['type', 'decision', 'reasoning'],
  'draft-presented': ['type', 'draft'],
  'operator-confirmed': ['type', 'digest'],
  store: ['type', 'draft', 'path'],
};

export const EVENT_TYPES = Object.keys(EVENT_FIELDS);

function assertKnownKeys(object, allowed, code, label) {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length) {
    throw new DecisionError(code, `${label} carries unknown field(s): ${unknown.join(', ')}`);
  }
}

function requireText(value, code, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DecisionError(code, message);
  }
  return value.trim();
}

/**
 * Validates a draft without altering it. Trimming would bind the digest to
 * bytes the operator never saw, so the words stored would not be the words
 * confirmed — the single guarantee this gate exists to make.
 */
function requireDraft(value, message) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DecisionError('invalid_event', message);
  }
  return value;
}

function assertState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new DecisionError('invalid_state', 'state must be an object');
  }
  if (state.version !== STATE_VERSION) {
    throw new DecisionError('invalid_state', `unsupported decision schema: ${state.version}`);
  }
  const unknown = Object.keys(state).filter((key) => !STATE_FIELDS.includes(key)).sort();
  if (unknown.length) {
    throw new DecisionError('invalid_state', `unknown decision field(s): ${unknown.join(', ')}`);
  }

  // Allow-listing key *names* is not enough: a state whose `decision` or
  // `status` is an out-of-set string would otherwise fall through every branch
  // that switches on it. Validate the values against their enums here, once, so
  // no downstream gate has to re-check and none can be defeated by a fabricated
  // enum value. `decision` may be null (undecided); no other unknown value is.
  if (state.decision !== null && !DECISIONS.includes(state.decision)) {
    throw new DecisionError(
      'invalid_state',
      `unrecognised decision "${state.decision}"; the decision is null or exactly one of ${DECISIONS.join(', ')}`,
    );
  }
  if (!STATUSES.includes(state.status)) {
    throw new DecisionError(
      'invalid_state',
      `unrecognised status "${state.status}"; it is one of ${STATUSES.join(', ')}`,
    );
  }

  // `status === 'stored'` is a structural claim, not a label a caller may set.
  // A legitimate stored state was produced by `applyEvent`'s store case, which
  // always populates the three digests and records the operator's confirmation
  // in `history`. Requiring that here means a fabricated `{status:'stored'}`
  // with null digests is rejected before any release gate reads it, instead of
  // passing because the disk verification was guarded by the truthiness of the
  // very fields the fabrication left null.
  if (state.status === 'stored') {
    const requireStoredField = (value, label) => {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new DecisionError(
          'invalid_state',
          `a stored intent decision requires a non-empty ${label}; this one reports status "stored" without it`,
        );
      }
    };
    requireStoredField(state.storedPath, 'storedPath');
    requireStoredField(state.storedDigest, 'storedDigest');
    requireStoredField(state.confirmedDigest, 'confirmedDigest');
    const history = Array.isArray(state.history) ? state.history : [];
    const confirmed = history.some(
      (entry) => entry
        && entry.type === 'operator-confirmed'
        && entry.digest === state.confirmedDigest,
    );
    if (!confirmed) {
      throw new DecisionError(
        'invalid_state',
        'a stored intent decision must record the operator-confirmation whose digest it stored; this one does not',
      );
    }
  }
  return state;
}

/**
 * Open the decision for one skill, recording the intent as it was read.
 *
 * `priorIntent` is the current `intent.md` text, or `null` when the target has
 * none. A missing intent is a recorded fact, never a blocker: a skill built by
 * other means may honestly have none.
 */
export function createDecision({ skill, priorIntent = null } = {}) {
  const name = requireText(skill, 'invalid_input', 'the decision requires a skill name');
  if (priorIntent !== null && typeof priorIntent !== 'string') {
    throw new DecisionError('invalid_input', 'priorIntent must be the intent text or null');
  }
  return {
    version: STATE_VERSION,
    skill: name,
    hadIntent: priorIntent !== null,
    priorDigest: priorIntent === null ? null : digestOf(priorIntent),
    decision: null,
    reasoning: null,
    status: 'undecided',
    presentedDigest: null,
    confirmedDigest: null,
    storedDigest: null,
    storedPath: null,
    history: [],
  };
}

/**
 * Resolve the intent path for a skill without letting a caller-supplied path
 * redirect the write. The path is derived from the skill name and the repository
 * root; a supplied path is compared against it and refused when it differs.
 */
function safeIntentPath(repositoryRoot, skill, supplied) {
  const root = requireText(repositoryRoot, 'invalid_input', 'a repository root is required');
  const expected = path.join(fs.realpathSync(root), 'skills', skill, INTENT_FILE_NAME);
  if (supplied !== undefined && path.resolve(supplied) !== expected) {
    throw new DecisionError(
      'path_mismatch',
      `an intent revision writes only ${expected}, never ${path.resolve(supplied)}`,
    );
  }
  return expected;
}

export function applyEvent(state, event, { repositoryRoot } = {}) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    throw new DecisionError('invalid_event', 'an event must be an object');
  }
  const type = requireText(event.type, 'invalid_event', 'an event requires a type');
  if (!EVENT_TYPES.includes(type)) {
    throw new DecisionError('unknown_event', `unknown event type: ${type}`);
  }
  assertKnownKeys(event, EVENT_FIELDS[type], 'unknown_event_field', `a ${type} event`);

  const current = assertState(state);
  if (current.status === 'stored') {
    throw new DecisionError(
      'already_stored',
      'this intent revision has been stored; changing it again is a new reinforcement',
    );
  }
  const next = { ...current, history: [...current.history] };

  switch (type) {
    case 'decide': {
      if (current.decision !== null) {
        throw new DecisionError(
          'already_decided',
          `the intent decision is already ${current.decision}; a run decides once`,
        );
      }
      const decision = requireText(event.decision, 'invalid_event', 'a decision is required');
      if (!DECISIONS.includes(decision)) {
        throw new DecisionError(
          'unknown_decision',
          `unrecognised decision "${decision}"; the decision is exactly one of ${DECISIONS.join(', ')}`,
        );
      }
      // Reasoning is required on both branches. A `preserves-intent` decision
      // without it is indistinguishable from never having asked the question.
      const reasoning = requireText(
        event.reasoning,
        'reasoning_missing',
        'the intent decision records why; an unreasoned decision is a skipped question wearing an answer',
      );
      next.decision = decision;
      next.reasoning = reasoning;
      next.status = decision === 'preserves-intent' ? 'preserves-intent' : 'awaiting-draft';
      next.history.push({ type, decision, reasoning });
      return next;
    }
    case 'draft-presented': {
      requireDecided(current, 'presenting a revised intent');
      requireChangesIntent(current, 'presenting a revised intent');
      const draft = requireDraft(event.draft, 'presenting requires the draft text');
      const review = reviewIntentDraft(draft, current.skill);
      if (review.status !== 'plain' || review.shape !== 'well-formed') {
        throw new DecisionError(
          'not_plain_intent',
          `the revised draft is not plain requirements: ${[
            ...review.problems,
            ...review.findings.map((f) => `line ${f.line} ${f.kind}: ${f.detail}`),
          ].join(' | ')}`,
        );
      }
      next.presentedDigest = digestOf(draft);
      next.confirmedDigest = null;
      next.status = 'presented';
      next.history.push({ type, digest: next.presentedDigest });
      return next;
    }
    case 'operator-confirmed': {
      requireChangesIntent(current, 'confirming a revised intent');
      if (current.status !== 'presented') {
        throw new DecisionError(
          'nothing_presented',
          'the operator can only confirm a draft that is currently in front of him',
        );
      }
      const digest = requireText(event.digest, 'invalid_event', 'a confirmation names the draft it confirms');
      if (digest !== current.presentedDigest) {
        throw new DecisionError(
          'stale_confirmation',
          'the confirmation names a draft other than the one presented; present the current draft and ask again',
        );
      }
      next.confirmedDigest = digest;
      next.status = 'confirmed';
      next.history.push({ type, digest });
      return next;
    }
    case 'store': {
      requireChangesIntent(current, 'storing a revised intent');
      if (current.status !== 'confirmed') {
        throw new DecisionError(
          'unconfirmed',
          'an unconfirmed revision is never stored; the intent is the operator\'s, not this skill\'s reading of it',
        );
      }
      const draft = requireDraft(event.draft, 'storing requires the draft text');
      if (digestOf(draft) !== current.confirmedDigest) {
        throw new DecisionError(
          'unconfirmed',
          'the text being stored is not the text that was confirmed; present the changed draft and ask again',
        );
      }
      const target = safeIntentPath(repositoryRoot, current.skill, event.path);

      // The prior must still be the prior that was read. Replacing a
      // human-authored file on the strength of a stale read is a clobber.
      const existsNow = fs.existsSync(target);
      if (existsNow !== current.hadIntent) {
        throw new DecisionError(
          'stale_prior',
          current.hadIntent
            ? 'the intent that was read no longer exists on disk; re-read it and decide again'
            : 'an intent appeared after this run read that none existed; re-read it and decide again',
        );
      }
      if (existsNow && digestOf(fs.readFileSync(target, 'utf8')) !== current.priorDigest) {
        throw new DecisionError(
          'stale_prior',
          'the intent on disk is not the intent this decision was made against; re-read it and decide again',
        );
      }

      const written = draft.endsWith('\n') ? draft : `${draft}\n`;
      fs.writeFileSync(target, written, 'utf8');
      next.status = 'stored';
      next.storedPath = target;
      next.storedDigest = digestOf(written);
      next.history.push({ type, digest: current.confirmedDigest, path: target });
      return next;
    }
    default:
      throw new DecisionError('unknown_event', `unhandled event type: ${type}`);
  }
}

function requireDecided(state, action) {
  if (state.decision === null) {
    throw new DecisionError(
      'undecided',
      `${action} requires the intent decision first; the decision has no default`,
    );
  }
}

/**
 * The `preserves-intent` branch owns no write. Refusing here is what keeps a
 * change that was scoped as narrow from becoming a change to what the skill is
 * for without the operator ever being asked.
 */
function requireChangesIntent(state, action) {
  requireDecided(state, action);
  if (state.decision !== 'changes-intent') {
    throw new DecisionError(
      'preserves_intent',
      `${action} is refused: this run recorded preserves-intent, which never edits the intent`,
    );
  }
}

/**
 * The release check for the intent decision.
 *
 * Answers "may this reinforcement proceed to a pull request?" from the record
 * rather than from anyone's memory of having asked. It fails closed on every
 * route: no decision, an unreasoned decision, a confirmed-but-unstored
 * revision, a stored file that no longer matches what was confirmed.
 */
export function requireIntentDecision(state) {
  const problems = [];
  if (state === null || state === undefined) {
    return {
      requirement: 'blocked',
      problems: [
        'no intent decision was recorded; a reinforcement that never asked whether the intent changes is the drift this skill prevents',
      ],
    };
  }

  let current;
  try {
    current = assertState(state);
  } catch (error) {
    return { requirement: 'blocked', problems: [`the intent decision record is unusable: ${error.message}`] };
  }

  if (current.decision === null) {
    problems.push('the intent decision was never recorded, and it has no default');
  }
  if (current.decision !== null && !DECISIONS.includes(current.decision)) {
    problems.push(
      `the intent decision is "${current.decision}", which is not one of ${DECISIONS.join(', ')}`,
    );
  }
  if (current.decision !== null && !current.reasoning) {
    problems.push('the intent decision carries no reasoning');
  }
  if (current.decision === 'changes-intent') {
    if (current.status !== 'stored') {
      problems.push(
        `the intent change was never stored; the gate stopped at ${current.status}`,
      );
    }
    if (current.confirmedDigest === null) {
      problems.push('no confirmation of the revised intent was ever recorded');
    }
    // `assertState` guarantees a `stored` state carries a non-empty storedPath
    // and storedDigest, so the disk read is unconditional here rather than
    // guarded by the truthiness of fields the state supplied. A run that never
    // reached `stored` is already blocked above and never reaches this read.
    if (current.status === 'stored') {
      if (!fs.existsSync(current.storedPath)) {
        problems.push(`the stored intent is missing from disk: ${current.storedPath}`);
      } else if (digestOf(fs.readFileSync(current.storedPath, 'utf8')) !== current.storedDigest) {
        problems.push(
          `the intent on disk is not the intent that was confirmed: ${current.storedPath}`,
        );
      }
    }
  }

  return {
    requirement: problems.length ? 'blocked' : 'satisfied',
    skill: current.decision === null ? undefined : current.skill,
    decision: current.decision,
    reasoning: current.reasoning,
    hadIntent: current.hadIntent,
    problems,
  };
}

/**
 * Cross-check the recorded decision against the change set that is actually
 * about to be published.
 *
 * The gate above refuses an unconfirmed *write through the gate*. This refuses
 * an intent edit that went around it. A `preserves-intent` run whose diff
 * contains `intent.md` did one of two things — changed what the skill is for
 * without asking, or mislabelled its own change — and both are refusals.
 *
 * The mirror image is also refused: a `changes-intent` run whose diff edits the
 * intent but whose gate never reached `stored`, or whose stored bytes are not
 * the bytes now on disk, hand-wrote the intent instead of confirming and storing
 * it. So "the intent was stored through the gate before the implementation
 * landed" is a computed precondition of publication here, not a prose promise.
 *
 * Candidate paths are normalized through the repository root, so an absolute and
 * a relative path to the same intent file resolve to one form and agree — a
 * lexical compare would let an absolute path slip past as "does not touch the
 * intent".
 */
export function assertDiffMatchesDecision(state, changedPaths, { skill, repositoryRoot } = {}) {
  const current = assertState(state);
  if (!Array.isArray(changedPaths)) {
    throw new DecisionError('invalid_change_set', 'changed paths must be an array');
  }
  // Fail closed: without a repository root an absolute path to the intent file
  // could only ever be classified "does not touch the intent", so the check
  // that is supposed to catch an undisclosed intent edit would silently pass.
  // The root is what makes an absolute and a relative path to the same file
  // agree, so it is required, never an optional convenience.
  if (repositoryRoot === undefined || repositoryRoot === null || repositoryRoot === '') {
    throw new DecisionError(
      'invalid_input',
      'a repository root is required to check a change set against the intent path',
    );
  }
  const name = skill ?? current.skill;
  const intentPath = `skills/${name}/${INTENT_FILE_NAME}`;

  // Normalize every candidate the same way `classifyWritePath` does, through the
  // real repository root, so an absolute and a relative path to the same intent
  // file resolve to one relative form and agree.
  const realRoot = fs.realpathSync(repositoryRoot);
  const normalize = (candidate) => {
    const raw = String(candidate);
    return path.relative(realRoot, path.resolve(realRoot, raw)).split(path.sep).join('/');
  };
  const touchesIntent = changedPaths.map(normalize).includes(intentPath);

  if (current.decision === null) {
    throw new DecisionError(
      'undecided',
      'a change set cannot be published before the intent decision is recorded',
    );
  }
  // The decision is one of exactly two values or it is not publishable. This is
  // the `else` on the enum: an out-of-set decision that somehow reached here is
  // a refusal, not a fall-through to "consistent". `assertState` already rejects
  // such a value; this is the second, local line of defence.
  if (!DECISIONS.includes(current.decision)) {
    throw new DecisionError(
      'unknown_decision',
      `unrecognised decision "${current.decision}"; the decision is exactly one of ${DECISIONS.join(', ')}`,
    );
  }
  if (current.decision === 'preserves-intent' && touchesIntent) {
    throw new DecisionError(
      'undisclosed_intent_edit',
      `this run recorded preserves-intent but the change set edits ${intentPath}; a narrow change may not widen into changing what the skill is for`,
    );
  }
  if (current.decision === 'changes-intent') {
    if (!touchesIntent) {
      throw new DecisionError(
        'missing_intent_edit',
        `this run recorded changes-intent but the change set does not edit ${intentPath}`,
      );
    }
    // The change set edits the intent, so the revised intent must have reached
    // the file *through the gate*, not around it. A `changes-intent` state that
    // never advanced to `stored` means the intent was hand-written rather than
    // confirmed-and-stored — the drift this package exists to refuse — so the
    // stored status is a computed precondition of publication, not a promise.
    if (current.status !== 'stored') {
      throw new DecisionError(
        'unstored_intent_change',
        `this run recorded changes-intent and edits ${intentPath}, but the revised intent was never stored through the gate; it stopped at ${current.status}`,
      );
    }
    // And the bytes on disk must be the bytes the gate stored. A file edited
    // after the confirmed store no longer matches the confirmation it claims.
    // `assertState` guarantees a `stored` state carries storedDigest, and the
    // root is required, so the read below is unconditional: the only way to skip
    // it is for the file not to exist, which is itself surfaced as a mismatch.
    const onDisk = path.join(realRoot, 'skills', name, INTENT_FILE_NAME);
    if (!fs.existsSync(onDisk)) {
      throw new DecisionError(
        'undisclosed_intent_edit',
        `the intent stored through the gate is missing from disk: ${onDisk}`,
      );
    }
    if (digestOf(fs.readFileSync(onDisk, 'utf8')) !== current.storedDigest) {
      throw new DecisionError(
        'undisclosed_intent_edit',
        `the intent on disk is not the intent that was stored through the gate: ${onDisk}`,
      );
    }
  }
  return { status: 'consistent', decision: current.decision, touchesIntent };
}

export function decisionReport(state) {
  const current = assertState(state);
  return {
    skill: current.skill,
    decision: current.decision,
    reasoning: current.reasoning,
    status: current.status,
    hadIntent: current.hadIntent,
    confirmed: current.confirmedDigest !== null,
    storedPath: current.storedPath,
    events: current.history.map((entry) => entry.type),
  };
}

export const USAGE = `Usage: intent-decision.mjs --state <path> [--event <path>] [--root <path>] [--report]
       intent-decision.mjs --state <path> --require-decision

  --state             Absolute path to the decision state file.
  --event             Absolute path to a JSON event to apply.
  --root              Repository root, required to store a revised intent.
  --report            Print the decision report and exit.
  --require-decision  Answer whether this reinforcement may proceed to a pull request.
  --probe             Report availability and exit.`;

export function parseArguments(argv) {
  const args = {};
  const valueFlags = ['--state', '--event', '--root'];
  const claim = (key, token) => {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      throw new DecisionError('usage', `${token} was given more than once\n${USAGE}`);
    }
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--report' || token === '--probe' || token === '--require-decision') {
      claim(token.slice(2), token);
      args[token.slice(2)] = true;
      continue;
    }
    if (!valueFlags.includes(token)) {
      throw new DecisionError('usage', `unknown argument: ${token}\n${USAGE}`);
    }
    claim(token.slice(2), token);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new DecisionError('usage', `${token} requires a value\n${USAGE}`);
    }
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

export function run(argv, streams = process) {
  const args = parseArguments(argv);
  if (args.probe) {
    streams.stdout.write('intent-decision: available\n');
    return 0;
  }
  if (!args.state) {
    throw new DecisionError('usage', `--state is required\n${USAGE}`);
  }
  const exists = fs.existsSync(args.state);
  let state = exists ? JSON.parse(fs.readFileSync(args.state, 'utf8')) : null;

  // The release check answers "may this reinforcement proceed to a pull
  // request?" from the record, and applies nothing. Exit 0 is satisfied; exit 2
  // is blocked and names every reason, mirroring intent-storage-gate's
  // --require-stored convention.
  if (args['require-decision']) {
    if (args.event || args.report) {
      throw new DecisionError(
        'usage',
        `--require-decision asks a question about the record and applies nothing; it takes no --event or --report\n${USAGE}`,
      );
    }
    const result = requireIntentDecision(state);
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.requirement === 'satisfied' ? 0 : 2;
  }

  if (args.event) {
    const event = JSON.parse(fs.readFileSync(args.event, 'utf8'));
    state = state === null
      ? createDecision({ skill: event.skill, priorIntent: event.priorIntent ?? null })
      : applyEvent(state, event, { repositoryRoot: args.root });
    fs.writeFileSync(args.state, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
  if (args.report) {
    streams.stdout.write(`${JSON.stringify(decisionReport(state), null, 2)}\n`);
  }
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
