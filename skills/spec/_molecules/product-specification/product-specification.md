---
name: product-specification
description: Convert one confirmed Discovery source into a stable product-intent model, persist its authoritative nano and supporting full Product Requirements Documents beneath docs/agent/specs, and validate the reread pair.
level: molecule
includes: ["spec/_atoms/approval-state/approval-state.md","spec/_atoms/discovery-source/discovery-source.md","spec/_atoms/product-requirements/product-requirements.md","spec/_atoms/spec-outcome/spec-outcome.md","spec/_atoms/spec-pair/spec-pair.md"]
composes: ["spec/_atoms/approval-state/approval-state.md","spec/_atoms/discovery-source/discovery-source.md","spec/_atoms/product-requirements/product-requirements.md","spec/_atoms/spec-outcome/spec-outcome.md","spec/_atoms/spec-pair/spec-pair.md"]
used-by: ["spec/SKILL.md"]
allowed-tools: ["edit","execute"]
---

# Product Specification

Produce one pair of Product Requirements Documents from one confirmed Discovery
artifact.

```text
resolve approval state -> resolve source with state-dependent freshness
                       -> on held: route through spec-outcome with contradiction verdict
                       -> preserve evidence distinctions -> formalize product intent
                       -> write nano/full pair -> reread -> validate
                       -> resolve status
```

## Required References

1. [Approval state](../../_atoms/approval-state/approval-state.md)
2. [Discovery source](../../_atoms/discovery-source/discovery-source.md)
3. [Product requirements](../../_atoms/product-requirements/product-requirements.md)
4. [Specification pair](../../_atoms/spec-pair/spec-pair.md)
5. [Specification outcome](../../_atoms/spec-outcome/spec-outcome.md)

## Operation

1. Run
   [Approval state](../../_atoms/approval-state/approval-state.md) against the
   target specification pair to determine whether it is approved or draft on the
   default branch.
2. Run
   [Discovery source](../../_atoms/discovery-source/discovery-source.md) against
   exactly one source, passing the approval state as evidence. Refuse until it
   is accessible, human-confirmed, revision-bound, and materially sufficient.
   When revisions match, the source is fresh. When revisions differ, the outcome
   depends on approval state: a draft refuses with `stale`; an approved
   specification is `held`.
3. **On `held`, route through the deterministic resolver.** The approved
   specification stands and nothing was re-derived or written. Run
   [Specification outcome](../../_atoms/spec-outcome/spec-outcome.md) with
   `sourceStatus: 'held'`, the approval state, and the contradiction verdict
   (`not-checked` when #123 is not yet implemented). Return whatever it
   resolves — `held` or `needs-decision`. Nothing else is derived, written,
   roasted, or published on this path.
4. Run
   [Product requirements](../../_atoms/product-requirements/product-requirements.md).
   Formalize only what the source supports. Preserve facts, claims, decisions,
   assumptions, contradictions, and open questions as different categories.
   A missing product decision remains a question.
5. Run [Specification pair](../../_atoms/spec-pair/spec-pair.md). Assign one
   stable specification identity and acceptance-criteria identities, render the
   nano and full documents from the same model, write them as siblings beneath
   `docs/agent/specs/`, reread both, and validate their identity, provenance,
   links, authority, and traceability.
6. Run [Specification outcome](../../_atoms/spec-outcome/spec-outcome.md) to
   resolve the status from source, pair, questions, Roast, approval, and
   contradiction evidence. A valid pair is a candidate, not `complete`;
   independent Roast and human approval remain with the caller.

## Output

Return the normalized source record, product-intent model, specification and
acceptance-criteria identities, paths, reread digests, pair report, unresolved
questions, and pre-review status.

## Boundaries

This molecule writes exactly one sibling pair under `docs/agent/specs/` and
validates it. Publication belongs to the skill alone; it does not continue
Discovery, choose architecture, design proof, write tickets, mutate a tracker,
implement, invoke Roast, approve, merge, publish, or shepherd a change request.
