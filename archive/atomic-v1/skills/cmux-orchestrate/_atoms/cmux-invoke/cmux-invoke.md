---
name: cmux-invoke
description: Validate every cmux command against the installed-build allow-list before any invocation.
level: atom
allowed-tools: ["execute"]
includes: []
composes: []
disable-model-invocation: false
user-invocable: false
used-by: ["cmux-orchestrate/_molecules/cmux-fanout/cmux-fanout.md","cmux-orchestrate/_molecules/cmux-session/cmux-session.md","cmux-orchestrate/_molecules/cmux-supervise/cmux-supervise.md"]
---

# cmux Invoke

## Inputs

- A candidate cmux argument vector.
- The verified command allow-list for this package.

## Operation

1. Extract the first argument as the cmux verb.
2. Reject a missing or unknown verb with stable category `cmux_unknown_verb` or
   `cmux_command_missing` before invocation.
3. Allow only these installed-build verified verbs: `identify`,
   `list-workspaces`, `current-workspace`, `tree`, `list-panes`,
   `list-pane-surfaces`, `new-pane`, `new-surface`, `read-screen`, `send`, and
   `send-key`.
4. Invoke cmux only after validation succeeds.

## Output

A validated invocation record, or a refusal record with a stable category and no
process execution.

## Guarantees

- Unknown verbs fail before invocation.
- The non-existent verbs `list-surfaces`, `send-surface`, and
  `send-key-surface` are refused.
- Validation is deterministic and independent of cmux runtime state.

## Boundaries

This atom does not decide ownership, workspace authorization, prompt content, or
how command output should be interpreted.
