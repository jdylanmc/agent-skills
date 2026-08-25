import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { closureFor, readFrontmatter, validateRepository } from '../../scripts/validate-skill-graph.mjs';
import { deriveGraph, unitClosure } from '../../scripts/derive-skill-graph.mjs';
import {
  buildVerificationVerdict,
  computeArtifactIdentity,
  validateVerificationVerdict,
} from './_atoms/verdict-binding/verdict-binding.mjs';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS_ROOT = path.join(REPOSITORY_ROOT, 'skills');
const ENTRY = 'verification-verdict/SKILL.md';
const PINNED_TOOLS = ['execute', 'read'];

function read(relativePath) {
  return fs.readFileSync(path.join(SKILLS_ROOT, ...relativePath.split('/')), 'utf8');
}

function frontmatter(relativePath) {
  return readFrontmatter(read(relativePath), relativePath);
}

function flat(relativePath) {
  return read(relativePath).replace(/\s+/g, ' ');
}

function verdictFor(outcome, overrides = {}) {
  const evidenceStrength = overrides.evidenceStrength
    ?? (outcome === 'VERIFIED' ? 'direct' : outcome === 'BLOCKED' ? 'unavailable' : 'incomplete');
  const evidencePointers = overrides.evidencePointers ?? (outcome === 'BLOCKED' ? [] : [{ kind: 'fixture', ref: `evidence-${outcome}` }]);
  return buildVerificationVerdict({
    artifact: 'artifact revision one',
    outcome,
    claim: 'the fixture satisfies the declared check',
    evidenceStrength,
    evidencePointers,
    checkedAt: '2026-08-25T00:00:00.000Z',
  });
}

test('verification-verdict is user-invocable and narrowly granted', () => {
  const parsed = frontmatter(ENTRY);

  assert.equal(parsed.name, 'verification-verdict');
  assert.equal(parsed.disableModelInvocation, false);
  assert.equal(parsed.userInvocable, true);
  assert.deepEqual(parsed.requiresSkills, []);
  assert.deepEqual(parsed.allowedTools, PINNED_TOOLS);
  assert.ok(!parsed.allowedTools.includes('edit'));
  assert.ok(!parsed.allowedTools.includes('search'));
  assert.ok(!parsed.allowedTools.includes('task'));
  assert.ok(!parsed.allowedTools.includes('*'));
});

test('the routing description has positive and negative triggers', () => {
  const { description } = frontmatter(ENTRY);

  assert.match(description, /artifact-bound verification verdicts/);
  assert.match(description, /VERIFIED/);
  assert.match(description, /NOT_VERIFIED/);
  assert.match(description, /INCONCLUSIVE/);
  assert.match(description, /BLOCKED/);
  assert.match(description, /Use when asked whether/);
  assert.match(description, /Do not use/);
  assert.match(description, /approve/);
  assert.match(description, /reuse stale evidence/);
});

test('the skill composes chronicler and local verdict molecule', () => {
  const parsed = frontmatter(ENTRY);
  assert.deepEqual(parsed.composes, [
    '_base/_molecules/chronicler/chronicler.md',
    'verification-verdict/_molecules/artifact-verification-verdict/artifact-verification-verdict.md',
  ]);

  const closure = closureFor(validateRepository(REPOSITORY_ROOT), ENTRY);
  for (const unit of [
    '_base/_molecules/chronicler/chronicler.md',
    'verification-verdict/_molecules/artifact-verification-verdict/artifact-verification-verdict.md',
    'verification-verdict/_atoms/artifact-identity/artifact-identity.md',
    'verification-verdict/_atoms/verdict-vocabulary/verdict-vocabulary.md',
    'verification-verdict/_atoms/verdict-binding/verdict-binding.md',
  ]) {
    assert.ok(closure.includes(unit), `${ENTRY} must reach ${unit}`);
  }
});

test('nothing in the closure widens the pinned grant', () => {
  const derived = deriveGraph(REPOSITORY_ROOT);
  const required = new Set();
  for (const unit of unitClosure(derived.result.graph, ENTRY)) {
    for (const tool of derived.resolvedTools.get(unit) ?? []) {
      required.add(tool);
    }
  }

  const excess = [...required].filter((tool) => !PINNED_TOOLS.includes(tool)).sort();
  assert.deepEqual(excess, [], `a composed unit needs ${excess.join(', ')}`);
  assert.deepEqual(derived.grantViolations, []);
});

test('all four outcomes are valid vocabulary but only VERIFIED passes', () => {
  const expectations = new Map([
    ['VERIFIED', true],
    ['NOT_VERIFIED', false],
    ['INCONCLUSIVE', false],
    ['BLOCKED', false],
  ]);

  for (const [outcome, shouldPass] of expectations) {
    const verdict = verdictFor(outcome);
    const result = validateVerificationVerdict({ artifact: 'artifact revision one', verdict });

    assert.equal(result.valid, true, `${outcome} should be well formed`);
    assert.equal(result.pass, shouldPass, `${outcome} pass semantics`);
    assert.equal(result.approval, false, `${outcome} never approves`);
    assert.deepEqual(result.defects, []);
  }
});

test('a verdict presented for a mutated artifact fails closed', () => {
  const verdict = verdictFor('VERIFIED');
  const result = validateVerificationVerdict({ artifact: 'artifact revision two', verdict });

  assert.equal(result.valid, false);
  assert.equal(result.pass, false);
  assert.equal(result.approval, false);
  assert.ok(result.defects.includes('Artifact identity mismatch'));
});

test('a missing artifact identity fails closed', () => {
  const verdict = { ...verdictFor('VERIFIED') };
  delete verdict.artifactIdentity;

  const result = validateVerificationVerdict({ artifact: 'artifact revision one', verdict });

  assert.equal(result.valid, false);
  assert.equal(result.pass, false);
  assert.ok(result.defects.includes('Missing artifact identity'));
});

test('a stale or tampered identity fails closed', () => {
  const verdict = {
    ...verdictFor('VERIFIED'),
    artifactIdentity: {
      ...verdictFor('VERIFIED').artifactIdentity,
      value: computeArtifactIdentity('old artifact').value,
    },
  };

  const result = validateVerificationVerdict({ artifact: 'artifact revision one', verdict });

  assert.equal(result.valid, false);
  assert.equal(result.pass, false);
  assert.ok(result.defects.includes('Stale or tampered artifact identity'));
  assert.ok(result.defects.includes('Artifact identity mismatch'));
});

test('missing current identity fails closed instead of trusting the verdict alone', () => {
  const verdict = verdictFor('VERIFIED');
  const result = validateVerificationVerdict({ verdict });

  assert.equal(result.valid, false);
  assert.equal(result.pass, false);
  assert.ok(result.defects.includes('Missing current artifact identity'));
});

test('mutable branch identity cannot produce a passing verdict', () => {
  const artifactIdentity = {
    kind: 'git-branch',
    value: 'main',
    scope: 'repository',
    source: 'branch',
  };
  const verdict = {
    ...verdictFor('VERIFIED'),
    artifactIdentity,
    artifactIdentityFingerprint: 'not-a-current-fingerprint',
    verdictBindingFingerprint: 'not-a-current-binding',
  };

  const result = validateVerificationVerdict({ currentIdentity: artifactIdentity, verdict });

  assert.equal(result.valid, false);
  assert.equal(result.pass, false);
  assert.ok(result.defects.includes('Mutable or unsupported artifact identity'));
});

test('a missing or mismatched claim fails closed', () => {
  const missingClaim = { ...verdictFor('VERIFIED'), claim: '' };
  const alteredClaim = { ...verdictFor('VERIFIED'), claim: 'a different claim' };

  const missing = validateVerificationVerdict({ artifact: 'artifact revision one', verdict: missingClaim });
  const mismatched = validateVerificationVerdict({
    artifact: 'artifact revision one',
    verdict: alteredClaim,
    expectedClaim: 'the fixture satisfies the declared check',
  });

  assert.equal(missing.pass, false);
  assert.ok(missing.defects.includes('Missing claim'));
  assert.equal(mismatched.pass, false);
  assert.ok(mismatched.defects.includes('Claim mismatch'));
  assert.ok(mismatched.defects.includes('Stale or tampered verdict binding'));
});

test('placeholder evidence pointers do not satisfy a passing verdict', () => {
  for (const evidencePointers of [[null], [{}], [''], [{ kind: 'ci' }], [{ kind: 'ci', ref: 'latest' }]]) {
    const verdict = verdictFor('VERIFIED', { evidencePointers });
    const result = validateVerificationVerdict({ artifact: 'artifact revision one', verdict });

    assert.equal(result.pass, false, JSON.stringify(evidencePointers));
    assert.ok(result.defects.includes('Missing evidence pointer'));
  }
});

test('evidence strength and pointers are required for passing verification', () => {
  const weakVerdict = verdictFor('VERIFIED', { evidenceStrength: 'self-reported' });
  const pointerlessVerdict = verdictFor('VERIFIED', { evidencePointers: [] });

  const weak = validateVerificationVerdict({ artifact: 'artifact revision one', verdict: weakVerdict });
  const pointerless = validateVerificationVerdict({ artifact: 'artifact revision one', verdict: pointerlessVerdict });

  assert.equal(weak.pass, false);
  assert.ok(weak.defects.includes('Verified verdict lacks direct evidence'));
  assert.equal(pointerless.pass, false);
  assert.ok(pointerless.defects.includes('Missing evidence pointer'));
});

test('green CI and reports remain evidence only, never approval', () => {
  const ciGreenVerdict = { ...verdictFor('VERIFIED'), grantsApproval: true };
  const result = validateVerificationVerdict({ artifact: 'artifact revision one', verdict: ciGreenVerdict });

  assert.equal(result.valid, false);
  assert.equal(result.pass, false);
  assert.equal(result.approval, false);
  assert.ok(result.defects.includes('Verdict must not grant approval'));
});

test('the written contract separates run-ci envelopes and report-shape validation', () => {
  const entry = flat(ENTRY);
  const molecule = flat('verification-verdict/_molecules/artifact-verification-verdict/artifact-verification-verdict.md');

  assert.match(entry, /Preserve source evidence vocabulary/);
  assert.match(entry, /run-ci's `failed`, `cancelled`, `environment-failed`, `intermittent`, and `incomplete`/);
  assert.match(entry, /A report is evidence only/);
  assert.match(entry, /does not decide whether a report's findings are correct/);
  assert.match(molecule, /Do not duplicate Continuous Integration \(CI\) result classification/);
  assert.match(molecule, /Do not use review report contract validation as correctness validation/);
});

test('the package carries a plain human-readable intent', () => {
  const intent = fs.readFileSync(path.join(SKILLS_ROOT, 'verification-verdict', 'intent.md'), 'utf8');

  assert.match(intent, /^# Intent: verification-verdict\s*$/m);
  assert.ok(!intent.startsWith('---'));
  const normalized = intent.replace(/\s+/g, ' ');
  assert.match(normalized, /artifact binding/);
  assert.match(normalized, /Continuous Integration \(CI\) green results/);
  assert.match(normalized, /routable because no existing skill composes it today/);
});

test('the workflow registers the verification-verdict conformance suite explicitly', () => {
  const workflow = fs.readFileSync(
    path.join(REPOSITORY_ROOT, '.github', 'workflows', 'validate-skills.yml'),
    'utf8',
  );

  assert.match(workflow, /skills\/verification-verdict\/verification-verdict\.conformance\.test\.mjs/);
});
