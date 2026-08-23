---
name: chronicle-replay
description: Replay one explicitly selected Skill Run Log and return the reconstructed run state with any defects. Read only.
level: atom
allowed-tools: ["execute"]
includes: []
composes: []
used-by: ["_base/_molecules/chronicler/chronicler.md"]
---

# Chronicle Replay

Reconstruct Skill Run State from one explicitly selected Skill Run Log. This
atom is read only. It never repairs, reorders, or invents evidence, and it never
repeats a recorded side effect.

## Operation

```text
node <atoms>/chronicle-replay.mjs "$selected_log_path" [--log-id <opaque-id>]
```

Exit `0` prints the reconstructed state as JSON, including any defects. A
non-zero exit means the selected log could not be read at all. Use `--log-id`
when the absolute path must stay out of published output. Check availability
with `--probe`.

Replay only a log the operator explicitly selected. Never infer a run from the
newest file on disk.

## Result

- `log_id` - the selected path, or the opaque identifier supplied with `--log-id`;
- `run_id` and `root_skill` - taken from the first usable record;
- `skills` - every skill that recorded an event;
- `event_count` and `events` - usable events, each carrying an `Lnnn` anchor;
- `operations` - each operation with its start anchor, completion anchor, and outcome;
- `defects` - every problem found, each with an anchor;
- `complete` - true only when no defect was found.

## Anchors

An anchor is the physical line of the record in the selected log, written
`L12`. Cite findings by log identity, run identity, and anchor or anchor range.

## Defects

| Type | Meaning |
| --- | --- |
| `malformed_record` | The line is not valid JSON. |
| `invalid_record` | The record does not satisfy the event schema or its bounds. |
| `blank_record` | A blank line appears inside the log. |
| `foreign_run` | The record belongs to a different run. |
| `run_identity_drift` | The run identifier matches but the root skill changed. |
| `duplicate_operation_start` | An operation records intent more than once. |
| `duplicate_operation_outcome` | An operation records an outcome more than once. |
| `operation_out_of_order` | An operation records intent after its outcome. |
| `incomplete_operation` | An operation records intent with no outcome. |
| `unmatched_outcome` | An operation records an outcome with no intent. |
| `no_usable_records` | The log holds no usable event. |

A defect never stops replay. Later records stay usable, and the reader decides
how much confidence the remaining evidence supports.

Every persisted bound is revalidated on read, so a record edited outside the
append path is reported rather than trusted.

## Consumer Rules

- Analyze only a log the operator explicitly selected.
- Treat `complete: false` as incomplete evidence and cap confidence for any
  finding that depends on the affected records.
- Report each defect rather than working around it.
- Never write to a Skill Run Log while reading it.
