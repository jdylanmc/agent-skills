# Owned agent lifecycle

Supporting contract, not a new skill, controller, or permission system. Owners
and workers load it before dispatch, return/transfer, recovery, and retirement.
Use the caller's authority and existing task/session records.
[WORKSPACE](../ship/WORKSPACE.md) owns Git isolation and Paseo placement;
[DELIVERY](../ship/DELIVERY.md) owns PR readiness. Load those when placing agents
or finishing deliveries; this contract does not replace either gate.
For PR observation and wakeup changes, load
[OBSERVATION](../shepherd/OBSERVATION.md); for issue-backed Joe continuation,
load [RECOVERY](../shepherd/RECOVERY.md). Keep their cadence/episode facts in
this same custody record, not another controller or ledger.

## Record distinct facts

Keep these observable fields in the existing packet/record, with evidence
pointers and observation times; unknown or unsupported stays explicit:

- **Identity/role:** repository identity, agent ID, owning parent/return owner,
  bounded assignment, owned PR scopes, and authorized actions.
- **Placement:** Git common directory, worktree path, branch/start commit;
  Paseo project/workspace IDs and returned mapping when used.
- **Delivery:** actual PR state/draft flag, observed source/target refs and
  commits, acceptance and review/check evidence for that candidate, blockers.
- **Custody:** current scope owner, offered return/transfer, receiver's observed
  state and acknowledgment, remaining duties and next observation when relevant.
- **Runtime:** actual agent status, live child/repair/wakeup ownership, retirement
  result or concrete retention reason, and missing capabilities.

A draft URL is progress, not readiness. A send result is not accepted custody.
Running/idle/completed/cancelled is runtime state, not delivery state. A record
written by the sender is not evidence that a receiver observed or accepted it.
No receipt establishes truth, human approval, or permissions by itself.

## Dispatch, return, and transfer

1. Reconcile existing owners and placement before launching. Confirm the returned
   agent identity and its first observation of the assigned state. Until then,
   dispatch is pending, not a successful ownership transfer.
2. Workers return the actual complete diff/artifacts, candidate IDs, validation
   and acceptance evidence, blockers, and live responsibilities. A bounded
   implementation return is not full delivery; its parent still owns integration,
   independent review, publication, and Shepherd handoff.
3. The receiver inspects decisive artifacts/live state and explicitly
   acknowledges the accepted scope, observed candidate, remaining duties, and
   custody. Preserve that receiver response in the existing record. Delivery
   handoff needs a Shepherd's actual initial PR observation and accepted custody;
   enqueue/send success, a self-authored owner field, or idle status is insufficient.
4. Until acknowledgment, the sender retains responsibility without concurrent
   mutation. Sequence branch access: outgoing writer stops writing before the
   receiver begins; no duplicate monitor or repair loop. Same-session entry into
   Shepherd still requires its initial observation and recorded acceptance of
   the role, not merely naming the skill.
5. After accepted return, either assign a concrete follow-up with an owner and
   resumption condition, or retire the terminal worker below. Reuse a retained
   worker for pending fixes when supported; hypothetical future work is not a
   reason for indefinite retention. If self-retirement would lose the report,
   explicitly assign the owning parent to accept/preserve it and retire the agent.

## Recover before replacing

Cancellation, runtime loss, or an unconfirmed handoff invalidates live-custody
claims. Record the observation gap and reconcile the known owner and children,
provider refs, partial diffs/commits, pending permissions, and scheduled wakeups.
Do not infer no work from a cancelled parent or idle child. Preserve partial
work; establish which writers/monitors actually stopped before resuming the same
owner or assigning a replacement. Uncertain visibility blocks overlapping work.
Transfer each remaining scope explicitly; never revive stale ownership or create
a second monitor merely because sending to the first failed.

A runtime may host several explicitly assigned Shepherd PR scopes. Keep one
owner and each PR's required observation cadence; share execution, not scope,
intent, or readiness. One PR's merge ends only that scope. Active repairs,
other PRs, a heartbeat waiter, a human/permission blocker, or recovery work can
justify retention even when the runtime reports idle.

## Retire finished owned agents

The owning workflow **must actually archive/retire** its clearly terminal agents
using supported harness operations after accepting/preserving results and
transferring or completing all remaining duties. This is the default within
that ownership authority, not just a list of cleanup candidates. Read-only
analysis and bounded implementation can be terminal after accepted return;
Shepherd is terminal only when its actual duties across all owned scopes end.

Before acting, verify the exact owned agent ID, terminal assignment, preserved
evidence, accepted return/custody, and no active child, repair, wait, or other PR
responsibility. Coordinate run-owned wakeups without disturbing other scopes.
Cancel/delete and verify only no-longer-needed owned wakeups under OBSERVATION;
a terminal fresh schedule-run agent does not end its future schedule duties.
Then invoke supported agent archival/retirement and verify the resulting archived
state (or documented removal from the active view). If evidence or ownership is
uncertain, retain with the specific reason and next action, not a false success.

For Paseo, inspect current tool schemas: `archive_agent` interrupts a running
agent, so it is not a harmless visibility toggle. Never archive all idle agents,
another owner's agents, or a live monitor to make the UI tidy. If self-archive
cannot safely finish reporting, the acknowledged parent performs and verifies it.
When archival is unavailable/denied, report the capability limit, retained ID,
and responsible owner's next action; do not guess APIs, widen permissions, or
silently retain forever.

Agent retirement is **not** project/workspace archival or deletion of worktrees,
branches, or evidence. In particular, Paseo workspace archival may delete an
owned worktree: never substitute it for agent archival. Preserve those resources;
any separately authorized Git cleanup follows WORKSPACE's preservation checks.

For changes to this contract or its callers, exercise the
[acceptance scenarios](LIFECYCLE-SCENARIOS.md). Package/link tests prove shipped
guidance is reachable, not that a runtime obeyed it.
