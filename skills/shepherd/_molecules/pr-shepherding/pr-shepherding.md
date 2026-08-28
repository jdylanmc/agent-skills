---
name: pr-shepherding
description: Coordinate pull request intake, rebase conflict policy, validation, leased push, remote check watch, and final disposition.
level: molecule
includes: ["_base/_atoms/provider-detect/provider-detect.md","shepherd/_atoms/provider-state/provider-state.md","shepherd/_atoms/git-shepherd-core/git-shepherd-core.md","shepherd/_atoms/pr-intake/pr-intake.md","shepherd/_atoms/conflict-policy/conflict-policy.md","shepherd/_atoms/shepherd-disposition/shepherd-disposition.md","_base/_atoms/landability/landability.md"]
composes: ["_base/_atoms/provider-detect/provider-detect.md","shepherd/_atoms/provider-state/provider-state.md","shepherd/_atoms/git-shepherd-core/git-shepherd-core.md","shepherd/_atoms/pr-intake/pr-intake.md","shepherd/_atoms/conflict-policy/conflict-policy.md","shepherd/_atoms/shepherd-disposition/shepherd-disposition.md","_base/_atoms/landability/landability.md"]
used-by: ["shepherd/SKILL.md"]
allowed-tools: ["edit","execute","read","search"]
---

# PR Shepherding

## Required References

1. [Provider detect](../../../_base/_atoms/provider-detect/provider-detect.md)
2. [Provider state](../../_atoms/provider-state/provider-state.md)
3. [Git shepherd core](../../_atoms/git-shepherd-core/git-shepherd-core.md)
4. [PR intake](../../_atoms/pr-intake/pr-intake.md)
5. [Conflict policy](../../_atoms/conflict-policy/conflict-policy.md)
6. [Shepherd disposition](../../_atoms/shepherd-disposition/shepherd-disposition.md)
7. [Landability vocabulary](../../../_base/_atoms/landability/landability.md)

## Layers

1. Provider-independent core: plain git comparison, trigger-based rebase,
   generated conflict regeneration, repository-declared validation, and leased
   push. This layer is [Git shepherd core](../../_atoms/git-shepherd-core/git-shepherd-core.md).
2. Provider adapter seam: optional detection of a supported provider and its
   official command-line tool, then optional resolution of a hosted
   change-request identifier, hosted merge state, and hosted validation status.
   This layer is [Provider detect](../../../_base/_atoms/provider-detect/provider-detect.md)
   plus [Provider state](../../_atoms/provider-state/provider-state.md).
   Provider state is a shepherd-local atom, not a shared one, because only
   shepherd reads change-request state today; a unit earns `_base` when a second
   skill composes it. Review threads are deliberately absent from this
   composition. The review-reading unit lives local to `ship`, and cross-skill
   local **composition** is forbidden by the graph validator, so shepherd
   cannot *compose* it: shepherd acquires no comment-handling authority by
   composition. The validator governs composition, not code imports, so the
   property enforced is that composing what shepherd needs grants it no
   review-thread authority — not that imports are blocked.

## Wiring The Adapter Reads Into The Disposition

The molecule adapts each provider-state reading into the signals
[Shepherd disposition](../../_atoms/shepherd-disposition/shepherd-disposition.md)
consumes, and the translation shapes live in the shared
[Landability vocabulary](../../../_base/_atoms/landability/landability.md):

- **Mergeability signal.** Feed the `read-state` result from
  [Provider state](../../_atoms/provider-state/provider-state.md) through
  `normalizeMergeabilitySignal` (re-exported from provider-state) into the
  disposition's `mergeability` signal. That mapping keeps content merge state,
  the policy/administrative block, and the review decision in separate fields,
  so a blocked or review-required change request reaches `needs-human` rather
  than a green disposition, and a review block never triggers a rebase.
- **Base up-to-date policy.** Source `basePolicy.upToDate` per provider from the
  read that actually carries it: for GitHub, from the `read-state` result
  (`mergeStateStatus: BEHIND`); for Azure DevOps, from the `read-checks` result,
  whose policy list carries the up-to-date evaluation. A pull-request-show
  response does not carry the Azure policy, so it is never sourced from there.

## Workflow

1. Detect the provider with [Provider detect](../../../_base/_atoms/provider-detect/provider-detect.md).
   Use explicit provider input first, then configured-host and remote URL
   evidence, then probe that the provider's official command-line tool is
   available and authenticated. Report `provider-unsupported`,
   `provider-tool-missing`, `provider-tool-unauthenticated`,
   `provider-tool-unobserved`, or `provider-tool-unsupported` instead of guessing
   when provider state cannot be observed.
2. Resolve the target with [Provider state](../../_atoms/provider-state/provider-state.md)
   when detection reports `supported-provider`, or with caller-supplied
   branch/base refs otherwise. [PR intake](../../_atoms/pr-intake/pr-intake.md)
   records the normalized target and worktree safety facts.
3. Always run [Git shepherd core](../../_atoms/git-shepherd-core/git-shepherd-core.md)
   when enough git refs are known, even when provider state was not observed.
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
11. Ask [Provider state](../../_atoms/provider-state/provider-state.md)
   for hosted merge state and validation status when detection reports
   `supported-provider`. Prefer one blocking wait when the tool supports it; do
   not schedule prompts or loop through repeated status rediscovery. When state
   was not observed, report the detection condition beside the git-level result
   and never substitute an empty or clean provider result for it.
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
