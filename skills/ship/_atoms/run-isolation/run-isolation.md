---
name: run-isolation
description: Establish and record the workspace isolation a delivery run works inside, always using a dedicated git worktree and branch when the target is a git repository, and naming the isolation as absent when it is not.
level: atom
allowed-tools: ["execute","read"]
includes: []
composes: []
used-by: ["ship/_molecules/delivery-cycle/delivery-cycle.md"]
---

# Run Isolation

Work somewhere that is not the operator's working state.

A delivery run edits files, runs builds, and leaves artifacts behind. Doing that
in the checkout a person is using means a failed run and an interrupted human
share one set of uncommitted changes, and neither can be recovered without
untangling the other.

## The Rule

When the target is a git repository, every run works in a **dedicated worktree
on its own branch** — always, explicitly, and never the repository's primary
checkout and never a worktree belonging to another run.

Establish it before any implementation begins, and record the worktree path and
branch. A later step reconciles the diff against the confirmed ledger, and it
can only do that against a known working tree.

## When Isolation Is Not Available

When the target is not a git repository, a worktree is not available. Record the
isolation as `none` **with the reason**, and say so plainly rather than implying
a separation that does not exist.

`none` is a decision for a person, not a detail to proceed past. A run that
writes code with no isolation is writing directly into whatever state the
operator already had, so the operator decides whether that is acceptable before
anything is written.

## Isolation States

| State | Meaning |
| --- | --- |
| `worktree` | A dedicated worktree on a dedicated branch. Path and branch recorded. |
| `none` | Not a git repository. Reason recorded. Requires explicit operator consent before any write. |
| `refused` | Isolation was required and could not be established. The run stops. |

`refused` is reachable and is not a failure to report politely. A run that
cannot isolate and was not granted consent to proceed without isolation has no
safe place to work, so it stops rather than falling back to the primary
checkout.

## Reuse Is Not Isolation

Reusing an existing worktree from an earlier run is **not** isolation. Its
branch carries commits this run did not make and did not disclose, and every one
of them would land in this run's change request while appearing to belong to it.
Establish a new worktree, or stop.

## Boundaries

- **Never works in the primary checkout**, and never in another run's worktree.
- **Never discards existing state to make room.** A dirty primary checkout is
  not this atom's to clean; it is a reason to isolate, not a thing to resolve.
- **Records what was achieved, not what was intended.** If the worktree was not
  created, the state is not `worktree`.
