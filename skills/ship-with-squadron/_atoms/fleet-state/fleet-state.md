---
name: fleet-state
description: Create, reread, reconcile, and compare-and-swap one versioned fleet control record under an ignored run-specific repository path separate from Chronicler.
level: atom
allowed-tools: ["execute","read"]
includes: ["ship-with-squadron/_atoms/fleet-state/fleet-state.mjs"]
composes: []
used-by: ["ship-with-squadron/_molecules/fleet-control/fleet-control.md"]
---

# Fleet State

## Required Files

1. [Fleet state helper](./fleet-state.mjs)

Persist control state at
`<repository>/.ship-with-squadron/<run-id>/fleet-state.json`. This path is
ignored, run-specific, and separate from the best-effort Chronicler log.

Use the fleet state helper to create schema version 1, bind it to
the confirmed manifest digest, reread it, reconcile the frontier, and write
with an exact expected revision. A stale writer stops on a revision conflict.
Writes use a sibling pending file and atomic rename.

Persist and reread after assignment, handoff, publication, Shepherd return,
observed merge, readiness expiry, and terminal transition. Per-issue state
retains source revision, criteria, dependency state, owner generation,
branch/worktree, base/head, implementation and quality evidence, change
request, Shepherd receipt, set obligation, disposition, and next action. Fleet
state retains frontier, blockers, capacity, completions, merges, expiry,
re-Shepherd queue, budget use, and unresolved human decisions.

Only declared status transitions are accepted. Budget consumption is monotonic;
crossing cost, time, or retry limits records `budget-exhausted`. Cancellation
marks pending issues `not-reached` and active issues as requiring validated
handoffs before their processes are released.

Chronicler records operations. This record owns control decisions. Neither is a
substitute for the other.
