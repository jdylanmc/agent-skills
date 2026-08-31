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
one unambiguous root run; ambiguity degrades explicitly. Correlation stores no
prompt, transcript, or arbitrary output.

An armed generation permits one exact full-file read at a time from its
canonical read set. A successful provider observation advances that set only
when the path and current digest match. The final matching observation clears
the latch once and returns a bounded checkpoint. Claims made by the model or
copied into a compacted summary are not acknowledgements.

State is stored below the repository's ignored `.skill-log/rehydration/`
directory with owner-only permissions, atomic replacement, and a bounded
cross-process lock. Dead lock owners are reclaimed and live contention times
out below the hook command's three-second budget. The final checkpoint is
rendered and size-validated before the latch is cleared; an oversized packet
degrades explicitly. Missing state is inactive, not permission to invent an
active run.
