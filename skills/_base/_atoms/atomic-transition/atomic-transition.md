---
name: atomic-transition
description: Validate a strategy-namespaced atomic transition proposal, its fencing and lease bindings, currentness, and candidate-evidence supersession while delegating compatible persistence to the existing Squadron fleet-state ledger.
level: atom
allowed-tools: []
includes: ["_base/_atoms/atomic-transition/atomic-transition.mjs"]
composes: []
used-by: ["bench-squadron/_molecules/bench-control/bench-control.md","tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md"]
---

# Atomic Transition

## Required Files

1. [Atomic transition contract](./atomic-transition.mjs)

## Shared Contract

This atom holds the generic transition envelope shared by future strategies.
It does not define a strategy's state machine, candidate shape, payload, or
evidence meaning. Each is carried inside an envelope whose `namespace` exactly
equals the proposal's `strategy`, so a consumer cannot accidentally read one
strategy's values as another's.

Every proposal is schema version `1` and carries these required bindings:

| Binding | Meaning |
| --- | --- |
| `expectedStateRevision` | The exact ledger revision the strategy inspected. |
| `run` | The one run the transition belongs to. |
| `candidate` | The candidate whose state may change. |
| `lease` | The primary reservation this transition owns. |
| `agent` | The agent holding that reservation. |
| `fence` | The primary reservation's positive fencing token. |

The shared forbidden-authority list is exact. A strategy may not silently
weaken it, add an authority, or reinterpret an omitted value as permission.

## Operation

`validateStrategyTransitionProposal` returns a normalized, deep-cloned proposal
only when its version, bindings, exact authority list, namespace envelopes, and
complete lease-reservation request are valid. `validateAtomicLeaseReservation`
then accepts the request only when **every** requested lease is present and
exactly matches the authoritative reservation. It never returns a partial
success.

`evaluateTransitionCurrentness` compares the proposal with a current strategy
snapshot. A moved revision, run, candidate, primary binding, opaque current
state, or any missing/mismatched requested lease makes the proposal stale.

`supersedeCandidateEvidence` retains evidence for the selected candidate and
marks current evidence for every other candidate invalidated with the selecting
candidate and state revision. Existing invalidation records remain immutable.

`applyFleetStateTransition` is an optional adapter for a strategy backed by the
existing Squadron ledger. It delegates locking, revision compare-and-swap, and
durable state persistence to `mutateFleetState`; this atom keeps no second
ledger. The strategy supplies a `readCurrent` projection from the locked fleet
state and a `transition` callback that returns a fleet-state-valid successor.

## Boundaries

- Does not define or inspect strategy state, payload, or evidence payloads.
- Does not persist a new ledger or alter the existing ship-with-squadron unit.
- Does not grant mutation, approval, merge, or other authority.
- Does not provide a routable skill, workflow registration, Bench package, or
  test-driven development package.

## Regression Suite

From the repository root, run:

```text
node --test skills/_base/_atoms/atomic-transition/atomic-transition.test.mjs
```
