---
name: merge-gate
description: Decide whether a completed delivery run may merge at all, withholding by default and reaching a grant only when every mechanical precondition is met and a person explicitly grants it.
level: atom
allowed-tools: ["read"]
includes: ["ship/_atoms/merge-gate/merge-gate.mjs"]
composes: []
used-by: ["ship/SKILL.md"]
---

# Merge Gate

Compatibility API for callers that record a human merge disposition.
**Ship does not invoke this as a delivery stage or ask for a merge grant.**
Merging belongs to a person; readiness and empty findings are not permission.

## Required Files

1. [Merge gate implementation](./merge-gate.mjs)

A run that finishes reports a lot of good news at once: criteria satisfied,
suite green, review clear. The failure mode is that the good news reads as
permission. Nobody decides the change may merge; it simply stops being
questioned.

So the disposition starts at `withheld` and has to be moved. Nothing here
merges, and nothing here approves — the grant is a record that a person
authorized the merge, and the merge remains theirs to perform.

## Dispositions

| Disposition | Meaning |
| --- | --- |
| `withheld` | The default. At least one precondition is unmet. |
| `eligible` | Every mechanical precondition is met. **No grant yet, so still not permission.** |
| `granted` | Every precondition is met *and* a person explicitly granted the merge. |

`eligible` is deliberately not `granted`. It is the most dangerous state in the
table, because it is the one that reads like approval, and it is exactly where a
run would otherwise coast into merging on the strength of a green suite.

## Preconditions

All of them, together. There is no majority and no waiver.

| Precondition | Met when |
| --- | --- |
| Criteria | At least one criterion exists, and every one is `satisfied` or `descoped`. |
| Reconciliation | The verdict is `reconciled` or `unfulfilled-entry`. |
| Validation | The `run-ci` status is exactly `passed`. |
| Review | `status: Complete`, `coverageComplete: true`, and `revision` equals the supplied full immutable `head`, with an explicit empty `blockers` array. |
| Isolation | The state is `worktree`, or `none` with recorded operator consent. |

A **blocker** is a `roast` finding at `Must fix` that has not been remediated,
disputed by the operator, or descoped to its own issue. `roast` returns a
severity and gates nothing; treating `Must fix` as blocking is this run's own
conservatism, and clearing one is never this run's decision alone.

`intermittent` is not `passed`. A failure that passed on retry is a failure with
a second data point, and treating it as green is how a flaky test becomes a
policy of ignoring it.

An empty criteria list is unmet rather than vacuously met. Nothing to check
against is not the same as everything checked.

The caller derives `coverageComplete` from sufficient coverage in the actual
current-head Roast report and its required runtime evidence, never from the
absence of findings. Missing completion, `Partial`, `Needs clarification`,
unknown status, stale revision or missing coverage withholds even with a grant.
This API does not obtain a grant or verify personhood; any grant supplied must
come from a separate explicit human decision, not from provider review text.

## The Grant Is A Distinct Token

The grant is a specific recorded value, not a truthy one. `true`, `"yes"`, `1`,
and a populated object all fail to grant.

This looks pedantic and is not. A boolean default, a config flag, or an
optimistic caller supplies a truthy value by accident all the time; none of them
supplies the token by accident. The whole point of the gate is that the grant
cannot arrive as a side effect, and a truthy check is precisely how it would.

## A Grant Does Not Override A Precondition

The preconditions and the grant are conjunctive. A grant given while a criterion
is `not-satisfied` leaves the disposition `withheld`, and the unmet precondition
is reported.

Overriding an unmet criterion is accepting a risk, and accepting risk is not
this gate's to do. That decision is a person's, taken with the criterion table
in front of them, and it belongs in the change request rather than inside a
disposition that reads as clean.

## Boundaries

- **Never merges, approves, or enables auto-merge.** The grant records
  authorization; a person performs the merge.
- **Never defaults to `granted` or to `eligible`.** Missing evidence is unmet
  evidence.
- **Never accepts a truthy value as the grant.**
- **Never lets a grant substitute for an unmet precondition.**
- **Never revises a criterion verdict, a validation status, or a review finding
  to reach a precondition.** It reads them; it does not negotiate with them.
