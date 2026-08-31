import assert from 'node:assert/strict';
import test from 'node:test';

import { APPLICABILITY_AREAS, resolveEngineeringDesign } from './engineering-design.mjs';

function applicability() {
  return Object.fromEntries(APPLICABILITY_AREAS.map((area) => [
    area,
    { status: 'addressed', citations: [`repo:${area}`] },
  ]));
}

function design(overrides = {}) {
  return {
    specification: { id: 'checkout', revision: '3', approval: { state: 'approved', evidence: 'merged:abc' } },
    functionalRequirements: [
      { id: 'FR-1', text: 'A shopper can submit an order.' },
      { id: 'FR-2', text: 'A failed order remains retryable.' },
    ],
    impact: { designRequired: true, signals: { interfaces: true, state: true, compatibility: false } },
    disposition: 'design',
    traceability: [
      { requirement: 'FR-1', designSections: ['interfaces'] },
      { requirement: 'FR-2', designSections: ['failure-behavior'] },
    ],
    decisions: [{
      id: 'DEC-1',
      consequential: true,
      selected: 'queue',
      adrRequired: true,
      adr: { status: 'proposed', path: 'docs/adr/0007-order-submission.md' },
      approaches: [
        { id: 'queue', viable: true, citations: ['repo:workers'] },
        { id: 'direct', viable: true, citations: ['repo:http'] },
      ],
    }],
    materialClaims: [{ id: 'CL-1', citations: ['repo:workers'] }],
    applicability: applicability(),
    nfrs: [],
    evidenceGaps: [],
    ...overrides,
  };
}

test('a reconciled design is complete and downstream eligible', () => {
  const result = resolveEngineeringDesign(design());
  assert.equal(result.status, 'complete');
  assert.equal(result.downstream.eligible, true);
  assert.deepEqual(result.findings, []);
});

test('no-design-required is deterministic and traces every requirement', () => {
  const result = resolveEngineeringDesign(design({
    impact: { designRequired: false, signals: { interfaces: false, state: false, compatibility: false } },
    disposition: 'no-design-required',
    traceability: [
      { requirement: 'FR-1', designSections: [], noImpactEvidence: 'repo:existing-contract' },
      { requirement: 'FR-2', designSections: [], noImpactEvidence: 'repo:existing-contract' },
    ],
    decisions: [],
    materialClaims: [],
  }));
  assert.equal(result.status, 'no-design-required');
  assert.equal(result.downstream.eligible, true);
});

test('no-design-required is blocked by any design-impact signal', () => {
  const result = resolveEngineeringDesign(design({
    disposition: 'no-design-required',
    decisions: [],
    materialClaims: [],
    traceability: [
      { requirement: 'FR-1', designSections: [], noImpactEvidence: 'repo:contract' },
      { requirement: 'FR-2', designSections: [], noImpactEvidence: 'repo:contract' },
    ],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'design-impact-present'));
});

test('a consequential decision requires two viable cited approaches', () => {
  const result = resolveEngineeringDesign(design({
    decisions: [{
      id: 'DEC-1',
      consequential: true,
      selected: 'queue',
      adrRequired: false,
      approaches: [{ id: 'queue', viable: true, citations: [] }],
    }],
  }));
  assert.equal(result.status, 'blocked');
  assert.deepEqual(
    result.findings.map((entry) => entry.code).sort(),
    ['insufficient-viable-approaches', 'uncited-approach'],
  );
});

test('material claims without citations become needs-evidence', () => {
  const result = resolveEngineeringDesign(design({
    materialClaims: [{ id: 'CL-1', citations: [] }],
  }));
  assert.equal(result.status, 'needs-evidence');
});

test('proposed NFRs require a separate human decision and are never downstream authority', () => {
  const result = resolveEngineeringDesign(design({
    nfrs: [{
      id: 'NFR-availability-1',
      authority: 'proposed',
      approval: { state: 'pending' },
    }],
  }));
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('technical-design cannot mark its own NFR proposal approved', () => {
  const result = resolveEngineeringDesign(design({
    nfrs: [{
      id: 'NFR-availability-1',
      authority: 'approved',
      approval: { state: 'approved' },
    }],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'invalid-nfr-authority'));
});

test('all functional requirements must remain in traceability', () => {
  const result = resolveEngineeringDesign(design({
    traceability: [{ requirement: 'FR-1', designSections: ['interfaces'] }],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'untraced-functional-requirement'));
});
