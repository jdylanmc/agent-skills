---
name: improvement-ledger
description: Record every material change between the original and improved prompt as an inspectable entry carrying the problem, the change, and its justification.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["optimize-prompt/_molecules/prompt-optimization/prompt-optimization.md"]
---

# Improvement Ledger

Make every change arguable.

A returned prompt that is simply better is not reviewable. The author cannot
tell which edits fixed a real problem, which reflect the optimizer's taste, and
which quietly changed what the prompt asks for. The ledger exists so that any
single change can be rejected without rejecting the whole rewrite.

## Entry

Each material change carries:

| Field | Meaning |
| --- | --- |
| `id` | A stable identifier for this change. |
| `location` | Where in the original the change applies. |
| `problem` | The specific weakness the change addresses. |
| `grounding` | `review-finding`, `invariant`, or `optimizer-judgement`. |
| `review-finding-id` | Required when `grounding` is `review-finding`. The identifier of the finding this change answers. |
| `before` | The original text, or `absent` for an addition. |
| `after` | The replacement text, or `removed` for a deletion. |
| `classification` | The preservation class assigned to the change. |
| `rationale` | Why this change fixes the named problem. |

`grounding` is the honest part. A change traceable to a review finding is
better supported than one the optimizer proposed on its own, and labelling the
difference lets the author weight them differently instead of receiving both as
equally justified.

That label only means something if it can be checked. `review-finding` without
`review-finding-id` is an unverifiable claim, and an identifier naming no real
finding is worse than none, so both are treated as `optimizer-judgement` and
reported. A change made on taste must be allowed to say so; what it may not do
is borrow the authority of a review that never mentioned it.

## Author Decisions

A change that would alter `intent` is not a ledger entry, because no such
change was made. It is recorded separately as a proposal carrying the same
`problem`, `before`, `after`, and `rationale` fields, plus what the author
would be deciding.

Keeping proposals out of the ledger is what keeps reconciliation honest: the
ledger describes differences that exist between the two prompts, and a proposal
describes one that does not. Mixing them would make every unapplied suggestion
look like an unexplained edit.

## Cosmetic Changes

Whitespace, list markers, and heading punctuation that alter no meaning are
summarised as a count rather than itemised. Any change that alters wording,
ordering, emphasis, or structure is material and gets its own entry.

## Refusals

Refused changes are recorded alongside applied ones, each naming the invariant
it would have cost. A refusal is a result, not an omission: it tells the author
that a plausible improvement was considered and rejected for a stated reason.

## Coverage

Every material difference between the original and improved prompt has exactly
one ledger entry, and every ledger entry corresponds to a real difference. A
change present in the improved prompt but absent from the ledger is an
undisclosed edit, which is the failure this atom exists to prevent.

Coverage is established per changed line rather than per region of the diff. A
disclosed rewording sitting next to an undisclosed deletion must not vouch for
its neighbour, which is exactly how a constraint disappears from a prompt whose
ledger looks complete.

## Output

Return the ledger entries, the author-decision proposals, the refusal list, the
cosmetic-change count, and the grounding distribution across `review-finding`,
`invariant`, and `optimizer-judgement`.

## Boundaries

This atom does not produce the improved prompt, decide whether a change is
permitted, or apply anything to a file. It records what was done and why, in a
form the author can argue with.
