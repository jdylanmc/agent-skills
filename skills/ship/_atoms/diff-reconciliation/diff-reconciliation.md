---
name: diff-reconciliation
description: Reconcile the actual diff of a delivery run against the confirmed change ledger, stopping the run on any change the ledger does not already contain.
level: atom
allowed-tools: ["execute","read"]
includes: ["ship/_atoms/diff-reconciliation/diff-reconciliation.mjs"]
composes: []
used-by: ["ship/_molecules/delivery-cycle/delivery-cycle.md"]
---

# Diff Reconciliation

Check what actually changed against what was agreed would change.

## Required Files

1. [Reconciler implementation](./diff-reconciliation.mjs)

The confirmed ledger is the authority boundary for the run. Reconciliation is
what makes it a boundary rather than an intention: every unit of the diff must
map to exactly one confirmed `in-scope` or `enabling` entry, and anything that
does not stops the run.

## Why This Exists And Not A Firmer Instruction

The documented failure of every delivery run in this repository was scope creep:
an unregistered test, an invocation flag on an unrelated skill, an edit to the
validator. None were malicious. All were defensible in isolation. None would
have been caught by instructing the worker more firmly, because the worker
believed each one was justified.

Reconciliation catches them because it compares the diff to the agreement rather
than asking anyone whether they stayed in scope.

## What Is Reconciled, And Against What

The subject is **everything the run changed**, not everything it committed. A
change left uncommitted, unstaged, or untracked is still a change sitting in the
branch a change request will be opened from.

| Input | Value |
| --- | --- |
| Base | The commit the isolation branch was created from, recorded before any implementation. Not `main`, and not whatever the base branch has since become. |
| Subject | The isolation worktree as it stands now, including staged, unstaged, and untracked files. |
| Detection | Rename and copy detection on, so a moved file is one change rather than a deletion and an unrelated addition. |

Untracked files are invisible to a plain `git diff`, so they are given an index
entry without content first:

```sh
git -C <worktree> add --intent-to-add --all
git -C <worktree> diff --find-renames --find-copies <base-sha>
```

Reconciling `HEAD` against the base instead would ignore exactly the residue a
run is most likely to leave behind, and "it was not committed" is not a reason a
reviewer will ever see.

A path excluded by the repository's ignore rules stays out of the diff and
therefore has no unit. Record any such path the run created as residue and
report it, rather than letting the ignore file decide what counts as a change.

## Granularity

Reconciliation is at **hunk** granularity, not file granularity.

File granularity fails in a specific and likely way: a ledger entry naming a
file would vouch for every change made anywhere in that file, including the
one-line adjacent fix that the scope boundary exists to refuse. The tempting
case — a small correction in a file already being edited — is precisely the case
file-level coverage waves through.

Each hunk maps to exactly one ledger entry. A hunk claimed by two entries is
ambiguous and is reported as ambiguous rather than resolved by picking one.

## A Change With No Hunks Is Still A Change

A rename, a copy, a mode change, an emptied or empty-created file, and a binary
edit all reach the diff as headers with **no `@@` line at all**. Walking hunks
alone therefore sees nothing to claim, and a run that renamed a file nobody
agreed to move reconciles clean.

So every changed file carries at least one addressable unit. Content hunks are
addressed by index; everything a content hunk cannot express is addressed once
per file as `metadata`, carrying the parsed reason — `rename`, `copy`,
`mode-change`, `add`, `delete`, `binary`, or several joined together.

A file that was both moved and edited has **two** units. The entry claiming the
edit describes the edit, and vouching for the move with it would be file-level
coverage arriving through the back door.

An unrecognized header with no hunks yields a unit with the reason `unknown`.
That fails closed on purpose: an unparsed change stops the run rather than
disappearing from a diff that then reconciles.

## Verdicts

| Verdict | Meaning | Effect |
| --- | --- | --- |
| `reconciled` | Every hunk maps to exactly one confirmed entry. | Continue. |
| `undisclosed-change` | A hunk maps to no confirmed entry. | **Stop the run.** |
| `ambiguous-mapping` | A hunk maps to more than one entry. | Stop and report both. |
| `unfulfilled-entry` | A confirmed entry has no corresponding hunk. | Report. Does not stop the run. |

An `undisclosed-change` is not remediated by adding a ledger entry for it after
the fact. Amending the agreement to match what happened is not reconciliation;
it is a record that no boundary was enforced. It returns to the operator, who
decides whether to confirm an amended packet or drop the change.

An `unfulfilled-entry` does not stop the run because a planned change that
proved unnecessary is a smaller diff, which is the direction the laziness lens
wants. It is still reported, because the more common cause is a criterion that
was quietly not satisfied.

## The Deterministic Reconciler

[Reconciler implementation](./diff-reconciliation.mjs) performs the mapping.
Prose cannot enforce exhaustive
coverage — that is arithmetic, and arithmetic is exactly what an agent narrating
its own diligence gets wrong.

Give it the parsed diff and the confirmed ledger. It returns the verdict and the
specific unmapped or doubly-mapped hunks. Its result is reported as given: a
reconciler that returns `undisclosed-change` has not raised a concern to weigh
against delivery pressure.

**It checks coverage and uniqueness, not meaning.** Nothing here can read a hunk
and know whether the entry claiming it really describes it. The semantic
judgement stays with the reviewer. What the reconciler removes is narrower and
more valuable: the ability to leave a change undisclosed at all. Claiming more
than that would make this control the same kind of promise it exists to replace.

## Generated And Derived Files

A file the repository generates from other files is reconciled through the
ledger entry that caused the regeneration, not as an independent change. The
ledger entry must say that regenerating it is expected.

This is a real exception and is stated rather than assumed, because "it is
generated" is otherwise available as an excuse for any unexplained hunk.

## Boundaries

- **Never amends the ledger to make the diff reconcile.**
- **Never accepts a worker's account of its changes in place of the diff.**
- **Never downgrades `undisclosed-change` to a warning** because the change is
  small, obviously correct, or already validated.
- **Reports, and does not fix.** Reconciliation identifies the discrepancy. The
  fix is a decision for a person or a bounded remediation dispatch.
