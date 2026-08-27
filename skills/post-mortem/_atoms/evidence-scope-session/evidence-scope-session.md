---
name: evidence-scope-session
description: Declare the session evidence boundary, classify completeness as complete, partial, compacted, or summary-only, and apply the confidence cap that follows from it.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["post-mortem/_molecules/evidence-assemble/evidence-assemble.md"]
---

# Evidence Scope for One Session

Fix what may be analyzed before anything is analyzed. The boundary is the first
thing declared and the last thing relaxed.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `session` | yes | The current interaction as it is visible right now. |
| `runtime-metadata` | no | Current-session metadata the runtime provides. |
| `selected-session-log` | no | One Copilot session event log whose identity the reader established. |

## Operation

1. **Admit** only evidence available in the current session:
   - operator messages;
   - agent responses;
   - visible tool requests and results;
   - returned subagent results;
   - artifacts created or inspected during the session;
   - runtime-provided current-session metadata.
2. **Admit** one Copilot session event log when the session-event reader
   established its identity: the operator or the runtime named it, or the reader
   proved exactly one running session. It is raw runtime evidence, and it
   carries its own completeness and its own cap. Never resolve the newest file,
   never break a tie between two possible sessions, and never open a log whose
   identity the reader refused. A refused or ambiguous identity is a limitation
   to record, after which the analysis continues on visible session evidence.
3. **Refuse** every reconstruction of earlier interactions. Do not query session
   history, memory stores, trackers, communications, repositories, or external
   systems. An operator-provided summary of earlier work is testimony in the
   current session, not independently observed history.
4. **Classify** completeness:
   - **Complete:** the relevant interaction and tool events are visible.
   - **Partial:** a known portion is unavailable.
   - **Compacted:** earlier content was summarized.
   - **Summary-only:** only a retrospective summary is available.
5. **Resolve** more than one applicable condition to the most restrictive value
   in this order: `summary_only`, `compacted`, `partial`, `complete`. Record the
   other conditions under limitations.
6. **Cap** confidence. Partial, compacted, or summary-only evidence caps every
   confidence value, including per-item confidence, at **Moderate**.
7. **Refuse to estimate** unavailable duration, token usage, message count,
   retry count, model setting, or other telemetry. Mark it `not_observable`.
   A count read from a selected session log is observed, not estimated, and is
   reported with the anchors that support it.

## Output

| Field | Meaning |
| --- | --- |
| `evidence_completeness` | `complete`, `partial`, `compacted`, or `summary_only`. |
| `confidence_cap` | `none`, or `moderate` when the boundary caps it. |
| `limitations` | Every condition that applied but was not reported as the value. |

## Guarantees

- The boundary is declared before any finding is formed.
- The reported completeness is the most restrictive applicable value, never the
  most convenient one.
- No unavailable telemetry is estimated. It is `not_observable`.

## Boundaries

Three sources sit outside this atom and do not widen the session boundary:

- A Copilot session event log whose identity the reader established, which
  carries its own completeness declaration and cap.
- A Skill Run Log the operator explicitly selects, which carries its own
  completeness declaration and its own cap. Caps compound, and the most
  restrictive applicable cap wins.
- Package grounding for a retained reusable candidate, which may inspect only
  the repository containing this skill package.

Incomplete session evidence is a limitation to report. It is never a reason to
reach for another evidence source, and never a reason to relax the identity rule
that decides which log may be read.

**Error recovery.** With no usable session evidence, do not stop silently:
report `no_material_finding: true`, mark unavailable fields `not_observable`,
and record the limitation. With a compacted or partial session, declare the
boundary, cap every confidence value at `moderate`, and reconstruct nothing.
