/**
 * Contract test for the mergeability seam.
 *
 * The regression this guards is a real provider reading reaching a green
 * disposition after its blocking signals were observed and then dropped. It
 * runs an actual `interpretMergeState` output through the shared
 * `normalizeMergeabilitySignal` and into `classifyTerminalDisposition`, and
 * asserts that a GitHub change request the provider reports as blocked or
 * review-required ends on `needs-human` rather than `mergeable-and-green`.
 *
 * The signal is produced by one skill and consumed by another, so pinning the
 * translation between them here — rather than trusting each side's private copy
 * — is the point.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { detectProvider } from '../../../_base/_atoms/provider-detect/provider-detect.mjs';
import { interpretMergeState, mergeStateCommand, normalizeMergeabilitySignal, resolveTargetCommand } from '../provider-state/provider-state.mjs';
import { classifyTerminalDisposition } from './shepherd-disposition.mjs';

const READY = { available: true, authenticated: true };
const GITHUB = detectProvider({
  remoteUrls: ['https://github.com/example/repo.git'],
  toolAvailability: { gh: READY },
});

// The commits the reading is taken against must match the rebase base and the
// pushed head, or the disposition blocks as stale before it ever weighs the
// blocking signals. That is what makes this an end-to-end contract.
const BASE_SHA = 'base000';
const HEAD_SHA = 'head000';

function greenSignalsWith(mergeability) {
  return {
    provider: { status: 'supported-provider', provider: 'github' },
    observedAt: '2026-08-28T00:00:00Z',
    preflight: { status: 'ok' },
    rebase: { status: 'completed', baseSha: BASE_SHA },
    regeneration: { status: 'completed' },
    localValidation: { status: 'passed', evidenceComplete: true },
    push: { status: 'pushed-with-lease', headSha: HEAD_SHA },
    remoteChecks: { checks: [{ name: 'validate', status: 'success' }] },
    mergeability,
  };
}

function signalFor(payload) {
  return normalizeMergeabilitySignal(interpretMergeState(GITHUB, payload));
}

test('a provider-blocked change request reaches needs-human, never mergeable-and-green', () => {
  const mergeability = signalFor({
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    reviewDecision: 'REVIEW_REQUIRED',
    baseRefOid: BASE_SHA,
    headRefOid: HEAD_SHA,
  });

  // The content still merges, but the block and the required review are carried
  // explicitly rather than folded into the content state.
  assert.equal(mergeability.state, 'mergeable');
  assert.equal(mergeability.blocked, true);
  assert.equal(mergeability.reviewDecision, 'review-required');

  const result = classifyTerminalDisposition(greenSignalsWith(mergeability));
  assert.equal(result.disposition, 'needs-human');
  assert.notEqual(result.disposition, 'mergeable-and-green');
});

test('a change request whose only defect is a required review is handed to a person', () => {
  const mergeability = signalFor({
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'CHANGES_REQUESTED',
    baseRefOid: BASE_SHA,
    headRefOid: HEAD_SHA,
  });

  const result = classifyTerminalDisposition(greenSignalsWith(mergeability));
  assert.equal(result.disposition, 'needs-human');
  assert.equal(result.reason, 'review-changes-requested');
});

test('a genuinely clean, approved reading still reaches mergeable-and-green through the seam', () => {
  const mergeability = signalFor({
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    reviewDecision: 'APPROVED',
    baseRefOid: BASE_SHA,
    headRefOid: HEAD_SHA,
  });

  assert.equal(mergeability.blocked, false);
  assert.equal(mergeability.reviewDecision, 'approved');

  const result = classifyTerminalDisposition(greenSignalsWith(mergeability));
  assert.equal(result.disposition, 'mergeable-and-green');
});

test('a reading whose merge-block state is unobserved is blocked, never mergeable-and-green', () => {
  // GitHub `mergeStateStatus: UNKNOWN` means the provider has not computed the
  // merge gate, so `blocked` comes through as null. Content-mergeable, approved,
  // and CI-green as it is, an unobserved merge-block state must not read as clean.
  const mergeability = signalFor({
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'UNKNOWN',
    reviewDecision: 'APPROVED',
    baseRefOid: BASE_SHA,
    headRefOid: HEAD_SHA,
  });

  assert.equal(mergeability.state, 'mergeable');
  assert.equal(mergeability.blocked, null, 'UNKNOWN leaves the merge-block state unobserved');
  assert.equal(mergeability.reviewDecision, 'approved');

  const result = classifyTerminalDisposition(greenSignalsWith(mergeability));
  assert.equal(result.disposition, 'blocked');
  assert.equal(result.reason, 'merge-block-state-unobserved');
  assert.notEqual(result.disposition, 'mergeable-and-green');
});

test('the full chain from detection through a provider-native blocked payload lands on needs-human', () => {
  // One test body spanning detection -> command -> provider-native response ->
  // interpreter -> disposition, on real payload shapes.
  const detection = detectProvider({
    remoteUrls: ['https://github.contoso-internal.example/example/repo.git'],
    hostProviders: { 'github.contoso-internal.example': 'github' },
    toolAvailability: { gh: READY },
  });
  assert.equal(detection.status, 'supported-provider');
  assert.equal(detection.host, 'github.contoso-internal.example');

  const target = { changeRequest: 77, repository: { slug: 'example/repo' } };
  for (const command of [mergeStateCommand(detection, target), resolveTargetCommand(detection, target)]) {
    assert.equal(command.tool, 'gh');
    const repoIndex = command.args.indexOf('--repo');
    assert.ok(repoIndex >= 0, 'the read is scoped to a repository');
    assert.ok(
      command.args[repoIndex + 1].includes(detection.host),
      'the canonical host is carried into the read command',
    );
  }

  // A provider-native `gh pr view --json` payload: content merges, but the
  // change request is blocked by a required review.
  const payload = {
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'BLOCKED',
    reviewDecision: 'REVIEW_REQUIRED',
    baseRefOid: BASE_SHA,
    headRefOid: HEAD_SHA,
    isDraft: false,
  };
  const signal = normalizeMergeabilitySignal(interpretMergeState(detection, payload));
  const result = classifyTerminalDisposition(greenSignalsWith(signal));
  assert.equal(result.disposition, 'needs-human');
  assert.notEqual(result.disposition, 'mergeable-and-green');
});
