---
name: cmux-session
description: Establish a bounded cmux orchestration session by detecting caller context, validating commands, and loading caller-workspace topology.
level: molecule
includes: ["cmux-orchestrate/_atoms/cmux-detect/cmux-detect.md","cmux-orchestrate/_atoms/cmux-invoke/cmux-invoke.md","cmux-orchestrate/_atoms/cmux-topology/cmux-topology.md"]
composes: ["cmux-orchestrate/_atoms/cmux-detect/cmux-detect.md","cmux-orchestrate/_atoms/cmux-invoke/cmux-invoke.md","cmux-orchestrate/_atoms/cmux-topology/cmux-topology.md"]
used-by: ["cmux-orchestrate/SKILL.md"]
allowed-tools: ["execute"]
---

# cmux Session

## Required References

1. [cmux detect](../../_atoms/cmux-detect/cmux-detect.md)
2. [cmux invoke](../../_atoms/cmux-invoke/cmux-invoke.md)
3. [cmux topology](../../_atoms/cmux-topology/cmux-topology.md)

## Inputs

- Operator request for a cmux orchestration run.
- Current environment.
- Verified cmux binary path.

## Operation

1. Use [cmux detect](../../_atoms/cmux-detect/cmux-detect.md) to determine
   whether cmux is available and to capture caller context.
2. If cmux is absent, return a degraded session record and stop cmux work.
3. Validate `identify`, `tree`, `list-panes`, and `list-pane-surfaces` through
   [cmux invoke](../../_atoms/cmux-invoke/cmux-invoke.md) before use.
4. Use [cmux topology](../../_atoms/cmux-topology/cmux-topology.md) to build a
   caller-workspace topology and ownership baseline.

## Output

A session record containing detection status, caller workspace, caller pane,
caller surface, verified verbs used, topology, and any degradation category.

## Guarantees

- Session setup degrades cleanly outside cmux.
- The caller workspace anchors all later operations.
- No unverified cmux command is invoked.

## Boundaries

This molecule does not create helper panes, create agent surfaces, send input,
or supervise output.
