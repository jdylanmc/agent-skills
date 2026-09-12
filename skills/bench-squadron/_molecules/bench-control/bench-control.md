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

Current delivery remains separate from historical PR identity. A requirements
revision or a new candidate stays outstanding until validation and current
distinct-slot review complete. A green old PR is a shortcut only for genuine,
unchanged-work maintenance, never merely because an issue has a PR. Superseded
publication acknowledgments retain that PR identity without completing new work.

Maintenance observation/diagnostic reads occur before slot reservation. Ordinary
read errors block only the affected item, retain its previous successful
observation/time and record a new actionable error timestamp. They consume no
attempt/slot and do not cancel unrelated workers. Stop/pause/cancel generations
remain fences; uncertain process ownership still fails globally rather than
being downgraded to an ordinary read error.

## Invoking-agent machine interface

These are internal agent operations and optional advanced manual commands.
The person supplies tasks and material decisions, not machine JSON.

From the skill directory:

```sh
npm run setup -- /absolute/machine-state/bench/runtime
npm run smoke -- /absolute/machine-state/bench/runtime
npm run smoke -- --models /absolute/machine-state/bench/runtime /absolute/machine-state/bench/model-inspection
npm run bench -- start /absolute/machine-state/bench/run .bench/config.json
npm run bench -- enqueue /absolute/machine-state/bench/run .bench/task.json
npm run bench -- status /absolute/machine-state/bench/run
npm run bench -- status /absolute/machine-state/bench/run --json
npm run bench -- pause /absolute/machine-state/bench/run
npm run bench -- resume /absolute/machine-state/bench/run
npm run bench -- revise /absolute/machine-state/bench/run .bench/revision.json
npm run bench -- stop /absolute/machine-state/bench/run
```

`--models` starts the SDK only for authenticated metadata and stops it with owned
process cleanup; no model session/response is created. A live verification request
is a separate, explicitly authorized action:
`npm run smoke -- --live-files CACHE STATE` exercises real scoped synthetic-file
read/write permission requests; `--live` exposes zero tools and proves less.
For `--live-files`, STATE must not exist and its canonical parent must already
exist. Exclusive directory creation precedes fixture writes. Existing directories
(even empty), files and valid/dangling links are refused without changing prior
input, output or result evidence and without launching a worker.

The invoking agent writes a config using actual accepted values:

```json
{
  "run": "example",
  "checkout": "/absolute/delivery-repository",
  "runtimeDirectory": "/absolute/machine-state/bench/runtime",
  "repository": "OWNER/REPOSITORY",
  "base": "main",
  "slots": 5,
  "quorum": 3,
  "lifetimeMs": 3600000,
  "maxAssignments": 100,
  "models": { "implement": "ACTUAL_ADVERTISED_ID", "review": "ACTUAL_ADVERTISED_ID" },
  "doctrine": { "implement": ["code", "testing"], "review": ["code", "testing"] }
}
```

Prepare each work packet through Bench Epoch's `prepareWork(task, sources)`
helper after retrieving/transcribing the evidence. The underlying task shape is:

```json
{
  "id": "parser",
  "title": "Repair the agreed parser behavior",
  "requirements": "The actual operator task and acceptance criteria.",
  "dependsOn": [],
  "paths": ["src", "test"],
  "validation": [["npm", "test"]]
}
```

Each source has `uri`, `revision` (including selected lines when applicable),
exact bounded `text` and `sha256`. Requirements embed this source evidence without
changing `paths`. Source digests prove text integrity, not human approval.
Never claim a source was read or version-verified when it was not.

For an explicitly approved material answer/context update, the agent prepares
`revision.json` with `issue`, the current `expectedRequirementsHash` from
`status --json`, and new complete `requirements`. `revise` requires unowned work,
does not change file/command grants, and cannot bypass external-head reconciliation.
It rebinds requirements and invalidates only affected issue reviews.

`retry STATE ID` is only for blocked unowned work with unchanged authorized
inputs; it cannot accept external drift. `cancel STATE ID` retires local Bench
ownership without closing the tracker or PR. Inbox publication takes a local
exclusive lock and durable sequence; bounded contention can fail explicitly
(up to two seconds), not silently reverse commands. Known-dead publisher locks
can be recovered; missing/live identity remains a refusal. Retain failed command
IDs/receipts and reconcile an uncertain submission rather than assume success.
