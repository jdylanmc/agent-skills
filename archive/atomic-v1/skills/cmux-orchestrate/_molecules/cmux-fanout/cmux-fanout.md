---
name: cmux-fanout
description: Prepare a helper pane and create or register owned agent surfaces for parallel cmux work.
level: molecule
includes: ["cmux-orchestrate/_atoms/cmux-invoke/cmux-invoke.md","cmux-orchestrate/_atoms/cmux-topology/cmux-topology.md","cmux-orchestrate/_atoms/cmux-helper-pane/cmux-helper-pane.md","cmux-orchestrate/_atoms/cmux-dispatch/cmux-dispatch.md"]
composes: ["cmux-orchestrate/_atoms/cmux-invoke/cmux-invoke.md","cmux-orchestrate/_atoms/cmux-topology/cmux-topology.md","cmux-orchestrate/_atoms/cmux-helper-pane/cmux-helper-pane.md","cmux-orchestrate/_atoms/cmux-dispatch/cmux-dispatch.md"]
used-by: ["cmux-orchestrate/SKILL.md"]
allowed-tools: ["execute"]
---

# cmux Fanout

## Required References

1. [cmux invoke](../../_atoms/cmux-invoke/cmux-invoke.md)
2. [cmux topology](../../_atoms/cmux-topology/cmux-topology.md)
3. [cmux helper pane](../../_atoms/cmux-helper-pane/cmux-helper-pane.md)
4. [cmux dispatch](../../_atoms/cmux-dispatch/cmux-dispatch.md)

## Inputs

- Active `cmux-session` record.
- Requested parallel work items.
- Optional agent provider and working directory.

## Operation

1. Refuse fan-out when the session is degraded or lacks a caller workspace.
2. Use [cmux helper pane](../../_atoms/cmux-helper-pane/cmux-helper-pane.md) to
   reuse a non-caller helper pane or create exactly one helper pane with focus
   disabled.
3. Validate every `new-surface` command through
   [cmux invoke](../../_atoms/cmux-invoke/cmux-invoke.md), including explicit
   `--workspace`, `--pane`, and `--focus false` arguments.
4. Register each created agent surface as owned by this run.
5. Send initial prompts through [cmux dispatch](../../_atoms/cmux-dispatch/cmux-dispatch.md)
   only after ownership and workspace checks pass.

## Output

A fan-out record containing helper pane action, owned surfaces, dispatched work
items, and any refusal category.

## Guarantees

- A fan-out operation creates no more than one helper pane.
- New panes and surfaces do not change focus.
- Initial input is sent only to owned surfaces in the caller workspace.

## Boundaries

This molecule does not interpret agent output, close surfaces, or authorize
cross-workspace routing by default.
