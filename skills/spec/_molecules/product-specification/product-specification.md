---
name: product-specification
description: Convert one confirmed Discovery source into a stable product-intent model, persist its authoritative nano and supporting full Product Requirements Documents beneath docs/agent/specs, and validate the reread pair.
level: molecule
includes: ["spec/_atoms/discovery-source/discovery-source.md","spec/_atoms/product-requirements/product-requirements.md","spec/_atoms/spec-outcome/spec-outcome.md","spec/_atoms/spec-pair/spec-pair.md"]
composes: ["spec/_atoms/discovery-source/discovery-source.md","spec/_atoms/product-requirements/product-requirements.md","spec/_atoms/spec-outcome/spec-outcome.md","spec/_atoms/spec-pair/spec-pair.md"]
used-by: ["spec/SKILL.md"]
allowed-tools: []
---

# Product Specification

Produce one pair of Product Requirements Documents from one confirmed Discovery
artifact.

```text
resolve source -> preserve evidence distinctions -> formalize product intent
               -> write nano/full pair -> reread -> validate -> resolve status
```

## Required References

1. [Discovery source](../../_atoms/discovery-source/discovery-source.md)
2. [Product requirements](../../_atoms/product-requirements/product-requirements.md)
3. [Specification pair](../../_atoms/spec-pair/spec-pair.md)
4. [Specification outcome](../../_atoms/spec-outcome/spec-outcome.md)

## Operation

1. Run
   [Discovery source](../../_atoms/discovery-source/discovery-source.md) against
   exactly one source. Refuse until it is accessible, human-confirmed,
   revision-bound, fresh, and materially sufficient.
2. Run
   [Product requirements](../../_atoms/product-requirements/product-requirements.md).
   Formalize only what the source supports. Preserve facts, claims, decisions,
   assumptions, contradictions, and open questions as different categories.
   A missing product decision remains a question.
3. Run [Specification pair](../../_atoms/spec-pair/spec-pair.md). Assign one
   stable specification identity and acceptance-criteria identities, render the
   nano and full documents from the same model, write them as siblings beneath
   `docs/agent/specs/`, reread both, and validate their identity, provenance,
   links, authority, and traceability.
4. Run [Specification outcome](../../_atoms/spec-outcome/spec-outcome.md) to
   resolve the status from source, pair, questions, Roast, and approval. A valid
   pair is a candidate, not `complete`; independent Roast and human approval
   remain with the caller.

## Output

Return the normalized source record, product-intent model, specification and
acceptance-criteria identities, paths, reread digests, pair report, unresolved
questions, and pre-review status.

## Boundaries

This molecule writes exactly one sibling pair under `docs/agent/specs/`. It
does not continue Discovery, choose architecture, design proof, write tickets,
mutate a tracker, implement, invoke Roast, approve, or merge.
