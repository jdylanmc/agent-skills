---
name: adoption-outcome
description: Resolve how an adoption run ends by reconciling every confirmed job against the decision ledger and requiring structured validation, review, and change-request records that all describe the same final head, refusing any claim of a merge or approval, and requiring a named decision with a way forward from every stop.
level: atom
allowed-tools: ["execute"]
includes: ["snipe-skill/_atoms/adoption-outcome/adoption-outcome.mjs"]
composes: []
used-by: ["snipe-skill/_molecules/destination-authoring/destination-authoring.md"]
---

# Adoption Outcome

The temptation at the end of a long workflow is the success-shaped report. A
package exists, files were written, the run has been going for a while, so it
says `adopted` and stops.

This atom refuses that in the only way that survives a tired reviewer: the
evidence is a **precondition of the status**, not a section of the report.

## Required Files

1. [Deterministic outcome resolution](./adoption-outcome.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `decisions` | yes | The routing ledger: one entry per confirmed job. A `route-existing` entry also names the `existing` skill the routing step selected. |
| `destinations` | yes, when anything was created | Each created destination skill: `{ skill, job, head, validation, review, changeRequest, merged, approved }`. |
| `routed` | when anything was routed | Each `{ job, skill }` the run routed to instead of creating. |

Each created destination carries structured evidence, not labels:

| Record | Shape | Meaning |
| --- | --- | --- |
| `head` | non-empty string | The final package head everything else must describe. |
| `validation` | `{ passed, commands, summary, head }` | Whether it passed, which commands ran, their summary, and the head they ran against. |
| `review` | `{ disposition, account, head }` | The disposition the destination's own review reached, its account, and the head it read. |
| `changeRequest` | `{ locator, head }` or `null` | The opened change request and the head it contains. |

`disposition` is one of `clean`, `unresolved`, `awaiting-operator`, `halted`, or
`absent`.

## Every Confirmed Job Is Accounted For

The other way a long run reports success is by quietly dropping something. A
synthesis carrying three jobs, one of which stopped for the operator, can be
reported as two adopted skills and a silence — and a silence is not a status
anybody reads.

So the outcome is resolved against the **decision ledger** the routing step
produced, not against whatever destinations happen to be in hand. Every confirmed
job appears exactly once, every `create` maps to exactly one created destination,
every `route-existing` maps to the skill the routing step actually selected, and
a job that was decided one way but reported another is refused. Missing, extra,
duplicated, and misattributed are each a way for a job to vanish from the report,
so each is a refusal rather than a tolerated variation.

**One result discharges one job.** A skill identity is claimed by at most one
job **across both collections**, and so is a change request. Without that, two
confirmed jobs could share a single package, its single review, and its single
change request, and both would report as adopted on evidence that only ever
covered one of them — or, more strangely, one skill could be reported as newly
created for one job and as an already-existing route for another, claiming a
package was simultaneously built and already there.

Routing to a skill the ledger never selected is refused for the same reason: it
would report a job as already done somewhere nobody assessed.

A single unresolved `stop` makes the run `awaiting-human` however well the rest
of it went. That ordering is deliberate: the unresolved job is the thing the
operator needs to see, and burying it under two successes is exactly the report
this atom exists to prevent.

## Why Records Instead Of Labels

An earlier version took `validation: true` and `review: 'clean'` — two words a
caller could type. The problem was not that they could be typed untruthfully;
that is true of records too. It is that labels **cannot express the relationship
that matters**, which is that the review read the head the change request
contains.

The stale review is the realistic failure here: a package is reviewed, a finding
is fixed, the head moves, and the earlier verdict is reported against the new
package. Nobody lied. With records and a shared `head`, that arrives as a named
shortfall instead of a clean report.

## What It Checks: Shape And Consistency, Not Truth

This atom enforces the **shape** of the evidence a completion claim requires, and
the **internal consistency** between its parts: an `adopted` status is impossible
without passing validation that names the commands it ran, a clean review with an
account, an opened change request, and all three describing the same final head.

It does not verify that evidence against the world. It cannot open a network
connection to confirm a change request exists or re-run the destination's
validation. Supplying evidence that matches what the destination workflow
actually reported is the caller's obligation, and the change request is what puts
the whole thing in front of a person who can check.

That is still worth having. It removes the easiest failure — a long run reporting
success while quietly holding no review and no change request — and it makes the
missing piece appear by name in `shortfalls` rather than as an absence nobody
notices.

## The Three Rules

1. **`adopted` is earned.** Every created destination carries passing
   validation, a review that reached `clean`, a change request a human can read,
   and all three describing the same head as the package. A destination missing
   any of them, or describing a different head, turns the whole run `blocked`
   with the shortfall named per skill. A partially adopted run reported as
   adopted is worse than one reported as blocked, because the blocked one gets
   looked at.
2. **The run opens a change request and stops.** A destination reporting itself
   merged or approved is refused as `authority_exceeded` — not downgraded, not
   warned about. Skill Sniper has no merge authority and does not acquire it by
   finishing well, and this is the boundary most likely to erode as the rest of
   the workflow gets better at its job.
3. **A stop names its decision.** `stopWith` requires the unresolved decision in
   the operator's terms and at least one bounded way forward. A stop that cannot
   say what a human would decide is an absence dressed as an outcome.

A run in which **every** job routes to an existing destination skill creates
nothing, and correctly opens no change request: `routed-existing` is a complete
outcome, not a failed adoption. A change request belongs to a created package.

## Several Destinations

One confirmed synthesis may produce several destination skills, and there is no
cap. The honest constraint is not how many were created but that **each** one
carries its own validation, its own review, and its own change request. One
weak destination blocks the run rather than being carried by the others.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `adopted`, `routed-existing`, `awaiting-human`, `refused`, or `blocked`. |
| `created` / `changeRequests` | The destination skills created, and the change request opened for each. `changeRequests` is present only when something was created. |
| `unresolved` | The confirmed jobs still awaiting the operator. |
| `validation` | Per adopted skill, the commands that ran and their summary. |
| `routed` | Existing destination skills the run routed to. |
| `shortfalls` | Per skill, exactly what was missing when the run is blocked. |
| `decision` / `waysForward` | On a stop: what a human must settle, and how to move. |
| `merged` / `approved` | Always `false`. |

`publicOutcome` reduces a resolved outcome to a status and coarse counts for a
parent outside the destination's trust boundary, and still reports
`merged: false` and `approved: false`. It summarizes an outcome; it does not
re-derive one, so the caller resolves first and summarizes second.

## Guarantees

- No destination is reported adopted without passing validation, a clean review,
  an opened change request, and all three describing the package's final head.
- A review or validation of a superseded head is a named shortfall, not a pass.
- One incomplete destination blocks the run.
- A merge or approval claim is refused wherever it appears.
- Every stop carries a named decision and at least one way forward.
- Every reported status comes from the closed set.
- A `routed-existing` outcome names the skills it routed to, creates nothing,
  and requires no change request.
- Every confirmed job appears exactly once in the result, or the outcome is
  refused.
- A skill identity and a change request each discharge at most one job, counted
  across created and routed results together.
- A route goes to the skill the routing decision named, or it is refused.
- One unresolved job makes the run `awaiting-human`, whatever else succeeded.
- The checks are shape checks; truthful evidence is the caller's obligation.

## Boundaries

This atom resolves and reports. It does not run validation, perform the review,
open the change request, remediate a finding, or decide that a shortfall was
acceptable. It never merges, never approves, and treats a finished-looking run
with missing evidence as blocked rather than complete.
