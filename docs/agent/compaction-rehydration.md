# Active skill compaction rehydration

This repository installs a GitHub Copilot CLI repository hook that rehydrates
canonical instructions for active, Chronicle-correlated skill runs after
context compaction.

## Contract

1. Chronicle run-start recording registers the root or nested skill, canonical
   `SKILL.md` and required Markdown references, relative paths, and SHA-256
   digests. When Chronicle lacks the optional runtime session identifier, the
   hook-observed identifier deterministically claims one unambiguous bounded
   pending run; ambiguity reports degradation rather than silently staying
   inactive.
2. `preCompact` synchronously arms a new bounded generation.
3. While armed, local command `preToolUse` permits only the next exact,
   full-file canonical `view` read. Other material tool operations are denied.
4. Successful `postToolUse` observations re-read the file from disk and compare
   its path and digest. The final match clears the latch once and returns the
   bounded run checkpoint through `additionalContext`.
5. `agentStop` may force one recovery turn. It then yields rather than approach
   the runtime's eight-consecutive-block guard.
6. `sessionStart` with `source: resume` re-arms persisted active runs.

Repeated compactions create new generations. A stale generation, wrong run or
skill identity, missing or moved file, changed digest, partial read, and forged
model acknowledgement cannot clear the latch. Rehydration is a read, not a
skill invocation, so it cannot recursively create a run.

## Stored data

State below `.skill-log/rehydration/` is bounded, owner-only, atomically
replaced, and serialized across subprocesses with a bounded crash-recoverable
lock. It stores
opaque session/run identities, skill names, repository-relative paths,
digests, byte counts, lifecycle identifiers, timestamps, and counters. It does
not store prompts, secrets, transcripts, tool results, canonical file content,
or arbitrary Chronicle summaries.

## Enforcement truth

| Disposition | Meaning |
| --- | --- |
| `policy-enforced` | An administrator installed the gate, command implementation, and state root as administrator-controlled policy. It cannot be disabled by `disableAllHooks`, but its timeout still fails open. Pointing policy configuration at repository-owned code is not this disposition. |
| `hook-enforced-but-disableable` | The checked-in repository hook gates local tool calls, but an operator may disable repository hooks. This repository ships this disposition. |
| `warn-only` | A provider can inject a notice but cannot intercept material operations. |
| `unsupported` | The provider exposes neither a usable gate nor context injection. |

GitHub's documented hook surface has no `postCompact` event. `preCompact` is
notification-only. Command `preToolUse` fails closed on crashes and non-zero
exits, while every timeout fails open, including policy hooks. Hook
configuration is loaded only at CLI startup. Whether `preCompact` fires
independently for every subagent is undocumented; no adapter may claim it.
Cloud agent supports automatic, not manual, compaction.

Chronicle records latch, gate, acknowledgement, and degraded outcomes when hook
execution reaches the recorder. Native session events remain the evidence that
compaction itself started or completed. Post-mortem must report missing hook
evidence as unobserved, because disabled or timed-out hooks cannot reliably
record their own absence.

Crash, non-zero, timeout, disabled-hook, and hook-reload behavior ultimately
belongs to the Copilot runtime. Repository tests verify the local command's
exit codes, decisions, state transitions, and configuration; an end-to-end
runtime integration test is still required to prove how a particular installed
CLI build consumes them.

Official references:

- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks
- https://docs.github.com/en/copilot/reference/hooks-reference
- https://docs.github.com/en/copilot/concepts/agents/hooks
