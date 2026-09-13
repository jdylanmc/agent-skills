---
name: selection-brief
description: Format the chosen next action as a concise decision packet and worker brief without dispatching it.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["next-step-selection/_molecules/frontier-selection/frontier-selection.md"]
---

# Selection Brief

Turn the chosen frontier into a packet a human or parent workflow can dispatch.

## Decision Packet

Return:

- selected next action;
- current state in two or three sentences;
- route rationale;
- evidence references;
- rejected alternatives and why;
- confidence;
- authority check;
- terminal disposition;
- budget or timebox;
- stop condition;
- human gate, when any.

## Worker Brief

When the terminal disposition is `ready-to-dispatch`, include a worker brief:

- goal;
- scope;
- first sources to inspect;
- inputs already known;
- boundaries and forbidden actions;
- validation expectation;
- expected return shape.

## Terminal Dispositions

| Disposition | Meaning |
| --- | --- |
| `ready-to-dispatch` | The selected action is bounded and unblocked. |
| `blocked` | A known dependency prevents progress. |
| `needs-human-choice` | A human-owned decision is required. |
| `needs-state` | More state must be reconstructed before a safe selection. |
| `stop` | No useful next action exists in scope. |

## Boundaries

- The worker brief is not an invocation.
- Never claim work was started, assigned, or completed.
- Never report a terminal disposition that hides an unmet gate.
