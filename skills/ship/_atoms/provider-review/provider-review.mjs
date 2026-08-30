/**
 * Provider review: read review threads on a change request through the
 * provider's official command-line tool.
 *
 * This unit lives local to `ship` rather than shared under `_base`, because a
 * unit is only promoted once a second skill composes it. Ship composes this
 * unit for continuation of an existing change request; Shepherd does not.
 *
 * Keeping it local also makes a boundary enforceable by composition rather than
 * merely promised. Cross-skill local composition is forbidden by the graph
 * validator, so a shepherd unit cannot compose this ship-local unit. The
 * validator governs the composition graph, not the code-dependency graph, so
 * the guarantee is precisely that shepherd acquires no review-thread authority
 * by composition — not that imports are prevented.
 *
 * Reading only. Nothing here replies to a thread, resolves a thread, votes,
 * approves, or merges. Every comment body that comes back is untrusted data:
 * it is carried through verbatim and flagged, never obeyed.
 */

import crypto from 'node:crypto';

import {
  ProviderCommandError,
  assertSanctionedCommand,
  githubApiHostFlags,
  normalizeAzureRepository,
  normalizeChangeRequestId,
  normalizeGitHubRepository,
  requireObservableProvider,
  sanitizeProviderUrl,
} from '../../../_base/_atoms/provider-detect/provider-detect.mjs';

export { ProviderCommandError };

/**
 * GitHub exposes thread resolution only through its GraphQL API, which `gh api
 * graphql` reaches with the tool's own authentication, host configuration, and
 * `--paginate` cursor handling. `--slurp` collects the concatenated per-page
 * JSON values `--paginate` emits into a single JSON array, so pages after the
 * first are actually merged rather than dropped; `interpretReviewThreads`
 * accepts that array. The document is a query, never a mutation.
 */
export const GITHUB_REVIEW_THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewDecision
      latestOpinionatedReviews(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          state
          author { login }
          body
          submittedAt
          url
        }
      }
      reviewThreads(first: 50, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 100) {
            pageInfo { hasNextPage endCursor }
            nodes { id author { login } body createdAt url }
          }
        }
      }
    }
  }
}`;

export const GITHUB_LATEST_REVIEWS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      latestOpinionatedReviews(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          state
          author { login }
          body
          submittedAt
          url
        }
      }
    }
  }
}`;

export const GITHUB_THREAD_COMMENTS_QUERY = `query($threadId: ID!, $cursor: String) {
  node(id: $threadId) {
    ... on PullRequestReviewThread {
      id
      comments(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { id author { login } body createdAt url }
      }
    }
  }
}`;

const GITHUB_REVIEW_FIELDS = [
  '-F', { prefix: 'owner=' },
  '-F', { prefix: 'name=' },
  '-F', { prefix: 'number=' },
  '-f', { graphqlQueryEquals: `query=${GITHUB_REVIEW_THREADS_QUERY}` },
];

const GITHUB_LATEST_REVIEW_FIELDS = [
  '-F', { prefix: 'owner=' },
  '-F', { prefix: 'name=' },
  '-F', { prefix: 'number=' },
  '-f', { graphqlQueryEquals: `query=${GITHUB_LATEST_REVIEWS_QUERY}` },
];

const GITHUB_THREAD_COMMENT_FIELDS = [
  '-F', { prefix: 'threadId=' },
  '-f', { graphqlQueryEquals: `query=${GITHUB_THREAD_COMMENTS_QUERY}` },
];

/**
 * The exact command shapes this unit is allowed to construct. The read-only
 * guard sanctions these reads and refuses anything else; a `gh api graphql`
 * document is only sanctioned when it is a query, and the Azure DevOps read is
 * pinned to an explicit `GET`.
 */
export const SANCTIONED_READS = Object.freeze([
  { tool: 'gh', argv: ['api', 'graphql', '--paginate', '--slurp', ...GITHUB_REVIEW_FIELDS] },
  { tool: 'gh', argv: ['api', 'graphql', '--paginate', '--slurp', '--hostname', { value: true }, ...GITHUB_REVIEW_FIELDS] },
  { tool: 'gh', argv: ['api', 'graphql', ...GITHUB_LATEST_REVIEW_FIELDS] },
  { tool: 'gh', argv: ['api', 'graphql', '--hostname', { value: true }, ...GITHUB_LATEST_REVIEW_FIELDS] },
  { tool: 'gh', argv: ['api', 'graphql', ...GITHUB_LATEST_REVIEW_FIELDS.slice(0, 6), '-F', { prefix: 'cursor=' }, ...GITHUB_LATEST_REVIEW_FIELDS.slice(6)] },
  { tool: 'gh', argv: ['api', 'graphql', '--hostname', { value: true }, ...GITHUB_LATEST_REVIEW_FIELDS.slice(0, 6), '-F', { prefix: 'cursor=' }, ...GITHUB_LATEST_REVIEW_FIELDS.slice(6)] },
  { tool: 'gh', argv: ['api', 'graphql', ...GITHUB_THREAD_COMMENT_FIELDS] },
  { tool: 'gh', argv: ['api', 'graphql', '--hostname', { value: true }, ...GITHUB_THREAD_COMMENT_FIELDS] },
  { tool: 'gh', argv: ['api', 'graphql', ...GITHUB_THREAD_COMMENT_FIELDS.slice(0, 2), '-F', { prefix: 'cursor=' }, ...GITHUB_THREAD_COMMENT_FIELDS.slice(2)] },
  { tool: 'gh', argv: ['api', 'graphql', '--hostname', { value: true }, ...GITHUB_THREAD_COMMENT_FIELDS.slice(0, 2), '-F', { prefix: 'cursor=' }, ...GITHUB_THREAD_COMMENT_FIELDS.slice(2)] },
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
        'api', 'graphql', '--paginate', '--slurp',
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

function githubTarget(detection, { changeRequest, repository } = {}) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return refused(guard);
  }
  if (detection.provider !== 'github') {
    throw new ProviderCommandError('unsupported-provider-operation', 'GitHub GraphQL follow-up reads require GitHub');
  }
  const [owner, name] = normalizeGitHubRepository(repository, {}).split('/');
  return {
    id: normalizeChangeRequestId(changeRequest),
    owner,
    name,
  };
}

/** Builds one sanctioned page read for `latestOpinionatedReviews`. */
export function latestReviewsCommand(detection, target = {}, { cursor } = {}) {
  const normalized = githubTarget(detection, target);
  if (normalized?.ok === false) {
    return normalized;
  }
  return assertReadOnlyCommand({
    ok: true,
    operation: 'read-latest-reviews-page',
    provider: 'github',
    tool: 'gh',
    args: [
      'api', 'graphql',
      ...githubApiHostFlags(detection),
      '-F', `owner=${normalized.owner}`,
      '-F', `name=${normalized.name}`,
      '-F', `number=${normalized.id}`,
      ...(text(cursor) === null ? [] : ['-F', `cursor=${text(cursor)}`]),
      '-f', `query=${GITHUB_LATEST_REVIEWS_QUERY}`,
    ],
  });
}

/** Builds one sanctioned page read for a review thread's comments. */
export function threadCommentsCommand(detection, target = {}, { threadId, cursor } = {}) {
  const normalized = githubTarget(detection, target);
  if (normalized?.ok === false) {
    return normalized;
  }
  if (!text(threadId)) {
    throw new ProviderCommandError('invalid-review-thread-identifier', 'review thread identifier is required');
  }
  return assertReadOnlyCommand({
    ok: true,
    operation: 'read-review-thread-comments-page',
    provider: 'github',
    tool: 'gh',
    args: [
      'api', 'graphql',
      ...githubApiHostFlags(detection),
      '-F', `threadId=${text(threadId)}`,
      ...(text(cursor) === null ? [] : ['-F', `cursor=${text(cursor)}`]),
      '-f', `query=${GITHUB_THREAD_COMMENTS_QUERY}`,
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

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function observationDigest(reviewDecision, verdicts, threads) {
  const observation = {
    reviewDecision,
    verdicts: [...verdicts].sort((a, b) => String(a.id).localeCompare(String(b.id))),
    threads: [...threads]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map((thread) => ({
        ...thread,
        comments: [...thread.comments].sort((a, b) => String(a.id).localeCompare(String(b.id))),
      })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical(observation)), 'utf8').digest('hex');
}

function pageDigest(page) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(page)), 'utf8').digest('hex');
}

function consumeFollowUpChain({
  entries,
  initialCursor,
  connectionFor,
  incomplete,
  incompleteBase,
  consumeNodes,
}) {
  if (text(initialCursor) === null) {
    incomplete.push({ ...incompleteBase, reason: 'next-cursor-missing' });
    return;
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    incomplete.push({ ...incompleteBase, reason: 'follow-up-missing' });
    return;
  }

  let expectedCursor = text(initialCursor);
  let terminal = false;
  const requestedCursors = new Set();
  const pageDigests = new Set();

  for (const entry of entries) {
    if (terminal) {
      incomplete.push({ ...incompleteBase, reason: 'pages-after-terminal' });
      return;
    }
    if (!entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'response')) {
      incomplete.push({ ...incompleteBase, reason: 'cursor-binding-missing' });
      return;
    }
    const requestedCursor = text(entry.requestedCursor);
    if (requestedCursor === null) {
      incomplete.push({ ...incompleteBase, reason: 'cursor-binding-missing' });
      return;
    }
    if (requestedCursors.has(requestedCursor)) {
      incomplete.push({ ...incompleteBase, reason: 'duplicate-cursor' });
      return;
    }
    requestedCursors.add(requestedCursor);
    if (requestedCursor !== expectedCursor) {
      incomplete.push({ ...incompleteBase, reason: 'cursor-chain-discontinuous' });
      return;
    }

    const page = entry.response;
    if (!page || typeof page !== 'object' || reportsProviderError(page)) {
      incomplete.push({ ...incompleteBase, reason: 'follow-up-failed' });
      return;
    }
    const digest = pageDigest(page);
    if (pageDigests.has(digest)) {
      incomplete.push({ ...incompleteBase, reason: 'duplicate-page' });
      return;
    }
    pageDigests.add(digest);

    const connection = connectionFor(page);
    if (!connection || !Array.isArray(connection.nodes)) {
      incomplete.push({ ...incompleteBase, reason: 'follow-up-absent' });
      return;
    }
    consumeNodes(connection.nodes);

    const hasNextPage = connection.pageInfo?.hasNextPage;
    if (hasNextPage === false) {
      terminal = true;
      continue;
    }
    if (hasNextPage !== true) {
      incomplete.push({ ...incompleteBase, reason: 'completeness-unconfirmed' });
      return;
    }
    const endCursor = text(connection.pageInfo?.endCursor);
    if (endCursor === null) {
      incomplete.push({ ...incompleteBase, reason: 'next-cursor-missing' });
      return;
    }
    expectedCursor = endCursor;
  }

  if (!terminal) {
    incomplete.push({ ...incompleteBase, reason: 'follow-up-incomplete' });
  }
}

function reviewIdentity(detection, { repository, changeRequest } = {}) {
  try {
    const id = normalizeChangeRequestId(changeRequest);
    if (detection.provider === 'github') {
      return {
        identityBound: true,
        repository: normalizeGitHubRepository(repository, {}),
        changeRequest: id,
      };
    }
    const azure = normalizeAzureRepository(repository, detection);
    return {
      identityBound: true,
      repository: JSON.stringify({
        organizationUrl: azure.organizationUrl,
        project: azure.project,
        name: azure.name,
      }),
      changeRequest: id,
    };
  } catch {
    return {
      identityBound: false,
      repository: null,
      changeRequest: null,
    };
  }
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
    url: sanitizeProviderUrl(comment?.url),
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
 *
 * `gh api graphql --paginate --slurp` collects the per-page JSON values into a
 * single array, so the GitHub payload may be either a single page object or an
 * array of them; the pages are aggregated here. A read is `complete` only when
 * every connection our query requested `pageInfo` for confirms it with
 * `hasNextPage === false`. A `hasNextPage === true` is a truncated read; an
 * absent or non-boolean `hasNextPage` on a requested connection is unconfirmed,
 * which is not a complete read either. A read that is truncated or unconfirmed
 * keeps the threads it did read but reports `complete: false` and names what
 * was truncated or left unconfirmed, so an incomplete read never masquerades as
 * a complete one.
 *
 * Azure DevOps (`az devops invoke`) surfaces no pagination cursor in its JSON
 * body, so its completeness cannot be confirmed. The Azure path therefore
 * reports `complete: false` with an `incomplete` entry marking the thread list
 * as `completeness-unconfirmed`, keeping the threads it read — it is never
 * reported complete.
 */
/**
 * Whether a provider response reports an error beside whatever data it carried.
 *
 * GraphQL answers a field a token cannot see with `null` in `data` plus an entry
 * in a top-level `errors`, rather than with a failed request. Azure DevOps
 * returns a REST error body identified by `typeKey`, `typeName`, or
 * `errorCode`. Neither is required to be a particular JavaScript type, so the
 * test is presence rather than shape: an `errors` that is not an array is still
 * an error, and an `errorCode` that arrives as a string is still an error.
 */
function reportsProviderError(page) {
  if (page === undefined || page === null || typeof page !== 'object') {
    return false;
  }
  const errors = page.errors;
  if (Array.isArray(errors) ? errors.length > 0 : (errors !== undefined && errors !== null)) {
    return true;
  }
  return page.typeKey !== undefined && page.typeKey !== null
    || page.typeName !== undefined && page.typeName !== null
    || page.errorCode !== undefined && page.errorCode !== null;
}

export function interpretReviewThreads(detection, payload, context = {}) {
  const guard = requireObservableProvider(detection);
  if (!guard.ok) {
    return unobserved('provider-review-unobservable');
  }
  const identity = reviewIdentity(detection, context);
  const isPage = (value) => value !== undefined && value !== null && typeof value === 'object';
  if (!isPage(payload) && !Array.isArray(payload)) {
    return unobserved('response-absent');
  }

  if (detection.provider === 'github') {
    const followUpPacket = !Array.isArray(payload) && isPage(payload) && Object.prototype.hasOwnProperty.call(payload, 'primary');
    const primary = followUpPacket ? payload.primary : payload;
    const pages = Array.isArray(primary) ? primary : [primary];
    if (!pages.some(isPage)) {
      return unobserved('response-absent');
    }
    // A slurped read is a sequence of pages, and every element of it has to be a
    // page. An element that is not an object is a page that did not parse as
    // JSON, and skipping it would silently drop whatever threads it held.
    if (!pages.every(isPage)) {
      return unobserved('response-absent');
    }
    // Any page reporting an error makes the whole read unobserved. What an error
    // omitted is not itself observable, so this cannot be downgraded to an
    // incomplete read either: unlike truncation, no cursor says a thread was
    // withheld.
    if (pages.some(reportsProviderError)) {
      return unobserved('provider-error-reported');
    }
    const rawThreads = new Map();
    const rawReviews = new Map();
    let sawConnection = false;
    let outerHasNextPage;
    let reviewDecisionObserved = false;
    let reviewDecision = null;
    let reviewsHasNextPage;
    let reviewsEndCursor;
    let latestReviewsNodesObserved = false;
    let latestReviewsNodesMissing = false;
    const incomplete = [];
    for (const page of pages) {
      const pullRequest = page?.data?.repository?.pullRequest;
      const connection = pullRequest?.reviewThreads;
      if (!connection || !Array.isArray(connection.nodes)) {
        continue;
      }
      sawConnection = true;
      for (const thread of connection.nodes) {
        const id = text(thread?.id);
        if (id !== null) {
          rawThreads.set(id, thread);
        }
      }
      // The final page carrying a connection settles outer completeness.
      outerHasNextPage = connection.pageInfo?.hasNextPage;
      if (Object.prototype.hasOwnProperty.call(pullRequest, 'reviewDecision')) {
        reviewDecisionObserved = true;
        reviewDecision = text(pullRequest.reviewDecision);
      }
      if (Array.isArray(pullRequest?.latestOpinionatedReviews?.nodes)) {
        latestReviewsNodesObserved = true;
        for (const review of pullRequest.latestOpinionatedReviews.nodes) {
          const id = text(review?.id);
          if (id !== null) {
            rawReviews.set(id, review);
          }
        }
      } else {
        latestReviewsNodesMissing = true;
      }
      reviewsHasNextPage = pullRequest?.latestOpinionatedReviews?.pageInfo?.hasNextPage;
      reviewsEndCursor = pullRequest?.latestOpinionatedReviews?.pageInfo?.endCursor;
    }
    if (!sawConnection) {
      return unobserved('review-threads-absent', ['data.repository.pullRequest.reviewThreads.nodes']);
    }

    if (reviewsHasNextPage === true) {
      consumeFollowUpChain({
        entries: followUpPacket ? payload.latestReviews : null,
        initialCursor: reviewsEndCursor,
        connectionFor: (page) => page?.data?.repository?.pullRequest?.latestOpinionatedReviews,
        incomplete,
        incompleteBase: { truncated: 'latestOpinionatedReviews' },
        consumeNodes: (nodes) => {
          for (const review of nodes) {
            const id = text(review?.id);
            if (id !== null) {
              rawReviews.set(id, review);
            }
          }
        },
      });
    } else if (reviewsHasNextPage !== false) {
      incomplete.push({ truncated: 'latestOpinionatedReviews', reason: 'completeness-unconfirmed' });
    }
    if (!latestReviewsNodesObserved || latestReviewsNodesMissing) {
      incomplete.push({ truncated: 'latestOpinionatedReviews', reason: 'review-nodes-absent' });
    }

    const threads = [...rawThreads.values()]
      .sort((a, b) => String(text(a?.id)).localeCompare(String(text(b?.id))))
      .map((thread) => {
      const threadId = text(thread?.id);
      const rawComments = new Map();
      for (const comment of Array.isArray(thread?.comments?.nodes) ? thread.comments.nodes : []) {
        const id = text(comment?.id);
        if (id !== null) {
          rawComments.set(id, comment);
        }
      }
      // Completeness is confirmed only by an explicit `hasNextPage === false`.
      // `=== true` is truncation; anything else on a connection our query asks
      // pageInfo for is unconfirmed, which is incomplete, not complete.
      const commentsHasNextPage = thread?.comments?.pageInfo?.hasNextPage;
      if (commentsHasNextPage === true) {
        consumeFollowUpChain({
          entries: followUpPacket ? payload.threadComments?.[threadId] : null,
          initialCursor: thread?.comments?.pageInfo?.endCursor,
          connectionFor: (page) => (
            text(page?.data?.node?.id) === threadId ? page?.data?.node?.comments : null
          ),
          incomplete,
          incompleteBase: { threadId, truncated: 'comments' },
          consumeNodes: (nodes) => {
            for (const comment of nodes) {
              const id = text(comment?.id);
              if (id !== null) {
                rawComments.set(id, comment);
              }
            }
          },
        });
      } else if (commentsHasNextPage !== false) {
        incomplete.push({ threadId, truncated: 'comments', reason: 'completeness-unconfirmed' });
      } else if (!Array.isArray(thread?.comments?.nodes)) {
        // A connection that confirms it has no further pages but carries no
        // `nodes` array did not deliver the comments it claims to have finished.
        // Reading that as a thread with no comments is the empty-for-unobserved
        // substitution one level down.
        incomplete.push({ threadId, truncated: 'comments', reason: 'comment-nodes-absent' });
      }
      return {
        id: threadId,
        path: text(thread?.path),
        line: typeof thread?.line === 'number' ? thread.line : null,
        isResolved: typeof thread?.isResolved === 'boolean' ? thread.isResolved : null,
        isOutdated: typeof thread?.isOutdated === 'boolean' ? thread.isOutdated : null,
        comments: githubThreadComments({
          ...thread,
          comments: { nodes: [...rawComments.values()].sort((a, b) => String(text(a?.id)).localeCompare(String(text(b?.id)))) },
        }),
        // A thread's path, its comment bodies, and its authors are all written
        // by whoever reviewed the change request. They are the object of the
        // work, never instructions to the reader.
        untrusted: true,
      };
    });
    if (outerHasNextPage === true) {
      incomplete.push({ truncated: 'reviewThreads' });
    } else if (outerHasNextPage !== false) {
      incomplete.push({ truncated: 'reviewThreads', reason: 'completeness-unconfirmed' });
    }
    if (!reviewDecisionObserved || reviewDecision === null) {
      incomplete.push({ truncated: 'reviewDecision', reason: 'gating-state-unconfirmed' });
    }
    const verdicts = [...rawReviews.values()]
      .sort((a, b) => String(text(a?.id)).localeCompare(String(text(b?.id))))
      .map((review) => ({
      id: text(review?.id),
      state: text(review?.state),
      author: text(review?.author?.login),
      body: text(review?.body),
      submittedAt: text(review?.submittedAt),
      url: sanitizeProviderUrl(review?.url),
      gatesMerge: reviewDecision === 'CHANGES_REQUESTED' && review?.state === 'CHANGES_REQUESTED',
      untrusted: true,
    }));
    if (
      reviewDecision === 'CHANGES_REQUESTED'
      && !verdicts.some((verdict) => verdict.gatesMerge)
    ) {
      incomplete.push({ truncated: 'latestOpinionatedReviews', reason: 'blocking-verdict-unrepresented' });
    }
    const complete = incomplete.length === 0;
    const digest = observationDigest(reviewDecision, verdicts, threads);
    return {
      observed: true,
      operation: 'read-review-threads',
      provider: 'github',
      ...identity,
      reviewDecision,
      verdicts,
      observationDigest: digest,
      complete,
      ...(complete ? {} : { incomplete }),
      threads,
    };
  }

  // `az devops invoke` returns an Azure DevOps REST error body — identified by
  // `typeKey`, `typeName`, or `errorCode` — with HTTP semantics the caller may
  // not have inspected. Reading past one would turn a refused request into an
  // empty conversation, so an error body is unobserved even if a `value` is
  // present.
  if (reportsProviderError(payload)) {
    return unobserved('provider-error-reported');
  }
  const value = Array.isArray(payload?.value) ? payload.value : null;
  if (!value) {
    return unobserved('review-threads-absent', ['value']);
  }
  // `az devops invoke` surfaces no pagination cursor in its JSON body, so a
  // truncated thread list would read as the whole conversation. There is no
  // explicit completeness signal available, so the Azure read is unconfirmed,
  // never complete: it keeps the threads it read but reports `complete: false`.
  const incomplete = [{ truncated: 'threads', reason: 'completeness-unconfirmed' }];
  const threads = value.map((thread) => {
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
      untrusted: true,
    };
  });
  return {
    observed: true,
    operation: 'read-review-threads',
    provider: 'azure-devops',
    ...identity,
    reviewDecision: null,
    verdicts: [],
    observationDigest: observationDigest(null, [], threads),
    complete: false,
    incomplete,
    threads,
  };
}

/**
 * Unresolved threads, or an explicit statement that they could not be read.
 *
 * A thread whose resolution state the provider did not report counts as
 * unresolved: an unknown blocking comment is treated as blocking. The return
 * value keeps `observed` so a caller cannot read an unobserved result as an
 * empty one, and it propagates `complete` — and, when incomplete, the
 * `incomplete` list naming what was truncated or left unconfirmed — so a caller
 * cannot read a truncated or unconfirmed conversation as a whole one.
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
    provider: review.provider ?? null,
    identityBound: review.identityBound === true,
    repository: review.repository ?? null,
    changeRequest: review.changeRequest ?? null,
    reviewDecision: review.reviewDecision ?? null,
    verdicts: Array.isArray(review.verdicts) ? review.verdicts : [],
    observationDigest: review.observationDigest ?? null,
    complete: review.complete === true,
    ...(review.complete === true ? {} : { incomplete: Array.isArray(review.incomplete) ? review.incomplete : [] }),
    threads: review.threads.filter((thread) => thread.isResolved !== true),
  };
}
