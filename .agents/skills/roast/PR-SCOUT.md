# PR scout

Fixed instructions for the scout sub-agent that Roast starts first when a human
invokes it with a pull request. Its output is the list of reviewers to start.
It does not review.

## Setup

- **Doctrines.** Load `scout` and `nimble` through [Doctrine](../doctrine/APPLY.md),
  and no other full texts. Read only catalog metadata to choose the wildcard.
- **Model.** The coordinator sets a frontier-tier model, under the same rule as
  the reviewers in [PR-REVIEW](PR-REVIEW.md).
- **Input.** The repository, PR number, base, head SHA, and any reviewers the
  human added or removed.
- **Access.** Read-only. It starts nothing and posts nothing.

## What to start

Match every changed file against this table. Each reviewer loads the doctrines in
its row and no others. A file can match several rows, and each reviewer starts
one time. To add a reviewer, add a row.

| Encounter this | Start this reviewer | Doctrines, and only these |
|---|---|---|
| Code, and the repo has tests or a testing approach (see below) | Testing | `testing`, `test-seams`, `integration-testing` |
| Code | Code quality | `solid`, `code`, `cyclomatic-complexity` |
| Code | Domain alignment | `domain`, `boundaries`, `laziness` |
| Markdown: any `**/*.md`, including skills, `AGENTS.md`, READMEs, changelogs | Documentation | `documentation`, `machine`, `pragmatic` |
| Data: `*.sql`, `migrations/**`, ORM schema files, seed or fixture data meant to load into a store, ETL, batch, stream, or job definitions, queue or data-store configuration | Data | `idempotency`, `data`, `data-processing` |
| Anything else (lock files, generated files, binaries, plain data files, unknown types) | none | list it under `unmatched` |

- Code means source files in any language, and build, test, or automation
  scripts. Code always starts the Code quality and Domain alignment reviewers,
  and starts Testing too when the repo has tests. The code quality reviewer
  applies the `solid` that code review requires.
- **The repo has tests** when any of these exist at the head commit or in the
  PR: test directories or files (`test/`, `tests/`, `__tests__/`, `*.test.*`,
  `*.spec.*`, `*_test.*`), a test runner configuration, a test script or test
  step in the package manifest or CI, or a stated testing approach in the repo
  guidance. Check with a path listing, not by reading the files. With none of
  these, do not start Testing, and say in the return that Testing was skipped and
  why. A PR that adds the first tests counts as having them.
- Markdown is not code. Instruction files are Markdown, so the Documentation
  reviewer covers them.
- The table's reviewers are the only fixed ones. The wildcard below is the only
  other reviewer, and it takes doctrines from the catalog.

## Wildcard reviewer

After the table matches, follow `nimble` and add exactly one wildcard reviewer
with exactly three doctrines. It covers the risk specific to the pull request, which no one table reviewer sees whole. For example, a PR that adds file processing needs
`data-processing`, `idempotency`, and `code` applied together. The Data and Code
reviewers each see half of it, and the wildcard reviews the combination.

- **Three IDs from the catalog.** Mix freely across the doctrine groups. Reuse a
  doctrine another reviewer carries when the combination needs it, but never
  repeat another reviewer's exact set. Never pick `scout` or `nimble`.
- **Choose from metadata.** Use the catalog's IDs and descriptions through
  [Doctrine](../doctrine/APPLY.md). Do not load full texts to choose. The
  wildcard reviewer loads its three verified texts and no others.
- **Name and justify.** Name it for the risk (for example, "File processing"),
  and give one line per doctrine that ties it to a changed path or feature.
- **Always one.** Return a wildcard whenever the PR has reviewable changes. Skip
  it only with `no reviewable changes`.
- **Human control.** The human can replace its doctrines or remove it.
- **Same rules as the others.** Frontier model, read-only, rubber duck before
  reporting, and the merge in [PR-REVIEW](PR-REVIEW.md) folds its overlap with
  other reviewers into one row.

## Steps

1. **List the change.** Get the changed files with status and line counts, the PR
   title and description, and the linked issue. Do not read the diff to review
   it. Open a file only to classify an ambiguous path, and read only enough to
   classify it.
2. **Match.** Apply the table above, then the human's additions and removals.
3. **Add the wildcard.** Choose its three doctrines by the wildcard rules.
4. **Slice only when needed.** When one reviewer's files are too many for one
   pass, split them by directory or layer into slices. Each slice keeps that
   reviewer's doctrines.
5. **Move on.** Follow `nimble`: act on plain matches without asking. Follow
   `scout`: send a path whose type changes who reviews it (for example a JSON
   file that might be a data load or might be config) to `unmatched` with the
   question that would settle it. Do not guess.
6. **Return the plan.** Nothing else.

## Return

One record per reviewer to start, the wildcard included:

- reviewer name, as in the table, or the wildcard's risk name;
- its doctrine IDs, copied from the table or chosen for the wildcard;
- for the wildcard, one line per doctrine that says why it applies;
- the paths or globs it covers, and the slice if split;
- the row that matched, in one line (`wildcard` for the wildcard).

Then:

- `unmatched`: each path with its question, or `none`;
- `skipped`: each roster reviewer not started and why (for example, Testing: no
  tests in the repo), or `none`;
- `no reviewable changes` when nothing matched and nothing is unmatched.

## Limits

- Do not start reviewers. The coordinator starts them, because nested starting
  might be unavailable.
- Do not review, rank, or comment on the change itself.
