---
name: atomic-proposal
description: Adapt a validated current Bench epoch proposal to the shared Atomic Transition envelope and delegate compatible Fleet State mutations through its compare-and-swap adapter.
level: atom
allowed-tools: ["execute"]
includes: ["bench-squadron/_atoms/atomic-proposal/atomic-proposal.mjs"]
composes: []
used-by: ["bench-squadron/_molecules/bench-control/bench-control.md"]
---

# Atomic Proposal

## Required Files

1. [Bench-to-Atomic adapter](./atomic-proposal.mjs)

Build a `bench-squadron/v1` Atomic Transition proposal only after Bench Epoch
has validated the delivery signatures against the exact current Fleet State.
The Fleet State's `strategyState` must hold the namespaced current Bench epoch;
the adapter derives the epoch from that state rather than from a separate
ledger. It binds the shared proposal revision and run to the Fleet State, binds
its agent to the validated Bench mutator, and selects a non-expired persisted
Bench reservation whose candidate, agent, and fence exactly match. It projects
the exact Bench epoch plus Fleet State revision as the strategy's current
opaque state.

Validate the generated envelope with Atomic Transition before returning it.
Use Atomic Transition's currentness evaluator again against the locked Fleet
State projection. Locked leases are derived only from the persisted Bench
reservation, never copied from a proposal; an invented, expired, stale, or
replaced binding is rejected. Any changed Fleet State revision or Bench epoch
is stale. For a durable mutation, delegate only through Atomic Transition's
Fleet State compare-and-swap adapter. Its locked callback advances Bench Epoch
and writes the resulting `bench-squadron/v1` envelope to `strategyState` with
the Fleet State mutation, so reloading the Fleet State cannot replay prior
proposals.
