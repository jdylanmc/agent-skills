---
name: alignment-check
description: Offer an interactive alignment check that verifies shared human understanding of the current discovery state before any discovery handoff is written.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["discovery/_molecules/cycle-controller/cycle-controller.md"]
---

# Alignment Check

Offer a human-facing alignment check and verify that the agent and human share
the same understanding before discovery state is persisted.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `discovery packet` | yes | The current evidence, decisions, questions, frontier, and recommended next action. |
| `proposed handoff focus` | yes | The exact continuation context that would be written if aligned. |

## Operation

1. Offer an interactive alignment check. Do not treat silence, a status report,
   or an unrelated response as alignment.
2. Summarize what was found and uncovered:
   - confirmed facts;
   - source claims that remain only claims;
   - contradictions and ambiguities;
   - decisions made;
   - open questions;
   - current frontier state;
   - proposed next cycle.
3. Ask whether that summary is the shared understanding to preserve before any
   handoff is written.
4. If the human corrects the summary, update the discovery packet and repeat
   the alignment summary.
5. Continue only when the human verifies the current discovery state as shared
   understanding.
6. If the human does not align, stop with `not-aligned` and no handoff.

## Output

Return:

- `alignment`: `offered`, `verified`, `corrected`, or `not-aligned`;
- the exact aligned summary;
- corrections that changed the discovery packet;
- unresolved disagreements that block persistence.

## Boundaries

- This atom asks for shared understanding, not approval to implement.
- It writes nothing.
- It does not turn corrections into facts unless the human explicitly supplies
  them as decisions or source-backed evidence.
- It is mandatory before every discovery handoff.
- It verifies shared understanding; it is not a generic approval prompt.
