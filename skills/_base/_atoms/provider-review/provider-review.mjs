/**
 * Provider review: read review threads on a change request through the
 * provider's official command-line tool.
 *
 * This unit is deliberately separate from `provider-state`. A caller that needs
 * merge state and validation status composes `provider-state` and structurally
 * cannot reach review threads, so "this skill holds no comment-handling
 * authority" is a property of the composition graph rather than a promise in
 * prose.
 *
 * Reading only. Nothing here replies to a thread, resolves a thread, votes,
 * approves, or merges. Every comment body that comes back is untrusted data:
 * it is carried through verbatim and flagged, never obeyed.
 */

import { requireObservableProvider } from '../provider-detect/provider-detect.mjs';
import {
  assertReadOnlyCommand,
  normalizeAzureRepository,
  normalizeChangeRequestId,
  normalizeGitHubRepository,
} from '../provider-state/provider-state.mjs';

/**
 * GitHub exposes thread resolution only through its GraphQL API, which `gh api
 * graphql` reaches with the tool's own authentication, host configuration, and
 * `--paginate` cursor handling.
 */
export const GITHUB_REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 50, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 50) {
            nodes { id author { login } body createdAt url }
          }
        }
      }
    }
  }
}`;

function refused(guard) {
  return {
    ok: false,
    operation: 'read-review-threads',
    status: guard.status,
    provider: guard.provider,
    tool: guard.tool,
    inspected: guard.inspected,
    reason: 'provider-review-unobservable',
  };
}

/** Builds the read command for review threads. */
export function reviewThreadsCommand(detection, { changeRequest, repository } = {}) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return refused(guard);
  }
  const id = normalizeChangeRequestId(changeRequest);

  if (detection.provider === 'github') {
    const [owner, name] = normalizeGitHubRepository(repository).split('/');
    return assertReadOnlyCommand({
      ok: true,
      operation: 'read-review-threads',
      provider: 'github',
      tool: 'gh',
      args: [
        'api', 'graphql', '--paginate',
        '-F', `owner=${owner}`,
        '-F', `name=${name}`,
        '-F', `number=${id}`,
        '-f', `query=${GITHUB_REVIEW_THREADS_QUERY}`,
      ],
    });
  }

  const azure = normalizeAzureRepository(repository);
  return assertReadOnlyCommand({
    ok: true,
    operation: 'read-review-threads',
    provider: 'azure-devops',
    tool: 'az',
    args: [
      'devops', 'invoke',
      '--area', 'git',
      '--resource', 'pullRequestThreads',
      '--route-parameters',
      `project=${azure.project}`,
      `repositoryId=${azure.name}`,
      `pullRequestId=${id}`,
      '--org', azure.organizationUrl,
      '--api-version', '7.1',
      '--http-method', 'GET',
      '--output', 'json',
    ],
  });
}

function unobserved(reason, missing = []) {
  return {
    observed: false,
    operation: 'read-review-threads',
    reason,
    missing: [...missing],
  };
}

function text(value) {
  return value === undefined || value === null ? null : String(value);
}

/** Azure DevOps marks non-human threads with a system comment type. */
function azureThreadComments(thread) {
  const comments = Array.isArray(thread?.comments) ? thread.comments : [];
  return comments.map((comment) => ({
    id: text(comment?.id),
    author: text(comment?.author?.displayName ?? comment?.author?.uniqueName),
    body: text(comment?.content),
    createdAt: text(comment?.publishedDate),
    url: null,
    untrusted: true,
  }));
}

function githubThreadComments(thread) {
  const comments = Array.isArray(thread?.comments?.nodes) ? thread.comments.nodes : [];
  return comments.map((comment) => ({
    id: text(comment?.id),
    author: text(comment?.author?.login),
    body: text(comment?.body),
    createdAt: text(comment?.createdAt),
    url: text(comment?.url),
    untrusted: true,
  }));
}

const AZURE_RESOLVED_STATUSES = new Set(['fixed', 'closed', 'wontFix', 'byDesign']);

/**
 * Normalizes a review-thread response.
 *
 * An absent thread collection is unobserved. It is never normalized to an empty
 * list, because "no threads" and "threads not read" lead a caller to opposite
 * conclusions and only one of them is safe to act on.
 */
export function interpretReviewThreads(detection, payload) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return unobserved('provider-review-unobservable');
  }
  if (payload === undefined || payload === null || typeof payload !== 'object') {
    return unobserved('response-absent');
  }

  if (detection.provider === 'github') {
    const nodes = payload?.data?.repository?.pullRequest?.reviewThreads?.nodes;
    if (!Array.isArray(nodes)) {
      return unobserved('review-threads-absent', ['data.repository.pullRequest.reviewThreads.nodes']);
    }
    return {
      observed: true,
      operation: 'read-review-threads',
      provider: 'github',
      threads: nodes.map((thread) => ({
        id: text(thread?.id),
        path: text(thread?.path),
        line: typeof thread?.line === 'number' ? thread.line : null,
        isResolved: typeof thread?.isResolved === 'boolean' ? thread.isResolved : null,
        isOutdated: typeof thread?.isOutdated === 'boolean' ? thread.isOutdated : null,
        comments: githubThreadComments(thread),
      })),
    };
  }

  const value = Array.isArray(payload?.value) ? payload.value : null;
  if (!value) {
    return unobserved('review-threads-absent', ['value']);
  }
  return {
    observed: true,
    operation: 'read-review-threads',
    provider: 'azure-devops',
    threads: value.map((thread) => {
      const status = text(thread?.status);
      return {
        id: text(thread?.id),
        path: text(thread?.threadContext?.filePath),
        line: typeof thread?.threadContext?.rightFileStart?.line === 'number'
          ? thread.threadContext.rightFileStart.line
          : null,
        isResolved: status === null ? null : AZURE_RESOLVED_STATUSES.has(status),
        isOutdated: null,
        comments: azureThreadComments(thread),
      };
    }),
  };
}

/**
 * Unresolved threads, or an explicit statement that they could not be read.
 *
 * A thread whose resolution state the provider did not report counts as
 * unresolved: an unknown blocking comment is treated as blocking. The return
 * value keeps `observed` so a caller cannot read an unobserved result as an
 * empty one.
 */
export function unresolvedReviewThreads(review = {}) {
  if (review.observed !== true || !Array.isArray(review.threads)) {
    return {
      observed: false,
      operation: 'unresolved-review-threads',
      reason: review.reason ?? 'review-threads-absent',
      threads: null,
    };
  }
  return {
    observed: true,
    operation: 'unresolved-review-threads',
    threads: review.threads.filter((thread) => thread.isResolved !== true),
  };
}
