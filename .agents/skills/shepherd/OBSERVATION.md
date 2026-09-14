# Scheduled, adaptive observation

Shepherd loads this contract before taking or resuming custody. It owns cadence
and wakeup mechanics, not delivery readiness or new service authority.
[LIFECYCLE](../squadron/LIFECYCLE.md) owns accepted custody and retirement.
Keep all state in the existing per-delivery custody/session record.

## Establish a real observer

At authorized kickoff, record the bounded monitor job: PR scopes, owner,
permitted observation/maintenance, lifetime and stop conditions, scheduler
authority, and any explicit human cadence override. Tool availability alone
does not authorize service setup, installation, or unrelated jobs. A narrower
observation-only assignment remains read-only against the PR.

When an authorized supported scheduler exists, **establish and use it** for
actual observation. Prefer a heartbeat waking the same persistent agent and
custody. Inspect existing owned wakeups first; verify the exact job ID,
agent/project/workspace binding, stored cron/timezone, and next wakeup. A local
record or a creation response alone does not prove observation: observe the PR
now and verify that scheduled wakes actually resume its duties. Report missed
wakes rather than assuming a stored cron executed.

A schedule that starts a **fresh agent each run** is not a heartbeat. Use it
only with durable state accessible to each run, verified shared ownership and
serialization, and the existing repository project/worktree workspace mapping
under [WORKSPACE](../ship/WORKSPACE.md). Inspect current schemas; never invent
`create_schedule` arguments or assume a fresh run inherits the right cwd.
Reconcile surviving runs and partial work before a new run observes or writes.
If exclusive ownership cannot be established, stop affected dispatch. Retire a
finished run agent after its accepted return; keep the schedule when future
observation is still needed.

Do not substitute a shell busy/sleep loop for an available supported scheduler.
If none is available or authorized, state the limitation: a supported
session-attached interruptible wait may serve while that session actually runs.
Otherwise record **monitoring stopped**, last observation and resumption action.
Never install a scheduler, widen permissions, or promise unattended monitoring.
Persistent external lifetime must be authorized; preserve explicit stop/access
boundaries and check them at every wake.

## Meaningful snapshots and consecutive quiet observations

Observe immediately at takeover/resume. Default stages are **1, 5, 15 minutes**,
starting at 1 minute, capped at 15; explicit human cadence overrides take
precedence and remain recorded rather than silently migrated.

Project a complete provider observation into a stable per-PR snapshot:
source/target repository and literal refs/commits; reviews, comments and finding
identities/content/resolution; required check/status identities and conclusions;
draft/open/merged/closed state, mergeability, policies and other actual readiness
blockers. Include edited/deleted feedback when the provider exposes it. Sort
unordered collections consistently. Exclude observation timestamps, volatile API
envelopes, job logs, polling counters, and incidental ordering. Keep observation
time separately. Fetch logs only for diagnosis, not as the inactivity comparator.
Missing pages, unknown required status, or incomplete review/check coverage are
not complete observations; do not replace the last complete snapshot with them.

Apply these transitions after each actual observation, not after elapsed ticks:

| Observation | Quiet streak and desired cadence |
| --- | --- |
| First complete baseline, no verified previous snapshot | Save baseline; streak 0, 1 minute. It proves no unchanged history. |
| Complete successful unchanged observation, no failed validation or unresolved repair | Increment streak. At exactly 30 at 1 minute, change to 5 minutes and reset to 0; at exactly 30 at 5 minutes, change to 15 and reset to 0. |
| Complete successful unchanged observation at 15 minutes | Stay capped at 15; saturate streak at 30, never increase cadence again. |
| Meaningful change detected | Save complete snapshot when available; reset streak to 0 and desired cadence to 1 minute, then reconcile/act within authority. |
| Incomplete/failed observation, unknown required state, failed validation, or unresolved repair | Break the consecutive streak to 0; do not earn a slower stage or claim inactivity. Keep the current desired stage unless a meaningful change was detected. |
| Cadence/binding update pending, failed or unverified | Keep streak at 0 until effective cadence/binding is reconciled. Observations at the old period cannot earn the next slower stage as if the desired update succeeded. |

Thus the baseline plus 30 successful unchanged observations moves to 5 minutes
on observation 31 overall, not on observation 30. The next successful unchanged
observation is streak 1 at the new stage, not evidence for the next transition.
Unchanged known pending checks may count only when their status is fully known
and no validation failure or unresolved repair exists; they never prove readiness.
Respect provider Retry-After/rate limits over desired cadence. Record throttled
next observation and permission stops; do not accelerate error retries.

Verified durable snapshots/stages/streaks survive a session restart. Observe
immediately, reconcile ownership and actual wakeups, and record any gap. A
verified contiguous history can continue; missed/unknown observation coverage
breaks the streak to 0 without inventing ticks or resetting the stage by age.
Without verified state, establish a new baseline at 1 minute.

At 15-minute cadence, a new change may take 15 minutes to detect. Resetting on
detection is not push immediacy. Use reliable authorized events when available
to observe earlier, serialize duplicate event/timer wakes, and do not claim
event coverage when only polling exists.

## Persist and reconcile the wakeup

Add to the existing per-PR record: normalized snapshot and its evidence; quiet
streak/stage; source/target literal refs/commits and observation time; owner;
exact scheduler/heartbeat ID, type and binding; desired versus observed cadence,
cron/timezone and next wakeup; last successful/attempted observation and gaps;
explicit override/lifetime; pending repair, transfer, or cadence-update result.
Read back persistence before claiming resumability. A scheduler tick resumes
known work, never restarts an active repair.

For multiple PRs, keep independent due times and stages. Schedule the next due
wakeup (or the minimum needed periodic cadence), then observe **all due PRs
fairly**, not one PR per global tick. Maintain each PR's next due time from its
own observations; do not charge other PR ticks toward its quiet streak. One
periodic cron may align differently from those due times: verify the next actual
wake is no later than the earliest due time, using a finer authorized cadence
or earlier observation when necessary rather than rounding observation later.
Record any unsupported timing precision as a limit. One
slow repair must not erase observation responsibility: continue observation-only
coverage of due PRs, arrange an accepted transfer, or report overdue gaps and
safe suspension. Do not imply blocked execution observed on time.

Change only the owned job's period within approved bounds. Read its current
binding before updating; preserve prompt, job scope, lifetime/expiry, permissions,
provider and other settings. Verify stored cron, unchanged binding and next
wakeup afterward. Desired cadence is not effective cadence until readback.

- **Paseo schedules:** the verified update surface supports `id` plus `cron`
  (and `timezone` when needed). Send only those needed fields, not a copied
  object that may overwrite concurrent settings. Confirm current tool schema.
- **Paseo heartbeats:** MCP exposes create/delete, not update. When the actual
  CLI is available, use in-place period-only update, for example
  `paseo heartbeat update <id> --cron "*/5 * * * *"`. This requires the
  agent-scoped `PASEO_AGENT_ID` supplied by the runtime; never fake that variable
  or borrow another agent's identity. Verify ownership and the resulting binding.
- **Heartbeat MCP fallback:** reconcile exact owned heartbeat and preserve its
  prompt/binding/bounds before delete/recreate. Verify deletion before creating
  the replacement so two monitors cannot compete. Record the gap; this is not
  atomic. Verify the replacement and persist its new ID. Uncertain deletion or
  creation requires inspection before retry, never blind duplicate creation.

On failed/uncertain update, inspect actual stored state: retain and report the
old cadence if still running, or **monitoring stopped** if removal succeeded
but replacement did not. Do not claim the desired period took effect. If state
cannot be verified, report unknown wakeup ownership and reconcile before another
create/update. Do not silently restore or change unrelated settings.

## End only finished duties

On terminal PR duties, persist final evidence. Cancel/delete and verify only the
owned wakeup that is no longer needed. Keep a shared wakeup/agent while another
PR, repair or accepted transfer still needs it; recompute the remaining due
times. At human stop/decision/access-loss, safely suspend the affected duties and
record any retained resources, owner and resumption gate. A cancelled session
does not prove its external job stopped.

When all duties end, remove the now-unneeded owned wakeup and arrange actual
agent retirement under LIFECYCLE, including parent-performed self-retirement.
Report failed deletion/retirement honestly with exact retained IDs and next
action. Preserve worktrees, workspaces, branches and evidence.

Exercise [adaptive/recovery scenarios](SCENARIOS.md) when changing this contract.
Package checks prove reachability, not scheduler execution or agent compliance.
