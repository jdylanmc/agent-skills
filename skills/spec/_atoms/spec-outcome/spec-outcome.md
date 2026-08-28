---
name: spec-outcome
description: Resolve a specification run to complete, needs-decision, needs-discovery, or blocked from explicit source, pair, review, finding, and human-approval evidence.
level: atom
allowed-tools: ["execute"]
includes: ["spec/_atoms/spec-outcome/spec-outcome.mjs"]
composes: []
used-by: ["spec/_molecules/product-specification/product-specification.md"]
---

# Specification Outcome

Resolve status from evidence rather than optimistic narration.

## Required Files

1. [Specification outcome resolver](./spec-outcome.mjs)

## Inputs

- `sourceStatus`: `ready`, `incomplete`, or `held`;
- `pairStatus` and `siblingConflicts` count;
- `discoveryGaps` count;
- `openDecisions` count;
- independent `roastStatus` and `openMustFix` count;
- `approval`: the state resolved by `approval-state` from the default branch —
  `approved` or `draft`, and nothing else is accepted. This replaces the former
  "human nano-approval status" narration. Approval is now resolved
  deterministically rather than by narration.
- `contradiction`: `not-checked`, `none`, or `escalated`. Producing that verdict
  is companion issue #123. This atom only consumes it. `not-checked` and `none`
  both hold, failing toward silence — an unchecked contradiction is not a
  refusal.

## Resolution

When `sourceStatus` is `held`, the run re-derived nothing. The resolver reads
only `approval` and `contradiction` and ignores pair, Roast, gap, and decision
counts, which describe a derivation that did not happen. `held` requires
`approval: 'approved'` — `held` without it is a contract violation and is
refused as `invalid-input`.

For a `held` source:
- `contradiction` is `escalated` => `needs-decision`, because a contradiction
  is a question for a human and never an automatic invalidation.
- otherwise => `held`.

For non-held sources:

1. `blocked` when source access, alignment, or freshness failed; persistence,
   reread, or pair validation failed; the specification Roast profile or review
   is unavailable or incomplete; or an unresolved `Must fix` finding remains.
2. `needs-discovery` when the confirmed source is materially incomplete or a
   product requirement needs evidence or scope Discovery did not settle.
3. `needs-decision` when a product decision, sibling conflict, human nano
   approval, **or escalated contradiction** remains unresolved. An `escalated`
   contradiction is a question for a human and must never be silently dropped,
   regardless of source state.
4. `complete` only when none of those conditions exists.

An unavailable review never becomes an empty clean review. A clean Roast never
becomes human approval. Both are required and remain different evidence.

## Status Vocabulary

| Status | Meaning |
| --- | --- |
| `blocked` | The source is inaccessible or stale, persistence or reread failed, pair validation failed, the Roast profile or review is unavailable, or unresolved `Must fix` findings remain. |
| `needs-discovery` | The source lacks evidence or scope required to state product intent without guessing. |
| `needs-decision` | Product decisions, contradictions, sibling conflicts, or approval remain unresolved. |
| `held` | The approved specification stands; the source moved and nothing contradicts it; nothing was re-derived and nothing was written. |
| `complete` | The source is fresh and confirmed, the pair is valid, independent review is complete and addressed, and the human approved the nano authority. |

## Boundaries

This atom classifies one run. It does not repair an artifact, invoke Roast,
approve a nano document, or decide whether a finding is correct.
