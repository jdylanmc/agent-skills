# Issue tracker: GitHub

Issues and specifications live in `https://github.com/jdylanmc/agent-skills`.
Use `gh` with explicit `--repo jdylanmc/agent-skills` for issue and PR operations.
API calls use host `github.com` and repository `jdylanmc/agent-skills`.
There is no separate planning project configured.

## Scope and identity

The default backlog view is open, eligible issues in this repository, without an
assignee filter. It does not authorize processing the full backlog without a
human request. An explicit issue or specification narrows that view to its agreed
deliverable and relevant relationships. The current publishing objective is #251
only; unrelated issues are out of scope.

Resolve the authenticated user with `gh api --hostname github.com user --jq .login`.
Only an assigned-to-me request adds that verified login as an assignee filter.
Do not infer identity from Git author configuration.

Use the mapped `ready-for-agent` label from `triage-labels.md` for Joe-mode
eligibility. Read requirements, comments, dependency relationships, assignments,
and linked PRs before reserving work. Fetch complete pages for the selected query,
or state that results are partial; a failed query is not an empty backlog.
Readiness does not satisfy dependencies, establish ownership, or authorize merge.

## Ownership and mutations

No atomic cross-session claim mechanism is configured. Reconcile visible owners,
assignees, and linked PRs, record reservations on the controller's session board,
and block competing dispatch when ownership is uncertain. A board or assignment
alone is not an exclusive lock. Do not take over another owner's work.

Keep one delivery owner per issue/specification graph. Across separate PRs,
dependencies must be available on the agreed base before dependent work starts.
Keep feedback on the same delivery and PR; preserve unrelated labels.

Use the calling skill's approval gates for publication, comments, labels,
assignments, and closure. Setup itself creates no issues, labels, assignments,
or readiness transitions. Reconcile uncertain writes before retrying.
Do not approve, merge, enable auto-merge, or bypass branch protection.

## Pull requests as a triage surface

PRs as a request surface: no.

GitHub shares issue and PR numbering. Resolve the actual item type before acting.
