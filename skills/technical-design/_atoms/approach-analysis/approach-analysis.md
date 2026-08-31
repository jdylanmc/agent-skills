---
name: approach-analysis
description: Compare viable engineering approaches for each consequential decision against common criteria and cited evidence, then select or expose the unresolved choice.
level: atom
includes: []
composes: []
used-by: ["technical-design/_molecules/engineering-design/engineering-design.md"]
---

# Approach Analysis

Make consequential choices visible before they become implementation.

## Workflow

1. Identify each decision that materially changes an interface, boundary,
   persistence model, failure mode, compatibility contract, operational model,
   rollout, rollback, or long-lived cost.
2. State the decision criteria derived from approved functional requirements,
   approved non-functional requirements, repository constraints, doctrine, and
   cited evidence.
3. Describe at least two **viable** approaches. Viable means the approach can
   satisfy the immutable functional requirements; a straw option does not
   count.
4. Evaluate every approach against the same criteria. Cite evidence for each
   material comparison.
5. Select one approach and explain why each rejected viable approach lost. If
   evidence or human-owned architectural direction is missing, select none and
   return an unresolved decision.
6. Mark whether the decision deserves an ADR.

## ADR Test

Propose an ADR when a decision is consequential, difficult to reverse,
cross-cutting, establishes a reusable constraint, changes a public contract, or
would otherwise lose important alternatives and rationale inside the larger
document. Use one ADR per decision and the repository's existing ADR template
and location. If no convention exists, report the proposed ADR and the missing
placement decision rather than inventing a repository standard silently.

## Output

For each decision return its identity, criteria, viable approaches, evidence,
selection, rejected-alternative rationale, reversibility, and ADR disposition.

## Boundary

This atom compares architecture. It does not decide product behavior, accept
risk, or disguise an unresolved choice as a recommendation.
