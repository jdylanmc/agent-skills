/**
 * Provider state: resolve a change-request identifier to its branch and base,
 * read merge state, review state, and the base's up-to-date policy, and read
 * validation status through the provider's official command-line tool.
 *
 * This unit is local to `shepherd`. It is not shared under `_base`, because a
 * unit is only promoted there once a second skill composes it, and today only
 * shepherd reads change-request state. Its command safety and its address
 * normalization are the shared parts, and those live in `provider-detect`
 * under `_base`; this unit imports the mechanism and supplies its own
 * sanctioned read shapes.
 *
 * Two rules shape every function here.
 *
 * First, an unobserved answer is never an empty one. A response that omits
 * mergeability, or that carries a provider's own "not computed yet" value,
 * returns `observed: false` with a reason. A conflict-free, green change
 * request can still be blocked by required review or a required-current-base
 * policy, so those signals are surfaced rather than flattened into
 * mergeable-or-conflicted.
 *
 * Second, these are reads. Commands are built as argument vectors for the
 * official tool, checked against an allow-list of sanctioned read shapes before
 * they are handed back, and no builder here merges, votes, replies, resolves,
 * or pushes.
 */

import {
  ProviderCommandError,
  assertSanctionedCommand,
  normalizeAzureOrganization,
  normalizeChangeRequestId,
  normalizeGitHubRepository,
  requireObservableProvider,
} from '../../../_base/_atoms/provider-detect/provider-detect.mjs';
import {
  normalizeMergeabilitySignal,
  normalizeUpToDatePolicy,
  requiresUpToDateBranch,
} from '../../../_base/_atoms/landability/landability.mjs';

export { ProviderCommandError };

/**
 * The base's up-to-date requirement and the mergeability signal are shared
 * vocabulary: the skill that reads change-request state and the skill that
 * publishes one consume the same normalized values. Their one implementation
 * lives in the shared landability unit and is re-exported here so a caller
 * keeps a single import and the two sides cannot end up disagreeing about what
 * a value means. `normalizeUpToDatePolicy`/`requiresUpToDateBranch` normalize
 * the up-to-date policy; `normalizeMergeabilitySignal` maps this unit's
 * `interpretMergeState` output onto the signal the disposition consumes.
 */
export { normalizeMergeabilitySignal, normalizeUpToDatePolicy, requiresUpToDateBranch };

/**
 * The exact command shapes this unit is allowed to construct. A read-only guard
 * that tried to enumerate every mutating subcommand would miss `gh api -f`
 * turning into a POST and `az repos pr reviewer add` hiding a write behind an
 * unlisted subcommand, so the guard sanctions these reads and refuses anything
 * else.
 */
export const SANCTIONED_READS = Object.freeze([
  // GitHub: `gh pr view <id> --repo [HOST/]OWNER/REPO --json <fields>`.
  { tool: 'gh', argv: ['pr', 'view', { id: true }, '--repo', { value: true }, '--json', { value: true }] },
  // Azure DevOps pull-request show, used for both resolve-target and read-state.
  { tool: 'az', argv: ['repos', 'pr', 'show', '--id', { id: true }, '--org', { value: true }, '--output', 'json'] },
  // Azure DevOps policy evaluations, used for read-checks.
  { tool: 'az', argv: ['repos', 'pr', 'policy', 'list', '--id', { id: true }, '--org', { value: true }, '--output', 'json'] },
]);

/** Rejects a command that is not one of this unit's sanctioned reads. */
export function assertReadOnlyCommand(command) {
  return assertSanctionedCommand(command, SANCTIONED_READS);
}

function refused(guard, operation) {
  return {
    ok: false,
    operation,
    status: guard.status,
    provider: guard.provider,
    tool: guard.tool,
    inspected: guard.inspected,
    reason: 'provider-state-unobservable',
  };
}

function command(detection, operation, tool, args) {
  return assertReadOnlyCommand({
    ok: true,
    operation,
    provider: detection.provider,
    tool,
    args,
  });
}

const GITHUB_TARGET_FIELDS = 'number,url,headRefName,baseRefName,headRefOid,headRepositoryOwner,headRepository,isCrossRepository,isDraft';
const GITHUB_MERGE_FIELDS = 'number,url,mergeable,mergeStateStatus,reviewDecision,isDraft,baseRefName,baseRefOid,headRefOid';
const GITHUB_CHECK_FIELDS = 'number,url,headRefOid,statusCheckRollup';

/** Builds the read command that resolves a change request to its branch and base. */
export function resolveTargetCommand(detection, { changeRequest, repository } = {}) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return refused(guard, 'resolve-target');
  }
  const id = normalizeChangeRequestId(changeRequest);

  if (detection.provider === 'github') {
    return command(detection, 'resolve-target', 'gh', [
      'pr', 'view', id,
      '--repo', normalizeGitHubRepository(repository, detection),
      '--json', GITHUB_TARGET_FIELDS,
    ]);
  }

  const azure = normalizeAzureOrganization(repository, detection);
  return command(detection, 'resolve-target', 'az', [
    'repos', 'pr', 'show',
    '--id', id,
    '--org', azure.organizationUrl,
    '--output', 'json',
  ]);
}

/** Builds the read command for merge state. */
export function mergeStateCommand(detection, { changeRequest, repository } = {}) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return refused(guard, 'read-state');
  }
  const id = normalizeChangeRequestId(changeRequest);

  if (detection.provider === 'github') {
    return command(detection, 'read-state', 'gh', [
      'pr', 'view', id,
      '--repo', normalizeGitHubRepository(repository, detection),
      '--json', GITHUB_MERGE_FIELDS,
    ]);
  }

  const azure = normalizeAzureOrganization(repository, detection);
  return command(detection, 'read-state', 'az', [
    'repos', 'pr', 'show',
    '--id', id,
    '--org', azure.organizationUrl,
    '--output', 'json',
  ]);
}

/** Builds the read command for validation status. */
export function validationStatusCommand(detection, { changeRequest, repository } = {}) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return refused(guard, 'read-checks');
  }
  const id = normalizeChangeRequestId(changeRequest);

  if (detection.provider === 'github') {
    return command(detection, 'read-checks', 'gh', [
      'pr', 'view', id,
      '--repo', normalizeGitHubRepository(repository, detection),
      '--json', GITHUB_CHECK_FIELDS,
    ]);
  }

  const azure = normalizeAzureOrganization(repository, detection);
  return command(detection, 'read-checks', 'az', [
    'repos', 'pr', 'policy', 'list',
    '--id', id,
    '--org', azure.organizationUrl,
    '--output', 'json',
  ]);
}

function unobserved(operation, reason, missing = []) {
  return { observed: false, operation, reason, missing: [...missing] };
}

function shortRef(value) {
  const text = String(value ?? '');
  return text.startsWith('refs/heads/') ? text.slice('refs/heads/'.length) : text;
}

function present(value) {
  return value !== undefined && value !== null && String(value).length > 0;
}

/**
 * Head-repository identity a run needs before it may push: the owner and name
 * of the repository the change request's head lives in, and whether that repo
 * differs from the base (a fork or cross-repository change request). This is
 * the push-safety metadata that is genuinely observable from a resolve-target
 * read. Writability is *not* observable from this read, so it is reported
 * `unobserved` rather than claimed — a caller that needs a writable head fails
 * closed on `unobserved`, it never treats it as writable.
 */
function githubHeadRepository(payload) {
  const owner = payload?.headRepositoryOwner?.login;
  const name = payload?.headRepository?.name;
  const nameWithOwner = payload?.headRepository?.nameWithOwner;
  return {
    owner: present(owner) ? String(owner) : null,
    name: present(name) ? String(name) : null,
    nameWithOwner: present(nameWithOwner) ? String(nameWithOwner) : null,
    isCrossRepository: typeof payload?.isCrossRepository === 'boolean' ? payload.isCrossRepository : null,
    writable: 'unobserved',
  };
}

function azureHeadRepository(payload) {
  const fork = payload?.forkSource ?? null;
  const repo = fork?.repository ?? null;
  const name = repo?.name;
  const owner = repo?.project?.name;
  return {
    owner: present(owner) ? String(owner) : null,
    name: present(name) ? String(name) : null,
    nameWithOwner: null,
    isCrossRepository: fork ? true : null,
    writable: 'unobserved',
  };
}

/**
 * Normalizes a resolve-target response. A response that omits any of branch,
 * base, or head commit is unobserved, naming what was missing.
 *
 * `observedAt` is captured at interpretation time so the resolved target
 * carries its own read timestamp; a caller may inject a clock for deterministic
 * use.
 */
export function interpretTarget(detection, payload, { observedAt = new Date().toISOString() } = {}) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return unobserved('resolve-target', 'provider-state-unobservable');
  }
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    return unobserved('resolve-target', 'response-absent');
  }

  const fields = detection.provider === 'github'
    ? {
      branch: payload.headRefName,
      base: payload.baseRefName,
      headSha: payload.headRefOid,
      url: payload.url,
      isDraft: payload.isDraft,
    }
    : {
      branch: shortRef(payload.sourceRefName),
      base: shortRef(payload.targetRefName),
      headSha: payload.lastMergeSourceCommit?.commitId,
      url: payload.url,
      isDraft: payload.isDraft,
    };

  const missing = ['branch', 'base', 'headSha'].filter((field) => !present(fields[field]));
  if (missing.length) {
    return unobserved('resolve-target', 'resolution-state-absent', missing);
  }

  return {
    observed: true,
    operation: 'resolve-target',
    provider: detection.provider,
    branch: String(fields.branch),
    base: String(fields.base),
    headSha: String(fields.headSha),
    url: present(fields.url) ? String(fields.url) : null,
    isDraft: typeof fields.isDraft === 'boolean' ? fields.isDraft : null,
    headRepository: detection.provider === 'github' ? githubHeadRepository(payload) : azureHeadRepository(payload),
    observedAt,
  };
}

const GITHUB_MERGE_STATES = new Map([
  ['MERGEABLE', 'mergeable'],
  ['CONFLICTING', 'conflicted'],
]);

/**
 * GitHub `mergeStateStatus` carries the blocking signals `mergeable` alone
 * cannot. A conflict-free change request may still be `BEHIND` a base that
 * requires containing it, or `BLOCKED` by a required review, so each state is
 * mapped to an explicit `blocked` / `behind` signal rather than collapsed.
 * `DRAFT` is blocking: a draft change request is not mergeable and must reach a
 * human, so it is `blocked: true` even when a payload omits `isDraft`.
 * `UNKNOWN` and an absent status leave both signals unobserved.
 */
const GITHUB_MERGE_STATE_STATUS = new Map([
  ['CLEAN', { status: 'clean', blocked: false, behind: false }],
  ['HAS_HOOKS', { status: 'has-hooks', blocked: false, behind: false }],
  ['UNSTABLE', { status: 'unstable', blocked: false, behind: false }],
  ['BEHIND', { status: 'behind', blocked: false, behind: true }],
  ['BLOCKED', { status: 'blocked', blocked: true, behind: false }],
  ['DIRTY', { status: 'dirty', blocked: false, behind: false }],
  ['DRAFT', { status: 'draft', blocked: true, behind: false }],
]);

const GITHUB_REVIEW_DECISIONS = new Map([
  ['APPROVED', 'approved'],
  ['CHANGES_REQUESTED', 'changes-requested'],
  ['REVIEW_REQUIRED', 'review-required'],
]);

/**
 * Azure DevOps `mergeStatus` describes the *content* merge only, plus one
 * policy outcome. `succeeded` and `conflicts` are content states. A
 * `rejectedByPolicy` result is content-mergeable but administratively blocked —
 * a policy block, not a merge conflict, so it must not be reported as
 * `conflicted` (which would provoke a pointless rebase). A `failure` result is
 * the provider stating it could not compute mergeability, so it is unobserved,
 * carrying its raw value, never `conflicted`.
 */
const AZURE_MERGE_STATES = new Map([
  ['succeeded', { mergeState: 'mergeable', blocked: false }],
  ['conflicts', { mergeState: 'conflicted', blocked: false }],
  ['rejectedByPolicy', { mergeState: 'mergeable', blocked: true }],
]);

/**
 * Azure DevOps reports review state as reviewer votes on the pull request
 * payload: `-10` rejected, `-5` waiting for the author, `>0` some approval, `0`
 * no vote. An absent reviewer collection is unobserved, never approved and
 * never "no reviews required".
 */
function azureReviewDecision(payload) {
  const reviewers = Array.isArray(payload?.reviewers) ? payload.reviewers : null;
  if (!reviewers || reviewers.length === 0) {
    return 'unobserved';
  }
  const votes = reviewers.map((reviewer) => Number(reviewer?.vote));
  if (votes.some((vote) => vote === -10)) {
    return 'changes-requested';
  }
  if (votes.some((vote) => vote === -5)) {
    return 'review-required';
  }
  if (votes.some((vote) => vote > 0)) {
    return 'approved';
  }
  return 'review-required';
}

/**
 * Normalizes merge state, review state, and the up-to-date policy.
 *
 * A provider value meaning "not computed yet" — GitHub's `UNKNOWN`, Azure
 * DevOps' `queued`, `notSet`, or `failure` — is unobserved, not mergeable and
 * not conflicted. The up-to-date policy here is `required` only from evidence a
 * pull-request-show response actually carries: GitHub's `mergeStateStatus:
 * BEHIND`. Azure DevOps' up-to-date requirement is not observable from any read
 * this unit runs, so it is always `unobserved` for Azure.
 */
export function interpretMergeState(detection, payload) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return unobserved('read-state', 'provider-state-unobservable');
  }
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    return unobserved('read-state', 'response-absent');
  }

  const raw = detection.provider === 'github' ? payload.mergeable : payload.mergeStatus;
  if (!present(raw)) {
    return unobserved('read-state', 'merge-state-absent', ['mergeable']);
  }

  let mergeState;
  let azureBlocked = null;
  if (detection.provider === 'github') {
    mergeState = GITHUB_MERGE_STATES.get(String(raw));
  } else {
    const azureState = AZURE_MERGE_STATES.get(String(raw));
    if (azureState) {
      mergeState = azureState.mergeState;
      azureBlocked = azureState.blocked;
    }
  }
  if (!mergeState) {
    return {
      ...unobserved('read-state', 'provider-has-not-computed-mergeability'),
      raw: String(raw),
    };
  }

  let mergeStateStatus = 'unobserved';
  let blocked = null;
  let behind = null;
  let reviewDecision = 'unobserved';
  let upToDatePolicy;

  if (detection.provider === 'github') {
    const statusRaw = String(payload.mergeStateStatus ?? '').toUpperCase();
    const statusInfo = GITHUB_MERGE_STATE_STATUS.get(statusRaw) ?? null;
    mergeStateStatus = statusInfo ? statusInfo.status : 'unobserved';
    blocked = statusInfo ? statusInfo.blocked : null;
    behind = statusInfo ? statusInfo.behind : null;
    reviewDecision = GITHUB_REVIEW_DECISIONS.get(String(payload.reviewDecision ?? '').toUpperCase()) ?? 'unobserved';
    upToDatePolicy = normalizeUpToDatePolicy(statusRaw === 'BEHIND' ? true : undefined);
  } else {
    blocked = azureBlocked;
    reviewDecision = azureReviewDecision(payload);
    // Azure DevOps' up-to-date requirement is not observable from any command
    // this unit runs — neither the pull-request-show response nor the policy
    // list carries a first-class equivalent of GitHub's BEHIND signal — so it
    // is reported unobserved.
    upToDatePolicy = normalizeUpToDatePolicy(undefined);
  }

  return {
    observed: true,
    operation: 'read-state',
    provider: detection.provider,
    mergeState,
    mergeStateStatus,
    blocked,
    behind,
    reviewDecision,
    isDraft: typeof payload.isDraft === 'boolean' ? payload.isDraft : null,
    upToDatePolicy,
    baseSha: present(payload.baseRefOid) ? String(payload.baseRefOid) : null,
    headSha: present(payload.headRefOid)
      ? String(payload.headRefOid)
      : (present(payload.lastMergeSourceCommit?.commitId) ? String(payload.lastMergeSourceCommit.commitId) : null),
    raw: String(raw),
  };
}

const GITHUB_CHECK_CONCLUSIONS = new Map([
  ['SUCCESS', 'success'],
  ['FAILURE', 'failure'],
  ['TIMED_OUT', 'failure'],
  ['CANCELLED', 'failure'],
  ['ACTION_REQUIRED', 'failure'],
  ['STARTUP_FAILURE', 'failure'],
  ['STALE', 'failure'],
  ['NEUTRAL', 'neutral'],
  ['SKIPPED', 'skipped'],
]);

const GITHUB_CHECK_PENDING = new Set(['QUEUED', 'IN_PROGRESS', 'PENDING', 'WAITING', 'REQUESTED', 'EXPECTED']);

const AZURE_POLICY_STATUS = new Map([
  ['approved', 'success'],
  ['rejected', 'failure'],
  ['broken', 'failure'],
  ['queued', 'pending'],
  ['running', 'pending'],
  ['notApplicable', 'skipped'],
]);

function githubCheck(entry) {
  const name = present(entry?.name) ? String(entry.name) : (present(entry?.context) ? String(entry.context) : null);
  const state = String(entry?.state ?? '').toUpperCase();
  const conclusion = String(entry?.conclusion ?? '').toUpperCase();
  const status = String(entry?.status ?? '').toUpperCase();

  let normalized = 'unknown';
  if (GITHUB_CHECK_PENDING.has(status) || GITHUB_CHECK_PENDING.has(state)) {
    normalized = 'pending';
  } else if (GITHUB_CHECK_CONCLUSIONS.has(conclusion)) {
    normalized = GITHUB_CHECK_CONCLUSIONS.get(conclusion);
  } else if (GITHUB_CHECK_CONCLUSIONS.has(state)) {
    normalized = GITHUB_CHECK_CONCLUSIONS.get(state);
  }

  return {
    name,
    status: normalized,
    required: entry?.isRequired === true,
    url: present(entry?.detailsUrl) ? String(entry.detailsUrl) : (present(entry?.targetUrl) ? String(entry.targetUrl) : null),
    raw: { state: entry?.state ?? null, status: entry?.status ?? null, conclusion: entry?.conclusion ?? null },
  };
}

function azureCheck(entry) {
  const raw = String(entry?.status ?? '');
  return {
    name: present(entry?.configuration?.type?.displayName)
      ? String(entry.configuration.type.displayName)
      : (present(entry?.evaluationId) ? String(entry.evaluationId) : null),
    status: AZURE_POLICY_STATUS.get(raw) ?? 'unknown',
    required: entry?.configuration?.isBlocking === true,
    url: null,
    raw: { status: entry?.status ?? null },
  };
}

/**
 * Normalizes validation status.
 *
 * `az repos pr policy list` returns a top-level array of policy evaluation
 * records, which is the shape accepted here; a wrapped `{ evaluations: [...] }`
 * is accepted too for robustness. An absent rollup is unobserved. A
 * present-but-empty rollup is observed with status `no-results`, which is
 * deliberately not `passing`: a change request with no reported checks has not
 * demonstrated anything. An unrecognized shape is `validation-status-absent`,
 * never an empty pass.
 *
 * Neither provider surfaces the base's up-to-date policy from this read.
 * GitHub's `statusCheckRollup` proves nothing about branch policy, and Azure
 * DevOps' up-to-date requirement is not observable from `az repos pr policy
 * list` — there is no first-class branch-policy type equivalent to GitHub's
 * "require branches to be up to date" (the build-validation policy governs
 * build freshness, not whether a branch contains the base). So `upToDatePolicy`
 * is `unobserved` for both providers here.
 */
export function interpretValidation(detection, payload) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return unobserved('read-checks', 'provider-state-unobservable');
  }
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    return unobserved('read-checks', 'response-absent');
  }

  const rollup = detection.provider === 'github'
    ? payload.statusCheckRollup
    : (Array.isArray(payload) ? payload : payload.evaluations);
  if (!Array.isArray(rollup)) {
    return unobserved('read-checks', 'validation-status-absent', [
      detection.provider === 'github' ? 'statusCheckRollup' : 'evaluations',
    ]);
  }

  const checks = rollup.map((entry) => (detection.provider === 'github' ? githubCheck(entry) : azureCheck(entry)));
  let status = 'no-results';
  if (checks.length > 0) {
    if (checks.some((check) => check.status === 'failure')) {
      status = 'failing';
    } else if (checks.some((check) => check.status === 'pending')) {
      status = 'pending';
    } else if (checks.every((check) => check.status === 'success')) {
      status = 'passing';
    } else {
      status = 'inconclusive';
    }
  }

  return {
    observed: true,
    operation: 'read-checks',
    provider: detection.provider,
    status,
    upToDatePolicy: normalizeUpToDatePolicy(undefined),
    checks,
  };
}

/**
 * The only sanctioned way to ask whether validation is green. It is false for
 * every unobserved, empty, pending, neutral, or skipped result, so a caller
 * cannot reach a green conclusion from evidence that does not carry one.
 */
export function validationIsGreen(validation = {}) {
  return validation.observed === true
    && validation.status === 'passing'
    && Array.isArray(validation.checks)
    && validation.checks.length > 0;
}
