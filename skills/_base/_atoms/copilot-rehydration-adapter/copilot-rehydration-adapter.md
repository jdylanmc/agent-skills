---
name: copilot-rehydration-adapter
description: Translate documented GitHub Copilot CLI hook payloads into the provider-neutral compaction-rehydration state machine and report the exact enforcement disposition.
level: atom
includes: ["_base/_atoms/copilot-rehydration-adapter/copilot-rehydration-adapter.mjs"]
composes: []
used-by: ["_base/_molecules/compaction-rehydration/compaction-rehydration.md"]
---

# Copilot Rehydration Adapter

## Required Files

1. [GitHub Copilot hook adapter](./copilot-rehydration-adapter.mjs)

Translate `preCompact`, `preToolUse`, `postToolUse`, `agentStop`, and
`sessionStart(source=resume)` payloads without leaking Copilot field names into
the provider-neutral state machine.

The repository hook disposition is
`hook-enforced-but-disableable`. Repository, user, and plugin hooks may be
disabled. Only an administrator-installed policy hook whose command and state
root are themselves administrator-controlled is `policy-enforced`; copying a
repository command into policy configuration does not make repository-owned
code a policy boundary. A surface that can inject a warning but cannot gate is
`warn-only`; one with neither interception nor injection is `unsupported`.

Documented limitations remain explicit:

- `preCompact` is notification-only and there is no `postCompact` hook.
- local command `preToolUse` fails closed on crashes and non-zero exits, but
  every hook timeout fails open;
- `postToolUse.additionalContext` is capped by the runtime at 10 KB;
- `agentStop` is bounded below the runtime's eight consecutive blocks;
- hook configuration is loaded only when the CLI starts;
- whether every subagent receives `preCompact` is undocumented.
