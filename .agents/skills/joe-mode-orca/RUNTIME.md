# Orca runtime contract

This adapter replaces only Paseo's runtime mechanics. It does not copy
Paseo's state machine or introduce a scheduler, permission ledger, approval
framework, or second Joe controller. Load the existing Joe, workspace,
lifecycle, delivery, observation, and recovery contracts for their policy.

## Repository controller and ownership

Record a private owner packet before the first authorized pass:

- canonical repository identity, literal source/target refs, exact workspace
  and dedicated Discovery worktree;
- human owner conversation, Joe controller identity, Run ID, and permitted
  actions/lifetime;
- backlog source, goal, six-slot capacity and reservations, active workers,
  tasks/dispatches, Shepherd, and pending questions/gates;
- exact automation IDs, desired/observed state, trigger/timezone, workspace,
  provider, reuse-session setting, and next wake;
- pause/stop disposition and every uncertain operation requiring reconciliation.

An Orca Run is a durable namespace and inbox, not a scheduler, lock, or
repository-wide exclusion. One Run does not fence another Run, clone, host, or
runtime. Reconcile the same private Joe owner record and require observed
owner binding and acceptance before dispatching. Local state cannot fence a
remote writer. Unknown identity or an existing possible controller blocks a
new controller.

The one logical repository controller may be represented by session, CMUX,
Paseo, or Orca surfaces, but those surfaces must transfer authority through
the supported runtime and owner record. Do not infer authority from a title,
cwd, restored pane, or automation name.

## Worker lifecycle

Use native `run-create`/`run-use`, `task-create`/`task-update`,
`worker-start`, `worker-show`, `worker-read`, `worker-stop` or
`worker-abandon`, and `worker-release` operations. Use the current injected
terminal and dispatch identity; never fabricate a worker handle, task ID,
dispatch ID, repository identity, or completion receipt.

Before starting, reconcile surviving tasks, dispatches, worktrees, and
permissions. Start only bounded work with the selected placement and existing
Joe route. All writing descendants count against capacity: features reserve
two developer slots; fixes, hardening, and refactors reserve one; support
roles remain separate. The shared Shepherd and persistent Discovery lane have
one owner each. Timers never create a new controller or fill an empty role.

Read and process every FIFO Delivery before acknowledging it. A
`worker_done` is accepted only when its task ID and dispatch ID match the
active assignment; preserve its inspectable output before release. A send
receipt proves enqueue, not receiver acceptance. Exited, idle, contact loss,
permission wait, and unverifiable are distinct states. Unknown mutation
results are recovered with `request-show` and the exact retry request, never
by blindly repeating a start, stop, release, or dispatch.

Retire only the exact settled owned terminal with `worker-release`. It is not
a generic terminal close and does not delete worktrees, branches, evidence,
or other workers. Preserve remote work before local cleanup. If fencing,
owner binding, or permission readback is unsupported, stop the affected
operation and report the exact next human action.

## Run pass

Every PM pass observes first, reconciles the owner packet, reads the backlog
and pending deliveries, and then either dispatches one bounded useful next
step or records a concrete blocker/question. It waits for human decisions at
the same Joe gates as other adapters. A pass must not manufacture activity,
re-dispatch an unresolved failure, or claim recurrence from configured state.

No model, provider, or effort override is hardcoded. Use configured runtime
defaults unless the human explicitly selected an override. Optional provider
skills are not implicit setup dependencies.
