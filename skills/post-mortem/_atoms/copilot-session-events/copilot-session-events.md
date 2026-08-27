---
name: copilot-session-events
description: Resolve which Copilot session event log may be read - a named path, a runtime-named transcript or session, or exactly one session the operating system still proves is running - and return bounded, redacted, anchored evidence: skill invocations, turns, tool calls, subagents, failures, and shutdown. Refuses an ambiguous identity, never ranks by recency, and reports every malformed, unknown, drifted, or unfinished record as a limitation. Read only.
level: atom
allowed-tools: ["execute"]
includes: ["post-mortem/_atoms/copilot-session-events/copilot-session-events.mjs"]
composes: []
used-by: []
---

# Copilot Session Event Evidence

A Copilot session log is the raw record of what the runtime observed. It is the
strongest available evidence about what actually happened, and it is also the
file that holds every prompt, every tool result, and the full text of every
skill that was loaded. This atom exists so the first fact can be used without
the second one leaking.

It reads one log whose identity it can prove, and returns a projection:
identities, kinds, outcomes, counts, and anchors. Content fields never leave the
reader, and an identity it cannot prove is refused rather than guessed.

## Required Files

1. [Session event reader](./copilot-session-events.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `selected-path` | no | One `events.jsonl` path the operator or the runtime named. |
| `transcript-path` | no | An exact transcript path the runtime supplied. |
| `session-id` | no | A session identifier to resolve under the session root. |
| `session-root` | no | The session-state directory, when the runtime did not name it. |
| `log-id` | no | An opaque identifier to publish instead of the path. |
| `max-events` | no | The bound on listed material events. |

## Operation

```text
node <atoms>/copilot-session-events.mjs [<selected-path>] [--transcript <path>]
    [--session-id <id>] [--session-root <path>] [--log-id <opaque-id>]
    [--max-events <n>] [--resolve]
```

Exit `0` prints the projection as JSON, including its limitations. A non-zero
exit means the selection was refused, and prints one JSON failure object on
standard error with a stable `code`. Use `--resolve` to print the resolved
identity without reading the log, and `--probe` to check availability.

## Identity Is Proved, and Failure Is Closed

Reading the wrong session is worse than reading none, because a post-mortem
built on another session's evidence is confidently wrong and nothing downstream
can tell. So a log is read only when its identity is established, by exactly one
of these, strongest first:

| Kind | Established by |
| --- | --- |
| `explicit-path` | The operator or the runtime named the file. |
| `runtime-transcript` | The runtime supplied an exact transcript path that exists. |
| `session-id` | A named session identifier resolved under the session root. |
| `live-process-lock` | Exactly one running session under the root is held by this process or one of its ancestors. |
| `sole-live-session` | Exactly one session under the whole root is still running, with no lineage match. |

A session is a discovery candidate only when it carries an in-use lock naming a
process the operating system still knows about, and holds a readable log. A
stale lock, a lockless directory, and a live session with no log are not
candidates. Nothing is ranked: **the newest file is never the answer**, no
pattern is expanded, and no tie is broken.

A named path is checked the same way a runtime-named transcript is, so every
identity fails in the same shape: a path that is a directory or does not exist
is `unreadable_selection` here rather than an exception several steps later.

### What Discovery Rests On, and Where It Stops

Discovery is identity by process, so it inherits that mechanism's limits and
states them rather than implying more certainty than it has:

- **Process lineage is read with `ps`, so it is POSIX-only.** On Windows, and
  wherever the process table cannot be read, the lineage is reported
  unavailable rather than returned short and treated as complete. A
  `live-process-lock` identity is therefore not available on Windows; discovery
  degrades to the stricter sole-running-session rule, and with more than one
  running session it refuses with `session_identity_ambiguous`, saying the
  platform is why. It never silently downgrades a proof it did not have.
- **A process identifier can be reused** after a process exits, so every
  discovered identity carries the note `identity_rests_on_process_id`. A
  `sole-live-session` identity carries a second note saying it rests on being
  the only running session rather than on lineage, and a third when the platform
  could not supply a lineage at all. The notes travel with the evidence so a
  reader can weigh the claim rather than take it on trust.

Anything else refuses, with a stable code the caller records as a limitation:

| Code | Meaning |
| --- | --- |
| `session_identity_ambiguous` | More than one running session could be the current one. |
| `session_identity_unavailable` | No running session could be proved. |
| `session_root_unknown` | Neither the caller nor the runtime named a session root. |
| `session_root_unreadable` | The named session root could not be read. |
| `session_root_too_large` | The root holds more sessions than the scan bound. |
| `session_id_not_found` | The named session has no readable log under the root. |
| `session_id_invalid` | The identifier names more than one directory. |
| `runtime_transcript_missing` | The runtime named a transcript that is not a readable file. |
| `not_a_file`, `unreadable_selection`, `usage` | The selection itself could not be read. |

The session root comes from the caller, from `COPILOT_SESSION_STATE_ROOT`, or
from `COPILOT_HOME`. It is never guessed from the home directory, and a session
identifier is used only when it was supplied, never read from the environment
and hoped to match.

A refusal is a designed outcome, not an error to work around. The caller records
the code and continues on the evidence it can already see. A `sole-live-session`
identity carries the note that it rests on being the only running session, so a
reader can weigh it accordingly.

## What Is Extracted, and What Is Never Extracted

Extracted, per supported event:

| Event | Published |
| --- | --- |
| `session.start`, `session.resume` | Session identity and producer. |
| `session.shutdown` | That the session ended, and its shutdown type. |
| `session.compaction_start`, `session.compaction_complete` | The beginning and the end of a context compaction, as two distinct neutral kinds so one compaction is never counted twice. |
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
| `unmapped_event` | The adapter records the event but maps it to no neutral evidence kind. |
| `schema_drift` | A supported event no longer carries a field the reader depends on. |
| `session_identity_contradiction` | The log claims a different session than the one whose identity was proved. |
| `session_identity_unpublishable` | The recorded session identity is a filesystem path and was withheld. |
| `event_type_budget_exhausted` | More distinct event types appear than the budget names; the rest are counted together. |
| `open_operation_budget_exhausted` | More operations are open at once than the budget tracks; the rest are counted. |
| `anchor_list_budget_exhausted` | More unfinished operations exist than the record lists. |
| `repeated_limitation` | One kind of limitation occurred more often than it is listed. |
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
| `log_id` | An opaque identifier for the source; never a filesystem path. |
| `identity` | How identity was established, with the session identifier and holding process. |
| `identity_notes` | Caveats attached to the identity, such as a sole-live-session claim. |
| `session_id`, `producer` | Session identity, when the log records it. |
| `counts` | Event counts by type, and the derived message, turn, tool, subagent, and skill counts. |
| `turns`, `tools`, `subagents`, `skills` | Bounded per-kind evidence with anchors. |
| `events` | Material events in encounter order, each with its `E` anchor. |
| `limitations` | Every reported condition, with its anchor where one applies. |
| `evidence_completeness`, `confidence_cap` | The declared boundary and the cap it imposes. |

## Guarantees

- No log is read whose identity was not established by one of the rules above.
- Ambiguity refuses. Two possible current sessions produce no reading at all.
- Recency is never evidence of identity.
- A published identifier is opaque; no absolute path leaves the reader.
- No prompt, tool result, or skill body appears in the output.
- An event this adapter records but cannot map is reported, never dropped.
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
## Published Identity

`log_id` is never a filesystem path. It is the session identity when the log
records one, written `session:<session-id>`; otherwise it is a SHA-256 digest of
the path, written `sha256:<hex>`, which still lets two readings of one file be
recognized as the same source. A caller may supply its own opaque identifier,
and a caller that supplies a path as its "identifier" gets the digest instead.

A published string is redacted before it is bounded and again afterwards, so a
secret that begins inside the bound and runs past it is marked rather than
truncated into a usable fragment, and a redaction marker is never split in half.

**The log is the untrusted half of an identity.** When discovery proved which
session this is and the log claims another, the proof wins, the claim is kept
beside it, and `session_identity_contradiction` is reported. A recorded session
identity shaped like a filesystem path is withheld rather than republished, and
the reading continues with everything else it holds.

**A name that came out of a log is not automatically publishable.** An event
type, a session identity, or a caller-supplied identifier is published only when
it is a short, safe name; otherwise it is counted or withheld, never echoed. The
native counts a ledger carries therefore have sanitized keys, with everything
unsafe or over the budget folded into `other_event_types`.

## Bounds Against a Hostile Log

Every collection built from a log is bounded, and every bound reports itself:
at most 100 distinct event types are named, at most 5,000 operations are tracked
as open, at most 200 unfinished operations are listed by anchor, and one kind of
limitation is listed at most 20 times before it is summarized. A log that
exceeds a budget still produces a usable reading; it produces a smaller one, and
says so.

## The File That Is Read Is the File That Was Named

The selection is opened once and verified through the descriptor rather than
checked and opened separately, because a path can be replaced between the two.
A symbolic link is refused: `O_NOFOLLOW` refuses it at open time where the
platform provides the flag, and where it does not, the link is refused before
the open and the descriptor is confirmed to be a regular file afterwards.
