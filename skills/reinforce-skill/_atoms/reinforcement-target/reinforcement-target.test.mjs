/**
 * Adversarial tests for the reinforce-skill write-boundary guard.
 *
 * These cover the cases where a boundary defended only by prose has failed in
 * this repository before: a target that does not exist, `_base`, traversal, a
 * symlinked component, and the doctrine and foreign-skill paths whose refusal
 * is the whole point of the guard. If any of these regress, the `edit` grant is
 * no longer bounded to one existing skill.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  FAILURES,
  WORKFLOW_FILE,
  WRITE_CLASS,
  assertWorkflowAdditive,
  auditDiff,
  classifyWritePath,
  isWritableClass,
  resolveSkillTarget,
} from './reinforcement-target.mjs';

const CLI = fileURLToPath(new URL('./reinforcement-target.mjs', import.meta.url));

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..',
);

/**
 * Build a throwaway repository skeleton inside the repository working tree so
 * symlink and containment cases are exercised without ever touching /tmp.
 */
function withFixture(run) {
  const root = fs.mkdtempSync(path.join(REPOSITORY_ROOT, '.reinforce-fixture-'));
  try {
    fs.mkdirSync(path.join(root, 'skills', 'existing-skill'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'existing-skill', 'SKILL.md'), '# skill\n');
    fs.writeFileSync(path.join(root, 'skills', 'existing-skill', 'intent.md'), '# Intent: existing-skill\n');
    fs.mkdirSync(path.join(root, 'skills', 'no-skill-md'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', '_base', '_atoms'), { recursive: true });
    fs.mkdirSync(path.join(root, 'doctrine'), { recursive: true });
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function code(fn) {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

test('an existing routable skill resolves', () => {
  withFixture((root) => {
    const resolved = resolveSkillTarget(root, 'existing-skill');
    assert.equal(resolved.skillName, 'existing-skill');
    assert.equal(resolved.relativePath, 'skills/existing-skill');
    assert.equal(resolved.exists, true);
    assert.equal(resolved.hasIntent, true);
    assert.equal(resolved.hasSkillMd, true);
  });
});

test('a missing skill is refused, because creating one is create-skill\'s job', () => {
  withFixture((root) => {
    assert.equal(code(() => resolveSkillTarget(root, 'does-not-exist')), FAILURES.notASkill);
  });
});

test('a directory without SKILL.md is not a routable skill', () => {
  withFixture((root) => {
    assert.equal(code(() => resolveSkillTarget(root, 'no-skill-md')), FAILURES.notASkill);
  });
});

test('_base is refused as a target', () => {
  withFixture((root) => {
    assert.equal(code(() => resolveSkillTarget(root, '_base')), FAILURES.invalidName);
  });
});

test('traversal and nested names are refused as malformed', () => {
  withFixture((root) => {
    for (const name of ['../secrets', 'a/b', './x', 'Foo', 'has space', '', 'ends-']) {
      const c = code(() => resolveSkillTarget(root, name));
      assert.ok(
        c === FAILURES.invalidName || c === FAILURES.usage,
        `${JSON.stringify(name)} should be refused, got ${c}`,
      );
    }
  });
});

test('a symlinked skill directory is refused', (t) => {
  if (os.platform() === 'win32') {
    t.skip('symlink creation is unreliable without privilege on Windows');
    return;
  }
  withFixture((root) => {
    const outside = fs.mkdtempSync(path.join(REPOSITORY_ROOT, '.reinforce-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'SKILL.md'), '# skill\n');
      fs.symlinkSync(outside, path.join(root, 'skills', 'linked-skill'));
      assert.equal(code(() => resolveSkillTarget(root, 'linked-skill')), FAILURES.symlinkComponent);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('write paths classify exhaustively into exactly one class each', () => {
  withFixture((root) => {
    const cases = [
      ['skills/existing-skill/SKILL.md', WRITE_CLASS.inTarget],
      ['skills/existing-skill/_atoms/x/x.md', WRITE_CLASS.inTarget],
      [WORKFLOW_FILE, WRITE_CLASS.workflow],
      ['doctrine/testing.doctrine.md', WRITE_CLASS.doctrine],
      ['doctrine/manifest.md', WRITE_CLASS.doctrine],
      ['skills/_base/_atoms/x/x.md', WRITE_CLASS.base],
      ['skills/other-skill/SKILL.md', WRITE_CLASS.foreignSkill],
      ['README.md', WRITE_CLASS.outside],
      ['../escape.md', WRITE_CLASS.outside],
      ['/etc/passwd', WRITE_CLASS.outside],
    ];
    for (const [candidate, expected] of cases) {
      assert.equal(
        classifyWritePath(root, 'existing-skill', candidate),
        expected,
        `${candidate} should classify as ${expected}`,
      );
    }
  });
});

test('only in-target and the workflow file are writable', () => {
  assert.equal(isWritableClass(WRITE_CLASS.inTarget), true);
  assert.equal(isWritableClass(WRITE_CLASS.workflow), true);
  for (const refused of [WRITE_CLASS.doctrine, WRITE_CLASS.base, WRITE_CLASS.foreignSkill, WRITE_CLASS.outside]) {
    assert.equal(isWritableClass(refused), false, `${refused} must not be writable`);
  }
});

test('doctrine is never writable under any skill name', () => {
  withFixture((root) => {
    // Even if a caller names the target "doctrine"-adjacent, a doctrine path
    // still classifies as doctrine and stays refused.
    assert.equal(
      classifyWritePath(root, 'existing-skill', 'doctrine/testing.doctrine.md'),
      WRITE_CLASS.doctrine,
    );
    assert.equal(isWritableClass(WRITE_CLASS.doctrine), false);
  });
});

test('a symlinked in-target leaf is resolved and refused, not classified in-target', (t) => {
  if (os.platform() === 'win32') {
    t.skip('symlink creation is unreliable without privilege on Windows');
    return;
  }
  withFixture((root) => {
    const outside = fs.mkdtempSync(path.join(REPOSITORY_ROOT, '.reinforce-outside-'));
    try {
      fs.writeFileSync(path.join(outside, 'escape.md'), 'x\n');
      // A path that is lexically inside the target but whose parent is a symlink
      // pointing out of the repository must not classify as in-target.
      fs.symlinkSync(outside, path.join(root, 'skills', 'existing-skill', 'linked'));
      const writeClass = classifyWritePath(root, 'existing-skill', 'skills/existing-skill/linked/escape.md');
      assert.notEqual(writeClass, WRITE_CLASS.inTarget, 'a symlink escape must not read as in-target');
      assert.equal(isWritableClass(writeClass), false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
});

test('a diff audit refuses any out-of-target path and reports workflow edits separately', () => {
  withFixture((root) => {
    const workflowContent = [
      'run: node scripts/run-registered-tests.mjs',
      '  skills/existing-skill/existing-skill.test.mjs',
      '',
    ].join('\n');
    const clean = auditDiff(root, 'existing-skill', [
      'skills/existing-skill/SKILL.md',
      'skills/existing-skill/intent.md',
      WORKFLOW_FILE,
    ], {
      workflow: {
        previous: workflowContent,
        next: `${workflowContent}  skills/existing-skill/added.test.mjs\n`,
      },
    });
    assert.equal(clean.clean, true, 'an all-in-target-plus-proven-additive-workflow diff is clean');
    assert.equal(clean.refused.length, 0);
    assert.equal(clean.workflow.length, 1, 'the workflow edit is surfaced separately');

    const dirty = auditDiff(root, 'existing-skill', [
      'skills/existing-skill/SKILL.md',
      'doctrine/testing.doctrine.md',
      'skills/other-skill/SKILL.md',
      'AGENTS.md',
    ]);
    assert.equal(dirty.clean, false, 'a diff touching doctrine, a foreign skill, or root is not clean');
    assert.deepEqual(
      dirty.refused.map((entry) => entry.writeClass).sort(),
      [WRITE_CLASS.doctrine, WRITE_CLASS.foreignSkill, WRITE_CLASS.outside].sort(),
    );
  });
});

test('a workflow edit with no before/after content is refused, not waved through', () => {
  withFixture((root) => {
    const unproven = auditDiff(root, 'existing-skill', [
      'skills/existing-skill/SKILL.md',
      WORKFLOW_FILE,
    ]);
    assert.equal(unproven.clean, false, 'an unproven workflow edit fails closed');
    assert.ok(unproven.workflowViolation, 'the unproven workflow edit is surfaced');
    assert.match(unproven.workflowViolation.message, /cannot be proven/);
  });
});

test('assertWorkflowAdditive refuses weakening by addition and removal (finding 5)', () => {
  const previous = [
    'jobs:',
    '  test:',
    '    run: node scripts/run-registered-tests.mjs',
    '      skills/roast/roast.test.mjs',
    '',
  ].join('\n');

  // Appending a registration is permitted.
  const appended = `${previous}      skills/existing-skill/existing-skill.test.mjs\n`;
  assert.deepEqual(assertWorkflowAdditive(previous, appended), { status: 'additive', removed: [], added: [] });

  // Removing a registration is refused.
  const removed = previous.replace('      skills/roast/roast.test.mjs\n', '');
  assert.equal(code(() => assertWorkflowAdditive(previous, removed)), FAILURES.workflowNotAdditive);

  // Adding a non-registration line — disabling the job — removes nothing and
  // once passed a removal-only check. The positive bound refuses it.
  const disabled = previous.replace('  test:\n', '  test:\n    if: false\n');
  assert.equal(
    code(() => assertWorkflowAdditive(previous, disabled)),
    FAILURES.workflowNotAdditive,
    'adding if: false is refused even though it removes nothing',
  );

  // Re-indenting a registration into a different job changes its exact line, so
  // the old line disappears (a removal) and the new indent is refused too.
  const moved = previous.replace(
    '      skills/roast/roast.test.mjs',
    '        skills/roast/roast.test.mjs',
  );
  assert.equal(
    code(() => assertWorkflowAdditive(previous, moved)),
    FAILURES.workflowNotAdditive,
    'a re-indented registration is refused',
  );
});

test('the audit CLI exits 2 on refusal and 0 when clean (finding 3)', () => {
  const refuse = spawnSync(
    process.execPath,
    [
      CLI,
      '--root', REPOSITORY_ROOT,
      '--skill', 'existing-skill',
      '--audit', 'doctrine/code.doctrine.md,skills/existing-skill/SKILL.md',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(refuse.status, 2, 'an out-of-target audit exits 2');
  assert.match(refuse.stdout, /"clean": false/);

  const ok = spawnSync(
    process.execPath,
    [CLI, '--root', REPOSITORY_ROOT, '--skill', 'existing-skill', '--audit', 'skills/existing-skill/SKILL.md'],
    { encoding: 'utf8' },
  );
  assert.equal(ok.status, 0, 'a clean audit exits 0');
  assert.match(ok.stdout, /"clean": true/);
});

test('the audit CLI reaches the workflow-additive check through --workflow-* flags (finding 4)', () => {
  const dir = fs.mkdtempSync(path.join(REPOSITORY_ROOT, '.reinforce-cli-fixture-'));
  try {
    const previous = [
      'run: node scripts/run-registered-tests.mjs',
      '  skills/existing-skill/existing-skill.test.mjs',
      '',
    ].join('\n');
    const previousPath = path.join(dir, 'previous.yml');
    const nextPath = path.join(dir, 'next.yml');
    fs.writeFileSync(previousPath, previous);
    // A next that weakens the job by addition must drive the CLI to exit 2.
    fs.writeFileSync(nextPath, previous.replace('run:', 'if: false\nrun:'));
    const weakened = spawnSync(
      process.execPath,
      [
        CLI, '--root', REPOSITORY_ROOT, '--skill', 'existing-skill',
        '--audit', WORKFLOW_FILE,
        '--workflow-previous', previousPath,
        '--workflow-next', nextPath,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(weakened.status, 2, 'a weakening workflow edit exits 2 through the CLI');
    assert.match(weakened.stdout, /"clean": false/);

    // Supplying only one of the pair is a usage error.
    const half = spawnSync(
      process.execPath,
      [
        CLI, '--root', REPOSITORY_ROOT, '--skill', 'existing-skill',
        '--audit', WORKFLOW_FILE, '--workflow-previous', previousPath,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(half.status, 1);
    assert.match(half.stderr, /supplied together/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a repeated flag is refused by the audit CLI (finding 8)', () => {
  const dup = spawnSync(
    process.execPath,
    [CLI, '--root', REPOSITORY_ROOT, '--skill', 'roast', '--skill', 'existing-skill'],
    { encoding: 'utf8' },
  );
  assert.equal(dup.status, 1, 'a duplicated flag is refused, not last-wins');
  assert.match(dup.stderr, /--skill was given more than once/);
});

test('the diff audit rejects a non-array change set', () => {
  withFixture((root) => {
    assert.equal(code(() => auditDiff(root, 'existing-skill', 'not-an-array')), FAILURES.usage);
  });
});
