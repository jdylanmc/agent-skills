---
name: duplicate-capability
description: Decide, for each job the confirmed synthesis carries, whether the destination should gain a skill, be routed to one it already has, or stop for a human, so an adoption never creates a second skill for a job the destination already does.
level: atom
allowed-tools: ["read","execute"]
includes: ["snipe-skill/_atoms/duplicate-capability/duplicate-capability.mjs"]
composes: []
used-by: ["snipe-skill/_molecules/destination-authoring/destination-authoring.md"]
---

# Duplicate Capability

The failure this exists to prevent is the pleasant one. A run is asked to adopt
a skill, finds the destination already does that job, and creates a second one
anyway — because creating is what it came to do, and stopping feels like
failing. The library gains two skills with one job, and the router picks the
wrong one at the wrong moment.

Adoption is not a delivery target. Discovering the destination already has the
capability is a **successful** outcome of asking the question.

## Required Files

1. [Deterministic routing decision](./duplicate-capability.mjs)

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `jobs` | yes | Each job the confirmed synthesis carries: `{ id, statement, assessments }`. |
| `capabilities` | yes | The destination's declared existing skills, each `{ id, job }`. |
| `capabilitiesEnumerated` | yes | Whether that inventory was actually enumerated, rather than assumed empty. |

Each job assesses **every** declared capability exactly once, with an `overlap`
of `same-job`, `partial`, or `none`. Anything other than `none` carries the
evidence the assessment rests on.

## Who Judges What

Whether two skills do the same job is a reading of both, and a model does that
reading. This atom does not, and pretending otherwise with a similarity score
would produce a number nobody could argue with.

What this atom owns is what *follows* from the assessment, which is exactly the
part a run under momentum gets wrong:

| Assessment | Decision | Why |
| --- | --- | --- |
| Exactly one `same-job` | `route-existing` | The destination already does this. Say so, name the skill, create nothing. |
| Two or more `same-job` | `stop` — `ambiguous-existing-capability` | The destination has its own duplication to resolve first. |
| Any `partial`, no `same-job` | `stop` — `undecided-overlap` | "Close enough to reuse" and "different enough to build" is a product decision. |
| All `none` | `create` | Nothing there does this job. |
| Inventory not enumerated | `stop` — `capability-inventory-unavailable` | An inventory nobody looked at cannot establish that a job is absent. |

Every `stop` and every `route-existing` carries its evidence and at least one
bounded way forward, so the operator receives a decision to make rather than a
dead end.

## Several Jobs Is Normal

A confirmed synthesis may warrant more than one destination skill, and each job
is decided on its own. There is deliberately **no one-skill-per-run cap**: the
cap would be arbitrary, and the real constraint is that each job carries its own
assessment, its own decision, and its own evidence.

## Output

| Field | Meaning |
| --- | --- |
| `decisions` | One decision per job, with its reason, evidence, and ways forward. |
| `summary` | Counts of `create`, `route-existing`, and `stop`. |
| `creatable` | The jobs that may proceed to authoring. |
| `blocking` | The jobs that need a human before anything proceeds. |

## Guarantees

- A job an existing skill already does is never created a second time.
- An unclear overlap stops rather than resolving itself toward creating.
- Absence of a capability is claimed only from an inventory that was enumerated.
- An unassessed, unknown, unevidenced, or unrecognized assessment is refused
  rather than treated as `none`.
- Any number of jobs may be decided in one run.

## Boundaries

This atom decides routing, not adoption. It does not read the destination's
skills, compare them, author anything, reinforce an existing skill, or decide
that a `stop` was really a `create` after all. It never overwrites or converts an
existing skill, and a `route-existing` decision is a recommendation to the
operator, not an edit.
