import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { validateFiles, validateSpecPair } from './spec-pair.mjs';

const ROOT = '/repo/docs/agent/specs';

function nano(overrides = {}) {
  return `# Faster checkout

- Spec ID: ${overrides.specId ?? 'SPEC-FASTER-CHECKOUT'}
- Source: ${overrides.source ?? 'docs/agent/discovery/faster-checkout.md'}
- Source revision: ${overrides.revision ?? 'a'.repeat(64)}
- Full specification: [Supporting context](./faster-checkout.full.md)

## Intention

Customers can select an eligible payment method without leaving checkout.

## Acceptance Criteria

- AC-001: An eligible customer can see the additional payment method.
- AC-002: An ineligible customer sees the existing checkout unchanged.

## Non-goals

- Selecting a payment-provider implementation.
`;
}

function full(overrides = {}) {
  return `# Faster checkout - Full specification

- Spec ID: ${overrides.specId ?? 'SPEC-FASTER-CHECKOUT'}
- Source: ${overrides.source ?? 'docs/agent/discovery/faster-checkout.md'}
- Source revision: ${overrides.revision ?? 'a'.repeat(64)}
- Nano authority: [Authoritative product intent](./faster-checkout.nano.md)

## Authority

The nano sibling is authoritative. This document elaborates it.

## Problem and Users

Eligible customers need another checkout payment choice.

## Outcomes and Success

The outcomes are defined by AC-001 and AC-002.

## Scope and Non-goals

Checkout selection is in scope. Provider implementation is not.

## Constraints and Dependencies

No additional confirmed constraints.

## Confirmed Facts

The current checkout offers one method.

## Assumptions

None.

## Contradictions

None.

## Alternatives and Examples

Supporting examples remain non-authoritative.

## Product Requirements

- REQ-001 [AC-001]: Show the method to eligible customers.
- REQ-002 [AC-002]: Preserve existing behavior for ineligible customers.

## Product Decisions

- DEC-001 [INTENT]: Keep product behavior independent of provider structure.

## Traceability

| Nano authority | Discovery evidence |
| --- | --- |
| AC-001 | Confirmed checkout research |
| AC-002 | Existing eligibility decision |

## Open Questions

None.
`;
}

function validate(nanoText = nano(), fullText = full()) {
  return validateSpecPair({
    repositoryRoot: '/repo',
    nanoPath: `${ROOT}/faster-checkout.nano.md`,
    fullPath: `${ROOT}/faster-checkout.full.md`,
    nanoText,
    fullText,
    expectedSource: 'docs/agent/discovery/faster-checkout.md',
    expectedRevision: 'a'.repeat(64),
  });
}

function code(run) {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
}

test('validates one identity-bound, mutually linked specification pair', () => {
  const result = validate();
  assert.equal(result.status, 'valid');
  assert.equal(result.specId, 'SPEC-FASTER-CHECKOUT');
  assert.deepEqual(result.acceptanceCriteria, ['AC-001', 'AC-002']);
  assert.equal(result.requirements, 2);
});

test('requires the pair beneath docs/agent/specs with one slug', () => {
  assert.equal(code(() => validateSpecPair({
    repositoryRoot: '/repo',
    nanoPath: '/repo/specs/faster.nano.md',
    fullPath: '/repo/specs/faster.full.md',
    nanoText: nano(),
    fullText: full(),
    expectedSource: 'docs/agent/discovery/faster-checkout.md',
    expectedRevision: 'a'.repeat(64),
  })), 'invalid-path');
});

test('refuses a matching-looking pair rooted in another repository', () => {
  assert.equal(code(() => validateSpecPair({
    repositoryRoot: '/repo',
    nanoPath: '/other/repo/docs/agent/specs/faster-checkout.nano.md',
    fullPath: '/other/repo/docs/agent/specs/faster-checkout.full.md',
    nanoText: nano(),
    fullText: full(),
    expectedSource: 'docs/agent/discovery/faster-checkout.md',
    expectedRevision: 'a'.repeat(64),
  })), 'invalid-path');
});

test('keeps nano deliberately narrow', () => {
  assert.equal(
    code(() => validate(nano().replace('## Non-goals', '## Architecture'))),
    'invalid-nano',
  );
});

test('requires matching identity and provenance', () => {
  assert.equal(code(() => validate(nano(), full({ specId: 'SPEC-OTHER' }))), 'identity-mismatch');
  assert.equal(
    code(() => validate(nano(), full({ revision: 'b'.repeat(64) }))),
    'identity-mismatch',
  );
});

test('binds pair provenance to the validated Discovery record', () => {
  assert.equal(code(() => validateSpecPair({
    repositoryRoot: '/repo',
    nanoPath: `${ROOT}/faster-checkout.nano.md`,
    fullPath: `${ROOT}/faster-checkout.full.md`,
    nanoText: nano(),
    fullText: full(),
    expectedSource: 'https://github.com/example/app/issues/42',
    expectedRevision: 'issue-42@1',
  })), 'identity-mismatch');
});

test('full requirements cannot become authority without a nano reference', () => {
  const unlinked = full().replace(
    '- REQ-001 [AC-001]: Show the method to eligible customers.',
    '- REQ-001: Show the method to eligible customers.',
  );
  assert.equal(code(() => validate(nano(), unlinked)), 'untraceable-authority');
});

test('full requirements cannot reference a nonexistent acceptance criterion', () => {
  const unknown = full().replace('[AC-001]', '[AC-999]');
  assert.equal(code(() => validate(nano(), unknown)), 'untraceable-authority');
});

test('traceability accounts for every nano acceptance criterion', () => {
  const missing = full().replace('| AC-002 | Existing eligibility decision |\n', '');
  assert.equal(code(() => validate(nano(), missing)), 'missing-traceability');
});

test('sibling links are exact and relative', () => {
  const wrong = nano().replace('./faster-checkout.full.md', '../other.full.md');
  assert.equal(code(() => validate(wrong, full())), 'invalid-link');
});

test('metadata examples inside fenced blocks do not participate', () => {
  const fenced = `${nano()}

\`\`\`markdown
- Spec ID: SPEC-EXAMPLE
\`\`\`
`;
  assert.equal(validate(fenced, full()).specId, 'SPEC-FASTER-CHECKOUT');
});

test('file validation refuses a symbolic-link artifact', (t) => {
  const root = fs.mkdtempSync(path.join(process.cwd(), '.spec-pair-fixture-'));
  try {
    const directory = path.join(root, 'docs', 'agent', 'specs');
    fs.mkdirSync(directory, { recursive: true });
    const target = path.join(root, 'target.md');
    fs.writeFileSync(target, nano());
    const nanoPath = path.join(directory, 'faster-checkout.nano.md');
    try {
      fs.symlinkSync(target, nanoPath);
    } catch (error) {
      if (error.code === 'EPERM') {
        t.skip('the platform does not permit creating a test symlink');
        return;
      }
      throw error;
    }
    const fullPath = path.join(directory, 'faster-checkout.full.md');
    fs.writeFileSync(fullPath, full());

    assert.throws(
      () => validateFiles(
        root,
        nanoPath,
        fullPath,
        'docs/agent/discovery/faster-checkout.md',
        'a'.repeat(64),
      ),
      (error) => error.code === 'unsafe-path',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
