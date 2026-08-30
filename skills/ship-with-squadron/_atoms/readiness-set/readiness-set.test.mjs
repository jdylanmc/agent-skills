import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { normalizeFleetManifest } from '../fleet-manifest/fleet-manifest.mjs';
import {
  assertFleetState,
  captureIsolatedGitWorktreeIdentity,
  createFleetState,
  fleetStatePath,
  persistFleetState,
  reconcileFrontier,
  startCheckActivity,
  transitionIssue,
} from '../fleet-state/fleet-state.mjs';
import { deriveFleetDisposition } from '../fleet-disposition/fleet-disposition.mjs';
import { publicationKey } from '../provider-seam/provider-seam.mjs';
import { computeFrontier } from '../dependency-frontier/dependency-frontier.mjs';
import {
  acceptShepherdReturn,
  consumeInitialShepherdResult,
  consumeInitialShepherdResultPersisted,
  consumeNoShepherdRevalidation,
  consumeReShepherdQueue,
  expireReadinessAfterSiblingMerge,
  recordReadinessRevisionObservation,
  recordShepherdNotRequired,
} from './readiness-set.mjs';

function oid(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function manifest(shepherdIntent = 'yes', dependencies = []) {
  return normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: 'deliver',
    acceptedScope: [],
    exclusions: [],
    humanDecisions: [],
    issues: ['a', 'b', 'c'].map((identity) => ({
      identity,
      sourceRevision: `r-${identity}`,
      sourceReceipt: {
        invocation: { id: `read-${identity}`, operation: 'read-issue' },
        provider: 'github', repository: 'owner/repo', issue: identity, revision: `r-${identity}`,
        issueStatus: 'pending', status: 'observed', terminal: true, complete: true, observedAt: '2026-08-30T00:00:00Z',
      },
      acceptanceCriteria: ['done'], scope: [], allowedPaths: [`${identity}/**`],
    })),
    dependencies,
    concurrency: 2,
    budget: { cost: 10, timeMinutes: 60, retries: 2 },
    repository: { id: 'owner/repo', root: path.resolve('test-fixtures', 'readiness-set-repository'), baseBranch: 'main' },
    provider: { name: 'github', allowedOperations: ['read-issue', 'publish-change-request', 'observe-merge', 'observe-change-request-revision'] },
    validationPolicy: ['run-ci', 'roast', 'blast-radius-proof'],
    stopConditions: ['cancelled'],
    humanBoundaries: ['human merge'],
    shepherdIntent,
  });
}

function setupGitWorktree(repositoryRoot, worktree, branch) {
  fs.rmSync(repositoryRoot, { recursive: true, force: true });
  fs.rmSync(worktree, { recursive: true, force: true });
  fs.mkdirSync(repositoryRoot, { recursive: true });
  execFileSync('git', ['-C', repositoryRoot, 'init', '-b', 'main'], { stdio: 'ignore' });
  fs.writeFileSync(path.join(repositoryRoot, 'seed.txt'), 'seed\n');
  execFileSync('git', ['-C', repositoryRoot, '-c', 'user.name=Test', '-c',
    'user.email=test-identity', 'add', 'seed.txt'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repositoryRoot, '-c', 'user.name=Test', '-c',
    'user.email=test-identity', 'commit', '-m', 'seed'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repositoryRoot, 'worktree', 'add', '-b', branch, worktree], {
    stdio: 'ignore',
  });
}

function expected(issue = 'b', generation = 1, baseSha = 'base-1') {
  const normalizedBase = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(baseSha)
    ? baseSha
    : oid(baseSha);
  return {
    runId: 'run',
    issue,
    provider: 'github',
    repository: 'owner/repo',
    changeRequest: `PR-${issue.toUpperCase()}`,
    publicationKey: `pub-${issue}`,
    baseBranch: 'main',
    baseSha: normalizedBase,
    headSha: oid(`head-${issue}`),
    obligationGeneration: generation,
  };
}

function shepherd(expectation = expected(), overrides = {}) {
  const receiptTime = expectation.obligationGeneration === 1
    ? '2026-08-30T00:01:00Z'
    : '2026-08-30T00:04:00Z';
  const observationTime = expectation.obligationGeneration === 1
    ? '2026-08-30T00:01:01Z'
    : '2026-08-30T00:04:01Z';
  return {
    invocation: {
      skill: 'shepherd',
      id: `shepherd-${expectation.issue}-${expectation.obligationGeneration}`,
      runId: expectation.runId,
      issue: expectation.issue,
      changeRequest: expectation.changeRequest,
      mode: 'nested-worker',
      freshContext: true,
      status: 'returned',
    },
    result: {
      disposition: 'mergeable-and-green',
      reason: 'complete-green-evidence',
      defects: [],
      receipt: {
        observedAt: receiptTime,
        provider: 'supported-provider',
        baseSha: expectation.baseSha,
        headSha: expectation.headSha,
        upToDatePolicy: 'required',
        complete: true,
      },
    },
    observation: {
      observedAt: observationTime,
      provider: expectation.provider,
      repository: expectation.repository,
      changeRequest: expectation.changeRequest,
      baseBranch: expectation.baseBranch,
      baseSha: expectation.baseSha,
      headSha: expectation.headSha,
      containsCurrentBase: true,
    },
    setObligation: {
      owner: expectation.issue,
      provider: expectation.provider,
      repository: expectation.repository,
      changeRequest: expectation.changeRequest,
      publicationKey: expectation.publicationKey,
      baseBranch: expectation.baseBranch,
      baseSha: expectation.baseSha,
      headSha: expectation.headSha,
      expiresWhen: 'sibling-merge-into-base',
      reinvocation: 'invoke-fresh-shepherd',
      generation: expectation.obligationGeneration,
      createdAt: observationTime,
    },
    ...overrides,
  };
}

function accepted(issue = 'b') {
  const expectation = expected(issue);
  return acceptShepherdReturn(shepherd(expectation), expectation);
}

function state() {
  const shepherdA = accepted('a');
  const shepherdB = accepted('b');
  return {
    runId: 'run',
    manifestDigest: manifest().digest,
    providerConfigurationDigest: manifest().providerConfigurationDigest,
    revision: 5,
    issues: {
      a: {
        identity: 'a', baseSha: oid('base-1'), headSha: oid('head-a'),
        status: 'completed', assignment: null,
        acceptanceCriteria: manifest().issues.find((issue) => issue.identity === 'a').acceptanceCriteria,
        changeRequest: {
          identifier: 'PR-A', publicationKey: 'pub-a', baseBranch: 'main',
          provider: 'github', repository: 'owner/repo', headSha: oid('head-a'),
        },
        pipeline: [{ stage: 'publication' }, { stage: 'shepherd' }],
        shepherd: shepherdA,
        shepherdDecision: null,
        setObligation: shepherdA.setObligation,
        readinessGeneration: 1,
        readinessWatermark: null,
        terminalDisposition: 'ready-for-human-merge',
      },
      b: {
        identity: 'b', baseSha: oid('base-1'), headSha: oid('head-b'),
        status: 'completed', assignment: null,
        acceptanceCriteria: manifest().issues.find((issue) => issue.identity === 'b').acceptanceCriteria,
        changeRequest: {
          identifier: 'PR-B', publicationKey: 'pub-b', baseBranch: 'main',
          provider: 'github', repository: 'owner/repo', headSha: oid('head-b'),
        },
        pipeline: [{ stage: 'publication' }, { stage: 'shepherd' }],
        shepherd: shepherdB,
        shepherdDecision: null,
        setObligation: shepherdB.setObligation,
        readinessGeneration: 1,
        readinessWatermark: null,
        terminalDisposition: 'ready-for-human-merge',
      },
      c: {
        identity: 'c', baseSha: oid('base-1'), headSha: oid('head-c'),
        status: 'blocked', assignment: null,
        acceptanceCriteria: manifest().issues.find((issue) => issue.identity === 'c').acceptanceCriteria,
        changeRequest: {
          identifier: 'PR-C', publicationKey: 'pub-c', baseBranch: 'main',
          provider: 'github', repository: 'owner/repo', headSha: oid('head-c'),
        },
        pipeline: [{ stage: 'publication' }],
        shepherd: null,
        shepherdDecision: null,
        setObligation: null,
        readinessGeneration: 1,
        readinessWatermark: null,
        checkActivity: {
          kind: 'shepherd-check',
          state: 'active',
          generation: 1,
          startedAt: '2026-08-30T00:01:30Z',
        },
        terminalDisposition: 'blocked',
      },
    },
    publications: [
      {
        key: 'pub-a', provider: 'github', repository: 'owner/repo',
        issue: 'a', identifier: 'PR-A', baseBranch: 'main', headBranch: 'issue-a', headSha: oid('head-a'),
        observations: [{
          state: 'confirmed', baseSha: oid('base-1'), headSha: oid('head-a'),
          confirmedAt: '2026-08-30T00:00:30Z',
        }],
      },
      {
        key: 'pub-b', provider: 'github', repository: 'owner/repo',
        issue: 'b', identifier: 'PR-B', baseBranch: 'main', headBranch: 'issue-b', headSha: oid('head-b'),
        observations: [{
          state: 'confirmed', baseSha: oid('base-1'), headSha: oid('head-b'),
          confirmedAt: '2026-08-30T00:00:30Z',
        }],
      },
      {
        key: 'pub-c', provider: 'github', repository: 'owner/repo',
        issue: 'c', identifier: 'PR-C', baseBranch: 'main', headBranch: 'issue-c', headSha: oid('head-c'),
        observations: [{
          state: 'confirmed', baseSha: oid('base-1'), headSha: oid('head-c'),
          confirmedAt: '2026-08-30T00:00:30Z',
        }],
      },
    ],
    observedHumanMerges: [],
    expiredReadinessClaims: [],
    reShepherdQueue: [],
    fleetDisposition: 'review-ready',
    control: { cancelled: false, budgetExhausted: false },
    events: [],
  };
}

const mergeA = {
  invocation: { id: 'merge-a-observe', operation: 'observe-merge', providerKey: 'pub-a' },
  observed: true,
  status: 'observed',
  terminal: true,
  complete: true,
  merged: true,
  provider: 'github',
  repository: 'owner/repo',
  issue: 'a',
  changeRequest: 'PR-A',
  publicationKey: 'pub-a',
  baseBranch: 'main',
  baseSha: oid('base-1'),
  headBranch: 'issue-a',
  headSha: oid('head-a'),
  mergeCommit: oid('merge-a'),
  observedAt: '2026-08-30T00:02:00Z',
};
const mergeC = {
  ...mergeA,
  invocation: { id: 'merge-c-observe', operation: 'observe-merge', providerKey: 'pub-c' },
  issue: 'c',
  changeRequest: 'PR-C',
  publicationKey: 'pub-c',
  headBranch: 'issue-c',
  headSha: oid('head-c'),
  mergeCommit: oid('merge-c'),
  observedAt: '2026-08-30T00:03:00Z',
};

function revision(issue, baseSha, observedAt) {
  const normalizedBase = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(baseSha)
    ? baseSha
    : oid(baseSha);
  return {
    invocation: {
      id: `revision-${issue}-${baseSha}`,
      operation: 'observe-change-request-revision',
      providerKey: `pub-${issue}`,
    },
    observed: true,
    status: 'observed',
    terminal: true,
    complete: true,
    provider: 'github',
    repository: 'owner/repo',
    issue,
    changeRequest: `PR-${issue.toUpperCase()}`,
    publicationKey: `pub-${issue}`,
    baseBranch: 'main',
    baseSha: normalizedBase,
    headBranch: `issue-${issue}`,
    headSha: oid(`head-${issue}`),
    observedAt,
  };
}

function validNoShepherdPipeline(baseSha, headSha) {
  baseSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(baseSha) ? baseSha : oid(baseSha);
  headSha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(headSha) ? headSha : oid(headSha);
  const common = {
    baseSha, headSha, complete: true, terminal: true,
    completedAt: '2026-08-30T00:05:00Z',
  };
  const blast = {
    subjectChange: 'current candidate diff',
    suppliedBaseline: 'confirmed fleet base',
    includedScope: ['current issue'],
    exclusions: [],
    repositories: ['owner/repo'],
    revisions: { baseSha, headSha },
    environments: ['isolated test runner'],
    directCallers: ['adapter consumer'],
    crossBoundaryConsumers: ['provider publication boundary'],
    assertionLadders: [{
      id: 'A1', assertion: 'safe', affectedBoundary: 'adapter', badCase: 'breakage',
      safetyCriticalReason: 'unsafe delivery',
      rungs: [
        'assertion', 'exact-source-citation', 'ruled-out-bad-case',
        'executable-proof', 'live-reproduction',
      ].map((name) => ({
        name, progression: 'completed', 'evidence-outcome': 'supports-assertion',
        evidence: `${name} proof`, scope: 'current revision',
      })),
      strongestSupportedClaim: 'safe in scope',
    }],
    classifications: {
      'confirmed-risk': [],
      'cleared-risk': [{ assertionId: 'A1', assertion: 'safe', evidence: 'ruled-out-bad-case proof', scope: 'current revision' }],
      'unproven-assertion': [],
    },
    analysisBoundaries: ['current revision and traced consumers'],
    crossBoundaryGaps: [],
    'regression-proof-status': 'selected',
    'regression-proof': {
      id: 'P1', assertionId: 'A1', badCase: 'breakage', verificationLevel: 'integration',
      environment: 'test', setup: 'setup', action: 'run', observableResult: 'pass',
      prerequisites: [], authorization: 'read-only', cheaperProofInsufficientReason: 'boundary',
      outsideCoverage: 'provider',
    },
  };
  return [
    ['implementation', { ...common, status: 'completed' }],
    ['diff-reconciliation', { ...common, verdict: 'reconciled' }],
    ['run-ci', {
      ...common,
      invocation: { skill: 'run-ci', id: 'ci-b', runId: 'run', issue: 'b' },
      status: 'passed', evidenceComplete: true, steps: [{ name: 'tests', status: 'passed' }],
    }],
    ['roast', {
      ...common,
      invocation: { skill: 'roast', id: 'roast-b', runId: 'run', issue: 'b' },
      status: 'completed', findings: [],
      evidenceComplete: true,
    }],
    ['blast-radius-proof', blast],
    ['bounded-remediation', { ...common, status: 'completed', unresolvedDefects: [] }],
    ['criterion-verdict', {
      ...common,
      verdicts: [{
        id: 'C1', verdict: 'satisfied',
        evidence: { complete: true, summary: 'proven', baseSha, headSha },
      }],
    }],
    ['publication', {
      baseSha, headSha, status: 'confirmed', terminal: true, complete: true,
      observedAt: '2026-08-30T00:05:30Z', provider: 'github', repository: 'owner/repo',
      issue: 'b', changeRequest: 'PR-B', publicationKey: 'pub-b',
    }],
  ].map(([stage, evidence]) => ({ stage, evidence }));
}

function assignmentPacket(currentManifest, issueIdentity, branch, worktree, baseSha, headSha) {
  const issue = currentManifest.issues.find((entry) => entry.identity === issueIdentity);
  const verification = [...currentManifest.validationPolicy];
  const reportContract = {
    summary: 'return confirmed validation evidence',
    requiredEvidence: verification,
  };
  const forbiddenAuthorities = [
    'merge', 'approve', 'enable-auto-merge', 'accept-risk', 'force-push',
    'close-tracker-work', 'select-adjacent-work',
  ];
  return {
    schemaVersion: 1,
    manifestDigest: currentManifest.digest,
    issue: issueIdentity,
    sourceRevision: issue.sourceRevision,
    acceptanceCriteria: issue.acceptanceCriteria,
    scope: issue.scope,
    exclusions: currentManifest.exclusions,
    allowedPaths: issue.allowedPaths,
    verification,
    reportContract,
    forbiddenAuthorities,
    taskContract: {
      goal: currentManifest.goal,
      scope: JSON.stringify(issue.scope),
      context: JSON.stringify({
        acceptedScope: currentManifest.acceptedScope,
        humanBoundaries: currentManifest.humanBoundaries,
        issue: issueIdentity,
        repository: currentManifest.repository.id,
        sourceRevision: issue.sourceRevision,
      }),
      acceptance: issue.acceptanceCriteria.map((entry) => entry.description),
      verify: verification.join('\n'),
      timebox: JSON.stringify({ cost: 10, retries: 2, timeMinutes: 60 }),
      forbidden: forbiddenAuthorities.join('\n'),
      report: JSON.stringify({
        requiredEvidence: verification,
        summary: reportContract.summary,
      }),
      standing: 'one-issue-one-branch-one-worktree-no-adjacent-work',
    },
    branch,
    worktree,
    baseSha,
    headSha,
  };
}

function fullReadyState(currentManifest = manifest()) {
  const current = createFleetState(currentManifest, 'run', '2026-08-30T00:00:00Z');
  current.revision = 0;
  current.updatedAt = '2026-08-30T00:01:02Z';
  current.issues.c.sourceObservation = {
    ...current.issues.c.sourceReceipt,
    invocation: { id: 'reobserve-c', operation: 'read-issue' },
    observedAt: '2026-08-30T00:01:00Z',
    manifestDigest: currentManifest.digest,
    reobservedAt: '2026-08-30T00:01:01Z',
  };
  for (const issueIdentity of ['a', 'b']) {
    const record = current.issues[issueIdentity];
    const headSha = oid(`head-${issueIdentity}`);
    const stablePublicationKey = publicationKey({
      manifestDigest: currentManifest.digest,
      providerConfigurationDigest: currentManifest.providerConfigurationDigest,
      provider: 'github',
      repository: 'owner/repo',
      issue: issueIdentity,
      sourceRevision: `r-${issueIdentity}`,
      headBranch: `issue-${issueIdentity}`,
      baseBranch: 'main',
    });
    const identifier = `PR-${issueIdentity.toUpperCase()}`;
    const readinessExpectation = {
      ...expected(issueIdentity),
      publicationKey: stablePublicationKey,
    };
    const acceptedReadiness = acceptShepherdReturn(
      shepherd(readinessExpectation),
      readinessExpectation,
    );
    const pipeline = validNoShepherdPipeline('base-1', headSha).map((entry) => {
      const evidence = structuredClone(entry.evidence);
      if (evidence.invocation) {
        evidence.invocation.issue = issueIdentity;
        evidence.invocation.id = evidence.invocation.id.replace('-b', `-${issueIdentity}`);
      }
      if (entry.stage === 'publication') {
        Object.assign(evidence, {
          observedAt: '2026-08-30T00:00:30Z',
          issue: issueIdentity,
          changeRequest: identifier,
          publicationKey: stablePublicationKey,
        });
      }
      return { stage: entry.stage, evidence };
    });
    pipeline.push({
      stage: 'shepherd',
      evidence: structuredClone(acceptedReadiness.receipt),
    });
    Object.assign(record, {
      dependencyState: 'unclassified',
      branch: `issue-${issueIdentity}`,
      worktree: path.resolve('test-fixtures', `readiness-worktree-${issueIdentity}`),
      baseSha: oid('base-1'),
      headSha,
      status: 'completed',
      statusReason: null,
      implementationStatus: 'completed',
      pipeline,
      changeRequest: {
        identifier,
        provider: 'github',
        repository: 'owner/repo',
        baseBranch: 'main',
        headBranch: `issue-${issueIdentity}`,
        baseSha: oid('base-1'),
        headSha,
        publicationKey: stablePublicationKey,
      },
      shepherd: acceptedReadiness,
      shepherdDecision: null,
      setObligation: structuredClone(acceptedReadiness.setObligation),
      readinessGeneration: 1,
      readinessWatermark: null,
      terminalDisposition: 'ready-for-human-merge',
      nextAction: 'await-human-merge',
    });
    current.publications.push({
      manifestDigest: currentManifest.digest,
      providerConfigurationDigest: currentManifest.providerConfigurationDigest,
      provider: 'github',
      repository: 'owner/repo',
      issue: issueIdentity,
      sourceRevision: `r-${issueIdentity}`,
      headBranch: `issue-${issueIdentity}`,
      baseBranch: 'main',
      key: stablePublicationKey,
      identifier,
      observations: [{
        baseSha: oid('base-1'),
        headSha,
        state: 'confirmed',
        attempts: [{
          invocation: {
            id: `publish-${issueIdentity}`,
            operation: 'publish-change-request',
            providerKey: stablePublicationKey,
          },
          status: 'published',
          observedAt: '2026-08-30T00:00:30Z',
          terminal: true,
          complete: true,
          provider: 'github',
          repository: 'owner/repo',
          issue: issueIdentity,
          baseBranch: 'main',
          headBranch: `issue-${issueIdentity}`,
          baseSha: oid('base-1'),
          headSha,
          identifier,
        }],
        intentAt: '2026-08-30T00:00:20Z',
        confirmedAt: '2026-08-30T00:00:30Z',
      }],
    });
  }
  current.fleetDisposition = deriveFleetDisposition(current, currentManifest);
  const reconciled = reconcileFrontier(
    current,
    currentManifest,
    computeFrontier(currentManifest, current),
  );
  assertFleetState(reconciled, currentManifest);
  return { current: reconciled, currentManifest };
}

test('accepts only exact provider/CR/revision/owner-bound real nested Shepherd returns', () => {
  const expectation = expected();
  assert.equal(acceptShepherdReturn(shepherd(expectation), expectation).ready, true);
  assert.equal(acceptShepherdReturn(shepherd(expectation, {
    observation: { ...shepherd(expectation).observation, containsCurrentBase: false },
  }), expectation).ready, false);
  assert.equal(acceptShepherdReturn(shepherd(expectation, {
    result: {
      ...shepherd(expectation).result,
      receipt: { ...shepherd(expectation).result.receipt, provider: '' },
    },
  }), expectation).ready, false);
  assert.equal(acceptShepherdReturn(shepherd(expectation, { setObligation: null }), expectation).ready, false);
});

test('atomically consumes initial Shepherd readiness and rejects stale duplicate or intervening returns', (t) => {
  const repositoryRoot = path.resolve('test-fixtures', 'initial-shepherd-repository');
  const worktree = path.resolve('test-fixtures', 'initial-shepherd-worktree-b');
  setupGitWorktree(repositoryRoot, worktree, 'issue-b');
  t.after(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  });
  const actualRevision = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  const baseManifest = manifest();
  const currentManifest = normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: baseManifest.goal,
    acceptedScope: baseManifest.acceptedScope,
    exclusions: baseManifest.exclusions,
    humanDecisions: [],
    issues: baseManifest.issues.map((issue) => ({
      identity: issue.identity,
      sourceRevision: issue.sourceRevision,
      sourceReceipt: issue.sourceReceipt,
      acceptanceCriteria: issue.acceptanceCriteria,
      scope: issue.scope,
      allowedPaths: issue.allowedPaths,
      status: issue.status,
    })),
    dependencies: baseManifest.dependencies,
    concurrency: baseManifest.concurrency,
    budget: baseManifest.budget,
    repository: { ...baseManifest.repository, root: repositoryRoot },
    provider: baseManifest.provider,
    validationPolicy: baseManifest.validationPolicy,
    stopConditions: baseManifest.stopConditions,
    humanBoundaries: baseManifest.humanBoundaries,
    shepherdIntent: 'yes',
  });
  let { current } = fullReadyState(currentManifest);
  const record = current.issues.b;
  record.pipeline = record.pipeline
    .filter((entry) => entry.stage !== 'shepherd')
    .map((entry) => {
      const evidence = structuredClone(entry.evidence);
      if (entry.stage === 'blast-radius-proof') {
        evidence.revisions = { baseSha: actualRevision, headSha: actualRevision };
      } else {
        evidence.baseSha = actualRevision;
        evidence.headSha = actualRevision;
      }
      if (entry.stage === 'criterion-verdict') {
        evidence.verdicts = evidence.verdicts.map((verdict) => ({
          ...verdict,
          evidence: { ...verdict.evidence, baseSha: actualRevision, headSha: actualRevision },
        }));
      }
      return { stage: entry.stage, evidence };
    });
  record.baseSha = actualRevision;
  record.headSha = actualRevision;
  record.shepherd = null;
  record.setObligation = null;
  record.status = 'active';
  record.dependencyState = 'active';
  record.terminalDisposition = null;
  record.nextAction = null;
  record.worktree = worktree;
  record.assignment = {
    generation: 1,
    workerContext: 'implementation-b',
    branch: 'issue-b',
    worktree,
    worktreeIdentity: captureIsolatedGitWorktreeIdentity(repositoryRoot, worktree, 'issue-b'),
    baseSha: actualRevision,
    headSha: actualRevision,
    packet: assignmentPacket(
      currentManifest,
      'b',
      'issue-b',
      worktree,
      actualRevision,
      actualRevision,
    ),
    active: true,
    startedAt: '2026-08-30T00:00:10Z',
  };
  record.checkActivity = {
    kind: 'shepherd-check',
    state: 'active',
    generation: 1,
    startedAt: '2026-08-30T00:00:40Z',
  };
  record.changeRequest.baseSha = actualRevision;
  record.changeRequest.headSha = actualRevision;
  const publication = current.publications.find((entry) => entry.issue === 'b');
  publication.observations[0].baseSha = actualRevision;
  publication.observations[0].headSha = actualRevision;
  publication.observations[0].attempts[0].baseSha = actualRevision;
  publication.observations[0].attempts[0].headSha = actualRevision;
  current.activeCapacity = 1;
  current.completedWork = current.completedWork.filter((entry) => entry.issue !== 'b');
  current = reconcileFrontier(current, currentManifest, computeFrontier(currentManifest, current));
  current.fleetDisposition = deriveFleetDisposition(current, currentManifest);
  assert.doesNotThrow(() => assertFleetState(current, currentManifest));

  const expectation = {
    ...expected('b', 1, actualRevision),
    headSha: actualRevision,
    publicationKey: record.changeRequest.publicationKey,
  };
  const returned = shepherd(expectation);
  const completion = {
    generation: 1,
    workerContext: 'implementation-b',
    baseSha: actualRevision,
    headSha: actualRevision,
    completedAt: '2026-08-30T00:01:02Z',
    resultDigest: 'a'.repeat(64),
  };
  const stale = structuredClone(returned);
  stale.result.receipt.headSha = oid('stale-head');
  assert.throws(
    () => consumeInitialShepherdResult(current, currentManifest, 'b', stale, completion),
    /does not match/,
  );
  const intervening = structuredClone(current);
  const publicationA = intervening.publications.find((entry) => entry.issue === 'a');
  intervening.observedHumanMerges.push({
    ...mergeA,
    invocation: { ...mergeA.invocation, providerKey: publicationA.key },
    publicationKey: publicationA.key,
    observedAt: '2026-08-30T00:00:50Z',
  });
  assert.throws(
    () => consumeInitialShepherdResult(intervening, currentManifest, 'b', returned, completion),
    /intervening merge/,
  );
  const stopped = structuredClone(current);
  stopped.control.cancelled = true;
  stopped.issues.b.handoffObligation = {
    state: 'blocked',
    reason: 'handoff-required',
    condition: 'cancelled',
    generation: 1,
    workerContext: 'implementation-b',
    requiredAt: '2026-08-30T00:00:45Z',
  };
  assert.throws(
    () => consumeInitialShepherdResult(stopped, currentManifest, 'b', returned, completion),
    /stopped fleet|orchestration-handoff/,
  );

  const file = fleetStatePath(repositoryRoot, 'run');
  const persisted = persistFleetState(file, current, 0, currentManifest);
  const consumed = consumeInitialShepherdResultPersisted(
    file,
    currentManifest,
    'b',
    returned,
    completion,
    persisted.revision,
  );
  assert.equal(consumed.issues.b.assignment, null);
  assert.equal(consumed.issues.b.continuationChain.at(-1).endReason, 'completed');
  assert.equal(consumed.issues.b.checkActivity, null);
  assert.equal(consumed.issues.b.terminalDisposition, 'ready-for-human-merge');
  assert.equal(consumed.issues.b.pipeline.at(-1).stage, 'shepherd');
  assert.throws(
    () => consumeInitialShepherdResultPersisted(
      file,
      currentManifest,
      'b',
      returned,
      completion,
      consumed.revision,
    ),
    /already consumed/,
  );
});

test('expires readiness immediately and queues generation/revision-specific re-Shepherd work', () => {
  const mutatedManifest = manifest();
  mutatedManifest.shepherdIntent = 'no';
  assert.throws(
    () => expireReadinessAfterSiblingMerge(state(), mutatedManifest, mergeA, {}),
    /manifest digest does not match authority fields/,
  );
  const incompleteRevision = revision('b', 'base-2', '2026-08-30T00:02:01Z');
  delete incompleteRevision.publicationKey;
  const malformed = expireReadinessAfterSiblingMerge(
    state(),
    manifest(),
    mergeA,
    { b: incompleteRevision },
  );
  assert.equal(malformed.observedHumanMerges.length, 1);
  assert.equal(malformed.issues.b.terminalDisposition, 'blocked');
  assert.match(
    malformed.reShepherdQueue.find((entry) => entry.issue === 'b').blocker,
    /schema-is-not-exact/,
  );
  const recovered = recordReadinessRevisionObservation(
    malformed,
    manifest(),
    'b',
    revision('b', 'base-2', '2026-08-30T00:02:01Z'),
  );
  assert.equal(recovered.reShepherdQueue.find((entry) => entry.issue === 'b').blocker, null);
  assert.equal(
    recovered.reShepherdQueue.find((entry) => entry.issue === 'b').action,
    'invoke-fresh-shepherd',
  );
  const stale = expireReadinessAfterSiblingMerge(
    state(),
    manifest(),
    mergeA,
    { b: revision('b', 'base-2', '2026-08-30T00:01:59Z') },
  );
  assert.match(
    stale.reShepherdQueue.find((entry) => entry.issue === 'b').blocker,
    /predates/,
  );
  const current = expireReadinessAfterSiblingMerge(
    state(),
    manifest(),
    mergeA,
    { b: revision('b', 'base-2', '2026-08-30T00:02:01Z') },
    '2026-08-30T00:02:02Z',
  );
  assert.deepEqual(current.issues.b.shepherd, {
    accepted: false,
    ready: false,
    freshness: 'expired',
    expiredAt: '2026-08-30T00:02:02Z',
    reason: 'sibling-merge:PR-A',
    generation: 2,
  });

  assert.equal(current.issues.b.setObligation, null);
  assert.equal(current.issues.b.shepherdDecision, null);
  assert.equal(current.issues.b.terminalDisposition, 'blocked');
  assert.equal(current.fleetDisposition, 'blocked');
  const queuedB = current.reShepherdQueue.find((entry) => entry.issue === 'b');
  const queuedC = current.reShepherdQueue.find((entry) => entry.issue === 'c');
  assert.equal(queuedB.generation, 2);
  assert.equal(queuedB.baseSha, oid('base-2'));
  assert.equal(queuedC.generation, 2);
  assert.equal(queuedC.action, 'acquire-current-change-request-revision');
  assert.equal(current.issues.b.pipeline.length, 0);
  assert.equal(current.issues.b.changeRequest, null);
  assert.equal(current.issues.c.checkActivity, null);
  const duplicate = expireReadinessAfterSiblingMerge(
    current,
    manifest(),
    mergeA,
    {},
    '2026-08-30T00:02:03Z',
  );
  assert.equal(duplicate.reShepherdQueue.find((entry) => entry.issue === 'b').generation, 2);
  assert.equal(duplicate.expiredReadinessClaims.length, current.expiredReadinessClaims.length);

  const repeat = expireReadinessAfterSiblingMerge(
    current,
    manifest(),
    mergeC,
    { b: revision('b', 'base-3', '2026-08-30T00:03:01Z') },
    '2026-08-30T00:03:02Z',
  );
  assert.equal(repeat.reShepherdQueue.length, 1);
  assert.equal(repeat.reShepherdQueue[0].issue, 'b');
  assert.equal(repeat.reShepherdQueue[0].generation, 3);
  assert.equal(repeat.reShepherdQueue[0].baseSha, oid('base-3'));
});

test('expired accepted readiness remains fully persistent while landed review readiness stays current', () => {
  const dependencyManifest = manifest('yes', [{
    dependency: 'a',
    dependent: 'c',
    satisfiedBy: 'human-merge',
  }]);
  const { current, currentManifest } = fullReadyState(dependencyManifest);
  const publicationA = current.publications.find((entry) => entry.issue === 'a');
  const publicationB = current.publications.find((entry) => entry.issue === 'b');
  const fullMerge = {
    ...mergeA,
    invocation: {
      ...mergeA.invocation,
      providerKey: publicationA.key,
    },
    publicationKey: publicationA.key,
  };
  const fullRevision = {
    ...revision('b', 'base-2', '2026-08-30T00:02:01Z'),
    invocation: {
      ...revision('b', 'base-2', '2026-08-30T00:02:01Z').invocation,
      providerKey: publicationB.key,
    },
    publicationKey: publicationB.key,
  };
  const expired = expireReadinessAfterSiblingMerge(
    current,
    currentManifest,
    fullMerge,
    { b: fullRevision },
    '2026-08-30T00:02:02Z',
  );
  assert.equal(expired.issues.a.terminalDisposition, 'ready-for-human-merge');
  assert.equal(expired.issues.a.nextAction, null);
  assert.equal(expired.issues.b.shepherd.freshness, 'expired');
  assert.equal(expired.issues.b.setObligation, null);
  assert.equal(expired.fleetDisposition, 'partially-review-ready');
  assert.equal(
    computeFrontier(currentManifest, expired).ready.find((entry) => entry.issue === 'c').reason,
    'all-blocking-dependencies-satisfied',
  );
  assert.doesNotThrow(() => assertFleetState(expired, currentManifest));
});

test('an in-flight first Shepherd expiry preserves assignment ownership and persists its blocker', (t) => {
  const repositoryRoot = path.resolve('test-fixtures', 'in-flight-shepherd-repository');
  const worktree = path.resolve('test-fixtures', 'in-flight-shepherd-worktree-b');
  setupGitWorktree(repositoryRoot, worktree, 'issue-b');
  t.after(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  });
  const baseManifest = manifest();
  const currentManifest = normalizeFleetManifest({
    confirmation: 'confirmed',
    goal: baseManifest.goal,
    acceptedScope: baseManifest.acceptedScope,
    exclusions: baseManifest.exclusions,
    humanDecisions: [],
    issues: baseManifest.issues.map((issue) => ({
      identity: issue.identity,
      sourceRevision: issue.sourceRevision,
      sourceReceipt: issue.sourceReceipt,
      acceptanceCriteria: issue.acceptanceCriteria,
      scope: issue.scope,
      allowedPaths: issue.allowedPaths,
      status: issue.status,
    })),
    dependencies: baseManifest.dependencies,
    concurrency: baseManifest.concurrency,
    budget: baseManifest.budget,
    repository: { ...baseManifest.repository, root: repositoryRoot },
    provider: baseManifest.provider,
    validationPolicy: baseManifest.validationPolicy,
    stopConditions: baseManifest.stopConditions,
    humanBoundaries: baseManifest.humanBoundaries,
    shepherdIntent: 'yes',
  });
  let { current } = fullReadyState(currentManifest);
  const record = current.issues.b;
  record.pipeline = record.pipeline.filter((entry) => entry.stage !== 'shepherd');
  record.shepherd = null;
  record.setObligation = null;
  record.status = 'active';
  record.dependencyState = 'active';
  record.terminalDisposition = null;
  record.nextAction = null;
  record.worktree = worktree;
  record.assignment = {
    generation: 1,
    workerContext: 'implementation-b',
    branch: 'issue-b',
    worktree,
    worktreeIdentity: captureIsolatedGitWorktreeIdentity(repositoryRoot, worktree, 'issue-b'),
    baseSha: oid('base-1'),
    headSha: oid('head-b'),
    packet: assignmentPacket(
      currentManifest,
      'b',
      'issue-b',
      worktree,
      oid('base-1'),
      oid('head-b'),
    ),
    active: true,
    startedAt: '2026-08-30T00:01:00Z',
  };
  record.checkActivity = {
    kind: 'shepherd-check',
    state: 'active',
    generation: 1,
    startedAt: '2026-08-30T00:01:30Z',
  };
  current.activeCapacity = 1;
  current.completedWork = current.completedWork.filter((entry) => entry.issue !== 'b');
  current = reconcileFrontier(
    current,
    currentManifest,
    computeFrontier(currentManifest, current),
  );
  current.fleetDisposition = deriveFleetDisposition(current, currentManifest);
  assert.doesNotThrow(() => assertFleetState(current, currentManifest));

  const publicationA = current.publications.find((entry) => entry.issue === 'a');
  const expired = expireReadinessAfterSiblingMerge(current, currentManifest, {
    ...mergeA,
    invocation: { ...mergeA.invocation, providerKey: publicationA.key },
    publicationKey: publicationA.key,
  }, {}, '2026-08-30T00:02:02Z');
  assert.equal(expired.issues.b.status, 'active');
  assert.equal(expired.issues.b.assignment.workerContext, 'implementation-b');
  assert.equal(expired.issues.b.checkActivity.state, 'blocked');
  assert.equal(expired.issues.b.checkActivity.blocker, 'sibling-merge-watermark');
  assert.equal(expired.issues.b.terminalDisposition, null);
  assert.doesNotThrow(() => assertFleetState(expired, currentManifest));
  const publicationB = expired.publications.find((entry) => entry.issue === 'b');
  const queuedRevision = recordReadinessRevisionObservation(
    expired,
    currentManifest,
    'b',
    {
      ...revision('b', 'base-2', '2026-08-30T00:02:03Z'),
      invocation: {
        ...revision('b', 'base-2', '2026-08-30T00:02:03Z').invocation,
        providerKey: publicationB.key,
      },
      publicationKey: publicationB.key,
    },
  );
  assert.equal(queuedRevision.issues.b.baseSha, oid('base-1'));
  assert.equal(queuedRevision.issues.b.assignment.baseSha, oid('base-1'));
  assert.equal(
    queuedRevision.reShepherdQueue.find((entry) => entry.issue === 'b').action,
    'await-safe-ownership-transition',
  );
  assert.doesNotThrow(() => assertFleetState(queuedRevision, currentManifest));
  let transitioned = transitionIssue(queuedRevision, currentManifest, 'b', 'blocked', {
    assignmentEnd: {
      generation: 1,
      workerContext: 'implementation-b',
      reason: 'blocked',
      endedAt: '2026-08-30T00:02:04Z',
    },
    terminalDisposition: 'blocked',
  });
  assert.equal(transitioned.issues.b.baseSha, oid('base-2'));
  assert.equal(transitioned.issues.b.assignment, null);
  assert.equal(transitioned.issues.b.checkActivity, null);
  transitioned = startCheckActivity(
    transitioned,
    currentManifest,
    'b',
    'shepherd-check',
    '2026-08-30T00:02:05Z',
  );
  assert.equal(transitioned.issues.b.checkActivity.generation, 2);
  const persisted = persistFleetState(
    fleetStatePath(repositoryRoot, 'run'),
    transitioned,
    0,
    currentManifest,
  );
  assert.equal(persisted.issues.b.status, 'blocked');
  assert.equal(persisted.issues.b.assignment, null);
  assert.equal(persisted.issues.b.checkActivity.state, 'active');
  assert.equal(persisted.issues.b.checkActivity.generation, 2);
});

test('consumes queued work only with a fresh accepted receipt bound to the queued generation', () => {
  let expired = expireReadinessAfterSiblingMerge(
    state(),
    manifest(),
    mergeA,
    { b: revision('b', 'base-2', '2026-08-30T00:02:01Z') },
  );
  const expectation = expected('b', 2, 'base-2');
  const fresh = acceptShepherdReturn(shepherd(expectation), expectation);
  assert.throws(
    () => consumeReShepherdQueue(expired, manifest(), 'b', accepted('b'), null),
    /queued generation/,
  );
  const terminal = structuredClone(expired);
  terminal.issues.b.status = 'timed-out';
  terminal.issues.b.terminalDisposition = 'timed-out-with-handoff';
  assert.throws(
    () => consumeReShepherdQueue(terminal, manifest(), 'b', fresh, null),
    /terminal issue cannot consume/,
  );
  expired.publications.find((entry) => entry.key === 'pub-b').observations.push({
    state: 'confirmed', baseSha: oid('base-2'), headSha: oid('head-b'),
    confirmedAt: '2026-08-30T00:05:30Z',
  });
  expired.issues.b.changeRequest = {
    identifier: 'PR-B', publicationKey: 'pub-b', baseBranch: 'main',
    provider: 'github', repository: 'owner/repo', baseSha: oid('base-2'), headSha: oid('head-b'),
  };
  expired = startCheckActivity(
    expired,
    manifest(),
    'b',
    'shepherd-check',
    '2026-08-30T00:05:31Z',
  );
  const consumed = consumeReShepherdQueue(expired, manifest(), 'b', fresh, {
    status: 'completed',
    terminal: true,
    complete: true,
    completedAt: '2026-08-30T00:05:45Z',
    pipeline: validNoShepherdPipeline('base-2', 'head-b'),
  });
  assert.equal(consumed.reShepherdQueue.length, 1);
  assert.equal(consumed.reShepherdQueue[0].issue, 'c');
  assert.equal(consumed.issues.b.terminalDisposition, 'ready-for-human-merge');
  assert.equal(consumed.issues.b.pipeline.at(-1).stage, 'shepherd');
  assert.equal(consumed.issues.b.checkActivity, null);
});

test('manifest Shepherd intent no records a real not-required state and obligation without dispatch', (t) => {
  const noManifest = manifest('no');
  const repositoryRoot = noManifest.repository.root;
  const worktree = path.resolve('test-fixtures', 'readiness-worktree-a');
  setupGitWorktree(repositoryRoot, worktree, 'issue-a');
  const actualRevision = execFileSync('git', ['-C', repositoryRoot, 'rev-parse', 'main'], {
    encoding: 'utf8',
  }).trim();
  t.after(() => {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  });
  const current = {
    runId: 'run',
    manifestDigest: noManifest.digest,
    providerConfigurationDigest: noManifest.providerConfigurationDigest,
    issues: {
      a: {
        identity: 'a',
        status: 'active',
        baseSha: actualRevision,
        headSha: actualRevision,
        assignment: {
          generation: 1,
          workerContext: 'worker-a',
          branch: 'issue-a',
          worktree,
          worktreeIdentity: captureIsolatedGitWorktreeIdentity(
            repositoryRoot,
            worktree,
            'issue-a',
          ),
          baseSha: actualRevision,
          headSha: actualRevision,
          packet: {},
          active: true,
          startedAt: '2026-08-30T00:01:00Z',
        },
        continuationChain: [],
        acceptanceCriteria: noManifest.issues.find((issue) => issue.identity === 'a').acceptanceCriteria,
        pipeline: validNoShepherdPipeline(actualRevision, actualRevision).map((entry) => {
          const evidence = structuredClone(entry.evidence);
          if (evidence.invocation) {
            evidence.invocation.issue = 'a';
            evidence.invocation.id = evidence.invocation.id.replace('-b', '-a');
          }
          if (entry.stage === 'criterion-verdict') {
            evidence.verdicts[0].evidence.summary = 'proven for a';
          }
          if (entry.stage === 'publication') {
            evidence.issue = 'a';
            evidence.changeRequest = 'PR-A';
            evidence.publicationKey = 'pub-a';
          }
          return { stage: entry.stage, evidence };
        }),
        changeRequest: {
          identifier: 'PR-A', publicationKey: 'pub-a',
          baseSha: actualRevision, headSha: actualRevision,
        },
        shepherd: null,
        shepherdDecision: null,
        setObligation: null,
        readinessGeneration: 0,
        readinessWatermark: null,
      },
      b: {
        identity: 'b', status: 'pending', assignment: null,
        sourceReceipt: noManifest.issues.find((issue) => issue.identity === 'b').sourceReceipt,
        sourceObservation: null,
      },
      c: {
        identity: 'c', status: 'pending', assignment: null,
        sourceReceipt: noManifest.issues.find((issue) => issue.identity === 'c').sourceReceipt,
        sourceObservation: null,
      },
    },
    publications: [{
      key: 'pub-a', identifier: 'PR-A',
      observations: [{
        state: 'confirmed', baseSha: actualRevision, headSha: actualRevision,
        confirmedAt: '2026-08-30T00:05:30Z',
      }],
    }],
    observedHumanMerges: [],
    expiredReadinessClaims: [],
    reShepherdQueue: [],
    control: { cancelled: false, budgetExhausted: false },
    events: [],
  };
  const obligation = {
    owner: 'a',
    provider: 'github',
    repository: 'owner/repo',
    changeRequest: 'PR-A',
    publicationKey: 'pub-a',
    baseBranch: 'main',
    baseSha: actualRevision,
    headSha: actualRevision,
    expiresWhen: 'sibling-merge-into-base',
    reinvocation: 'rerun-quality-and-provider-observation',
    generation: 1,
    createdAt: '2026-08-30T00:05:30Z',
  };
  assert.throws(
    () => recordShepherdNotRequired(current, noManifest, 'a', obligation),
    /assignment success identity/,
  );
  fs.writeFileSync(path.join(worktree, 'worker-change.txt'), 'changed\n');
  execFileSync('git', ['-C', worktree, 'add', 'worker-change.txt'], { stdio: 'ignore' });
  execFileSync('git', ['-C', worktree, '-c', 'user.name=Test', '-c',
    'user.email=test-identity', 'commit', '-m', 'worker changed head'], {
    stdio: 'ignore',
  });
  assert.throws(() => recordShepherdNotRequired(current, noManifest, 'a', obligation, {
    generation: 1,
    workerContext: 'worker-a',
    baseSha: actualRevision,
    headSha: actualRevision,
    completedAt: '2026-08-30T00:05:31Z',
    resultDigest: 'a'.repeat(64),
  }), /head revision no longer matches/);
  execFileSync('git', ['-C', worktree, 'reset', '--hard', actualRevision], { stdio: 'ignore' });
  const next = recordShepherdNotRequired(current, noManifest, 'a', obligation, {
    generation: 1,
    workerContext: 'worker-a',
    baseSha: actualRevision,
    headSha: actualRevision,
    completedAt: '2026-08-30T00:05:31Z',
    resultDigest: 'a'.repeat(64),
  });
  assert.equal(next.issues.a.shepherd, null);
  assert.equal(next.issues.a.shepherdDecision.state, 'not-required');
  assert.equal(next.issues.a.terminalDisposition, 'ready-for-human-merge');
  assert.equal(next.issues.a.nextAction, 'await-human-merge');
  assert.equal(next.issues.a.assignment, null);
  assert.equal(next.issues.a.continuationChain.at(-1).endReason, 'completed');
  assert.equal(next.events[0].type, 'shepherd-not-required');
});

test('no-Shepherd expiry is consumed by fresh quality/provider revalidation, never a fabricated Shepherd', () => {
  const noManifest = manifest('no');
  const current = {
    runId: 'run',
    manifestDigest: noManifest.digest,
    providerConfigurationDigest: noManifest.providerConfigurationDigest,
    issues: {
      a: {
        identity: 'a', status: 'pending', assignment: null,
        sourceReceipt: noManifest.issues.find((issue) => issue.identity === 'a').sourceReceipt,
        sourceObservation: null,
      },
      b: {
        identity: 'b', baseSha: oid('base-1'), headSha: oid('head-b'),
        status: 'blocked', assignment: null,
        acceptanceCriteria: noManifest.issues.find((issue) => issue.identity === 'b').acceptanceCriteria,
        changeRequest: {
          identifier: 'PR-B', publicationKey: 'pub-b',
          baseSha: oid('base-2'), headSha: oid('head-b'),
        },
        shepherd: null,
        shepherdDecision: { state: 'not-required', manifestDigest: noManifest.digest },
        setObligation: null,
        readinessGeneration: 2,
        readinessWatermark: {
          generation: 2,
          observedAt: '2026-08-30T00:03:00Z',
          triggeringPublicationKey: 'pub-a',
          triggeringMergeCommit: oid('merge-a'),
        },
        terminalDisposition: 'blocked',
      },
      c: {
        identity: 'c', status: 'pending', assignment: null,
        sourceReceipt: noManifest.issues.find((issue) => issue.identity === 'c').sourceReceipt,
        sourceObservation: null,
      },
    },
    reShepherdQueue: [{
      issue: 'b', changeRequest: 'PR-B', generation: 2,
      publicationKey: 'pub-b',
      baseSha: oid('base-2'), headSha: oid('head-b'),
      blocker: null,
      mergeObservedAt: '2026-08-30T00:03:00Z',
      action: 'rerun-quality-and-provider-observation',
      revisionObservation: revision('b', 'base-2', '2026-08-30T00:03:01Z'),
    }],
    publications: [{
      key: 'pub-b', identifier: 'PR-B',
      observations: [{
        state: 'confirmed', baseSha: oid('base-2'), headSha: oid('head-b'),
        confirmedAt: '2026-08-30T00:05:30Z',
      }],
    }],
    observedHumanMerges: [],
    control: { cancelled: false, budgetExhausted: false },
    events: [],
  };
  const pipeline = validNoShepherdPipeline('base-2', 'head-b');
  const obligation = {
    owner: 'b', provider: 'github', repository: 'owner/repo',
    changeRequest: 'PR-B', publicationKey: 'pub-b', baseBranch: 'main',
    baseSha: oid('base-2'), headSha: oid('head-b'),
    expiresWhen: 'sibling-merge-into-base',
    reinvocation: 'rerun-quality-and-provider-observation',
    generation: 2,
    createdAt: '2026-08-30T00:06:00Z',
  };
  assert.throws(() => consumeNoShepherdRevalidation(current, noManifest, 'b', {
    status: 'completed', terminal: true, complete: true,
    completedAt: '2026-08-30T00:06:00Z',
    issue: 'b', changeRequest: 'PR-B',
    baseSha: oid('stale'), headSha: oid('head-b'), pipeline,
  }, obligation), /incomplete or stale/);
  const consumed = consumeNoShepherdRevalidation(current, noManifest, 'b', {
    status: 'completed', terminal: true, complete: true,
    completedAt: '2026-08-30T00:06:00Z',
    issue: 'b', changeRequest: 'PR-B',
    baseSha: oid('base-2'), headSha: oid('head-b'), pipeline,
  }, obligation);
  assert.equal(consumed.reShepherdQueue.length, 0);
  assert.equal(consumed.issues.b.shepherd, null);
  assert.equal(consumed.issues.b.shepherdDecision.state, 'not-required');
  assert.equal(consumed.issues.b.terminalDisposition, 'ready-for-human-merge');
});
