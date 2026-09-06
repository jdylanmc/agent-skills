---
name: bench-epoch
description: Deterministically validate capped delivery-pool quorum proposals and advance the Bench Squadron epoch while invalidating obsolete signatures and claims.
level: atom
allowed-tools: ["execute"]
includes: ["bench-squadron/_atoms/bench-epoch/bench-epoch.mjs"]
composes: []
used-by: ["bench-squadron/_molecules/bench-control/bench-control.md"]
---

# Bench Epoch

## Required Files

1. [Bench epoch helper](./bench-epoch.mjs)

Create the epoch record from one to five distinct delivery-pool agents, an
inclusive quorum, a separate orchestrator, and a separate Slop Sniper. A
proposal binds one Fleet State revision, one exact current epoch, one mutator,
one turn, one bounded mutation, and distinct delivery-pool signatures.

Before collecting receipts, finalize the proposal's `binding` (`run`,
`candidate`, `lease`, `fence`) and compute `benchProposalDigest(proposal)`.
This canonical SHA-256 digest includes those bindings, proposal ID, epoch,
Fleet State revision, mutator, turn, and mutation, but excludes signatures.
Each receipt must carry that exact `proposalDigest` alongside its agent, epoch,
turn, and evidence value. Any body change requires new receipts. These are
runtime-attributed receipts, not cryptographic authentication of an agent.
Accepted history retains the immutable body and full signer receipts and
revalidates quorum on reload; older digest-only history cannot prove quorum
and is rejected rather than upgraded with fabricated signatures.

When a transition reserves a review candidate, persist each reservation's
lease, candidate, agent, fence, and expiry in the Bench epoch state. This is
the sole lease authority: callers may select a persisted lease but cannot
invent, extend, or replace its binding.

Validate the proposal against the supplied current Fleet State and manifest
before accepting it. A mutator may not also sign during the same turn. Accepting
a proposal advances the epoch exactly once and clears all signatures and
downstream claims, so every dependent assertion must be rebuilt against the
new state.
