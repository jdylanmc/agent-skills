---
name: atomic-proposal
description: Adapt a current Test-Driven Development Squadron proposal to the shared Atomic Transition contract and persist its resulting strategy state through the Fleet State compare-and-swap path.
level: atom
allowed-tools: ["execute"]
includes: ["tdd-squadron/_atoms/atomic-proposal/atomic-proposal.mjs"]
composes: []
used-by: ["tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md"]
---

# Atomic Proposal

## Required Files

1. [TDD-to-Atomic adapter](./atomic-proposal.mjs)

Build a shared `tdd-squadron` Atomic Transition only after the local proposal
has been validated against the current namespaced TDD state in Fleet State.
The adapter replaces the strategy-local control revision in the generic binding
with the exact Fleet State revision and retains the control revision inside the
opaque TDD projection.

For durable changes, use only the adapter's Fleet State compare-and-swap
operation. Its locked callback derives TDD currentness from
`state.strategyState`, revalidates the local proposal, and stores the resulting
`tdd-squadron` state in that same envelope. It obtains trusted current time
from its lock-scoped clock for both revalidation and the lifecycle callback;
the callback receives that timestamp as its fourth argument. A moved Fleet
State revision, expired proposal, changed TDD projection, or malformed
successor rejects the proposal without a local write.
