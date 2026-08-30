/**
 * Deterministic intake and routing for continuing one existing change request.
 *
 * Semantic classification is supplied by the caller after reading the evidence
 * against the confirmed ledger. This helper verifies that every new evidence
 * item is classified exactly once, that an in-scope classification names a
 * confirmed ledger entry, and that untrusted bodies never become control data.
 */

import crypto from 'node:crypto';

const REMEDIATION = new Set(['in-scope-functional', 'in-scope-test']);
const SHEPHERD = new Set([
  'shepherd-rebase',
  'shepherd-mechanical-conflict',
  'shepherd-regeneration',
]);
const HUMAN = new Set([
  'out-of-scope',
  'architecture',
  'product',
  'requirement',
  'accepted-risk',
]);
const INFORMATIONAL = 'informational';
const CLASSIFICATIONS = new Set([
  ...REMEDIATION,
  ...SHEPHERD,
  ...HUMAN,
  INFORMATIONAL,
]);

export const REMEDIATION_STAGES = Object.freeze([
  'fresh-implementation-context',
  'diff-reconciliation',
  'run-ci',
  'roast',
  'criterion-verdicts',
  'update-existing-change-request',
]);

function refusal(reason, details = {}) {
  return {
    accepted: false,
    state: 'refused',
    reason,
    ...details,
  };
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function sha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function gitObjectId(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

export function digestConfirmedLedger({ id, entries } = {}) {
  if (!nonEmpty(id) || !Array.isArray(entries)) {
    return null;
  }
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical({ id, entries })), 'utf8')
    .digest('hex');
}

function digestState(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)), 'utf8')
    .digest('hex');
}

function collectReviewEvidence(review) {
  if (review?.observed !== true || !Array.isArray(review.threads)) {
    return refusal('review-unread');
  }
  if (review.complete !== true || !Array.isArray(review.verdicts)) {
    return refusal('review-partial', {
      incomplete: Array.isArray(review.incomplete) ? review.incomplete : [],
    });
  }
  if (review.operation !== 'unresolved-review-threads') {
    return refusal('review-operation-invalid');
  }
  if (!sha256(review.observationDigest)) {
    return refusal('review-observation-digest-missing');
  }
  const evidence = [];
  for (const thread of review.threads) {
    const threadId = thread?.id;
    if (!nonEmpty(String(threadId ?? ''))) {
      return refusal('review-identity-missing');
    }
    if (thread?.untrusted !== true || !Array.isArray(thread?.comments)) {
      return refusal('review-content-not-contained', { evidenceId: `review:${threadId}` });
    }
    if (thread.comments.some((comment) => comment?.untrusted !== true)) {
      return refusal('review-content-not-contained', { evidenceId: `review:${threadId}` });
    }
    const threadState = digestState({
      id: String(threadId),
      path: thread.path ?? null,
      line: thread.line ?? null,
      isResolved: thread.isResolved ?? null,
      isOutdated: thread.isOutdated ?? null,
    });
    evidence.push({
      key: `review:thread/${threadId}/${threadState}`,
      source: 'review',
      raw: thread,
    });
    for (const comment of thread.comments) {
      if (!nonEmpty(String(comment?.id ?? ''))) {
        return refusal('review-identity-missing', { threadId: String(threadId) });
      }
      const commentState = digestState({
        threadId: String(threadId),
        id: String(comment.id),
        author: comment.author ?? null,
        body: comment.body ?? null,
        createdAt: comment.createdAt ?? null,
        url: comment.url ?? null,
      });
      evidence.push({
        key: `review:thread/${threadId}/comment/${comment.id}/${commentState}`,
        source: 'review',
        raw: { thread, comment },
      });
    }
  }
  for (const verdict of review.verdicts) {
    if (!nonEmpty(String(verdict?.id ?? ''))) {
      return refusal('review-identity-missing');
    }
    if (verdict?.untrusted !== true || typeof verdict?.gatesMerge !== 'boolean') {
      return refusal('review-content-not-contained', { evidenceId: `review:verdict/${verdict.id}` });
    }
    const verdictState = digestState({
      id: String(verdict.id),
      state: verdict.state ?? null,
      author: verdict.author ?? null,
      body: verdict.body ?? null,
      submittedAt: verdict.submittedAt ?? null,
      url: verdict.url ?? null,
      gatesMerge: verdict.gatesMerge,
    });
    evidence.push({
      key: `review:verdict/${verdict.id}/${verdictState}`,
      source: 'review',
      raw: verdict,
    });
  }
  return { accepted: true, evidence };
}

function collectCiEvidence(ci, capturedHead) {
  if (ci?.observed !== true || ci?.complete !== true || !Array.isArray(ci?.failures)) {
    return refusal('ci-evidence-unread-or-partial');
  }

  const evidence = [];
  for (const failure of ci.failures) {
    if (
      !nonEmpty(String(failure?.runId ?? ''))
      || !nonEmpty(String(failure?.checkId ?? ''))
      || !Number.isInteger(failure?.attempt)
      || failure.attempt < 1
    ) {
      return refusal('ci-evidence-identity-missing');
    }
    const key = `ci:${failure.runId}/${failure.checkId}/${failure.attempt}`;
    if (failure.head !== capturedHead) {
      return refusal('ci-evidence-head-mismatch', { evidenceId: key });
    }
    if (failure?.untrusted !== true) {
      return refusal('ci-content-not-contained', { evidenceId: key });
    }
    evidence.push({ key, source: 'ci', raw: failure });
  }
  return { accepted: true, evidence };
}

function forbiddenAuthorityRequested(input) {
  return [
    'replaceChangeRequest',
    'changeIssueIdentity',
    'replyToReviewThread',
    'resolveReviewThread',
    'mutateReviewThread',
    'merge',
    'approve',
    'acceptRisk',
  ].filter((field) => input?.requestedActions?.[field] === true);
}

/**
 * Accept one snapshot-bound continuation and route its newly observed evidence.
 */
export function evaluateContinuation({
  originalIssue,
  changeRequests,
  ledger,
  capturedHead,
  observedHead,
  priorDeliveryEvidence,
  review,
  ci,
  classifications = [],
  requestedActions = {},
} = {}) {
  const requests = Array.isArray(changeRequests) ? changeRequests : [];
  if (requests.length !== 1) {
    return refusal('change-request-count', { expected: 1, actual: requests.length });
  }

  const changeRequest = requests[0] ?? {};
  if (!nonEmpty(originalIssue) || changeRequest.issue !== originalIssue) {
    return refusal('issue-identity-changed');
  }
  const computedLedgerDigest = digestConfirmedLedger(ledger);
  if (
    ledger?.alignment !== 'confirmed'
    || !computedLedgerDigest
    || ledger.digest !== computedLedgerDigest
  ) {
    return refusal('scope-unconfirmed');
  }
  if (
    !nonEmpty(changeRequest.id)
    || !nonEmpty(changeRequest.branch)
    || !nonEmpty(changeRequest.provider)
    || !nonEmpty(changeRequest.repository)
  ) {
    return refusal('change-request-identity-incomplete');
  }
  if (!gitObjectId(capturedHead) || !gitObjectId(observedHead)) {
    return refusal('head-invalid');
  }
  if (capturedHead !== observedHead) {
    return refusal('stale-head', { capturedHead, observedHead });
  }

  const prior = priorDeliveryEvidence ?? {};
  if (
    prior.complete !== true
    || prior.issue !== originalIssue
    || prior.changeRequest !== changeRequest.id
    || prior.branch !== changeRequest.branch
    || prior.provider !== changeRequest.provider
    || prior.repository !== changeRequest.repository
    || prior.head !== capturedHead
    || !gitObjectId(prior.head)
    || prior.ledgerDigest !== computedLedgerDigest
    || !sha256(prior.reviewObservationDigest)
    || !Array.isArray(prior.reviewEvidenceIds)
    || !Array.isArray(prior.ciFailureIds)
  ) {
    return refusal('prior-delivery-evidence-missing-or-mismatched');
  }

  const forbidden = forbiddenAuthorityRequested({ requestedActions });
  if (forbidden.length > 0) {
    return refusal('authority-refused', { forbidden });
  }

  const reviewResult = collectReviewEvidence(review);
  if (!reviewResult.accepted) {
    return reviewResult;
  }
  const ciResult = collectCiEvidence(ci, capturedHead);
  if (!ciResult.accepted) {
    return ciResult;
  }
  if (
    review.identityBound !== true
    || review.provider !== changeRequest.provider
    || review.repository !== changeRequest.repository
    || review.changeRequest !== changeRequest.id
    || ci.provider !== changeRequest.provider
    || ci.repository !== changeRequest.repository
  ) {
    return refusal('evidence-context-mismatch');
  }

  const seen = new Set([
    ...prior.reviewEvidenceIds.map((id) => `review:${String(id)}`),
    ...prior.ciFailureIds.map((id) => `ci:${String(id)}`),
  ]);
  const allEvidence = [...reviewResult.evidence, ...ciResult.evidence];
  const duplicateEvidence = allEvidence.find(
    (item, index) => allEvidence.findIndex((candidate) => candidate.key === item.key) !== index,
  );
  if (duplicateEvidence) {
    return refusal('evidence-identity-duplicate', { evidenceId: duplicateEvidence.key });
  }
  const newEvidence = allEvidence.filter((item) => !seen.has(item.key));

  const byEvidence = new Map();
  for (const classification of classifications) {
    const key = nonEmpty(classification?.evidenceId)
      ? `${classification.source}:${classification.evidenceId}`
      : null;
    if (!key || !CLASSIFICATIONS.has(classification?.classification)) {
      return refusal('classification-invalid');
    }
    if (byEvidence.has(key)) {
      return refusal('classification-duplicate', { evidenceId: key });
    }
    byEvidence.set(key, classification);
  }

  const expected = new Set(newEvidence.map((item) => item.key));
  const unexpected = [...byEvidence.keys()].filter((key) => !expected.has(key));
  if (unexpected.length > 0) {
    return refusal('classification-not-new-evidence', { evidence: unexpected });
  }
  const missing = newEvidence.filter((item) => !byEvidence.has(item.key)).map((item) => item.key);
  if (missing.length > 0) {
    return refusal('classification-missing', { evidence: missing });
  }

  const confirmedEntries = new Set(
    ledger.entries
      .filter((entry) => ['in-scope', 'enabling'].includes(entry?.classification))
      .map((entry) => entry?.id)
      .filter(nonEmpty),
  );
  const routed = {
    remediation: [],
    shepherd: [],
    human: [],
    informational: [],
  };

  for (const item of newEvidence) {
    const classification = byEvidence.get(item.key);
    if (
      REMEDIATION.has(classification.classification)
      && !confirmedEntries.has(classification.ledgerEntryId)
    ) {
      return refusal('classification-outside-confirmed-ledger', { evidenceId: item.key });
    }
    const record = {
      source: item.source,
      evidenceId: item.key.slice(item.source.length + 1),
      classification: classification.classification,
      ...(classification.ledgerEntryId ? { ledgerEntryId: classification.ledgerEntryId } : {}),
    };
    if (REMEDIATION.has(classification.classification)) {
      routed.remediation.push(record);
    } else if (SHEPHERD.has(classification.classification)) {
      routed.shepherd.push(record);
    } else if (HUMAN.has(classification.classification)) {
      routed.human.push(record);
    } else {
      routed.informational.push(record);
    }
  }

  const state = routed.human.length > 0
    ? 'human-required'
    : routed.remediation.length > 0 && routed.shepherd.length > 0
      ? 'shepherd-prerequisite'
      : routed.remediation.length > 0
      ? 'remediation-required'
      : routed.shepherd.length > 0
        ? 'shepherd-work'
        : 'no-remediation';

  return {
    accepted: true,
    state,
    identity: {
      issue: originalIssue,
      changeRequest: changeRequest.id,
      branch: changeRequest.branch,
      provider: changeRequest.provider,
      repository: changeRequest.repository,
      capturedHead,
      ledger: ledger.id,
      ledgerDigest: computedLedgerDigest,
    },
    reviewObservation: {
      previousDigest: prior.reviewObservationDigest,
      currentDigest: review.observationDigest,
      evidenceIds: reviewResult.evidence.map((item) => item.key.slice('review:'.length)),
    },
    newEvidence: newEvidence.map((item) => item.key),
    routed,
    restartShip: state === 'remediation-required',
    updateExistingChangeRequest: state === 'remediation-required',
    requiresFreshIntake: state === 'shepherd-prerequisite',
    replacementChangeRequest: false,
    stages: state === 'remediation-required' ? [...REMEDIATION_STAGES] : [],
  };
}

/**
 * Revalidate the snapshot immediately before updating the existing branch.
 */
export function evaluateContinuationUpdate({
  continuation,
  provider,
  repository,
  changeRequest,
  branch,
  capturedHead,
  observedHead,
  resultingHead,
} = {}) {
  if (
    continuation?.accepted !== true
    || continuation.state !== 'remediation-required'
    || continuation.updateExistingChangeRequest !== true
  ) {
    return refusal('continuation-not-updateable');
  }

  if (!gitObjectId(capturedHead) || !gitObjectId(observedHead)) {
    return refusal('head-invalid');
  }

  const identity = continuation.identity ?? {};
  if (
    provider !== identity.provider
    || repository !== identity.repository
    || changeRequest !== identity.changeRequest
    || branch !== identity.branch
    || capturedHead !== identity.capturedHead
  ) {
    return refusal('update-identity-mismatch');
  }
  if (observedHead !== capturedHead) {
    return refusal('stale-head', { capturedHead, observedHead });
  }
  if (!gitObjectId(resultingHead) || resultingHead === capturedHead) {
    return refusal('resulting-head-invalid');
  }

  return {
    accepted: true,
    state: 'update-authorized',
    identity: { ...identity },
    resultingHead,
    pushMode: 'normal',
    force: false,
    replacementChangeRequest: false,
  };
}
