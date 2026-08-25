import crypto from 'node:crypto';

export const OUTCOMES = Object.freeze(['VERIFIED', 'NOT_VERIFIED', 'INCONCLUSIVE', 'BLOCKED']);
export const EVIDENCE_STRENGTHS = Object.freeze([
  'direct',
  'indirect',
  'self-reported',
  'incomplete',
  'unavailable',
]);

function stable(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

export function canonicalArtifactBytes(artifact) {
  if (Buffer.isBuffer(artifact)) {
    return artifact;
  }
  if (typeof artifact === 'string') {
    return Buffer.from(artifact, 'utf8');
  }
  return Buffer.from(stable(artifact), 'utf8');
}

export function computeArtifactIdentity(artifact, options = {}) {
  const bytes = canonicalArtifactBytes(artifact);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  return {
    kind: 'sha256',
    value: digest,
    algorithm: 'sha256',
    byteLength: bytes.length,
    scope: options.scope ?? 'complete-artifact',
    source: options.source ?? 'computed',
  };
}

export function identityFingerprint(identity) {
  if (!identity || typeof identity !== 'object') {
    return null;
  }
  return crypto.createHash('sha256').update(stable(identity)).digest('hex');
}

const ALLOWED_IDENTITY_KINDS = new Set([
  'sha256',
  'git-commit',
  'build',
  'spec-revision',
  'gherkin-revision',
  'procedure-revision',
]);
const MUTABLE_IDENTITY_VALUES = /^(main|master|trunk|head|latest|current|tip|stable)$/i;
const MUTABLE_IDENTITY_SOURCES = /^(branch|tag|title|filename|unsourced|mutable-pointer)$/i;

function identityDefects(identity) {
  const defects = [];
  if (!identity || typeof identity !== 'object') {
    return ['Missing artifact identity'];
  }
  if (typeof identity.kind !== 'string' || identity.kind.length === 0) {
    defects.push('Missing artifact identity kind');
  } else if (!ALLOWED_IDENTITY_KINDS.has(identity.kind)) {
    defects.push('Mutable or unsupported artifact identity');
  }
  if (typeof identity.value !== 'string' || identity.value.length === 0) {
    defects.push('Missing artifact identity value');
  } else if (MUTABLE_IDENTITY_VALUES.test(identity.value)) {
    defects.push('Mutable or unsupported artifact identity');
  }
  if (typeof identity.scope !== 'string' || identity.scope.length === 0) {
    defects.push('Missing artifact identity scope');
  }
  if (typeof identity.source !== 'string' || identity.source.length === 0) {
    defects.push('Missing artifact identity source');
  } else if (MUTABLE_IDENTITY_SOURCES.test(identity.source)) {
    defects.push('Mutable or unsupported artifact identity');
  }
  if (identity.kind === 'sha256') {
    if (identity.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(identity.value)) {
      defects.push('Malformed sha256 artifact identity');
    }
    if (!Number.isInteger(identity.byteLength) || identity.byteLength < 0) {
      defects.push('Missing artifact byte length');
    }
  }
  if (identity.kind === 'git-commit' && !/^[a-f0-9]{40}$/i.test(identity.value)) {
    defects.push('Malformed git commit identity');
  }
  return defects;
}

function hasExactIdentity(identity) {
  return identityDefects(identity).length === 0;
}

function hasClaim(verdict) {
  return typeof verdict?.claim === 'string' && verdict.claim.trim().length > 0;
}

function validEvidencePointer(pointer) {
  if (!pointer || typeof pointer !== 'object' || Array.isArray(pointer)) {
    return false;
  }
  if (typeof pointer.kind !== 'string' || pointer.kind.trim().length === 0) {
    return false;
  }
  return ['ref', 'uri', 'receipt', 'section', 'path'].some((field) => {
    const value = pointer[field];
    return typeof value === 'string' && value.trim().length > 0 && !MUTABLE_IDENTITY_VALUES.test(value.trim());
  });
}

function pointerCount(verdict) {
  return Array.isArray(verdict?.evidencePointers)
    ? verdict.evidencePointers.filter(validEvidencePointer).length
    : 0;
}

export function bindingFingerprint({ claim, artifactIdentity }) {
  if (typeof claim !== 'string' || !hasExactIdentity(artifactIdentity)) {
    return null;
  }
  return crypto.createHash('sha256').update(stable({ artifactIdentity, claim })).digest('hex');
}

export function buildVerificationVerdict({
  artifact,
  outcome,
  claim,
  evidenceStrength,
  evidencePointers = [],
  scope = 'complete-artifact',
  source = 'computed',
  checkedAt = new Date(0).toISOString(),
  verifier = 'verification-verdict',
}) {
  const artifactIdentity = computeArtifactIdentity(artifact, { scope, source });
  const verdict = {
    outcome,
    claim,
    artifactIdentity,
    artifactIdentityFingerprint: identityFingerprint(artifactIdentity),
    verdictBindingFingerprint: bindingFingerprint({ claim, artifactIdentity }),
    evidenceStrength,
    evidencePointers,
    checkedAt,
    verifier,
    grantsApproval: false,
  };
  return Object.freeze(verdict);
}

export function validateVerificationVerdict({ artifact, verdict, currentIdentity, expectedClaim } = {}) {
  const defects = [];
  if (!verdict || typeof verdict !== 'object') {
    return {
      valid: false,
      pass: false,
      approval: false,
      outcome: null,
      defects: ['Missing verdict'],
    };
  }

  if (!OUTCOMES.includes(verdict.outcome)) {
    defects.push('Unknown outcome');
  }
  const identityProblems = identityDefects(verdict.artifactIdentity);
  defects.push(...identityProblems);
  if (!hasClaim(verdict)) {
    defects.push('Missing claim');
  } else if (expectedClaim !== undefined && verdict.claim !== expectedClaim) {
    defects.push('Claim mismatch');
  }
  if (!verdict.artifactIdentityFingerprint) {
    defects.push('Missing identity fingerprint');
  } else if (hasExactIdentity(verdict.artifactIdentity)
      && verdict.artifactIdentityFingerprint !== identityFingerprint(verdict.artifactIdentity)) {
    defects.push('Stale or tampered artifact identity');
  }
  if (!verdict.verdictBindingFingerprint) {
    defects.push('Missing verdict binding fingerprint');
  } else if (hasClaim(verdict)
      && hasExactIdentity(verdict.artifactIdentity)
      && verdict.verdictBindingFingerprint !== bindingFingerprint({
        claim: verdict.claim,
        artifactIdentity: verdict.artifactIdentity,
      })) {
    defects.push('Stale or tampered verdict binding');
  }
  if (!EVIDENCE_STRENGTHS.includes(verdict.evidenceStrength)) {
    defects.push('Missing evidence strength');
  }
  if (verdict.outcome !== 'BLOCKED' && pointerCount(verdict) === 0) {
    defects.push('Missing evidence pointer');
  }
  if (verdict.outcome === 'VERIFIED' && verdict.evidenceStrength !== 'direct') {
    defects.push('Verified verdict lacks direct evidence');
  }
  if (verdict.grantsApproval !== false) {
    defects.push('Verdict must not grant approval');
  }

  const observedIdentity = currentIdentity ?? (artifact === undefined ? null : computeArtifactIdentity(artifact, {
    scope: verdict.artifactIdentity?.scope ?? 'complete-artifact',
    source: verdict.artifactIdentity?.source ?? 'computed',
  }));
  if (!observedIdentity) {
    defects.push('Missing current artifact identity');
  } else if (hasExactIdentity(verdict.artifactIdentity) && stable(observedIdentity) !== stable(verdict.artifactIdentity)) {
    defects.push('Artifact identity mismatch');
  }

  const valid = defects.length === 0;
  return {
    valid,
    pass: valid && verdict.outcome === 'VERIFIED',
    approval: false,
    outcome: verdict.outcome,
    artifactIdentity: verdict.artifactIdentity ?? null,
    defects,
  };
}
