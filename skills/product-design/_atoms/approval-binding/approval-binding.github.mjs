#!/usr/bin/env node

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { MERGE_SCHEMA } from './approval-binding.mjs';

function runJson(command, args, cwd, exec = spawnSync) {
  const result = exec(command, args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
  return JSON.parse(result.stdout);
}

function runText(command, args, cwd, exec = spawnSync) {
  const result = exec(command, args, { cwd, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
  return result.stdout.trim();
}

function repositoryFromRemote(remote) {
  const match = remote.match(/github\.com(?::|\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (!match) throw new Error('canonical git remote is not a GitHub repository');
  return `${match[1]}/${match[2]}`;
}

export function resolveCanonicalGitHubRepository(repositoryRoot, { exec = spawnSync } = {}) {
  const remote = runText('git', ['remote', 'get-url', 'origin'], repositoryRoot, exec);
  const remoteRepository = repositoryFromRemote(remote);
  const current = runJson('gh', [
    'repo', 'view', '--json', 'nameWithOwner,defaultBranchRef',
  ], repositoryRoot, exec);
  if (current.nameWithOwner !== remoteRepository || !current.defaultBranchRef?.name) {
    throw new Error('GitHub repository identity differs from the canonical origin remote');
  }
  return current;
}

export function observeGitHubMerge({
  repositoryRoot,
  changeRequestId,
  artifactSetDigest,
  interactionContractDigest,
}, { exec = spawnSync } = {}) {
  const repo = resolveCanonicalGitHubRepository(repositoryRoot, { exec });
  const pr = runJson('gh', [
    'pr', 'view', String(changeRequestId), '--repo', repo.nameWithOwner,
    '--json', 'number,state,baseRefName,mergeCommit,mergedAt,url',
  ], repositoryRoot, exec);
  const revision = pr.mergeCommit?.oid;
  if (pr.state !== 'MERGED' || !revision || !pr.mergedAt || !repo.defaultBranchRef?.name) {
    throw new Error('GitHub change request is not observed merged with a merge revision and default branch');
  }
  return {
    schema: MERGE_SCHEMA,
    provider: 'github',
    repository: repo.nameWithOwner,
    changeRequestId: String(pr.number),
    state: 'merged',
    destinationBranch: `refs/heads/${pr.baseRefName}`,
    defaultBranch: `refs/heads/${repo.defaultBranchRef.name}`,
    revision,
    artifactSetDigest,
    interactionContractDigest,
    mergedAt: pr.mergedAt,
    provenance: { producer: 'official-gh-read-only-observer', sourceId: pr.url },
  };
}

export function createGitHubMergeVerifier(request, dependencies = {}) {
  return (observation) => {
    try {
      const current = observeGitHubMerge({
        ...request,
        artifactSetDigest: observation.artifactSetDigest,
        interactionContractDigest: observation.interactionContractDigest,
      }, dependencies);
      return [
        'provider', 'repository', 'changeRequestId', 'state', 'destinationBranch',
        'defaultBranch', 'revision', 'artifactSetDigest', 'interactionContractDigest',
        'mergedAt',
      ].every((field) => current[field] === observation[field]);
    } catch {
      return false;
    }
  };
}

export function createGitHubRepositoryResolver(dependencies = {}) {
  return (repositoryRoot) => resolveCanonicalGitHubRepository(repositoryRoot, dependencies).nameWithOwner;
}

export function run(argv, streams = process) {
  if (argv.length !== 8
    || argv[0] !== '--root'
    || argv[2] !== '--change-request'
    || argv[4] !== '--artifact-set-digest'
    || argv[6] !== '--contract-digest') {
    throw new Error('Usage: approval-binding.github.mjs --root <repo> --change-request <id> --artifact-set-digest <sha256> --contract-digest <sha256>');
  }
  const observation = observeGitHubMerge({
    repositoryRoot: argv[1],
    changeRequestId: argv[3],
    artifactSetDigest: argv[5],
    interactionContractDigest: argv[7],
  });
  streams.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
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
