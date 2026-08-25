---
name: criterion-verdict
description: Report a delivery run criterion by criterion against the issue's numbered acceptance criteria, with the evidence for each, instead of declaring the issue done.
level: atom
allowed-tools: ["read"]
includes: []
composes: []
used-by: ["ship/_molecules/delivery-cycle/delivery-cycle.md"]
---

# Criterion Verdict

Report against the definition of done. Do not announce it.

The acceptance criteria were extracted and numbered during grounding precisely
so that completion could be checked rather than claimed. A run that ends with
"done" has discarded that structure at the one moment it was for.

## One Verdict Per Criterion

Every numbered criterion gets its own row. No criterion is omitted, merged with
another, or summarized away.

| Verdict | Meaning |
| --- | --- |
| `satisfied` | The criterion is met, and the evidence shows it. |
| `partial` | Some of the criterion is met. What remains is stated specifically. |
| `not-satisfied` | The criterion is not met. |
| `not-verifiable` | The change may satisfy it, but nothing available here demonstrates that. |
| `descoped` | The operator explicitly confirmed removing it from this run. |

`not-verifiable` exists because the alternative is worse. Without it, a
criterion that cannot be demonstrated — a performance claim, a behavior under
load, something only observable in production — gets recorded as `satisfied` on
the strength of an argument. Naming it keeps the gap visible to the person
deciding whether to merge.

`descoped` requires the operator's explicit confirmation, recorded. A criterion
the run decided was unnecessary is `not-satisfied`.

## Evidence, Not Assertion

Each verdict carries what supports it: the validation step that covered it, the
test that exercises it, the ledger entries that implemented it, or the reason
none of those exist.

"The implementation handles this" is not evidence. It is the claim the verdict
is supposed to be checking.

## The Aggregate Is Derived, Never Asserted

A run is complete only when **every** criterion is `satisfied` or `descoped`.
That is a computation over the rows above, not a separate judgement, and it is
never softened because the remaining criteria seem minor. A criterion that seems
minor is a candidate for `descoped` — which requires asking.

Report the criterion table before any summary. A reader who stops after the
first line should have read the least favorable fact, not the most favorable
one.

## Boundaries

- **Never reports an aggregate verdict without the per-criterion rows.**
- **Never invents a criterion** that the grounded packet did not number, and
  never renumbers.
- **Never upgrades a verdict because the change is nearly there.**
- **Does not decide what happens next.** The verdict informs whether to merge,
  continue, or hand back. It does not merge, and it does not accept the risk of
  an unsatisfied criterion.
