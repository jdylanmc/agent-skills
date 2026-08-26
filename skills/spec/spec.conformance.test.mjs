import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const ENTRY = 'spec/SKILL.md';
const PINNED_TOOLS = ['edit', 'execute', 'read', 'search', 'task'];
const UNITS = [
  'spec/_molecules/product-specification/product-specification.md',
  'spec/_atoms/discovery-source/discovery-source.md',
  'spec/_atoms/product-requirements/product-requirements.md',
  'spec/_atoms/spec-outcome/spec-outcome.md',
  'spec/_atoms/spec-pair/spec-pair.md',
];
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const flat = (relative) => read(relative).replace(/\s+/g, ' ');
const frontmatter = (relative) => readFrontmatter(
  fs.readFileSync(path.join(SKILLS_ROOT, relative), 'utf8'),
  relative,
);

test('spec is routable from confirmed Discovery and refuses adjacent jobs', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'spec');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.deepEqual(parsed.requiresSkills, [{ id: 'roast', source: 'local', required: true }]);
  assert.match(parsed.description, /Markdown artifact or tracker issue/);
  for (const refusal of ['choose architecture', 'author Gherkin', 'create tickets', 'mutate trackers', 'implement']) {
    assert.match(parsed.description, new RegExp(refusal, 'i'));
  }
});

test('composition reaches chronicler and every local unit without widening the grant', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'spec/_molecules/product-specification/product-specification.md',
  ]);

  const closure = closureFor(validateRepository(ROOT), ENTRY);
  for (const unit of UNITS) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }

  const derived = deriveGraph(ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual(
    [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort(),
    [],
  );
  assert.deepEqual(derived.grantViolations, []);
});

test('durable workflow artifacts stay under docs agent', () => {
  const intent = flat('skills/spec/intent.md');
  const skill = flat('skills/spec/SKILL.md');
  assert.match(intent, /docs\/agent\/discovery/);
  assert.match(intent, /docs\/agent\/specs/);
  assert.match(intent, /durable workspace/);
  assert.match(skill, /docs\/agent\/specs\/<slug>\.nano\.md/);
  assert.match(skill, /docs\/agent\/specs\/<slug>\.full\.md/);
});

test('nano authority and full supporting context cannot silently trade places', () => {
  const skill = flat('skills/spec/SKILL.md');
  const pair = flat('skills/spec/_atoms/spec-pair/spec-pair.md');
  assert.match(skill, /nano document is settled product intent/);
  assert.match(skill, /full document never wins/);
  assert.match(pair, /Every bullet under Product Requirements and Product Decisions contains one authority marker/);
  assert.match(pair, /Every nano acceptance-criteria identifier appears in Traceability/);
});

test('one-pass Roast stays separate from Ship remediation and human approval', () => {
  const skill = flat('skills/spec/SKILL.md');
  const intent = flat('skills/spec/intent.md');
  assert.match(skill, /Submit the exact candidate pair to `roast`/);
  assert.match(skill, /Roast is read-only/);
  assert.match(skill, /outer delivery workflow may apply repairs/);
  assert.match(intent, /A roast is one read-only review pass/);
  assert.match(intent, /delivery workflow owns any repeated roast, repair, and re-roast loop/);
  assert.match(skill, /Silence and unrelated replies are not approval/);
  assert.match(skill, /issue #118/);
  assert.match(skill, /`complete` remains unreachable/);
});

test('composition is local-first and includes the required chronicler', () => {
  const skill = read('skills/spec/SKILL.md');
  const molecule = read('skills/spec/_molecules/product-specification/product-specification.md');
  assert.match(skill, /_base\/_molecules\/chronicler\/chronicler\.md/);
  for (const atom of ['discovery-source', 'product-requirements', 'spec-outcome', 'spec-pair']) {
    assert.match(molecule, new RegExp(`spec/_atoms/${atom}/${atom}\\.md`));
  }
});

test('human-confirmed intent is present and treated as the source', () => {
  const intent = read('skills/spec/intent.md');
  assert.match(intent, /^# Intent: spec/);
  assert.match(intent, /tracker issue/);
  assert.match(intent, /product requirements documents/i);
  assert.match(intent, /The nano document is intentionally smaller/);
});
