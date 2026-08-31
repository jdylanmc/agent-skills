---
name: worker-dispatch
description: Dispatch implementation of a confirmed delivery packet to a separate worker with a bounded brief, so the workflow that judges the change is not the one that wrote it.
level: atom
allowed-tools: ["task","read"]
includes: []
composes: []
used-by: ["ship/_molecules/delivery-cycle/delivery-cycle.md"]
---

# Worker Dispatch

Hand the writing to someone else, and hold them to the ledger.

The orchestration does not implement. A workflow that both writes the change and
judges the change is grading its own work, and the judgement is worth what the
grading is worth.

## Dispatching Is Not A Loophole

The orchestrator holds no `edit` grant. It dispatches a worker that does.

**Say this plainly rather than treating it as a technicality.** "The
orchestrator cannot write" is false in effect: it causes writes, through an
agent it briefed. The honest claim is narrower — the orchestrator does not
*author* the change, so the diff it reviews was produced by a different context
than the one reviewing it.

What actually bounds the writing is not the missing grant. It is the confirmed
ledger, and the reconciliation step that refuses any change the ledger does not
already contain. A brief is an instruction, and an instruction is a promise; the
reconciliation is the control.

## The Brief

A worker is stateless and receives no history. The brief carries, in full:

1. The issue identity and its numbered acceptance criteria.
2. The confirmed change ledger — every `in-scope` and `enabling` entry with its
   stable identifier. **This is the authority boundary.** The worker may change
   what the ledger names and nothing else.
3. The isolation: the worktree path and branch to work in, or the recorded
   reason isolation is absent.
4. The adjacent and out-of-scope findings, marked explicitly as **reportable and
   not actionable**, so the worker does not rediscover them and treat them as
   permission.
5. The repository's binding conventions and how validation is run, so the worker
   does not invent either.
6. The refusals below, in full.
7. What to return: what it changed, mapped to ledger identifiers, and anything
   it could not do.

A brief that omits the ledger has dispatched an unbounded worker.

## What The Ledger Does Not Bound

A ledger names files and changes. Everything a worker could do that **is not a
file change** falls outside it, and a brief that lists only what to edit has
said nothing about any of it. The costly version of this failure is not a bad
edit; it is a worker that pushes, comments on the issue, or opens something on a
shared remote while the run still believes nothing has left the worktree.

So the brief refuses these explicitly, every time:

| Refused | Why it is named rather than assumed |
| --- | --- |
| Writing outside the isolation worktree | The worktree is the boundary reconciliation can see. A file written beside it is invisible to every control below. |
| Pushing, or any write to a remote | Publication happens once, at the end, after review. A worker push makes a shared remote reflect an unreconciled state. |
| Mutating the tracker — closing, commenting, labelling, or assigning | The issue is the run's input. A worker editing its own requirements is the loop the grounding stage exists to prevent. |
| Merging, approving, or requesting review | Merge authority is a person's, and no part of this run holds it. |
| Reading, copying, or emitting credentials, tokens, or secrets | A worker needs none of them for a bounded edit, and evidence that travels through a report is evidence that leaks. |
| Changing repository or agent configuration to make the work pass | Weakening the thing that would have caught the problem is not remediation. |
| Rewriting history, or touching another run's worktree or branch | Both destroy evidence somebody else is relying on. |

These are refusals, not preferences. A worker that believes one of them is
necessary reports that and stops, and the decision returns to the operator.

## Remediation Is A Dispatch, Not A Correction

When validation or review returns a defect, the fix is a **new dispatch to a
fresh worker context** with the defect as its subject, bounded by the same
ledger. The orchestrator does not reach into the worktree and patch it, because
that would make it the author of part of the change it is about to judge. A
prior worker's report is evidence for the fresh worker, never hidden context the
run assumes survived.

Remediation dispatches are **bounded to five attempts per worker context**.
Record `0/5` before the first one. Each returned attempt consumes one slot even
when it fails to change the candidate. Attempt five never becomes attempt six.
If an in-scope implementation blocker remains, the delivery cycle may transfer
the same branch and worktree through a verified `orchestration-handoff` to one
fresh owner with a new `0/5` budget, bounded by the configured global
continuation ceiling and measurable-progress rule.

## A Worker's Report Is A Claim

The worker's account of what it changed is evidence, not verification. It is
reconciled against the actual diff. A worker that changed something it did not
report is exactly the case reconciliation exists to catch, and asking it more
firmly would not find that case.

## Boundaries

- **Never dispatches without a confirmed packet.** An unconfirmed ledger is not
  an authority boundary.
- **Never widens the brief to include an adjacent finding**, including one the
  worker raises mid-run. That is a new issue.
- **Never dispatches a brief without the refusals.** A ledger bounds what may
  be edited and bounds nothing else.
- **Never treats the worker's report as verification.**
- **Never dispatches a worker to judge its own output.**
