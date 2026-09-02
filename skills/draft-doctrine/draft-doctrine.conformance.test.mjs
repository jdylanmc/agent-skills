import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(ROOT, 'skills');
const ENTRY = 'draft-doctrine/SKILL.md';
const TOOLS = ['execute', 'read', 'search', 'task'];
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const flat = (relative) => read(relative).replace(/\s+/g, ' ');
const frontmatter = (relative) => readFrontmatter(read(path.join('skills', relative)), relative);

test('draft-doctrine is human-only and targets exactly one create or update', () => {
  const parsed = frontmatter(ENTRY);
  assert.equal(parsed.name, 'draft-doctrine');
  assert.equal(parsed.disableModelInvocation, true);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.allowedTools, TOOLS);
  assert.deepEqual(parsed.requiresSkills, [{ id: 'prompt-coach', source: 'local', required: true }]);
  assert.match(parsed.description, /exactly one/);
});

test('composition is local-first, directly records, and reaches deterministic boundaries', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'draft-doctrine/_molecules/doctrine-authoring/doctrine-authoring.md',
  ]);
  const closure = closureFor(validateRepository(ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    '_base/_atoms/doctrine-evaluate/doctrine-evaluate.md',
    '_base/_atoms/contradiction-check/contradiction-check.md',
    'draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.md',
  ]) assert.ok(closure.includes(unit), `missing ${unit}`);
  const derived = deriveGraph(ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) required.add(tool);
  }
  assert.deepEqual([...required].filter((tool) => !TOOLS.includes(tool)).sort(), []);
  assert.deepEqual(derived.grantViolations, []);
});

test('intent is plain human wording and records the authority boundary', () => {
  const intent = read('skills/draft-doctrine/intent.md');
  assert.match(intent, /^# Intent: draft-doctrine/);
  assert.doesNotMatch(intent, /^---/);
  assert.match(intent, /human in control/);
  assert.match(intent, /silently adding, broadening, or resolving policy/);
});

test('root owns Prompt Coach dispatch and molecule receives bound coaching evidence', () => {
  const skill = flat('skills/draft-doctrine/SKILL.md');
  const molecule = flat('skills/draft-doctrine/_molecules/doctrine-authoring/doctrine-authoring.md');
  assert.match(skill, /Invoke the required local `prompt-coach` skill through the root `task` permission/);
  assert.match(molecule, /Receive the Prompt Coach report and human disposition from the root skill/);
  assert.doesNotMatch(molecule, /Invoke the locally required/);
  assert.match(molecule, /exactly those bytes/);
  assert.match(molecule, /coaching, never approval/);
  assert.match(molecule, /digest mismatch stops/);
});

test('manifest and doctrine verification is strict and selective', () => {
  const atom = flat('skills/draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.md');
  assert.match(atom, /strictly parses/);
  assert.match(atom, /verifies every declared doctrine path and digest/);
  assert.match(atom, /returns text only for the selected target and directly relevant/);
  assert.match(atom, /symbolic links, hard links, path escapes/i);
  assert.match(atom, /`<id>\.doctrine\.md`/);
  assert.match(atom, /case-fold or Unicode normalization collisions on every platform/);
});

test('approval binds exact bytes and every prior revision with separate NOTICE approval', () => {
  const atom = flat('skills/draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.md');
  for (const phrase of [
    'candidate digest',
    'prior doctrine digest and revision',
    'prior manifest digest and revision',
    'second approval',
    'prior NOTICE digest and revision',
  ]) assert.match(atom, new RegExp(phrase, 'i'));
  assert.match(atom, /correction changes the candidate digest and approval identity/);
  assert.match(atom, /summary approval, silence, unrelated text/);
});

test('new doctrine candidates are bounded below 500 words', () => {
  const skill = flat('skills/draft-doctrine/SKILL.md');
  const molecule = flat('skills/draft-doctrine/_molecules/doctrine-authoring/doctrine-authoring.md');
  const atom = flat('skills/draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.md');
  const intent = flat('skills/draft-doctrine/intent.md');
  for (const surface of [skill, molecule, atom, intent]) {
    assert.match(surface, /fewer than 500 words/);
  }
  assert.match(atom, /complete document/);
  assert.match(atom, /Updates preserve existing doctrine length/);
});

test('persistence is bounded, rollback-aware, reread-verified, and never publishes', () => {
  const skill = flat('skills/draft-doctrine/SKILL.md');
  const atom = flat('skills/draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.md');
  assert.match(skill, /There is no direct `edit` grant/);
  assert.match(skill, /Never write doctrine before approval|Do not write before approval/i);
  assert.match(atom, /snapshots all prior bytes/);
  assert.match(atom, /reverses caught partial commits/);
  assert.match(atom, /complete manifest and every declared doctrine digest/);
  assert.match(atom, /hard process termination is not rolled back or reported in-process/i);
  assert.match(atom, /optional NOTICE first, selected doctrine second.*manifest last/i);
  assert.match(atom, /early NOTICE-only side effect is a residual limitation/i);
  assert.match(atom, /Success is returned only after writer readback/i);
  assert.match(skill, /never an automatic action/);
});

test('adapted provenance and overlap evidence are closed, human-decided, and approval-bound', () => {
  const atom = flat('skills/draft-doctrine/_atoms/doctrine-transaction/doctrine-transaction.md');
  assert.match(atom, /closed verification record/);
  assert.match(atom, /never judges license compatibility/);
  assert.match(atom, /complete prepared envelope is recomputed/);
  assert.match(atom, /Relevant doctrine identities and digests are approval-bound/);
  assert.match(atom, /artifact order and preview order are bound/i);
  assert.match(atom, /unchanged entry in the shared write-gate transaction/i);
  assert.match(atom, /author, license identifier, and source locator/i);
  assert.match(atom, /repository root and doctrine directory are separately pinned/i);
});

test('output contract contains every required evidence surface and status', () => {
  const skill = flat('skills/draft-doctrine/SKILL.md');
  for (const status of ['needs-input', 'needs-source', 'needs-decision', 'needs-approval', 'approved-and-written', 'blocked', 'cancelled']) {
    assert.match(skill, new RegExp(status));
  }
  for (const phrase of [
    'operation, target identifier, and path',
    'Prompt Coach report',
    'overlap and contradiction evidence',
    'exact approval records',
    'changed paths and reread digests',
    'unresolved human decisions',
    'publication status or next review action',
    'Chronicler log path or recording defect',
  ]) assert.match(skill, new RegExp(phrase, 'i'));
});
