---
name: cmux-helper-pane
description: Reuse an existing non-caller helper pane or create exactly one helper pane without changing focus.
level: atom
allowed-tools: ["execute"]
includes: []
composes: []
disable-model-invocation: false
user-invocable: false
used-by: ["cmux-orchestrate/_molecules/cmux-fanout/cmux-fanout.md"]
---

# cmux Helper Pane

## Inputs

- Caller pane identifier.
- Caller-workspace pane list from `cmux-topology`.
- The helper pane marker for this skill.

## Operation

1. Search the caller workspace for a helper pane that is not the caller pane.
2. Reuse the first matching helper pane.
3. If none exists, issue one validated `new-pane` command with `--focus false`.
4. Re-read topology after creation and register the created pane as the helper.

## Output

A helper decision: `reuse` with a pane identifier, `create` with the validated
command, or a stable degradation category.

## Guarantees

- The caller pane is never selected as the helper.
- At most one helper pane is created for a fan-out operation.
- Helper creation keeps focus disabled.

## Boundaries

This atom does not create agent surfaces, send input, read output, or close
helper panes.
