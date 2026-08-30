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
  policy;
- a post-Shepherd reread proving the receipt still matches;
- `containsCurrentBase: true` under a `required` up-to-date policy;
- a set obligation naming owner, expiry condition, and re-invocation;
- no degraded or unobserved provider state for a ready claim.

Readiness is snapshot-bound. After an observed sibling merge into the same base,
expire every affected still-open ready claim whose receipt names the old base,
mark it stale, reread current base/head, and queue one fresh Shepherd invocation.
Do not force-push merely because the base moved; Shepherd decides whether its
trigger and SHA-pinned lease rules require a push.
