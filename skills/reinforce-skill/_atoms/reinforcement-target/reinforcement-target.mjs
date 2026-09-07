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
 *      refused by class alone; exact companions carry separate proof.
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
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveGraph, setFrontmatterField } from '../../../../scripts/derive-skill-graph.mjs';

const FAILURES = {
  usage: 'usage',
  invalidName: 'invalid_name',
  outsideRepository: 'outside_repository',
  symlinkComponent: 'symlink_component',
  notASkill: 'not_a_skill',
  notADirectory: 'not_a_directory',
  workflowNotAdditive: 'workflow_not_additive',
  invalidCompanion: 'invalid_companion',
  invalidSnapshot: 'invalid_snapshot',
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
 *
 * Exported as `SKILL_NAME_PATTERN` so report intake decides "is this a routable
 * skill name?" with this definition rather than a second one. Two definitions
 * would eventually disagree, and the disagreement that matters is intake
 * admitting a target this guard would refuse.
 *
 * The length bound is part of the definition rather than a separate check for
 * the same reason. A name arriving from an untrusted document is bounded where
 * the shape is decided, so nothing downstream inherits a fifty-kilobyte "skill
 * name" it then has to remember to truncate.
 */
const SKILL_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where classified paths may land. Only these are edited in a reinforcement. */
export const WRITE_CLASS = {
  inTarget: 'in-target',
  workflow: 'workflow',
  base: 'base',
  doctrine: 'doctrine',
  foreignSkill: 'foreign-skill',
  outside: 'outside',
};

/** The shared workflow exception remains additive test registration only. */
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
 *
 * Exported so report intake proves the same property about the path it records
 * a run receipt at. One guard, not two: a second copy would eventually walk the
 * prefix differently, and the difference that matters is one of them accepting
 * a redirect the other refuses.
 */
export function assertNoSymlinkComponent(realRoot, absolute) {
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
 * decided class. Only `in-target` and `workflow` are writable by class;
 * companions are admitted separately without relabelling their original class.
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
 * Preserve every original line, including whitespace, order and multiplicity.
 * Only new canonical paths inside an existing registration block may be inserted.
 */
const REGISTRATION_LINE = /^([ ]+)((?:skills|scripts)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.test\.mjs)(\r?\n)?$/;

export function assertWorkflowAdditive(previousContent, nextContent) {
  if (typeof previousContent !== 'string' || typeof nextContent !== 'string') {
    throw new TargetError(
      FAILURES.usage,
      'assertWorkflowAdditive requires the previous and next workflow contents',
    );
  }
  const lines = (text) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const previousLines = lines(previousContent);
  const nextLines = lines(nextContent);
  const registered = new Set(previousLines.map((line) => line.match(REGISTRATION_LINE)?.[2]).filter(Boolean));
  let cursor = 0;
  let preceding = '';
  let registrationIndent = null;
  const added = [];
  for (const line of nextLines) {
    if (line === previousLines[cursor]) {
      cursor += 1;
    } else {
      const registration = line.match(REGISTRATION_LINE);
      if (!registration || registration[1] !== registrationIndent || registered.has(registration[2])) {
        added.push(line);
      } else {
        registered.add(registration[2]);
      }
    }
    if (line.trim()) {
      const runner = line.match(/^([ ]*)(run: )?node scripts\/run-registered-tests\.mjs\r?\n?$/);
      const registration = line.match(REGISTRATION_LINE);
      if (runner && (runner[2] || /^\s*run: >[-+]?\r?\n?$/.test(preceding))) {
        registrationIndent = `${runner[1]}${runner[2] ? '  ' : ''}`;
      } else if (!registration || registration[1] !== registrationIndent) {
        registrationIndent = null;
      }
      preceding = line;
    }
  }
  const removed = previousLines.slice(cursor);

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
 * here, and any path outside `in-target` or `workflow` needs companion proof. `workflow`
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
export function auditDiff(repositoryRoot, skillName, changedPaths, {
  workflow: workflowDiff, companions = [], contents = new Map(),
} = {}) {
  requireString(repositoryRoot, 'repositoryRoot');
  requireString(skillName, 'skillName');
  if (!Array.isArray(changedPaths)) {
    throw new TargetError(FAILURES.usage, 'changedPaths must be an array');
  }

  const companionEntries = checkCompanions(repositoryRoot, skillName, changedPaths, companions, contents);
  const classified = changedPaths.map((candidate) => {
    const writeClass = classifyWritePath(repositoryRoot, skillName, candidate);
    const companion = companionEntries.get(candidate);
    return {
      path: candidate, writeClass,
      writable: isWritableClass(writeClass) || Boolean(companion),
      ...(companion ? { companion } : {}),
    };
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
    companions: classified.filter((entry) => entry.companion),
    clean: refused.length === 0 && workflowViolation === null,
  };
}

const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const COMPANION_FIELDS = ['path', 'kind', 'reason', 'relationship', 'previous_sha256', 'next_sha256'];

function refuseCompanion(message) {
  throw new TargetError(FAILURES.invalidCompanion, message);
}

function canonicalCompanionPath(root, candidate) {
  if (typeof candidate !== 'string' || !candidate || candidate.includes('\\')
      || /[\x00-\x1f\x7f]/.test(candidate) || path.posix.isAbsolute(candidate)
      || candidate.split('/').some((part) => !part || part === '.' || part === '..')) {
    refuseCompanion('companion paths must be exact repository-relative paths, not aliases or patterns');
  }
  if (/[*?[\]{}]/.test(candidate)) refuseCompanion('companion path patterns are refused');
  assertNoSymlinkComponent(fs.realpathSync(root), path.resolve(root, candidate));
  return candidate;
}

function referencesTarget(content, candidate, skillName) {
  const prefix = `skills/${skillName}/`;
  // Parse ESM imports without linking or evaluating the consumer's code.
  const parser = `import fs from 'node:fs'; import vm from 'node:vm';
    const module = new vm.SourceTextModule(fs.readFileSync(0, 'utf8'));
    process.stdout.write(JSON.stringify(module.dependencySpecifiers));`;
  let references;
  try {
    references = JSON.parse(execFileSync(process.execPath,
      ['--experimental-vm-modules', '--input-type=module', '-e', parser],
      { input: content, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
  } catch (error) {
    if (typeof error.status === 'number') refuseCompanion('caller integration must be parseable ECMAScript module source');
    throw error;
  }
  return references.some((reference) => {
    if (!/^\.{1,2}\//.test(reference) || /[\\%?#\x00-\x20]/.test(reference)) return false;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(candidate), reference));
    return resolved.startsWith(prefix);
  });
}

function checkCompanions(root, skillName, changedPaths, companions, contents) {
  if (!Array.isArray(companions) || !(contents instanceof Map)) {
    refuseCompanion('companions must be an array and contents a Map of actual before/after bytes');
  }
  const checked = new Map();
  let derived;
  for (const entry of companions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).sort().join() !== [...COMPANION_FIELDS].sort().join()
        || COMPANION_FIELDS.some((field) => typeof entry[field] !== 'string' || !entry[field].trim())) {
      refuseCompanion('each companion requires exactly path, kind, reason, relationship and both SHA-256 digests');
    }
    const candidate = canonicalCompanionPath(root, entry.path);
    if (checked.has(candidate) || !changedPaths.includes(candidate)) {
      refuseCompanion(`duplicate or unused companion: ${candidate}`);
    }
    const writeClass = classifyWritePath(root, skillName, candidate);
    if (isWritableClass(writeClass) || /(^|\/)(?:AGENTS\.md|intent\.md)$/.test(candidate)
        || /^(?:doctrine|agents|scripts|\.github|\.skill-log|\.user)\//.test(candidate)
        || /^skills\/(?:roast|post-mortem)\//.test(candidate)
        || /^skills\/create-skill\/_atoms\/(?:roast-round-ledger|roast-remediation)\//.test(candidate)) {
      refuseCompanion(`protected or non-companion path: ${candidate}`);
    }
    const bytes = contents.get(candidate);
    if (!bytes || typeof bytes.previous !== 'string' || typeof bytes.next !== 'string'
        || bytes.previous === bytes.next
        || sha256(bytes.previous) !== entry.previous_sha256
        || sha256(bytes.next) !== entry.next_sha256) {
      refuseCompanion(`missing, created, deleted, unchanged or digest-mismatched companion: ${candidate}`);
    }
    if (entry.kind === 'changelog') {
      if (candidate !== 'CHANGELOG.md') refuseCompanion('only the existing root CHANGELOG.md is a changelog companion');
      // Existing release history must remain byte-for-byte and in order.
      const previous = bytes.previous.split('\n');
      const next = bytes.next.split('\n');
      let cursor = 0;
      for (const line of next) if (line === previous[cursor]) cursor += 1;
      if (cursor !== previous.length) refuseCompanion('a changelog companion may only insert lines');
    } else if (entry.kind === 'caller-integration') {
      if (writeClass !== WRITE_CLASS.foreignSkill || !candidate.endsWith('.mjs')
          || !referencesTarget(bytes.previous, candidate, skillName)
          || !referencesTarget(bytes.next, candidate, skillName)) {
        refuseCompanion(`caller integration requires an existing .mjs consumer referencing skills/${skillName}/ before and after`);
      }
    } else if (entry.kind === 'derived-graph') {
      const unit = candidate.match(/^skills\/([^/]+)\/(_atoms|_molecules)\/([^/]+)\/\3\.md$/);
      if (!unit || writeClass !== WRITE_CLASS.base) {
        refuseCompanion('derived companions must be existing shared unit Markdown, never a foreign local unit or skill grant');
      }
      derived ??= deriveGraph(root);
      const relative = candidate.slice('skills/'.length);
      if (derived.grantViolations.length || derived.updates.length
          || !derived.parsedByFile.has(relative)) {
        refuseCompanion('derived graph must validate, have no grant violations, and be current');
      }
      let expected = setFrontmatterField(bytes.previous, 'used-by', JSON.stringify(derived.usedBy.get(relative)));
      if (unit[2] === '_molecules') {
        expected = setFrontmatterField(expected, 'allowed-tools', JSON.stringify(derived.resolvedTools.get(relative)));
      }
      if (expected !== bytes.next) refuseCompanion('a derived companion changes authored bytes or is not the exact deriver output');
    } else {
      refuseCompanion(`unknown companion kind: ${entry.kind}`);
    }
    checked.set(candidate, { ...entry });
  }
  return checked;
}

const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const BASELINE_GUARD = 'skills/reinforce-skill/_atoms/reinforcement-target/reinforcement-target.mjs';
const gitAt = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const nulPaths = (text) => text.split('\0').filter(Boolean);
const samePaths = (a, b) => Array.isArray(a) && new Set(a).size === a.length
  && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

function requireCommit(root, value, label) {
  if (!COMMIT_ID.test(value ?? '')
    || gitAt(root, ['rev-parse', '--verify', `${value}^{commit}`]).trim() !== value) {
    throw new TargetError(FAILURES.invalidSnapshot, `${label} must be an exact commit ID, not a mutable ref`);
  }
}

/** Bind a final committed candidate to the base already recorded by the caller. */
export function captureAuditSnapshot(repositoryRoot, skillName, base, { selfReview } = {}) {
  resolveSkillTarget(repositoryRoot, skillName);
  const root = fs.realpathSync(repositoryRoot);
  requireCommit(root, base, 'recorded base');
  const head = gitAt(root, ['rev-parse', 'HEAD']).trim();
  if (base === head || gitAt(root, ['merge-base', base, head]).trim() !== base) {
    throw new TargetError(FAILURES.invalidSnapshot, 'the recorded base must precede the candidate');
  }
  return {
    version: 1, repositoryRoot: root, skill: skillName, base, head,
    tree: gitAt(root, ['rev-parse', `${head}^{tree}`]).trim(),
    ...(selfReview ? { selfReview } : {}),
  };
}

export function auditSnapshotDigest(snapshot) {
  return sha256(JSON.stringify(snapshot));
}

export function readAuditSnapshot(repositoryRoot, snapshotPath, expectedDigest) {
  const resolved = path.resolve(snapshotPath);
  assertNoSymlinkComponent(path.parse(resolved).root, resolved);
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size > 1024 * 1024) {
    throw new TargetError(FAILURES.invalidSnapshot, 'audit snapshot must be a bounded regular file');
  }
  const root = fs.realpathSync(repositoryRoot);
  const relative = path.relative(root, resolved);
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
    try {
      gitAt(root, ['check-ignore', '--quiet', '--', relative]);
    } catch (error) {
      if (error.status === 1) {
        throw new TargetError(FAILURES.invalidSnapshot, 'audit snapshots must be unpublished run state');
      }
      throw error;
    }
  }
  const snapshot = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (auditSnapshotDigest(snapshot) !== expectedDigest) {
    throw new TargetError(FAILURES.invalidSnapshot, 'audit snapshot does not match the caller-pinned digest');
  }
  return snapshot;
}

/** Execute the preserved guard and its imports from Git objects, never the edited guard on disk. */
export function captureBaselineAudit(repositoryRoot, skillName, base, head) {
  const root = fs.realpathSync(repositoryRoot);
  requireCommit(root, base, 'baseline guard revision');
  requireCommit(root, head, 'candidate revision');
  const changedPaths = nulPaths(gitAt(root, ['diff', '--no-renames', '--name-only', '-z', base, head, '--'])).sort();
  const runner = `
    import fs from 'node:fs';
    import path from 'node:path';
    import vm from 'node:vm';
    import { execFileSync } from 'node:child_process';
    import { pathToFileURL, fileURLToPath } from 'node:url';
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const git = args => execFileSync('git', ['-C', input.root, ...args], { encoding: 'utf8' });
    const cache = new Map();
    async function load(specifier, parent) {
      if (specifier.startsWith('node:')) {
        if (!cache.has(specifier)) {
          const value = await import(specifier);
          cache.set(specifier, new vm.SyntheticModule(Object.keys(value), function () {
            for (const name of Object.keys(value)) this.setExport(name, value[name]);
          }));
        }
        return cache.get(specifier);
      }
      const file = parent ? path.resolve(path.dirname(fileURLToPath(parent.identifier)), specifier)
        : path.resolve(input.root, specifier);
      const relative = path.relative(input.root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('baseline import escaped repository');
      const key = relative.split(path.sep).join('/');
      if (!cache.has(key)) {
        const module = new vm.SourceTextModule(git(['show', input.base + ':' + key]), {
          identifier: pathToFileURL(file).href,
          initializeImportMeta: meta => { meta.url = pathToFileURL(file).href; },
        });
        cache.set(key, module);
        await module.link(load);
      }
      return cache.get(key);
    }
    const guard = await load(input.guard);
    await guard.evaluate();
    const workflow = input.changedPaths.includes(input.workflow) ? {
      previous: git(['show', input.base + ':' + input.workflow]),
      next: git(['show', input.head + ':' + input.workflow]),
    } : undefined;
    process.stdout.write(JSON.stringify(guard.namespace.auditDiff(input.root, input.skill,
      input.changedPaths, { workflow })));
  `;
  const baselineAudit = JSON.parse(execFileSync(process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '-e', runner], {
      input: JSON.stringify({ root, skill: skillName, base, head, changedPaths,
        guard: BASELINE_GUARD, workflow: WORKFLOW_FILE }),
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    }));
  return {
    base, head,
    baselineGuardSha256: sha256(gitAt(root, ['show', `${base}:${BASELINE_GUARD}`])),
    baselineAudit,
    correctiveScope: changedPaths,
  };
}

function assertSelfReview(root, snapshot, changedPaths) {
  if (snapshot.skill !== 'reinforce-skill') return;
  const proof = snapshot.selfReview;
  const audit = proof?.baselineAudit;
  const guardDigest = sha256(gitAt(root, ['show', `${snapshot.base}:${BASELINE_GUARD}`]));
  if (!proof || proof.base !== snapshot.base || proof.head !== snapshot.head
    || proof.baselineGuardSha256 !== guardDigest
    || !samePaths(proof.correctiveScope, changedPaths)
    || !Array.isArray(audit?.classified) || !Array.isArray(audit?.refused)
    || !samePaths(audit.classified.map((entry) => entry.path), changedPaths)
    || audit.classified.some((entry) => typeof entry.writable !== 'boolean')
    || !samePaths(audit.refused.map((entry) => entry.path),
      audit.classified.filter((entry) => !entry.writable).map((entry) => entry.path))
    || audit.clean !== (audit.refused.length === 0 && audit.workflowViolation === null)) {
    throw new TargetError(FAILURES.invalidSnapshot,
      'self-reinforcement requires preserved baseline guard/audit evidence and exact corrective scope');
  }
  const reproduced = captureBaselineAudit(root, snapshot.skill, snapshot.base, snapshot.head);
  if (sha256(JSON.stringify(audit)) !== sha256(JSON.stringify(reproduced.baselineAudit))) {
    throw new TargetError(FAILURES.invalidSnapshot, 'preserved baseline audit does not reproduce from the original guard');
  }
}

/** Enumerate immutable candidate bytes; any staged, unstaged or untracked residue blocks publication. */
export function auditRepositoryDiff(repositoryRoot, skillName, base, {
  companions = [], snapshot, snapshotDigest,
} = {}) {
  resolveSkillTarget(repositoryRoot, skillName);
  const root = fs.realpathSync(repositoryRoot);
  const git = (args) => gitAt(root, args);
  requireCommit(root, base, 'recorded base');
  if (!snapshot || snapshot.version !== 1 || snapshot.repositoryRoot !== root
    || snapshot.skill !== skillName || snapshot.base !== base
    || auditSnapshotDigest(snapshot) !== snapshotDigest) {
    throw new TargetError(FAILURES.invalidSnapshot, 'a caller-pinned repository/target/base/head snapshot is required');
  }
  requireCommit(root, snapshot.head, 'reviewed head');
  if (base === snapshot.head || git(['merge-base', base, snapshot.head]).trim() !== base
    || git(['rev-parse', 'HEAD']).trim() !== snapshot.head
    || git(['rev-parse', `${snapshot.head}^{tree}`]).trim() !== snapshot.tree) {
    throw new TargetError(FAILURES.invalidSnapshot, 'recorded base, candidate or reviewed tree has drifted');
  }
  const changed = nulPaths(git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames',
    '--name-only', '-z', base, snapshot.head, '--']));
  const pendingPaths = [...new Set([
    ...nulPaths(git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--cached', '--name-only', '-z', '--'])),
    ...nulPaths(git(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z', '--'])),
    ...nulPaths(git(['ls-files', '--others', '--exclude-standard', '-z'])),
  ])].sort();
  const changedPaths = [...new Set([...changed, ...pendingPaths])].sort();
  const contents = new Map();
  const previousFiles = new Set(nulPaths(git(['ls-tree', '-r', '--name-only', '-z', base])));
  const candidateFiles = new Set(nulPaths(git(['ls-tree', '-r', '--name-only', '-z', snapshot.head])));
  for (const candidate of changedPaths) {
    assertNoSymlinkComponent(root, path.join(root, candidate));
    const previous = previousFiles.has(candidate) ? git(['show', `${base}:${candidate}`]) : null;
    const next = candidateFiles.has(candidate) ? git(['show', `${snapshot.head}:${candidate}`]) : null;
    contents.set(candidate, { previous, next });
  }
  assertSelfReview(root, snapshot, changed);
  const workflow = contents.get(WORKFLOW_FILE);
  const audit = auditDiff(root, skillName, changedPaths, { workflow, companions, contents });
  const drifted = git(['rev-parse', 'HEAD']).trim() !== snapshot.head
    || git(['status', '--porcelain', '--untracked-files=all']).length > 0;
  return {
    ...audit, base, head: snapshot.head, tree: snapshot.tree, snapshotDigest,
    baselineAudit: snapshot.selfReview?.baselineAudit ?? null,
    pendingPaths,
    snapshotViolation: pendingPaths.length || drifted ? 'candidate has uncommitted or changed state' : null,
    clean: audit.clean && pendingPaths.length === 0 && !drifted,
  };
}

function parseArguments(argv) {
  const args = {};
  const valueFlags = ['--root', '--skill', '--classify', '--audit', '--base', '--companions',
    '--snapshot', '--snapshot-digest', '--workflow-previous', '--workflow-next'];
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
  if ((args.companions || args.snapshot || args['snapshot-digest']) && !args.base) {
    throw new TargetError(FAILURES.usage, 'companions and snapshots require --base');
  }
  if (args.base) {
    if (args.audit || args.classify || args['workflow-previous'] || args['workflow-next']
      || !args.snapshot || !args['snapshot-digest']) {
      throw new TargetError(FAILURES.usage, '--base enumerates the actual diff; do not supply path or content overrides');
    }
    const companions = args.companions ? JSON.parse(fs.readFileSync(args.companions, 'utf8')) : [];
    const snapshot = readAuditSnapshot(args.root, args.snapshot, args['snapshot-digest']);
    const result = auditRepositoryDiff(args.root, args.skill, args.base,
      { companions, snapshot, snapshotDigest: args['snapshot-digest'] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.clean ? 0 : 2;
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

export { FAILURES, SKILL_NAME as SKILL_NAME_PATTERN, WORKFLOW_FILE };
