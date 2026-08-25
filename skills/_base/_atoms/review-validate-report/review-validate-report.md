---
name: review-validate-report
description: Validate one returned report against one declared contract and return either a pass or the exact named defects. Never repairs, summarizes, or accepts a partially valid report.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["_base/_molecules/roast-coordinate-review/roast-coordinate-review.md","optimize-prompt/_molecules/prompt-optimization/prompt-optimization.md","prompt-coach/_molecules/prompt-review/prompt-review.md"]
---

# Review Validate Report

Check one returned report against the contract the caller declared for it, and
return either a pass or the exact defects by name. This atom decides whether a
report is *well formed*. It never decides whether the report is *right*.

Naming the defects is the whole point. A caller that retries needs to tell the
next run exactly what was wrong, and a caller that gives up needs to tell its
reader exactly what was not verified.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `report` | yes | The returned text, unchanged. |
| `required-first-line` | no | Exact line that must be the first line. |
| `required-headings` | no | Headings that must each appear exactly once, in the given order. |
| `required-fields` | no | Field names that must appear with a non-empty value. |
| `required-values` | no | Field names and the exact value each must carry. |
| `section-constraints` | no | Named per-section rules, including required entries, entry order, maximum or exact cardinality, and required fields on each entry. |
| `cross-section-constraints` | no | Named relationships between sections, including one-to-one coverage, ordering by identity, and mutual exclusion. |
| `nested-report-contracts` | no | Contracts that every nested report must satisfy, including its required headings, fields, and terminator. |
| `forbidden-content` | no | Content or caller-supplied values that must not appear, optionally scoped to named sections. |
| `terminator` | no | A line that must be the final line. |
| `echo-identity` | no | A value the report must reproduce **unchanged**. Supply the value, and optionally the sections it must appear in and whether every returned finding must carry it equal to that value. A present-but-different value is a mismatch, not a pass. |
| `required-per-finding` | no | Fields every returned finding must carry, such as evidence, location, confidence, or validation method. |
| `prior-dispositions` | no | Finding identities the report must reconcile rather than silently drop. |

## Counting Rule

Count a first line, heading, field, value, section entry, nested-report
terminator, or final terminator only when it starts at the beginning of a line
and sits **outside every fenced block**. Quoted evidence inside a fenced block
never counts, even when it reproduces contract material.

Without this rule a report that quotes its own contract as evidence validates
itself, and a report that quotes a terminator truncates itself.

## Operation

1. Preserve `report` unchanged.
2. Evaluate every supplied requirement. A requirement that cannot be evaluated
   from the complete report is a defect, not a reason to skip that requirement.
3. For section and cross-section constraints, identify entries by the exact
   identity rule supplied by the caller. Count each entry once, enforce the
   declared order and cardinality, and evaluate every declared relationship.
4. Validate every nested report independently against its supplied contract.
   A valid sibling never compensates for an invalid or missing nested report.
5. Search for each `forbidden-content` value only in its declared scope, or in
   the complete report when no scope is supplied.
6. Return `Valid` only when every check passes. Otherwise return every exact
   named defect found in one result.

## Output

| Field | Meaning |
| --- | --- |
| `status` | `Valid` or `Invalid`. |
| `defects` | Empty when valid. Otherwise one entry per failure, each naming the specific missing, duplicated, misordered, empty, or mismatched item. |

Defect categories: `First-line mismatch`, `Missing heading`,
`Duplicate heading`, `Misordered heading`, `Missing field`, `Empty field`,
`Value mismatch`, `Missing section entry`, `Unexpected section entry`,
`Cardinality violation`, `Entry order violation`, `Cross-section mismatch`,
`Mutual-exclusion violation`, `Invalid nested report`, `Forbidden content`,
`Missing terminator`, `Identity mismatch`, `Incomplete finding`,
`Unreconciled prior disposition`, `Unevaluable requirement`.

## Guarantees

- A report is valid only when **every** declared requirement passes. There is
  no partial pass.
- Fixed values, cardinality, ordering, section relationships, nested contracts,
  and forbidden content are enforced when the caller declares them.
- A report whose findings are all empty is **valid** when its structure holds.
  An empty result is a real result and is never treated as a failure.
- The report is never modified, repaired, reformatted, or summarized.
- Every defect names the specific item, never a category alone, so a retry can
  state exactly what to fix.

## Boundaries

This atom does not spawn the run that produced the report, does not retry, does
not judge whether a finding is correct or applicable, and does not decide what
happens after an invalid result. Those belong to the caller.
