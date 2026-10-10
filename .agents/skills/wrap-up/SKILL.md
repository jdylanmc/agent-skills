---
name: wrap-up
description: "Human only. Checkpoint after ad-hoc work: freeze scope, true-up with main, make tests and lint pass, reconcile docs and visual POC with the changes, then raise one undrafted PR with green CI."
disable-model-invocation: true
user-invocable: true
---

# Wrap-up

**Entry:** Human only, under the [invocation contract](../setup/INVOCATION.md). Preserve the original [intent](intent.md). The request authorizes one PR for the current branch: push, open or update, undraft. It grants no merge or approval authority.

Ad-hoc work ended. Reach a checkpoint. No new functionality.

Preserve any [doctrine selection](../doctrine/APPLY.md). PR-producing work requires `worktrees`.

## 1. Freeze scope

Stop feature work. List what changed: `git diff` against merge base with `main`, plus uncommitted and untracked files. Separate intended changes from stray files (`.DS_Store`, caches, `.user/`, credentials). Never commit stray files. Unexplained change: ask, do not guess.

## 2. True-up with main

`git fetch origin main`. Rebase or merge per repository convention. Resolve conflicts keeping both sides' intent; no leftover conflict markers. After resolve, grep for `<<<<<<<`, `=======`, `>>>>>>>`.

Force-push only with `--force-with-lease`, only own branch.

## 3. Tests

Find the repository's test commands (README, `AGENTS.md`, package manifest, CI workflow). Run all. Fix failures caused by or tightly coupled to the change. Pre-existing unrelated failure: report, do not fix. Never weaken, skip, or delete a test to get green. A failure only on local noise (OS files, missing local tools): confirm cause, report it.

## 4. Lint and format

Run each linter, type check, and formatter the repository defines. None defined: say so; add none.

## 5. Reconcile documentation

Make every doc match the final behavior: README, `AGENTS.md`, catalogs, indexes, counts, examples, and the changelog through the shared [Changelog helper](../changelog/SKILL.md). Add no new doc for its own sake. Doc and code disagree: code wins unless code is the bug; then report.

Human-owned sources (intent, doctrine) change only on explicit human request.

## 6. Reconcile visual POC

Find visual POC artifacts: mockups, diagrams, prototype HTML, `poc/` output. Update each to match the final change. None exist: state "no visual POC" and move on. Do not create one.

## 7. Raise the PR

Commit in logical commits per the [commit style](../setup/COMMIT-STYLE.md). Push. Write the body with [Pull Request](../pull-request/SKILL.md). Open one PR, or update the existing one for this branch; never open a second.

Undraft: `gh pr ready`.

## 8. CI green

Wait for checks. Read each failure log. Fix cause, push, wait again. Repeat until all required checks pass. Skipped check: confirm skip is expected. Never bypass, disable, or rerun-until-lucky a real failure.

Stop and report if blocked: failing check outside scope, missing permission, review requirement.

## 9. Report

Return: PR link, state (undrafted), check results, what changed since checkpoint start, local-only caveats, open blockers. Stop. Do not merge.
