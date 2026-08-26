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

- source status;
- pair status and sibling-conflict count;
- Discovery-gap count;
- unresolved-product-decision count;
- independent Roast status and unresolved `Must fix` count;
- human nano-approval status.

## Resolution

1. `blocked` when source access, alignment, or freshness failed; persistence,
   reread, or pair validation failed; the specification Roast profile or review
   is unavailable or incomplete; or an unresolved `Must fix` finding remains.
2. `needs-discovery` when the confirmed source is materially incomplete or a
   product requirement needs evidence or scope Discovery did not settle.
3. `needs-decision` when a product decision, sibling conflict, or human nano
   approval remains unresolved.
4. `complete` only when none of those conditions exists.

An unavailable review never becomes an empty clean review. A clean Roast never
becomes human approval. Both are required and remain different evidence.

## Boundaries

This atom classifies one run. It does not repair an artifact, invoke Roast,
approve a nano document, or decide whether a finding is correct.
