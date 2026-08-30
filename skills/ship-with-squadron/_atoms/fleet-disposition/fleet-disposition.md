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
expired claims, failed/deferred/awaiting-human work, and next capacity
replenishment. `checking` appears only while an explicit persisted check
activity exists; blocked or terminal work is never relabeled as checking.
Active, blocked, checking, failed, deferred, awaiting-human, and review-ready
status buckets are mutually exclusive; replacement and expiry lists are
orthogonal obligations.

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
trust a stale terminal string or structurally valid but failed receipt.
Continuous Integration must pass, Roast must have no unresolved canonical
`Priority: Must fix`, blast radius must be exactly `satisfied`, criteria must
carry legitimate evidence/decisions, and publication must be confirmed for the
current revision. Cancellation and at-ceiling budget exhaustion
stop new dispatch, preserve active evidence safely, generate needed handoffs,
and leave unreached issues explicit.

No status implies merge, approval, risk acceptance, auto-merge, or tracker
closure. Report ready only when current revision quality evidence and the
current Shepherd freshness receipt are complete.
