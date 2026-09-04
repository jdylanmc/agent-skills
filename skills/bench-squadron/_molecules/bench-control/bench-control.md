---
name: bench-control
description: Bind a capped, quorum-controlled Bench Squadron proposal to current Fleet State and full-text role doctrine before review-ready publication.
level: molecule
includes: ["_base/_atoms/atomic-transition/atomic-transition.md","bench-squadron/_atoms/atomic-proposal/atomic-proposal.md","bench-squadron/_atoms/bench-epoch/bench-epoch.md","bench-squadron/_atoms/fleet-state/fleet-state.md","bench-squadron/_atoms/role-doctrine/role-doctrine.md"]
composes: ["_base/_atoms/atomic-transition/atomic-transition.md","bench-squadron/_atoms/atomic-proposal/atomic-proposal.md","bench-squadron/_atoms/bench-epoch/bench-epoch.md","bench-squadron/_atoms/fleet-state/fleet-state.md","bench-squadron/_atoms/role-doctrine/role-doctrine.md"]
used-by: ["bench-squadron/SKILL.md"]
allowed-tools: ["execute","read"]
---

# Bench Control

```text
validate Fleet State -> configure separate roles -> load full-text lenses
  -> accept current-epoch quorum proposal -> invalidate stale assertions
```

## Required References

1. [Atomic transition](../../../_base/_atoms/atomic-transition/atomic-transition.md)
2. [Atomic Proposal](../../_atoms/atomic-proposal/atomic-proposal.md)
3. [Fleet State](../../_atoms/fleet-state/fleet-state.md)
4. [Role Doctrine](../../_atoms/role-doctrine/role-doctrine.md)
5. [Bench Epoch](../../_atoms/bench-epoch/bench-epoch.md)

Validate the existing Fleet State before accepting a proposal, and bind the
proposal to its exact revision through Atomic Transition. Atomic Proposal
adapts that packet to the shared strategy envelope, validates it, projects the
locked current state from its namespaced `strategyState`, and delegates the compatible durable write to
the shared Fleet State compare-and-swap adapter. That same locked write advances
the persisted Bench epoch. Bench Epoch validates the pool cap, role separation,
inclusive quorum, current distinct signatures, and mutator-turn rule. The
current Fleet State owner retains durable-write authority.

Load complete role doctrine text before dispatch. An asynchronous Slop Sniper
result is evidence for the publication gate, never Fleet State ownership or
signature authority. Once the validated proposal mutates the control path,
advance the bench epoch and discard all prior signatures and downstream claims.

Review-ready publication requires the exact current Fleet State binding,
current-epoch quorum, complete role lenses, quality evidence, and a resolved
Slop Sniper checkpoint. Scope, risk, approval, merge, promotion, and retirement
remain human-only decisions.
