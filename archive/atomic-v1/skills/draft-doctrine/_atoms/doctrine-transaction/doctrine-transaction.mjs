#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseManifest,
} from '../../../_base/_atoms/doctrine-evaluate/doctrine-evaluate.mjs';
import {
  CONFIRMATION_GRANT,
  applyPreview,
  buildPreview,
} from '../../../setup-repository/_atoms/write-gate/write-gate.mjs';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DIGEST = /^[a-f0-9]{64}$/;
const APPROVAL_GRANT = 'approve-doctrine-write';
const NOTICE_GRANT = 'approve-notice-write';
const MAX_PROVENANCE_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_FINDINGS = 100;
const MAX_FINDING_TEXT_BYTES = 1000;
const MAX_DOCTRINE_WORDS = 499;

export class DoctrineTransactionError extends Error {
  constructor(code, message, status = 'blocked', detail = {}) {
    super(message);
    this.name = 'DoctrineTransactionError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fail(code, message, status = 'blocked', detail = {}) {
  throw new DoctrineTransactionError(code, message, status, detail);
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function requirePlainString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('needs-input', `${field} is required`, 'needs-input');
  }
  return value;
}

function countWords(text) {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\s+/)
    .filter((token) => token !== '' && /[\p{L}\p{N}]/u.test(token))
    .length;
}

function directoryIdentity(directory, label, parentAnchors = []) {
  for (const anchor of parentAnchors) verifyDirectoryIdentity(anchor);
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    fail('unsafe-path', `${label} cannot be inspected`, 'blocked', { filesystemCode: error?.code ?? 'unknown' });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail('unsafe-path', `${label} must be a regular directory without links`);
  }
  return { path: directory, label, dev: String(stat.dev), ino: String(stat.ino) };
}

function verifyDirectoryIdentity(anchor) {
  let stat;
  try {
    stat = fs.lstatSync(anchor.path);
  } catch (error) {
    fail('unsafe-path', `${anchor.label} changed or cannot be inspected`, 'blocked', { filesystemCode: error?.code ?? 'unknown' });
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()
    || String(stat.dev) !== anchor.dev || String(stat.ino) !== anchor.ino) {
    fail('unsafe-path', `${anchor.label} changed identity or became unsafe`);
  }
}

function readRegularNoFollow(file, label, {
  mayBeAbsent = false,
  ancestors = [],
  race,
} = {}) {
  let preStat = null;
  let fd;
  try {
    for (const anchor of ancestors) verifyDirectoryIdentity(anchor);
    race?.({ phase: 'after-ancestor-check-before-open', label, file });
    for (const anchor of ancestors) verifyDirectoryIdentity(anchor);
    if (!fs.constants.O_NOFOLLOW) {
      preStat = fs.lstatSync(file);
      if (preStat.isSymbolicLink() || !preStat.isFile()) {
        fail('unsafe-path', `${label} must be a regular file without links`);
      }
    }
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    for (const anchor of ancestors) verifyDirectoryIdentity(anchor);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) fail('unsafe-path', `${label} must be a regular file`);
    if (preStat && (preStat.dev !== stat.dev || preStat.ino !== stat.ino)) {
      fail('unsafe-path', `${label} changed identity while opening`);
    }
    if (stat.nlink !== 1) fail('hard-link-collision', `${label} has ${stat.nlink} hard links; refusing ambiguous authority`);
    const bytes = fs.readFileSync(fd);
    const postStat = fs.fstatSync(fd);
    for (const anchor of ancestors) verifyDirectoryIdentity(anchor);
    if (postStat.dev !== stat.dev || postStat.ino !== stat.ino || postStat.nlink !== 1) {
      fail('unsafe-path', `${label} changed identity or link count while reading`);
    }
    return {
      exists: true,
      dev: String(stat.dev),
      ino: String(stat.ino),
      nlink: stat.nlink,
      sha256: sha256(bytes),
      bytes,
      text: bytes.toString('utf8'),
    };
  } catch (error) {
    if (error instanceof DoctrineTransactionError) throw error;
    if (mayBeAbsent && error?.code === 'ENOENT') return { exists: false };
    fail('unsafe-path', `${label} cannot be inspected`, 'blocked', { filesystemCode: error?.code ?? 'unknown' });
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* noop */ }
    }
  }
}

function assertCanonicalRoot(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || !path.isAbsolute(repositoryRoot)) {
    fail('unsafe-path', 'repositoryRoot must be absolute');
  }
  const root = directoryIdentity(repositoryRoot, 'repositoryRoot');
  if (fs.realpathSync(repositoryRoot) !== repositoryRoot) {
    fail('unsafe-path', 'repositoryRoot must be a canonical directory without links');
  }
  verifyDirectoryIdentity(root);
  return root;
}

function identityOf(value) {
  if (!value?.exists) return { exists: false };
  return {
    exists: true,
    dev: value.dev,
    ino: value.ino,
    nlink: value.nlink,
    sha256: value.sha256,
  };
}

function strictManifest(raw) {
  if (!raw.startsWith('---\n')) fail('invalid-manifest', 'manifest must begin with frontmatter');
  const end = raw.indexOf('\n---\n', 4);
  if (end < 0) fail('invalid-manifest', 'manifest frontmatter is unterminated');
  const lines = raw.slice(4, end).split('\n');
  if (lines[0] !== 'schema-version: 1' || lines[1] !== 'doctrine:') {
    fail('invalid-manifest', 'manifest must declare schema-version 1 and doctrine');
  }
  for (let index = 2; index < lines.length; index += 3) {
    if (!/^  - id: [a-z0-9]+(?:-[a-z0-9]+)*$/.test(lines[index] ?? '')
      || !/^    path: [a-z0-9]+(?:-[a-z0-9]+)*\.doctrine\.md$/.test(lines[index + 1] ?? '')
      || !/^    sha256: [a-f0-9]{64}$/.test(lines[index + 2] ?? '')) {
      fail('invalid-manifest', `manifest entry near line ${index + 3} is malformed or carries unknown fields`);
    }
  }
  const entries = parseManifest(raw, 'manifest.md');
  const ids = new Set();
  const paths = new Set();
  for (const entry of entries) {
    if (entry.path !== `${entry.id}.doctrine.md`) {
      fail('invalid-manifest', `manifest path must be exactly <id>.doctrine.md for ${entry.id}`);
    }
    const idKey = entry.id.normalize('NFC').toLowerCase();
    const pathKey = entry.path.normalize('NFC').toLowerCase();
    if (ids.has(idKey) || paths.has(pathKey)) {
      fail('invalid-manifest', `manifest contains a duplicate or non-portable identifier/path collision: ${entry.id}`);
    }
    ids.add(idKey);
    paths.add(pathKey);
  }
  return entries;
}

function normalizedName(value) {
  return value.normalize('NFC').toLowerCase();
}

function assertCreateCollisionFree(doctrineRoot, targetName, entries) {
  const targetKey = normalizedName(targetName);
  for (const entry of entries) {
    if (normalizedName(entry.path) === targetKey) {
      fail('target-collision', `manifest path collides with ${targetName}`);
    }
  }
  for (const name of fs.readdirSync(doctrineRoot)) {
    if (normalizedName(name) === targetKey) {
      fail('target-collision', `filesystem path collides with ${targetName}`);
    }
  }
}

function validateProvenance(provenance, noticeText) {
  if (!provenance || !['original', 'adapted'].includes(provenance.kind)) {
    fail('needs-source', 'provenance.kind must be original or adapted', 'needs-source');
  }
  if (provenance.kind === 'original') {
    if (Object.keys(provenance).some((key) => key !== 'kind')) {
      fail('invalid-provenance', 'original provenance is closed and may contain only kind', 'needs-source');
    }
    return { kind: 'original' };
  }
  if (Object.keys(provenance).some((key) => !['kind', 'verification'].includes(key))) {
    fail('invalid-provenance', 'adapted provenance carries unknown fields', 'needs-source');
  }
  const verification = provenance.verification;
  const allowed = new Set([
    'sourceLocator', 'sourceRevisionOrDigest', 'author', 'licenseIdentifier',
    'licenseTextBasis', 'verifierIdentity', 'verifierRole', 'verifiedAt',
    'compatibilityDecision', 'attributionRequired',
  ]);
  if (!verification || typeof verification !== 'object' || Array.isArray(verification)
    || Object.keys(verification).some((key) => !allowed.has(key))) {
    fail('invalid-provenance', 'adapted provenance verification must be a closed record', 'needs-source');
  }
  for (const field of ['sourceLocator', 'sourceRevisionOrDigest', 'author', 'verifierIdentity', 'verifierRole', 'verifiedAt']) {
    requirePlainString(verification[field], `provenance.verification.${field}`);
  }
  if (!verification.licenseIdentifier && !verification.licenseTextBasis) {
    fail('invalid-provenance', 'license identifier or license text basis is required', 'needs-source');
  }
  if (verification.licenseIdentifier) requirePlainString(verification.licenseIdentifier, 'provenance.verification.licenseIdentifier');
  if (verification.licenseTextBasis) requirePlainString(verification.licenseTextBasis, 'provenance.verification.licenseTextBasis');
  if (verification.compatibilityDecision !== 'compatible') {
    fail(
      'license-unresolved',
      'adapted material requires an explicit human compatibility decision; the skill does not judge compatibility',
      'needs-decision',
    );
  }
  if (typeof verification.attributionRequired !== 'boolean') {
    fail('invalid-provenance', 'attributionRequired must be boolean', 'needs-source');
  }
  const verifiedAt = Date.parse(verification.verifiedAt);
  if (!Number.isFinite(verifiedAt) || verifiedAt > Date.now() + 60_000 || Date.now() - verifiedAt > MAX_PROVENANCE_AGE_MS) {
    fail('stale-provenance', 'provenance verification is invalid, future-dated, or older than 30 days', 'needs-decision');
  }
  if (verification.attributionRequired && typeof noticeText !== 'string') {
    fail('attribution-required', 'a complete NOTICE candidate is required', 'needs-source');
  }
  if (verification.attributionRequired) {
    requirePlainString(noticeText, 'noticeText');
    requirePlainString(verification.licenseIdentifier, 'provenance.verification.licenseIdentifier');
    const missing = [
      ['author', verification.author],
      ['license identifier', verification.licenseIdentifier],
      ['source locator', verification.sourceLocator],
    ].filter(([, token]) => !noticeText.includes(token));
    if (missing.length > 0) {
      fail(
        'attribution-required',
        `complete NOTICE candidate must contain the structured provenance ${missing.map(([name]) => name).join(', ')}`,
        'needs-source',
      );
    }
  }
  return { kind: 'adapted', verification: { ...verification } };
}

function validatePromptCoach(rawPosition, evidence) {
  if (!evidence || evidence.status !== 'Reviewed') {
    fail('prompt-coach-required', 'Prompt Coach must review the exact raw position before candidate finalization', 'needs-input');
  }
  if (evidence.rawPromptDigest !== sha256(rawPosition)) {
    fail('prompt-coach-mismatch', 'Prompt Coach evidence does not bind to the exact raw position', 'needs-input');
  }
  if (!DIGEST.test(String(evidence.reportDigest))
    || !['accepted', 'rejected'].includes(evidence.humanDecision)
    || !Array.isArray(evidence.acceptedEffects)) {
    fail('prompt-coach-unsettled', 'Prompt Coach findings must be shown and accepted or rejected by the human', 'needs-decision');
  }
}

function validateFindings(findings, selectedDoctrine) {
  if (!Array.isArray(findings)) fail('needs-decision', 'overlapFindings must be supplied', 'needs-decision');
  if (findings.length > MAX_FINDINGS) fail('invalid-finding', `overlapFindings exceeds ${MAX_FINDINGS} entries`);
  const selected = new Map(selectedDoctrine.map((item) => [item.id, item]));
  const allowed = new Set(['kind', 'doctrineId', 'evidence', 'candidatePosition', 'confidence', 'disposition']);
  for (const [index, finding] of findings.entries()) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)
      || Object.keys(finding).some((key) => !allowed.has(key))
      || !['overlap', 'contradiction'].includes(finding.kind)
      || !selected.has(finding.doctrineId)
      || !finding.evidence || typeof finding.evidence !== 'object' || Array.isArray(finding.evidence)
      || Object.keys(finding.evidence).some((key) => !['locator', 'quote'].includes(key))
      || typeof finding.evidence.locator !== 'string' || finding.evidence.locator.trim() === ''
      || typeof finding.evidence.quote !== 'string' || finding.evidence.quote.trim() === ''
      || typeof finding.candidatePosition !== 'string' || finding.candidatePosition.trim() === ''
      || !['high', 'medium', 'low'].includes(finding.confidence)
      || finding.disposition !== 'unresolved') {
      fail('invalid-finding', `overlapFindings[${index}] is not evidence-bound`);
    }
    for (const value of [finding.evidence.locator, finding.evidence.quote, finding.candidatePosition]) {
      if (Buffer.byteLength(value, 'utf8') > MAX_FINDING_TEXT_BYTES) {
        fail('invalid-finding', `overlapFindings[${index}] exceeds the evidence bound`);
      }
    }
    if (!selected.get(finding.doctrineId).text.includes(finding.evidence.quote)) {
      fail('invalid-finding', `overlapFindings[${index}] quotes bytes not present in selected doctrine`);
    }
  }
}

function renderManifest(raw, operation, targetId, targetPath, candidateDigest) {
  if (operation === 'create') {
    const marker = '\n---\n';
    const at = raw.indexOf(marker, 4);
    const entry = `\n  - id: ${targetId}\n    path: ${targetPath}\n    sha256: ${candidateDigest}`;
    return `${raw.slice(0, at)}${entry}${raw.slice(at)}`;
  }
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^  - id: ${escapeRegex(targetId)}\\n    path: ${escapeRegex(targetPath)}\\n    sha256: )[a-f0-9]{64}$`, 'm');
  if (!pattern.test(raw)) fail('invalid-manifest', `manifest entry for ${targetId} is not canonical`);
  return raw.replace(pattern, `$1${candidateDigest}`);
}

export function exactDiff(prior, candidate, targetPath) {
  if (prior === candidate) return '';
  const before = prior.split(/(?<=\n)/);
  const after = candidate.split(/(?<=\n)/);
  const rows = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      rows[i][j] = before[i] === after[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const out = [`--- a/${targetPath}\n`, `+++ b/${targetPath}\n`];
  let i = 0; let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      out.push(` ${before[i]}`); i += 1; j += 1;
    } else if (j < after.length && (i === before.length || rows[i][j + 1] >= rows[i + 1][j])) {
      out.push(`+${after[j]}`); j += 1;
    } else {
      out.push(`-${before[i]}`); i += 1;
    }
  }
  return out.join('');
}

export function prepareDoctrineChange(input, options = {}) {
  const {
    repositoryRoot, operation, targetId, rawPosition, candidateText,
    relevantDoctrineIds = [], provenance, noticeText, promptCoachEvidence,
    overlapFindings,
  } = input ?? {};
  const repositoryIdentity = assertCanonicalRoot(repositoryRoot);
  if (!['create', 'update'].includes(operation)) fail('needs-input', 'operation must be create or update', 'needs-input');
  if (!ID.test(String(targetId))) fail('needs-input', 'targetId must be one canonical doctrine identifier', 'needs-input');
  requirePlainString(rawPosition, 'rawPosition');
  if (typeof candidateText !== 'string' || candidateText.length === 0) {
    fail('needs-input', 'candidateText must contain the exact UTF-8 candidate', 'needs-input');
  }
  const candidateWords = countWords(candidateText);
  if (candidateWords > MAX_DOCTRINE_WORDS) {
    fail(
      'candidate-too-long',
      `create and update doctrine candidates must contain fewer than 500 words; received ${candidateWords}`,
      'needs-input',
      { candidateWords, maximumWords: MAX_DOCTRINE_WORDS },
    );
  }
  validatePromptCoach(rawPosition, promptCoachEvidence);
  const source = validateProvenance(provenance, noticeText);

  const doctrineRoot = path.join(repositoryRoot, 'doctrine');
  const doctrineIdentity = directoryIdentity(doctrineRoot, 'doctrine directory', [repositoryIdentity]);
  const doctrineAncestors = [repositoryIdentity, doctrineIdentity];
  const manifestPath = path.join(doctrineRoot, 'manifest.md');
  const manifestIdentity = readRegularNoFollow(manifestPath, 'doctrine/manifest.md', {
    ancestors: doctrineAncestors,
    race: options.race,
  });
  const manifestRaw = manifestIdentity.text;
  const entries = strictManifest(manifestRaw);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const targetPath = `${targetId}.doctrine.md`;
  const targetAbsolute = path.join(doctrineRoot, targetPath);

  const verified = new Map();
  for (const entry of entries) {
    const file = path.resolve(doctrineRoot, entry.path);
    if (path.dirname(file) !== doctrineRoot) fail('invalid-manifest', `doctrine path escapes root: ${entry.path}`);
    const identity = readRegularNoFollow(file, `doctrine/${entry.path}`, {
      ancestors: doctrineAncestors,
      race: options.race,
    });
    if (identity.sha256 !== entry.sha256) {
      fail('digest_drift', `doctrine digest drift: ${entry.id}`);
    }
    const text = identity.text;
    verified.set(entry.id, { entry, identity, text });
  }

  const selected = new Set(relevantDoctrineIds);
  if (operation === 'update') selected.add(targetId);
  for (const id of selected) {
    if (!entryById.has(id)) fail('unknown-doctrine', `relevant doctrine is not declared: ${id}`, 'needs-decision');
  }
  const selectedDoctrine = [...selected].map((id) => ({
    id,
    path: verified.get(id).entry.path,
    sha256: verified.get(id).entry.sha256,
    identity: {
      dev: verified.get(id).identity.dev,
      ino: verified.get(id).identity.ino,
      nlink: verified.get(id).identity.nlink,
    },
    text: verified.get(id).text,
  }));
  validateFindings(overlapFindings, selectedDoctrine);

  let priorText = null;
  let targetIdentity = { exists: false };
  if (operation === 'create') {
    if (entryById.has(targetId)) fail('target-collision', `doctrine identifier already exists: ${targetId}`);
    assertCreateCollisionFree(doctrineRoot, targetPath, entries);
  } else {
    const target = entryById.get(targetId);
    if (!target) fail('unknown-doctrine', `cannot update undeclared doctrine: ${targetId}`, 'needs-input');
    if (target.path !== targetPath) fail('invalid-manifest', `selected doctrine path is not canonical: ${target.path}`);
    priorText = verified.get(targetId).text;
    targetIdentity = verified.get(targetId).identity;
  }

  const candidateDigest = sha256(candidateText);
  const nextManifest = renderManifest(manifestRaw, operation, targetId, targetPath, candidateDigest);
  strictManifest(nextManifest);
  const noticeRequired = source.kind === 'adapted' && source.verification.attributionRequired === true;
  const artifacts = [];
  let noticeIdentity = null;
  let noticeDigest = null;
  if (noticeRequired) {
    noticeIdentity = readRegularNoFollow(path.join(repositoryRoot, 'NOTICE.md'), 'NOTICE.md', {
      mayBeAbsent: true,
      ancestors: [repositoryIdentity],
      race: options.race,
    });
    noticeDigest = sha256(noticeText);
    artifacts.push({ path: 'NOTICE.md', content: noticeText });
  }
  artifacts.push({ path: `doctrine/${targetPath}`, content: candidateText });
  for (const item of selectedDoctrine) {
    if (item.id !== targetId) {
      artifacts.push({ path: `doctrine/${item.path}`, content: item.text });
    }
  }
  artifacts.push({ path: 'doctrine/manifest.md', content: nextManifest });
  verifyDirectoryIdentity(repositoryIdentity);
  verifyDirectoryIdentity(doctrineIdentity);
  const preview = buildPreview({ repositoryRoot, artifacts });
  const priorDoctrineDigest = targetIdentity.exists ? targetIdentity.sha256 : null;
  const binding = {
    operation,
    targetId,
    targetPath: `doctrine/${targetPath}`,
    candidateDigest,
    priorDoctrineDigest,
    priorDoctrineRevision: priorDoctrineDigest,
    priorManifestDigest: manifestIdentity.sha256,
    priorManifestRevision: manifestIdentity.sha256,
    noticeDigest,
    priorNoticeDigest: noticeIdentity?.sha256 ?? null,
    priorNoticeRevision: noticeIdentity?.sha256 ?? null,
    previewId: preview.previewId,
    candidate: {
      text: candidateText,
      bytesBase64: Buffer.from(candidateText, 'utf8').toString('base64'),
      byteLength: Buffer.byteLength(candidateText, 'utf8'),
      digest: candidateDigest,
      completeResult: candidateText,
      diff: operation === 'update' ? exactDiff(priorText, candidateText, `doctrine/${targetPath}`) : null,
    },
    nextManifest: { text: nextManifest, digest: sha256(nextManifest) },
    notice: noticeRequired ? { text: noticeText, digest: noticeDigest } : null,
    artifactOrder: artifacts.map((artifact) => artifact.path),
    relevantDoctrine: selectedDoctrine.map(({ text, ...item }) => item),
    provenance: source,
    promptCoach: promptCoachEvidence,
    overlapFindings,
  };
  const approvalId = sha256(canonical(binding));
  return {
    status: 'needs-approval',
    operation,
    targetId,
    targetPath: binding.targetPath,
    rawPosition,
    provenance: source,
    promptCoach: promptCoachEvidence,
    overlapFindings,
    relevantDoctrine: selectedDoctrine,
    candidate: {
      text: candidateText,
      bytesBase64: Buffer.from(candidateText, 'utf8').toString('base64'),
      byteLength: Buffer.byteLength(candidateText, 'utf8'),
      digest: candidateDigest,
      diff: operation === 'update' ? exactDiff(priorText, candidateText, `doctrine/${targetPath}`) : null,
      completeResult: candidateText,
    },
    prior: {
      doctrineDigest: priorDoctrineDigest,
      doctrineRevision: priorDoctrineDigest,
      manifestDigest: manifestIdentity.sha256,
      manifestRevision: manifestIdentity.sha256,
      noticeDigest: noticeIdentity?.sha256 ?? null,
      noticeRevision: noticeIdentity?.sha256 ?? null,
    },
    notice: noticeRequired ? { text: noticeText, digest: noticeDigest } : null,
    artifactOrder: [...binding.artifactOrder],
    nextManifest: binding.nextManifest,
    approval: { id: approvalId, binding, grant: APPROVAL_GRANT },
    noticeApproval: noticeRequired ? {
      id: sha256(canonical({
        approvalId,
        noticeDigest,
        priorNoticeDigest: noticeIdentity?.sha256 ?? null,
        priorNoticeRevision: noticeIdentity?.sha256 ?? null,
      })),
      grant: NOTICE_GRANT,
    } : null,
    identities: {
      repositoryRoot: repositoryIdentity,
      doctrineDirectory: doctrineIdentity,
      manifest: identityOf(manifestIdentity),
      target: identityOf(targetIdentity),
      notice: noticeIdentity ? identityOf(noticeIdentity) : null,
      relevantDoctrine: Object.fromEntries(selectedDoctrine.map((item) => [item.id, item.identity])),
    },
    preview,
  };
}

function sameIdentity(file, expected, label, ancestors) {
  const actual = readRegularNoFollow(file, label, {
    mayBeAbsent: !expected.exists,
    ancestors,
  });
  if (expected.exists !== actual.exists) return false;
  if (!expected.exists) return true;
  return expected.dev === actual.dev
    && expected.ino === actual.ino
    && expected.nlink === actual.nlink
    && expected.sha256 === actual.sha256;
}

function recomputePrepared(repositoryRoot, prepared) {
  const recomputed = prepareDoctrineChange({
    repositoryRoot,
    operation: prepared.operation,
    targetId: prepared.targetId,
    rawPosition: prepared.rawPosition,
    candidateText: prepared.candidate?.text,
    relevantDoctrineIds: Array.isArray(prepared.relevantDoctrine)
      ? prepared.relevantDoctrine.map((item) => item.id)
      : null,
    provenance: prepared.provenance,
    noticeText: prepared.notice?.text,
    promptCoachEvidence: prepared.promptCoach,
    overlapFindings: prepared.overlapFindings,
  });
  if (canonical(recomputed) !== canonical(prepared)) {
    fail('stale-prepared', 'prepared envelope does not exactly match its recomputed form');
  }
  return recomputed;
}

function verifyCompleteDoctrineState(repositoryRoot, expectedManifestDigest) {
  const doctrineRoot = path.join(repositoryRoot, 'doctrine');
  const repositoryIdentity = assertCanonicalRoot(repositoryRoot);
  const doctrineIdentity = directoryIdentity(doctrineRoot, 'doctrine directory', [repositoryIdentity]);
  const ancestors = [repositoryIdentity, doctrineIdentity];
  const manifest = readRegularNoFollow(path.join(doctrineRoot, 'manifest.md'), 'doctrine/manifest.md', { ancestors });
  if (manifest.sha256 !== expectedManifestDigest) {
    fail('reread-mismatch', 'complete manifest digest differs after persistence');
  }
  const entries = strictManifest(manifest.text);
  const doctrines = [];
  for (const entry of entries) {
    const verified = readRegularNoFollow(path.join(doctrineRoot, entry.path), `doctrine/${entry.path}`, { ancestors });
    if (verified.sha256 !== entry.sha256) {
      fail('reread-mismatch', `declared doctrine digest differs after persistence: ${entry.id}`);
    }
    doctrines.push({ id: entry.id, path: entry.path, sha256: verified.sha256 });
  }
  return { manifest: { sha256: manifest.sha256 }, doctrines };
}

function exactApprovalMatches(prepared, approval) {
  const expectedKeys = [
    'approvalId', 'candidateDigest', 'grant', 'operation',
    'priorDoctrineDigest', 'priorDoctrineRevision', 'priorManifestDigest',
    'priorManifestRevision', 'targetId', 'targetPath',
  ];
  return approval
    && Object.keys(approval).sort().join('\0') === expectedKeys.sort().join('\0')
    && approval.grant === APPROVAL_GRANT
    && approval.approvalId === prepared.approval.id
    && approval.operation === prepared.operation
    && approval.targetId === prepared.targetId
    && approval.targetPath === prepared.targetPath
    && approval.candidateDigest === prepared.candidate.digest
    && approval.priorDoctrineDigest === prepared.prior.doctrineDigest
    && approval.priorDoctrineRevision === prepared.prior.doctrineRevision
    && approval.priorManifestDigest === prepared.prior.manifestDigest
    && approval.priorManifestRevision === prepared.prior.manifestRevision;
}

function noticeApprovalMatches(prepared, approval) {
  if (!prepared.notice) return true;
  const expectedKeys = [
    'approvalId', 'grant', 'noticeDigest', 'priorNoticeDigest', 'priorNoticeRevision',
  ];
  return approval
    && Object.keys(approval).sort().join('\0') === expectedKeys.sort().join('\0')
    && approval.grant === NOTICE_GRANT
    && approval.approvalId === prepared.noticeApproval.id
    && approval.noticeDigest === prepared.notice.digest
    && approval.priorNoticeDigest === prepared.prior.noticeDigest
    && approval.priorNoticeRevision === prepared.prior.noticeRevision;
}

export function applyDoctrineChange({ repositoryRoot, prepared, approval, noticeApproval }, options = {}) {
  if (!prepared || typeof prepared !== 'object') fail('invalid-state', 'prepared candidate is required');
  let verifiedPrepared;
  try {
    verifiedPrepared = recomputePrepared(repositoryRoot, prepared);
  } catch (error) {
    if (error instanceof DoctrineTransactionError) {
      return {
        status: 'blocked',
        code: error.code === 'target-collision' || error.code === 'digest_drift' ? 'stale-state' : error.code,
        exactApproval: false,
        changedPaths: [],
        detail: error.message,
      };
    }
    throw error;
  }
  if (!exactApprovalMatches(verifiedPrepared, approval)) {
    return { status: 'cancelled', exactApproval: false, changedPaths: [], detail: 'approval absent, rejected, corrected, unrelated, or stale' };
  }
  if (!noticeApprovalMatches(verifiedPrepared, noticeApproval)) {
    return { status: 'cancelled', exactApproval: true, noticeApproval: false, changedPaths: [], detail: 'NOTICE approval absent or stale' };
  }
  options.beforeWrite?.();
  const doctrineRoot = path.join(repositoryRoot, 'doctrine');
  const repositoryIdentity = verifiedPrepared.identities.repositoryRoot;
  const doctrineIdentity = verifiedPrepared.identities.doctrineDirectory;
  const doctrineAncestors = [repositoryIdentity, doctrineIdentity];
  const identitiesCurrent = sameIdentity(path.join(doctrineRoot, 'manifest.md'), verifiedPrepared.identities.manifest, 'doctrine/manifest.md', doctrineAncestors)
    && sameIdentity(path.join(repositoryRoot, verifiedPrepared.targetPath), verifiedPrepared.identities.target, verifiedPrepared.targetPath, doctrineAncestors)
    && (!verifiedPrepared.notice || sameIdentity(path.join(repositoryRoot, 'NOTICE.md'), verifiedPrepared.identities.notice, 'NOTICE.md', [repositoryIdentity]))
    && verifiedPrepared.relevantDoctrine.every((item) =>
      sameIdentity(
        path.join(doctrineRoot, item.path),
        { exists: true, ...verifiedPrepared.identities.relevantDoctrine[item.id], sha256: item.sha256 },
        `doctrine/${item.path}`,
        doctrineAncestors,
      ));
  if (!identitiesCurrent) {
    return { status: 'blocked', code: 'stale-state', exactApproval: true, changedPaths: [], detail: 'approved path identity or bytes changed before persistence' };
  }
  const writer = options.applyPreview ?? applyPreview;
  const result = writer({
    repositoryRoot,
    preview: verifiedPrepared.preview,
    confirmation: { previewId: verifiedPrepared.preview.previewId, grant: CONFIRMATION_GRANT },
  }, options.writeGateOptions);
  if (result.status !== 'configured') {
    return {
      status: result.status === 'cancelled' ? 'cancelled' : 'blocked',
      code: result.status,
      exactApproval: true,
      changedPaths: (result.rollbackRemaining ?? []).map((item) =>
        typeof item === 'string' ? item : item.relativePath),
      persistence: result,
    };
  }
  const expected = new Map(verifiedPrepared.preview.entries.map((entry) => [entry.relativePath, entry.sha256]));
  if (!Array.isArray(result.readback) || result.readback.length !== expected.size) {
    return { status: 'blocked', code: 'reread-mismatch', exactApproval: true, changedPaths: result.readback?.map((item) => item.relativePath) ?? [], persistence: result };
  }
  for (const readback of result.readback) {
    if (expected.get(readback.relativePath) !== readback.sha256) {
      return { status: 'blocked', code: 'reread-mismatch', exactApproval: true, changedPaths: result.readback.map((item) => item.relativePath), persistence: result };
    }
  }
  let completeVerification;
  try {
    completeVerification = verifyCompleteDoctrineState(repositoryRoot, verifiedPrepared.nextManifest.digest);
  } catch (error) {
    if (!(error instanceof DoctrineTransactionError)) throw error;
    return {
      status: 'blocked',
      code: error.code,
      exactApproval: true,
      changedPaths: result.readback.map((item) => item.relativePath),
      detail: error.message,
      persistence: result,
    };
  }
  return {
    status: 'approved-and-written',
    exactApproval: true,
    changedPaths: result.readback.filter((item) => item.change !== 'unchanged').map((item) => item.relativePath),
    rereadVerification: result.readback,
    completeDoctrineVerification: completeVerification,
    publication: 'not-published; use the normal reviewed change-request path',
    persistence: result,
  };
}

export const USAGE = 'Usage: doctrine-transaction.mjs <prepare|apply> --input <absolute-json-path>';

export function run(argv, streams = process) {
  if (argv.length !== 3 || !['prepare', 'apply'].includes(argv[0]) || argv[1] !== '--input' || !path.isAbsolute(argv[2])) {
    fail('usage', USAGE);
  }
  const input = JSON.parse(fs.readFileSync(argv[2], 'utf8'));
  const output = argv[0] === 'prepare' ? prepareDoctrineChange(input) : applyDoctrineChange(input);
  streams.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  return output.status === 'approved-and-written' || output.status === 'needs-approval' ? 0 : 2;
}

function direct() {
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (direct()) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: { code: error.code ?? 'blocked', status: error.status ?? 'blocked', message: error.message, detail: error.detail ?? {} } })}\n`);
    process.exitCode = 1;
  }
}
