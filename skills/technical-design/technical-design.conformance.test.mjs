import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import { DESIGN_STATUSES } from './_molecules/engineering-design/engineering-design.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = 'technical-design/SKILL.md';
const MOLECULE = 'technical-design/_molecules/engineering-design/engineering-design.md';
const UNITS = [
  'technical-design/_atoms/design-intake/design-intake.md',
  'technical-design/_atoms/design-impact/design-impact.md',
  'technical-design/_atoms/approach-analysis/approach-analysis.md',
  'technical-design/_atoms/design-document/design-document.md',
  'technical-design/_atoms/nfr-proposals/nfr-proposals.md',
  'technical-design/_atoms/design-outcome/design-outcome.md',
];
const read = (relative) => fs.readFileSync(path.join(ROOT, 'skills', relative), 'utf8');
const flat = (relative) => read(relative).replace(/\s+/g, ' ');
const frontmatter = (relative) => readFrontmatter(read(relative), relative);

test('technical-design is routable and refuses adjacent lifecycle jobs', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'technical-design');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.allowedTools, ['edit', 'execute', 'read', 'search']);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.match(parsed.description, /Architecture Requirements\/Design Document \(ARD\)/);
  for (const boundary of ['reopen or edit functional requirements', 'approve proposed non-functional requirements', 'Quality Assurance', 'decompose tickets', 'mutate trackers', 'implement']) {
    assert.match(parsed.description, new RegExp(boundary, 'i'));
  }
});

test('the local-first composition closes over every technical-design unit', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    MOLECULE,
  ]);
  const closure = closureFor(validateRepository(ROOT), ENTRY);
  for (const unit of [MOLECULE, ...UNITS]) assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);

  const derived = deriveGraph(ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual([...required].filter((tool) => !parsed.allowedTools.includes(tool)).sort(), []);
});

test('functional requirements stay immutable and traceable', () => {
  const entry = flat(ENTRY);
  const intake = flat('technical-design/_atoms/design-intake/design-intake.md');
  assert.match(entry, /Functional requirements are immutable/);
  assert.match(entry, /Preserve their identifiers and text/);
  assert.match(entry, /product-requirement-to-design traceability/);
  assert.match(intake, /full document never overrides the nano document/);
  assert.match(intake, /never writes product intent/);
});

test('the package emits one design document plus ADRs, never a nano-full pair', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /Write exactly one engineering design document/);
  assert.match(entry, /plus one ADR per independently durable decision/);
  assert.match(entry, /Do not create a nano\/full design pair/);
});

test('consequential decisions compare at least two viable cited approaches', () => {
  const atom = flat('technical-design/_atoms/approach-analysis/approach-analysis.md');
  assert.match(atom, /at least two \*\*viable\*\* approaches/);
  assert.match(atom, /straw option does not count/);
  assert.match(atom, /Evaluate every approach against the same criteria/);
  assert.match(atom, /Cite evidence for each material comparison/);
});

test('no-design-required has one deterministic documented gate', () => {
  const impact = flat('technical-design/_atoms/design-impact/design-impact.md');
  const outcome = flat('technical-design/_atoms/design-outcome/design-outcome.md');
  assert.match(impact, /`designRequired` is the Boolean OR of all answers/);
  assert.match(impact, /every functional requirement has one traceability row/);
  assert.match(impact, /Omission is never a disposition/);
  assert.match(outcome, /the no-design-required gate/);
});

test('the design addresses required engineering surfaces with cited applicability', () => {
  const document = flat('technical-design/_atoms/design-document/design-document.md');
  for (const surface of ['Interfaces and schemas', 'Failure, retry, degradation, recovery', 'Compatibility, migration, and versioning', 'Verification strategy', 'Rollout, observation, rollback']) {
    assert.match(document, new RegExp(surface, 'i'));
  }
  assert.match(document, /For an inapplicable section, write `Not applicable`, the reason, and a citation/);
  assert.match(document, /Every material claim .* cites an exact repository path/);
});

test('proposed NFR authority is separate, explicit, and unavailable downstream', () => {
  const entry = flat(ENTRY);
  const nfr = flat('technical-design/_atoms/nfr-proposals/nfr-proposals.md');
  assert.match(entry, /remain `proposed` and non-authoritative until a separate human approval process records approval evidence/);
  assert.match(entry, /This skill never changes a proposal to `approved`/);
  assert.match(nfr, /Design approval is not NFR approval/);
  assert.match(nfr, /Co-location in one change request is not NFR approval/);
  assert.match(nfr, /Quality Assurance design and requirements breakdown must not treat the proposal as authority/);
});

test('the status vocabulary matches the deterministic resolver', () => {
  assert.deepEqual(DESIGN_STATUSES, [
    'blocked',
    'needs-decision',
    'needs-evidence',
    'no-design-required',
    'complete',
  ]);
  const entry = flat(ENTRY);
  for (const status of DESIGN_STATUSES) assert.match(entry, new RegExp(`\\\`${status}\\\``));
});

test('handoff sequences settled design and separately approved NFRs into downstream design and planning', () => {
  const entry = flat(ENTRY);
  assert.match(entry, /approved functional specification\s*-> technical-design\s*-> separately approved shared NFRs, when proposed\s*-> qa-design \+ requirements-breakdown/);
  assert.match(entry, /only shared non-functional requirements whose authority is `approved`/);
  assert.match(entry, /does not create tickets/);
});
