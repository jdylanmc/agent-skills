---
name: alignment-check
description: Confirm shared human understanding of the current discovery state before any discovery handoff is written.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["discovery/_molecules/cycle-controller/cycle-controller.md"]
---

# Alignment Check

Confirm that the agent and human share the same understanding before the
discovery state is persisted.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `discovery packet` | yes | The current evidence, decisions, questions, frontier, and recommended next action. |
| `proposed handoff focus` | yes | The exact continuation context that would be written if aligned. |

## Operation

1. Summarize what was found and uncovered:
   - confirmed facts;
   - source claims that remain only claims;
   - contradictions and ambiguities;
   - decisions made;
   - open questions;
   - current frontier state;
   - proposed next cycle.
2. Ask for alignment on that summary before any handoff is written.
3. If the human corrects the summary, update the discovery packet and repeat
   the alignment summary.
4. Continue only when the human confirms the current discovery state is aligned
   enough to persist.
5. If the human does not align, stop with `not-aligned` and no handoff.

## Output

Return:

- `alignment`: `aligned`, `corrected`, or `not-aligned`;
- the exact aligned summary;
- corrections that changed the discovery packet;
- unresolved disagreements that block persistence.

## Boundaries

- This atom asks for shared understanding, not approval to implement.
- It writes nothing.
- It does not turn corrections into facts unless the human explicitly supplies
  them as decisions or source-backed evidence.
- It is mandatory before every discovery handoff.
