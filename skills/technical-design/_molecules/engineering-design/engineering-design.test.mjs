import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  APPLICABILITY_AREAS,
  IMPACT_AREAS,
  resolveEngineeringDesign,
} from './engineering-design.mjs';

function applicability() {
  return Object.fromEntries(APPLICABILITY_AREAS.map((area) => [
    area,
    { status: 'addressed', citations: [`repo:${area}`] },
  ]));
}

function impactSignals(value = false) {
  return Object.fromEntries(IMPACT_AREAS.map((area) => [
    area,
    { value, citations: [`repo:${area}`] },
  ]));
}

function design(overrides = {}) {
  const functionalRequirements = [
    { id: 'FR-1', text: 'A shopper can submit an order.' },
    { id: 'FR-2', text: 'A failed order remains retryable.' },
  ];
  const functionalRequirementsDigest = crypto
    .createHash('sha256')
    .update(JSON.stringify(functionalRequirements))
    .digest('hex');
  return {
    specification: {
      id: 'checkout',
      revision: '3',
      contentDigest: 'abc123',
      approval: {
        state: 'approved',
        evidence: 'merged:abc',
        specificationId: 'checkout',
        specificationRevision: '3',
        contentDigest: 'abc123',
        functionalRequirementsDigest,
      },
    },
    design: {
      id: 'checkout-design',
      revision: '7',
      document: {
        path: 'docs/agent/designs/checkout.md',
        contentDigest: 'def456',
        rereadVerified: true,
      },
    },
    designApproval: {
      state: 'approved',
      evidence: 'review:engineering-42',
      designId: 'checkout-design',
      designRevision: '7',
      contentDigest: 'def456',
    },
    functionalRequirements,
    impact: {
      designRequired: true,
      signals: {
        ...impactSignals(false),
        interfaces: { value: true, citations: ['repo:interfaces'] },
        state: { value: true, citations: ['repo:state'] },
      },
    },
    disposition: 'design',
    traceability: [
      { requirement: 'FR-1', designSections: ['interfaces'] },
      { requirement: 'FR-2', designSections: ['failure-behavior'] },
    ],
    decisions: [{
      id: 'DEC-1',
      consequential: true,
      criteria: [
        { id: 'delivery', text: 'delivery guarantees' },
        { id: 'cost', text: 'operational cost' },
      ],
      selected: 'queue',
      adrRequired: true,
      adr: { status: 'proposed', path: 'docs/adr/0007-order-submission.md' },
      approaches: [
        {
          id: 'queue',
          viable: true,
          citations: ['repo:workers'],
          evaluations: [
            { criterion: 'delivery', assessment: 'Preserves retries.', citations: ['repo:workers'] },
            { criterion: 'cost', assessment: 'Adds a worker.', citations: ['repo:workers'] },
          ],
        },
        {
          id: 'direct',
          viable: true,
          citations: ['repo:http'],
          rejectedBecause: 'Cannot preserve retryability.',
          evaluations: [
            { criterion: 'delivery', assessment: 'Loses queued retries.', citations: ['repo:http'] },
            { criterion: 'cost', assessment: 'Avoids a worker.', citations: ['repo:http'] },
          ],
        },
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
    impact: { designRequired: false, signals: impactSignals(false) },
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
      criteria: [{ id: 'delivery', text: 'delivery guarantees' }],
      selected: 'queue',
      adrRequired: false,
      approaches: [{ id: 'queue', viable: true, citations: [] }],
    }],
  }));
  assert.equal(result.status, 'blocked');
  assert.deepEqual(
    result.findings.map((entry) => entry.code).sort(),
    ['incomplete-criterion-evaluation', 'insufficient-viable-approaches', 'uncited-approach'],
  );
});

test('specification approval must bind the approved requirement inventory', () => {
  const changedRequirements = [
    { id: 'FR-1', text: 'A shopper can delete an order.' },
    { id: 'FR-2', text: 'A failed order remains retryable.' },
  ];
  const result = resolveEngineeringDesign(design({
    functionalRequirements: changedRequirements,
  }));
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('absent specification approval returns needs-decision', () => {
  const packet = design();
  delete packet.specification.approval;
  const result = resolveEngineeringDesign(packet);
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('every approach must evaluate every common criterion', () => {
  const packet = design();
  packet.decisions[0].approaches[0].evaluations = [];
  const result = resolveEngineeringDesign(packet);
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'incomplete-criterion-evaluation'));
});

test('material claims without citations become needs-evidence', () => {
  const result = resolveEngineeringDesign(design({
    materialClaims: [{ id: 'CL-1', citations: [] }],
  }));
  assert.equal(result.status, 'needs-evidence');
});

test('missing comparison citations become needs-evidence', () => {
  const packet = design();
  packet.decisions[0].approaches[0].citations = [];
  packet.decisions[0].approaches[0].evaluations[0].citations = [];
  const result = resolveEngineeringDesign(packet);
  assert.equal(result.status, 'needs-evidence');
  assert.ok(result.findings.some((entry) => entry.code === 'uncited-approach'));
  assert.ok(result.findings.some((entry) => entry.code === 'uncited-criterion-evaluation'));
});

test('proposed NFRs require a separate human decision and are never downstream authority', () => {
  const result = resolveEngineeringDesign(design({
    nfrs: [{
      id: 'NFR-availability-1',
      revision: '2',
      sourceDesign: 'checkout-design@7',
      authority: 'proposed',
      approval: { state: 'pending' },
    }],
  }));
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('separately approved NFR evidence unlocks downstream without changing the proposal', () => {
  const proposal = {
    id: 'NFR-availability-1',
    revision: '2',
    sourceDesign: 'checkout-design@7',
    authority: 'proposed',
    approval: { state: 'pending' },
  };
  const result = resolveEngineeringDesign(design({
    nfrs: [proposal],
    approvedNfrs: [{
      id: proposal.id,
      revision: proposal.revision,
      sourceDesign: proposal.sourceDesign,
      authority: 'approved',
      approval: {
        state: 'approved',
        evidence: 'approval:nfr-board-7',
        nfrId: proposal.id,
        nfrRevision: proposal.revision,
        sourceDesign: proposal.sourceDesign,
      },
    }],
  }));
  assert.equal(result.status, 'complete');
  assert.equal(result.downstream.eligible, true);
});

test('technical-design cannot mark its own NFR proposal approved', () => {
  const result = resolveEngineeringDesign(design({
    nfrs: [{
      id: 'NFR-availability-1',
      revision: '2',
      sourceDesign: 'checkout-design@7',
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

test('internal completion remains downstream-ineligible until engineering approval', () => {
  const result = resolveEngineeringDesign(design({
    designApproval: {
      state: 'pending',
      designId: 'checkout-design',
      designRevision: '7',
    },
  }));
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('absent engineering approval returns needs-decision', () => {
  const packet = design();
  delete packet.designApproval;
  const result = resolveEngineeringDesign(packet);
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('impact requires every documented question and cited evidence', () => {
  assert.throws(
    () => resolveEngineeringDesign(design({
      impact: { designRequired: false, signals: { arbitrary: { value: false, citations: ['repo:x'] } } },
    })),
    /impact\.signals must contain exactly/,
  );
  assert.throws(
    () => resolveEngineeringDesign(design({
      impact: {
        designRequired: false,
        signals: {
          ...impactSignals(false),
          interfaces: { value: false, citations: [] },
        },
      },
    })),
    /citations must contain evidence/,
  );
});

test('design approval must bind the current design identity and revision', () => {
  const result = resolveEngineeringDesign(design({
    designApproval: {
      state: 'approved',
      evidence: 'review:engineering-42',
      designId: 'checkout-design',
      designRevision: '6',
    },
  }));
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('NFR approval must bind the current proposal revision and source design', () => {
  const result = resolveEngineeringDesign(design({
    nfrs: [{
      id: 'NFR-availability-1',
      revision: '2',
      sourceDesign: 'checkout-design@7',
      authority: 'proposed',
      approval: { state: 'pending' },
    }],
    approvedNfrs: [{
      id: 'NFR-availability-1',
      revision: '1',
      sourceDesign: 'checkout-design@7',
      authority: 'approved',
      approval: {
        state: 'approved',
        evidence: 'approval:nfr-board-7',
        nfrId: 'NFR-availability-1',
        nfrRevision: '1',
        sourceDesign: 'checkout-design@7',
      },
    }],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'stale-approved-nfr'));
});

test('NFR approval evidence must bind the approved record', () => {
  const result = resolveEngineeringDesign(design({
    nfrs: [{
      id: 'NFR-availability-1',
      revision: '2',
      sourceDesign: 'checkout-design@7',
      authority: 'proposed',
      approval: { state: 'pending' },
    }],
    approvedNfrs: [{
      id: 'NFR-availability-1',
      revision: '2',
      sourceDesign: 'checkout-design@7',
      authority: 'approved',
      approval: {
        state: 'approved',
        evidence: 'approval:nfr-board-7',
        nfrId: 'NFR-availability-1',
        nfrRevision: '1',
        sourceDesign: 'checkout-design@6',
      },
    }],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'invalid-approved-nfr-evidence'));
});

test('completion requires a reread-verified design document and explicit ADR disposition', () => {
  const unverified = design();
  unverified.design.document.rereadVerified = false;
  assert.equal(resolveEngineeringDesign(unverified).status, 'blocked');

  const missingAdrDisposition = design();
  delete missingAdrDisposition.decisions[0].adrRequired;
  assert.throws(
    () => resolveEngineeringDesign(missingAdrDisposition),
    /adrRequired must be boolean/,
  );
});

test('an NFR proposal must originate from the current design', () => {
  const result = resolveEngineeringDesign(design({
    nfrs: [{
      id: 'NFR-availability-1',
      revision: '2',
      sourceDesign: 'different-design@88',
      authority: 'proposed',
      approval: { state: 'pending' },
    }],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'foreign-nfr-source-design'));
});
