import assert from 'node:assert/strict';
import test from 'node:test';

import { validateNfrProposals } from './nfr-proposals.mjs';

function proposal(overrides = {}) {
  return {
    id: 'NFR-cache-lag',
    revision: '1',
    authority: 'proposed',
    approval: { state: 'pending' },
    generatedByDecision: 'DEC-cache',
    justification: 'data doctrine cache ownership rule',
    serves: 'FR-lookup',
    threshold: 'Updates visible within 30 seconds.',
    thresholdStatus: 'known',
    scope: 'catalog cache',
    verificationIntent: 'measure write-to-read visibility',
    sourceDesign: 'catalog-design@2',
    ...overrides,
  };
}

test('a proposal remains explicitly non-authoritative', () => {
  const result = validateNfrProposals({ proposals: [proposal()] });
  assert.equal(result.status, 'valid');
  assert.equal(result.authority.downstreamAuthoritative, false);
  assert.equal(result.authority.separateHumanApprovalRequired, true);
});

test('threshold-unknown is valid but visibly unresolved', () => {
  const result = validateNfrProposals({
    proposals: [proposal({ threshold: null, thresholdStatus: 'threshold-unknown' })],
  });
  assert.equal(result.status, 'needs-threshold');
  assert.deepEqual(result.findings, []);
});

test('technical-design cannot approve its own proposal', () => {
  const result = validateNfrProposals({
    proposals: [proposal({ authority: 'approved', approval: { state: 'approved', evidence: 'self' } })],
  });
  assert.equal(result.status, 'invalid');
  assert.deepEqual(result.findings.map((entry) => entry.code), ['authority-not-proposed', 'self-approval']);
});

test('a proposal cannot omit both threshold forms or declare both', () => {
  const missing = validateNfrProposals({ proposals: [proposal({ threshold: null, thresholdStatus: 'known' })] });
  const both = validateNfrProposals({ proposals: [proposal({ thresholdStatus: 'threshold-unknown' })] });
  assert.equal(missing.status, 'invalid');
  assert.equal(both.status, 'invalid');
  assert.equal(missing.findings[0].code, 'threshold-shape');
});
