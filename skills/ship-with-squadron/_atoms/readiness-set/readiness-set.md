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

- exact base SHA, head SHA, observation time, provider state, and up-to-date
  policy, plus normalized provider, repository, change request, run, issue, and
  invocation identity;
- a post-Shepherd reread proving the receipt still matches;
- `containsCurrentBase: true` under a `required` up-to-date policy;
- a set obligation exactly binding owner, change request, base branch,
  base/head, expiry condition, re-invocation, generation, and creation time;
- no degraded or unobserved provider state for a ready claim.

When manifest Shepherd intent is `no`, record `not-required` plus a real
revision-bound set obligation and dispatch no Shepherd.

Readiness is snapshot-bound. After an exact merge observation reconciled to a
recorded publication, expire every affected still-open ready claim and fleet
disposition immediately, mark it stale, and accept only a complete
provider-bound change-request revision receipt observed after the triggering
merge. Clear stale quality/publication evidence and queue one
merge/revision-generation-specific revalidation plus fresh Shepherd invocation
when required. With
Shepherd intent `no`, queue fresh complete quality/provider revalidation
instead. A later sibling merge updates an already queued obligation. Consume it
only after the stable change request is confirmed for current base/head and
fresh semantic quality evidence matches that exact generation and revision.
Duplicate merge redelivery is idempotent. Do not
force-push merely because the base moved; Shepherd decides whether its trigger
and SHA-pinned lease rules require a push.
