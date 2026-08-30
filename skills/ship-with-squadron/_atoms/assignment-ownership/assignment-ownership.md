---
name: assignment-ownership
description: Enforce one mutable owner per issue branch and worktree, fresh worker contexts, assignment generations, and validated continuation through orchestration-handoff.
level: atom
allowed-tools: ["read","task"]
includes: ["ship-with-squadron/_atoms/assignment-ownership/assignment-ownership.mjs"]
composes: []
used-by: ["ship-with-squadron/_molecules/fleet-control/fleet-control.md"]
---

# Assignment Ownership

## Required Files

1. [Assignment ownership helper](./assignment-ownership.mjs)

Every initial dispatch is for a pending, unowned, nonterminal issue whose source
revision was freshly reobserved. It carries one fresh worker context, one
isolated branch, one isolated worktree, and a complete manifest-bound packet:
criteria, scope, exclusions, allowed paths, exact base/head revisions,
verification, report contract, and the exact forbidden-authority list. The
verification list and report evidence list exactly equal the confirmed,
supported validation policy; workers cannot silently omit or invent checks. The
packet rejects unknown fields and seals the complete task contract: goal, scope,
context, acceptance, verification, timebox, forbidden authority, report, and
standing instruction. Workers never select more backlog work.
Assignment also consumes a scheduler lease bound to the confirmed manifest,
provider configuration, exact fleet-state revision, recomputed dependency
frontier, current `capacity.dispatch`, and active count. The compare-and-swap
mutation reacquires the state lock, rereads the leased revision, recomputes the
frontier while ownership is serialized, and compares the complete lease before
writing. Stale-frontier and capacity races fail.

Use the assignment ownership helper to reject concurrent
ownership of the same issue, branch, or worktree and reuse of any worker
context. Worktree identity is a normalized absolute canonical filesystem
identity: existing paths use real path and device/inode identity, aliases and
symbolic links are refused, case is normalized on case-insensitive filesystems,
and assignment dispatch requires an existing real directory registered by
`git worktree list --porcelain` as an isolated non-primary worktree on the
exact assigned branch. Reject the manifest root, primary checkout, regular
files, reused assignment history, repository mismatches, and path/case/link
aliases. Persist its canonical path, device/inode identity, Git common
directory, worktree Git directory, primary checkout, and branch ref. Reverify
that exact identity on every active-state write, continuation, and handoff
release; deleting and recreating the same path does not preserve ownership.
Before dispatch, resolve the configured base branch and isolated worktree
`HEAD` as commits and require them to equal the packet's base/head revisions;
caller-supplied revision labels are not evidence. Before continuation, handoff
release, or successful completion, require the stored head to still equal the
worktree `HEAD` and the stored base commit to remain in the configured base
branch history. A worker commit therefore requires an explicit revision
reconciliation before old packet or completion bindings can be consumed.
Record monotonically increasing assignment generations.

For stalled, exhausted, timed-out, or crashed workers:

1. safely stop or recover owned processes;
2. capture committed and uncommitted state;
3. invoke the required `orchestration-handoff` skill;
4. consume the real persistence result (`path`, `directory`, `name`, bytes,
   headings, redactions, and suggested-skill flag) plus the exact submitted
   orchestration payload. The runtime-selected `handoffs` directory cannot be
   widened by the caller. Open the direct-child artifact with `O_NOFOLLOW`
   when available; on Windows, use real-path containment plus pre-open,
   descriptor, and post-read same-file verification. Hash and read bytes through
   that descriptor, compare identity and metadata before/after, snapshot and
   recheck the trusted non-symlink/reparse directory chain, reject links, swaps,
   and escapes, then validate all
   complete deterministically rendered artifact against the normalized
   submitted payload, including every consolidated brief section and exact
   run/issue/prior-generation/branch/worktree/source/target/base/head,
   manifest/source revision, and allowed-path bindings. The continuation task
   contract and packet must exactly equal the original manifest-bound
   assignment, preventing scope or authority expansion;
   archive the validated handoff identity, artifact digest, and complete
   binding record with the ended assignment;
5. dispatch a fresh continuation context on the same owned branch and worktree.

The brief contains `GOAL`, `SCOPE`, `CONTEXT`, `ACCEPTANCE`, `VERIFY`,
`TIMEBOX`, `FORBIDDEN`, `REPORT`, and `STANDING`. Evidence and artifacts carry
forward; hidden reasoning and prior context do not.

Cancellation or budget exhaustion keeps the active handoff obligation but
forbids dispatching a continuation.
Timeout, crash, stall, and exhaustion never release ownership without that
validated handoff. Until one exists, persist `handoff-required`, retain the
active assignment and its evidence, and do not claim
`timed-out-with-handoff`. Terminal release uses the same artifact reread and
binding validation as continuation; the generic state transition cannot accept
a caller-shaped handoff record.
