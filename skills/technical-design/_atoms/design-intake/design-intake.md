---
name: design-intake
description: Bind one approved functional specification and its supporting evidence as immutable, revisioned technical-design input.
level: atom
includes: []
composes: []
used-by: ["technical-design/_molecules/engineering-design/engineering-design.md"]
---

# Design Intake

Bind the authority before making an engineering choice.

## Required Input

- one nano Product Requirements Document with a stable specification identity,
  revision, intention, functional-requirement identifiers, and approval
  evidence;
- its linked full document as supporting context;
- exact locators and revisions for relevant Discovery, repository, research,
  proof-of-concept, doctrine, and existing-ADR evidence.

Approval must be independently observable. A field written by the design author
is not approval evidence. When approval cannot be verified, return
`needs-decision`; do not begin architecture.

## Authority Rules

1. Capture every functional requirement identifier and exact text.
2. Record the specification revision or content digest.
3. Treat nano content as functional authority and full content as context.
4. If the layers conflict, report the conflict and stop. The full document
   never overrides the nano document.
5. If design uncovers a missing functional requirement, return it as a product
   gap for human resolution. Do not insert or edit the requirement.

## Output

Return the bound specification identity, revision, approval evidence,
functional-requirement inventory, source locators, and any conflict or product
gap.

## Boundary

This atom reads product intent. It never writes product intent, resolves a
product decision, or converts architecture into a functional requirement.
