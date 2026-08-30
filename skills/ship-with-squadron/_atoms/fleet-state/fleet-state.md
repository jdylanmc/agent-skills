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
the confirmed manifest and provider-configuration digests, reread it, reconcile
the frontier, and write with an exact expected revision. Every write validates
the complete state schema and cross-field invariants before taking an exclusive
lock, then rereads and compares the disk revision while holding that lock. A
stale writer stops on a revision conflict. Writes fsync a sibling pending file,
atomically rename it, and fsync the parent directory. Crash-stale locks are
recovered only when their recorded process is gone.

Persist and reread after assignment, handoff, publication, Shepherd return,
observed merge, readiness expiry, and terminal transition. Per-issue state
retains source revision, criteria, dependency state, owner generation,
branch/worktree, base/head, implementation and quality evidence, change
request, Shepherd receipt, set obligation, disposition, and next action. Fleet
state retains frontier, blockers, capacity, completions, merges, expiry,
re-Shepherd queue, budget use, and unresolved human decisions.

State issue keys exactly equal the closed manifest set. Assignment packets,
publication records, readiness receipts, criteria decisions, and merge
observations are cross-checked rather than trusted as caller-shaped state. Only
declared status transitions are accepted; mutable ownership is entered only by
assignment, and there is no general `active -> pending` transition. Budget
consumption is monotonic; reaching cost, time, or retry limits records
`budget-exhausted`. Cancellation marks pending issues `not-reached` and active
issues as requiring validated handoffs before their processes are released.

Chronicler records operations. This record owns control decisions. Neither is a
substitute for the other.
