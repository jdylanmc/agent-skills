---
name: chronicle-append
description: Append one bounded event to a Skill Run Log. Recording is best effort; a failure is reported and never blocks delivery.
level: atom
allowed-tools: ["execute"]
includes: []
composes: []
used-by: ["_base/_molecules/chronicler/chronicler.md"]
---

# Chronicle Append

Append exactly one bounded event to a Skill Run Log. This atom observes what
happened. It owns no claims, merges, provider state, or delivery authority, and
it holds no mutable control state.

Recording is best effort. A caller that cannot record reports the failure,
marks its evidence incomplete, and continues delivering.

## Operation

```text
node <atoms>/chronicle-append.mjs \
  --log "$log_path" --run "$run_id" --root-skill "$root_skill" \
  --skill "$emitting_skill" \
  --event <stable-event-name> --phase <before|after|observation> \
  --summary "<short bounded summary>" \
  [--operation <operation-id>] [--outcome <outcome>] [--evidence <reference>]...
```

Exit `0` means the event was appended. Any non-zero exit prints a stable
failure category on standard error. Report that category, mark evidence
incomplete, and continue. Check availability with `--probe`.

## Caller Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `--event` | yes | A stable event name reused across runs, such as `run` or `ticket_merge`. |
| `--phase` | yes | `before` for intent, `after` for outcome, `observation` for an observed fact. |
| `--summary` | yes | One short sentence describing what happened. |
| `--skill` | no | The emitting skill. Defaults to the root skill. |
| `--operation` | no | A stable identifier that pairs a `before` event with its `after` event. |
| `--outcome` | no | A short result token on an `after` or `observation` event, such as `succeeded` or `failed`. |
| `--evidence` | no | A short external reference such as a pull-request number or commit. Repeatable. |

Names use letters, digits, and `.`, `_`, or `-`, and start with a letter or
digit. Summaries carry no control characters.

## Fields Supplied For You

`schema_version` and `timestamp` are supplied by the implementation. A caller
never sets them.

`run_id`, `root_skill`, and `skill` come from the run context rather than from
per-event caller judgement: the root skill fixes `run_id` and `root_skill` once
for the whole run, and `skill` defaults to `root_skill` unless a nested
participant names itself with `--skill`.

Every field is validated and an unknown field is rejected, so a caller never
constructs the persisted record directly.

## Bounds

- An identifier such as an event, skill, operation, or outcome name is limited
  to 100 UTF-8 bytes.
- A summary is limited to 500 UTF-8 bytes and carries no control characters,
  including tabs and line breaks.
- An evidence reference is limited to 200 UTF-8 bytes, and at most 10 are kept.
- A complete event is limited to 4096 UTF-8 bytes.

An over-long summary or evidence reference is truncated on a codepoint boundary
and the event is marked `truncated`. An over-long identifier is rejected
outright, because a name is a caller mistake rather than overflowing content.

## Log Target

`--log` must name an absolute `.jsonl` path. The append refuses to write
through a symbolic link, to anything that is not a regular file, or to a
non-empty file whose first line is not a Chronicle record. A mistyped path
fails instead of appending to an unrelated file.

## Excluded Content

Never pass raw conversations, prompts, internal reasoning, full tool output,
source code, review bodies, credentials, or secret-bearing text. Record a
reference to the evidence instead of the evidence itself.

## Pairing

A material operation appends `before` with an `--operation` identifier and later
appends `after` with the same identifier and an `--outcome`. Replay reports an
operation that records intent without an outcome, which is what makes an
interrupted run diagnosable.

## Ordering

Records carry no writer-assigned sequence. Physical log position is the only
ordering, and replay assigns a sequence from it. There is no cross-writer global
ordering guarantee, and callers must not depend on one.

Because position is assigned on read rather than raced on write, ordinary
concurrent writers produce a clean log.
