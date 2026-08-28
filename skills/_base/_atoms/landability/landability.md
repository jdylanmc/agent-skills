---
name: landability
description: Hold the shared vocabulary for whether a change request is landable — the terminal dispositions, the base's up-to-date policy, and the freshness receipt a disposition is bound to — so the skill producing them and the skill consuming them cannot drift apart.
level: atom
allowed-tools: []
includes: ["_base/_atoms/landability/landability.mjs"]
composes: []
used-by: ["shepherd/_molecules/pr-shepherding/pr-shepherding.md","ship/SKILL.md"]
---

# Landability

One vocabulary, two sides.

## Required Files

1. [Landability vocabulary](./landability.mjs)

## Why This Is Shared

One skill drives a change request toward landable and reports a terminal
disposition. Another publishes a change request, hands it over, and has to
decide whether what came back means anything.

That is a producer and a consumer of the same values. When each keeps its own
copy of the list, the copies drift silently: a disposition the producer can
return goes missing from the consumer's set, and a perfectly valid ending is
read as no ending at all. Both consumers exist today, which is what makes this
shared rather than duplicated.

## Terminal Dispositions

`mergeable-and-green`, `no-op-mergeable-and-green`, `provider-unsupported`,
`provider-tool-unsupported`, `provider-tool-missing`,
`provider-tool-unauthenticated`, `provider-tool-unobserved`, `needs-human`,
`blocked`, `failing`.

The provider conditions are separate values on purpose. A host family with no
adapter yet, a missing tool, an unauthenticated tool, and a tool whose readiness
was never probed send a person to four different places, and mapping one onto
another sends them to the wrong one.

## The Up-To-Date Policy

| Value | Meaning |
| --- | --- |
| `required` | The base will not accept a change request that does not contain its current commit. |
| `not-required` | The policy was read, and it imposes no such requirement. |
| `unobserved` | The policy could not be read. |

`unobserved` is never `not-required`. A boolean is normalized rather than
refused, because that is the shape a provider client returns; anything else
becomes `unobserved`.

## The Mergeability Signal

The disposition side does not consume a raw provider merge reading. It consumes
a normalized **mergeability signal**, and the translation from what the
change-request reader observed into that signal lives here, at the seam, because
the reader and the disposition are in two different skills.

| Field | Meaning |
| --- | --- |
| `observed` | Whether the merge reading was observed at all. |
| `state` | The **content** merge state only: `mergeable`, `conflicted`, or `unobserved`. |
| `blocked` | A policy or administrative block, carried explicitly. `true`, `false`, or `null` when unread. |
| `behind` | Whether the branch is behind a base that must contain it. `true`, `false`, or `null`. |
| `reviewDecision` | The review gate: `approved`, `changes-requested`, `review-required`, or `unobserved`. |
| `isDraft` | Draft state when reported, else `null`. |
| `baseSha` / `headSha` | The commits the reading was taken against. |
| `upToDatePolicy` | The normalized up-to-date policy from the reading. |

`state` is deliberately content-only. Whether the branch's content merges is a
different question from whether policy or review permits it, so a policy block
or a required review is **never** folded into `state`; each is carried in its
own field. `normalizeMergeabilitySignal` performs the mapping, and an unobserved
reading yields `state: 'unobserved'` with every blocking gate unobserved rather
than reported as one that permits a merge. A disposition consuming this signal
gates `blocked === true` and a `review-required` / `changes-requested` decision
to `needs-human`, and rebasing is never treated as a way to clear either.

## The Freshness Receipt

A disposition says a change request was landable against one base commit at one
moment. The receipt records that moment: `observedAt`, `baseSha`, `headSha`, the
up-to-date policy, the provider status, and whether those are complete.

A receipt is validated before it is believed. A missing field, an invalid
timestamp, a commit that is not a non-empty string, and a `complete: true`
asserted over missing fields are all defects, because a consumer holding one of
those has nothing to compare a later observation against.

Comparison needs **both** commits. A moved base means the disposition describes
a merge that no longer applies; a moved head means it describes different code.
It also needs an observation timestamp strictly after the receipt. An absent,
invalid, equal, or earlier timestamp does not prove a re-read happened.
An observation that could not be made is `unobserved`, never `stale`:
manufacturing drift nobody saw is its own kind of wrong.

## Boundaries

- **Holds vocabulary and comparison only.** It reads nothing, runs nothing, and
  reaches no provider.
- **Never decides a disposition.** It says which values are endings, not which
  ending applies.
- **Never treats an unreadable fact as a reassuring one.** Unobserved policy is
  not `not-required`, and an unobserved comparison is not `fresh`.
