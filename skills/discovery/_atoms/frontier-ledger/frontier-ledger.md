---
name: frontier-ledger
description: Maintain the known, unknown, blocked, and ready frontier for a discovery loop without mutating tracker state.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["discovery/_molecules/discovery-loop/discovery-loop.md"]
---

# Frontier Ledger

Track what the discovery loop knows and what can happen next.

## Frontier States

| State | Meaning |
| --- | --- |
| `ready` | Enough evidence exists for the recommended next workflow. |
| `needs-interrogate` | A pointed question must be answered before discovery can proceed. |
| `needs-domain-mapping` | Terms, actors, systems, boundaries, or relationships are blocking progress. |
| `needs-more-evidence` | A named source or source type is missing. |
| `blocked` | The next step depends on unavailable authority, access, or a decision owner. |
| `stop` | Discovery should not continue because the request is out of scope or unsafe. |

## Rules

- Keep confirmed facts separate from assumptions.
- Keep unanswered questions visible.
- Assign every blocker an owner, source, or next workflow when known.
- Record why a next action is ready; do not merely name it.
- Do not mutate a tracker. A tracker update is a separate gated operation.

## Output

Return the frontier state, supporting evidence, blockers, ready next action,
and deferred questions.

## Boundaries

This atom is an in-memory ledger for the report. It is not a persistent tracker
and does not create or update issues, files, work items, or discovery records.
