import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { renderFoundation } from '../../../discovery/_atoms/foundation-persist/foundation-persist.mjs';

import {
  AUTHORITY_MARKER,
  ProductDesignEvidenceError,
  validateProductDesignEvidence,
} from './product-design-evidence.mjs';

function discoveryBytes(route = 'ready') {
  const terminal = {
    ready: ['not-applicable', 'discovery-frontier-ready-for-spec'],
    'needs-product-design': ['required', 'discovery-frontier-requires-product-design'],
  };
  const [applicability, rationaleCode] = terminal[route]
    ?? ['unresolved', `discovery-frontier-${route.replace(/^needs-/, 'needs-')}${route === 'blocked' ? '' : ''}`];
  const normalizedRationale = {
    blocked: 'discovery-frontier-blocked',
    stop: 'discovery-frontier-stopped',
  }[route] ?? rationaleCode;
  return renderFoundation({
    subject: { id: 'checkout', slug: 'checkout' },
    alignment: 'confirmed',
    confirmedFacts: [], evidenceReferences: [], decisions: [], constraints: [],
    assumptions: [], contradictions: [], openQuestions: [], scope: [], exclusions: [],
    frontier: [], frontierRoute: { route, applicability, rationaleCode: normalizedRationale },
    nextAction: 'Continue.', resolved: [], history: [],
  });
}
const readyBytes = discoveryBytes();
const digest = crypto.createHash('sha256').update(readyBytes).digest('hex');
const discoveryPacket = {
  subjectId: 'checkout',
  revision: digest,
  locator: 'docs/agent/discovery/checkout.md',
};
const discoveryOptions = {
  discoverySubjectId: 'checkout',
  discoveryRevision: digest,
  verifyDiscoveryEvidence: () => true,
  readDiscoveryEvidence: () => readyBytes,
};
const handAuthoredValidation = {
  status: 'approved',
  subjectId: 'checkout',
  source: { locator: 'docs/agent/discovery/checkout.md', revision: digest },
  prototypeRevision: 'b'.repeat(64),
  workspace: 'docs/agent/prototypes/checkout',
  brandDigest: 'c'.repeat(64),
  conceptIds: ['concept.checkout'],
  walkthroughIds: ['walkthrough.checkout'],
  selectedConceptId: 'concept.checkout',
  artifactSetDigest: 'd'.repeat(64),
  interactionContractDigest: 'e'.repeat(64),
  authority: AUTHORITY_MARKER,
  changeRequestId: '155',
  mergeRevision: 'f'.repeat(40),
};

function code(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof ProductDesignEvidenceError) return error.code;
    throw error;
  }
}

test('admits non-applicability only from trusted exact-revision Discovery readiness', () => {
  assert.deepEqual(validateProductDesignEvidence({
    applicability: 'not-applicable',
    rationaleCode: 'discovery-frontier-ready-for-spec',
    packet: null,
    discoveryPacket,
  }, discoveryOptions), {
    applicability: 'not-applicable',
    rationaleCode: 'discovery-frontier-ready-for-spec',
    subjectId: 'checkout',
    discoveryRevision: digest,
  });
});

test('rejects hand-authored approved output instead of treating it as primary evidence', () => {
  assert.equal(code(() => validateProductDesignEvidence({
    applicability: 'required',
    rationaleCode: 'discovery-frontier-requires-product-design',
    validation: handAuthoredValidation,
    packet: null,
    discoveryPacket,
  }, discoveryOptions)), 'invalid-input');
});

test('re-runs approval binding from the primary packet and fails closed', () => {
  const requiredBytes = discoveryBytes('needs-product-design');
  const requiredDigest = crypto.createHash('sha256').update(requiredBytes).digest('hex');
  assert.equal(code(() => validateProductDesignEvidence({
    applicability: 'required',
    rationaleCode: 'discovery-frontier-requires-product-design',
    packet: { status: 'approved', authority: AUTHORITY_MARKER },
    discoveryPacket: { ...discoveryPacket, revision: requiredDigest },
  }, {
    ...discoveryOptions, discoveryRevision: requiredDigest,
    readDiscoveryEvidence: () => requiredBytes,
    approvalOptions: { repositoryRoot: '/does/not/exist' },
  })), 'invalid-input');
});

test('refuses pretending required evidence is not applicable', () => {
  assert.equal(code(() => validateProductDesignEvidence({
    applicability: 'not-applicable',
    rationaleCode: 'discovery-frontier-ready-for-spec',
    packet: handAuthoredValidation,
    discoveryPacket,
  }, discoveryOptions)), 'invalid-input');
});

test('rejects free-prose substitution, untrusted evidence, route mismatch, and stale binding', () => {
  assert.equal(code(() => validateProductDesignEvidence({
    applicability: 'not-applicable',
    reason: 'skip design',
    packet: null,
    discoveryPacket,
  }, discoveryOptions)), 'invalid-input');

  assert.equal(code(() => validateProductDesignEvidence({
    applicability: 'not-applicable',
    rationaleCode: 'discovery-frontier-ready-for-spec',
    packet: null,
    discoveryPacket,
  }, { ...discoveryOptions, verifyDiscoveryEvidence: () => false })), 'untrusted-discovery');

  assert.equal(code(() => validateProductDesignEvidence({
    applicability: 'not-applicable',
    rationaleCode: 'discovery-frontier-ready-for-spec',
    packet: null,
    discoveryPacket,
  }, {
    ...discoveryOptions,
    readDiscoveryEvidence: () => discoveryBytes('needs-product-design'),
  })), 'untrusted-discovery');

  assert.equal(code(() => validateProductDesignEvidence({
    applicability: 'not-applicable',
    rationaleCode: 'discovery-frontier-ready-for-spec',
    packet: null,
    discoveryPacket: { ...discoveryPacket, revision: 'b'.repeat(64) },
  }, discoveryOptions)), 'source-mismatch');
});

test('every declared nonterminal Discovery frontier is represented and refused by spec', () => {
  for (const route of [
    'needs-interrogate', 'needs-domain-mapping', 'needs-proof-of-concept',
    'needs-research', 'needs-uri-seed', 'needs-more-evidence', 'blocked', 'stop',
  ]) {
    const bytes = discoveryBytes(route);
    const revision = crypto.createHash('sha256').update(bytes).digest('hex');
    assert.equal(code(() => validateProductDesignEvidence({
      applicability: 'unresolved',
      rationaleCode: JSON.parse(bytes.match(/## Frontier Route\n\n(.+)\n/)[1]).rationaleCode,
      packet: null,
      discoveryPacket: { ...discoveryPacket, revision },
    }, {
      ...discoveryOptions,
      discoveryRevision: revision,
      readDiscoveryEvidence: () => bytes,
    })), 'nonterminal-route', route);
  }
});

test('legacy Discovery schema fails with route-upgrade-required', () => {
  const legacy = readyBytes
    .replace('- Schema: 2', '- Schema: 1')
    .replace(/\n## Frontier Route\n\n[^\n]+\n/, '');
  const revision = crypto.createHash('sha256').update(legacy).digest('hex');
  assert.equal(code(() => validateProductDesignEvidence({
    applicability: 'not-applicable',
    rationaleCode: 'discovery-frontier-ready-for-spec',
    packet: null,
    discoveryPacket: { ...discoveryPacket, revision },
  }, {
    ...discoveryOptions,
    discoveryRevision: revision,
    readDiscoveryEvidence: () => legacy,
  })), 'route-upgrade-required');
});
