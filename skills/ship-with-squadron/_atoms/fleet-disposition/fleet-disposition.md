---
name: fleet-disposition
description: Render concise fleet status and complete per-issue and fleet terminal dispositions without implying merge, approval, or tracker closure.
level: atom
allowed-tools: ["execute"]
includes: ["ship-with-squadron/_atoms/fleet-disposition/fleet-disposition.mjs"]
composes: []
used-by: ["ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md"]
---

# Fleet Disposition

## Required Files

1. [Fleet disposition helper](./fleet-disposition.mjs)

Use the fleet disposition helper to render one concise
terminal status containing active assignments, blockers and reasons,
replacements, checking change requests, genuinely review-ready change requests,
expired claims, and next capacity replenishment.

Every supplied issue ends as exactly one of:

- `ready-for-human-merge`;
- `blocked`;
- `failed`;
- `timed-out-with-handoff`;
- `deferred`;
- `not-reached`;
- `already-complete`.

The fleet ends as `review-ready`, `partially-review-ready`, `blocked`,
`budget-exhausted`, or `cancelled`. Derive readiness from the current complete
pipeline, confirmed publication, fresh exact receipt or explicit
Shepherd-not-required obligation, and absence of a current expiry queue. Never
trust a stale terminal string. Cancellation and at-ceiling budget exhaustion
stop new dispatch, preserve active evidence safely, generate needed handoffs,
and leave unreached issues explicit.

No status implies merge, approval, risk acceptance, auto-merge, or tracker
closure. Report ready only when current revision quality evidence and the
current Shepherd freshness receipt are complete.
