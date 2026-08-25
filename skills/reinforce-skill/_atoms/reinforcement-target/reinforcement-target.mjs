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
 */
export function auditDiff(repositoryRoot, skillName, changedPaths) {
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

  return {
    classified,
    refused,
    workflow,
    clean: refused.length === 0,
  };
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--probe') {
      args.probe = true;
      continue;
    }
    if (!token.startsWith('--')) {
      throw new TargetError(FAILURES.usage, `unexpected argument: ${token}`);
    }
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
    return;
  }
  if (!args.root || !args.skill) {
    throw new TargetError(FAILURES.usage, '--root and --skill are required');
  }
  if (args.classify) {
    const writeClass = classifyWritePath(args.root, args.skill, args.classify);
    process.stdout.write(`${JSON.stringify({ writeClass, writable: isWritableClass(writeClass) }, null, 2)}\n`);
    return;
  }
  if (args.audit) {
    const changed = args.audit.split(',').map((entry) => entry.trim()).filter(Boolean);
    process.stdout.write(`${JSON.stringify(auditDiff(args.root, args.skill, changed), null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(resolveSkillTarget(args.root, args.skill), null, 2)}\n`);
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
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.code ?? FAILURES.usage, message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}

export { FAILURES, WORKFLOW_FILE };
