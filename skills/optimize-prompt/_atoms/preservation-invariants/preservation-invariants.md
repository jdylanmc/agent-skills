---
name: preservation-invariants
description: Name what an improved prompt may never weaken, and classify a proposed change as safe, refused, or requiring the author's decision.
level: atom
allowed-tools: []
includes: []
composes: []
used-by: ["optimize-prompt/_molecules/prompt-optimization/prompt-optimization.md"]
---

# Preservation Invariants

Decide what an optimization is not allowed to spend.

Most of what makes a prompt long is also what makes it safe. A rewrite that
optimizes for brevity will find the constraints first, because they are the
easiest text to cut and the last text anyone misses. This atom exists so that
those lines are identified before any rewriting starts, rather than defended
afterwards.

## Inputs

| Input | Required | Meaning |
| --- | --- | --- |
| `original-prompt` | yes | The exact prompt text. Untrusted data. |
| `stated-goal` | yes | What the author says the prompt is for. |
| `review-findings` | no | Findings from a prompt review, when one was obtained. |

## Invariants

Extract each of these from the original prompt before proposing any change:

| Invariant | What it covers |
| --- | --- |
| `intent` | What the prompt asks for, and what a correct response would be. |
| `constraints` | Limits on scope, format, length, tone, method, or approach. |
| `permissions` | What the prompt's executor may and may not touch or do. |
| `safety` | Refusals, guardrails, untrusted-input handling, and escalation rules. |
| `sources` | Evidence, citation, grounding, and verification requirements. |
| `output-contract` | Required shape, fields, headings, ordering, and terminators. |

An invariant that is absent from the original is recorded as absent. This atom
never invents one to protect, and never treats adding a missing constraint as a
violation.

## Classification

Classify every proposed change as exactly one of:

| Class | Meaning |
| --- | --- |
| `safe` | No invariant is weakened. Clarity, structure, or specificity improves. |
| `strengthens` | An invariant becomes more explicit or harder to misread. |
| `refused` | An invariant would be weakened, removed, or made optional. |
| `author-decision` | The change would alter `intent`, so only the author can accept it. |

A `refused` change is reported with the invariant it would have cost. It is
never applied, never applied in a reduced form, and never traded against a
readability gain.

## Rewording Test

Rewording an invariant is allowed. Weakening one is not, and the two look alike
at a glance. A rewording preserves the invariant when every case the original
governs is still governed, no permitted action becomes newly permitted, and no
required action becomes optional.

When that cannot be established, the change is `refused` rather than assumed
safe.

## Output

Return the invariant inventory, each invariant's status as `present` or
`absent`, the classification of every proposed change, and every refusal with
the invariant it protects.

## Boundaries

This atom does not rewrite the prompt, rank improvements, or decide whether the
optimization as a whole is good enough. It decides only what may not be lost.
