/**
 * Provider state: resolve a change-request identifier to its branch and base,
 * read merge state, and read validation status through the provider's official
 * command-line tool.
 *
 * Two rules shape every function here.
 *
 * First, an unobserved answer is never an empty one. A response that omits
 * mergeability, or that carries a provider's own "not computed yet" value,
 * returns `observed: false` with a reason. Returning an empty check list or a
 * neutral merge state in that case is how a blocking check gets skipped.
 *
 * Second, these are reads. Commands are built as argument vectors for the
 * official tool, are checked against a read-only guard before they are handed
 * back, and no builder here merges, votes, replies, resolves, or pushes.
 */

import { requireObservableProvider } from '../provider-detect/provider-detect.mjs';
import {
  normalizeUpToDatePolicy,
  requiresUpToDateBranch,
} from '../landability/landability.mjs';

/**
 * The base's up-to-date requirement is shared vocabulary: the skill that reads
 * change-request state and the skill that publishes one consume the same three
 * values. One implementation lives in the shared landability unit and is
 * re-exported here so a caller keeps one import and the two sides cannot end up
 * disagreeing about what the value means. It is a field of `read-state`, not a
 * fourth operation.
 */
export { normalizeUpToDatePolicy, requiresUpToDateBranch };

/**
 * Subcommands and flags that mutate hosted state. A builder is checked against
 * this list before its command is returned, so a future edit that reaches for a
 * mutation fails at construction rather than at the provider.
 */
const MUTATING_TOKENS = new Set([
  'merge', 'close', 'reopen', 'create', 'update', 'delete', 'edit', 'set',
  'approve', 'reject', 'vote', 'comment', 'reply', 'resolve', 'complete',
  'abandon', 'push', 'ready', 'checkout',
  '--approve', '--request-changes', '--merge', '--squash', '--rebase',
  '--auto', '--delete-branch', '--body', '--body-file', '--add-reviewer',
]);

const WRITE_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ProviderCommandError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderCommandError';
    this.code = code;
  }
}

/** Rejects a command that would change hosted state. */
export function assertReadOnlyCommand(command) {
  const args = command?.args ?? [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index]);
    if (MUTATING_TOKENS.has(argument)) {
      throw new ProviderCommandError('mutating-command', `refusing a mutating provider command: ${argument}`);
    }
    if ((argument === '--http-method' || argument === '--method' || argument === '-X')
      && WRITE_HTTP_METHODS.has(String(args[index + 1] ?? '').toUpperCase())) {
      throw new ProviderCommandError('mutating-command', `refusing a mutating provider command: ${argument} ${args[index + 1]}`);
    }
  }
  return command;
}

/**
 * Change-request identifiers are positive integers on both providers. Anything
 * else is rejected rather than interpolated, so a hostile identifier cannot
 * become an extra argument or a shell fragment.
 */
export function normalizeChangeRequestId(value) {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  if (!/^[1-9][0-9]{0,17}$/.test(text)) {
    throw new ProviderCommandError('invalid-change-request-identifier', `not a change-request identifier: ${JSON.stringify(value)}`);
  }
  return text;
}

/** GitHub repositories are addressed as `owner/name`. */
export function normalizeGitHubRepository(repository) {
  const slug = typeof repository === 'string' ? repository : repository?.slug;
  const text = String(slug ?? '').trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/.test(text)) {
    throw new ProviderCommandError('invalid-repository', `not an owner/name repository: ${JSON.stringify(slug)}`);
  }
  return text;
}

/** Azure DevOps repositories are addressed by organization URL, project, and repository. */
export function normalizeAzureRepository(repository) {
  const organizationUrl = String(repository?.organizationUrl ?? '').trim();
  const project = String(repository?.project ?? '').trim();
  const name = String(repository?.name ?? '').trim();
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?(?:\/[^\s]*)?$/.test(organizationUrl) || !project || !name) {
    throw new ProviderCommandError(
      'invalid-repository',
      'an Azure DevOps repository needs an https organizationUrl, project, and name',
    );
  }
  return { organizationUrl, project, name };
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

const GITHUB_TARGET_FIELDS = 'number,url,headRefName,baseRefName,headRefOid,headRepositoryOwner,isDraft';
const GITHUB_MERGE_FIELDS = 'number,url,mergeable,mergeStateStatus,isDraft,baseRefName,baseRefOid,headRefOid';
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
      '--repo', normalizeGitHubRepository(repository),
      '--json', GITHUB_TARGET_FIELDS,
    ]);
  }

  const azure = normalizeAzureRepository(repository);
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
      '--repo', normalizeGitHubRepository(repository),
      '--json', GITHUB_MERGE_FIELDS,
    ]);
  }

  const azure = normalizeAzureRepository(repository);
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
      '--repo', normalizeGitHubRepository(repository),
      '--json', GITHUB_CHECK_FIELDS,
    ]);
  }

  const azure = normalizeAzureRepository(repository);
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
 * Normalizes a resolve-target response. A response that omits any of branch,
 * base, or head commit is unobserved, naming what was missing.
 */
export function interpretTarget(detection, payload) {
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
  };
}

const GITHUB_MERGE_STATES = new Map([
  ['MERGEABLE', 'mergeable'],
  ['CONFLICTING', 'conflicted'],
]);

const AZURE_MERGE_STATES = new Map([
  ['succeeded', 'mergeable'],
  ['conflicts', 'conflicted'],
  ['failure', 'conflicted'],
  ['rejectedByPolicy', 'conflicted'],
]);

/**
 * Normalizes merge state. A provider value meaning "not computed yet" —
 * GitHub's `UNKNOWN`, Azure DevOps' `queued` or `notSet` — is unobserved, not
 * mergeable and not conflicted.
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

  const table = detection.provider === 'github' ? GITHUB_MERGE_STATES : AZURE_MERGE_STATES;
  const mergeState = table.get(String(raw));
  if (!mergeState) {
    return {
      ...unobserved('read-state', 'provider-has-not-computed-mergeability'),
      raw: String(raw),
    };
  }

  return {
    observed: true,
    operation: 'read-state',
    provider: detection.provider,
    mergeState,
    isDraft: typeof payload.isDraft === 'boolean' ? payload.isDraft : null,
    upToDatePolicy: normalizeUpToDatePolicy(payload.upToDatePolicy),
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
 * An absent rollup is unobserved. A present-but-empty rollup is observed with
 * status `no-results`, which is deliberately not `passing`: a change request
 * with no reported checks has not demonstrated anything.
 */
export function interpretValidation(detection, payload) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return unobserved('read-checks', 'provider-state-unobservable');
  }
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    return unobserved('read-checks', 'response-absent');
  }

  const rollup = detection.provider === 'github' ? payload.statusCheckRollup : payload.evaluations;
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
