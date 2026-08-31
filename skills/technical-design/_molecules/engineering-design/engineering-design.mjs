#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

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

export function resolveEngineeringDesign(input = {}) {
  object(input, 'input');
  const findings = [];
  const specification = object(input.specification, 'specification');
  const approval = object(specification.approval, 'specification.approval');
  const approved = approval.state === 'approved'
    && typeof approval.evidence === 'string'
    && approval.evidence.trim() !== '';
  const functionalRequirements = array(input.functionalRequirements, 'functionalRequirements');
  const requirementIds = uniqueIds(functionalRequirements, 'requirement', findings);
  for (const requirement of functionalRequirements) text(requirement.text, `requirement ${requirement.id}.text`);

  const impact = object(input.impact, 'impact');
  const impactSignals = object(impact.signals, 'impact.signals');
  const signalValues = Object.values(impactSignals);
  if (!signalValues.length || signalValues.some((value) => typeof value !== 'boolean')) {
    throw new EngineeringDesignError('invalid_input', 'impact.signals must contain boolean values');
  }
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
    const sections = array(row.designSections ?? [], `traceability ${requirement}.designSections`);
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
  for (const decision of decisions) {
    if (typeof decision.consequential !== 'boolean') {
      throw new EngineeringDesignError('invalid_input', `decision ${decision.id}.consequential must be boolean`);
    }
    const approaches = array(decision.approaches ?? [], `decision ${decision.id}.approaches`);
    const viable = approaches.filter((approach) => approach?.viable === true);
    if (decision.consequential && viable.length < 2) {
      findings.push(finding('insufficient-viable-approaches', decision.id, 'a consequential decision requires at least two viable approaches'));
    }
    if (decision.consequential && approaches.some((approach) => !Array.isArray(approach?.citations) || approach.citations.length === 0)) {
      findings.push(finding('uncited-approach', decision.id, 'every compared approach needs evidence citations'));
    }
    if (decision.selected === null || decision.selected === undefined) {
      unresolvedDecision = true;
    } else if (!approaches.some((approach) => approach.id === decision.selected && approach.viable === true)) {
      findings.push(finding('invalid-selection', decision.id, 'the selected approach must be one of the viable approaches'));
    }
    if (decision.adrRequired === true && (!decision.adr || decision.adr.status === 'buried')) {
      findings.push(finding('missing-adr-disposition', decision.id, 'an ADR-worthy decision must name an ADR path or an explicit proposed ADR'));
    }
  }

  const claims = array(input.materialClaims ?? [], 'materialClaims');
  uniqueIds(claims, 'claim', findings);
  let evidenceGap = false;
  for (const claim of claims) {
    const citations = array(claim.citations ?? [], `claim ${claim.id}.citations`);
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
    if (!Array.isArray(entry.citations) || entry.citations.length === 0) {
      evidenceGap = true;
      findings.push(finding('uncited-applicability-disposition', area, 'the applicability disposition requires evidence'));
    }
  }

  const nfrs = array(input.nfrs ?? [], 'nfrs');
  uniqueIds(nfrs, 'nfr', findings);
  let pendingNfrApproval = false;
  for (const nfr of nfrs) {
    if (nfr.authority !== 'proposed') {
      findings.push(finding('invalid-nfr-authority', nfr.id, 'technical-design may emit only proposed non-functional requirements'));
    }
    if (nfr.approval?.state !== 'pending') {
      findings.push(finding('invalid-nfr-approval', nfr.id, 'technical-design cannot approve a proposed non-functional requirement'));
    }
    pendingNfrApproval = true;
  }

  if (disposition === 'no-design-required' && (decisions.length || claims.length || nfrs.length)) {
    findings.push(finding('no-design-output-present', 'disposition', 'no-design-required cannot carry design decisions, material claims, or NFR proposals'));
  }

  const blocked = findings.some((entry) => ![
    'uncited-material-claim',
    'uncited-applicability-disposition',
  ].includes(entry.code));
  let status;
  if (blocked) status = 'blocked';
  else if (!approved || unresolvedDecision || pendingNfrApproval) status = 'needs-decision';
  else if (evidenceGap || array(input.evidenceGaps ?? [], 'evidenceGaps').length) status = 'needs-evidence';
  else if (disposition === 'no-design-required') status = 'no-design-required';
  else status = 'complete';

  return {
    status,
    specification: {
      id: token(specification.id, 'specification.id'),
      revision: token(specification.revision, 'specification.revision'),
      approved,
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
      eligible: ['complete', 'no-design-required'].includes(status) && nfrs.length === 0,
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
