---
name: tdd-lifecycle
description: Deterministically model Test-Driven Development Squadron candidate lifecycle, exclusive delivery-seat reservations, expiry fencing, and publication eligibility.
level: atom
allowed-tools: ["execute"]
includes: ["tdd-squadron/_atoms/tdd-lifecycle/tdd-lifecycle.mjs"]
composes: []
used-by: ["tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md"]
---

# TDD Lifecycle

## Required Files

1. [TDD lifecycle helper](./tdd-lifecycle.mjs)

Use the pure helper as the strategy-local source of truth for candidate
choreography. It creates a five-seat delivery pool; reserves a two-seat,
distinct-agent Red/Green pair; alternates vertical slices; freezes a ready
candidate while releasing both pair leases; and reserves an all-or-nothing
four-seat Roast team of one Roastmaster and three distinct roasters.

Every lease records its seat, owner, agent, generation, expiry, replacement
fence, reservation, run, and candidate revision. Every operation that consumes
a lease requires a trusted `now` timestamp and rejects a lease at or after its
expiry. Reservation creation also requires trusted `now` and rejects an expiry
at or before it. Reclaiming an expired reservation fences and releases every
member together. The helper rejects late or replaced leases and never creates
a partial reservation.

Freezing requires separate Red and Green readiness declarations, each bound to
its active agent lease and the exact candidate revision. Roast approval is
bound to the frozen candidate revision. Recommendations release the Roast and
return the candidate to TDD. A mutation clears all Roast evidence and review
readiness before incrementing the candidate revision. State creation requires a
trusted `publicationAgent` identity. `publicationAuthorization` returns
authorization only when the caller's identity exactly matches that configured
agent and the candidate is objectively review-ready; it does not publish.

Freezing also requires a completed RED/GREEN cycle with no pending GREEN
turn. RED-only declarations do not release ownership.

State creation requires a trusted `coordinatorAgent` as well as the publication
agent. Coordinator-only `reserve-pair`, `reserve-roast`, `recover-pair`, and `reclaim-expired`
proposals use the current control revision as their fence; they do not require
the delivery lease they create or reclaim. Use the atomic adapter to persist
these operations, including initial dispatch and post-freeze Roast acquisition.

`recover-pair` binds `{reservationId, expectedLeaseIds}` for both current
leases. Atomic Proposal requires trusted runtime proof that neither worker can
write before permitting this early release. It advances both fences without
waiting for expiry, clears readiness, and preserves candidate revision, slice
history, next role, and run budgets. Old proposals and leases cannot advance the
replacement. The replacement pair independently inspects the preserved
candidate and submits new declarations; a pending Green slice is not waived.
No readiness, review, or publication is manufactured by recovery.

`recordRoastApproval` requires `reports` (three independent reviewer receipts),
separate `synthesis`, and `dispositions` for unresolved findings, not a synthesis
string. Each receipt uses the existing Roast evidence envelope: invocation
`id`, `skill: roast`, `runId`, `issue` (candidate ID), and `agent`; current
`candidateId` and `candidateRevision`; `leaseId` and `fence`; completed status,
terminal/complete/evidenceComplete flags, completion time, non-empty report
`evidence`, and findings with
identity, Priority, and status. The synthesis is a fourth receipt from the
Roastmaster with exact `reportIds` and non-empty `evidence`. Open Must-fix
findings reject readiness. Every other open finding requires exactly one
`{reportId, findingId, status: deferred, evidence}` disposition. Persist the
receipts, lease bindings, synthesis, and dispositions with the approved
revision; reload and publication eligibility revalidate them.
