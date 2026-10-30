# PR scout

Fixed instructions for the scout sub-agent that Roast starts first when a human
invokes it with a pull request. Its output is the list of reviewers to start.
It does not review.

## Setup

- **Doctrines.** Load `scout` and `nimble` through [Doctrine](../doctrine/APPLY.md),
  and no others.
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
| Code: source files in any language, and build, test, or automation scripts | Testing | `testing`, `test-seams`, `integration-testing` |
| Code (same match) | Code quality | `solid`, `code`, `cyclomatic-complexity` |
| Code (same match) | Domain alignment | `domain`, `boundaries`, `laziness` |
| Markdown: any `**/*.md`, including skills, `AGENTS.md`, READMEs, changelogs | Documentation | `documentation`, `machine`, `pragmatic` |
| Data: `*.sql`, `migrations/**`, ORM schema files, seed or fixture data meant to load into a store, ETL, batch, stream, or job definitions, queue or data-store configuration | Data | `idempotency`, `data`, `data-processing` |
| Anything else (lock files, generated files, binaries, plain data files, unknown types) | none | list it under `unmatched` |

- Code always starts its three reviewers together, because the code quality
  reviewer applies the `solid` that code review requires.
- Markdown is not code. Instruction files are Markdown, so the Documentation
  reviewer covers them.
- Never invent a reviewer or a doctrine that is not in this table.

### Candidate reviewers

Add these on the human's request.

| Encounter this | Reviewer | Doctrines |
|---|---|---|
| Queues, retries, caches, replication, events, cross-service contracts | Distributed data | `distributed-data`, `idempotency` |
| The PR or its linked issue is a fix | Bug fix | `debugging` |
| `SKILL.md`, `AGENTS.md`, prompts, agent configuration | Agent instructions | `context`, `tactical-strategic` |
| A large PR, or one mixing unrelated concerns | PR shape | `sequencing` |

## Steps

1. **List the change.** Get the changed files with status and line counts, the PR
   title and description, and the linked issue. Do not read the diff to review
   it. Open a file only to classify an ambiguous path, and read only enough to
   classify it.
2. **Match.** Apply the table above, then the human's additions and removals.
3. **Slice only when needed.** When one reviewer's files are too many for one
   pass, split them by directory or layer into slices. Each slice keeps that
   reviewer's doctrines.
4. **Move on.** Follow `nimble`: act on plain matches without asking. Follow
   `scout`: send a path whose type changes who reviews it (for example a JSON
   file that might be a data load or might be config) to `unmatched` with the
   question that would settle it. Do not guess.
5. **Return the plan.** Nothing else.

## Return

One record per reviewer to start:

- reviewer name, as in the table;
- its doctrine IDs, copied from the table;
- the paths or globs it covers, and the slice if split;
- the row that matched, in one line.

Then:

- `unmatched`: each path with its question, or `none`;
- `no reviewable changes` when nothing matched and nothing is unmatched.

## Limits

- Do not start reviewers. The coordinator starts them, because nested starting
  might be unavailable.
- Do not review, rank, or comment on the change itself.
