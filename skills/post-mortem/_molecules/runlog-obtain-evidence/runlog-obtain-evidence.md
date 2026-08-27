---
name: runlog-obtain-evidence
description: Obtain evidence from a Skill Run Log the operator explicitly named, replay it read-only, anchor its records in an L slot, declare its completeness, and decide whether independent runs establish recurrence.
level: molecule
includes: ["_base/_atoms/chronicle-replay/chronicle-replay.md","post-mortem/_atoms/evidence-anchor-ledger/evidence-anchor-ledger.md"]
composes: ["_base/_atoms/chronicle-replay/chronicle-replay.md","post-mortem/_atoms/evidence-anchor-ledger/evidence-anchor-ledger.md"]
used-by: ["post-mortem/SKILL.md"]
allowed-tools: ["execute"]
---

# Skill Run Log Evidence

A Skill Run Log is an optional, operator-selected evidence source. It never
replaces session evidence and never widens the post-mortem into repository or
history analysis.

## Curated Evidence, Beside Raw Evidence

A Skill Run Log and a runtime session log record different things, and
neither is derived from the other.

- A **runtime session log** is raw runtime observation: what the runtime
  saw happen, whether or not any skill chose to record it. It is authoritative
  about occurrence - that a turn ran, a tool failed, a subagent returned.
- A **Skill Run Log** is curated semantic evidence: what a skill declared it was
  doing and how that operation turned out. It is authoritative about intent and
  outcome as the skill understood them.

Use each for what it can support. A raw log cannot say why an operation was
attempted; a run log cannot say what else the session did. When both are
selected, cite both anchors on a shared claim rather than counting one event
twice, and prefer the raw log for occurrence and the run log for intent.

**Correlate by recorded identity, never by proximity.** Chronicle records the
harness and session a run belonged to when the runtime made them available, so a
selected run log either shares the session identity of the raw evidence, belongs
to a different session, or records no correlation at all. Report which of the
three it is. Two logs written around the same time are not thereby the same
session, and a log with no correlation is uncorrelated rather than mismatched -
it remains evidence about the run it describes.

**The absence of a Skill Run Log is not evidence of a missing invocation.**
Recording is best effort, so a run may be real and unrecorded. Report the
absence as a limitation and draw no conclusion from it.

## Required References

1. [Chronicle replay](../../../_base/_atoms/chronicle-replay/chronicle-replay.md)
2. [Evidence anchor ledger](../../_atoms/evidence-anchor-ledger/evidence-anchor-ledger.md)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `operator-request` | yes | An explicit operator request about a recorded run. |
| `log-path` | no | A directory or path the operator supplies. |

## Selection

1. Raise this source only in response to an operator request about a recorded
   run. Never offer it unprompted, and never reach for it merely because the
   current session is partial, compacted, or summary-only. A gap in session
   evidence is a limitation to report, not a reason to analyze another run.
2. Discover candidates in the `.skill-log/` directory at the repository root for
   the current run context, or at a path the operator supplies. If neither
   exists, record that no candidate log is available under limitations and
   continue with session evidence. Never search the filesystem for logs.
3. List candidates by skill, date, and run identifier. Never open one before the
   operator names it.
4. Analyze exactly one run by default.
5. Analyze more than one run only when the operator explicitly selects a
   comparison set, and only if the runs are independent of each other.
6. If the operator declines, or no log exists, continue with session evidence
   alone and record the absence under limitations.

Never infer a run from the newest file, and never substitute a log the operator
did not name.

## Replay

Replay a selected log with
[Chronicle replay](../../../_base/_atoms/chronicle-replay/chronicle-replay.md),
which owns the command surface and the defect vocabulary. Never parse the file
by hand, never write to it, and never treat raw bytes as clean evidence when
replay reports a problem.

If replay cannot read the selection at all, or returns no usable event, treat
the log as unavailable: record the log identifier and the reported defect under
limitations, and draw no finding from it.

Use `--log-id` so published output carries an opaque run identifier instead of
an absolute path.

## Anchors

Give each selected log a slot in selection order: `L1`, `L2`. Anchor records
through
[Evidence anchor ledger](../../_atoms/evidence-anchor-ledger/evidence-anchor-ledger.md)
as `<slot>:<line>`, for example `L1:12`, and a range as `L1:12-18`. These
anchors never collide with session anchors, which use `U`, `A`, `T`, `S`, `R`,
and `M`.

Every finding drawn from a log cites the log identifier, the run identifier, and
an anchor or anchor range.

## Completeness and Confidence

Declare completeness for each selected run from the replay result:

- **complete:** replay reported no defect;
- **incomplete:** replay reported one or more defects.

Report every defect with its type and anchor. Never repair, reorder, or infer a
missing event, and never present a reconstructed value as observed.

An incomplete run caps confidence at **Moderate** for any finding that depends
on the affected records. A finding that depends only on unaffected records keeps
its own confidence. Session completeness caps apply independently, and the most
restrictive cap wins.

An operation that records intent with no outcome is evidence that the run
stopped there. It is not evidence of the cause, so state the cause as a
hypothesis unless an observation records it.

## Recurrence

Two or more independently selected runs may support `OBSERVED` when the same
pattern appears in each and the runs are not two attempts at the same work.

Repetition inside one run is not recurrence. Repeated wording about one event is
not corroboration. If independence cannot be established, keep the candidate
`PROPOSED` and record why.

## Output

| Field | Meaning |
| --- | --- |
| `selected_logs` | Each with its slot, log identifier, run identifier, and completeness. |
| `correlation` | Per selected log: `same-session`, `different-session`, or `unknown`, with the reason. |
| `anchors` | `L` anchors and ranges available for citation. |
| `confidence_caps` | Per-log caps, to be compounded with the session cap. |
| `recurrence` | Whether independent runs establish recurrence, and why not when they do not. |
| `limitations` | Defects, absent logs, and declined selections. |

## Guarantees

- No log is opened that the operator did not name.
- No log is repaired, reordered, rewritten, or reconstructed.
- Recurrence is established only across independent runs.

## Boundaries

This source is read only. Selecting and replaying a log never authorizes
validating, promoting, applying, or persisting learning, and it never permits
reconstructing a conversation. A Skill Run Log holds bounded operational events,
not transcripts, so do not present it as a record of what was said.
