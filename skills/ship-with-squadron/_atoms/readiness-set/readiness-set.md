---
name: readiness-set
description: Validate real nested Shepherd returns, exact freshness receipts and set obligations, then expire and queue affected open readiness after observed sibling merges.
level: atom
allowed-tools: ["execute","read","task"]
includes: ["ship-with-squadron/_atoms/readiness-set/readiness-set.mjs"]
composes: []
used-by: ["ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md"]
---

# Readiness Set

## Required Files

1. [Readiness set helper](./readiness-set.mjs)

When Shepherd intent is `yes`, every published change request receives an
actual nested `shepherd` invocation in a fresh worker. Wait for its terminal
return. A described handoff, unavailable dispatch, or nonterminal result is not
an invocation.

Use the readiness set helper to require:

- the canonical Landability receipt exactly as Shepherd produced it:
  observation time, base SHA, head SHA, up-to-date policy, provider status, and
  completeness;
- normalized provider, repository, change request, base branch, run, issue,
  invocation, and generation identity in the surrounding invocation,
  post-return observation, and set obligation, never fabricated receipt fields;
- a post-Shepherd reread proving the receipt still matches;
- `containsCurrentBase: true` under a `required` up-to-date policy;
- one shared strict set-obligation schema exactly binding owner, provider,
  repository, change request, stable publication, base branch, base/head,
  expiry condition, re-invocation, generation, and creation time;
- no degraded or unobserved provider state for a ready claim.

When manifest Shepherd intent is `no`, record `not-required` plus a real
revision-bound set obligation and dispatch no Shepherd. Before entering
completed readiness, archive any active assignment through an exact
generation/worker/base/head/result-bound success transition so no mutable owner
remains.

Readiness is snapshot-bound. After an exact merge observation reconciled to a
recorded publication, persist the merge and invalidate every affected open
publication before considering any sibling revision receipt. This includes the
first Shepherd invocation while it is still in flight. Preserve its active
assignment and persist a merge-watermark-bound blocked check state until fresh
revision evidence is acquired. Advance and persist a merge
watermark/generation, mark readiness stale, and accept only a complete
provider/repository/change-request/publication/base-branch/base-SHA/head-branch/
head-SHA revision receipt observed after the triggering merge. Missing or
malformed revision evidence leaves that sibling blocked with a durable queue
entry without rolling back other invalidations. Clear stale
quality/publication evidence and queue one
merge/revision-generation-specific revalidation plus fresh Shepherd invocation
when required. With
Shepherd intent `no`, queue fresh complete quality/provider revalidation
instead. A later sibling merge updates an already queued obligation. Consume it
only after the stable change request is confirmed for current base/head and
fresh semantic quality evidence matches that exact generation and revision.
Duplicate merge redelivery is idempotent. Do not
force-push merely because the base moved; Shepherd decides whether its trigger
and SHA-pinned lease rules require a push.

An in-flight Shepherd blocker retains the affected generation. Revision
evidence clears only the blocker for that exact generation. If mutable
assignment ownership still binds older base/head values, keep the new evidence
queued without changing the issue or packet revisions; activate it atomically
when ownership is validly archived. A fresh Shepherd check then reuses the
queued generation, is persistable, and is cleared only by successful
generation-matched receipt consumption.
Failed, deferred, and timed-out-with-handoff issues cannot consume queued
readiness evidence. A terminal timed-out release removes its actionable queue
entry rather than silently converting the issue back to completed readiness.

Expiry uses one explicit persisted representation: accepted nested readiness is
replaced by an `expired` marker bound to the new generation, while nested and
issue-level set obligations and no-Shepherd decisions are cleared together.
An affected issue with no active assignment becomes blocked. An affected active
assignment remains active, owned, and persistable with the blocking check state;
it is archived only through a valid generation-bound completion or handoff.
The resulting state must still pass the full fleet-state invariants.
The landed change request retains its review-ready evidence, and its observed
merge continues to satisfy dependent work while open siblings expire.
