---
name: shepherd-disposition
description: Classify terminal shepherd outcomes from rebase, conflict, local validation, push, and remote CI evidence.
level: atom
allowed-tools: []
includes: ["shepherd/_atoms/shepherd-disposition/shepherd-disposition.mjs"]
composes: []
used-by: ["shepherd/_molecules/pr-shepherding/pr-shepherding.md"]
---

# Shepherd Disposition

## Required Files

1. [Disposition helper](./shepherd-disposition.mjs)

## Inputs

| Signal | Meaning |
| --- | --- |
| `preflight` | Whether pull request and worktree resolution succeeded. |
| `rebase` | Whether the branch rebased onto the current base. |
| `conflicts` | Conflict classifications and whether any semantic conflict remains. |
| `localValidation` | Result envelope from the required `run-ci` skill. |
| `push` | Whether the branch was pushed with `--force-with-lease`. |
| `remoteChecks` | Provider validation status after the push, normalized by an adapter when available. |

## Terminal Dispositions

| Disposition | Meaning |
| --- | --- |
| `mergeable-and-green` | Preflight succeeded, rebase completed onto the recorded base SHA, regeneration completed or was not applicable, local declared validation passed with complete evidence, push used an explicit SHA-pinned lease, post-push mergeability matches the expected base and head, and every required remote check passed. |
| `no-op-mergeable-and-green` | The base advanced, but the pull request is still mergeable and green, no required check expired, and the operator did not ask for a rebase; do not rebase or force-push. |
| `needs-human` | A semantic or ambiguous conflict, unsafe worktree state, missing policy decision, or permission boundary requires a human. |
| `provider-tool-missing` | The git-level core completed, but the matched provider's official CLI was unavailable, so hosted merge/review/check state could not be observed. |
| `provider-tool-unauthenticated` | The git-level core completed, but the matched provider's official CLI was not authenticated, so hosted merge/review/check state could not be observed. |
| `blocked` | The run could not proceed because of environment, cancellation, unavailable provider metadata required for the requested action, or another external blocker. |
| `failing` | Rebase completed but local validation or remote continuous integration is red. |

## Planning Classification

Before rebasing, classify whether action is needed. Rebase only on a trigger:
operator request, genuine conflict or unmergeable state, or an expired required
check. Base drift alone is not a trigger. When the base moved but the pull
request is still mergeable and green, return `no-op-mergeable-and-green` and do
not push.

## Classification Order

1. Human decisions win first: semantic conflicts and unsafe policy gaps are
   `needs-human`.
2. A base-drift-only green pull request is `no-op-mergeable-and-green` before
   any rebase or push.
3. External incompleteness is `blocked`.
4. Red validation or red remote checks are `failing`.
5. Only complete green evidence after required action may be
   `mergeable-and-green`.

## Boundaries

A red suite never produces `mergeable-and-green`. A skipped, deleted, narrowed,
or weakened suite is not green evidence. Missing remote checks are blocked, not
success.
