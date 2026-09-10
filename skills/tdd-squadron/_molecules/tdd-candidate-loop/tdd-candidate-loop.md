---
name: tdd-candidate-loop
description: Coordinate the persistent Red/Green Test-Driven Development candidate loop, one frozen-candidate Roast, doctrine-bound roles, validated transition proposals, and advisory checkpoints.
level: molecule
includes: ["_base/_atoms/atomic-transition/atomic-transition.md","tdd-squadron/_atoms/atomic-proposal/atomic-proposal.md","tdd-squadron/_atoms/tdd-lifecycle/tdd-lifecycle.md","tdd-squadron/_atoms/doctrine-lenses/doctrine-lenses.md","tdd-squadron/_atoms/tdd-transition-proposal/tdd-transition-proposal.md","tdd-squadron/_atoms/slop-sniper-advisory/slop-sniper-advisory.md"]
composes: ["_base/_atoms/atomic-transition/atomic-transition.md","tdd-squadron/_atoms/atomic-proposal/atomic-proposal.md","tdd-squadron/_atoms/tdd-lifecycle/tdd-lifecycle.md","tdd-squadron/_atoms/doctrine-lenses/doctrine-lenses.md","tdd-squadron/_atoms/tdd-transition-proposal/tdd-transition-proposal.md","tdd-squadron/_atoms/slop-sniper-advisory/slop-sniper-advisory.md"]
used-by: ["tdd-squadron/SKILL.md"]
allowed-tools: ["execute","read","search","task"]
---

# TDD Candidate Loop

## Required References

1. [Atomic transition](../../../_base/_atoms/atomic-transition/atomic-transition.md)
2. [Atomic proposal](../../_atoms/atomic-proposal/atomic-proposal.md)
3. [TDD lifecycle](../../_atoms/tdd-lifecycle/tdd-lifecycle.md)
4. [Doctrine lenses](../../_atoms/doctrine-lenses/doctrine-lenses.md)
5. [TDD transition proposal](../../_atoms/tdd-transition-proposal/tdd-transition-proposal.md)
6. [Slop Sniper advisory](../../_atoms/slop-sniper-advisory/slop-sniper-advisory.md)

## Operation

1. Bind every dispatched role to full-text doctrine lenses and a canonical
   manifest revision/digest. Execute Doctrine Lenses' model resolver and use its
   routes and receipts without inventing fallbacks or model-variety claims.
   Configure the trusted coordinator. Bootstrap Red and Green with
   `dispatchMode: background`, no write permission until reservation, and one
   accepted addressed follow-up each. Retain their runtime IDs. Reserve the
   quiescent pair through the atomic adapter as one two-seat control transaction.
   Failed bootstrap allocates no seats. Use the wrapper's whole-pair
   `recover-pair` procedure if a later worker becomes unreachable; never replace
   a single lease or infer readiness from old reports.
2. Dispatch one alternating vertical slice at a time. Each result becomes a
   typed, validated fleet-state proposal. Atomic Proposal derives current TDD
   state from the locked Fleet State envelope and delegates its durable
   transition through the shared compare-and-swap; stale or rejected results
   have no lifecycle effect.
3. After a completed RED/GREEN cycle, freeze one pair-declared ready candidate
   revision and release both leases atomically. Use a coordinator control
   proposal to reserve the four distinct Roast roles after that release.
4. Run one Roastmaster synthesis over three independent roaster reports for
   that frozen revision. Persist the three revision/lease-bound report receipts,
   separate synthesis receipt, and exact unresolved-finding dispositions through
   Atomic Proposal. Never review an individual vertical slice.
5. Return recommendations to a new pair cycle, or mark only current,
   objectively evidenced Roast approval as review-ready for the publication
   agent. A mutation invalidates Roast evidence and returns to TDD.
6. Trigger a one-shot, asynchronous Slop Sniper advisory at declared material
   checkpoints; consume only current snapshot-bound advice at a later safe
   transition.

## Boundaries

This molecule owns neither shared fleet-state persistence nor Bench
choreography. It emits strategy-local proposals to Atomic Transition. It does not publish, approve, merge,
accept risk, expand scope, promote, retire, or close tracker work.
