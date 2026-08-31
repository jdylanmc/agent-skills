#!/usr/bin/env node

import { AUTHORITY_MARKER, validateApprovalBinding } from '../../../product-design/_atoms/approval-binding/approval-binding.mjs';
import crypto from 'node:crypto';
import { parseFoundation } from '../../../discovery/_atoms/foundation-persist/foundation-persist.mjs';

export { AUTHORITY_MARKER };
export const APPLICABILITY = ['required', 'not-applicable', 'unresolved'];
export const RATIONALE_CODES = {
  required: 'discovery-frontier-requires-product-design',
  'not-applicable': 'discovery-frontier-ready-for-spec',
};

export class ProductDesignEvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProductDesignEvidenceError';
    this.code = code;
  }
}

const DIGEST = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function fail(code, message) {
  throw new ProductDesignEvidenceError(code, message);
}

function exactFields(value, fields, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid-input', `${name} must be an object`);
  const keys = Object.keys(value);
  const missing = fields.filter((field) => !keys.includes(field));
  const unknown = keys.filter((field) => !fields.includes(field));
  if (missing.length || unknown.length) fail('invalid-input', `${name} has missing or unknown fields`);
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') fail('invalid-input', `${field} must be non-empty text`);
  return value.trim();
}

function validateDiscoveryPacket(packet, {
  discoverySubjectId,
  discoveryRevision,
  verifyDiscoveryEvidence,
  readDiscoveryEvidence,
}) {
  exactFields(packet, ['subjectId', 'revision', 'locator'], 'discoveryPacket');
  if (!ID.test(text(packet.subjectId, 'discoveryPacket.subjectId'))) fail('invalid-input', 'discoveryPacket.subjectId must be stable');
  if (!DIGEST.test(text(packet.revision, 'discoveryPacket.revision'))) fail('invalid-input', 'discoveryPacket.revision must be a SHA-256 digest');
  text(packet.locator, 'discoveryPacket.locator');
  if (packet.subjectId !== discoverySubjectId || packet.revision !== discoveryRevision) {
    fail('source-mismatch', 'Discovery evidence does not bind the specification subject and exact revision');
  }
  if (typeof verifyDiscoveryEvidence !== 'function' || verifyDiscoveryEvidence(packet) !== true) {
    fail('untrusted-discovery', 'primary Discovery evidence was not revalidated by its trusted exact-revision adapter');
  }
  if (typeof readDiscoveryEvidence !== 'function') {
    fail('untrusted-discovery', 'trusted Discovery byte reader is required');
  }
  const bytes = readDiscoveryEvidence(packet);
  if (typeof bytes !== 'string'
    || crypto.createHash('sha256').update(bytes).digest('hex') !== packet.revision) {
    fail('untrusted-discovery', 'trusted Discovery bytes do not match the exact revision');
  }
  let parsed;
  try {
    parsed = parseFoundation(bytes);
  } catch (error) {
    fail('invalid-discovery', `Discovery bytes do not contain a validated foundation: ${error.message}`);
  }
  if (parsed.subject.id !== packet.subjectId) fail('source-mismatch', 'Discovery bytes name another subject');
  return { ...packet, bytes, frontierRoute: parsed.frontierRoute };
}

export function validateProductDesignEvidence(input, {
  discoverySubjectId,
  discoveryRevision,
  verifyDiscoveryEvidence,
  readDiscoveryEvidence,
  approvalOptions,
} = {}) {
  exactFields(input, ['applicability', 'rationaleCode', 'packet', 'discoveryPacket'], 'productDesignEvidence');
  if (!APPLICABILITY.includes(input.applicability)) fail('invalid-input', 'applicability must be required, not-applicable, or unresolved');
  if (input.applicability !== 'unresolved' && input.rationaleCode !== RATIONALE_CODES[input.applicability]) {
    fail('invalid-input', 'rationaleCode must exactly match the applicability branch');
  }
  const discoveryPacket = validateDiscoveryPacket(input.discoveryPacket, {
    discoverySubjectId,
    discoveryRevision,
    verifyDiscoveryEvidence,
    readDiscoveryEvidence,
  });
  if (discoveryPacket.frontierRoute === null) {
    fail('route-upgrade-required', 'legacy Discovery evidence must be upgraded with a structured frontier route');
  }
  if (input.applicability !== discoveryPacket.frontierRoute.applicability
    || input.rationaleCode !== discoveryPacket.frontierRoute.rationaleCode) {
    fail('route-mismatch', 'product-design applicability and rationale must derive from exact Discovery bytes');
  }
  if (input.applicability === 'unresolved') {
    fail('nonterminal-route', `Discovery route ${discoveryPacket.frontierRoute.route} is not terminal for specification`);
  }
  if (input.applicability === 'not-applicable') {
    if (input.packet !== null) fail('invalid-input', 'not-applicable evidence cannot carry a product-design packet');
    if (discoveryPacket.frontierRoute.route === 'needs-product-design') {
      fail('route-mismatch', 'needs-product-design cannot be declared not-applicable');
    }
    if (discoveryPacket.frontierRoute.route !== 'ready') fail('route-mismatch', 'not-applicable requires Discovery readiness for specification');
    return {
      applicability: 'not-applicable',
      rationaleCode: input.rationaleCode,
      subjectId: discoverySubjectId,
      discoveryRevision,
    };
  }
  if (discoveryPacket.frontierRoute.route !== 'needs-product-design') {
    fail('route-mismatch', 'required product-design evidence needs the authoritative needs-product-design route');
  }
  if (!input.packet || typeof input.packet !== 'object' || Array.isArray(input.packet)) {
    fail('invalid-input', 'required evidence must carry the primary product-design packet');
  }
  let validation;
  try {
    validation = validateApprovalBinding(input.packet, approvalOptions);
  } catch (error) {
    fail(error.code ?? 'invalid-evidence', `product-design primary evidence did not validate: ${error.message}`);
  }
  if (validation.status !== 'approved') fail('not-approved', 'required product-design evidence must be validator-approved');
  if (validation.subjectId !== discoverySubjectId) fail('source-mismatch', 'product-design subject differs from Discovery');
  exactFields(validation.source, ['locator', 'revision'], 'productDesignEvidence.validation.source');
  if (validation.source.revision !== discoveryRevision) fail('source-mismatch', 'product-design Discovery revision differs');
  for (const field of ['prototypeRevision', 'brandDigest', 'artifactSetDigest', 'interactionContractDigest']) {
    if (!DIGEST.test(validation[field])) fail('invalid-input', `${field} must be a SHA-256 digest`);
  }
  if (!COMMIT.test(validation.mergeRevision)) fail('invalid-input', 'mergeRevision must be a full commit identity');
  if (validation.authority !== AUTHORITY_MARKER) fail('authority-violation', 'product-design evidence lacks the nonauthority marker');
  if (!Array.isArray(validation.conceptIds) || validation.conceptIds.length === 0
    || !validation.conceptIds.every((id) => ID.test(id))
    || !validation.conceptIds.includes(validation.selectedConceptId)) {
    fail('invalid-input', 'selected concept must be in the validated concept set');
  }
  if (!Array.isArray(validation.walkthroughIds) || validation.walkthroughIds.length === 0
    || !validation.walkthroughIds.every((id) => ID.test(id))) {
    fail('invalid-input', 'validated walkthrough identities are required');
  }
  text(validation.changeRequestId, 'changeRequestId');
  exactFields(validation.selectedRunnableConcept, [
    'root', 'entrypoint', 'humanRunCommand', 'ownedArtifactPaths', 'digest',
    'mergedBytesVerification', 'trust',
  ], 'selectedRunnableConcept');
  for (const field of ['root', 'entrypoint', 'humanRunCommand', 'trust']) {
    text(validation.selectedRunnableConcept[field], `selectedRunnableConcept.${field}`);
  }
  if (validation.selectedRunnableConcept.trust !== 'untrusted-human-run-prototype') {
    fail('authority-violation', 'selected runnable concept must remain explicitly untrusted');
  }
  if (!Array.isArray(validation.selectedRunnableConcept.ownedArtifactPaths)
    || validation.selectedRunnableConcept.ownedArtifactPaths.length === 0) {
    fail('invalid-input', 'selected runnable concept owned artifact paths are required');
  }
  exactFields(validation.selectedRunnableConcept.mergedBytesVerification, ['revision', 'exact'], 'selectedRunnableConcept.mergedBytesVerification');
  if (validation.selectedRunnableConcept.mergedBytesVerification.exact !== true
    || validation.selectedRunnableConcept.mergedBytesVerification.revision !== validation.mergeRevision) {
    fail('invalid-input', 'selected runnable concept must carry exact merged-byte verification');
  }
  return {
    applicability: 'required',
    rationaleCode: input.rationaleCode,
    subjectId: validation.subjectId,
    discoveryRevision,
    selectedConceptId: validation.selectedConceptId,
    selectedRunnableConcept: validation.selectedRunnableConcept,
    artifactSetDigest: validation.artifactSetDigest,
    interactionContractDigest: validation.interactionContractDigest,
    interactionContractPath: validation.interactionContractPath,
    interactionContractBytes: validation.interactionContractBytes,
    interactionContract: validation.interactionContract,
    conceptIds: validation.conceptIds,
    walkthroughIds: validation.walkthroughIds,
    mergeRevision: validation.mergeRevision,
    authority: AUTHORITY_MARKER,
  };
}
