---
name: discovery-loop
description: Run the read-only body of a discovery cycle by reconciling evidence and updating the frontier ledger.
level: molecule
includes: ["discovery/_atoms/evidence-reconcile/evidence-reconcile.md","discovery/_atoms/frontier-ledger/frontier-ledger.md"]
composes: ["discovery/_atoms/evidence-reconcile/evidence-reconcile.md","discovery/_atoms/frontier-ledger/frontier-ledger.md"]
used-by: ["discovery/SKILL.md"]
allowed-tools: ["read","search"]
---

# Discovery Loop

Run the read-only discovery cycle body.

## Required References

1. [Evidence reconcile](../../_atoms/evidence-reconcile/evidence-reconcile.md)
2. [Frontier ledger](../../_atoms/frontier-ledger/frontier-ledger.md)

## Workflow

1. State the discovery subject and scope in one sentence. If the subject cannot
   be stated, ask for that sentence before reading further.
2. Run [Evidence reconcile](../../_atoms/evidence-reconcile/evidence-reconcile.md).
3. Identify what the evidence now proves, what it contradicts, and what it
   still cannot answer.
4. Run [Frontier ledger](../../_atoms/frontier-ledger/frontier-ledger.md) to
   classify the frontier and choose the next workflow.
5. Continue another read-only cycle only when more evidence can be gathered in
   the current scope and the next step is not better owned by another skill.
6. Return the discovery packet. The packet may propose a tracker update, but it
   cannot perform one.

## Neighboring Skill Routing

| Neighbor | Hand off when |
| --- | --- |
| `interrogate` | One pointed question or assumption blocks the rest of discovery. |
| `domain-mapping` | Vocabulary, actors, systems, boundaries, states, events, or relationships are unclear. |
| `spec` | Behavior and proof obligations are settled enough to specify. |
| `ticket-breakdown` | Requirements and ownership are settled enough to split work. |
| `implementation` | Discovery found no remaining product or domain uncertainty relevant to the requested change. |

## Boundaries

- Read-only body. No tracker mutation, file edits, commits, pushes, or issue
  writes occur here.
- No persistent discovery state. If state must be recorded, propose one exact
  tracker update and return it to the root skill for approval-gated handling.
- No absorption of `interrogate`, `domain-mapping`, or `spec`.
