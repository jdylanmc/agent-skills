---
name: frontier-selection
description: Reconstruct current work state, compare candidate next actions, and return one selected frontier action with a dispatch-ready worker brief.
level: molecule
includes: ["next-step-selection/_atoms/state-reconstruction/state-reconstruction.md","next-step-selection/_atoms/candidate-frontier/candidate-frontier.md","next-step-selection/_atoms/selection-brief/selection-brief.md"]
composes: ["next-step-selection/_atoms/state-reconstruction/state-reconstruction.md","next-step-selection/_atoms/candidate-frontier/candidate-frontier.md","next-step-selection/_atoms/selection-brief/selection-brief.md"]
used-by: ["next-step-selection/SKILL.md"]
allowed-tools: ["read","search"]
---

# Frontier Selection

Choose the next action from evidence rather than memory.

## Required References

1. [State reconstruction](../../_atoms/state-reconstruction/state-reconstruction.md)
2. [Candidate frontier](../../_atoms/candidate-frontier/candidate-frontier.md)
3. [Selection brief](../../_atoms/selection-brief/selection-brief.md)

## Workflow

1. Run [State reconstruction](../../_atoms/state-reconstruction/state-reconstruction.md)
   to recover the smallest reliable picture of where the work stands.
2. Run [Candidate frontier](../../_atoms/candidate-frontier/candidate-frontier.md)
   to identify possible next actions, ordering constraints, and blockers.
3. Run [Selection brief](../../_atoms/selection-brief/selection-brief.md)
   to choose exactly one action and produce the worker brief.

## Selection Standard

Prefer the action that:

1. advances the current objective or strategy contract;
2. is unblocked by known dependencies;
3. reduces the highest uncertainty, delivery risk, or review bottleneck;
4. can be delegated or executed within a bounded next work slice;
5. does not require this skill to exceed its read-only boundary.

If no candidate satisfies those conditions, select a terminal disposition
instead of forcing a fake action.

## Boundaries

- Do not read an entire large backlog into the main context when a compact
  course, summary, issue list, or parent workflow state is available.
- Do not invoke the chosen worker, skill, agent, command, or tracker operation.
- Do not hide uncertainty to make the recommendation look decisive.
