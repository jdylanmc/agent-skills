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
| `basePolicy` | Whether the base requires a change request to contain it before merging — `required`, `not-required`, or `unobserved`. |
| `base` | Whether the base moved, and whether the branch is behind it by git ancestry. |

## Terminal Dispositions

| Disposition | Meaning |
| --- | --- |
| `mergeable-and-green` | Preflight succeeded, rebase completed onto the recorded base SHA, regeneration completed or was not applicable, local declared validation passed with complete evidence, push used an explicit SHA-pinned lease, post-push mergeability matches the expected base and head, and every required remote check passed. |
| `no-op-mergeable-and-green` | The base advanced, but the pull request is still mergeable and green, no required check expired, and the operator did not ask for a rebase; do not rebase or force-push. |
| `needs-human` | A semantic or ambiguous conflict, unsafe worktree state, missing policy decision, or permission boundary requires a human. |
| `provider-unsupported` | The git-level core completed, but no hosted adapter matched the inspected remotes or configuration. |
| `provider-tool-unsupported` | The git-level core completed, but the matched host family has no official-tool adapter yet. |
| `provider-tool-missing` | The git-level core completed, but the matched provider's official CLI was unavailable, so hosted merge/review/check state could not be observed. |
| `provider-tool-unauthenticated` | The git-level core completed, but the matched provider's official CLI was not authenticated, so hosted merge/review/check state could not be observed. |
| `blocked` | The run could not proceed because of environment, cancellation, unavailable provider metadata required for the requested action, or another external blocker — including a branch behind a base that requires containing it, an unread up-to-date state under that policy, and a green result carrying an incomplete freshness receipt. |
| `failing` | Rebase completed but local validation or remote continuous integration is red. |

This table is the whole vocabulary, and it is defined once in the shared
landability unit rather than restated by each consumer. A disposition missing
from a consumer's copy is read as no ending at all, which is exactly what
happened to `provider-tool-unsupported`.

## Planning Classification

Before rebasing, classify whether action is needed. Rebase only on a trigger:
operator request, genuine conflict or unmergeable state, an expired required
check, or a base that advanced while its own policy requires the branch to
contain it. Base drift alone is not a trigger. When the base moved but the pull
request is still mergeable and green, return `no-op-mergeable-and-green` and do
not push.

## The Required Up-To-Date Policy

"Base drift alone is not a trigger" is correct because a branch rebased on every
base movement never lands. That reasoning holds only while the base will still
accept a branch that is behind it.

When the provider states that a change request must contain the current base
before it may merge, a base that advanced has **already** made the branch
unmergeable. The content is fine, the prior checks are green, and none of that
is landability. Waiting does not restore it, and a no-op there is a decision to
leave the change request unlandable while reporting it as green.

So `basePolicy.upToDate: required` plus a base that advanced is a trigger, and
`mergeable-and-green` is refused while the branch is known to be behind such a
base.

Under that policy the question must be **settled**, not assumed. `behind:
false` is the only answer that clears it; `true` blocks as
`base-advanced-under-required-up-to-date-policy`, and an absent or non-boolean
value blocks as `up-to-date-state-unobserved-under-required-policy`. Being
behind and not knowing are different facts, and neither is green.

Three values, never two. `unobserved` is not `not-required`: one says the policy
was read and imposes nothing, the other says nobody could look. Only `required`
triggers, so a repository whose base has no such policy — or where it could not
be observed — keeps exactly the previous behavior. `behind: false` settles it in
the other direction: a branch that already contains the base satisfies the
policy however far the base moved.

## A Terminal Disposition Is Snapshot-Bound

Every classification carries a **freshness receipt**: the observation time, the
base SHA, the head SHA, the up-to-date policy, and the provider status, plus
whether those are complete.

A disposition says the change request was landable against one base commit at
one moment. It is evidence about that moment and not durable permission. A
caller holding a disposition after the base moved is holding a statement about a
state that no longer exists, and the receipt is what lets it notice.

**An incomplete receipt is not a formatting problem.** A green result nobody
can date or place cannot be compared with anything later, so it blocks as
`incomplete-freshness-receipt` rather than being reported as
`mergeable-and-green`.

The consumer of that receipt is a different skill, so its shape, its validation,
and the comparison against a later observation all live in the shared
landability unit.

## Classification Order

1. Human decisions win first: semantic conflicts and unsafe policy gaps are
   `needs-human`.
2. A base-drift-only green pull request is `no-op-mergeable-and-green` before
   any rebase or push, unless the base requires the branch to contain it.
3. External incompleteness is `blocked`.
4. Red validation or red remote checks are `failing`.
5. Only complete green evidence after required action may be
   `mergeable-and-green`.

## Boundaries

A red suite never produces `mergeable-and-green`. A skipped, deleted, narrowed,
or weakened suite is not green evidence. Missing remote checks are blocked, not
success. A branch behind a base that requires containing it is not
`mergeable-and-green`, however green everything else reads, and neither is one
whose position against that base was never read.
