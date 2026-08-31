import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = path.join(ROOT, 'skills');
const ENTRY = 'product-design/SKILL.md';
const PINNED_TOOLS = ['edit', 'execute', 'read', 'search', 'task'];
const UNITS = [
  'product-design/_molecules/product-design-cycle/product-design-cycle.md',
  'product-design/_atoms/discovery-intake/discovery-intake.md',
  'product-design/_atoms/brand-foundation/brand-foundation.md',
  'product-design/_atoms/ux-concepts/ux-concepts.md',
  'product-design/_atoms/interaction-contract/interaction-contract.md',
  'product-design/_atoms/approval-binding/approval-binding.md',
];
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const flat = (relative) => read(relative).replace(/\s+/g, ' ');
const frontmatter = (relative) => readFrontmatter(fs.readFileSync(path.join(SKILLS, relative), 'utf8'), relative);

test('product-design is one routable phase between Discovery and spec', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'product-design');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.match(parsed.description, /exactly one.*Discovery subject/i);
  assert.match(parsed.description, /before \/spec/);
  assert.match(parsed.description, /Do not use.*production UI/i);
  assert.match(parsed.description, /production architecture/i);
});

test('composition reaches only chronicler and product-design-local units without widening tools', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'product-design/_molecules/product-design-cycle/product-design-cycle.md',
  ]);
  const closure = closureFor(validateRepository(ROOT), ENTRY);
  for (const unit of UNITS) assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  const foreign = closure.filter((unit) => !unit.startsWith('product-design/') && !unit.startsWith('_base/'));
  assert.deepEqual(foreign, []);

  const derived = deriveGraph(ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual([...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort(), []);
  assert.deepEqual(derived.grantViolations, []);
});

test('brand and user experience use separate ordered specialist contexts', () => {
  const skill = flat('skills/product-design/SKILL.md');
  const brand = flat('skills/product-design/_atoms/brand-foundation/brand-foundation.md');
  const ux = flat('skills/product-design/_atoms/ux-concepts/ux-concepts.md');
  assert.match(skill, /brand-designer/);
  assert.match(skill, /user-experience-designer/);
  assert.match(skill, /new, separate internal/);
  assert.match(brand, /Storybook/);
  assert.match(brand, /exact locked `@storybook\/html-vite` framework package/);
  assert.match(brand, /static HTML entry, CSS foundation, and JavaScript behavior entry/);
  assert.match(brand, /supplies a provenance-bearing `brand-aligned` receipt/);
  assert.match(ux, /Only after exact-digest brand alignment/);
  assert.match(ux, /Do not target a fixed count/i);
  assert.match(ux, /genuinely distinct bounded concepts/);
});

test('artifacts are runnable, mocked, walkthrough-guided, accessible, and bounded', () => {
  const skill = flat('skills/product-design/SKILL.md');
  const ux = flat('skills/product-design/_atoms/ux-concepts/ux-concepts.md');
  const approval = flat('skills/product-design/_atoms/approval-binding/approval-binding.md');
  assert.match(skill, /docs\/agent\/prototypes\/<subject>\//);
  assert.match(skill, /every concept an isolated npm site/);
  assert.match(skill, /restartable.*walkthrough/i);
  assert.match(skill, /stable identifier/);
  assert.match(skill, /visible overlays/);
  assert.match(ux, /accessibility expectations/);
  assert.match(approval, /paths outside the workspace/);
  assert.match(approval, /safely enumerates every file/);
  assert.match(approval, /never uses locale-dependent sorting/);
  assert.match(approval, /no required concept count beyond one valid result and no maximum/i);
  assert.match(skill, /never runs Storybook, npm scripts, or prototype JavaScript/i);
  assert.match(skill, /untrusted human-run commands/i);
  assert.match(skill, /trusted human-run observation/i);
  const cycle = flat('skills/product-design/_molecules/product-design-cycle/product-design-cycle.md');
  assert.match(cycle, /trusted human-run observations/i);
  assert.ok(
    cycle.indexOf('trusted human-run observations') < cycle.indexOf('concept-selection'),
    'walkthrough observations must precede concept selection',
  );
});

test('prototype implementation is excluded from downstream production authority', () => {
  const skill = flat('skills/product-design/SKILL.md');
  const contract = flat('skills/product-design/_atoms/interaction-contract/interaction-contract.md');
  assert.match(skill, /Illustrative only/);
  assert.match(skill, /Disposable and untrusted/);
  assert.match(skill, /prototype-implementation-excluded-from-production-authority/);
  assert.match(skill, /No production selection/);
  assert.match(contract, /HTML, CSS, JavaScript, Storybook configuration, components, libraries, data models, and prototype architecture do not/);
});

test('approval binds exact bytes and merge confirms the exact revision', () => {
  const skill = flat('skills/product-design/SKILL.md');
  const approval = flat('skills/product-design/_atoms/approval-binding/approval-binding.md');
  assert.match(skill, /separate `product-design-approved` receipt/);
  assert.match(skill, /trusted observation naming the change request, merged state, destination\/default branch, and revision/);
  assert.match(approval, /Canonical ordering compares Unicode code units directly/);
  assert.match(approval, /untrusted, unmerged/);
  assert.match(approval, /trusted human-event adapter/);
  assert.match(approval, /trusted dispatch runtime/);
  assert.match(approval, /official read-only `gh pr view`/);
  assert.match(approval, /standalone approval command has no trusted human or dispatch adapter and therefore fails closed/);
  for (const adapter of [
    'createHumanReceiptVerifier', 'createSpecialistEventVerifier',
    'createWalkthroughObservationVerifier',
    'createGitHubMergeVerifier', 'createGitHubRepositoryResolver',
  ]) assert.match(approval, new RegExp(adapter));
});

test('spec handoff is a stable interaction contract with every required trace category', () => {
  const skill = flat('skills/product-design/SKILL.md');
  const contract = flat('skills/product-design/_atoms/interaction-contract/interaction-contract.md');
  for (const term of ['features', 'flows', 'states', 'decisions', 'alternatives', 'accessibility', 'open questions']) {
    assert.match(skill, new RegExp(term, 'i'));
    assert.match(contract, new RegExp(term, 'i'));
  }
  assert.match(skill, /Return the contract for `\/spec` as product evidence/);
  assert.match(contract, /own typed identifier set/);
  assert.match(contract, /exactly cover and agree/);
});

test('isolated sites and structured accessibility are enforceable contracts', () => {
  const approval = flat('skills/product-design/_atoms/approval-binding/approval-binding.md');
  const brand = flat('skills/product-design/_atoms/brand-foundation/brand-foundation.md');
  const contract = flat('skills/product-design/_atoms/interaction-contract/interaction-contract.md');
  assert.match(approval, /dependencies, devDependencies, optionalDependencies, or peerDependencies absent from the complete lockfile closure/);
  assert.match(brand, /structured accessibility evidence/);
  for (const category of ['keyboard', 'focus', 'semantics', 'contrast', 'reduced motion', 'resizing', 'error/state communication']) {
    assert.match(contract, new RegExp(category.replace('/', '\\/'), 'i'));
  }
  assert.match(contract, /separate typed feature, flow, state, walkthrough,\s+and step identifier coverage/);
  assert.match(contract, /map exactly one concept accessibility evidence ID/);
  assert.match(contract, /alternatives exactly cover the typed concept\s+alternative IDs/);
});

test('prototype artifacts explicitly bypass Roast while the package does not', () => {
  const intent = flat('skills/product-design/intent.md');
  const skill = flat('skills/product-design/SKILL.md');
  assert.match(intent, /Prototype artifacts do not require Roast/);
  assert.match(intent, /skill package itself follows.*normal Ship gates/);
  assert.match(skill, /No Roast for artifacts/);
});

test('the package carries the confirmed plain-English intent', () => {
  const intent = read('skills/product-design/intent.md');
  assert.match(intent, /^# Intent: product-design$/m);
  assert.ok(!intent.startsWith('---'));
  assert.match(intent, /Brand and user experience are separate specialist jobs/);
  assert.match(intent, /fixed number of artificial variants/);
  assert.match(intent, /do not establish a production\s+design system, production user interface/i);
});

test('the validation workflow registers product-design tests', () => {
  const workflow = read('.github/workflows/validate-skills.yml');
  assert.match(workflow, /skills\/product-design\/product-design\.conformance\.test\.mjs/);
  assert.match(workflow, /skills\/product-design\/_atoms\/approval-binding\/approval-binding\.test\.mjs/);
});
