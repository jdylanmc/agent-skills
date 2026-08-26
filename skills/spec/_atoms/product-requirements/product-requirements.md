---
name: product-requirements
description: Formalize a confirmed Discovery record into product intention, stable acceptance criteria, essential non-goals, supporting requirements, and traceability without selecting architecture or inventing missing decisions.
level: atom
includes: []
composes: []
used-by: ["spec/_molecules/product-specification/product-specification.md"]
---

# Product Requirements

Transform aligned evidence into explicit product intent.

## Inputs

- one validated Discovery source record;
- repository context needed to interpret established product terminology;
- a stable specification slug.

## Operation

1. State one concise product intention: who needs what outcome and why. Preserve
   uncertainty; do not convert an assumption into a fact.
2. Write the smallest complete set of observable acceptance criteria. Assign
   stable identifiers `AC-001`, `AC-002`, and so on. Criteria describe outcomes,
   not files, classes, services, or implementation tasks.
3. Include a non-goal only when omitting it would materially widen the product
   interpretation.
4. Build supporting context for the full document:
   - problem, target users, and desired outcomes;
   - success measures stated by Discovery, with no invented threshold;
   - detailed scope, constraints, and dependencies;
   - confirmed facts and source claims;
   - assumptions and contradictions;
   - alternatives and rejected interpretations;
   - unresolved product decisions;
   - requirement-to-evidence and requirement-to-decision traceability.
5. Mark every material full-document requirement and product decision with the
   nano authority it elaborates: `[INTENT]` or `[AC-###]`. Unmarked detail is
   context and cannot become a downstream requirement.

## Missing Decisions

Do not interview merely because the full document could contain more detail.
The source is already confirmed. Ask only when a missing answer would change the
intention, an acceptance criterion, or an essential non-goal. Return
`needs-decision` and name the exact question. When evidence or scope is
insufficient to frame the choice, return `needs-discovery`.

## Boundaries

This atom formalizes product requirements. It does not select architecture,
write technical design, define Gherkin, design proof, decompose tickets,
prioritize a backlog, mutate a tracker, or implement.
