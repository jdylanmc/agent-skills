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
