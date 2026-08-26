---
name: pr-shepherding
description: Coordinate pull request intake, rebase conflict policy, validation, leased push, remote check watch, and final disposition.
level: molecule
includes: ["shepherd/_atoms/provider-adapter/provider-adapter.md","shepherd/_atoms/git-shepherd-core/git-shepherd-core.md","shepherd/_atoms/pr-intake/pr-intake.md","shepherd/_atoms/conflict-policy/conflict-policy.md","shepherd/_atoms/shepherd-disposition/shepherd-disposition.md"]
composes: ["shepherd/_atoms/provider-adapter/provider-adapter.md","shepherd/_atoms/git-shepherd-core/git-shepherd-core.md","shepherd/_atoms/pr-intake/pr-intake.md","shepherd/_atoms/conflict-policy/conflict-policy.md","shepherd/_atoms/shepherd-disposition/shepherd-disposition.md"]
used-by: ["shepherd/SKILL.md"]
allowed-tools: ["edit","execute","read","search"]
---

# PR Shepherding

## Required References

1. [Provider adapter](../../_atoms/provider-adapter/provider-adapter.md)
2. [Git shepherd core](../../_atoms/git-shepherd-core/git-shepherd-core.md)
3. [PR intake](../../_atoms/pr-intake/pr-intake.md)
4. [Conflict policy](../../_atoms/conflict-policy/conflict-policy.md)
5. [Shepherd disposition](../../_atoms/shepherd-disposition/shepherd-disposition.md)

## Layers

1. Provider-independent core: plain git comparison, trigger-based rebase,
   generated conflict regeneration, repository-declared validation, and leased
   push. This layer is [Git shepherd core](../../_atoms/git-shepherd-core/git-shepherd-core.md).
2. Provider adapter seam: optional resolution of a hosted change-request
   identifier, hosted review/merge state, and hosted validation status. This
   layer is [Provider adapter](../../_atoms/provider-adapter/provider-adapter.md).

## Workflow

1. Detect an adapter with [Provider adapter](../../_atoms/provider-adapter/provider-adapter.md).
   Use explicit provider input first, then remote URL/config evidence, verify
   the provider's official CLI is available and authenticated, and return
   `provider-unsupported`, `provider-tool-missing`, or
   `provider-tool-unauthenticated` instead of guessing when provider state cannot
   be observed.
2. Resolve the target with the adapter when supported, or with caller-supplied
   branch/base refs when unsupported. [PR intake](../../_atoms/pr-intake/pr-intake.md)
   records the normalized target and worktree safety facts.
3. Always run [Git shepherd core](../../_atoms/git-shepherd-core/git-shepherd-core.md)
   when enough git refs are known, even when provider status is
   `provider-unsupported`.
4. Fetch the current base and head, then classify whether there is a rebase
   trigger. Triggers are operator request, genuine conflict or unmergeable
   state, expired required validation, or an advanced base whose own policy
   requires the branch to contain it. Base drift alone is not a trigger.
5. When the base moved but the change remains mergeable and green, return
   `no-op-mergeable-and-green` without rebasing or force-pushing — unless the
   adapter reported that the base requires the branch to contain it and git
   ancestry says it does not. That branch is already unlandable, so it is a
   trigger rather than a no-op. An `unobserved` policy is not a requirement.
6. When a trigger exists, rebase the branch onto the fetched base SHA and report
   the commits that moved.
7. If the rebase stops, use [Conflict policy](../../_atoms/conflict-policy/conflict-policy.md).
   Regenerate configured derived conflicts, apply only configured and validated
   structured rules, and stop on authored or ambiguous conflicts.
8. After a completed rebase, regenerate repository-declared derived metadata
   using configured commands. Do not invent or weaken those commands.
9. Invoke the required `run-ci` skill for local validation. Shepherd relies on
   that skill's provider discovery and evidence envelope instead of duplicating
   validation discovery.
10. If local validation is complete and green after a triggered rebase, re-check
   that the remote head ref still equals the captured remote head SHA. Push the
   branch with an explicit lease pinned to that SHA:
   `git push --force-with-lease=refs/heads/<head>:<captured-sha> <head-remote> HEAD:refs/heads/<head>`.
   No other force-push form is allowed.
11. Ask the adapter for hosted state and checks when supported. Prefer one
   blocking wait when the adapter supports it; do not schedule prompts or loop
   through repeated status rediscovery. When unsupported, report
   `provider_status: provider-unsupported` beside the git-level result.
12. Classify the terminal disposition with
   [Shepherd disposition](../../_atoms/shepherd-disposition/shepherd-disposition.md).
   Every disposition carries the freshness receipt it was observed against:
   observation time, base SHA, head SHA, up-to-date policy, and provider status.

## One Snapshot, Not A Watch

An invocation observes one snapshot and ends. Its disposition describes the
change request against one base commit at one moment, and it stops describing
anything the moment the base moves.

Re-observing after something merges into the base belongs to whoever asked for
the shepherding, because that caller knows which change requests it still has
open. This molecule does not wait for events, and it does not track siblings.

## Concurrency

Each invocation owns exactly one pull request branch and one worktree. All file
writes, rebases, validation runs, and pushes occur from that worktree. Do not use
shared scratch directories, global mutable state, or another `as-wt-*` worktree.

## Output

Return the pull request URL, branch, base SHA, rebased head SHA, moved commit
summary, conflict policy decisions, regeneration commands run, local validation
envelope from `run-ci`, push receipt confirming `--force-with-lease`, remote
check table, terminal disposition, the freshness receipt that disposition is
bound to, and any Chronicler log path or recording defect.
