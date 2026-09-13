---
name: git-shepherd-core
description: Perform the provider-independent git shepherding loop with policy-selected branch maintenance, generated conflict regeneration, validation, and concurrency-safe push.
level: atom
allowed-tools: ["edit","execute","read","search"]
includes: []
composes: []
used-by: ["shepherd/_molecules/pr-shepherding/pr-shepherding.md"]
---

# Git Shepherd Core

This atom owns the provider-independent layer. It uses plain git state and the
repository's own validation contract. It does not depend on a forge, review
system, hosted check API, or change-request numbering scheme.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `repository-root` | yes | Local repository or isolated worktree containing the branch to shepherd. |
| `branch` | yes | Local branch or detached work ref being shepherded. |
| `base-ref` | yes | Freshly fetched live target branch tip used for comparison and maintenance, never a historical merge base. |
| `captured-remote-head` | when pushing | Remote ref SHA checked before either push, and used as the expected SHA for a rewrite lease. |
| `up-to-date-policy` | no | Normalized signal stating whether the branch must contain the current base before it may land: `required`, `not-required`, or `unobserved`. Resolved by the coordinating molecule and never by this layer. |
| `conflict-policy` | no | Trusted configuration for generated, structured, authored, and protected paths. |
| `branch-policy` | when updating | Observed policy for both destination head and live base, including direct-update permission, rewriting, linear history and merge methods. The coordinating molecule resolves this evidence. Unknown or incompatible policy blocks mutation. |

## Operation

1. Fetch the configured remotes needed to compare the branch and base. Compute
   whether the branch is behind its base with git ancestry, not hosted-provider
   metadata.
2. Update only on a genuine trigger: operator request, branch is unmergeable by
   local git evidence, or the provider adapter reports a conflicting state.
   Expired required validation triggers validation only, not a branch update.
   Base drift alone is not a trigger.

   One exception, and it is not an exception to the reasoning. When the supplied
   up-to-date policy is `required` and git ancestry says the branch does not
   contain the current base, the branch is already unlandable, so an advanced
   base is a trigger. An `unobserved` policy is not a requirement, so a
   repository with no such policy keeps the rule above unchanged.
3. If the base moved but the branch is already validated and no trigger exists,
   return the no-op result supplied by the coordinating molecule. Do not rebase
   and do not push.
4. Select the update strategy from the observed head-branch policy. When merge
   commits are permitted, merge the fetched BASE INTO THE PR BRANCH with
   `git merge --no-edit <base-sha>`. When linear history is required, rebase only
   if force pushes are explicitly allowed. Preserve linear history on the head
   when the base requires it and squash merging is unavailable. The head must
   permit direct updates. If neither strategy is permitted, or policy
   is unknown, stop before mutation. This never merges the PR into its base.
   During the selected update, resolve generated or derived conflicts by running
   the configured regeneration command and staging the regenerated result.
5. Stop on authored, semantic, ambiguous, untrusted, or protected conflicts.
6. Regenerate configured derived metadata after the update.
7. Invoke the required `run-ci` skill for repository-declared validation.
8. Immediately before either push, verify the remote head still equals the
   captured remote head SHA. After a merge update, use normal
   `git push <head-remote> HEAD:refs/heads/<head>`; its non-fast-forward rejection
   protects against concurrent updates. After a permitted rebase, use only an
   explicit SHA-pinned `--force-with-lease`. Never retry a rejected push by force.
   Validate resolved head/base branch names before using them and construct git
   commands as argument vectors. Display strings from the provider are never
   interpolated into shell source. Capture the actual push status and observed
   destination/resulting head in the receipt; a lease-verification boolean is
   not a successful push.

## Output

Return live base/head SHAs, ancestry counts, trigger, selected strategy and
policy evidence, update receipts, conflict decisions, regeneration receipts,
validation envelope, captured-head prepush evidence, push receipt, and disposition.

## Boundaries

- No provider vocabulary belongs in this layer. Hosted-review identifiers,
  provider command-line clients, hosted validation labels, and forge-specific
  merge states are adapter evidence only.
- Never merge the PR INTO BASE, approve, delete a branch, or enable auto-merge.
- Never silently resolve authored or semantic conflicts.
- Never weaken, delete, narrow, or skip validation.
- Never edit `doctrine/`.
- Never push without the captured-head prepush check; rewriting also needs a lease.
