#!/usr/bin/env node

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  renderNfrProposal,
  validateNfrProposals,
} from '../../_atoms/nfr-proposals/nfr-proposals.mjs';
import { validateFiles as validateSpecFiles } from '../../../spec/_atoms/spec-pair/spec-pair.mjs';

export class EngineeringDesignError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'EngineeringDesignError';
    this.code = code;
  }
}

export const DESIGN_STATUSES = [
  'blocked',
  'needs-decision',
  'needs-evidence',
  'no-design-required',
  'complete',
];
export const IMPACT_AREAS = [
  'boundaries',
  'interfaces',
  'state',
  'failure-behavior',
  'compatibility-migration',
  'implementation-choice',
  'cross-cutting-behavior',
];
export const APPLICABILITY_AREAS = [
  'interfaces',
  'failure-behavior',
  'compatibility-migration',
  'verification',
  'rollout',
  'rollback-recovery',
  'security',
  'privacy',
  'observability',
  'operations',
];
export const EXIT_ACCEPTED = 0;
export const EXIT_REFUSED = 1;
export const EXIT_FINDINGS = 2;

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EngineeringDesignError('invalid_input', `${field} must be an object`);
  }
  return value;
}

function array(value, field) {
  if (!Array.isArray(value)) {
    throw new EngineeringDesignError('invalid_input', `${field} must be an array`);
  }
  return value;
}

function token(value, field) {
  if (typeof value !== 'string' || !TOKEN.test(value.trim())) {
    throw new EngineeringDesignError('invalid_input', `${field} must be a stable token`);
  }
  return value.trim();
}

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EngineeringDesignError('invalid_input', `${field} must be non-empty text`);
  }
  return value.trim();
}

function finding(code, subject, detail) {
  return { code, severity: 'high', subject, detail };
}

function textArray(value, field) {
  const entries = array(value, field);
  for (const [index, entry] of entries.entries()) text(entry, `${field} ${index + 1}`);
  return entries;
}

function uniqueIds(entries, field, findings) {
  const result = new Set();
  for (const [index, entry] of entries.entries()) {
    object(entry, `${field} ${index + 1}`);
    const id = token(entry.id, `${field} ${index + 1}.id`);
    if (result.has(id)) findings.push(finding(`duplicate-${field}-id`, id, `${field} identities must be unique`));
    result.add(id);
  }
  return result;
}

function digestFunctionalRequirements(requirements) {
  const canonical = requirements.map(({ id, text: requirementText }) => ({
    id,
    text: requirementText,
  }));
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function persistedFile(repositoryRoot, relativePath, field, allowedPrefix = null) {
  const root = fs.realpathSync(text(repositoryRoot, 'repositoryRoot'));
  const normalized = text(relativePath, field).replaceAll('\\', '/');
  if (path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new EngineeringDesignError('invalid_input', `${field} must stay within the repository`);
  }
  if (allowedPrefix && !normalized.startsWith(`${allowedPrefix}/`)) {
    throw new EngineeringDesignError('invalid_input', `${field} must be beneath ${allowedPrefix}/`);
  }
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new EngineeringDesignError('invalid_input', `${field} must stay within the repository`);
  }
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    throw new EngineeringDesignError('invalid_input', `${field} must name a persisted file`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new EngineeringDesignError('invalid_input', `${field} must name a regular, non-symbolic file`);
  }
  const canonical = fs.realpathSync(absolute);
  const canonicalRelative = path.relative(root, canonical);
  if (canonicalRelative.startsWith('..') || path.isAbsolute(canonicalRelative)) {
    throw new EngineeringDesignError('invalid_input', `${field} must resolve within the repository`);
  }
  const bytes = fs.readFileSync(absolute);
  return {
    path: normalized,
    bytes,
    contentDigest: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

function defaultGitRunner(repositoryRoot, args) {
  try {
    return {
      status: 'ok',
      stdout: execFileSync('git', args, { cwd: repositoryRoot }),
    };
  } catch (error) {
    return { status: 'error', stderr: String(error.stderr ?? error.message) };
  }
}

function requirementsFromNano(bytes) {
  const lines = bytes.toString('utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === '## Acceptance Criteria');
  if (start === -1) return null;
  const endOffset = lines.slice(start + 1).findIndex((line) => line.startsWith('## '));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  const requirements = [];
  for (const line of lines.slice(start + 1, end)) {
    if (line.trim() === '') continue;
    const match = line.match(/^- ([A-Za-z0-9][A-Za-z0-9._-]*):\s+(.+)$/);
    if (!match) return null;
    requirements.push({ id: match[1], text: match[2].trim() });
  }
  return requirements.length ? requirements : null;
}

function metadataValue(bytes, label) {
  const prefix = `- ${label}:`;
  const matches = [];
  let fenced = false;
  for (const line of bytes.toString('utf8').split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && line.startsWith(prefix)) matches.push(line.slice(prefix.length).trim());
  }
  return matches.length === 1 ? matches[0] : null;
}

function verifiedApproval(repositoryRoot, approval, field, expected, runGit) {
  if (approval.state !== 'approved') return false;
  if (approval.boundary !== 'git-default-branch'
      || typeof approval.remote !== 'string'
      || typeof approval.defaultBranch !== 'string'
      || approval.defaultBranchRef !== `${approval.remote}/${approval.defaultBranch}`
      || approval.artifactPath !== expected.artifactPath
      || approval.contentDigest !== expected.contentDigest
      || !/^[0-9a-f]{40}$/.test(approval.publishedCommit ?? '')
      || Number.isNaN(Date.parse(approval.observedAt))) return false;
  const commands = [
    ['fetch', approval.remote],
    ['remote', 'get-url', approval.remote],
    ['rev-parse', '--symbolic-full-name', approval.defaultBranchRef],
    ['symbolic-ref', `refs/remotes/${approval.remote}/HEAD`],
    ['rev-parse', approval.defaultBranchRef],
    ['show', `${approval.defaultBranchRef}:${approval.artifactPath}`],
  ];
  const results = commands.map((args) => runGit({ repositoryRoot, args }));
  if (results.some((result) => result?.status !== 'ok')) return false;
  const symbolicRef = String(results[2].stdout).trim();
  const remoteHead = String(results[3].stdout).trim();
  const publishedCommit = String(results[4].stdout).trim().toLowerCase();
  const publishedBytes = Buffer.isBuffer(results[5].stdout)
    ? results[5].stdout
    : Buffer.from(String(results[5].stdout));
  const publishedDigest = crypto.createHash('sha256').update(publishedBytes).digest('hex');
  const requirementsMatch = !expected.functionalRequirements
    || digestFunctionalRequirements(requirementsFromNano(publishedBytes) ?? [])
      === digestFunctionalRequirements(expected.functionalRequirements);
  const metadataMatch = !expected.metadata
    || Object.entries(expected.metadata).every(([label, value]) => metadataValue(publishedBytes, label) === value);
  let recordMatch = true;
  if (expected.record) {
    try {
      const record = JSON.parse(publishedBytes.toString('utf8'));
      recordMatch = record && typeof record === 'object' && !Array.isArray(record)
        && Object.entries(expected.record).every(([key, value]) => record[key] === value);
    } catch {
      recordMatch = false;
    }
  }
  return symbolicRef === `refs/remotes/${approval.remote}/${approval.defaultBranch}`
    && remoteHead === `refs/remotes/${approval.remote}/${approval.defaultBranch}`
    && publishedCommit === approval.publishedCommit
    && publishedDigest === expected.contentDigest
    && requirementsMatch
    && metadataMatch
    && recordMatch;
}

export function resolveEngineeringDesign(input = {}, options = {}) {
  object(input, 'input');
  const repositoryRoot = text(input.repositoryRoot, 'repositoryRoot');
  const runGit = options.runGit ?? (({ repositoryRoot: root, args }) => defaultGitRunner(root, args));
  const findings = [];
  const specification = object(input.specification, 'specification');
  const approval = specification.approval === undefined
    ? { state: 'absent' }
    : object(specification.approval, 'specification.approval');
  const specificationId = token(specification.id, 'specification.id');
  const specificationRevision = token(specification.revision, 'specification.revision');
  const specificationDigest = token(specification.contentDigest, 'specification.contentDigest');
  const specificationPath = text(specification.path, 'specification.path');
  const fullSpecificationPath = text(specification.fullPath, 'specification.fullPath');
  const fullSpecificationDigest = token(
    specification.fullContentDigest,
    'specification.fullContentDigest',
  );
  const specificationSource = text(specification.source, 'specification.source');
  const persistedSpecification = persistedFile(
    repositoryRoot,
    specificationPath,
    'specification.path',
    'docs/agent/specs',
  );
  const persistedFullSpecification = persistedFile(
    repositoryRoot,
    fullSpecificationPath,
    'specification.fullPath',
    'docs/agent/specs',
  );
  let specificationPair = null;
  try {
    specificationPair = validateSpecFiles(
      repositoryRoot,
      specificationPath,
      fullSpecificationPath,
      specificationSource,
      specificationRevision,
    );
    if (specificationPair.specId !== specificationId) {
      findings.push(finding(
        'specification-identity-mismatch',
        specificationId,
        'the canonical nano specification identity must match the design intake',
      ));
    }
  } catch (error) {
    findings.push(finding('specification-pair-invalid', specificationId, error.message));
  }
  const design = object(input.design, 'design');
  const designId = token(design.id, 'design.id');
  const designRevision = token(design.revision, 'design.revision');
  const designDocument = object(design.document, 'design.document');
  const designDocumentPath = text(designDocument.path, 'design.document.path');
  const designDocumentDigest = token(designDocument.contentDigest, 'design.document.contentDigest');
  const persistedDesignDocument = persistedFile(
    repositoryRoot,
    designDocumentPath,
    'design.document.path',
    'docs/agent/designs',
  );
  const designDocumentVerified = persistedDesignDocument.contentDigest === designDocumentDigest;
  if (!designDocumentVerified) {
    findings.push(finding(
      'design-document-not-verified',
      designDocumentPath,
      'the persisted design document digest must reproduce from reread bytes',
    ));
  }
  const designApproval = input.designApproval === undefined
    ? { state: 'absent' }
    : object(input.designApproval, 'designApproval');
  const functionalRequirements = array(input.functionalRequirements, 'functionalRequirements');
  const requirementIds = uniqueIds(functionalRequirements, 'requirement', findings);
  for (const requirement of functionalRequirements) text(requirement.text, `requirement ${requirement.id}.text`);
  const functionalRequirementsDigest = digestFunctionalRequirements(functionalRequirements);
  const approved = verifiedApproval(repositoryRoot, approval, 'specification.approval', {
    artifactPath: specificationPath,
    contentDigest: specificationDigest,
    functionalRequirements,
  }, runGit);
  const designApproved = verifiedApproval(repositoryRoot, designApproval, 'designApproval', {
    artifactPath: designDocumentPath,
    contentDigest: designDocumentDigest,
    metadata: {
      'Design ID': designId,
      Revision: designRevision,
    },
  }, runGit);
  if (persistedSpecification.contentDigest !== specificationDigest) {
    findings.push(finding(
      'specification-not-verified',
      specificationPath,
      'the consumed nano specification must match the approved digest',
    ));
  }
  if (persistedFullSpecification.contentDigest !== fullSpecificationDigest) {
    findings.push(finding(
      'full-specification-not-verified',
      fullSpecificationPath,
      'the supporting full specification digest must reproduce from reread bytes',
    ));
  }

  const impact = object(input.impact, 'impact');
  const impactSignals = object(impact.signals, 'impact.signals');
  const signalKeys = Object.keys(impactSignals);
  if (signalKeys.length !== IMPACT_AREAS.length
      || IMPACT_AREAS.some((area) => !signalKeys.includes(area))) {
    throw new EngineeringDesignError(
      'invalid_input',
      `impact.signals must contain exactly: ${IMPACT_AREAS.join(', ')}`,
    );
  }
  const signalValues = IMPACT_AREAS.map((area) => {
    const signal = object(impactSignals[area], `impact.signals.${area}`);
    if (typeof signal.value !== 'boolean') {
      throw new EngineeringDesignError('invalid_input', `impact.signals.${area}.value must be boolean`);
    }
    const citations = array(signal.citations, `impact.signals.${area}.citations`);
    if (citations.length === 0
        || citations.some((citation) => typeof citation !== 'string' || citation.trim() === '')) {
      throw new EngineeringDesignError(
        'invalid_input',
        `impact.signals.${area}.citations must contain evidence`,
      );
    }
    return signal.value;
  });
  const designRequired = signalValues.some(Boolean);
  if (impact.designRequired !== designRequired) {
    findings.push(finding('impact-disagreement', 'impact', 'designRequired must equal whether any impact signal is true'));
  }

  const disposition = input.disposition;
  if (!['design', 'no-design-required'].includes(disposition)) {
    throw new EngineeringDesignError('invalid_input', 'disposition must be design or no-design-required');
  }
  if (disposition === 'no-design-required' && designRequired) {
    findings.push(finding('design-impact-present', 'impact', 'no-design-required is unavailable while any design-impact signal is true'));
  }
  if (disposition === 'design' && !designRequired) {
    findings.push(finding('design-impact-absent', 'impact', 'a design disposition requires at least one design-impact signal'));
  }

  const traceability = array(input.traceability, 'traceability');
  const traced = new Set();
  for (const [index, row] of traceability.entries()) {
    object(row, `traceability ${index + 1}`);
    const requirement = token(row.requirement, `traceability ${index + 1}.requirement`);
    if (!requirementIds.has(requirement)) {
      findings.push(finding('unknown-traceability-requirement', requirement, 'traceability names an undeclared functional requirement'));
    }
    if (traced.has(requirement)) {
      findings.push(finding('duplicate-traceability-row', requirement, 'each functional requirement has exactly one traceability row'));
    }
    traced.add(requirement);
    const sections = textArray(row.designSections ?? [], `traceability ${requirement}.designSections`);
    if (disposition === 'design' && sections.length === 0) {
      findings.push(finding('requirement-without-design', requirement, 'a design disposition must map every functional requirement to a design section'));
    }
    if (disposition === 'no-design-required') {
      if (sections.length) findings.push(finding('unexpected-design-section', requirement, 'no-design-required traceability cannot name a design section'));
      if (typeof row.noImpactEvidence !== 'string' || row.noImpactEvidence.trim() === '') {
        findings.push(finding('missing-no-impact-evidence', requirement, 'no-design-required needs cited no-impact evidence for every functional requirement'));
      }
    }
  }
  for (const id of requirementIds) {
    if (!traced.has(id)) findings.push(finding('untraced-functional-requirement', id, 'every immutable functional requirement must be traced'));
  }

  const decisions = array(input.decisions ?? [], 'decisions');
  const decisionIds = uniqueIds(decisions, 'decision', findings);
  let unresolvedDecision = false;
  let evidenceGap = false;
  for (const decision of decisions) {
    if (typeof decision.consequential !== 'boolean') {
      throw new EngineeringDesignError('invalid_input', `decision ${decision.id}.consequential must be boolean`);
    }
    if (typeof decision.adrRequired !== 'boolean') {
      throw new EngineeringDesignError('invalid_input', `decision ${decision.id}.adrRequired must be boolean`);
    }
    const approaches = array(decision.approaches ?? [], `decision ${decision.id}.approaches`);
    const approachIds = uniqueIds(approaches, `decision-${decision.id}-approach`, findings);
    const criteria = array(decision.criteria ?? [], `decision ${decision.id}.criteria`);
    const criterionIds = uniqueIds(criteria, `decision-${decision.id}-criterion`, findings);
    for (const criterion of criteria) text(criterion.text, `decision ${decision.id} criterion ${criterion.id}.text`);
    if (decision.consequential && criteria.length === 0) {
      findings.push(finding('missing-decision-criteria', decision.id, 'a consequential decision requires common comparison criteria'));
    }
    const viable = approaches.filter((approach) => approach?.viable === true);
    if (decision.consequential && new Set(viable.map((approach) => approach.id)).size < 2) {
      findings.push(finding('insufficient-viable-approaches', decision.id, 'a consequential decision requires at least two viable approaches'));
    }
    for (const approach of approaches) {
      const citations = textArray(approach.citations ?? [], `decision ${decision.id} approach ${approach.id}.citations`);
      if (decision.consequential && citations.length === 0) {
        evidenceGap = true;
        findings.push(finding('uncited-approach', decision.id, 'every compared approach needs evidence citations'));
      }
      const evaluations = array(
        approach.evaluations ?? [],
        `decision ${decision.id} approach ${approach.id}.evaluations`,
      );
      const evaluatedCriteria = new Set();
      for (const evaluation of evaluations) {
        object(evaluation, `decision ${decision.id} approach ${approach.id} evaluation`);
        const criterion = token(
          evaluation.criterion,
          `decision ${decision.id} approach ${approach.id} evaluation.criterion`,
        );
        if (evaluatedCriteria.has(criterion)) {
          findings.push(finding('duplicate-criterion-evaluation', approach.id, `criterion ${criterion} is evaluated more than once`));
        }
        evaluatedCriteria.add(criterion);
        text(evaluation.assessment, `decision ${decision.id} approach ${approach.id} evaluation.assessment`);
        const evaluationCitations = textArray(
          evaluation.citations ?? [],
          `decision ${decision.id} approach ${approach.id} evaluation.citations`,
        );
        if (evaluationCitations.length === 0) {
          evidenceGap = true;
          findings.push(finding(
            'uncited-criterion-evaluation',
            approach.id,
            `criterion ${criterion} evaluation requires evidence`,
          ));
        }
      }
      if (decision.consequential
          && (evaluatedCriteria.size !== criterionIds.size
            || [...criterionIds].some((criterion) => !evaluatedCriteria.has(criterion)))) {
        findings.push(finding(
          'incomplete-criterion-evaluation',
          approach.id,
          'every approach must evaluate every common decision criterion exactly once',
        ));
      }
    }
    if (decision.selected === null || decision.selected === undefined) {
      unresolvedDecision = true;
    } else if (!approaches.some((approach) => approach.id === decision.selected && approach.viable === true)) {
      findings.push(finding('invalid-selection', decision.id, 'the selected approach must be one of the viable approaches'));
    }
    for (const approach of viable) {
      if (approach.id !== decision.selected
          && (typeof approach.rejectedBecause !== 'string' || approach.rejectedBecause.trim() === '')) {
        findings.push(finding('missing-rejection-rationale', approach.id, 'each rejected viable approach requires rationale'));
      }
    }
    if (decision.adrRequired === true) {
      const adr = decision.adr;
      if (!adr || !['existing', 'proposed', 'unresolved-placement'].includes(adr.status)) {
        findings.push(finding('missing-adr-disposition', decision.id, 'an ADR-worthy decision requires a recognized ADR disposition'));
      } else if (['existing', 'proposed'].includes(adr.status)
          && (typeof adr.path !== 'string' || adr.path.trim() === '')) {
        findings.push(finding('missing-adr-path', decision.id, 'an existing or proposed ADR requires its repository path'));
      } else if (['existing', 'proposed'].includes(adr.status)) {
        try {
          const persistedAdr = persistedFile(repositoryRoot, adr.path, `decision ${decision.id}.adr.path`);
          if (typeof adr.contentDigest !== 'string'
              || adr.contentDigest !== persistedAdr.contentDigest) {
            findings.push(finding(
              'adr-not-verified',
              decision.id,
              'the ADR digest must reproduce from persisted bytes',
            ));
          }
        } catch (error) {
          findings.push(finding('adr-not-verified', decision.id, error.message));
        }
      } else if (adr.status === 'unresolved-placement') {
        unresolvedDecision = true;
      }
    }
  }

  const claims = array(input.materialClaims ?? [], 'materialClaims');
  uniqueIds(claims, 'claim', findings);
  for (const claim of claims) {
    const citations = textArray(claim.citations ?? [], `claim ${claim.id}.citations`);
    if (citations.length === 0) {
      evidenceGap = true;
      findings.push(finding('uncited-material-claim', claim.id, 'every material design claim requires repository or Discovery evidence'));
    }
  }

  const applicability = object(input.applicability, 'applicability');
  for (const area of APPLICABILITY_AREAS) {
    const entry = applicability[area];
    if (!entry || !['addressed', 'not-applicable'].includes(entry.status)) {
      findings.push(finding('missing-applicability-disposition', area, 'the design must address the area or cite why it is not applicable'));
      continue;
    }
    const citations = textArray(entry.citations ?? [], `applicability ${area}.citations`);
    if (citations.length === 0) {
      evidenceGap = true;
      findings.push(finding('uncited-applicability-disposition', area, 'the applicability disposition requires evidence'));
    }
  }

  const nfrs = array(input.nfrs ?? [], 'nfrs');
  uniqueIds(nfrs, 'nfr', findings);
  let nfrValidation;
  try {
    nfrValidation = validateNfrProposals({ proposals: nfrs });
  } catch (error) {
    findings.push(finding('invalid-nfr-proposal', 'nfrs', error.message));
    nfrValidation = { status: 'invalid', findings: [] };
  }
  for (const proposalFinding of nfrValidation.findings ?? []) {
    findings.push(finding(
      `nfr-${proposalFinding.code}`,
      proposalFinding.subject,
      'the persisted NFR proposal must satisfy the proposal contract',
    ));
  }
  const approvedNfrs = array(input.approvedNfrs ?? [], 'approvedNfrs');
  const approvedNfrIds = uniqueIds(approvedNfrs, 'approved-nfr', findings);
  const approvedNfrById = new Map();
  for (const approvedNfr of approvedNfrs) {
    approvedNfrById.set(approvedNfr.id, approvedNfr);
    const proposal = nfrs.find((entry) => entry.id === approvedNfr.id);
    const approvalReceipt = approvedNfr.approvalReceipt;
    if (approvedNfr.authority !== 'approved'
        || !proposal
        || approvedNfr.path !== proposal.path
        || approvedNfr.contentDigest !== proposal.contentDigest
        || !approvalReceipt
        || typeof approvalReceipt.path !== 'string'
        || !approvalReceipt.path.startsWith('docs/agent/nfr/approvals/')
        || approvalReceipt.path === approvedNfr.path
        || !verifiedApproval(
          repositoryRoot,
          approvedNfr.approval ?? {},
          `approvedNfrs.${approvedNfr.id}.approval`,
          {
            artifactPath: approvalReceipt?.path,
            contentDigest: approvalReceipt?.contentDigest,
            record: {
              kind: 'nfr-approval',
              state: 'approved',
              nfrId: approvedNfr.id,
              nfrRevision: approvedNfr.revision,
              sourceDesign: approvedNfr.sourceDesign,
              proposalDigest: proposal?.contentDigest,
            },
          },
          runGit,
        )) {
      findings.push(finding(
        'invalid-approved-nfr-evidence',
        approvedNfr.id,
        'an approved NFR binding requires approved authority and separate human approval evidence',
      ));
    }
  }
  let pendingNfrApproval = false;
  for (const nfr of nfrs) {
    const revision = token(nfr.revision, `nfr ${nfr.id}.revision`);
    const sourceDesign = text(nfr.sourceDesign, `nfr ${nfr.id}.sourceDesign`);
    try {
      const persistedNfr = persistedFile(
        repositoryRoot,
        nfr.path,
        `nfr ${nfr.id}.path`,
        'docs/agent/nfr',
      );
      if (persistedNfr.contentDigest !== nfr.contentDigest
          || persistedNfr.bytes.toString('utf8') !== renderNfrProposal(nfr)) {
        findings.push(finding(
          'nfr-not-verified',
          nfr.id,
          'the NFR proposal must reproduce from its canonical persisted bytes',
        ));
      }
    } catch (error) {
      findings.push(finding('nfr-not-verified', nfr.id, error.message));
    }
    if (sourceDesign !== `${designId}@${designRevision}`) {
      findings.push(finding(
        'foreign-nfr-source-design',
        nfr.id,
        'an NFR proposal must bind the current design identity and revision',
      ));
    }
    if (nfr.authority !== 'proposed') {
      findings.push(finding('invalid-nfr-authority', nfr.id, 'technical-design may emit only proposed non-functional requirements'));
    }
    if (nfr.approval?.state !== 'pending') {
      findings.push(finding('invalid-nfr-approval', nfr.id, 'technical-design cannot approve a proposed non-functional requirement'));
    }
    const approvedNfr = approvedNfrById.get(nfr.id);
    if (!approvedNfr
        || approvedNfr.revision !== revision
        || approvedNfr.sourceDesign !== sourceDesign
        || approvedNfr.path !== nfr.path
        || approvedNfr.contentDigest !== nfr.contentDigest) {
      pendingNfrApproval = true;
      if (approvedNfr) {
        findings.push(finding(
          'stale-approved-nfr',
          nfr.id,
          'approved NFR evidence must bind the proposal revision and source design',
        ));
      }
    }
  }
  for (const id of approvedNfrIds) {
    if (!nfrs.some((nfr) => nfr.id === id)) {
      findings.push(finding(
        'orphan-approved-nfr',
        id,
        'approved NFR evidence must bind a proposal emitted by this design',
      ));
    }
  }

  if (disposition === 'no-design-required' && (decisions.length || claims.length || nfrs.length)) {
    findings.push(finding('no-design-output-present', 'disposition', 'no-design-required cannot carry design decisions, material claims, or NFR proposals'));
  }

  const blocked = findings.some((entry) => ![
    'uncited-approach',
    'uncited-criterion-evaluation',
    'uncited-material-claim',
    'uncited-applicability-disposition',
  ].includes(entry.code));
  let status;
  if (blocked) status = 'blocked';
  else if (!approved || !designApproved || unresolvedDecision || pendingNfrApproval) status = 'needs-decision';
  else if (evidenceGap || array(input.evidenceGaps ?? [], 'evidenceGaps').length) status = 'needs-evidence';
  else if (disposition === 'no-design-required') status = 'no-design-required';
  else status = 'complete';

  return {
    status,
    specification: {
      id: specificationId,
      revision: specificationRevision,
      path: specificationPath,
      fullPath: fullSpecificationPath,
      contentDigest: specificationDigest,
      fullContentDigest: fullSpecificationDigest,
      functionalRequirementsDigest,
      approved,
    },
    designApproval: {
      approved: designApproved,
      designId,
      designRevision,
      contentDigest: designDocumentDigest,
    },
    design: {
      id: designId,
      revision: designRevision,
      document: {
        path: designDocumentPath,
        contentDigest: designDocumentDigest,
        rereadVerified: designDocumentVerified,
      },
    },
    disposition,
    impact: { designRequired, signals: impactSignals },
    counts: {
      functionalRequirements: requirementIds.size,
      decisions: decisionIds.size,
      materialClaims: claims.length,
      proposedNfrs: nfrs.length,
    },
    downstream: {
      eligible: ['complete', 'no-design-required'].includes(status)
        && designApproved
        && !pendingNfrApproval,
      requires: ['settled-design', 'approved-functional-requirements', 'separately-approved-nfrs-only'],
    },
    findings,
  };
}

export function exitCodeFor(result) {
  return result.findings.length ? EXIT_FINDINGS : EXIT_ACCEPTED;
}

function run(argv, streams = process) {
  if (argv.includes('--probe')) {
    streams.stdout.write('engineering-design: available\n');
    return EXIT_ACCEPTED;
  }
  try {
    const result = resolveEngineeringDesign(JSON.parse(fs.readFileSync(0, 'utf8')));
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return exitCodeFor(result);
  } catch (error) {
    streams.stderr.write(`${error.code ?? 'invalid_input'}: ${error.message}\n`);
    return EXIT_REFUSED;
  }
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirectInvocation()) process.exitCode = run(process.argv.slice(2));
