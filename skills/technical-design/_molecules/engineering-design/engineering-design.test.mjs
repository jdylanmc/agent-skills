import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';

import {
  APPLICABILITY_AREAS,
  IMPACT_AREAS,
  resolveEngineeringDesign as resolveEngineeringDesignRaw,
} from './engineering-design.mjs';
import { renderNfrProposal } from '../../_atoms/nfr-proposals/nfr-proposals.mjs';

const repositoryRoot = process.cwd();
const fixtureId = `.engineering-design-test-${process.pid}`;
const specificationSlug = `engineering-design-test-${process.pid}`;
const designPath = `docs/agent/designs/${fixtureId}.md`;
const adrPath = `docs/adr/${fixtureId}.md`;
const specificationPath = `docs/agent/specs/${specificationSlug}.nano.md`;
const fullSpecificationPath = `docs/agent/specs/${specificationSlug}.full.md`;
const nfrPath = `docs/agent/nfr/${fixtureId}.md`;
const nfrApprovalPath = `docs/agent/nfr/approvals/${fixtureId}.json`;
const publishedCommit = 'c'.repeat(40);
const specificationBytes = [
  '# Checkout specification',
  '',
  '- Spec ID: SPEC-CHECKOUT',
  '- Source: docs/agent/discovery/checkout.md',
  '- Source revision: 3',
  `- Full specification: [Supporting context](./${specificationSlug}.full.md)`,
  '',
  '## Intention',
  '',
  'A shopper can submit a retryable order.',
  '',
  '## Acceptance Criteria',
  '',
  '- AC-001: A shopper can submit an order.',
  '- AC-002: A failed order remains retryable.',
  '',
  '## Non-goals',
  '',
  '- Selecting an implementation.',
  '',
].join('\n');
const fullSpecificationBytes = [
  '# Checkout specification - Full specification',
  '',
  '- Spec ID: SPEC-CHECKOUT',
  '- Source: docs/agent/discovery/checkout.md',
  '- Source revision: 3',
  `- Nano authority: [Authoritative product intent](./${specificationSlug}.nano.md)`,
  '',
  '## Authority',
  '',
  'The nano sibling is authoritative. This document elaborates it.',
  '',
  '## Problem and Users',
  '',
  'Shoppers need retryable order submission.',
  '',
  '## Outcomes and Success',
  '',
  'The outcomes are defined by AC-001 and AC-002.',
  '',
  '## Scope and Non-goals',
  '',
  'Order submission is in scope. Implementation selection is not.',
  '',
  '## Constraints and Dependencies',
  '',
  'No additional confirmed constraints.',
  '',
  '## Confirmed Facts',
  '',
  'Orders may fail transiently.',
  '',
  '## Assumptions',
  '',
  'None.',
  '',
  '## Contradictions',
  '',
  'None.',
  '',
  '## Alternatives and Examples',
  '',
  'Supporting examples remain non-authoritative.',
  '',
  '## Product Requirements',
  '',
  '- REQ-001 [AC-001]: Submit an order.',
  '- REQ-002 [AC-002]: Preserve retryability.',
  '',
  '## Product Decisions',
  '',
  '- DEC-001 [INTENT]: Keep implementation selection out of product authority.',
  '',
  '## Traceability',
  '',
  '| Nano authority | Discovery evidence |',
  '| --- | --- |',
  '| AC-001 | Confirmed checkout research |',
  '| AC-002 | Retry evidence |',
  '',
  '## Open Questions',
  '',
  'None.',
  '',
].join('\n');
const designBytes = [
  '# Checkout engineering design',
  '',
  '- Design ID: checkout-design',
  '- Revision: 7',
  '',
].join('\n');
const adrBytes = '# Order submission ADR\n';
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const designDigest = digest(designBytes);
const adrDigest = digest(adrBytes);
const specificationDigest = digest(specificationBytes);
const fullSpecificationDigest = digest(fullSpecificationBytes);

function writeRepositoryFile(relativePath, contents) {
  const absolute = path.join(repositoryRoot, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents);
}

function approval(artifactPath, contentDigest, overrides = {}) {
  return {
    state: 'approved',
    boundary: 'git-default-branch',
    remote: 'origin',
    defaultBranch: 'main',
    defaultBranchRef: 'origin/main',
    artifactPath,
    contentDigest,
    publishedCommit,
    observedAt: '2026-08-31T12:00:00Z',
    ...overrides,
  };
}

function fakeGit({ args }) {
  if (args[0] === 'fetch') return { status: 'ok', stdout: Buffer.from('') };
  if (args[0] === 'remote' && args[1] === 'get-url') {
    return { status: 'ok', stdout: Buffer.from('https://github.com/jdylanmc/agent-skills.git\n') };
  }
  if (args[0] === 'rev-parse' && args[1] === '--symbolic-full-name') {
    return { status: 'ok', stdout: Buffer.from('refs/remotes/origin/main\n') };
  }
  if (args[0] === 'symbolic-ref') {
    return { status: 'ok', stdout: Buffer.from('refs/remotes/origin/main\n') };
  }
  if (args[0] === 'rev-parse') {
    return { status: 'ok', stdout: Buffer.from(`${publishedCommit}\n`) };
  }
  if (args[0] === 'show') {
    const relativePath = args[1].slice('origin/main:'.length);
    try {
      return { status: 'ok', stdout: fs.readFileSync(path.join(repositoryRoot, relativePath)) };
    } catch {
      return { status: 'error', stderr: 'path missing' };
    }
  }
  return { status: 'error', stderr: 'unexpected command' };
}

function resolveEngineeringDesign(packet) {
  return resolveEngineeringDesignRaw(packet, { runGit: fakeGit });
}

function nfrProposal(overrides = {}) {
  const proposal = {
    id: 'NFR-availability-1',
    path: nfrPath,
    revision: '2',
    authority: 'proposed',
    approval: { state: 'pending' },
    generatedByDecision: 'DEC-1',
    justification: 'repo:availability-policy',
    serves: 'AC-002',
    threshold: '99.9% monthly availability',
    thresholdStatus: 'known',
    scope: 'checkout service',
    verificationIntent: 'measure successful requests',
    sourceDesign: 'checkout-design@7',
    downstreamAuthorityWarning: 'not-authority-until-separately-approved',
    ...overrides,
  };
  const contents = renderNfrProposal(proposal);
  writeRepositoryFile(proposal.path, contents);
  proposal.contentDigest = digest(contents);
  return proposal;
}

function approvedNfr(proposal, overrides = {}) {
  const record = {
    kind: 'nfr-approval',
    state: 'approved',
    nfrId: proposal.id,
    nfrRevision: proposal.revision,
    sourceDesign: proposal.sourceDesign,
    proposalDigest: proposal.contentDigest,
    ...overrides,
  };
  const contents = `${JSON.stringify(record, null, 2)}\n`;
  writeRepositoryFile(nfrApprovalPath, contents);
  const approvalReceipt = { path: nfrApprovalPath, contentDigest: digest(contents) };
  return {
    id: proposal.id,
    revision: proposal.revision,
    sourceDesign: proposal.sourceDesign,
    path: proposal.path,
    contentDigest: proposal.contentDigest,
    authority: 'approved',
    approvalReceipt,
    approval: approval(approvalReceipt.path, approvalReceipt.contentDigest),
  };
}

before(() => {
  writeRepositoryFile(specificationPath, specificationBytes);
  writeRepositoryFile(fullSpecificationPath, fullSpecificationBytes);
  writeRepositoryFile(designPath, designBytes);
  writeRepositoryFile(adrPath, adrBytes);
});

after(() => {
  fs.rmSync(path.join(repositoryRoot, designPath), { force: true });
  fs.rmSync(path.join(repositoryRoot, adrPath), { force: true });
  fs.rmSync(path.join(repositoryRoot, specificationPath), { force: true });
  fs.rmSync(path.join(repositoryRoot, fullSpecificationPath), { force: true });
  fs.rmSync(path.join(repositoryRoot, nfrPath), { force: true });
  fs.rmSync(path.join(repositoryRoot, nfrApprovalPath), { force: true });
});

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
    { id: 'AC-001', text: 'A shopper can submit an order.' },
    { id: 'AC-002', text: 'A failed order remains retryable.' },
  ];
  return {
    repositoryRoot,
    specification: {
      id: 'SPEC-CHECKOUT',
      revision: '3',
      source: 'docs/agent/discovery/checkout.md',
      path: specificationPath,
      fullPath: fullSpecificationPath,
      contentDigest: specificationDigest,
      fullContentDigest: fullSpecificationDigest,
      approval: approval(specificationPath, specificationDigest),
    },
    design: {
      id: 'checkout-design',
      revision: '7',
      document: {
        path: designPath,
        contentDigest: designDigest,
      },
    },
    designApproval: approval(designPath, designDigest),
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
      { requirement: 'AC-001', designSections: ['interfaces'] },
      { requirement: 'AC-002', designSections: ['failure-behavior'] },
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
      adr: { status: 'proposed', path: adrPath, contentDigest: adrDigest },
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
      { requirement: 'AC-001', designSections: [], noImpactEvidence: 'repo:existing-contract' },
      { requirement: 'AC-002', designSections: [], noImpactEvidence: 'repo:existing-contract' },
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
      { requirement: 'AC-001', designSections: [], noImpactEvidence: 'repo:contract' },
      { requirement: 'AC-002', designSections: [], noImpactEvidence: 'repo:contract' },
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
    { id: 'AC-001', text: 'A shopper can delete an order.' },
    { id: 'AC-002', text: 'A failed order remains retryable.' },
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
    nfrs: [nfrProposal()],
  }));
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('separately approved NFR evidence unlocks downstream without changing the proposal', () => {
  const proposal = nfrProposal();
  const result = resolveEngineeringDesign(design({
    nfrs: [proposal],
    approvedNfrs: [approvedNfr(proposal)],
  }));
  assert.equal(result.status, 'complete');
  assert.equal(result.downstream.eligible, true);
});

test('technical-design cannot mark its own NFR proposal approved', () => {
  const result = resolveEngineeringDesign(design({
    nfrs: [nfrProposal({
      authority: 'approved',
      approval: { state: 'approved' },
    })],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'invalid-nfr-authority'));
});

test('all functional requirements must remain in traceability', () => {
  const result = resolveEngineeringDesign(design({
    traceability: [{ requirement: 'AC-001', designSections: ['interfaces'] }],
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
  const packet = design({
    design: {
      id: 'checkout-design',
      revision: '8',
      document: { path: designPath, contentDigest: designDigest },
    },
  });
  const result = resolveEngineeringDesign(packet);
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('NFR approval must bind the current proposal revision and source design', () => {
  const proposal = nfrProposal();
  const result = resolveEngineeringDesign(design({
    nfrs: [proposal],
    approvedNfrs: [{
      ...approvedNfr(proposal, { nfrRevision: '1' }),
      revision: '1',
    }],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'stale-approved-nfr'));
});

test('NFR approval evidence must bind the approved record', () => {
  const proposal = nfrProposal();
  const result = resolveEngineeringDesign(design({
    nfrs: [proposal],
    approvedNfrs: [{
      ...approvedNfr(proposal),
      approvalReceipt: null,
    }],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'invalid-approved-nfr-evidence'));
});

test('NFR approval must bind the reproduced proposal digest', () => {
  const proposal = nfrProposal();
  const approved = approvedNfr(proposal);
  approved.contentDigest = 'different-digest';
  const result = resolveEngineeringDesign(design({
    nfrs: [proposal],
    approvedNfrs: [approved],
  }));
  assert.equal(result.status, 'blocked');
  assert.equal(result.downstream.eligible, false);
  assert.ok(result.findings.some((entry) => entry.code === 'invalid-approved-nfr-evidence'));
});

test('completion requires a reread-verified design document and explicit ADR disposition', () => {
  const unverified = design();
  unverified.design.document.contentDigest = 'stale-digest';
  assert.equal(resolveEngineeringDesign(unverified).status, 'blocked');

  const missingAdrDisposition = design();
  delete missingAdrDisposition.decisions[0].adrRequired;
  assert.throws(
    () => resolveEngineeringDesign(missingAdrDisposition),
    /adrRequired must be boolean/,
  );
});

test('approval evidence must reproduce against the remote default branch', () => {
  const fabricated = design();
  fabricated.specification.approval.publishedCommit = 'f'.repeat(40);
  assert.equal(resolveEngineeringDesign(fabricated).status, 'needs-decision');

  const missing = design();
  missing.designApproval.artifactPath = 'docs/agent/designs/missing.md';
  assert.equal(resolveEngineeringDesign(missing).status, 'needs-decision');
});

test('approval refuses an observation whose remote was not freshly fetched', () => {
  const packet = design();
  const result = resolveEngineeringDesignRaw(packet, {
    runGit: ({ args }) => args[0] === 'fetch'
      ? { status: 'error', stderr: 'offline' }
      : fakeGit({ args }),
  });
  assert.equal(result.status, 'needs-decision');
  assert.equal(result.downstream.eligible, false);
});

test('design approval rejects fenced decoys and duplicate identity metadata', () => {
  const fenced = [
    '# Checkout engineering design',
    '',
    '```text',
    '- Design ID: checkout-design',
    '- Revision: 7',
    '```',
    '- Design ID: different-design',
    '- Revision: 9',
    '',
  ].join('\n');
  writeRepositoryFile(designPath, fenced);
  const fencedDigest = digest(fenced);
  const fencedPacket = design({
    design: {
      id: 'checkout-design',
      revision: '7',
      document: { path: designPath, contentDigest: fencedDigest },
    },
    designApproval: approval(designPath, fencedDigest),
  });
  assert.equal(resolveEngineeringDesign(fencedPacket).status, 'needs-decision');

  const duplicate = `${designBytes}- Design ID: checkout-design\n`;
  writeRepositoryFile(designPath, duplicate);
  const duplicateDigest = digest(duplicate);
  const duplicatePacket = design({
    design: {
      id: 'checkout-design',
      revision: '7',
      document: { path: designPath, contentDigest: duplicateDigest },
    },
    designApproval: approval(designPath, duplicateDigest),
  });
  assert.equal(resolveEngineeringDesign(duplicatePacket).status, 'needs-decision');
  writeRepositoryFile(designPath, designBytes);
});

test('the linked full specification is required and canonical', () => {
  const missing = design();
  missing.specification.fullPath = `docs/agent/specs/${specificationSlug}-missing.full.md`;
  assert.throws(() => resolveEngineeringDesign(missing), /must name a persisted file/);

  const wrongLink = specificationBytes.replace(
    `./${specificationSlug}.full.md`,
    './different.full.md',
  );
  writeRepositoryFile(specificationPath, wrongLink);
  const packet = design({
    specification: {
      ...design().specification,
      contentDigest: digest(wrongLink),
      approval: approval(specificationPath, digest(wrongLink)),
    },
  });
  assert.equal(resolveEngineeringDesign(packet).status, 'blocked');
  writeRepositoryFile(specificationPath, specificationBytes);
});

test('a merged proposal is not its own separate NFR approval', () => {
  const proposal = nfrProposal();
  const result = resolveEngineeringDesign(design({
    nfrs: [proposal],
    approvedNfrs: [{
      id: proposal.id,
      revision: proposal.revision,
      sourceDesign: proposal.sourceDesign,
      path: proposal.path,
      contentDigest: proposal.contentDigest,
      authority: 'approved',
      approval: approval(proposal.path, proposal.contentDigest),
    }],
  }));
  assert.equal(result.status, 'blocked');
  assert.equal(result.downstream.eligible, false);
});

test('persisted design and ADR bytes must reproduce their declared digests', () => {
  const staleDesign = design();
  staleDesign.design.document.contentDigest = 'stale';
  assert.equal(resolveEngineeringDesign(staleDesign).status, 'blocked');

  const staleAdr = design();
  staleAdr.decisions[0].adr.contentDigest = 'stale';
  const result = resolveEngineeringDesign(staleAdr);
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'adr-not-verified'));
});

test('invalid or stale persisted NFR proposals cannot unlock downstream work', () => {
  const proposal = nfrProposal();
  delete proposal.justification;
  const invalid = resolveEngineeringDesign(design({ nfrs: [proposal] }));
  assert.equal(invalid.status, 'blocked');
  assert.equal(invalid.downstream.eligible, false);

  const stale = nfrProposal();
  writeRepositoryFile(stale.path, `${renderNfrProposal(stale)}changed\n`);
  const staleResult = resolveEngineeringDesign(design({ nfrs: [stale] }));
  assert.equal(staleResult.status, 'blocked');
  assert.ok(staleResult.findings.some((entry) => entry.code === 'nfr-not-verified'));
});

test('an NFR proposal must originate from the current design', () => {
  const result = resolveEngineeringDesign(design({
    nfrs: [nfrProposal({
      sourceDesign: 'different-design@88',
    })],
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.findings.some((entry) => entry.code === 'foreign-nfr-source-design'));
});
