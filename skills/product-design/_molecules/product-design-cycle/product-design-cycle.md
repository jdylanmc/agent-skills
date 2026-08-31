---
name: product-design-cycle
description: Run the ordered brand and user-experience prototype cycle for one aligned Discovery subject and resolve its exact approved interaction contract.
level: molecule
includes: ["product-design/_atoms/discovery-intake/discovery-intake.md","product-design/_atoms/brand-foundation/brand-foundation.md","product-design/_atoms/ux-concepts/ux-concepts.md","product-design/_atoms/interaction-contract/interaction-contract.md","product-design/_atoms/approval-binding/approval-binding.md"]
composes: ["product-design/_atoms/discovery-intake/discovery-intake.md","product-design/_atoms/brand-foundation/brand-foundation.md","product-design/_atoms/ux-concepts/ux-concepts.md","product-design/_atoms/interaction-contract/interaction-contract.md","product-design/_atoms/approval-binding/approval-binding.md"]
used-by: ["product-design/SKILL.md"]
allowed-tools: ["edit","execute","task"]
---

# Product-Design Cycle

Run one product-design phase between Discovery and specification.

## Required References

1. [Discovery intake](../../_atoms/discovery-intake/discovery-intake.md)
2. [Brand foundation](../../_atoms/brand-foundation/brand-foundation.md)
3. [User-experience concepts](../../_atoms/ux-concepts/ux-concepts.md)
4. [Interaction contract](../../_atoms/interaction-contract/interaction-contract.md)
5. [Approval binding](../../_atoms/approval-binding/approval-binding.md)

## Operation

1. Bind exactly one aligned Discovery subject and its
   `docs/agent/prototypes/<subject>/` workspace.
2. Run Brand foundation in its own `brand-designer` specialist context.
   Require a trusted dispatch/event observation binding that role, context,
   subject, the exact aligned Discovery revision at start, the exact brand
   artifact revision at completion, source channel, observed time, and sequence.
3. Stop for a separate, provenance-bearing human alignment receipt bound to
   the exact brand artifact digest.
4. Only after alignment, run User-experience concepts in a distinct
   `user-experience-designer` specialist context, with a later trusted event
   binding its distinct context and artifact revision.
5. Produce independently runnable isolated npm static HTML/CSS/JavaScript
   mocked concepts and restartable explanatory overlay walkthroughs with stable
   identifiers. Emit fixed commands for explicit human execution/review; never
   execute package scripts, Storybook, or prototype JavaScript.
6. Collect separately supplied trusted human-run observations after specialist
   completion. Require exact reverse coverage of every concept walkthrough
   step, including the visible overlay and target, performed interaction,
   resulting state, ordered next step, and restart control/state. Produced
   walkthrough claims cannot satisfy this gate.
7. Record Design Space evidence and stop for a digest-bound concept-selection
   receipt.
8. Write the parseable interaction contract and its non-authority marker.
9. Run Approval binding. Present the recomputed exact digests to the human.
10. After a separate exact-byte approval receipt, wait for a trusted provider
   observation proving the change request merged those bytes to the default
   branch.

## Output

Return the phase status and the complete output contract from the wrapper,
including exact digests and the contract handed to `/spec`.

## Boundaries

The cycle designs an experience. It does not create production UI, select
production architecture, continue Discovery, write a specification, require
Roast for prototype artifacts, approve itself, or merge.
