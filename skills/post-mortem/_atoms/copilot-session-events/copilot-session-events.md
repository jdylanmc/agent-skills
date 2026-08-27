---
name: copilot-session-events
description: Read one explicitly selected Copilot session event log and return bounded, redacted, anchored evidence - skill invocations, turns, tool calls, subagents, failures, and shutdown - reporting every malformed, unknown, drifted, or unfinished record as a limitation. Read only, and never searches for a log.
level: atom
allowed-tools: ["execute"]
includes: ["post-mortem/_atoms/copilot-session-events/copilot-session-events.mjs"]
composes: []
used-by: ["post-mortem/_molecules/evidence-assemble/evidence-assemble.md"]
---

# Copilot Session Event Evidence

A Copilot session log is the raw record of what the runtime observed. It is the
strongest available evidence about what actually happened, and it is also the
file that holds every prompt, every tool result, and the full text of every
skill that was loaded. This atom exists so the first fact can be used without
the second one leaking.

It reads one log the operator explicitly selected and returns a projection:
identities, kinds, outcomes, counts, and anchors. Content fields never leave
the reader.

## Required Files

1. [Session event reader](./copilot-session-events.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `selected-path` | yes | One `events.jsonl` path the operator named. |
| `log-id` | no | An opaque identifier to publish instead of the path. |
| `max-events` | no | The bound on listed material events. |

## Operation

```text
node <atoms>/copilot-session-events.mjs "$selected_path" [--log-id <opaque-id>] [--max-events <n>]
```

Exit `0` prints the projection as JSON, including its limitations. A non-zero
exit means the selection was refused, and prints one JSON failure object on
standard error with a stable `code`: `no_selection`, `not_a_file`,
`unreadable_selection`, or `usage`. Check availability with `--probe`.

## Selection Is Explicit

The reader takes one path. It does not list a directory, expand a pattern, sort
by modification time, or resolve a "current" or "latest" session, and no option
asks it to. Selecting a session directory is refused rather than resolved to the
`events.jsonl` inside it, because choosing the file is the operator's decision
and the difference between a named log and a guessed one is the whole boundary.

A session the operator did not select is not evidence. Its absence is a
limitation to report, never a reason to go looking.

## What Is Extracted, and What Is Never Extracted

Extracted, per supported event:

| Event | Published |
| --- | --- |
| `session.start`, `session.resume` | Session identity and producer. |
| `session.shutdown` | That the session ended, and its shutdown type. |
| `session.compaction_start`, `session.compaction_complete` | That context was compacted. |
| `abort` | That the session was aborted, and the recorded reason. |
| `session.error` | That the session raised an error, its error type, and its status code. |
| `user.message`, `assistant.message` | Counts only. |
| `assistant.turn_start`, `assistant.turn_end` | Turn counts, repeated starts, and turns that never ended. |
| `tool.execution_start`, `tool.execution_complete` | Call counts by tool name, failures, and requests with no result. |
| `subagent.started`, `subagent.completed`, `subagent.failed` | Spans by agent name with their outcome, and the events enclosed by each span. |
| `skill.invoked` | Skill name, source, trigger, and the enclosing subagent when there is one. |
| `permission.completed` | A non-allowing outcome. |

Every other supported event is counted by type and contributes nothing else.

Never extracted: operator prompts, assistant messages, tool arguments, tool
results, attachments, skill file contents, error messages and stack traces,
file paths carried inside events, or any other free-text payload. A field
reaches the output only by being named above. Every published string is stripped
of control characters, bounded in length, and passed through the repository's
shared redaction floor, so a name that unexpectedly carries a secret is marked
rather than published.

## Anchors

An anchor is the physical line of the record, written `E12`, and a range as
`E12-18`. The `E` series is distinct from the session anchors `U`, `A`, `T`,
`S`, `R`, and `M`, and from the `L` series used by a Skill Run Log, so a claim
always shows which source it came from.

## Limitations Are Reported, Never Repaired

| Code | Meaning |
| --- | --- |
| `malformed_record` | The line is not valid JSON. |
| `torn_final_record` | The last line was still being written. |
| `blank_record` | A blank line appears inside the log. |
| `invalid_record` | The record carries no event type. |
| `unrecognized_event` | The event type is outside the supported vocabulary. |
| `schema_drift` | A supported event no longer carries a field the reader depends on. |
| `duplicate_turn_start` | A turn records its start more than once. |
| `unmatched_turn_end` | A turn ends with no recorded start. |
| `incomplete_turn` | A turn starts and never ends. |
| `unmatched_tool_completion` | A tool result has no recorded request. |
| `incomplete_tool_call` | A tool request records no result. |
| `unmatched_subagent_completion` | A subagent ends with no recorded start. |
| `incomplete_subagent` | A subagent starts and never completes. |
| `foreign_session` | A second session identity appears in the log. |
| `session_start_absent` | The selection does not begin at a session start. |
| `session_incomplete` | The session records no shutdown. |
| `session_aborted` | The session records an abort. |
| `context_compacted` | The session compacted its context. |
| `no_usable_records` | The selection holds no usable event. |
| `event_budget_exhausted` | More material events exist than the bound lists. |
| `limitation_budget_exhausted` | More limitations exist than the bound lists. |
| `line_budget_exhausted` | The log is longer than the line bound. |
| `oversized_record` | One record exceeded the record bound and was not read. |

Nothing here is reconstructed. A missing record stays missing, a drifted event
keeps only the fields it actually carries, and an unknown event type is named
rather than mapped onto a known one.

## Completeness and Confidence

The reader declares completeness from what it read:

- **complete:** no limitation was found;
- **compacted:** the session compacted its context;
- **partial:** any other limitation applied.

Anything other than `complete` caps confidence at **Moderate** for every finding
that depends on the affected records. This cap compounds with the caps declared
for the current session and for any selected Skill Run Log, and the most
restrictive cap wins.

## Output

| Field | Meaning |
| --- | --- |
| `log_id` | The selected path, or the supplied opaque identifier. |
| `session_id`, `producer` | Session identity, when the log records it. |
| `counts` | Event counts by type, and the derived message, turn, tool, subagent, and skill counts. |
| `turns`, `tools`, `subagents`, `skills` | Bounded per-kind evidence with anchors. |
| `events` | Material events in encounter order, each with its `E` anchor. |
| `limitations` | Every reported condition, with its anchor where one applies. |
| `evidence_completeness`, `confidence_cap` | The declared boundary and the cap it imposes. |

## Guarantees

- No log is read that the operator did not select, and no log is discovered.
- No prompt, tool result, or skill body appears in the output.
- A defect is reported with its anchor rather than repaired, reordered, or
  inferred.
- The same input produces the same output, with no clock, environment, or
  network input.

## Boundaries

This atom reads. It forms no finding, judges no severity, proposes nothing, and
never writes to the selected log. Absence of a `skill.invoked` record proves
that this log holds no such record; it is not evidence that a skill failed to
run, because a session log and a Skill Run Log record different things.

**Error recovery.** A refused selection is reported with its code and the
post-mortem continues on session evidence alone. A readable log with defects is
used for the records that remain usable, with the cap applied and every defect
listed.
