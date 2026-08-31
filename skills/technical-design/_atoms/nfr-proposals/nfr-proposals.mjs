#!/usr/bin/env node

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export class NfrProposalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NfrProposalError';
    this.code = code;
  }
}

export const EXIT_ACCEPTED = 0;
export const EXIT_REFUSED = 1;
export const EXIT_FINDINGS = 2;
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function requiredText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new NfrProposalError('invalid_input', `${field} must be non-empty text`);
  }
  return value.trim();
}

export function validateNfrProposals(input = {}) {
  if (!Array.isArray(input.proposals)) throw new NfrProposalError('invalid_input', 'proposals must be an array');
  const findings = [];
  const seen = new Set();
  const proposals = input.proposals.map((proposal, index) => {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
      throw new NfrProposalError('invalid_input', `proposal ${index + 1} must be an object`);
    }
    const id = requiredText(proposal.id, `proposal ${index + 1}.id`);
    if (!TOKEN.test(id)) throw new NfrProposalError('invalid_input', `proposal ${id}.id must be a stable token`);
    if (seen.has(id)) findings.push({ code: 'duplicate-id', severity: 'high', subject: id });
    seen.add(id);
    for (const field of ['revision', 'generatedByDecision', 'justification', 'serves', 'scope', 'verificationIntent', 'sourceDesign']) {
      requiredText(proposal[field], `proposal ${id}.${field}`);
    }
    if (proposal.authority !== 'proposed') {
      findings.push({ code: 'authority-not-proposed', severity: 'high', subject: id });
    }
    if (proposal.approval?.state !== 'pending' || proposal.approval?.evidence) {
      findings.push({ code: 'self-approval', severity: 'high', subject: id });
    }
    const thresholdKnown = typeof proposal.threshold === 'string' && proposal.threshold.trim() !== '';
    const thresholdUnknown = proposal.threshold === null && proposal.thresholdStatus === 'threshold-unknown';
    if (thresholdKnown === thresholdUnknown) {
      findings.push({ code: 'threshold-shape', severity: 'high', subject: id });
    }
    return { id, thresholdKnown, thresholdUnknown };
  });
  const invalid = findings.length > 0;
  return {
    status: invalid ? 'invalid' : (proposals.some((proposal) => proposal.thresholdUnknown) ? 'needs-threshold' : 'valid'),
    proposals,
    findings,
    authority: {
      state: 'proposed',
      downstreamAuthoritative: false,
      separateHumanApprovalRequired: true,
    },
  };
}

export function exitCodeFor(result) {
  return result.findings.length ? EXIT_FINDINGS : EXIT_ACCEPTED;
}

function run(argv, streams = process) {
  if (argv.includes('--probe')) {
    streams.stdout.write('nfr-proposals: available\n');
    return EXIT_ACCEPTED;
  }
  try {
    const result = validateNfrProposals(JSON.parse(fs.readFileSync(0, 'utf8')));
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
