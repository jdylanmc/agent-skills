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
  recordMaintainedHead,
  resumeWatch,
  stopWatch,
  watchAction,
  watchBaseCommand,
  projectWatchIdentity,
} from './watch-state.mjs';
import { digestConfirmedLedger } from '../../../ship/_atoms/continuation-remediation/continuation-remediation.mjs';
import { evaluateHandoff } from '../../../ship/_atoms/shepherd-handoff/shepherd-handoff.mjs';
import {
  githubCheckRunsCommand,
  interpretGitHubCheckIdentities,
  interpretLiveBase,
  interpretTarget,
} from '../provider-state/provider-state.mjs';

function observation(overrides = {}) {
  const checks = overrides.checks ?? [{ name: 'validate', runId: '91', nativeId: '101', attempt: 1,
    headSha: 'b'.repeat(40), required: true, status: 'success' }];
  return {
    identity: {
      provider: 'github',
      repository: 'jdylanmc/agent-skills',
      changeRequest: '157',
      issue: '102',
      branch: 'feature',
      baseBranch: 'main',
      headRepository: 'jdylanmc/agent-skills',
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
    checks,
    liveBase: { observed: true, identityBound: true, repository: 'jdylanmc/agent-skills',
      ref: 'refs/heads/main', sha: 'a'.repeat(40), observedAt: '2026-08-30T12:00:00.000Z' },
    ownership: { branchOwned: true, providerAvailable: true, evidenceComplete: true },
    ...overrides,
    checkEvidence: { observed: true, complete: true, headSha: overrides.pullRequest?.headSha ?? 'b'.repeat(40),
      requiredChecks: [{ name: 'validate', appId: null }], checks, ...overrides.checkEvidence },
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
      headRepository: 'jdylanmc/agent-skills',
      baseBranch: 'main',
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

test('resolved provider metadata projects to canonical immutable watch and continuation identity', () => {
  const detection = { status: 'supported-provider', provider: 'github', tool: 'gh' };
  const resolved = interpretTarget(detection, {
    headRefName: 'feature', baseRefName: 'main', headRefOid: 'b'.repeat(40),
    headRepositoryOwner: { login: 'jdylanmc' },
    headRepository: { name: 'agent-skills', nameWithOwner: 'jdylanmc/agent-skills' },
    isCrossRepository: false, isDraft: false,
  });
  const identity = projectWatchIdentity(resolved, {
    detection, repository: 'jdylanmc/agent-skills', changeRequest: '157', issue: '102',
  });
  const state = createWatchState({
    observation: observation({ identity }), continuation: continuation(),
    observedAt: '2026-08-30T12:00:00Z',
  });
  assert.deepEqual(state.targetIdentity, identity);
  assert.equal(typeof state.continuation.changeRequest.headRepository, 'string');
  assert.equal(state.targetIdentity.headRepository, 'jdylanmc/agent-skills');
  const enterprise = projectWatchIdentity(resolved, {
    detection: { ...detection, host: 'github.example.com' },
    repository: 'jdylanmc/agent-skills', changeRequest: '157',
  });
  assert.equal(enterprise.repository, 'github.example.com/jdylanmc/agent-skills');
  assert.equal(enterprise.headRepository, 'github.example.com/jdylanmc/agent-skills');
  assert.throws(() => projectWatchIdentity({ ...resolved, headRepository: {} }, {
    detection, repository: 'jdylanmc/agent-skills', changeRequest: '157',
  }), /resolved head repository/);
});

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

test('watch observations use the live ref rather than historical PR base metadata', () => {
  const detection = { status: 'supported-provider', provider: 'github', tool: 'gh' };
  const raw = observation();
  assert.ok(watchBaseCommand(detection, raw).args.includes('ref=refs/heads/main'));
  const liveBase = interpretLiveBase(detection, { data: { repository: {
    nameWithOwner: raw.identity.repository,
    ref: { name: 'main', prefix: 'refs/heads/', target: { oid: 'c'.repeat(40) } },
  } } }, { repository: raw.identity.repository, baseBranch: 'main', observedAt: '2026-08-30T12:00:00.000Z' });
  const state = createWatchState({ observation: { ...raw, liveBase }, continuation: continuation(), observedAt: '2026-08-30T12:00:00.000Z' });
  assert.equal(state.observation.pullRequest.baseSha, 'c'.repeat(40));
  const unchanged = recordObservation(state, { observation: { ...raw, liveBase: { ...liveBase, observedAt: '2026-08-30T12:02:00.000Z' } }, observedAt: '2026-08-30T12:02:00.000Z' });
  assert.equal(unchanged.lastChange.meaningful, false, 'read timestamps alone do not trigger maintenance');
  const moved = recordObservation(unchanged, { observation: { ...raw, liveBase: { ...liveBase, sha: 'd'.repeat(40) } }, observedAt: '2026-08-30T12:04:00.000Z' });
  assert.ok(moved.lastChange.fields.includes('liveBase'));
});

test('normal maintenance push retains captured-head and continuation guards', () => {
  const state = createWatchState({ observation: observation(), continuation: continuation(), observedAt: '2026-08-30T12:00:00.000Z' });
  const receipt = {
    previousHead: state.expectedHead, resultingHead: 'c'.repeat(40),
    pushReceipt: { status: 'pushed', capturedHeadVerified: true,
      repository: 'jdylanmc/agent-skills', ref: 'refs/heads/feature',
      previousHead: state.expectedHead, headSha: 'c'.repeat(40), strategy: 'merge-base-into-head' },
    continuation: continuation({ priorDeliveryEvidence: { head: 'c'.repeat(40) } }),
    recordedAt: '2026-08-30T12:02:00.000Z',
  };
  const maintained = recordMaintainedHead(state, receipt);
  assert.equal(maintained.expectedHead, receipt.resultingHead);
  assert.equal(maintained.maintenanceReceipt.pushReceipt.status, 'pushed');
  assert.equal(maintained.maintenanceReceipt.pushReceipt.capturedHeadVerified, true);
  assert.equal(recordMaintainedHead(state, { ...receipt,
    pushReceipt: { ...receipt.pushReceipt, capturedHeadVerified: false } }).stopReason, 'ownership-failure');
  assert.equal(recordMaintainedHead(state, { ...receipt, previousHead: 'd'.repeat(40) }).stopReason, 'ownership-failure');
});

test('leased maintenance requires the actual successful destination-bound receipt', () => {
  const state = createWatchState({ observation: observation(), continuation: continuation(), observedAt: '2026-08-30T12:00:00Z' });
  const receipt = {
    previousHead: state.expectedHead, resultingHead: 'c'.repeat(40),
    continuation: continuation({ priorDeliveryEvidence: { head: 'c'.repeat(40) } }),
    recordedAt: '2026-08-30T12:02:00Z',
    pushReceipt: { status: 'pushed-with-lease', strategy: 'rebase',
      repository: 'jdylanmc/agent-skills', ref: 'refs/heads/feature',
      previousHead: state.expectedHead, headSha: 'c'.repeat(40),
      capturedHeadVerified: true, leaseVerified: true,
      lease: { ref: 'refs/heads/feature', expectedHead: state.expectedHead } },
  };
  assert.equal(recordMaintainedHead(state, receipt).expectedHead, 'c'.repeat(40));
  assert.equal(recordMaintainedHead(state, { ...receipt, pushReceipt: undefined, leaseVerified: true }).stopReason, 'ownership-failure');
  assert.equal(recordMaintainedHead(state, { ...receipt,
    pushReceipt: { ...receipt.pushReceipt, status: 'failed' } }).stopReason, 'ownership-failure');
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

test('an already behind or conflicted initial branch starts maintenance without waiting for drift', () => {
  for (const change of [
    { behind: true, upToDatePolicy: 'required' },
    { mergeState: 'conflicted', mergeStateStatus: 'dirty' },
  ]) {
    const state = createWatchState({
      observation: observation({ pullRequest: { ...observation().pullRequest, ...change } }),
      continuation: continuation(),
      observedAt: '2026-08-30T12:00:00.000Z',
    });
    assert.equal(watchAction(state).action, 'run-shepherd-cycle');
  }
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

test('mechanical prerequisites precede mixed functional evidence', () => {
  const raw = observation({
    pullRequest: { ...observation().pullRequest, behind: true, upToDatePolicy: 'required' },
    checks: [{ name: 'validate', runId: '91', nativeId: '101', attempt: 1,
      headSha: 'b'.repeat(40), required: true, status: 'failure' }],
  });
  const state = createWatchState({ observation: raw, continuation: continuation(), observedAt: '2026-08-30T12:00:00Z' });
  assert.equal(watchAction(state).action, 'run-shepherd-cycle');
  assert.equal(beginShipDispatch(state, { evidence: ['ci:91/101/1'], startedAt: '2026-08-30T12:00:00Z' }).stopReason, 'ship-blocked');
});

test('full watches reject split check payloads, incomplete reads and missing requiredness', () => {
  for (const change of [
    (raw) => { raw.checkEvidence = { ...raw.checkEvidence, checks: [] }; },
    (raw) => { raw.checkEvidence.complete = false; },
    (raw) => { raw.checkEvidence.observed = false; },
    (raw) => { raw.checkEvidence.headSha = 'c'.repeat(40); },
    (raw) => { delete raw.checks[0].required; },
  ]) {
    const raw = observation();
    change(raw);
    assert.throws(() => createWatchState({ observation: raw, continuation: continuation(),
      observedAt: '2026-08-30T12:00:00Z' }), /check evidence|check requiredness/);
  }
});

test('base retargets and head repository changes stop either authority mode', () => {
  const raw = observation();
  for (const limited of [false, true]) {
    const state = createWatchState({
      observation: raw, observedAt: '2026-08-30T12:00:00Z',
      ...(limited ? { readAuthority: { source: 'operator-explicit-target', owningParent: 'parent',
        targetIdentity: raw.identity } } : { continuation: continuation() }),
    });
    for (const updated of [
      observation({ pullRequest: { ...raw.pullRequest, baseBranch: 'release' } }),
      observation({ identity: { ...raw.identity, headRepository: 'other/repo' } }),
    ]) {
      assert.equal(recordObservation(state, { observation: updated,
        observedAt: '2026-08-30T12:02:00Z' }).stopReason, 'ownership-failure');
    }
    assert.equal(watchAction({ ...state, authority: { mode: 'unrecognized' } }).reason, 'ownership-failure');
  }
});

test('invalid or already terminal baselines never become running watches', () => {
  assert.throws(() => createWatchState({
    observation: observation({
      pullRequest: { ...observation().pullRequest, state: 'merged' },
    }),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  }), /only for an open change request/);
  const unreadBase = createWatchState({
    observation: observation({
      liveBase: null,
    }),
    continuation: continuation(),
    observedAt: '2026-08-30T12:00:00.000Z',
  });
  assert.equal(unreadBase.observation.pullRequest.baseSha, null);
  assert.equal(watchAction(unreadBase).reason, 'evidence-failure');
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
      checkEvidence: { requiredChecks: [{ name: 'a', appId: null }, { name: 'b', appId: null }] },
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
      checkEvidence: { requiredChecks: [{ name: 'a', appId: null }, { name: 'b', appId: null }] },
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
    baseBranch: 'main',
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
    baseBranch: 'main',
    headSha,
    changeRequest: 157,
  });
  assert.ok(enterprise.args.includes('owner=jdylanmc'));
  assert.ok(enterprise.args.includes('name=agent-skills'));

  const interpreted = interpretGitHubCheckIdentities({
    data: {
      repository: {
        nameWithOwner: 'jdylanmc/agent-skills',
        squashMergeAllowed: true,
        ref: {
          name: 'main', prefix: 'refs/heads/', target: { oid: 'a'.repeat(40) },
          branchProtectionRule: {
            allowsForcePushes: false, requiresLinearHistory: false,
            requiresStatusChecks: true, requiresStrictStatusChecks: true,
            lockBranch: false, restrictsPushes: false, requiresApprovingReviews: false,
            requiredStatusChecks: [{ context: 'validate', app: null }],
          },
          rules: { pageInfo: { hasNextPage: false }, nodes: [] },
        },
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
  }, { headSha, repository: 'jdylanmc/agent-skills', baseBranch: 'main' });

  assert.equal(interpreted.complete, true);
  assert.deepEqual(interpreted.checks[0], {
    name: 'validate',
    nativeId: '7001',
    runId: '9001',
    workflowId: null,
    runNumber: null,
    attempt: 2,
    headSha,
    required: true,
    appId: null,
    untrusted: true,
    status: 'failure',
    url: 'https://github.com/jdylanmc/agent-skills/actions/runs/9001/job/8001',
  });
});

test('missing Ship context permits durable observation only, never a remediation handoff', () => {
    const initial = observation({
      identity: { ...observation().identity, issue: null },
      liveBase: null,
      review: {},
      checks: [{ name: 'ci', status: 'failure', required: true, headSha: 'b'.repeat(40) }],
      ownership: { providerAvailable: true },
    });
    const args = {
      observation: initial, observedAt: '2026-08-30T12:00:00.000Z',
      readAuthority: { source: 'operator-explicit-target', owningParent: 'parent-session', targetIdentity: initial.identity },
    };
    const state = createWatchState(args);
    assert.equal(state.authority.mode, 'observation-only');
    assert.equal(state.continuation, null);
    assert.equal(watchAction(state).action, 'notify-parent');
    assert.equal(beginShipDispatch(state, { evidence: ['ci:1/2/1'], startedAt: args.observedAt }).stopReason, 'ship-blocked');
    assert.throws(() => createWatchState({ ...args, observation: observation(), continuation: {} }), /continuation context/);
    assert.throws(() => createWatchState({ ...args, readAuthority: undefined }), /read authority/);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shepherd-limited-'));
    try {
      const file = path.join(root, 'watch.json');
      persistWatchState(file, state);
      const loaded = loadWatchState(file);
      const resumed = resumeWatch(loaded, { resumedAt: '2026-08-30T13:00:00.000Z' });
      assert.equal(resumed.gaps.length, 1);
      const unchanged = recordObservation(resumed, { observation: initial, observedAt: '2026-08-30T13:00:00.000Z' });
      assert.equal(watchAction(unchanged).action, 'wait');
      const changed = recordObservation(unchanged, { observation: { ...initial, review: { observationDigest: '2'.repeat(64) } }, observedAt: '2026-08-30T13:05:00.000Z' });
      assert.equal(watchAction(changed).action, 'notify-parent');
      assert.equal(recordObservation(changed, { observation: { ...initial, pullRequest: { ...initial.pullRequest, state: 'merged' } }, observedAt: '2026-08-30T13:10:00.000Z' }).stopReason, 'change-request-merged');
      const accepted = bootstrapAcceptance(state, {
        workerStatus: 'running', acceptedIdentity: state.targetIdentity,
        acceptedStateDigest: state.integrityDigest, disposition: 'mergeable-and-green',
      });
      assert.equal(accepted.status, 'observation-only');
      assert.equal(accepted.result.disposition, 'blocked');
      assert.equal(accepted.result.authority.provenance, 'operator-explicit-target');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

test('observation-only watch follows a new PR head without acquiring mutation authority', () => {
  const initial = observation();
  const state = createWatchState({
    observation: initial,
    observedAt: '2026-08-30T12:00:00.000Z',
    readAuthority: {
      source: 'operator-explicit-target', owningParent: 'parent-session',
      targetIdentity: initial.identity,
    },
  });
  const headSha = 'c'.repeat(40);
  const updated = {
    ...initial,
    pullRequest: { ...initial.pullRequest, headSha },
    checks: [{ ...initial.checks[0], headSha, status: 'pending' }],
    checkEvidence: { observed: true, complete: true, headSha },
  };
  const changed = recordObservation(state, {
    observation: updated, observedAt: '2026-08-30T12:02:00.000Z',
  });
  assert.equal(changed.status, 'running');
  assert.equal(changed.expectedHead, headSha);
  assert.equal(changed.continuation, null);
  assert.equal(watchAction(changed).action, 'notify-parent');
  assert.equal(beginShipDispatch(changed, {
    evidence: ['ci:91/101/1'], startedAt: changed.lastObservedAt,
  }).stopReason, 'ship-blocked');
  const merged = recordObservation(changed, {
    observation: { ...updated, pullRequest: { ...updated.pullRequest, state: 'merged' } },
    observedAt: '2026-08-30T12:04:00.000Z',
  });
  assert.equal(merged.stopReason, 'change-request-merged');
});

test('bootstrap refuses optimistic green labels for failed or unobserved current checks', () => {
    for (const overrides of [
      { checks: [{ ...observation().checks[0], status: 'pending' }] },
      { checks: [{ ...observation().checks[0], status: 'failure' }] },
      { checks: [{ ...observation().checks[0], status: 'cancelled' }] },
      { checks: [] }, { liveBase: null },
    ]) {
      const state = createWatchState({ observation: observation(overrides), continuation: continuation(), observedAt: '2026-08-30T12:00:00.000Z' });
      const result = bootstrapAcceptance(state, {
        workerStatus: 'running', acceptedIdentity: state.targetIdentity, acceptedStateDigest: state.integrityDigest,
        disposition: 'mergeable-and-green', receipt: { observedAt: state.lastObservedAt, baseSha: 'a'.repeat(40),
          headSha: state.expectedHead, upToDatePolicy: 'not-required', complete: true },
      });
      assert.equal(result.status, 'failed');
    }
});
