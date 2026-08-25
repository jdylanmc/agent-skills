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
6. What to return: what it changed, mapped to ledger identifiers, and anything
   it could not do.

A brief that omits the ledger has dispatched an unbounded worker.

## Remediation Is A Dispatch, Not A Correction

When validation or review returns a defect, the fix is a **new dispatch** with
the defect as its subject, bounded by the same ledger. The orchestrator does not
reach into the worktree and patch it, because that would make it the author of
part of the change it is about to judge.

Remediation dispatches are **bounded**. Record the attempt count and its limit
before the first one. When the limit is reached the run hands back rather than
dispatching again; a loop that retries indefinitely converts a defect into a
budget.

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
- **Never treats the worker's report as verification.**
- **Never dispatches a worker to judge its own output.**
