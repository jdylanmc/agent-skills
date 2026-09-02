---
name: discovery-loop
description: Run the read-only knowledge-acquisition body of a Discovery cycle and return documented findings for human alignment.
level: molecule
includes: ["discovery/_atoms/evidence-reconcile/evidence-reconcile.md","discovery/_atoms/documented-findings/documented-findings.md"]
composes: ["discovery/_atoms/evidence-reconcile/evidence-reconcile.md","discovery/_atoms/documented-findings/documented-findings.md"]
used-by: ["discovery/_molecules/cycle-controller/cycle-controller.md"]
allowed-tools: ["read","search"]
---

# Discovery Loop

Acquire knowledge and document findings before alignment.

## Required References

1. [Evidence reconcile](../../_atoms/evidence-reconcile/evidence-reconcile.md)
2. [Documented findings](../../_atoms/documented-findings/documented-findings.md)

## Workflow

1. State the discovery subject and scope in one sentence. If the subject cannot
   be stated, ask for that sentence before reading further.
2. Run [Evidence reconcile](../../_atoms/evidence-reconcile/evidence-reconcile.md).
3. Identify what the evidence now proves, what it contradicts, and what it
   still cannot answer.
4. Run [Documented findings](../../_atoms/documented-findings/documented-findings.md)
   to produce the full reviewable packet and its `findings-documented` marker.
5. Return the documented findings. Do not build a domain model, classify the
   frontier, persist, compact, or select another cycle here.

## Boundaries

- Read-only body. No tracker mutation, file edits, commits, pushes, or issue
  writes occur here.
- No alignment, domain modeling, frontier mapping, persistent discovery state,
  handoff, compaction, or next-cycle selection.
