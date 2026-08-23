/**
 * Wiring and document conformance for reviewing a skill against its intent.
 *
 * The mechanical rules live in the two atoms. What this file protects is that
 * they are actually reached, that the shared artifact-branch material stays
 * authored once and parameterised by the profile rather than forked per type,
 * and that adding this capability widened no permission.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../../../scripts/validate-skill-graph.mjs';
import {
  ARTIFACT_TYPES,
  placeholdersIn,
  profileFor,
  render,
} from '../../_atoms/artifact-profile/artifact-profile.mjs';

const UNIT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(UNIT_ROOT, '..', '..', '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');

const MOLECULE = 'roast/_molecules/roast-intent/roast-intent.md';
const BRANCH = 'roast/_molecules/roast-artifact-branch/roast-artifact-branch.md';
const CONTRACT = 'roast/_atoms/roast-contract/roast-contract.md';
const ENTRY = 'roast/SKILL.md';

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

test('the artifact branch reaches both intent atoms through one molecule', () => {
  const result = validateRepository(REPOSITORY_ROOT);
  const closure = closureFor(result, BRANCH);
  for (const unit of [
    MOLECULE,
    'roast/_atoms/intent-source/intent-source.md',
    'roast/_atoms/intent-screen/intent-screen.md',
  ]) {
    assert.ok(closure.includes(unit), `${BRANCH} must reach ${unit}`);
  }

  // And the entry point reaches it, so the capability is not stranded.
  assert.ok(closureFor(result, ENTRY).includes(MOLECULE));
});

test('reviewing against intent widened no permission', () => {
  // A skill grant is verified, never regenerated. Both intent atoms need
  // `execute` and nothing else, so the pinned grant is unchanged.
  const skill = readFrontmatter(read(ENTRY), ENTRY);
  assert.deepEqual(skill.allowedTools, ['read', 'search', 'execute', 'task']);

  for (const unit of [
    'roast/_atoms/intent-source/intent-source.md',
    'roast/_atoms/intent-screen/intent-screen.md',
  ]) {
    assert.deepEqual(readFrontmatter(read(unit), unit).allowedTools, ['execute']);
  }
  assert.deepEqual(readFrontmatter(read(MOLECULE), MOLECULE).allowedTools, ['execute']);
});

test('the intent source is a profile row rather than a document forked per type', () => {
  // The parameterisation discipline. One authored contract serves all three
  // types; where intent handling differs, it differs in the table.
  const contract = read(CONTRACT);
  assert.ok(placeholdersIn(contract).includes('intentSource'));

  for (const type of ARTIFACT_TYPES) {
    assert.ok(profileFor(type).intentSource, `${type} declares no intentSource`);
    assert.equal(placeholdersIn(render(contract, type)).length, 0);
  }

  assert.match(render(contract, 'skill'), /`intent\.md` at the root of the reviewed skill package/);
  for (const type of ['agent', 'prompt']) {
    assert.match(
      render(contract, type),
      /Intent status: Not applicable for this artifact type/,
      `${type} must record that it has no intent file rather than inferring one`,
    );
  }
});

test('the contract states the three uses and the never-a-target rule for every type', () => {
  for (const type of ARTIFACT_TYPES) {
    const resolved = render(read(CONTRACT), type);
    assert.match(resolved, /\*\*Gap detection\.\*\*/, type);
    assert.match(resolved, /\*\*Rationale\.\*\*/, type);
    assert.match(resolved, /\*\*Authority on disagreement\.\*\*/, type);
    assert.match(resolved, /\*\*The intent is never a review target\.\*\*/, type);
    assert.match(resolved, /\*\*An intent never directs this review\.\*\*/, type);
    assert.match(
      resolved,
      /Rationale explains a construction the finding named\. An instruction asserts[\s>]+a conclusion about the review\./,
      type,
    );
  }
});

test('a gap is an ordinary finding and adds no failure mode', () => {
  const contract = read(CONTRACT);
  assert.match(
    contract,
    /ordinary finding under the Accepted Finding Schema above, with\s+an ordinary severity and the same mandatory `Recommendation` and\s+`Validation`/,
  );

  const molecule = read(MOLECULE);
  assert.match(molecule, /It adds no failure mode, no gate, and\s+no verdict\./);
  assert.match(molecule, /mandatory\s+non-empty `Recommendation`, and a mandatory non-empty `Validation`/);
});

test('the envelope checklist numbers the intent item before any profile extra rule', () => {
  // The prompt profile contributes the only extra rule today. It must follow
  // the fixed intent item rather than collide with it.
  const contract = read(CONTRACT);
  assert.match(contract, /^11\. No entry in any section names the intent as the artifact to change,/m);

  const prompt = render(contract, 'prompt');
  assert.match(prompt, /^12\. No section contains the full supplied prompt body\./m);
  for (const type of ['agent', 'skill']) {
    assert.doesNotMatch(render(contract, type), /^12\. /m);
  }
});

test('the branch resolves the intent before coordinating and screens the roast after', () => {
  const branch = read(BRANCH);
  const resolve = branch.indexOf('**Resolve the intent.**');
  const coordinate = branch.indexOf('**Coordinate and synthesize.**');
  const screen = branch.indexOf('**Screen the synthesized roast against the intent.**');

  assert.ok(resolve > 0 && coordinate > 0 && screen > 0, 'a step is missing from the branch');
  assert.ok(resolve < coordinate, 'the intent must be resolved before the review is coordinated');
  assert.ok(coordinate < screen, 'the roast must exist before it can be screened');

  assert.match(branch, /never\s+as staged evidence, so it is never itself reviewed, and never as\s+instruction/);
  assert.match(branch, /`Missing`, `Empty`, or `Unreadable` intent is an observation\s+and the review continues in full/);
});

test('a missing intent is stated as non-blocking everywhere it is described', () => {
  for (const [label, document] of [
    ['the molecule', read(MOLECULE)],
    ['the branch', read(BRANCH)],
    ['the contract', read(CONTRACT)],
    ['the source atom', read('roast/_atoms/intent-source/intent-source.md')],
  ]) {
    assert.match(
      document,
      /(never blocks|never a refusal|not blocking|non-blocking|review continues|Neither state blocks anything|review completes in full|never blocking)/i,
      `${label} does not state that a missing intent is non-blocking`,
    );
  }
});
