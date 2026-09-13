---
name: slop-sniper-advisory
description: Trigger one asynchronous, snapshot-bound, advisory Slop Sniper audit at declared TDD Squadron material checkpoints.
level: atom
allowed-tools: ["execute","task"]
includes: []
composes: []
used-by: ["tdd-squadron/_molecules/tdd-candidate-loop/tdd-candidate-loop.md"]
---

# Slop Sniper Advisory

At `pre-dispatch`, `repeated-failure`, `handoff`, `post-review-mutation`,
`shared-root-failure`, `pre-readiness`, or `terminal-with-active-work`, create
one immutable snapshot using the deterministic lifecycle helper and invoke
`/slop-sniper` asynchronously with that exact snapshot.

The audit holds no delivery-pool seat, never becomes a scheduler or candidate
reviewer, and cannot block the transition that emitted it. Treat its returned
recommendation as advisory. Consume it only at a later safe transition when
the snapshot's run, control revision, candidate, and candidate revision still
exactly match. Discard stale or invalid reports rather than applying them.
