---
name: concise-report
description: Render one already-scoped objective snapshot into concise inline Markdown, preserving missing information and pairing ticket references with titles.
level: atom
allowed-tools: ["execute"]
includes: ["status-report/_atoms/concise-report/concise-report.mjs"]
composes: []
used-by: ["status-report/_molecules/objective-report/objective-report.md"]
---

# Concise Report

## Required Files

1. [Snapshot validator and formatter](./concise-report.mjs)

## Input

Pass the collected snapshot as JSON on standard input to the local formatter:

```text
node <skill-root>/_atoms/concise-report/concise-report.mjs
```

Use a quoted literal/stdin facility; never interpolate titles or assignments
into executable shell syntax. Do not write an input file or persist the output.
The input is bounded at 256 KiB. Unknown fields and malformed data are errors,
not permission to invent a replacement. The formatter validates representation,
scope consistency, and arithmetic; collection owns the evidence's authenticity.

| Field | Meaning |
| --- | --- |
| `scope` | `{objectiveId, agentId}` from trusted current-objective state, or `null` when identity is unavailable. |
| `asOf` | `{time, source}` with a UTC cutoff timestamp in `YYYY-MM-DDTHH:mm:ss.sssZ` form, or `{time: null, reason}`. |
| `objective` | Work description required when scope is established; `null` only in the fully unavailable null-scope snapshot. |
| `completed`, `remaining` | `{coverage, items, reason, objectiveId, observedAt, source}`. Known views bind to the objective and an observation time; complete views require `observedAt: asOf.time`. Partial views show their observed time. |
| `timing` | `{startedAt, objectiveId, source, reason}`. Use `startedAt: null` and an explicit reason when unknown. Known starts must match scope and precede the cutoff. |
| `toolCalls` | One of the closed counter-evidence variants below. An unprovable count is unavailable, not a raw number with a source label. |
| `subagents` | `{coverage, items, objectiveId, through, source, reason}`. Known items are unique running objective-owned descendants; `complete` requires `through: asOf.time`. Partial running observations must be at or after that cutoff. |

A work description is `{text, tickets}`, with `tickets` an array of
`{ref, title}`. Introduced references belong in that array, not bare in `text`.
The same numbered-reference grammar is used in the array and prose guard:
`#N`, `!N`, or a qualifier followed by either marker and a positive number.
Qualifiers are slash-separated letters, digits, dots, underscores, and hyphens;
`.` and `..` segments, schemes, and URLs are not valid qualifiers. Examples
include `AB#202`, `owner/repo#202`, and `owner/repo!202`. A `ticket`, `issue`,
`PR`, `pull request`, or `work item` label may precede any form or a bare positive
number. Leading zeros are normalized. Duplicate detection uses qualifier,
marker, and normalized number; human labels affect display only.
`title` is the known title or `null`. Titles are not shortened or relabelled
unavailable because they exceed a prose budget.

Hash text embedded inside an alphanumeric token and explicit CSS/color/hex
literals are not ticket references. This syntactic guard cannot discover the
meaning of every domain-specific number; collection still owns that judgement.
Titles remain literal labels, not a request to recursively resolve incidental
references inside the title.
Every authored description and rendered reason is checked for bare references,
including references inside brackets, quotes, or emphasis markers. Put ticket
context in a work description's structured `tickets`, not in a reason string.

A subagent item is `{id, objectiveId, state, ancestors, work}` with
`state: "running"`. `ancestors` is the registry-provided chain from the
reporting agent to the immediate parent, excluding the worker itself.
A direct child has `[reportingAgentId]`; a nested child includes intermediate
parents. Chains must be nonempty, acyclic, rooted at the reporting agent, and
consistent with any intermediate parents also represented in the snapshot.
All agent/objective identities reject surrounding whitespace. Collection owns
the authenticity of that registry evidence; matching labels alone are not
ancestry. Exclude unproven or stale workers and mark coverage partial/unavailable.
An opaque worker identity that itself looks like a ticket is displayed as
`worker N`, an ordinal presentation label, rather than a titleless ticket-like
token. Its real identifier still governs all identity and ancestry checks.

Use a nonempty `reason` for any partial/unavailable progress, time, count, or
subagent observation. Complete progress/registry observations and known clock
or start values must have no limitation reason (absent or `null` only).
Unavailable clocks have only `time: null` and `reason`; unavailable starts have
only `startedAt: null` and `reason`; unavailable lists have only `coverage`,
empty `items`, and `reason`. Inactive source/lineage fields are rejected.
Partial lists
may show their observed items but never claim a total. If `scope` is null,
objective/progress/metrics must all be unavailable.

## Counter Evidence

- `kind: "authoritative"` carries `count`, `objectiveId`, `agentId`, `through`,
  and `source`, with the literal declarations `unit: "attempts"`,
  `complete: true`, `excludesDescendants: true`, and `excludesReport: true`.
  Collection must establish those properties from the named native counter;
  do not insert the declarations merely to pass validation. A generic session
  total is not this counter.
- `kind: "events"` carries `objectiveId`, `agentId`, `from`, `through`,
  `source`, `complete: true`, and bounded `events`. `from` must equal the
  proven objective start and `through` must equal the reporting cutoff.
  Each event is `{callId, agentId, objectiveId, timestamp, phase, report}`,
  with native `phase: "start" | "complete"` and an explicit boolean indicating
  membership in this reporting invocation. The formatter counts unique
  attempts, not completion outcomes; repeated start/completion records count
  once. It excludes foreign agents/objectives, events outside the interval,
  and report calls. An eligible completion without its unique start is invalid.
- `kind: "unavailable"` carries only `count: null` and a nonempty `reason`.
  A truncated event slice, missing identity/window, unknown report membership,
  or counter with unsupported counting semantics must use this variant.

No representation can authenticate a dishonest source assertion. The formatter
checks the declared evidence contract; collection must obtain that evidence
through the authorized runtime read, not infer it from formatting success.

## Example Snapshot

This is synthetic data illustrating a known objective with an unavailable
counter. It is not a source for any real runtime claim.

```json
{
  "scope": {"objectiveId": "task-202", "agentId": "parent"},
  "asOf": {"time": "2026-09-07T12:00:00.000Z", "source": "runtime clock"},
  "objective": {"text": "Finish the cache migration.", "tickets": [{"ref": "#202", "title": "Migrate the cache reader"}]},
  "completed": {
    "coverage": "complete", "objectiveId": "task-202",
    "observedAt": "2026-09-07T12:00:00.000Z", "source": "objective task record",
    "items": [{"text": "Updated the reader.", "tickets": []}]
  },
  "remaining": {
    "coverage": "complete", "objectiveId": "task-202",
    "observedAt": "2026-09-07T12:00:00.000Z", "source": "objective task record",
    "items": [{"text": "Finish review.", "tickets": []}]
  },
  "timing": {"startedAt": "2026-09-07T10:00:00.000Z", "objectiveId": "task-202", "source": "objective task record"},
  "toolCalls": {"kind": "unavailable", "count": null, "reason": "No complete objective counter is available."},
  "subagents": {
    "coverage": "complete", "objectiveId": "task-202",
    "through": "2026-09-07T12:00:00.000Z", "source": "native descendant registry",
    "items": [{"id": "reviewer", "objectiveId": "task-202", "state": "running", "ancestors": ["parent"], "work": {"text": "Reviewing the migration.", "tickets": []}}]
  }
}
```

## Concision Budgets

The objective text is at most 360 characters and three sentences. Each work
description uses at most 180 characters and two ticket references. Completed
and remaining work each have at most five grouped milestones. Reasons are at
most 180 characters and identities at most 100.

The core authored overview is at most 2,400 rendered characters, excluding the
worker list and immutable reference/title blocks. Canonical ticket references
and their full titles are source evidence, not prose the agent can resummarize.
They have no separate display-length cap within the 256 KiB input bound.
Consequently long literal titles can make the display longer than its preferred
prose budget; preserve them rather than fabricate an unavailable-title label.
There is no incompatible per-line cap combining prose and immutable titles.

Oversize input is rejected with an actionable resummarization message, never
silently truncated. These are reporting budgets, not permission to drop facts:
group milestones, retain blockers and full ticket titles, and keep all observed
workers. The separate defensive transport bounds are 256 KiB, 2,048 event
records, 1,000 workers, and 64 ancestors per chain. When those bounds prevent
complete observation, report unavailable/partial coverage rather than an
invented complete count.

## Presentation

Return the objective, completed bullets, remaining bullets, activity line,
then running subagents. Preserve ticket titles in every introduced reference.
Keep prose short and concrete; summarize milestones instead of dumping the
timeline. List each observed running subagent on one line, including nested
workers; do not silently hide workers to meet a cosmetic length target.

The formatter enforces the sentence limit with the runtime's English sentence
segmenter. It escapes Markdown metacharacters and refuses control characters,
including explicit bidirectional formatting marks, overrides, embeddings, and
isolates; ordinary right-to-left text remains supported. If wording is rejected,
shorten or clarify it without changing the facts.

Do not add a guessed progress bar, completion percentage, or finish estimate.
Elapsed duration is labelled wall-clock time: it includes idle time and pauses
and must never be described as continuous active computation. Duration and
observed tool activity make churn visible without claiming how much work
remains. The snapshot can become stale immediately; it is not an atomic
monitoring guarantee.

## Failure

A malformed snapshot produces one bounded diagnostic line with a stable error
category on standard error and no report. Raw unknown keys and parser-input
fragments are not echoed. Correct only representational mistakes supported by
the same evidence.

If the formatter is unavailable, do not hand-render source strings without
its protections. Return only this fixed, source-free fallback:

```text
**Objective:** Unavailable.
**Completed**
- Unavailable.
**Remaining**
- Unavailable.
**Snapshot:** Unavailable | **Elapsed (wall clock):** Unavailable | **Tool calls (this agent):** Unavailable
**Running subagents:** Unavailable.
**Limitation:** The status formatter is unavailable; source-derived fields were not rendered.
```

Do not append raw titles, assignments, reasons, or error output to this
fallback. Never replace failed collection with a successful-looking zero.
