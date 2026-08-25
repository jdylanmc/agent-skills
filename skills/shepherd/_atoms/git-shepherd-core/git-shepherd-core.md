---
name: git-shepherd-core
description: Perform the provider-independent git shepherding loop: behind detection, trigger-based rebase, generated conflict regeneration, validation, and leased push.
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
| `base-ref` | yes | Git ref or commit that the branch should be compared and, when triggered, rebased onto. |
| `captured-remote-head` | when pushing | Remote ref SHA used for the explicit lease. |
| `up-to-date-policy` | no | Normalized signal stating whether the branch must contain the current base before it may land: `required`, `not-required`, or `unobserved`. Resolved by the coordinating molecule and never by this layer. |
| `conflict-policy` | no | Trusted configuration for generated, structured, authored, and protected paths. |

## Operation

1. Fetch the configured remotes needed to compare the branch and base. Compute
   whether the branch is behind its base with git ancestry, not hosted-provider
   metadata.
2. Rebase only on a genuine trigger: operator request, branch is unmergeable by
   local git evidence, a required validation result is known to have expired, or
   the provider adapter reports a conflicting state. Base drift alone is not a
   trigger.

   One exception, and it is not an exception to the reasoning. When the supplied
   up-to-date policy is `required` and git ancestry says the branch does not
   contain the current base, the branch is already unlandable, so an advanced
   base is a trigger. An `unobserved` policy is not a requirement, so a
   repository with no such policy keeps the rule above unchanged.
3. If the base moved but the branch is already validated and no trigger exists,
   return the no-op result supplied by the coordinating molecule. Do not rebase
   and do not push.
4. During a triggered rebase, resolve generated or derived conflicts by running
   the configured regeneration command and staging the regenerated result.
5. Stop on authored, semantic, ambiguous, untrusted, or protected conflicts.
6. Regenerate configured derived metadata after the rebase.
7. Invoke the required `run-ci` skill for repository-declared validation.
8. Push only with an explicit lease pinned to the captured remote head SHA.

## Output

Return base/head SHAs, behind/ahead counts when available, rebase trigger,
rebase receipts, conflict decisions, regeneration receipts, validation envelope,
leased push receipt, and git-level disposition.

## Boundaries

- No provider vocabulary belongs in this layer. Hosted-review identifiers,
  provider command-line clients, hosted validation labels, and forge-specific
  merge states are adapter evidence only.
- Never merge, approve, delete a branch, or enable auto-merge.
- Never silently resolve authored or semantic conflicts.
- Never weaken, delete, narrow, or skip validation.
- Never edit `doctrine/`.
- Never push without an explicit lease.
