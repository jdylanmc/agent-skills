---
name: pr-shepherding
description: Own one change request through durable decaying observation, trigger-based maintenance, bounded Ship continuation, leased push, and honest stop conditions.
level: molecule
includes: ["_base/_atoms/provider-detect/provider-detect.md","shepherd/_atoms/provider-state/provider-state.md","shepherd/_atoms/watch-state/watch-state.md","shepherd/_atoms/ship-continuation/ship-continuation.md","shepherd/_atoms/git-shepherd-core/git-shepherd-core.md","shepherd/_atoms/pr-intake/pr-intake.md","shepherd/_atoms/conflict-policy/conflict-policy.md","shepherd/_atoms/shepherd-disposition/shepherd-disposition.md","_base/_atoms/landability/landability.md"]
composes: ["_base/_atoms/provider-detect/provider-detect.md","shepherd/_atoms/provider-state/provider-state.md","shepherd/_atoms/watch-state/watch-state.md","shepherd/_atoms/ship-continuation/ship-continuation.md","shepherd/_atoms/git-shepherd-core/git-shepherd-core.md","shepherd/_atoms/pr-intake/pr-intake.md","shepherd/_atoms/conflict-policy/conflict-policy.md","shepherd/_atoms/shepherd-disposition/shepherd-disposition.md","_base/_atoms/landability/landability.md"]
used-by: ["shepherd/SKILL.md"]
allowed-tools: ["edit","execute","read","search","task"]
---

# PR Shepherding

## Required References

1. [Provider detect](../../../_base/_atoms/provider-detect/provider-detect.md)
2. [Provider state](../../_atoms/provider-state/provider-state.md)
3. [Watch state](../../_atoms/watch-state/watch-state.md)
4. [Ship continuation](../../_atoms/ship-continuation/ship-continuation.md)
5. [Git shepherd core](../../_atoms/git-shepherd-core/git-shepherd-core.md)
6. [PR intake](../../_atoms/pr-intake/pr-intake.md)
7. [Conflict policy](../../_atoms/conflict-policy/conflict-policy.md)
8. [Shepherd disposition](../../_atoms/shepherd-disposition/shepherd-disposition.md)
9. [Landability vocabulary](../../../_base/_atoms/landability/landability.md)

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
   skill composes it.

   Review threads remain absent from this composition. The local watch-state
   helper reuses Ship's validated read-only provider-review command builders,
   pagination interpreter, and completeness checks as a code dependency only to
   reduce a complete observation to a digest and counts. It exposes no bodies
   and performs no classification. This is a deliberate, target-local authority
   change; Ship still owns review reading for remediation and every semantic
   classification.

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
- **Base up-to-date policy.** Only GitHub surfaces this policy, from the
  `read-state` result (`mergeStateStatus: BEHIND`); source `basePolicy.upToDate`
  from there. Azure DevOps' up-to-date requirement is not observable — there is
  no first-class branch-policy type equivalent to GitHub's "require branches to
  be up to date", and neither a pull-request-show response nor the policy list
  carries it — so `basePolicy.upToDate` is `unobserved` for Azure, and an
  `unobserved` policy is never treated as a requirement.

## Durable Watch

The watch state is run-owned, persisted outside the repository, atomically
replaced, and reread after every write. A fresh invocation resumes from that
state, records the unobserved gap, and observes immediately. It never fills the
gap with invented observations.

While observations are unchanged, delay 2 minutes in hour one, 5 minutes in
hour two, 10 minutes in hour three, 15 minutes in hour four, 30 minutes in hour
five, and 60 minutes afterward. The schedule is measured from the original
watch start, not reset by a resume or a meaningful change.

Each cheap observation includes only identity, open/merged/closed state, base
and head SHAs, merge state, review decision, a completeness-bound review digest,
and required check fingerprints and states. Canonical comparison decides whether
anything meaningful changed. An unchanged cycle performs no rebase, validation,
push, or Ship invocation.

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
4. Create or resume [Watch state](../../_atoms/watch-state/watch-state.md), then
   repeat the cheap observation until a stop condition occurs. Green persists
   and waits; it is not terminal for the watch.
   When the caller is Ship's publication handoff, bootstrap the durable watch
   in a separate long-running worker, wait for its acceptance receipt and
   initial action-cycle disposition, return that bounded snapshot to Ship, and
   leave the worker running. A dispatch without an acceptance receipt is
   invocation failure with no terminal Shepherd disposition, not `blocked` and
   not a completed handoff.
5. On a meaningful mechanical change, fetch the current base and head, then
   classify the required action. Rebase only for operator request, genuine
   conflict or unmergeable state, or an advanced base whose own policy requires
   the branch to contain it. Expired required validation triggers validation,
   not a rebase. Base drift alone is not a trigger.
6. When the base moved but the change remains mergeable and green, record
   `no-op-mergeable-and-green` without rebasing or force-pushing — unless the
   adapter reported that the base requires the branch to contain it and git
   ancestry says it does not. That branch is already unlandable, so it is a
   trigger rather than a no-op. An `unobserved` policy is not a requirement.
   The green no-op also requires three exclusions the disposition planner
   applies: the change request is **not explicitly blocked** (`blocked !== true`
   — a policy or administrative block no rebase can clear), its **merge-block
   state was observed** (not `unobserved`/`null`), and **no review decision
   blocks it** (the review is `approved` or `unobserved`, never
   `changes-requested` or `review-required`). If instead the change request is
   explicitly blocked, its merge-block state is unobserved, or a review decision
   blocks it, do not return a green no-op; fall through to observe state so the
   terminal classifier renders `blocked`/`needs-human`.
7. When a trigger exists, rebase the branch onto the fetched base SHA and report
   the commits that moved.
8. If the rebase stops, use [Conflict policy](../../_atoms/conflict-policy/conflict-policy.md).
   Regenerate configured derived conflicts, apply only configured and validated
   structured rules, and stop on authored or ambiguous conflicts.
9. After a completed rebase, regenerate repository-declared derived metadata
   using configured commands. Do not invent or weaken those commands.
10. Invoke the required `run-ci` skill for local validation. Shepherd relies on
   that skill's provider discovery and evidence envelope instead of duplicating
   validation discovery.
11. If local validation is complete and green after a triggered rebase, re-check
   that the remote head ref still equals the captured remote head SHA. Push the
   branch with an explicit lease pinned to that SHA:
   `git push --force-with-lease=refs/heads/<head>:<captured-sha> <head-remote> HEAD:refs/heads/<head>`.
   No other force-push form is allowed.
12. Ask [Provider state](../../_atoms/provider-state/provider-state.md)
   for hosted merge state and validation status when detection reports
   `supported-provider`. Prefer one blocking wait when the tool supports it; do
   not schedule prompts or loop through repeated status rediscovery. When state
   was not observed, report the detection condition beside the git-level result
   and never substitute an empty or clean provider result for it.
13. When a changed review digest, blocking review decision, or failed required
   check may require functional code or test work, invoke
   [Ship continuation](../../_atoms/ship-continuation/ship-continuation.md).
   Wait for its bounded result, verify the returned identity and head, persist
   that head and the handled evidence watermarks, and resume observation. Ship
   re-reads complete provider-native evidence; Shepherd's fingerprint is only a
   change signal. Pure rebase, regeneration, and configured
   mechanical conflict repair remain local.
14. Classify the action-cycle disposition with
   [Shepherd disposition](../../_atoms/shepherd-disposition/shepherd-disposition.md).
   Every disposition carries the freshness receipt it was observed against:
   observation time, base SHA, head SHA, up-to-date policy, and provider status.

## Stop Conditions

Stop on merge or close, explicit operator stop, semantic conflict, a Ship
human-owned or blocked result, unavailable provider or ownership evidence, or
incomplete evidence required for safe action. Process or session loss simply
ends observation; the durable state remains resumable and records the gap later.

## Concurrency

Each watch owns exactly one pull request branch and one worktree. All file
writes, rebases, validation runs, and pushes occur from that worktree. Do not use
shared scratch directories, global mutable state, or another `as-wt-*` worktree.

## Output

Return the pull request URL, branch, durable state path, watch start, latest
observation, next poll, observation gaps, meaningful-change ledger, base SHA,
rebased head SHA, moved commit summary, conflict policy decisions, regeneration
commands run, Ship continuation result when invoked, local validation envelope
from `run-ci`, push receipt confirming `--force-with-lease`, remote check table,
stop reason when stopped, and any Chronicler log path or recording defect.
