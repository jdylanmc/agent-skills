---
name: compaction-rehydration
description: Rehydrate canonical active-skill instructions after context compaction through a provider-neutral state machine and a separate GitHub Copilot hook adapter.
level: molecule
includes: ["_base/_atoms/rehydration-state/rehydration-state.md","_base/_atoms/copilot-rehydration-adapter/copilot-rehydration-adapter.md"]
composes: ["_base/_atoms/rehydration-state/rehydration-state.md","_base/_atoms/copilot-rehydration-adapter/copilot-rehydration-adapter.md"]
used-by: ["_base/_molecules/chronicler/chronicler.md"]
allowed-tools: []
---

# Compaction Rehydration

## Required References

1. [Provider-neutral rehydration state](../../_atoms/rehydration-state/rehydration-state.md)
2. [GitHub Copilot rehydration adapter](../../_atoms/copilot-rehydration-adapter/copilot-rehydration-adapter.md)

Keep active skill boundaries available after compaction without treating a
summary as canonical instruction.

The provider-neutral state atom owns identities, canonical read manifests,
digests, transitions, idempotence, and bounded checkpoints. Provider adapters
own event translation and accurately classify their enforcement strength.

The GitHub Copilot adapter uses the documented corrected sequence:

```text
preCompact -> synchronously arm
preToolUse -> permit only the next exact canonical full-file read
postToolUse -> verify path and digest; clear once; inject checkpoint
agentStop -> force at most one consecutive recovery turn
sessionStart(source=resume) -> re-arm an active persisted run
```

Rehydration means read, not invoke. It does not create a run, grant permission,
change scope, approve a finding, or authorize publication or merge.
