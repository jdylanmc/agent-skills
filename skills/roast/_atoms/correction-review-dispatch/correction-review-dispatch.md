---
name: correction-review-dispatch
description: Dispatch one bounded QA correction verifier through the shared model-role resolver and validate its exact current-head result.
level: atom
allowed-tools: ["task"]
includes: ["roast/_atoms/correction-review-dispatch/correction-review-dispatch.mjs"]
composes: []
used-by: ["roast/_molecules/roast-code-branch/roast-code-branch.md"]
---

# Correction Review Dispatch

## Required Files

1. [Correction review dispatcher](./correction-review-dispatch.mjs)

This is the single-reviewer fast path for an eligible correction. It uses the
existing `qa-reviewer` role, GPT-5.6 Sol with GPT-6 Astra as the only fallback,
high effort, and default context through Agent Spawn.

The prompt includes the original requirements and findings, latest and
cumulative deltas, affected consumers, negative cases, and current validation.
The reviewer may find the original recommendation unsupported, report a
regression, or escalate uncertainty. It cannot approve or clear work from a
textual claim.

Unavailable or mismatched routing is a named failure. The result is accepted
only when it is exact-head bound and matches the local correction schema.
Every original finding, requirement, and affected consumer must appear exactly
once in the result. Requirement checks carry evidence and negative cases.
Regressions, new findings, uncertainty, missing coverage, and unresolved
dispositions cannot return `complete`.
`runTieredCodeReview` is the callable seam used by Ship and
Ship-with-Squadron: it invokes this verifier for an eligible correction and
calls the existing full-review callback for initial, baseline, shadow, or
escalated work.
