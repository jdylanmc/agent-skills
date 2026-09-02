#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canonicalArtifactSetDigest,
  validateApprovalBinding,
} from './approval-binding.mjs';
import {
  createGitHubMergeVerifier,
  createGitHubRepositoryResolver,
  observeGitHubMerge,
} from './approval-binding.github.mjs';
import {
  createHumanReceiptVerifier,
  createSpecialistEventVerifier,
  createWalkthroughObservationVerifier,
} from './approval-binding.receipts.mjs';

const USAGE = 'Usage: approval-binding.host.mjs --root <absolute-repository-root> --input <absolute-json-path> --evidence <absolute-json-path> --change-request <id>';

function exactFields(value, fields, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...fields].sort())) {
    throw new Error(`${name} fields differ`);
  }
}

function payloads(envelopes) {
  if (!Array.isArray(envelopes)) throw new Error('signed envelope collection must be an array');
  return envelopes.map((envelope) => envelope.payload);
}

function trustedKeys(records) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) {
    throw new Error('trustedPublicKeys must be an object of PEM public keys');
  }
  return new Map(Object.entries(records));
}

export function validateThroughGitHubHost({
  repositoryRoot,
  packet,
  evidence,
  changeRequestId,
}, dependencies = {}) {
  exactFields(evidence, [
    'trustedPublicKeys', 'humanStreamId', 'humanEnvelopes',
    'specialistStreamId', 'specialistEnvelopes',
    'walkthroughStreamId', 'walkthroughEnvelopes',
  ], 'host evidence');
  const keys = trustedKeys(evidence.trustedPublicKeys);
  const humanReceipts = payloads(evidence.humanEnvelopes);
  const specialistObservations = payloads(evidence.specialistEnvelopes);
  const walkthroughObservations = payloads(evidence.walkthroughEnvelopes);
  const artifactSetDigest = canonicalArtifactSetDigest(packet.artifactManifest.map((artifact) => ({
    path: path.posix.normalize(artifact.path).replace(/^\.\//, ''),
    digest: artifact.digest.toLowerCase(),
  })));
  const {
    verifyGitAncestry,
    readMergedArtifact,
    listMergedWorkspaceArtifacts,
  } = dependencies.validationOptions ?? {};
  const mergeObservation = observeGitHubMerge({
    repositoryRoot,
    changeRequestId,
    artifactSetDigest,
    interactionContractDigest: packet.interactionContract?.digest,
  }, dependencies);
  return validateApprovalBinding(packet, {
    repositoryRoot,
    humanReceipts,
    specialistObservations,
    walkthroughObservations,
    mergeObservation,
    verifyHumanReceipt: createHumanReceiptVerifier({
      envelopes: evidence.humanEnvelopes,
      trustedPublicKeys: keys,
      streamId: evidence.humanStreamId,
    }),
    verifySpecialistObservation: createSpecialistEventVerifier({
      envelopes: evidence.specialistEnvelopes,
      trustedPublicKeys: keys,
      streamId: evidence.specialistStreamId,
    }),
    verifyWalkthroughObservation: createWalkthroughObservationVerifier({
      envelopes: evidence.walkthroughEnvelopes,
      trustedPublicKeys: keys,
      streamId: evidence.walkthroughStreamId,
    }),
    verifyMergeObservation: createGitHubMergeVerifier({
      repositoryRoot,
      changeRequestId,
    }, dependencies),
    resolveExpectedRepository: createGitHubRepositoryResolver(dependencies),
    verifyGitAncestry,
    readMergedArtifact,
    listMergedWorkspaceArtifacts,
  });
}

export function run(argv, streams = process) {
  if (argv.length !== 8
    || argv[0] !== '--root'
    || argv[2] !== '--input'
    || argv[4] !== '--evidence'
    || argv[6] !== '--change-request') {
    throw new Error(USAGE);
  }
  const [repositoryRoot, inputPath, evidencePath, changeRequestId] = [
    argv[1], argv[3], argv[5], argv[7],
  ];
  if (![repositoryRoot, inputPath, evidencePath].every((candidate) => candidate.startsWith('/'))) {
    throw new Error(USAGE);
  }
  const packet = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
  streams.stdout.write(`${JSON.stringify(validateThroughGitHubHost({
    repositoryRoot,
    packet,
    evidence,
    changeRequestId,
  }), null, 2)}\n`);
  return 0;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
