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

Use the fleet state helper to create schema version 5, bind it to
the confirmed manifest and provider-configuration digests, reread it, reconcile
the frontier, and write with an exact expected revision. Every write validates
the complete state schema and cross-field invariants before taking an exclusive
lock, then rereads and compares the disk revision while holding that lock. All
filesystem object identities use bigint stats and exact decimal device/inode
serialization. A
stale writer stops on a revision conflict. The complete directory ancestry is
checked component-by-component and rejects symbolic links or reparse
containment changes. Before any path creation or open, the exact normalized
path must equal the path derived from the manifest repository root and state
run ID. State reads use `O_NOFOLLOW` where available and verified
path/descriptor identity otherwise. Lock acquisition prepares ownership
metadata in a private claim directory and atomically renames the complete claim
into canonical lock presence, so a live writer never exposes an ownerless
initialization window. Stale, malformed, and released locks are removed from the
canonical pathname only by renaming the observed candidate to a high-entropy
private sibling quarantine. The moved object is then revalidated against the
observed filesystem and owner identity. Quarantines are never restored, unlinked,
or recursively deleted by the mutation protocol. A mismatched, unsafe,
unreadable, or otherwise unknown moved object is retained byte-for-byte and the
operation fails with its quarantine path. Normal release may therefore leave a
verified lock tombstone.
Only positively established missing or malformed ownership is eligible for
malformed-lock recovery; permission, sharing, and I/O failures propagate.
Lock ownership
records both PID and immutable process-start identity where available: Linux
boot/start ticks, Darwin boot/start time without mutable command/title data,
and Windows process creation time. PID reuse therefore does not permanently
wedge a stale lock; platforms without that proof fail closed for a live PID
while still recovering safely aged ownerless or malformed locks. Writes fsync a sibling pending file whose name contains the random lock token
and an independent nonce. The pending file is fsynced, then atomically hard
linked to the deterministic same-directory commit slot
`fleet-state.json.commit-r<revision>`. Creating that immutable slot is the
compare-and-swap linearization point: exactly one writer can create a revision,
and `EEXIST` is the stable revision conflict. The slot contains the complete
validated state and is authoritative. The winner then renames the pending path
over `fleet-state.json` as a canonical projection. Reads and later writes use
the highest valid commit slot, so a crash after slot creation cannot lose the
committed state and a deposed writer cannot overwrite it. When no commit slot
exists, the canonical file remains authoritative for backward compatibility.
Committed slots are never deleted. Pending files are not scavenged because
they may still belong to a writer whose lock pathname was displaced. Directory
ancestry remains pinned through slot creation and projection.

Persist and reread after assignment, handoff, publication, Shepherd return,
observed merge, readiness expiry, and terminal transition. Per-issue state
retains source revision, criteria, dependency state, owner generation,
branch/worktree, base/head, implementation and quality evidence, change
request, Shepherd receipt, set obligation, disposition, and next action. Fleet
state retains frontier, blockers, capacity, completions, merges, expiry,
re-Shepherd queue, budget use, and unresolved human decisions.
It also persists exact query-membership reobservations, revision-specific
publication observations, full normalized merge records, and explicit check
activity, including merge-watermark blocking state, plus a persistent
`handoff-required` obligation while an affected worker still owns its branch
and worktree.

State issue keys exactly equal the closed manifest set. Assignment packets,
publication records, readiness receipts, criteria decisions, and merge
observations are cross-checked rather than trusted as caller-shaped state. Only
manifest/provider-sealed completed issues may start as `already-complete`.
Neither pending nor active work can jump directly to completed; review readiness
is entered only through a complete semantic pipeline, confirmed current
publication, exact Shepherd or no-Shepherd obligation, and the latest merge
watermark. Empty or stale caller-shaped readiness is invalid on load and write.
Ready, blocked, active, and completed scheduler collections, dependency
classifications, and their stable reasons are recomputed from the closed
manifest and issue state on every validation; caller-supplied alternatives are
rejected.
Only
declared status transitions are accepted; mutable ownership is entered only by
assignment, and there is no general `active -> pending` transition. Budget
consumption is monotonic; reaching cost, time, or retry limits records
`budget-exhausted`. Cancellation marks pending issues `not-reached` and active issues with the same
durable validated-handoff obligation used for budget exhaustion. Once the fleet
is cancelled or exhausted, or an issue already carries a handoff obligation,
no caller-selected completion or `blocked` reason may release active ownership;
only the validated orchestration-handoff release transition may do so.
The active assignment count must equal persisted capacity and never exceed the
confirmed ceiling. Completed, failed, deferred, blocked, timed-out, and
per-issue dispositions follow an explicit compatibility matrix; blocked,
failed, timed-out, or deferred work never satisfies a `completed` dependency.
`timed-out-with-handoff` additionally requires an archived assignment carrying
the exact validated handoff identity, artifact digest, and binding record.
Timeout, crash, stall, or exhaustion without that evidence retains active
ownership and a blocked handoff obligation instead of using any terminal
disposition.

Chronicler records operations. This record owns control decisions. Neither is a
substitute for the other.
