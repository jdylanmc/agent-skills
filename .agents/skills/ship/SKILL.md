---
name: ship
description: Implement agreed work from a request, spec, or tickets as the smallest complete change. Use to build a feature or integration with strict scope, test-driven development, code review, verification, and a local commit.
disable-model-invocation: true
---

# Ship

Turn agreed requirements into tested, reviewed code without overbuilding. Finish with the work committed on the current branch; this skill does not publish a PR, shepherd it, or merge it.

The human-authored [Ship intent](intent.md) is copied unchanged from the archive. Its broader delivery requirements remain gaps in this implementation, not permission to expand this workflow's scope.

## Establish the outcome

Read repository guidance, the request or spec, relevant tickets, and existing code. Derive observable acceptance conditions and explicit non-goals. Reuse agreed decisions and test seams; ask when a material requirement, boundary, or tradeoff is unresolved.

Inspect the working tree and record the starting commit before editing. Preserve unrelated changes; if existing work makes ownership or the review range unclear, settle that before proceeding.

## Build the smallest complete change

- Trace the entry point through the layers that own the behavior and its invariants.
- Deliver a coherent end-to-end path. Small means no unnecessary scope, not an arbitrary one-file limit or a patch at the wrong layer.
- Reuse fitting interfaces and existing patterns. Refactor within scope when a patch would duplicate behavior, weaken ownership, or hide the root cause.
- Omit modes, providers, configuration, extensibility, and polish unless the agreed outcome needs them.
- Add a surface, dependency, service, configuration, or migration only when acceptance or correct lifecycle handling requires it; explain material tradeoffs.
- Keep intermediate work runnable and preserve public behavior outside the requested change. Repository safety rules and task permissions still apply.

Use `tdd` at the agreed seams: one observed red-green slice at a time, with small behavior-preserving refactoring after green. State any agreed exception rather than pretending the work was test-first. Run focused tests and typechecking regularly with the repository's existing tools.

## Review the candidate

Commit only the task's changes on the current branch, then use `code-review` against the recorded starting commit and the requirements. The checkpoint commit makes the candidate visible to that skill's committed-diff review; it is not a completion claim.

Address supported, in-scope findings, rerun affected checks, and commit corrections. Have changed code reviewed again before calling it complete. Return requirements changes, scope expansion, or unresolved findings to the human rather than silently deciding them or looping without progress.

If no change was needed, report the evidence without manufacturing an empty commit or invoking a diff review on an empty range. If review is unavailable, report it as a blocker.

## Verify and stop

Exercise the actual end-to-end path and run the full test suite at the end, plus applicable repository checks. Use `verify` to assess every acceptance condition and evidence freshness; reuse completed proof only for unchanged relevant state and inputs.

Report the resulting commit, decisive evidence, and material omissions or blockers. Failed or unavailable required checks are not completion. Once the reviewed change satisfies acceptance, stop; do not add adjacent cleanup or start publication as a side effect.
