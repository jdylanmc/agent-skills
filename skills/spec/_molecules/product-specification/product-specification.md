---
name: product-specification
description: Convert one confirmed Discovery source into a stable product-intent model, persist its authoritative nano and supporting full Product Requirements Documents beneath docs/agent/specs, and validate the reread pair.
level: molecule
includes: ["_base/_atoms/contradiction-check/contradiction-check.md","spec/_atoms/approval-state/approval-state.md","spec/_atoms/discovery-source/discovery-source.md","spec/_atoms/product-design-evidence/product-design-evidence.md","spec/_atoms/product-requirements/product-requirements.md","spec/_atoms/spec-outcome/spec-outcome.md","spec/_atoms/spec-pair/spec-pair.md"]
composes: ["_base/_atoms/contradiction-check/contradiction-check.md","spec/_atoms/approval-state/approval-state.md","spec/_atoms/discovery-source/discovery-source.md","spec/_atoms/product-design-evidence/product-design-evidence.md","spec/_atoms/product-requirements/product-requirements.md","spec/_atoms/spec-outcome/spec-outcome.md","spec/_atoms/spec-pair/spec-pair.md"]
used-by: ["spec/SKILL.md"]
allowed-tools: ["edit","execute"]
---

# Product Specification

Produce one pair of Product Requirements Documents from one confirmed Discovery
artifact.

```text
resolve approval state -> resolve source with state-dependent freshness
                       -> on held: check contradiction, record the
                          non-escalated findings, then route through
                          spec-outcome with the resulting verdict
                       -> preserve evidence distinctions -> formalize product intent
                       -> write nano/full pair -> reread -> validate
                       -> resolve status
```

## Required References

1. [Contradiction check](../../../_base/_atoms/contradiction-check/contradiction-check.md)
2. [Approval state](../../_atoms/approval-state/approval-state.md)
3. [Discovery source](../../_atoms/discovery-source/discovery-source.md)
4. [Product-design evidence](../../_atoms/product-design-evidence/product-design-evidence.md)
5. [Product requirements](../../_atoms/product-requirements/product-requirements.md)
6. [Specification pair](../../_atoms/spec-pair/spec-pair.md)
7. [Specification outcome](../../_atoms/spec-outcome/spec-outcome.md)

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
3. Run [Product-design evidence](../../_atoms/product-design-evidence/product-design-evidence.md).
   Revalidate the primary exact-revision Discovery packet and authoritative
   frontier route. If it routed `needs-product-design`, reject
   `not-applicable` and require the exact `approved` validator result for the
   same subject/revision. A `ready` route may use only the typed
   `discovery-frontier-ready-for-spec` non-applicability code. Never infer either
   branch from absence or free prose.
4. **On `held`, check contradiction, then route through the deterministic
   resolver.** The approved specification stands and nothing was re-derived or
   written. Run
   [Contradiction check](../../../_base/_atoms/contradiction-check/contradiction-check.md)
   over the approved artifact's assertion set and the enriched Discovery
   evidence — `--bound` to hand judgement exactly the capped surface, then
   `--resolve` on the judged findings — to produce the contradiction verdict
   (`escalated` or `none`). The caller is responsible for supplying only the
   changed Discovery material as that evidence; no deterministic extractor of
   "changed evidence only" exists yet, so keeping the evidence to the delta is
   the caller's boundary to hold rather than one this molecule enforces. Record
   the `recorded` and `suppressed` findings the
   resolver returns through Chronicler **before** routing the verdict onward, so
   a `medium` or `low` divergence survives the run rather than being discarded
   with the verdict; only an `escalated` finding interrupts a human. Then run
   [Specification outcome](../../_atoms/spec-outcome/spec-outcome.md) with
   `sourceStatus: 'held'`, the approval state, and that verdict. Return whatever
   it resolves — `held` when nothing new contradicts, `needs-decision` when the
   contradiction escalated. The `accepted` divergences the check suppresses are
   supplied by the caller for this run; no durable store of previously accepted
   divergences exists yet, so that continuity gap is visible rather than
   assumed. Nothing else is derived, written, roasted, or published on this
   path.
4. Run
   [Product requirements](../../_atoms/product-requirements/product-requirements.md).
   Formalize only what the source and normalized product-design evidence
   support. When product design is required, map every validated contract
   feature, flow, observable state, decision, accessibility expectation,
   alternative, and open question into intention, `[INTENT]`/`[AC-###]`
   supporting detail, acceptance criteria, or an explicitly preserved open
   question, with stable-ID traceability. Exclude prototype implementation
   choices. Preserve facts, claims, decisions, assumptions, contradictions,
   and open questions as different categories. A missing product decision
   remains a question.
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
