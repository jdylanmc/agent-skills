---
name: rehydration-state
description: Persist and advance one bounded, provider-neutral active-run and compaction-rehydration state machine without storing prompts, transcripts, secrets, or canonical instruction content.
level: atom
includes: ["_base/_atoms/rehydration-state/rehydration-state.mjs"]
composes: []
used-by: ["_base/_molecules/compaction-rehydration/compaction-rehydration.md"]
---

# Rehydration State

## Required Files

1. [Provider-neutral state implementation](./rehydration-state.mjs)

Own the provider-neutral state machine for active skill runs:

```text
active -> compacting -> rehydration-required -> rehydrated
                                              -> degraded
```

The persisted record contains only opaque run and session identities, skill
names, repository-relative canonical paths, SHA-256 digests, lifecycle
identifiers, counters, and timestamps. It never contains prompt text,
transcripts, tool output, canonical file contents, secrets, or arbitrary
Chronicle summaries.

Runs registered before a provider session identifier is available enter a
bounded pending registry. A hook may claim that registry only when it describes
one unambiguous root run. Entries assigned to other sessions are excluded.
Compatible unassigned entries may be atomically claimed into reused state, and
empty terminal state may be safely replaced. Ambiguity persists a session-keyed
degraded marker. A malformed, unreadable, or unsafe pending registry also
persists a session-keyed degraded marker before `preCompact` returns, so the
next tool gate cannot mistake failed correlation for an inactive run.
Correlation stores no prompt, transcript, or arbitrary output.
Resume performs correlation and arming under the same state lock. Repeated
resume notifications preserve an already armed generation and its next read.

An armed generation permits one exact full-file read at a time from its
canonical read set. A successful provider observation advances that set only
when the path and current digest match. The final matching observation clears
the latch once and returns a bounded checkpoint. Claims made by the model or
copied into a compacted summary are not acknowledgements.

Each generation also persists a bounded lifecycle emission receipt. The hook
holds the cross-process state lock while it verifies the Chronicle log, appends
its single `before` or `after` record, and updates the receipt. Concurrent hook
processes therefore cannot claim and append the same phase independently. The
receipt retains the generation's immutable Chronicle owner even if the active
stack later empties. A failed append remains retryable; an interruption after a
successful append is recovered from the log without duplication; and `after`
is refused until the matching `before` is present.
Repeated resume, degraded result, and stop notifications therefore do not
create duplicate or out-of-order operation records.

An active run ending while a generation is armed degrades explicitly; lifecycle
registration cannot silently satisfy the final read obligation or declare
successful rehydration. The reason distinguishes one ended frame from all runs
ending, and remains visible to provider gates and stop handling. The first
non-reentrant stop attempt in degraded state blocks once with that persisted
reason; later attempts allow, staying below the runtime's consecutive-block
ceiling. A `stop_hook_active` re-entry always allows and does not consume the
one bounded block.

Every persisted read validates the status, generation, completion marker,
session binding, active frames, and the full latch shape before returning
state. An armed latch must be the exact unread suffix of the canonical
run-owned file sequence and must match the current generation. A skill
registered while recovery is armed is appended to that sequence. Missing,
contradictory, escaped, or malformed persisted fields raise an `invalid-state`
command failure; they are never normalized to inactive or allowed to clear the
latch.

State is stored below the repository's ignored `.skill-log/rehydration/`
directory with owner-only permissions, atomic replacement, and a bounded
cross-process lock. Dead lock owners are reclaimed and live contention times
out below the hook command's three-second budget. The final checkpoint is
rendered and size-validated before the latch is cleared; an oversized packet
degrades explicitly. Missing state is inactive, not permission to invent an
active run.
