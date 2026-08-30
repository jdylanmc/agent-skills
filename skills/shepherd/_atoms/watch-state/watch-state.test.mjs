import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  bootstrapAcceptance,
  beginShipDispatch,
  createWatchState,
  loadWatchState,
  persistWatchState,
  pollingDelayMs,
  probeReviewChange,
  recordShipResult,
  recordObservation,
  resumeWatch,
  stopWatch,
  watchAction,
} from './watch-state.mjs';
import { digestConfirmedLedger } from '../../../ship/_atoms/continuation-remediation/continuation-remediation.mjs';
import { evaluateHandoff } from '../../../ship/_atoms/shepherd-handoff/shepherd-handoff.mjs';
import {
  githubCheckRunsCommand,
  interpretGitHubCheckIdentities,
} from '../provider-state/provider-state.mjs';

function observation(overrides = {}) {
  return {
    identity: {
      provider: 'github',
      repository: 'jdylanmc/agent-skills',
      changeRequest: '157',
      issue: '102',
      branch: 'feature',
    },
    pullRequest: {
      state: 'open',
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      mergeState: 'mergeable',
      mergeStateStatus: 'clean',
      blocked: false,
      behind: false,
      isDraft: false,
      upToDatePolicy: 'not-required',
      reviewDecision: 'APPROVED',
    },
    review: {
      observed: true,
      complete: true,
      identityBound: true,
      observationDigest: '1'.repeat(64),
    },
    checks: [{ name: 'validate', runId: '91', nativeId: '101', attempt: 1, headSha: 'b'.repeat(40), required: true, status: 'success' }],
    ownership: { branchOwned: true, providerAvailable: true, evidenceComplete: true },
    ...overrides,
  };
}

function continuation(overrides = {}) {
  const ledger = {
    id: 'ledger-1',
    entries: [{ id: 'scope-1', class: 'in-scope', statement: 'keep the branch landable' }],
    alignment: 'confirmed',
  };
  ledger.digest = digestConfirmedLedger(ledger);
  const packet = {
    originalIssue: '102',
    changeRequest: {
      id: '157',
      issue: '102',
      branch: 'feature',
      provider: 'github',
      repository: 'jdylanmc/agent-skills',
    },
    ledger,
    priorDeliveryEvidence: {
      complete: true,
      issue: '102',
      changeRequest: '157',
      branch: 'feature',
      provider: 'github',
      repository: 'jdylanmc/agent-skills',
      head: 'b'.repeat(40),
      ledgerDigest: ledger.digest,
      reviewObservationDigest: '1'.repeat(64),
      reviewEvidenceIds: [],
      ciFailureIds: [],
    },
    handledEvidenceKeys: [],
  };
  return {
    ...packet,
    ...overrides,
    priorDeliveryEvidence: {
      ...packet.priorDeliveryEvidence,
      ...(overrides.priorDeliveryEvidence ?? {}),
    },
  };
}

test('polling decay follows the approved five-hour schedule', () => {
  const start = '2026-08-30T12:00:00.000Z';
  const at = (minutes) => new Date(Date.parse(start) + minutes * 60_000).toISOString();
  assert.equal(pollingDelayMs(start, at(0)), 2 * 60_000);
  assert.equal(pollingDelayMs(start, at(60)), 5 * 60_000);
  assert.equal(pollingDelayMs(start, at(120)), 10 * 60_000);
  assert.equal(pollingDelayMs(start, at(180)), 15 * 60_000);
  assert.equal(pollingDelayMs(start, at(240)), 30 * 60_000);
  assert.equal(pollingDelayMs(start, at(300)), 60 * 60_000);
});

test('green observations persist and wait instead of ending ownership', () => {
  const started = createWatchState({
    observation: observation(),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  const unchanged = recordObservation(started, {
    observation: observation(),
    observedAt: '2026-08-30T12:02:00.000Z',
  });
  assert.equal(unchanged.status, 'running');
  assert.equal(unchanged.lastChange.meaningful, false);
  assert.equal(watchAction(unchanged).action, 'wait');
  assert.equal(watchAction(started).action, 'wait');
});

test('an initial unwatermarked failure dispatches while the initial green state does not', () => {
  const failed = createWatchState({
    observation: observation({
      checks: [{ name: 'validate', runId: '91', nativeId: '101', attempt: 1, headSha: 'b'.repeat(40), required: true, status: 'failure' }],
    }),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  assert.equal(watchAction(failed).action, 'invoke-ship');
});

test('invalid or already terminal baselines never become running watches', () => {
  assert.throws(() => createWatchState({
    observation: observation({
      pullRequest: { ...observation().pullRequest, state: 'merged' },
    }),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  }), /only for an open change request/);
  assert.throws(() => createWatchState({
    observation: observation({
      pullRequest: { ...observation().pullRequest, baseSha: null },
    }),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  }), /base head/);
  assert.throws(() => createWatchState({
    observation: observation({
      checks: [{ name: 'validate', required: true, status: 'failure', headSha: 'b'.repeat(40) }],
    }),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  }), /provider-native run, check, and attempt/);
});

test('resume records an honest gap and observes immediately without resetting age', () => {
  const started = createWatchState({
    observation: observation(),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });

  test('every landability-driving provider field participates in change detection', () => {
    for (const [field, value] of [
      ['mergeStateStatus', 'blocked'],
      ['blocked', true],
      ['behind', true],
      ['isDraft', true],
      ['upToDatePolicy', 'required'],
    ]) {
      const started = createWatchState({
        observation: observation(),
        continuation: continuation(),
        observedAt: '2026-08-30T12:00:00.000Z',
      });
      const changed = recordObservation(started, {
        observation: observation({
          pullRequest: { ...observation().pullRequest, [field]: value },
        }),
        observedAt: '2026-08-30T12:02:00.000Z',
      });
      assert.equal(changed.lastChange.meaningful, true, field);
      assert.ok(changed.lastChange.fields.includes('pullRequest'), field);
    }
  });
  const resumed = resumeWatch(started, { resumedAt: '2026-08-30T14:30:00.000Z' });
  assert.deepEqual(resumed.gaps, [{
    from: '2026-08-30T12:00:00.000Z',
    to: '2026-08-30T14:30:00.000Z',
  }]);
  assert.equal(resumed.nextPollAt, '2026-08-30T14:30:00.000Z');
  const observed = recordObservation(resumed, {
    observation: observation(),
    observedAt: '2026-08-30T14:30:00.000Z',
  });
  assert.equal(observed.delayMs, 10 * 60_000);
});

test('review changes and failed required checks route to Ship', () => {
  const started = createWatchState({
    observation: observation(),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  const reviewChanged = recordObservation(started, {
    observation: observation({
      review: { observed: true, complete: true, identityBound: true, observationDigest: '2'.repeat(64) },
    }),
    observedAt: '2026-08-30T12:02:00.000Z',
  });
  assert.deepEqual(watchAction(reviewChanged), {
    action: 'invoke-ship',
    reason: 'new-review-or-check-evidence',
    evidence: [`review-packet:${'2'.repeat(64)}`],
  });

  const failed = recordObservation(started, {
    observation: observation({
      checks: [{ name: 'validate', runId: '91', nativeId: '101', attempt: 1, headSha: 'b'.repeat(40), required: true, status: 'failure' }],
    }),
    observedAt: '2026-08-30T12:02:00.000Z',
  });
  const failedAction = watchAction(failed);
  assert.equal(failedAction.action, 'invoke-ship');
  assert.equal(failedAction.reason, 'new-review-or-check-evidence');
  assert.equal(failedAction.evidence.length, 1);
  assert.match(failedAction.evidence[0], /^ci:/);

  const dispatching = beginShipDispatch(failed, {
    evidence: failedAction.evidence,
    startedAt: '2026-08-30T12:02:30.000Z',
  });
  const handled = recordShipResult(dispatching, {
    evidence: failedAction.evidence,
    shipResult: {
      status: 'shipped-to-review',
      mode: 'existing-change-request',
      resultingHead: 'b'.repeat(40),
      identity: failed.targetIdentity,
      continuation: continuation({
        priorDeliveryEvidence: {
          complete: true,
          ciFailureIds: failedAction.evidence.map((id) => id.slice('ci:'.length)),
        },
      }),
    },
    recordedAt: '2026-08-30T12:03:00.000Z',
  });
  const afterShip = recordObservation(handled, {
    observation: observation({
      checks: [{ name: 'validate', runId: '91', nativeId: '101', attempt: 1, headSha: 'b'.repeat(40), required: true, status: 'failure' }],
    }),
    observedAt: '2026-08-30T12:04:00.000Z',
  });
  assert.notEqual(watchAction(afterShip).action, 'invoke-ship');

  const resumed = resumeWatch(afterShip, { resumedAt: '2026-08-30T12:05:00.000Z' });
  const unchangedFailure = recordObservation(resumed, {
    observation: observation({
      checks: [{ name: 'validate', runId: '91', nativeId: '101', attempt: 1, headSha: 'b'.repeat(40), required: true, status: 'failure' }],
    }),
    observedAt: '2026-08-30T12:05:00.000Z',
  });
  assert.equal(watchAction(unchangedFailure).action, 'wait');

  const laterAttempt = recordObservation(unchangedFailure, {
    observation: observation({
      checks: [{ name: 'validate', runId: '91', nativeId: '101', attempt: 2, headSha: 'b'.repeat(40), required: true, status: 'failure' }],
    }),
    observedAt: '2026-08-30T12:07:00.000Z',
  });
  assert.equal(watchAction(laterAttempt).action, 'invoke-ship');
});

test('per-check watermarks do not replay an unchanged sibling failure', () => {
  const started = createWatchState({
    observation: observation(),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  const failed = recordObservation(started, {
    observation: observation({
      checks: [
        { name: 'a', runId: '92', nativeId: '201', attempt: 1, headSha: 'b'.repeat(40), required: true, status: 'failure' },
        { name: 'b', runId: '93', nativeId: '202', attempt: 1, headSha: 'b'.repeat(40), required: true, status: 'failure' },
      ],
    }),
    observedAt: '2026-08-30T12:02:00.000Z',
  });
  const action = watchAction(failed);
  assert.deepEqual([...action.evidence].sort(), [
    'ci:92/201/1',
    'ci:93/202/1',
  ].sort());
  const dispatching = beginShipDispatch(failed, {
    evidence: action.evidence,
    startedAt: '2026-08-30T12:02:30.000Z',
  });
  const handled = recordShipResult(dispatching, {
    evidence: action.evidence,
    shipResult: {
      status: 'shipped-to-review',
      mode: 'existing-change-request',
      resultingHead: 'b'.repeat(40),
      identity: failed.targetIdentity,
      continuation: continuation({
        priorDeliveryEvidence: {
          complete: true,
          ciFailureIds: action.evidence.map((id) => id.slice('ci:'.length)),
        },
      }),
    },
    recordedAt: '2026-08-30T12:03:00.000Z',
  });
  const oneResolved = recordObservation(handled, {
    observation: observation({
      checks: [
        { name: 'a', runId: '92', nativeId: '201', attempt: 1, headSha: 'b'.repeat(40), required: true, status: 'success' },
        { name: 'b', runId: '93', nativeId: '202', attempt: 1, headSha: 'b'.repeat(40), required: true, status: 'failure' },
      ],
    }),
    observedAt: '2026-08-30T12:04:00.000Z',
  });
  assert.notEqual(watchAction(oneResolved).action, 'invoke-ship');
});

test('head-changing Ship results persist a fresh continuation packet across resume', () => {
  const started = createWatchState({
    observation: observation(),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  const reviewChanged = recordObservation(started, {
    observation: observation({
      review: { observed: true, complete: true, identityBound: true, observationDigest: '2'.repeat(64) },
    }),
    observedAt: '2026-08-30T12:02:00.000Z',
  });
  const firstAction = watchAction(reviewChanged);
  const firstDispatch = beginShipDispatch(reviewChanged, {
    evidence: firstAction.evidence,
    startedAt: '2026-08-30T12:02:30.000Z',
  });
  const moved = recordShipResult(firstDispatch, {
    evidence: firstAction.evidence,
    shipResult: {
      status: 'shipped-to-review',
      mode: 'existing-change-request',
      resultingHead: 'c'.repeat(40),
      identity: reviewChanged.targetIdentity,
      continuation: continuation({
        priorDeliveryEvidence: {
          complete: true,
          head: 'c'.repeat(40),
          reviewObservationDigest: '2'.repeat(64),
          reviewEvidenceIds: [],
          ciFailureIds: [],
        },
      }),
    },
    recordedAt: '2026-08-30T12:03:00.000Z',
  });
  assert.equal(moved.expectedHead, 'c'.repeat(40));
  assert.equal(moved.continuation.priorDeliveryEvidence.head, 'c'.repeat(40));

  const resumed = resumeWatch(moved, { resumedAt: '2026-08-30T12:04:00.000Z' });
  const observed = recordObservation(resumed, {
    observation: observation({
      pullRequest: { ...observation().pullRequest, headSha: 'c'.repeat(40) },
      review: { observed: true, complete: true, identityBound: true, observationDigest: '3'.repeat(64) },
      checks: [{ name: 'validate', runId: '94', nativeId: '301', attempt: 1, headSha: 'c'.repeat(40), required: true, status: 'success' }],
    }),
    observedAt: '2026-08-30T12:04:00.000Z',
  });
  const secondAction = watchAction(observed);
  assert.equal(secondAction.action, 'invoke-ship');
  const secondDispatch = beginShipDispatch(observed, {
    evidence: secondAction.evidence,
    startedAt: '2026-08-30T12:04:30.000Z',
  });
  const movedAgain = recordShipResult(secondDispatch, {
    evidence: secondAction.evidence,
    shipResult: {
      status: 'shipped-to-review',
      mode: 'existing-change-request',
      resultingHead: 'd'.repeat(40),
      identity: observed.targetIdentity,
      continuation: continuation({
        priorDeliveryEvidence: {
          complete: true,
          head: 'd'.repeat(40),
          reviewObservationDigest: '3'.repeat(64),
          reviewEvidenceIds: [],
          ciFailureIds: [],
        },
      }),
    },
    recordedAt: '2026-08-30T12:05:00.000Z',
  });
  assert.equal(movedAgain.expectedHead, 'd'.repeat(40));
  assert.equal(movedAgain.shipReceipts.length, 2);
  assert.ok(firstAction.evidence.every((key) => movedAgain.handledEvidenceKeys.includes(key)));
});

test('merge, operator stop, ownership failure, and evidence failure stop honestly', () => {
  const started = createWatchState({
    observation: observation(),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  const merged = recordObservation(started, {
    observation: observation({ pullRequest: { ...observation().pullRequest, state: 'merged' } }),
    observedAt: '2026-08-30T12:02:00.000Z',
  });
  assert.equal(merged.status, 'stopped');
  assert.equal(merged.stopReason, 'change-request-merged');

  assert.equal(stopWatch(started, {
    reason: 'operator-stop',
    stoppedAt: '2026-08-30T12:01:00.000Z',
  }).stopReason, 'operator-stop');

  const ownership = recordObservation(started, {
    observation: observation({
      ownership: { branchOwned: false, providerAvailable: true, evidenceComplete: true },
    }),
    observedAt: '2026-08-30T12:02:00.000Z',
  });
  assert.deepEqual(watchAction(ownership), { action: 'stop', reason: 'ownership-failure' });

  const evidence = recordObservation(started, {
    observation: observation({
      review: { observed: true, complete: false, identityBound: true, observationDigest: null },
    }),
    observedAt: '2026-08-30T12:02:00.000Z',
  });
  assert.deepEqual(watchAction(evidence), { action: 'stop', reason: 'evidence-failure' });
});

test('durable state is atomically persisted and reread', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shepherd-watch-'));
  const statePath = path.join(root, 'watch.json');
  const state = createWatchState({
    observation: observation(),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  const receipt = persistWatchState(statePath, state);
  assert.equal(receipt.path, statePath);
  assert.deepEqual(loadWatchState(statePath), state);
  assert.throws(() => persistWatchState(statePath, state), /changed since the caller read it/);

  const stale = { ...state, status: 'stopped' };
  assert.throws(() => persistWatchState(path.join(root, 'stale.json'), stale), /integrity digest is stale/);

  const recoveredPath = path.join(root, 'recovered.json');
  fs.writeFileSync(`${recoveredPath}.lock`, '999999999\n');
  assert.equal(persistWatchState(recoveredPath, state).path, recoveredPath);

  const tampered = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  tampered.targetIdentity.branch = 'other';
  fs.writeFileSync(statePath, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(() => loadWatchState(statePath), /integrity digest/);
});

test('handoff bootstrap accepts only a running worker bound to exact identity and state', () => {
  const state = createWatchState({
    observation: observation(),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  const accepted = bootstrapAcceptance(state, {
    workerStatus: 'running',
    acceptedIdentity: state.targetIdentity,
    acceptedStateDigest: state.integrityDigest,
    disposition: 'mergeable-and-green',
    receipt: {
      observedAt: '2026-08-30T12:00:00.000Z',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      upToDatePolicy: 'not-required',
      provider: 'supported-provider',
      complete: true,
    },
  });
  assert.equal(accepted.status, 'returned');
  assert.equal(accepted.result.disposition, 'mergeable-and-green');
  assert.equal(accepted.result.watch.status, 'watch-accepted');
  const handoff = evaluateHandoff({
    publication: { outcome: 'published', identifier: '157' },
    intent: 'yes',
    target: {
      changeRequest: '157',
      headBranch: 'feature',
      headSha: 'b'.repeat(40),
      baseBranch: 'main',
      baseSha: 'a'.repeat(40),
      upToDatePolicy: 'not-required',
      receipt: {
        observedAt: '2026-08-30T12:00:00.000Z',
        baseSha: 'a'.repeat(40),
        headSha: 'b'.repeat(40),
      },
    },
    invocation: { mode: 'nested-worker', status: accepted.status },
    result: accepted.result,
    observedBase: {
      observedAt: '2026-08-30T12:00:01.000Z',
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
    },
  });
  assert.equal(handoff.handoff, 'completed');
  assert.deepEqual(bootstrapAcceptance(state, {
    workerStatus: 'failed',
    acceptedIdentity: state.targetIdentity,
    acceptedStateDigest: state.integrityDigest,
  }), {
    status: 'failed',
    result: null,
    reason: 'watch-worker-acceptance-unproven',
  });
});

test('a persisted in-flight Ship dispatch cannot be duplicated after resume', () => {
  const started = createWatchState({
    observation: observation({
      review: { observed: true, complete: true, identityBound: true, observationDigest: '2'.repeat(64) },
    }),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  const action = watchAction(started);
  const dispatching = beginShipDispatch(started, {
    evidence: action.evidence,
    startedAt: '2026-08-30T12:00:30.000Z',
  });
  const resumed = resumeWatch(dispatching, { resumedAt: '2026-08-30T12:05:00.000Z' });
  assert.deepEqual(watchAction(resumed), { action: 'stop', reason: 'ship-blocked' });
});

test('review probe reuses Ship normalization but exposes no comment bodies', () => {
  const payload = [{
    data: {
      repository: {
        pullRequest: {
          reviewDecision: 'APPROVED',
          latestOpinionatedReviews: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [],
          },
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{
              id: 'thread-1',
              isResolved: false,
              isOutdated: false,
              path: 'src/a.js',
              line: 1,
              comments: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [{ id: 'comment-1', author: { login: 'reviewer' }, body: 'untrusted body', createdAt: 'now', url: null }],
              },
            }],
          },
        },
      },
    },
  }];
  const result = probeReviewChange(
    { status: 'supported-provider', provider: 'github', tool: 'gh' },
    payload,
    { repository: 'jdylanmc/agent-skills', changeRequest: 157 },
  );
  assert.equal(result.complete, true);
  assert.equal(result.unresolvedThreadCount, 1);
  assert.equal(JSON.stringify(result).includes('untrusted body'), false);
});

test('provider-native GitHub checks produce Ship-compatible per-attempt identity', () => {
  const detection = { status: 'supported-provider', provider: 'github', tool: 'gh' };
  const headSha = 'b'.repeat(40);
  assert.equal(githubCheckRunsCommand(detection, {
    repository: 'jdylanmc/agent-skills',
    headSha,
    changeRequest: 157,
  }).operation, 'read-check-identities');
  const enterprise = githubCheckRunsCommand({
    status: 'supported-provider',
    provider: 'github',
    tool: 'gh',
    host: 'github.example.com',
  }, {
    repository: 'jdylanmc/agent-skills',
    headSha,
    changeRequest: 157,
  });
  assert.ok(enterprise.args.includes('owner=jdylanmc'));
  assert.ok(enterprise.args.includes('name=agent-skills'));

  const interpreted = interpretGitHubCheckIdentities({
    data: {
      repository: {
        object: {
          oid: headSha,
          statusCheckRollup: {
            contexts: {
              pageInfo: { hasNextPage: false },
              nodes: [{
                __typename: 'CheckRun',
                databaseId: 7001,
                name: 'validate',
                status: 'COMPLETED',
                conclusion: 'FAILURE',
                detailsUrl: 'https://github.com/jdylanmc/agent-skills/actions/runs/9001/job/8001',
                isRequired: true,
                checkSuite: {
                  workflowRun: {
                    databaseId: 9001,
                    runAttempt: 2,
                    headSha,
                  },
                },
              }],
            },
          },
        },
      },
    },
  }, { headSha });

  assert.equal(interpreted.complete, true);
  assert.deepEqual(interpreted.checks[0], {
    name: 'validate',
    nativeId: '7001',
    runId: '9001',
    attempt: 2,
    headSha,
    required: true,
    status: 'failure',
    url: 'https://github.com/jdylanmc/agent-skills/actions/runs/9001/job/8001',
  });
});
