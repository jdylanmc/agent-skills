---
name: bench-control
description: Run the durable operator queue through bounded fresh SDK assignments, independent candidate review and monitored GitHub publication.
level: molecule
includes: ["bench-squadron/_atoms/atomic-proposal/atomic-proposal.md","bench-squadron/_atoms/bench-epoch/bench-epoch.md","bench-squadron/_atoms/fleet-state/fleet-state.md","bench-squadron/_atoms/role-doctrine/role-doctrine.md","bench-squadron/_molecules/bench-control/bench-control.mjs"]
composes: ["bench-squadron/_atoms/atomic-proposal/atomic-proposal.md","bench-squadron/_atoms/bench-epoch/bench-epoch.md","bench-squadron/_atoms/fleet-state/fleet-state.md","bench-squadron/_atoms/role-doctrine/role-doctrine.md"]
used-by: ["bench-squadron/SKILL.md"]
allowed-tools: ["execute","read"]
---

# Bench Control

## Required References

[Controller and CLI](./bench-control.mjs) own one living queue and a bounded set
of reusable slots. A slot is capacity, not a lifetime agent identity. A separate
deterministic controller owns readiness and dispatch; it does not cast votes.
Implementations and reviews always receive fresh SDK sessions.

Read the boundaries in order:

1. [Fleet state](../../_atoms/fleet-state/fleet-state.md): durable ownership and restart.
2. [Bench epoch](../../_atoms/bench-epoch/bench-epoch.md): issue-local review evidence.
3. [Role doctrine](../../_atoms/role-doctrine/role-doctrine.md): models, full lenses and constrained SDK sessions.
4. [Atomic publication](../../_atoms/atomic-proposal/atomic-proposal.md): validation and replay-safe provider effects.

The loop processes operator commands, accepts only released current-context
results, observes published PRs, publishes quorum candidates and fills available
slots. Read-only reviews may run together. A correction waits until all readers
of that issue have released; there is only one writer. Admissions and unrelated
issue changes do not alter another issue's reviewed basis.

Default capacity is five and quorum three; configurable capacity is 1–32, with
quorum no larger than capacity. `maxAssignments` counts all generations including
reviews and Shepherd work. `lifetimeMs` starts once and survives restart.
`assignmentMs` defaults to ten minutes; `commandMs` to two minutes; `pollMs` and
`reportMs` to one minute; `maxIssueAttempts` to six. All are finite positive values.
An exhausted attempt limit blocks that issue, not independent progress.

Published PR polling consumes no worker slot. A stale base or failing CI enqueues
one maintenance order for the affected issue. It uses the same capacity, fresh
implementation context, validation and distinct-slot quorum, then updates the
same PR. No second pool, forced push or permanent polling worker exists.
External head changes block automatic correction until operator reconciliation.
Human merge retires monitoring and opens dependency gates; human closure retires
monitoring without declaring the requirement delivered.

The controller's concise periodic reports retain readiness observation times and
separate observation failures from old evidence. Neither a timeout nor returned
assistant text proves session termination. Uncertain ownership stops dispatch,
keeps the reservation and returns a failure, rather than spawning replacements.

Tests exercise controller/provider seams without paid SDK calls. Run
`npm test` from the skill directory; the import/live SDK smoke is separate.
Working-tree tests do not substitute for the repository's final committed-range
reinforcement and sensitive-content checks.

## Responsive control and reports

While awaiting provider I/O or validation, the same controller services its
inbox, lifetime limit and report cadence on a 250 ms wake. It does not reenter
the delivery work cycle or allocate another worker. The pending operation and
its start time are persisted and reported; readiness observations keep their
original timestamps. Native Windows ownership queries are asynchronous too.

Stop/pause acknowledgement advances a small control-generation fence. Every
subsequent provider command checks it, so pause followed by resume cannot revive
the old in-flight sequence. This is cancellation state, not a review epoch:
existing current-candidate votes and publication identity remain valid.
Uncertain command release retains its reservation. Stop also requests bounded
SDK cancellation; pause lets existing sessions drain.

Already-running commands can finish or reach their bounded deadline plus native
cleanup time. Their effects cannot be retroactively undone. New dispatch and
provider polling wait behind the current provider sequence, but admissions,
control receipts and concise reports do not. Synchronous local persistence and
OS scheduling can delay a service wake; this is not a hard real-time guarantee.
Default output is human-readable; `start ... --json` and `status ... --json`
explicitly select machine output. No notification integration is introduced.
