#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveApprovalState, verifyApprovalObservation, ApprovalStateError } from '../approval-state/approval-state.mjs';

export class DiscoverySourceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DiscoverySourceError';
    this.code = code;
  }
}

export const SOURCE_KINDS = ['markdown', 'tracker-issue'];
export const STATE_VERSION = 1;

const FIELDS = [
  'version',
  'kind',
  'locator',
  'alignment',
  'capturedRevision',
  'currentRevision',
  'repositoryRoot',
  'specNanoPath',
  'approvalEvidence',
  'confirmedFacts',
  'decisions',
  'assumptions',
  'contradictions',
  'unresolvedQuestions',
  'scope',
  'exclusions',
];

function text(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DiscoverySourceError('invalid-source', `${field} must be non-empty text`);
  }
  return value.trim();
}

function stringArray(value, field, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new DiscoverySourceError('invalid-source', `${field} must be an array of non-empty strings`);
  }
  if (nonEmpty && value.length === 0) {
    throw new DiscoverySourceError('incomplete', `${field} must not be empty`);
  }
  return value.map((entry) => entry.trim());
}

function normalizedPath(candidate) {
  return candidate.split(path.sep).join('/').replace(/^\.\//, '');
}

function validateLocator(kind, locator) {
  if (kind === 'markdown') {
    const normalized = normalizedPath(locator);
    if (
      normalized.includes('..')
      || !normalized.startsWith('docs/agent/discovery/')
      || !normalized.endsWith('.md')
    ) {
      throw new DiscoverySourceError(
        'invalid-source',
        'a Markdown Discovery source must be a .md path beneath docs/agent/discovery/',
      );
    }
    return normalized;
  }

  let parsed;
  try {
    parsed = new URL(locator);
  } catch {
    throw new DiscoverySourceError('invalid-source', 'a tracker issue locator must be an HTTPS URL');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new DiscoverySourceError(
      'invalid-source',
      'a tracker issue locator must be an HTTPS URL without embedded credentials',
    );
  }
  return parsed.toString();
}

export async function validateDiscoverySource(input, { verify = verifyApprovalObservation } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DiscoverySourceError('invalid-source', 'the Discovery intake must be an object');
  }
  const unknown = Object.keys(input).filter((field) => !FIELDS.includes(field)).sort();
  if (unknown.length) {
    throw new DiscoverySourceError('invalid-source', `unknown field(s): ${unknown.join(', ')}`);
  }
  const missing = FIELDS.filter((field) => input[field] === undefined);
  if (missing.length) {
    throw new DiscoverySourceError('invalid-source', `missing field(s): ${missing.join(', ')}`);
  }
  if (input.version !== STATE_VERSION) {
    throw new DiscoverySourceError('invalid-source', `version must be ${STATE_VERSION}`);
  }
  const kind = text(input.kind, 'kind');
  if (!SOURCE_KINDS.includes(kind)) {
    throw new DiscoverySourceError(
      'invalid-source',
      `kind must be one of ${SOURCE_KINDS.join(', ')}`,
    );
  }
  const locator = validateLocator(kind, text(input.locator, 'locator'));

  // Validate repositoryRoot — required, absolute path, used for verification.
  const repositoryRoot = text(input.repositoryRoot, 'repositoryRoot');
  if (!path.isAbsolute(repositoryRoot)) {
    throw new DiscoverySourceError(
      'invalid-source',
      'repositoryRoot must be an absolute path',
    );
  }

  // F4: Validate specNanoPath — required when approvalEvidence is present,
  // validated with slug vocabulary. Binds the approval to a specific spec.
  const NANO_PATH_RE = /^docs\/agent\/specs\/([a-z0-9]+(?:-[a-z0-9]+)*)\.nano\.md$/;
  let specNanoPath = null;
  if (input.specNanoPath !== null) {
    specNanoPath = text(input.specNanoPath, 'specNanoPath');
    if (!NANO_PATH_RE.test(specNanoPath)) {
      throw new DiscoverySourceError(
        'invalid-source',
        'specNanoPath must match docs/agent/specs/<slug>.nano.md where <slug> is lowercase ASCII alphanumeric words separated by single hyphens',
      );
    }
  }

  if (input.alignment !== 'confirmed') {
    throw new DiscoverySourceError(
      'unconfirmed',
      'alignment must be exactly confirmed; raw conversation and inferred agreement do not count',
    );
  }
  const capturedRevision = text(input.capturedRevision, 'capturedRevision');
  const currentRevision = text(input.currentRevision, 'currentRevision');

  // Validate digest form for markdown before freshness check.
  if (kind === 'markdown' && !/^[a-f0-9]{64}$/i.test(capturedRevision)) {
    throw new DiscoverySourceError(
      'invalid-source',
      'a Markdown revision must be a SHA-256 digest',
    );
  }
  if (kind === 'markdown' && !/^[a-f0-9]{64}$/i.test(currentRevision)) {
    throw new DiscoverySourceError(
      'invalid-source',
      'a Markdown revision must be a SHA-256 digest',
    );
  }

  // State-dependent freshness.
  if (capturedRevision !== currentRevision) {
    // Resolve approval state if evidence was provided.
    if (input.approvalEvidence !== null && input.approvalEvidence !== undefined) {
      // Validate the observation structure first.
      let approvalResult;
      try {
        approvalResult = resolveApprovalState(input.approvalEvidence);
      } catch (error) {
        if (error instanceof ApprovalStateError) {
          throw new DiscoverySourceError(
            'invalid-source',
            `approval evidence is structurally invalid: ${error.message}`,
          );
        }
        throw error;
      }

      if (approvalResult.state === 'approved') {
        // F4: specNanoPath is required when approval evidence is present.
        if (specNanoPath === null) {
          throw new DiscoverySourceError(
            'invalid-source',
            'specNanoPath is required when approval evidence is present — it binds the approval to a specific specification',
          );
        }

        // Verification is the only route to held. The injected verifier
        // (defaulting to verifyApprovalObservation, overridable for tests)
        // recomputes digests from git and refuses when the observation
        // disagrees. A fabricated observation is caught here.
        let verifyResult;
        try {
          verifyResult = await verify({
            repositoryRoot,
            observation: input.approvalEvidence,
          });
        } catch (error) {
          if (error instanceof ApprovalStateError) {
            throw new DiscoverySourceError(
              'invalid-source',
              `approval verification failed: ${error.message}`,
            );
          }
          throw error;
        }

        // F2: require verified === true and state === 'approved' from the
        // verifier result. Any other shape — falsy, non-object, verified
        // absent or not exactly true, state not approved — refuses.
        if (
          !verifyResult ||
          typeof verifyResult !== 'object' ||
          verifyResult.verified !== true ||
          verifyResult.state !== 'approved'
        ) {
          throw new DiscoverySourceError(
            'invalid-source',
            `approval verification did not confirm approved state (verified=${verifyResult?.verified}, state=${verifyResult?.state})`,
          );
        }

        // F3: require BOTH publishedSource and publishedSourceRevision to be
        // present and to match. Absent, unparsable, or duplicated provenance
        // (which the parser reports as null) is a refusal naming which line
        // was missing or ambiguous.
        if (verifyResult.publishedSource === null && verifyResult.publishedSourceRevision === null) {
          throw new DiscoverySourceError(
            'invalid-source',
            'approval provenance is incomplete: both Source and Source revision are missing from the published nano',
          );
        }
        if (verifyResult.publishedSource === null) {
          throw new DiscoverySourceError(
            'invalid-source',
            'approval provenance is incomplete: Source is missing or ambiguous in the published nano',
          );
        }
        if (verifyResult.publishedSourceRevision === null) {
          throw new DiscoverySourceError(
            'invalid-source',
            'approval provenance is incomplete: Source revision is missing or ambiguous in the published nano',
          );
        }

        // Bind the approval to the exact source and revision.
        const mismatches = [];
        if (verifyResult.publishedSource !== locator) {
          mismatches.push(
            `Source: published=${verifyResult.publishedSource}, intake=${locator}`,
          );
        }
        if (verifyResult.publishedSourceRevision !== capturedRevision) {
          mismatches.push(
            `Source revision: published=${verifyResult.publishedSourceRevision}, intake=${capturedRevision}`,
          );
        }
        if (mismatches.length > 0) {
          throw new DiscoverySourceError(
            'invalid-source',
            `approval is bound to different provenance: ${mismatches.join('; ')}`,
          );
        }

        // F4: require approval evidence nanoPath equals specNanoPath.
        if (input.approvalEvidence.nanoPath !== specNanoPath) {
          throw new DiscoverySourceError(
            'invalid-source',
            `approval is bound to a different specification: approvalEvidence.nanoPath="${input.approvalEvidence.nanoPath}", specNanoPath="${specNanoPath}"`,
          );
        }

        // Approved + verified + bound => hold.
        const sourceRecord = buildSourceRecord(input, kind, locator, capturedRevision, currentRevision);
        return {
          status: 'held',
          freshness: 'held',
          approval: approvalResult,
          source: sourceRecord,
        };
      }

      // Draft evidence => stale refusal.
      throw new DiscoverySourceError(
        'stale',
        `the Discovery source changed after confirmation (${capturedRevision} != ${currentRevision}) (approval state: draft, reason: ${approvalResult.reasons.join(', ')})`,
      );
    }

    // No evidence => stale refusal.
    throw new DiscoverySourceError(
      'stale',
      `the Discovery source changed after confirmation (${capturedRevision} != ${currentRevision}) (no approval evidence)`,
    );
  }

  return {
    status: 'ready',
    freshness: 'fresh',
    approval: null,
    source: buildSourceRecord(input, kind, locator, capturedRevision, currentRevision),
  };
}

function buildSourceRecord(input, kind, locator, capturedRevision, currentRevision) {
  return {
    version: STATE_VERSION,
    kind,
    locator,
    alignment: 'confirmed',
    revision: capturedRevision,
    currentRevision,
    confirmedFacts: stringArray(input.confirmedFacts, 'confirmedFacts', { nonEmpty: true }),
    decisions: stringArray(input.decisions, 'decisions'),
    assumptions: stringArray(input.assumptions, 'assumptions'),
    contradictions: stringArray(input.contradictions, 'contradictions'),
    unresolvedQuestions: stringArray(input.unresolvedQuestions, 'unresolvedQuestions'),
    scope: stringArray(input.scope, 'scope', { nonEmpty: true }),
    exclusions: stringArray(input.exclusions, 'exclusions', { nonEmpty: true }),
  };
}

export const USAGE = 'Usage: discovery-source.mjs --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 2 || argv[0] !== '--input' || !path.isAbsolute(argv[1])) {
    throw new DiscoverySourceError('usage', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[1], 'utf8'));
  return validateDiscoverySource(input).then((result) => {
    streams.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  });
}

function direct() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (direct()) {
  try {
    const result = run(process.argv.slice(2));
    if (result instanceof Promise) {
      result.then(
        (code) => { process.exitCode = code; },
        (error) => {
          process.stderr.write(`${JSON.stringify({
            error: { code: error.code ?? 'invalid-source', message: error.message },
          })}\n`);
          process.exitCode = 1;
        },
      );
    } else {
      process.exitCode = result;
    }
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      error: { code: error.code ?? 'invalid-source', message: error.message },
    })}\n`);
    process.exitCode = 1;
  }
}
