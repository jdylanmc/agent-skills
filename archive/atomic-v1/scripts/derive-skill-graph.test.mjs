import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyUpdates, deriveGraph, setFrontmatterField } from './derive-skill-graph.mjs';

/**
 * Every fixture below is a repository shape that the deriver must handle
 * correctly. Each was written by breaking the deriver first and then fixing it,
 * so a passing assertion here corresponds to a failure that actually occurred.
 */

function makeRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'derive-graph-'));
  fs.mkdirSync(path.join(root, 'skills', '_base', '_atoms'), { recursive: true });
  fs.mkdirSync(path.join(root, 'skills', '_base', '_molecules'), { recursive: true });
  return root;
}

function writeAtom(root, name, { tools = [], usedBy = null } = {}) {
  const lines = [
    '---',
    `name: ${name}`,
    `description: Atom ${name}.`,
    'level: atom',
    `allowed-tools: ${JSON.stringify(tools)}`,
    'includes: []',
    'composes: []',
  ];
  if (usedBy !== null) {
    lines.push(`used-by: ${JSON.stringify(usedBy)}`);
  }
  lines.push('---', '', `# ${name}`, '');
  const directory = path.join(root, 'skills', '_base', '_atoms', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${name}.md`), lines.join('\n'));
}

function writeMolecule(root, name, composes, { tools = null, usedBy = null } = {}) {
  const includes = composes.map((unit) => `_base/_atoms/${unit}/${unit}.md`);
  const links = composes.map(
    (unit, index) => `${index + 1}. [${unit}](../../_atoms/${unit}/${unit}.md)`,
  );
  const lines = ['---', `name: ${name}`, `description: Molecule ${name}.`, 'level: molecule'];
  if (tools !== null) {
    lines.push(`allowed-tools: ${JSON.stringify(tools)}`);
  }
  lines.push(`includes: ${JSON.stringify(includes)}`);
  lines.push(`composes: ${JSON.stringify(includes)}`);
  if (usedBy !== null) {
    lines.push(`used-by: ${JSON.stringify(usedBy)}`);
  }
  lines.push('---', '', `# ${name}`, '', '## Required References', '', ...links, '');
  const directory = path.join(root, 'skills', '_base', '_molecules', name);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, `${name}.md`), lines.join('\n'));
}

function writeSkill(root, name, composes, tools) {
  fs.mkdirSync(path.join(root, 'skills', name), { recursive: true });
  const links = composes.map((unit, index) => `${index + 1}. [${unit}](../_base/${unit})`);
  const includes = composes.map((unit) => `_base/${unit}`);
  const lines = [
    '---',
    `name: ${name}`,
    `description: Skill ${name}.`,
    `allowed-tools: ${JSON.stringify(tools)}`,
    `includes: ${JSON.stringify(includes)}`,
    '---',
    '',
    `# ${name}`,
    '',
    '## Required References',
    '',
    ...links,
    '',
  ];
  fs.writeFileSync(path.join(root, 'skills', name, 'SKILL.md'), lines.join('\n'));
}

test('a molecule inherits the union of the tools of what it composes', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['read'] });
  writeAtom(root, 'beta', { tools: ['edit'] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);

  const derived = deriveGraph(root);
  assert.deepEqual(derived.resolvedTools.get('_base/_molecules/gamma/gamma.md'), ['edit', 'read']);
});

test('a molecule composing only tool-free atoms derives an empty tool set', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: [] });
  writeAtom(root, 'beta', { tools: [] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);

  const derived = deriveGraph(root);
  assert.deepEqual(derived.resolvedTools.get('_base/_molecules/gamma/gamma.md'), []);
});

test('used-by records every direct consumer, sorted and deduplicated', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['read'] });
  writeAtom(root, 'beta', { tools: [] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);
  writeSkill(root, 'zulu', ['_molecules/gamma/gamma.md'], ['read']);

  const derived = deriveGraph(root);
  assert.deepEqual(derived.usedBy.get('_base/_atoms/alpha/alpha.md'), ['_base/_molecules/gamma/gamma.md']);
  assert.deepEqual(derived.usedBy.get('_base/_molecules/gamma/gamma.md'), ['zulu/SKILL.md']);
});

test('a unit with no consumers derives an empty used-by rather than being skipped', () => {
  const root = makeRepository();
  writeAtom(root, 'orphan', { tools: ['read'] });

  const derived = deriveGraph(root);
  assert.deepEqual(derived.usedBy.get('_base/_atoms/orphan/orphan.md'), []);
  applyUpdates(derived);
  const written = fs.readFileSync(
    path.join(root, 'skills', '_base', '_atoms', 'orphan', 'orphan.md'),
    'utf8',
  );
  assert.match(written, /^used-by: \[\]$/m);
});

test('a skill whose grant covers its units passes verification', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['read'] });
  writeAtom(root, 'beta', { tools: ['edit'] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);
  writeSkill(root, 'zulu', ['_molecules/gamma/gamma.md'], ['read', 'edit', 'search']);

  const derived = deriveGraph(root);
  assert.deepEqual(derived.grantViolations, []);
});

test('a skill whose grant does not cover a transitively composed atom is reported', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['read'] });
  writeAtom(root, 'beta', { tools: ['execute'] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);
  writeSkill(root, 'zulu', ['_molecules/gamma/gamma.md'], ['read']);

  const derived = deriveGraph(root);
  assert.equal(derived.grantViolations.length, 1);
  assert.deepEqual(derived.grantViolations[0].missing, ['execute']);
  assert.equal(derived.grantViolations[0].relativeFile, 'zulu/SKILL.md');
});

test('a skill with no allowed-tools grant is reported rather than skipped', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['execute'] });
  writeAtom(root, 'beta', { tools: [] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);

  fs.mkdirSync(path.join(root, 'skills', 'zulu'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'skills', 'zulu', 'SKILL.md'),
    [
      '---',
      'name: zulu',
      'description: Skill zulu.',
      'includes: ["_base/_molecules/gamma/gamma.md"]',
      '---',
      '',
      '# zulu',
      '',
      '## Required References',
      '',
      '1. [gamma](../_base/_molecules/gamma/gamma.md)',
      '',
    ].join('\n'),
  );

  const derived = deriveGraph(root);
  assert.equal(derived.grantViolations.length, 1);
  assert.deepEqual(derived.grantViolations[0].missing, ['execute']);
  assert.deepEqual(derived.grantViolations[0].granted, []);
});

test('a skill grant is never rewritten, only reported', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['execute'] });
  writeAtom(root, 'beta', { tools: [] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);
  writeSkill(root, 'zulu', ['_molecules/gamma/gamma.md'], ['read']);

  const skillPath = path.join(root, 'skills', 'zulu', 'SKILL.md');
  const before = fs.readFileSync(skillPath, 'utf8');
  const derived = deriveGraph(root);
  applyUpdates(derived);

  assert.equal(fs.readFileSync(skillPath, 'utf8'), before);
  assert.ok(derived.updates.every((update) => !update.relativeFile.endsWith('/SKILL.md')));
});

test('a wildcard skill grant satisfies every requirement', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['execute'] });
  writeAtom(root, 'beta', { tools: ['edit'] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);
  writeSkill(root, 'zulu', ['_molecules/gamma/gamma.md'], ['*']);

  const derived = deriveGraph(root);
  assert.deepEqual(derived.grantViolations, []);
});

test('regeneration is idempotent', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['read'] });
  writeAtom(root, 'beta', { tools: ['edit'] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);

  applyUpdates(deriveGraph(root));
  const snapshot = fs.readFileSync(
    path.join(root, 'skills', '_base', '_molecules', 'gamma', 'gamma.md'),
    'utf8',
  );

  const second = deriveGraph(root);
  assert.deepEqual(second.updates, []);
  applyUpdates(second);
  assert.equal(
    fs.readFileSync(path.join(root, 'skills', '_base', '_molecules', 'gamma', 'gamma.md'), 'utf8'),
    snapshot,
  );
});

test('a stale committed value is detected rather than trusted', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['read'] });
  writeAtom(root, 'beta', { tools: ['edit'] });
  writeMolecule(root, 'gamma', ['alpha', 'beta'], { tools: ['read'], usedBy: [] });

  const derived = deriveGraph(root);
  const fields = derived.updates
    .filter((update) => update.relativeFile === '_base/_molecules/gamma/gamma.md')
    .map((update) => update.field)
    .sort();
  assert.deepEqual(fields, ['allowed-tools']);
});

test('a hand-written wrong used-by is corrected', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['read'], usedBy: ['nonsense/SKILL.md'] });
  writeAtom(root, 'beta', { tools: [] });
  writeMolecule(root, 'gamma', ['alpha', 'beta']);

  applyUpdates(deriveGraph(root));
  const written = fs.readFileSync(
    path.join(root, 'skills', '_base', '_atoms', 'alpha', 'alpha.md'),
    'utf8',
  );
  assert.match(written, /^used-by: \["_base\/_molecules\/gamma\/gamma\.md"\]$/m);
  assert.doesNotMatch(written, /nonsense/);
});

test('setFrontmatterField replaces in place and preserves every other line', () => {
  const original = ['---', 'name: alpha', 'level: atom', 'used-by: ["old"]', '---', '', '# Alpha', ''].join('\n');
  const updated = setFrontmatterField(original, 'used-by', '["new"]');
  assert.equal(
    updated,
    ['---', 'name: alpha', 'level: atom', 'used-by: ["new"]', '---', '', '# Alpha', ''].join('\n'),
  );
});

test('setFrontmatterField appends when the field is absent', () => {
  const original = ['---', 'name: alpha', 'level: atom', '---', '', '# Alpha', ''].join('\n');
  const updated = setFrontmatterField(original, 'used-by', '[]');
  assert.equal(
    updated,
    ['---', 'name: alpha', 'level: atom', 'used-by: []', '---', '', '# Alpha', ''].join('\n'),
  );
});

test('setFrontmatterField refuses a file with no frontmatter', () => {
  assert.throws(() => setFrontmatterField('# Alpha\n', 'used-by', '[]'), /no frontmatter/);
});

test('a molecule composing another molecule unions transitively', () => {
  const root = makeRepository();
  writeAtom(root, 'alpha', { tools: ['read'] });
  writeAtom(root, 'beta', { tools: ['edit'] });
  writeMolecule(root, 'inner', ['alpha', 'beta']);

  const outerDirectory = path.join(root, 'skills', '_base', '_molecules', 'outer');
  fs.mkdirSync(outerDirectory, { recursive: true });
  const outerPath = path.join(outerDirectory, 'outer.md');
  fs.writeFileSync(
    outerPath,
    [
      '---',
      'name: outer',
      'description: Molecule outer.',
      'level: molecule',
      'includes: ["_base/_atoms/alpha/alpha.md","_base/_molecules/inner/inner.md"]',
      'composes: ["_base/_atoms/alpha/alpha.md","_base/_molecules/inner/inner.md"]',
      '---',
      '',
      '# outer',
      '',
      '## Required References',
      '',
      '1. [alpha](../../_atoms/alpha/alpha.md)',
      '2. [inner](../inner/inner.md)',
      '',
    ].join('\n'),
  );

  const derived = deriveGraph(root);
  assert.deepEqual(derived.resolvedTools.get('_base/_molecules/outer/outer.md'), ['edit', 'read']);
});
