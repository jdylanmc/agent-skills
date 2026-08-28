/**
 * Provider review: read review threads on a change request through the
 * provider's official command-line tool.
 *
 * This unit lives local to `ship` rather than shared under `_base`, because a
 * unit is only promoted once a second skill composes it, and today no skill
 * composes this one: its consumer arrives with issue #102, which will wire
 * review reading into ship's review half. Until then it lands unconsumed and
 * deliberately says so.
 *
 * Keeping it local also makes a boundary enforceable rather than merely
 * promised. Cross-skill local composition is forbidden by the graph validator,
 * so a shepherd unit cannot compose this ship-local unit; "shepherd cannot
 * reach review threads" is therefore a property the validator checks, not a
 * sentence in a document.
 *
 * Reading only. Nothing here replies to a thread, resolves a thread, votes,
 * approves, or merges. Every comment body that comes back is untrusted data:
 * it is carried through verbatim and flagged, never obeyed.
 */

import {
  ProviderCommandError,
  assertSanctionedCommand,
  githubApiHostFlags,
  normalizeAzureRepository,
  normalizeChangeRequestId,
  normalizeGitHubRepository,
  requireObservableProvider,
} from '../../../_base/_atoms/provider-detect/provider-detect.mjs';

export { ProviderCommandError };

/**
 * GitHub exposes thread resolution only through its GraphQL API, which `gh api
 * graphql` reaches with the tool's own authentication, host configuration, and
 * `--paginate` cursor handling. The document is a query, never a mutation.
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

const GITHUB_REVIEW_FIELDS = [
  '-F', { prefix: 'owner=' },
  '-F', { prefix: 'name=' },
  '-F', { prefix: 'number=' },
  '-f', { graphqlQuery: true },
];

/**
 * The exact command shapes this unit is allowed to construct. The read-only
 * guard sanctions these reads and refuses anything else; a `gh api graphql`
 * document is only sanctioned when it is a query, and the Azure DevOps read is
 * pinned to an explicit `GET`.
 */
export const SANCTIONED_READS = Object.freeze([
  { tool: 'gh', argv: ['api', 'graphql', '--paginate', ...GITHUB_REVIEW_FIELDS] },
  { tool: 'gh', argv: ['api', 'graphql', '--paginate', '--hostname', { value: true }, ...GITHUB_REVIEW_FIELDS] },
  {
    tool: 'az',
    argv: [
      'devops', 'invoke',
      '--area', 'git',
      '--resource', 'pullRequestThreads',
      '--route-parameters', { prefix: 'project=' }, { prefix: 'repositoryId=' }, { prefix: 'pullRequestId=' },
      '--org', { value: true },
      '--api-version', '7.1',
      '--http-method', 'GET',
      '--output', 'json',
    ],
  },
]);

/** Rejects a command that is not one of this unit's sanctioned reads. */
export function assertReadOnlyCommand(command) {
  return assertSanctionedCommand(command, SANCTIONED_READS);
}

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
    // The plain owner/name go into the GraphQL variables; the enterprise host,
    // when there is one, reaches `gh api` through `--hostname`, not the slug.
    const [owner, name] = normalizeGitHubRepository(repository, {}).split('/');
    return assertReadOnlyCommand({
      ok: true,
      operation: 'read-review-threads',
      provider: 'github',
      tool: 'gh',
      args: [
        'api', 'graphql', '--paginate',
        ...githubApiHostFlags(detection),
        '-F', `owner=${owner}`,
        '-F', `name=${name}`,
        '-F', `number=${id}`,
        '-f', `query=${GITHUB_REVIEW_THREADS_QUERY}`,
      ],
    });
  }

  const azure = normalizeAzureRepository(repository, detection);
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
