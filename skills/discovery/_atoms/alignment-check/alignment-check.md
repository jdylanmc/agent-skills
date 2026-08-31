---
name: alignment-check
description: Offer an interactive alignment check that verifies shared human understanding of documented Discovery findings before domain modeling, frontier mapping, or persistence.
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
| `documented findings` | yes | The current evidence, facts, claims, decisions, assumptions, contradictions, risks, and open questions. |
| `findings marker` | yes | The exact `findings-documented` marker returned by the acquisition cycle. |

## Operation

1. Offer an interactive alignment check. Do not treat silence, a status report,
   or an unrelated response as alignment.
2. Summarize what was found and uncovered:
   - confirmed facts;
   - source claims that remain only claims;
   - contradictions and ambiguities;
   - decisions made;
   - open questions.
3. Ask whether those documented findings are the shared understanding to use
   for domain modeling.
4. If the human corrects the summary, update the documented findings and repeat
   the alignment summary.
5. Continue only when the human verifies the documented findings as shared
   understanding. Return a SHA-256 `aligned-findings-digest` over exactly those
   findings so later domain-model, frontier, and persistence receipts can bind
   their derivations to the aligned input without pretending the later outputs
   were shown before alignment.
6. If the human does not align, stop with `not-aligned`; produce no domain
   model, frontier, foundation, or handoff.

## Output

Return:

- `alignment`: `offered`, `verified`, `corrected`, or `not-aligned`;
- `aligned-findings-digest` for `verified` or `corrected`;
- the exact aligned summary;
- corrections that changed the discovery packet;
- unresolved disagreements that block persistence.

## Boundaries

- This atom asks for shared understanding, not approval to implement.
- It writes nothing.
- It does not turn corrections into facts unless the human explicitly supplies
  them as decisions or source-backed evidence.
- It is mandatory before domain modeling, frontier mapping, foundation
  persistence, and every discovery handoff.
- It verifies shared understanding; it is not a generic approval prompt.
