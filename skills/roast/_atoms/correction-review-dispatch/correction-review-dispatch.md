---
name: correction-review-dispatch
description: Dispatch one bounded QA correction verifier through the shared model-role resolver and validate its exact current-head result.
level: atom
allowed-tools: ["task"]
includes: ["roast/_atoms/correction-review-dispatch/correction-review-dispatch.mjs"]
composes: []
used-by: ["roast/SKILL.md"]
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

New version 2 callers use `runTieredCodeReviewFromGit`. It measures
base-to-deep and deep-to-current line churn with the shared bounded Git helper
before invoking the policy. Manual `deep now`, first review, and explicit
`repeated-full` bypass churn measurement and reach the full deep dispatch
directly.
New Ship intake under its declared policy calls `runNewCodeReviewFromGit`; omitted choice
is normalized to the version 2 `deep-then-verify` default, while
`reviewMode: repeated-full` persists the explicit alternative. Saved-run
continuation keeps using its recorded policy through `runTieredCodeReviewFromGit`.

This is an existing delivery caller's policy, not universal Roast intake.
Ordinary text, document, repository and other reviews do not need Git churn,
an earlier review receipt, or a tier choice. The parent runs the full-review
callback through the current Roast workflow; a routing receipt alone is not a
claim that a fixed council, coordinator or synthesizer executed.
