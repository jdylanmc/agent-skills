---
name: candidate-frontier
description: Turn reconstructed state into ordered candidate next actions with dependencies, rejected alternatives, and terminal dispositions.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["next-step-selection/_molecules/frontier-selection/frontier-selection.md"]
---

# Candidate Frontier

Name the possible next actions before choosing one.

## Candidate Classes

Use these classes when they fit:

| Class | Meaning | Default terminal disposition |
| --- | --- | --- |
| `merge-or-finish-review` | A pull request or reviewable piece is already the bottleneck. | `ready-to-dispatch` when the next action is finishing the review; `blocked` when a merge gate is unmet; `needs-human-choice` when approval or merge authority is missing. |
| `rebase-or-unblock` | Existing work is blocked by base branch drift, failing policy, conflict, or missing decision. | `ready-to-dispatch` for a bounded unblock action; `blocked` when the dependency is external; `needs-human-choice` when the unblock needs a human decision. |
| `implement-next-slice` | The frontier is a bounded code or content change. | `ready-to-dispatch` when the slice is known; `needs-state` when required state is missing. |
| `run-validation` | The work is ready but lacks local or remote evidence. | `ready-to-dispatch` when validation can be requested; `blocked` when validation authority is unavailable. |
| `run-roast-or-review` | A review gate is owed before the work can be called ready. | `ready-to-dispatch` when the review target is known; `needs-human-choice` when reviewer choice or approval is missing. |
| `discover` | Evidence is insufficient to choose implementation safely. | `ready-to-dispatch` when discovery is the recommended next action, or `needs-state` when the discovery target is unclear. |
| `chart-course` | The next useful action is backlog ordering by a parent or planned planning workflow, not direct execution. | `ready-to-dispatch` when the worker brief names a generic backlog-planning workflow and the backlog scope is known; `needs-state` when it is not. |
| `ask-human` | A human-owned choice blocks selection. | `needs-human-choice`. |
| `stop` | There is no useful next action in the current scope. | `stop`. |

## Evaluation

For each material candidate, capture:

- action;
- evidence supporting it;
- dependency or blocker state;
- expected value;
- expected cost or timebox;
- required authority or human gate;
- why it should win or lose.

## Output

Return an ordered candidate list and mark exactly one as `selected`, plus the
terminal disposition derived from the table above. If no action should be
selected, return only the terminal disposition and the evidence for stopping.

## Boundaries

- Do not dispatch the selected candidate.
- Do not invent dependencies to justify a preferred answer.
- Do not collapse rejected alternatives into silence; the loser list is part of
  the evidence.
