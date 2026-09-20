---
name: joe-mode-orca
description: "Human-enabled repository team coordinator on Orca. Routes Joe workflows through supervised workers and explicitly enabled recurring automations."
disable-model-invocation: true
user-invocable: true
---

# Joe-mode Orca

Run Joe-mode as a human-enabled, repository-bound coordinator on Orca. This is
an adapter around [Joe-mode](../joe-mode/SKILL.md), not another project
management policy or controller. Orca supplies supervised workers, task and
message lifecycle, and explicitly enabled recurring execution; Joe supplies
the backlog, routing, review, capacity, permission, and human-decision policy.

## Activation boundary

Installing this skill never activates a team, creates a Run, starts a worker,
or creates an automation. Only a human may activate or manage it. Setup asks
only for unset material decisions: repository and workspace, goal and backlog
source, owner binding, permissions, capacity overrides, and whether recurring
execution is requested. A matching preauthorized wake may load the bounded
`RUN.md` pass without repeating intake; an unknown owner, workspace, or
permission fails closed.

Read [RUNTIME.md](RUNTIME.md) before using native Orca operations,
[RUN.md](RUN.md) for one bounded PM pass, and
[AUTOMATIONS.md](AUTOMATIONS.md) before configuring recurrence. These guides
are operational contracts, not proof that the runtime performed an action.

## Joe policy retained

Use the existing Joe workflows and team policy:

- Six developer slots by default; feature work reserves two, fixes,
  hardening, and refactors reserve one. Every writing descendant counts.
- One shared Shepherd, one persistent Discovery lane in its dedicated
  worktree, and one logical repository controller across session, CMUX, Paseo,
  and Orca. Never mix runtime mechanics or create a competing controller.
- Route through existing Ship, Patch, Refactor, Discovery, Shepherd, and
  delivery contracts. Preserve independent review, useful TDD preference,
  capacity, permissions, bounded blocker recovery, and human waits every PM
  pass.
- Human merging is the default. A PR coordinator is optional only when
  separately requested and an explicit repository gate permits it; it cannot
  self-approve or bypass policy.

## Lifecycle

Each pass reconciles the private owner record, live Run, task/dispatch
identities, workers, worktrees, messages, gates, and exact owned automation
IDs before acting. Process every FIFO Delivery message before acknowledging it.
An accepted `worker_done` must match both the active task and dispatch; a send
receipt proves enqueue only. Unknown launch/release results are pending and
must be recovered with the native request/show or retry contract, never
duplicated.

On pause, close or settle dispatches first, disable only exact owned
automations, reconcile issued operations, and preserve evidence, worktrees,
branches, and explicit child disposition. Stop never silently resumes or
resets the team. Unsupported owner binding, permissions, recurrence,
workspace mapping, or fencing blocks the affected operation with an exact next
action.

## References

- Joe routing: [Joe-mode](../joe-mode/SKILL.md)
- Team custody: [Squadron lifecycle](../squadron/LIFECYCLE.md)
- Delivery finish: [Delivery](../ship/DELIVERY.md)
- Recovery: [Shepherd recovery](../shepherd/RECOVERY.md)
- Observation: [Shepherd observation](../shepherd/OBSERVATION.md)
- Invocation and caller permissions: [Setup invocation policy](../setup/INVOCATION.md)
