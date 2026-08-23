import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closureFor, validateRepository } from './validate-skill-graph.mjs';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-graph-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.join(root, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }
  return root;
}

function participating(includes, body, requiresSkills = []) {
  return `---\nincludes: ${JSON.stringify(includes)}\nrequires-skills: ${JSON.stringify(requiresSkills)}\n---\n\n${body}`;
}

test('validates mirrored includes and deterministic closure', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['_base/common/BASE.md', 'example/references/a.md'],
      '# Example\n\n## Required References\n\n1. [Base](../_base/common/BASE.md)\n2. [A](./references/a.md)\n',
    ),
    'skills/example/references/a.md': participating([], '# A\n'),
    'skills/_base/common/BASE.md': participating([], '# Base\n'),
  });
  const result = validateRepository(root);
  assert.deepEqual(closureFor(result, 'example/SKILL.md'), [
    'example/SKILL.md',
    '_base/common/BASE.md',
    'example/references/a.md',
  ]);
  assert.deepEqual(result.routableSkills, ['example']);
});

test('rejects include mirror drift', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating([], '# Example\n\n## Required References\n\n1. [A](./a.md)\n'),
    'skills/example/a.md': participating([], '# A\n'),
  });
  assert.throws(() => validateRepository(root), /includes mirror drift/);
});

test('rejects root escape before resolution', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['outside.md'],
      '# Example\n\n## Required References\n\n1. [Outside](../../outside.md)\n',
    ),
    'outside.md': '# Outside\n',
  });
  assert.throws(() => validateRepository(root), /escapes the skills root/);
});

test('rejects cycles', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example/a.md'],
      '# Example\n\n## Required References\n\n1. [A](./a.md)\n',
    ),
    'skills/example/a.md': participating(
      ['example/SKILL.md'],
      '# A\n\n## Required Files\n\n1. [Entry](./SKILL.md)\n',
    ),
  });
  assert.throws(() => validateRepository(root), /include cycle/);
});

test('allows external dependencies and rejects unresolved local dependencies', (t) => {
  const externalRoot = fixture(t, {
    'skills/example/SKILL.md': participating(
      [],
      '# Example\n',
      [{ id: 'handoff', source: 'external', required: true }],
    ),
  });
  assert.doesNotThrow(() => validateRepository(externalRoot));

  const localRoot = fixture(t, {
    'skills/example/SKILL.md': participating(
      [],
      '# Example\n',
      [{ id: 'missing', source: 'local', required: true }],
    ),
  });
  assert.throws(() => validateRepository(localRoot), /unresolved local skill dependency/);
});

test('rejects routable entries under _base', (t) => {
  const root = fixture(t, {
    'skills/_base/common/SKILL.md': participating([], '# Not allowed\n'),
  });
  assert.throws(() => validateRepository(root), /must not contain routable SKILL/);
});

test('rejects an extra declared include that Markdown does not reference', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example/a.md', 'example/b.md'],
      '# Example\n\n## Required References\n\n1. [A](./a.md)\n',
    ),
    'skills/example/a.md': participating([], '# A\n'),
    'skills/example/b.md': participating([], '# B\n'),
  });
  assert.throws(() => validateRepository(root), /includes mirror drift/);
});

test('rejects a case or canonical path mismatch', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example/references/a.md'],
      '# Example\n\n## Required References\n\n1. [A](./references/a.md)\n',
    ),
    'skills/example/references/A.md': participating([], '# A\n'),
  });
  // The rejection reason depends on filesystem case sensitivity: a
  // case-sensitive filesystem cannot resolve the include at all, while a
  // case-insensitive one resolves it to a name the declared path does not
  // match. The validator must reject it either way.
  assert.throws(() => validateRepository(root));
});

test('rejects declared includes that are not normalized forward-slash paths', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example\\a.md'],
      '# Example\n\n## Required References\n\n1. [A](./a.md)\n',
    ),
    'skills/example/a.md': participating([], '# A\n'),
  });
  assert.throws(() => validateRepository(root), /normalized forward-slash paths/);
});

test('rejects duplicate declared includes', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example/a.md', 'example/a.md'],
      '# Example\n\n## Required References\n\n1. [A](./a.md)\n',
    ),
    'skills/example/a.md': participating([], '# A\n'),
  });
  assert.throws(() => validateRepository(root), /includes contains duplicates/);
});

test('rejects a reachable Markdown include that has not opted in', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example/a.md'],
      '# Example\n\n## Required References\n\n1. [A](./a.md)\n',
    ),
    'skills/example/a.md': '# A\n',
  });
  assert.throws(() => validateRepository(root), /has not opted in/);
});

test('rejects malformed requires-skills entries', (t) => {
  const missingKeys = fixture(t, {
    'skills/example/SKILL.md': participating([], '# Example\n', [{ id: 'handoff' }]),
  });
  assert.throws(() => validateRepository(missingKeys), /exactly id, source, and required/);

  const badId = fixture(t, {
    'skills/example/SKILL.md': participating([], '# Example\n', [
      { id: 'Not_Valid', source: 'external', required: true },
    ]),
  });
  assert.throws(() => validateRepository(badId), /invalid skill id/);

  const badSource = fixture(t, {
    'skills/example/SKILL.md': participating([], '# Example\n', [
      { id: 'handoff', source: 'remote', required: true },
    ]),
  });
  assert.throws(() => validateRepository(badSource), /invalid requires-skills edge/);
});

test('ignores files that have not opted in and reports routable skills only', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': '# Example\n\n## Required References\n\n1. [A](./a.md)\n',
    'skills/example/a.md': '# A\n',
    'skills/_base/common/BASE.md': '# Base\n',
  });
  const result = validateRepository(root);
  assert.equal(result.participating.size, 0);
  assert.deepEqual(result.routableSkills, ['example']);
});

test('rejects reference-style links in a required section', () => {
  const definition = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-graph-'));
  try {
    fs.mkdirSync(path.join(definition, 'skills/example'), { recursive: true });
    fs.writeFileSync(
      path.join(definition, 'skills/example/SKILL.md'),
      participating([], '# Example\n\n## Required References\n\n1. [A][a]\n\n[a]: ./a.md\n'),
    );
    fs.writeFileSync(path.join(definition, 'skills/example/a.md'), participating([], '# A\n'));
    assert.throws(() => validateRepository(definition), /reference-style links are not supported/);
  } finally {
    fs.rmSync(definition, { recursive: true, force: true });
  }
});

test('parses frontmatter and mirrors correctly with CRLF line endings', (t) => {
  const crlf = (value) => value.replace(/\n/g, '\r\n');
  const root = fixture(t, {
    'skills/example/SKILL.md': crlf(
      participating(
        ['example/a.md'],
        '# Example\n\n## Required References\n\n1. [A](./a.md)\n',
      ),
    ),
    'skills/example/a.md': crlf(participating([], '# A\n')),
  });
  const result = validateRepository(root);
  assert.equal(result.participating.size, 2);
  assert.deepEqual(result.graph.get('example/SKILL.md'), ['example/a.md']);

  const drifted = fixture(t, {
    'skills/example/SKILL.md': crlf(
      participating([], '# Example\n\n## Required References\n\n1. [A](./a.md)\n'),
    ),
    'skills/example/a.md': crlf(participating([], '# A\n')),
  });
  assert.throws(() => validateRepository(drifted), /includes mirror drift/);
});

test('ignores links inside fenced code blocks', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example/a.md'],
      [
        '# Example',
        '',
        '## Required References',
        '',
        '1. [A](./a.md)',
        '',
        'The fenced example below is documentation, not a dependency:',
        '',
        '```markdown',
        '1. [Not a dependency](./missing.md)',
        '```',
        '',
      ].join('\n'),
    ),
    'skills/example/a.md': participating([], '# A\n'),
  });
  const result = validateRepository(root);
  assert.deepEqual(result.graph.get('example/SKILL.md'), ['example/a.md']);
});

test('does not treat a fenced heading as the start of a required section', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      [],
      [
        '# Example',
        '',
        '```markdown',
        '## Required References',
        '',
        '1. [Not a dependency](./missing.md)',
        '```',
        '',
      ].join('\n'),
    ),
  });
  const result = validateRepository(root);
  assert.deepEqual(result.graph.get('example/SKILL.md'), []);
});

test('resolves link titles, query strings, anchors, and percent-encoding', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example/a b.md', 'example/a.md', 'example/c.md'],
      [
        '# Example',
        '',
        '## Required References',
        '',
        '1. [A](./a.md "The A page")',
        '2. [Spaced](./a%20b.md)',
        '3. [Anchored](./c.md?raw=1#section)',
        '',
      ].join('\n'),
    ),
    'skills/example/a.md': participating([], '# A\n'),
    'skills/example/a b.md': participating([], '# A B\n'),
    'skills/example/c.md': participating([], '# C\n'),
  });
  const result = validateRepository(root);
  assert.deepEqual(result.graph.get('example/SKILL.md'), [
    'example/a b.md',
    'example/a.md',
    'example/c.md',
  ]);
});

test('rejects an include whose canonical path differs from the declared path', { skip: process.platform === 'win32' }, (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example/link.md'],
      '# Example\n\n## Required References\n\n1. [Link](./link.md)\n',
    ),
    'skills/example/real.md': participating([], '# Real\n'),
  });
  fs.symlinkSync('real.md', path.join(root, 'skills/example/link.md'));
  assert.throws(() => validateRepository(root), /case or canonical path mismatch/);
});

test('closureFor is deterministic, deduplicates fan-in, and tolerates an unknown entry', (t) => {
  const root = fixture(t, {
    'skills/example/SKILL.md': participating(
      ['example/a.md', 'example/b.md'],
      '# Example\n\n## Required References\n\n1. [A](./a.md)\n2. [B](./b.md)\n',
    ),
    'skills/example/a.md': participating(
      ['example/shared.md'],
      '# A\n\n## Required Files\n\n1. [Shared](./shared.md)\n',
    ),
    'skills/example/b.md': participating(
      ['example/shared.md'],
      '# B\n\n## Required Files\n\n1. [Shared](./shared.md)\n',
    ),
    'skills/example/shared.md': participating([], '# Shared\n'),
  });
  const result = validateRepository(root);
  const closure = closureFor(result, 'example/SKILL.md');
  assert.deepEqual(closure, [
    'example/SKILL.md',
    'example/a.md',
    'example/shared.md',
    'example/b.md',
  ]);
  assert.equal(new Set(closure).size, closure.length);
  assert.deepEqual(closureFor(result, 'example/SKILL.md'), closure);
  assert.deepEqual(closureFor(result, 'example/missing.md'), ['example/missing.md']);
});

/**
 * Level namespace enforcement.
 *
 * The composition level is derived from the path, so these tests attack the
 * gap between what a file claims and where it actually lives. Every case here
 * is a way the model could be violated while every other check stayed green,
 * and every one of them passed validation before it was written.
 */

function unit(name, level, includes, body, requiresSkills = []) {
  const composes = level === 'atom'
    ? []
    : includes.filter((target) => target.endsWith('.md'));
  return [
    '---',
    `name: ${name}`,
    'description: a unit under test',
    `level: ${level}`,
    `includes: ${JSON.stringify(includes)}`,
    `composes: ${JSON.stringify(composes)}`,
    `requires-skills: ${JSON.stringify(requiresSkills)}`,
    '---',
    '',
    body,
  ].join('\n');
}

const ATOM = (name) => unit(name, 'atom', [], `# ${name}\n`);

function chroniclerFixture() {
  return {
    'skills/_base/_atoms/chronicle-append/chronicle-append.md': ATOM('chronicle-append'),
    'skills/_base/_atoms/chronicle-replay/chronicle-replay.md': ATOM('chronicle-replay'),
    'skills/_base/_molecules/chronicler/chronicler.md': unit(
      'chronicler',
      'molecule',
      [
        '_base/_atoms/chronicle-append/chronicle-append.md',
        '_base/_atoms/chronicle-replay/chronicle-replay.md',
      ],
      '# chronicler\n\n## Required References\n\n1. [Append](../../_atoms/chronicle-append/chronicle-append.md)\n2. [Replay](../../_atoms/chronicle-replay/chronicle-replay.md)\n',
    ),
  };
}

test('requires every routable skill to directly compose Chronicler when it is installed', (t) => {
  const missing = fixture(t, {
    ...chroniclerFixture(),
    'skills/demo/SKILL.md': participating([], '# Demo\n'),
  });
  assert.throws(
    () => validateRepository(missing),
    /every routable skill must directly compose _base\/_molecules\/chronicler\/chronicler\.md/,
  );

  const accepted = fixture(t, {
    ...chroniclerFixture(),
    'skills/demo/SKILL.md': participating(
      ['_base/_molecules/chronicler/chronicler.md'],
      '# Demo\n\n## Required References\n\n1. [Chronicler](../_base/_molecules/chronicler/chronicler.md)\n',
    ),
  });
  assert.doesNotThrow(() => validateRepository(accepted));
});

test('requires every routable skill to opt in to the graph when Chronicler is installed', (t) => {
  const root = fixture(t, {
    ...chroniclerFixture(),
    'skills/demo/SKILL.md': '# Demo\n',
  });
  assert.throws(
    () => validateRepository(root),
    /every routable skill must declare includes and directly compose/,
  );
});

test('accepts a molecule composing atoms in their level namespaces', (t) => {
  const root = fixture(t, {
    'skills/_base/_atoms/alpha/alpha.md': ATOM('alpha'),
    'skills/_base/_atoms/alpha/alpha.mjs': 'export const alpha = 1;\n',
    'skills/_base/_atoms/alpha/alpha.test.mjs': '// seam test\n',
    'skills/_base/_atoms/beta/beta.md': ATOM('beta'),
    'skills/_base/_molecules/combo/combo.md': unit(
      'combo',
      'molecule',
      ['_base/_atoms/alpha/alpha.md', '_base/_atoms/beta/beta.md', '_base/_molecules/combo/combo.mjs'],
      '# combo\n\n## Required References\n\n1. [Alpha](../../_atoms/alpha/alpha.md)\n2. [Beta](../../_atoms/beta/beta.md)\n\n## Required Files\n\n1. [Local](./combo.mjs)\n',
    ),
    'skills/_base/_molecules/combo/combo.mjs': 'export const combo = 1;\n',
  });
  const result = validateRepository(root);
  // closureFor walks Markdown units only; a local support file is mirror
  // validated but is not a node in the composition graph.
  assert.deepEqual(closureFor(result, '_base/_molecules/combo/combo.md'), [
    '_base/_molecules/combo/combo.md',
    '_base/_atoms/alpha/alpha.md',
    '_base/_atoms/beta/beta.md',
  ]);
});

test('accepts scoped local units with the same names in different skills', (t) => {
  const files = {};
  for (const skill of ['alpha-skill', 'beta-skill']) {
    const first = `${skill}/_atoms/resolve-input/resolve-input.md`;
    const second = `${skill}/_atoms/render-output/render-output.md`;
    const molecule = `${skill}/_molecules/run-workflow/run-workflow.md`;
    files[`skills/${first}`] = ATOM('resolve-input');
    files[`skills/${second}`] = ATOM('render-output');
    files[`skills/${molecule}`] = unit(
      'run-workflow',
      'molecule',
      [first, second],
      `# run-workflow\n\n## Required References\n\n1. [Resolve](../../_atoms/resolve-input/resolve-input.md)\n2. [Render](../../_atoms/render-output/render-output.md)\n`,
    );
    files[`skills/${skill}/SKILL.md`] = [
      '---',
      `name: ${skill}`,
      `description: Skill ${skill}.`,
      'allowed-tools: []',
      `includes: ["${molecule}"]`,
      `composes: ["${molecule}"]`,
      'disable-model-invocation: false',
      'user-invocable: true',
      '---',
      '',
      `# ${skill}`,
      '',
      '## Required References',
      '',
      '1. [Workflow](./_molecules/run-workflow/run-workflow.md)',
      '',
    ].join('\n');
  }

  const root = fixture(t, files);
  assert.doesNotThrow(() => validateRepository(root));
});

test('rejects cross-skill composition of a scoped local unit', (t) => {
  const root = fixture(t, {
    'skills/alpha/SKILL.md': participating([], '# alpha\n'),
    'skills/beta/SKILL.md': participating([], '# beta\n'),
    'skills/alpha/_atoms/resolve/resolve.md': ATOM('resolve'),
    'skills/beta/_atoms/render/render.md': ATOM('render'),
    'skills/alpha/_molecules/workflow/workflow.md': unit(
      'workflow',
      'molecule',
      ['alpha/_atoms/resolve/resolve.md', 'beta/_atoms/render/render.md'],
      '# workflow\n\n## Required References\n\n1. [Resolve](../../_atoms/resolve/resolve.md)\n2. [Render](../../../beta/_atoms/render/render.md)\n',
    ),
  });
  assert.throws(() => validateRepository(root), /may not compose a unit owned by beta/);
});

test('rejects composes metadata that does not mirror direct unit includes', (t) => {
  const root = fixture(t, {
    'skills/demo/SKILL.md': [
      '---',
      'name: demo',
      'description: Demo.',
      'allowed-tools: []',
      'includes: ["demo/_atoms/resolve/resolve.md"]',
      'composes: []',
      'disable-model-invocation: false',
      'user-invocable: true',
      '---',
      '',
      '# Demo',
      '',
      '## Required References',
      '',
      '1. [Resolve](./_atoms/resolve/resolve.md)',
      '',
    ].join('\n'),
    'skills/demo/_atoms/resolve/resolve.md': ATOM('resolve'),
  });
  assert.throws(() => validateRepository(root), /composes drift/);
});

test('requires invocation flags when a skill declares atomic composition', (t) => {
  const root = fixture(t, {
    'skills/demo/SKILL.md': [
      '---',
      'name: demo',
      'description: Demo.',
      'allowed-tools: []',
      'includes: ["demo/_atoms/resolve/resolve.md"]',
      'composes: ["demo/_atoms/resolve/resolve.md"]',
      '---',
      '',
      '# Demo',
      '',
      '## Required References',
      '',
      '1. [Resolve](./_atoms/resolve/resolve.md)',
      '',
    ].join('\n'),
    'skills/demo/_atoms/resolve/resolve.md': ATOM('resolve'),
  });
  assert.throws(() => validateRepository(root), /must declare disable-model-invocation/);
});

test('rejects a unit whose declared level contradicts its namespace', (t) => {
  const root = fixture(t, { 'skills/_base/_atoms/alpha/alpha.md': unit('alpha', 'molecule', [], '# alpha\n') });
  assert.throws(() => validateRepository(root), /level must be atom to match its namespace/);
});

test('rejects a unit root whose Markdown file is not a unit at all', (t) => {
  const root = fixture(t, {
    'skills/_base/_atoms/ghost/ghost.md': '# Ghost\n',
    'skills/_base/_atoms/ghost/ghost.mjs': 'export const ghost = 1;\n',
  });
  assert.throws(() => validateRepository(root), /declare frontmatter with includes/);
});

test('rejects a unit that omits name or description', (t) => {
  const noName = fixture(t, {
    'skills/_base/_atoms/alpha/alpha.md': '---\ndescription: d\nlevel: atom\nincludes: []\nrequires-skills: []\n---\n\n# alpha\n',
  });
  assert.throws(() => validateRepository(noName), /must declare name/);

  const noDescription = fixture(t, {
    'skills/_base/_atoms/alpha/alpha.md': '---\nname: alpha\nlevel: atom\nincludes: []\nrequires-skills: []\n---\n\n# alpha\n',
  });
  assert.throws(() => validateRepository(noDescription), /must declare description/);
});

test('rejects a unit whose name does not match its file name', (t) => {
  const root = fixture(t, { 'skills/_base/_atoms/beta/beta.md': ATOM('not-beta') });
  assert.throws(() => validateRepository(root), /name not-beta must match the unit file name beta/);
});

test('rejects an atom that references another unit', (t) => {
  const root = fixture(t, {
    'skills/_base/_atoms/alpha/alpha.md': unit(
      'alpha',
      'atom',
      ['_base/_atoms/beta/beta.md'],
      '# alpha\n\n## Required References\n\n1. [Beta](../beta/beta.md)\n',
    ),
    'skills/_base/_atoms/beta/beta.md': ATOM('beta'),
  });
  assert.throws(() => validateRepository(root), /an atom references no other unit/);
});

test('rejects a molecule that composes fewer than two units', (t) => {
  const none = fixture(t, { 'skills/_base/_molecules/combo/combo.md': unit('combo', 'molecule', [], '# combo\n') });
  assert.throws(() => validateRepository(none), /composes two or more units; found 0/);

  const one = fixture(t, {
    'skills/_base/_atoms/alpha/alpha.md': ATOM('alpha'),
    'skills/_base/_molecules/combo/combo.md': unit(
      'combo',
      'molecule',
      ['_base/_atoms/alpha/alpha.md'],
      '# combo\n\n## Required References\n\n1. [Alpha](../../_atoms/alpha/alpha.md)\n',
    ),
  });
  assert.throws(() => validateRepository(one), /composes two or more units; found 1/);
});

test('rejects upward composition from a molecule to a routable skill', (t) => {
  const root = fixture(t, {
    'skills/demo/SKILL.md': participating([], '# Demo\n'),
    'skills/_base/_atoms/alpha/alpha.md': ATOM('alpha'),
    'skills/_base/_molecules/combo/combo.md': unit(
      'combo',
      'molecule',
      ['_base/_atoms/alpha/alpha.md', 'demo/SKILL.md'],
      '# combo\n\n## Required References\n\n1. [Alpha](../../_atoms/alpha/alpha.md)\n2. [Demo](../../../demo/SKILL.md)\n',
    ),
  });
  assert.throws(() => validateRepository(root), /composes only canonical atoms and molecules/);
});

test('rejects a molecule including a support file that is not its own', (t) => {
  const root = fixture(t, {
    'skills/_base/_atoms/alpha/alpha.md': ATOM('alpha'),
    'skills/_base/_atoms/alpha/alpha.mjs': 'export const alpha = 1;\n',
    'skills/_base/_atoms/beta/beta.md': ATOM('beta'),
    'skills/_base/_molecules/combo/combo.md': unit(
      'combo',
      'molecule',
      ['_base/_atoms/alpha/alpha.md', '_base/_atoms/alpha/alpha.mjs', '_base/_atoms/beta/beta.md'],
      '# combo\n\n## Required References\n\n1. [Alpha](../../_atoms/alpha/alpha.md)\n2. [Beta](../../_atoms/beta/beta.md)\n\n## Required Files\n\n1. [Foreign](../../_atoms/alpha/alpha.mjs)\n',
    ),
  });
  assert.throws(() => validateRepository(root), /may include only its own local support files/);
});

test('rejects a level declared outside a level namespace', (t) => {
  const root = fixture(t, { 'skills/example/SKILL.md': unit('example', 'atom', [], '# Example\n') });
  assert.throws(() => validateRepository(root), /does not live in a level namespace/);
});

test('rejects requires-skills inside a level namespace', (t) => {
  const root = fixture(t, {
    'skills/other/SKILL.md': participating([], '# Other\n'),
    'skills/_base/_atoms/alpha/alpha.md': unit('alpha', 'atom', [], '# alpha\n', [
      { id: 'other', source: 'local', required: true },
    ]),
  });
  assert.throws(() => validateRepository(root), /must not declare requires-skills/);
});

test('rejects a support file with no matching unit in its level namespace', (t) => {
  const root = fixture(t, {
    'skills/_base/_atoms/alpha/alpha.md': ATOM('alpha'),
    'skills/_base/_atoms/orphan/orphan.mjs': 'export const orphan = 1;\n',
  });
  assert.throws(() => validateRepository(root), /has no matching orphan.md unit/);
});

test('accepts a suffixed support file that names its unit', (t) => {
  const root = fixture(t, {
    'skills/_base/_atoms/alpha/alpha.md': ATOM('alpha'),
    'skills/_base/_atoms/beta/beta.md': ATOM('beta'),
    'skills/_base/_molecules/combo/combo.md': unit(
      'combo',
      'molecule',
      ['_base/_atoms/alpha/alpha.md', '_base/_atoms/beta/beta.md'],
      '# combo\n\n## Required References\n\n1. [Alpha](../../_atoms/alpha/alpha.md)\n2. [Beta](../../_atoms/beta/beta.md)\n',
    ),
    'skills/_base/_molecules/combo/combo.adversarial.test.mjs': '// hostile input\n',
  });
  assert.doesNotThrow(() => validateRepository(root));
});

test('rejects a flat unit file directly inside a level namespace', (t) => {
  const root = fixture(t, { 'skills/_base/_atoms/alpha.md': ATOM('alpha') });
  assert.throws(() => validateRepository(root), /must be located at <level-namespace>\/<unit-name>\/<unit-name>\.md/);
});

test('rejects a unit root whose Markdown file does not match the directory', (t) => {
  const root = fixture(t, { 'skills/_base/_atoms/alpha/beta.md': ATOM('beta') });
  assert.throws(() => validateRepository(root), /must be located at <level-namespace>\/<unit-name>\/<unit-name>\.md/);
});

test('rejects a nested directory inside a unit root', (t) => {
  const root = fixture(t, {
    'skills/_base/_atoms/alpha/alpha.md': ATOM('alpha'),
    'skills/_base/_atoms/alpha/nested/alpha.mjs': 'export const alpha = 1;\n',
  });
  assert.throws(() => validateRepository(root), /unit root contains only regular files/);
});

test('rejects a symbolic link inside a level namespace', (t) => {
  const root = fixture(t, { 'skills/_base/_atoms/alpha/alpha.md': ATOM('alpha') });
  const outside = path.join(root, 'outside.mjs');
  fs.writeFileSync(outside, 'export const outside = 1;\n');
  fs.symlinkSync(outside, path.join(root, 'skills/_base/_atoms/alpha/alpha.mjs'));
  assert.throws(() => validateRepository(root), /must not contain a symbolic link/);
});

test('rejects a symlinked Markdown file impersonating a unit', (t) => {
  const root = fixture(t, { 'skills/_base/_atoms/alpha/alpha.md': ATOM('alpha') });
  const outside = path.join(root, 'outside.md');
  fs.writeFileSync(outside, ATOM('escape'));
  fs.mkdirSync(path.join(root, 'skills/_base/_atoms/escape'), { recursive: true });
  fs.symlinkSync(outside, path.join(root, 'skills/_base/_atoms/escape/escape.md'));
  assert.throws(() => validateRepository(root), /must not contain a symbolic link/);
});

test('rejects a dotfile Markdown name in a level namespace', (t) => {
  const root = fixture(t, { 'skills/_base/_atoms/.md': '# Dot\n' });
  assert.throws(() => validateRepository(root), /must be located at <level-namespace>\/<unit-name>\/<unit-name>\.md/);
});
