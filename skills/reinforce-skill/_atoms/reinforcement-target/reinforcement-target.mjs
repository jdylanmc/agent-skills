/**
 * Deterministic write-boundary guard for `reinforce-skill`.
 *
 * `reinforce-skill` holds an `edit` grant, and the runtime cannot scope that
 * grant to a single directory. So the honest job of this helper is not to
 * *prevent* a write — nothing inside one model run can — but to make the write
 * scope a decided, testable predicate:
 *
 *   1. It resolves the one skill being reinforced and proves that skill is an
 *      existing routable package. Reinforcing something that does not exist is
 *      `create-skill`'s job, and this refuses it rather than creating it.
 *   2. It classifies any path the run intends to write, so an out-of-target
 *      edit becomes a *reported* entry in the change ledger rather than a
 *      detail that slips past. A `doctrine/`, `_base/`, or foreign-skill path is
 *      refused; the shared workflow file is the one disclosed cross-touchpoint.
 *
 * The classification is not the boundary on its own. The boundary is that the
 * run never merges: the deliverable is a reviewed pull request, continuous
 * integration re-runs the validator, the deriver, the doctrine-manifest digest
 * test, and the full suite over the diff, and the repository already refuses to
 * widen any skill's grant automatically. This helper makes every write it is
 * asked about legible to that review; it does not stand in for it.
 *
 * Everything here is deterministic so it can be tested against the cases that
 * matter — a missing target, `_base`, traversal, a symlinked component, a
 * doctrine path, and a foreign-skill path.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FAILURES = {
  usage: 'usage',
  invalidName: 'invalid_name',
  outsideRepository: 'outside_repository',
  symlinkComponent: 'symlink_component',
  notASkill: 'not_a_skill',
  notADirectory: 'not_a_directory',
  workflowNotAdditive: 'workflow_not_additive',
};

export class TargetError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * A routable skill name. The same shape the validator accepts for a skill id,
 * repeated here on purpose: it is what makes `..`, an absolute path, a nested
 * `a/b`, an uppercase escape, and a leading-underscore `_base` all fail as
 * malformed rather than being caught later by a containment check that is
 * easier to get wrong.
 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where classified paths may land. Only these are edited in a reinforcement. */
export const WRITE_CLASS = {
  inTarget: 'in-target',
  workflow: 'workflow',
  base: 'base',
  doctrine: 'doctrine',
  foreignSkill: 'foreign-skill',
  outside: 'outside',
};

/** The one shared file a reinforcement may touch: test registration. */
const WORKFLOW_FILE = '.github/workflows/validate-skills.yml';

function requireString(value, name) {
  if (typeof value !== 'string' || !value) {
    throw new TargetError(FAILURES.usage, `${name} is required`);
  }
  return value;
}

/**
 * Reject every symlink in the existing prefix of `absolute`, not just the leaf.
 * A symlinked parent redirects a write exactly as effectively as a symlinked
 * file and is easier to miss.
 */
function assertNoSymlinkComponent(realRoot, absolute) {
  const relative = path.relative(realRoot, absolute);
  let walked = realRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    walked = path.join(walked, segment);
    let stat;
    try {
      stat = fs.lstatSync(walked);
    } catch {
      break; // Does not exist yet; nothing further to verify on this path.
    }
    if (stat.isSymbolicLink()) {
      throw new TargetError(
        FAILURES.symlinkComponent,
        `path component is a symbolic link: ${walked}`,
      );
    }
  }
}

/**
 * Resolve the one skill being reinforced and prove it is safe to edit.
 *
 * With `mustExist` (the default and the only value the skill uses), the target
 * must already be a routable skill package: an existing directory that contains
 * `SKILL.md`. A missing target is refused with `not_a_skill`, because creating
 * one is `create-skill`'s job, never this skill's.
 */
export function resolveSkillTarget(repositoryRoot, skillName, { mustExist = true } = {}) {
  requireString(repositoryRoot, 'repositoryRoot');
  requireString(skillName, 'skillName');

  if (!SKILL_NAME.test(skillName)) {
    throw new TargetError(
      FAILURES.invalidName,
      `not a routable skill name: ${JSON.stringify(skillName)}`,
    );
  }
  if (skillName === '_base') {
    // Unreachable through SKILL_NAME, kept as an explicit second line: `_base`
    // is shared infrastructure and is never reinforced as if it were a skill.
    throw new TargetError(FAILURES.invalidName, '_base is not a routable skill');
  }

  const realRoot = fs.realpathSync(repositoryRoot);
  const skillsRoot = path.join(realRoot, 'skills');
  const absolute = path.join(skillsRoot, skillName);

  const relative = path.relative(skillsRoot, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new TargetError(
      FAILURES.outsideRepository,
      `target resolves outside skills/: ${absolute}`,
    );
  }

  assertNoSymlinkComponent(realRoot, absolute);

  const exists = fs.existsSync(absolute);
  if (mustExist) {
    if (!exists) {
      throw new TargetError(
        FAILURES.notASkill,
        `no skill package at skills/${skillName}; creating one is create-skill's job`,
      );
    }
    const stat = fs.lstatSync(absolute);
    if (!stat.isDirectory()) {
      throw new TargetError(FAILURES.notADirectory, `skills/${skillName} is not a directory`);
    }
    if (!fs.existsSync(path.join(absolute, 'SKILL.md'))) {
      throw new TargetError(
        FAILURES.notASkill,
        `skills/${skillName} has no SKILL.md, so it is not a routable skill`,
      );
    }
  }

  return {
    skillName,
    canonicalPath: absolute,
    relativePath: `skills/${skillName}`,
    exists,
    hasIntent: exists && fs.existsSync(path.join(absolute, 'intent.md')),
    hasSkillMd: exists && fs.existsSync(path.join(absolute, 'SKILL.md')),
  };
}

/**
 * Classify a path the run intends to write, relative to the repository root.
 *
 * The classification is exhaustive: every candidate resolves to exactly one
 * class, so a later ledger can map every unit of the eventual diff back to a
 * decided class. `in-target` and `workflow` are the only classes a
 * reinforcement edits; the rest are reported and refused.
 *
 * Symlinked components are resolved before classifying. A lexical check would
 * classify a symlinked `skills/<target>/intent.md` as `in-target` while the
 * bytes landed wherever the link pointed; resolving the real path of the
 * deepest existing ancestor closes that gap.
 */
export function classifyWritePath(repositoryRoot, skillName, candidatePath) {
  requireString(repositoryRoot, 'repositoryRoot');
  requireString(skillName, 'skillName');
  requireString(candidatePath, 'candidatePath');
  if (!SKILL_NAME.test(skillName)) {
    throw new TargetError(
      FAILURES.invalidName,
      `not a routable skill name: ${JSON.stringify(skillName)}`,
    );
  }

  const realRoot = fs.realpathSync(repositoryRoot);
  const absolute = path.resolve(realRoot, candidatePath);

  // Resolve the real path of the deepest existing ancestor, then re-attach the
  // not-yet-existing tail. This follows a symlinked parent or leaf to its true
  // location before any lexical judgement is made.
  let existing = absolute;
  const trailing = [];
  while (!fs.existsSync(existing)) {
    trailing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) {
      break;
    }
    existing = parent;
  }
  let realExisting;
  try {
    realExisting = fs.realpathSync(existing);
  } catch {
    realExisting = existing;
  }
  const resolved = trailing.length ? path.join(realExisting, ...trailing) : realExisting;
  const relative = path.relative(realRoot, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return WRITE_CLASS.outside;
  }

  const posix = relative.split(path.sep).join('/');
  if (posix === WORKFLOW_FILE) {
    return WRITE_CLASS.workflow;
  }
  const segments = posix.split('/');
  if (segments[0] === 'doctrine') {
    return WRITE_CLASS.doctrine;
  }
  if (segments[0] !== 'skills') {
    return WRITE_CLASS.outside;
  }
  if (segments[1] === '_base') {
    return WRITE_CLASS.base;
  }
  if (segments[1] === skillName) {
    return WRITE_CLASS.inTarget;
  }
  return WRITE_CLASS.foreignSkill;
}

/** The classes a reinforcement is permitted to write. Everything else is refused. */
export function isWritableClass(writeClass) {
  return writeClass === WRITE_CLASS.inTarget || writeClass === WRITE_CLASS.workflow;
}

/**
 * The `workflow` class is writable, but not unconditionally: the one edit a
 * reinforcement may make to the shared validation workflow is registering a new
 * test. That edit is bounded on both sides. Negatively, it removes nothing: every
 * non-blank line of the previous file still appears in the next, so deleting an
 * existing `*.test.mjs` registration is refused. Positively, every line it *adds*
 * is a `*.test.mjs` registration path and nothing else, so adding `if: false` to
 * a job, moving a registration to a re-indented position, or slipping in any
 * other workflow line is refused even though it removes nothing.
 *
 * The two bounds together are what let this stand for "register a test, and do
 * only that". A negative-only check was blind to weakening by pure addition; the
 * positive bound closes that. What it does not prove is YAML *structure* — a line
 * whose exact text and indentation are preserved but whose surrounding block
 * changed is invisible to a line-level check, and that residue is caught by
 * continuous integration re-running the gates over the diff and by the human who
 * reads it, not by this function.
 *
 * Lines are compared with trailing whitespace trimmed, so a reflowed or
 * re-indented tail does not read as a removal; a genuinely removed or rewritten
 * registration, or a re-indented one, does.
 */
const REGISTRATION_LINE = /^\S+\.test\.mjs$/;

export function assertWorkflowAdditive(previousContent, nextContent) {
  if (typeof previousContent !== 'string' || typeof nextContent !== 'string') {
    throw new TargetError(
      FAILURES.usage,
      'assertWorkflowAdditive requires the previous and next workflow contents',
    );
  }
  const previousLines = previousContent.split('\n').map((line) => line.trimEnd());
  const nextLines = nextContent.split('\n').map((line) => line.trimEnd());
  const previousSet = new Set(previousLines);
  const nextSet = new Set(nextLines);

  const removed = previousLines
    .filter((line) => line.trim() !== '')
    .filter((line) => !nextSet.has(line));

  // Every added non-blank line must be a test-registration path. This is the
  // positive bound: a weakening that only *adds* lines — `if: false`, a moved or
  // re-indented registration, a new step — leaves every previous line in place
  // and would pass a removal-only check, so it is refused here instead.
  const added = nextLines
    .filter((line) => line.trim() !== '')
    .filter((line) => !previousSet.has(line))
    .filter((line) => !REGISTRATION_LINE.test(line.trim()));

  if (removed.length || added.length) {
    const reasons = [];
    if (removed.length) {
      reasons.push(`these lines were removed or rewritten: ${removed.join(' | ')}`);
    }
    if (added.length) {
      reasons.push(`these added lines are not test registrations: ${added.join(' | ')}`);
    }
    const error = new TargetError(
      FAILURES.workflowNotAdditive,
      `the workflow edit is not a bare test registration; ${reasons.join('; ')}`,
    );
    error.removed = removed;
    error.added = added;
    throw error;
  }
  return { status: 'additive', removed: [], added: [] };
}

/**
 * Audit an actual change set — the real list of changed paths from the version
 * control diff — before a pull request opens.
 *
 * This is the completeness the single-path classifier cannot give on its own. A
 * classifier the model may or may not call proves nothing about paths it was
 * never handed. The diff is enumerable, so every changed path is classified
 * here, and any path outside `in-target` or `workflow` is refused. `workflow`
 * is reported separately because it is a shared file: it is writable only as an
 * additive test registration and is always surfaced for a human to read, never
 * treated as mechanically safe.
 *
 * The gate this feeds is publication: no pull request opens while `refused` is
 * non-empty. It does not stop a write mid-run — nothing in one model run can —
 * but nothing lands without passing this audit and the human review after it.
 *
 * When the run supplies the workflow file's before/after content in
 * `{ workflow: { previous, next } }`, the edit is additionally proven a bare test
 * registration: a removed registration, an edited doctrine-digest step, or any
 * added non-registration line is a `workflowViolation` that makes the change set
 * unclean, exactly as an out-of-target path does.
 *
 * Fail closed: when the change set touches the workflow but the run supplied no
 * before/after content, the edit cannot be proven a bare registration, so it is
 * a `workflowViolation` and the change set is unclean. An unproven workflow edit
 * is refused, never waved through.
 */
export function auditDiff(repositoryRoot, skillName, changedPaths, { workflow: workflowDiff } = {}) {
  requireString(repositoryRoot, 'repositoryRoot');
  requireString(skillName, 'skillName');
  if (!Array.isArray(changedPaths)) {
    throw new TargetError(FAILURES.usage, 'changedPaths must be an array');
  }

  const classified = changedPaths.map((candidate) => {
    const writeClass = classifyWritePath(repositoryRoot, skillName, candidate);
    return { path: candidate, writeClass, writable: isWritableClass(writeClass) };
  });

  const refused = classified.filter((entry) => !entry.writable);
  const workflow = classified.filter((entry) => entry.writeClass === WRITE_CLASS.workflow);

  // A workflow file is writable only as an additive registration, and only when
  // that can be proven. When the run supplies the before/after content, prove the
  // edit is a bare registration. When it touches the workflow but supplies no
  // content, the edit is unproven and therefore refused — the same fail-closed
  // stance as an out-of-target path.
  let workflowViolation = null;
  if (workflow.length) {
    if (!workflowDiff) {
      workflowViolation = {
        path: WORKFLOW_FILE,
        reason: 'workflow content not supplied',
        message:
          'the change set edits the validation workflow but supplied no before/after content, '
          + 'so the edit cannot be proven a bare test registration',
      };
    } else {
      try {
        assertWorkflowAdditive(workflowDiff.previous, workflowDiff.next);
      } catch (error) {
        if (error.code !== FAILURES.workflowNotAdditive) {
          throw error;
        }
        workflowViolation = {
          path: workflowDiff.path ?? WORKFLOW_FILE,
          removed: error.removed ?? [],
          added: error.added ?? [],
          message: error.message,
        };
      }
    }
  }

  return {
    classified,
    refused,
    workflow,
    workflowViolation,
    clean: refused.length === 0 && workflowViolation === null,
  };
}

function parseArguments(argv) {
  const args = {};
  const valueFlags = ['--root', '--skill', '--classify', '--audit', '--workflow-previous', '--workflow-next'];
  const claim = (key, token) => {
    if (Object.prototype.hasOwnProperty.call(args, key)) {
      throw new TargetError(FAILURES.usage, `${token} was given more than once`);
    }
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--probe') {
      claim('probe', token);
      args.probe = true;
      continue;
    }
    if (!valueFlags.includes(token)) {
      throw new TargetError(FAILURES.usage, `unknown argument: ${token}`);
    }
    claim(token.slice(2), token);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TargetError(FAILURES.usage, `${token} requires a value`);
    }
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function main(argv) {
  const args = parseArguments(argv);
  if (args.probe) {
    process.stdout.write('reinforcement-target: available\n');
    return 0;
  }
  if (!args.root || !args.skill) {
    throw new TargetError(FAILURES.usage, '--root and --skill are required');
  }
  if (args.classify) {
    const writeClass = classifyWritePath(args.root, args.skill, args.classify);
    process.stdout.write(`${JSON.stringify({ writeClass, writable: isWritableClass(writeClass) }, null, 2)}\n`);
    return 0;
  }
  if (args.audit) {
    const changed = args.audit.split(',').map((entry) => entry.trim()).filter(Boolean);
    // A workflow edit is proven a bare registration only when both before and
    // after are supplied. One without the other is a usage error, not a silent
    // half-check.
    const hasPrevious = args['workflow-previous'] !== undefined;
    const hasNext = args['workflow-next'] !== undefined;
    if (hasPrevious !== hasNext) {
      throw new TargetError(
        FAILURES.usage,
        '--workflow-previous and --workflow-next are supplied together or not at all',
      );
    }
    const workflow = hasPrevious
      ? {
        previous: fs.readFileSync(args['workflow-previous'], 'utf8'),
        next: fs.readFileSync(args['workflow-next'], 'utf8'),
      }
      : undefined;
    const result = auditDiff(args.root, args.skill, changed, { workflow });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    // A gate that reports `clean:false` and exits 0 is not a gate. Exit 2 on
    // refusal, mirroring intent-decision.mjs --require-decision, so publication
    // cannot proceed past an unclean audit on a success-shaped exit.
    return result.clean ? 0 : 2;
  }
  process.stdout.write(`${JSON.stringify(resolveSkillTarget(args.root, args.skill), null, 2)}\n`);
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
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.code ?? FAILURES.usage, message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}

export { FAILURES, WORKFLOW_FILE };
