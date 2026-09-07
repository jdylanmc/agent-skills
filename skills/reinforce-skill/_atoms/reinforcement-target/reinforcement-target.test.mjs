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
import { createHash } from 'node:crypto';
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
  auditRepositoryDiff,
  auditSnapshotDigest,
  captureAuditSnapshot,
  captureBaselineAudit,
  classifyWritePath,
  isWritableClass,
  resolveSkillTarget,
} from './reinforcement-target.mjs';
import { assertReinforcementChangeSet } from '../reinforce-roast/reinforce-roast.mjs';

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
    fs.writeFileSync(path.join(root, '.gitignore'), '.skill-log/\n');
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

test('workflow proof preserves exact order and multiplicity and rejects shell-shaped registrations', () => {
  const previous = 'run: node scripts/run-registered-tests.mjs\n  skills/a/a.test.mjs\n  skills/b/b.test.mjs\n';
  const invalid = [
    previous.replace('  skills/a/a.test.mjs\n', ''),
    previous.replace('  skills/a/a.test.mjs\n  skills/b/b.test.mjs\n', '  skills/b/b.test.mjs\n  skills/a/a.test.mjs\n'),
    `${previous}  skills/a/a.test.mjs\n`,
    ...['#disabled.test.mjs', ';exit.test.mjs', '../outside.test.mjs', '/tmp/x.test.mjs',
      'skills/a/../b/new.test.mjs', 'skills/a/*.test.mjs', '--flag.test.mjs']
      .map((entry) => `${previous}  ${entry}\n`),
    `${previous}    skills/a/new.test.mjs\n`,
    previous.replace('run:', 'run: '),
  ];
  for (const next of invalid) {
    assert.equal(code(() => assertWorkflowAdditive(previous, next)), FAILURES.workflowNotAdditive);
  }
  assert.equal(assertWorkflowAdditive(previous,
    previous.replace('  skills/b/b.test.mjs', '  skills/a/new.test.mjs\n  skills/b/b.test.mjs')).status, 'additive');
  const notARun = 'description: >-\n  node scripts/run-registered-tests.mjs\n  skills/a/a.test.mjs\n';
  assert.equal(code(() => assertWorkflowAdditive(notARun,
    `${notARun}  skills/a/new.test.mjs\n`)), FAILURES.workflowNotAdditive);
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

  function companion(candidate, kind, previous, next, overrides = {}) {
    const digest = (text) => createHash('sha256').update(text).digest('hex');
    return {
      path: candidate, kind,
      reason: 'Necessary to complete this one target change.',
      relationship: 'Existing caller or metadata for the target contract.',
      previous_sha256: digest(previous), next_sha256: digest(next),
      ...overrides,
    };
  }

  function companionOptions(entry, previous, next) {
    return { companions: [entry], contents: new Map([[entry.path, { previous, next }]]) };
  }

  test('an exact changelog companion completes one change without relabelling outside scope', () => {
    withFixture((root) => {
      const previous = '# Changelog\n\n## Unreleased\n';
      const next = `${previous}\n- Reinforced the target.\n`;
      const entry = companion('CHANGELOG.md', 'changelog', previous, next);
      const paths = ['skills/existing-skill/SKILL.md', entry.path];
      assert.equal(auditDiff(root, 'existing-skill', paths).clean, false);
      const options = companionOptions(entry, previous, next);
      const audit = auditDiff(root, 'existing-skill', paths, options);
      assert.equal(audit.clean, true);
      assert.equal(audit.companions[0].writeClass, WRITE_CLASS.outside);
      assert.deepEqual(audit.companions[0].companion, entry);
      assert.equal(isWritableClass(WRITE_CLASS.outside), false);
      assert.equal(assertReinforcementChangeSet(root, 'existing-skill', paths, options).status, 'intact');
    });
  });

  test('a caller fixture can conform to a stricter target while unrelated foreign edits stay refused', () => {
    withFixture((root) => {
      const candidate = 'skills/caller/caller.conformance.test.mjs';
      const previous = "import { ready } from '../existing-skill/readiness.mjs';\nconst fixture = {};\n";
      const next = previous.replace('{}', '{ current: true }');
      const entry = companion(candidate, 'caller-integration', previous, next);
      const options = companionOptions(entry, previous, next);
      const audit = auditDiff(root, 'existing-skill', [candidate], options);
      assert.equal(audit.clean, true);
      assert.equal(audit.companions[0].writeClass, WRITE_CLASS.foreignSkill);
      assert.equal(assertReinforcementChangeSet(root, 'existing-skill', [candidate], options).status, 'intact');
      const extra = auditDiff(root, 'existing-skill', [candidate, 'skills/other/SKILL.md'], options);
      assert.equal(extra.clean, false);
      assert.deepEqual(extra.refused.map((item) => item.path), ['skills/other/SKILL.md']);
    });
  });

  test('caller relationships are parsed ESM imports, not comments, arbitrary strings or traversals', () => {
    withFixture((root) => {
      const candidate = 'skills/caller/caller.test.mjs';
      for (const previous of [
        "// import '../existing-skill/x.mjs';\n",
        "const documentation = \"import '../existing-skill/x.mjs';\";\n",
        "const example = /import '..\\/existing-skill\\/x.mjs'/;\n",
        "import 'skills/existing-skill/../../outside.mjs';\n",
        "import '../existing-skill/../caller/x.mjs';\n",
        "import('../existing-skill/x.mjs');\n",
      ]) {
        const next = `${previous}const changed = true;\n`;
        assert.equal(code(() => auditDiff(root, 'existing-skill', [candidate],
          companionOptions(companion(candidate, 'caller-integration', previous, next), previous, next))),
        FAILURES.invalidCompanion);
      }
      const previous = "import '../existing-skill/x.mjs';\nthrow new Error('not evaluated');\n";
      const next = `${previous}export const changed = true;\n`;
      assert.equal(auditDiff(root, 'existing-skill', [candidate],
        companionOptions(companion(candidate, 'caller-integration', previous, next), previous, next)).clean, true);
    });
  });

  test('companion records refuse omissions, inventions, stale bytes and duplicate or unused paths', () => {
    withFixture((root) => {
      const previous = '# Changelog\n';
      const next = `${previous}- Entry.\n`;
      const entry = companion('CHANGELOG.md', 'changelog', previous, next);
      for (const mutation of [
        { reason: '' }, { relationship: '' }, { kind: 'anything' },
        { previous_sha256: '0'.repeat(64) }, { next_sha256: '0'.repeat(64) },
        { approved: true }, { path: '../CHANGELOG.md' }, { path: './CHANGELOG.md' },
        { path: '/CHANGELOG.md' }, { path: 'CHANGELOG*.md' },
        { path: 'skills\\caller\\caller.test.mjs' },
      ]) {
        const changed = { ...entry, ...mutation };
        assert.equal(code(() => auditDiff(root, 'existing-skill', [changed.path],
          companionOptions(changed, previous, next))), FAILURES.invalidCompanion);
      }
      for (const bytes of [
        undefined, { previous: null, next }, { previous, next: null },
        { previous, next: `${next}drift` }, { previous: next, next },
      ]) {
        assert.equal(code(() => auditDiff(root, 'existing-skill', [entry.path], {
          companions: [entry], contents: new Map([[entry.path, bytes]]),
        })), FAILURES.invalidCompanion);
      }
      assert.equal(code(() => auditDiff(root, 'existing-skill', [entry.path], {
        ...companionOptions(entry, previous, next), companions: [entry, entry],
      })), FAILURES.invalidCompanion);
      assert.equal(code(() => auditDiff(root, 'existing-skill', [],
        companionOptions(entry, previous, next))), FAILURES.invalidCompanion);
    });
  });

  test('a companion cannot rewrite release history or remove the caller relationship', () => {
    withFixture((root) => {
      for (const [candidate, kind, previous, next] of [
        ['CHANGELOG.md', 'changelog', '# History\nold\n', '# History\nreplacement\n'],
        ['CHANGELOG.md', 'changelog', '# History\none\ntwo\n', '# History\ntwo\none\n'],
        ['README.md', 'changelog', '# Readme\n', '# Readme\naddition\n'],
        ['skills/caller/caller.test.mjs', 'caller-integration', 'const x = 1;\n', 'const x = 2;\n'],
        ['skills/caller/caller.test.mjs', 'caller-integration', "import '../existing-skill/x.mjs';\n", 'const x = 2;\n'],
        ['skills/caller/SKILL.md', 'caller-integration', "'skills/existing-skill/x.mjs'\n", "'skills/existing-skill/x.mjs'\nnew\n"],
      ]) {
        const entry = companion(candidate, kind, previous, next);
        assert.equal(code(() => auditDiff(root, 'existing-skill', [candidate],
          companionOptions(entry, previous, next))), FAILURES.invalidCompanion);
      }
    });
  });

  test('a justified ledger never permits doctrine, grants, evidence, reviewers or gate edits', () => {
    withFixture((root) => {
      const previous = "'skills/existing-skill/SKILL.md'\n";
      const next = `${previous}addition\n`;
      for (const candidate of [
        'doctrine/code.doctrine.md', 'AGENTS.md', 'skills/caller/AGENTS.md',
        'skills/caller/intent.md', 'skills/caller/SKILL.md',
        '.skill-log/evidence.mjs', '.github/workflows/validate-skills.yml',
        'scripts/validate-skill-graph.mjs', 'agents/skill-reviewer.agent.md',
        'skills/roast/roast.test.mjs', 'skills/post-mortem/record.mjs',
        'skills/create-skill/_atoms/roast-round-ledger/roast-round-ledger.mjs',
        'skills/_base/_atoms/x/x.mjs',
      ]) {
        const entry = companion(candidate, 'caller-integration', previous, next);
        assert.equal(code(() => auditDiff(root, 'existing-skill', [candidate],
          companionOptions(entry, previous, next))), FAILURES.invalidCompanion, candidate);
      }
    });
  });

  test('derived companions admit exact generated fields and refuse authored text or atom grants', () => {
    const candidate = 'skills/_base/_molecules/chronicler/chronicler.md';
    const next = fs.readFileSync(path.join(REPOSITORY_ROOT, candidate), 'utf8');
    const previous = next.replace(/^used-by: .+$/m, 'used-by: []');
    const entry = companion(candidate, 'derived-graph', previous, next);
    assert.equal(auditDiff(REPOSITORY_ROOT, 'reinforce-skill', [candidate],
      companionOptions(entry, previous, next)).clean, true);
    const changedProse = previous.replace('# Chronicler', '# Changed prose');
    const forged = companion(candidate, 'derived-graph', changedProse, next);
    assert.equal(code(() => auditDiff(REPOSITORY_ROOT, 'reinforce-skill', [candidate],
      companionOptions(forged, changedProse, next))), FAILURES.invalidCompanion);
    const atom = 'skills/_base/_atoms/chronicle-append/chronicle-append.md';
    const atomNext = fs.readFileSync(path.join(REPOSITORY_ROOT, atom), 'utf8');
    const atomPrevious = atomNext.replace('allowed-tools: ["execute"]', 'allowed-tools: ["read"]');
    assert.equal(code(() => auditDiff(REPOSITORY_ROOT, 'reinforce-skill', [atom],
      companionOptions(companion(atom, 'derived-graph', atomPrevious, atomNext), atomPrevious, atomNext))),
    FAILURES.invalidCompanion);
    const foreign = 'skills/caller/_atoms/core/core.md';
    assert.equal(code(() => auditDiff(REPOSITORY_ROOT, 'reinforce-skill', [foreign],
      companionOptions(companion(foreign, 'derived-graph', previous, next), previous, next))),
    FAILURES.invalidCompanion);
  });

  function git(root, ...args) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }

  test('repository audit enumerates committed, staged, unstaged, untracked and renamed paths', () => {
    withFixture((root) => {
      git(root, 'init', '-q');
      const previous = '# Changelog\n';
      const next = `${previous}- Target change.\n`;
      fs.writeFileSync(path.join(root, 'CHANGELOG.md'), previous);
      git(root, 'add', '.');
      git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'base');
      const base = git(root, 'rev-parse', 'HEAD');
      fs.appendFileSync(path.join(root, 'skills/existing-skill/SKILL.md'), 'committed\n');
      git(root, 'add', '.');
      git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'target');
      fs.writeFileSync(path.join(root, 'CHANGELOG.md'), next);
      const entry = companion('CHANGELOG.md', 'changelog', previous, next);
      git(root, 'add', '.');
      git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'changelog');
      const snapshot = captureAuditSnapshot(root, 'existing-skill', base);
      const options = { companions: [entry], snapshot, snapshotDigest: auditSnapshotDigest(snapshot) };
      assert.equal(auditRepositoryDiff(root, 'existing-skill', base, options).clean, true);
      const untrackedPath = process.platform === 'win32' ? 'untracked file.md' : 'untracked\nfile.md';
      fs.writeFileSync(path.join(root, untrackedPath), 'untracked');
      git(root, 'mv', 'skills/existing-skill/intent.md', 'foreign-intent.md');
      const audit = auditRepositoryDiff(root, 'existing-skill', base, options);
      assert.equal(audit.clean, false);
      assert.deepEqual(audit.classified.map((item) => item.path), [
        'CHANGELOG.md', 'foreign-intent.md', 'skills/existing-skill/SKILL.md',
        'skills/existing-skill/intent.md', untrackedPath,
      ]);
      fs.appendFileSync(path.join(root, 'CHANGELOG.md'), 'unrecorded drift\n');
      assert.equal(auditRepositoryDiff(root, 'existing-skill', base, options).clean, false);
      assert.equal(code(() => auditRepositoryDiff(root, 'existing-skill', base, {
        ...options, companions: [{ ...entry, next_sha256: '0'.repeat(64) }],
      })), FAILURES.invalidCompanion);
    });
  });

  test('repository CLI accepts only exact actual-diff companions and rejects path overrides', () => {
    withFixture((root) => {
      git(root, 'init', '-q');
      git(root, 'add', '.');
      git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'base');
      for (const args of [
        ['--companions', 'ledger.json'],
        ['--base', 'HEAD', '--audit', 'skills/existing-skill/SKILL.md'],
        ['--base', 'HEAD', '--workflow-previous', 'fake'],
        ['--base', 'HEAD', '--base', 'HEAD'],
      ]) {
        const result = spawnSync(process.execPath, [CLI, '--root', root, '--skill', 'existing-skill', ...args],
          { encoding: 'utf8' });
        assert.equal(result.status, 1, result.stdout);
      }
      const base = git(root, 'rev-parse', 'HEAD');
      assert.equal(code(() => captureAuditSnapshot(root, 'existing-skill', base)), FAILURES.invalidSnapshot);
      fs.appendFileSync(path.join(root, 'skills/existing-skill/SKILL.md'), 'change\n');
      git(root, 'add', '.');
      git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'candidate');
      const snapshot = captureAuditSnapshot(root, 'existing-skill', base);
      fs.mkdirSync(path.join(root, '.skill-log'));
      const snapshotPath = path.join(root, '.skill-log/snapshot.json');
      fs.writeFileSync(snapshotPath, JSON.stringify(snapshot));
      const args = [CLI, '--root', root, '--skill', 'existing-skill', '--base', base,
        '--snapshot', snapshotPath, '--snapshot-digest', auditSnapshotDigest(snapshot)];
      const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).clean, true);
      fs.writeFileSync(path.join(root, 'extra.md'), 'extra\n');
      const refused = spawnSync(process.execPath, args, { encoding: 'utf8' });
      assert.equal(refused.status, 2);
    });
  });

  test('publication snapshots refuse rebinding, hidden index changes and later candidate drift', () => {
      withFixture((root) => {
        git(root, 'init', '-q');
        git(root, 'add', '.');
        git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'base');
        const base = git(root, 'rev-parse', 'HEAD');
        const file = path.join(root, 'skills/existing-skill/SKILL.md');
        fs.appendFileSync(file, 'candidate\n');
        git(root, 'add', '.');
        git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'candidate');
        const snapshot = captureAuditSnapshot(root, 'existing-skill', base);
        const options = { snapshot, snapshotDigest: auditSnapshotDigest(snapshot) };
        assert.equal(code(() => auditRepositoryDiff(root, 'existing-skill', base)), FAILURES.invalidSnapshot);
        assert.equal(code(() => auditRepositoryDiff(root, 'existing-skill', 'HEAD', options)), FAILURES.invalidSnapshot);
        assert.equal(code(() => auditRepositoryDiff(root, 'existing-skill', base,
          { ...options, snapshot: { ...snapshot, tree: '0'.repeat(40) } })), FAILURES.invalidSnapshot);
        const original = fs.readFileSync(file, 'utf8');
        fs.appendFileSync(file, 'staged change\n');
        git(root, 'add', '.');
        fs.writeFileSync(file, original);
        const audit = auditRepositoryDiff(root, 'existing-skill', base, options);
        assert.equal(audit.clean, false, 'a matching worktree cannot conceal a different index');
        assert.deepEqual(audit.pendingPaths, ['skills/existing-skill/SKILL.md']);
        git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'later head');
        assert.equal(code(() => auditRepositoryDiff(root, 'existing-skill', base, options)), FAILURES.invalidSnapshot);
      });
    });

  test('self-reinforcement reproduces baseline guard evidence instead of trusting the changed guard', () => {
      withFixture((root) => {
        const unit = 'skills/reinforce-skill/_atoms/reinforcement-target';
        fs.mkdirSync(path.join(root, unit), { recursive: true });
        fs.writeFileSync(path.join(root, 'skills/reinforce-skill/SKILL.md'), '# Skill\n');
        const guard = path.join(root, unit, 'reinforcement-target.mjs');
        fs.writeFileSync(guard, `import { classify } from './reinforcement-target.rule.mjs';
          export function auditDiff(root, skill, paths) {
            const classified = paths.map(classify);
            const refused = classified.filter(item => !item.writable);
            return { classified, refused, workflow: [], workflowViolation: null, clean: refused.length === 0 };
          }`);
        fs.writeFileSync(path.join(root, unit, 'reinforcement-target.rule.mjs'),
          `export const classify = path => ({ path, writeClass: path === 'CHANGELOG.md' ? 'outside' : 'in-target',
            writable: path !== 'CHANGELOG.md' });`);
        const previous = '# Changelog\n';
        const next = `${previous}- Target change.\n`;
        fs.writeFileSync(path.join(root, 'CHANGELOG.md'), previous);
        git(root, 'init', '-q');
        git(root, 'add', '.');
        git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'base');
        const base = git(root, 'rev-parse', 'HEAD');
        fs.writeFileSync(guard, 'export const auditDiff = () => ({ clean: true });\n');
        fs.writeFileSync(path.join(root, 'CHANGELOG.md'), next);
        git(root, 'add', '.');
        git(root, '-c', 'user.name=Fixture', '-c', 'user.email=test-identity', 'commit', '-qm', 'candidate');
        const head = git(root, 'rev-parse', 'HEAD');
        const proof = captureBaselineAudit(root, 'reinforce-skill', base, head);
        assert.equal(proof.baselineAudit.clean, false, 'the edited always-clean guard is never executed');
        const snapshot = captureAuditSnapshot(root, 'reinforce-skill', base, { selfReview: proof });
        const options = { snapshot, snapshotDigest: auditSnapshotDigest(snapshot),
          companions: [companion('CHANGELOG.md', 'changelog', previous, next)] };
        const audit = auditRepositoryDiff(root, 'reinforce-skill', base, options);
        assert.equal(audit.clean, true);
        assert.equal(audit.baselineAudit.clean, false, 'baseline refusal is preserved, not relabelled');
        for (const selfReview of [
          undefined, { ...proof, baselineGuardSha256: '0'.repeat(64) },
          { ...proof, correctiveScope: [] },
          { ...proof, baselineAudit: { ...proof.baselineAudit, clean: true, refused: [],
            classified: proof.baselineAudit.classified.map(entry => ({ ...entry, writable: true })) } },
        ]) {
          const changed = { ...snapshot, selfReview };
          assert.equal(code(() => auditRepositoryDiff(root, 'reinforce-skill', base, {
            ...options, snapshot: changed, snapshotDigest: auditSnapshotDigest(changed),
          })), FAILURES.invalidSnapshot);
        }
      });
    });

  test('companions cannot write through symlinks, even into the target', (t) => {
    if (os.platform() === 'win32') return t.skip('symlinks need Windows privileges');
    withFixture((root) => {
      fs.symlinkSync(path.join(root, 'skills/existing-skill/SKILL.md'), path.join(root, 'CHANGELOG.md'));
      const previous = '# skill\n';
      const next = `${previous}new\n`;
      const entry = companion('CHANGELOG.md', 'changelog', previous, next);
      assert.equal(code(() => auditDiff(root, 'existing-skill', [entry.path],
        companionOptions(entry, previous, next))), FAILURES.symlinkComponent);
    });
  });
