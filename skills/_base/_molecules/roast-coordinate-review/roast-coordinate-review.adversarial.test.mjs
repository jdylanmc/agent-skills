import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, validateRepository } from '../../../../scripts/validate-skill-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MOLECULE = '_base/_molecules/roast-coordinate-review/roast-coordinate-review.md';
const CONSUMERS = ['roast-this-agent', 'roast-this-prompt', 'roast-this-skill'];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, 'skills', relativePath), 'utf8');
}

test('all artifact-roast skills compose the shared orchestration molecule', () => {
  const graph = validateRepository(ROOT);
  for (const skill of CONSUMERS) {
    const closure = closureFor(graph, `${skill}/SKILL.md`);
    assert.ok(closure.includes(MOLECULE), `${skill} must compose ${MOLECULE}`);
    assert.ok(closure.includes('_base/_atoms/agent-resolve/agent-resolve.md'));
    assert.ok(closure.includes('_base/_atoms/agent-spawn/agent-spawn.md'));
    assert.ok(closure.includes('_base/_atoms/review-validate-report/review-validate-report.md'));
  }
});

test('the molecule preserves the strict coordinate and synthesize contract', () => {
  const molecule = read(MOLECULE);
  const normalized = molecule.replace(/\s+/g, ' ').toLowerCase();
  for (const required of [
    'response exactly as returned',
    'Retry exactly once',
    'new Agent spawn carrying no failed-run context',
    'Status: Unsynthesized',
    'Do not run synthesis on an invalid envelope',
    'valid envelope unchanged',
    'Schema version: 1',
    'empty findings section is not evidence of quality',
    'first-line rule',
    'section cardinality',
    'cross-section relationship',
    'nested report contract',
    'forbidden-content rule',
    'unevaluable rule',
  ]) {
    assert.ok(
      normalized.includes(required.toLowerCase()),
      `missing shared requirement: ${required}`,
    );
  }
});

test('the validator can represent the complete envelope checklist', () => {
  const validator = read('_base/_atoms/review-validate-report/review-validate-report.md');
  for (const input of [
    'required-first-line',
    'required-values',
    'section-constraints',
    'cross-section-constraints',
    'nested-report-contracts',
    'forbidden-content',
  ]) {
    assert.match(validator, new RegExp(`\\\`${input}\\\``), `missing validator input ${input}`);
  }

  for (const defect of [
    'First-line mismatch',
    'Value mismatch',
    'Cardinality violation',
    'Cross-section mismatch',
    'Mutual-exclusion violation',
    'Invalid nested report',
    'Forbidden content',
    'Unevaluable requirement',
  ]) {
    assert.match(validator, new RegExp(defect), `missing validator defect ${defect}`);
  }
});

test('caller-specific boundaries remain with each roast skill', () => {
  const agent = read('roast-this-agent/SKILL.md');
  assert.match(agent, /explicitly linked in-scope prompt files/);
  assert.match(agent, /Never invoke the reviewed agent/);
  assert.match(agent, /agent roast contract/);

  const prompt = read('roast-this-prompt/SKILL.md');
  assert.match(prompt, /normalize\s+line endings/);
  assert.match(prompt, /supplied-text identifier/);
  assert.match(prompt, /re-supply\s+it\s+with\s+its\s+identifier/);
  assert.match(prompt, /Never execute the reviewed prompt/);

  const skill = read('roast-this-skill/SKILL.md');
  assert.match(skill, /Never run the reviewed package, its bundled scripts, or its declared tools/);
  assert.match(skill, /skill roast contract/);

  for (const caller of [agent, prompt, skill]) {
    assert.doesNotMatch(caller, /Launch a fresh read-only task subagent/);
    assert.match(caller, /roast-coordinate-review/);
    assert.match(caller, /Failure reporting and recovery/);
    assert.match(caller, /verified coordinator document/);
    assert.match(caller, /complete coordinate-mode and synthesize-mode\s+input sets/);
  }
});

test('each artifact contract retains its complete envelope-specific rules', () => {
  const contracts = {
    agent: read('roast-this-agent/references/10-agent-roast-contract.md'),
    prompt: read('roast-this-prompt/references/10-prompt-roast-contract.md'),
    skill: read('roast-this-skill/references/10-skill-roast-contract.md'),
  };

  for (const [artifactType, contract] of Object.entries(contracts)) {
    assert.match(contract, /The first line is `# Artifact Roast Envelope`/);
    assert.match(contract, new RegExp(`\\\`Artifact type\\\` is \\\`${artifactType}\\\``));
    assert.match(contract, /no more than five entries/);
    assert.match(contract, /exactly one report per roster entry/);
    assert.match(contract, /and never in both/);
    assert.match(contract, /END ARTIFACT ROAST ENVELOPE/);
  }

  assert.match(contracts.prompt, /No section contains the full supplied prompt body/);
});
