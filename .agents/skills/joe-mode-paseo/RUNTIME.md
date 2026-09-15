# Paseo capability gates

## Recommended orchestration recipe

Paseo's current [orchestration workflows](https://paseo.sh/docs/orchestration-workflows.md)
pair periodic continuation through a same-agent heartbeat with worker delegation,
progress checks, follow-up prompts, isolated implementations and independent
review. Its [schedules guide](https://paseo.sh/docs/schedules.md) distinguishes
heartbeats for reassessing ongoing work from fresh agents for recurring jobs.

For this ongoing engineering team, recommend **one dedicated repository PM with
a heartbeat**, five minutes by default and an explicitly recorded minute-step
cron. The retained agent is the coordinator, not a keepalive for a user's chat.
Each prompt executes RUN once, using Joe-mode's decisions and shared board.
Completion callbacks handle normal progress; recurring passes catch missed
returns, stalls, scope drift, new requirements and changes to the backlog path.
Fresh scheduling remains an option only when its placement/lifetime gates pass.

Use the supported MCP or CLI orchestration surface; a custom SDK service is
not required for this recipe. The [TypeScript SDK](https://paseo.sh/docs/sdk.md)
is a client of the same daemon, not a separate scheduling guarantee. Never
invent SDK scheduling methods or install a new long-running service merely to
wrap an available tool.

A heartbeat **does not repair its own dead PM agent** or survive every provider,
permission or host failure. Reconcile the bound agent and wakeup evidence when resuming, report
the observation gap, and require explicit fenced takeover if the PM is lost.
Do not claim perpetual supervision from a stored cron record.

The following is primary-source review, not a live runtime experiment. Consult the current
[official index](https://paseo.sh/llms.txt),
[orchestration](https://paseo.sh/docs/orchestration.md),
[workflows](https://paseo.sh/docs/orchestration-workflows.md),
[schedules](https://paseo.sh/docs/schedules.md),
[schedule CLI](https://paseo.sh/docs/schedules-cli.md) and
[MCP reference](https://paseo.sh/docs/mcp.md). Use the installed Paseo reference
for operations and Paseo-help for product questions when available. Missing
documentation/tool discovery is a capability limit, not permission to guess APIs.

## Known incompatible fresh-schedule mapping

At upstream source **799c91b39d6a8dad6fb4ccf385d789285a29e260**, inspected
2026-09-14:

- [Schedule service, lines 884–982](https://github.com/getpaseo/paseo/blob/799c91b39d6a8dad6fb4ccf385d789285a29e260/packages/server/src/server/schedule/service.ts#L884-L982)
  creates a workspace for each new-agent run; local isolation calls the directory
  factory rather than accepting an existing workspace binding.
- [Bootstrap, lines 1270–1284](https://github.com/getpaseo/paseo/blob/799c91b39d6a8dad6fb4ccf385d789285a29e260/packages/server/src/server/bootstrap.ts#L1270-L1284)
  calls directory provisioning with cwd/title, not project or workspace IDs.
- [Provisioning, lines 201–224](https://github.com/getpaseo/paseo/blob/799c91b39d6a8dad6fb4ccf385d789285a29e260/packages/server/src/server/session/workspace-provisioning/workspace-provisioning-service.ts#L201-L224)
  generates a fresh workspace ID without an explicit context ID. Same cwd does
  **not** establish reuse. The service can also archive the entire run workspace
  in its `finally` path, depending on configuration.

**Fresh-mode activation is blocked on this implementation.** The schedule schema available
to the reviewed workflow has no explicit `workspaceId`/`projectId`; never invent
those arguments. Even if a repository project is reused, a new workspace every
minute violates the required mapping. Do not quietly use worktree isolation,
manual agent loops or a heartbeat instead. Setup may recommend a **same-agent
heartbeat with explicit operator consent**, preserving the one-workspace rule.
If fresh is required, a supported mapping capability in the deployed version is
needed; refusal of the alternative leaves activation blocked. This skill neither
patches Paseo nor silently changes the chosen mode.

## Same-agent heartbeat surface

At the same source pin, the
[heartbeat CLI](https://github.com/getpaseo/paseo/blob/799c91b39d6a8dad6fb4ccf385d789285a29e260/packages/cli/src/commands/heartbeat/index.ts)
creates a schedule with `target: {type: "agent", agentId}` from the actual
calling agent identity and checks that ownership before update/delete. Its
update command changes cadence/timezone only; it is not a pause/resume operation.
Current discovered MCP exposes `create_heartbeat` (cron, prompt, optional name,
timezone, maxRuns, expiresIn) and `delete_heartbeat` (id), **not** a target-agent
creation argument or `pause_heartbeat`/`resume_heartbeat`.

Use MCP create/delete only for this mode. The dedicated/reused PM agent must
call them in its human-authorized setup/management subflow; bootstrap/reviewer
calls would bind to the wrong agent. Never alter `PASEO_AGENT_ID` or fake detach.
**Do not use schedule APIs to verify heartbeats.** The current
[MCP reference](https://paseo.sh/docs/mcp.md) limits schedule listing, inspection,
logs, pause/resume and run-once to new-agent schedules. At source
**174055a63c4651bff2a5ab5a316e8d7a403a3444**, inspected 2026-09-14,
[the MCP handlers](https://github.com/getpaseo/paseo/blob/174055a63c4651bff2a5ab5a316e8d7a403a3444/packages/server/src/server/agent/tools/paseo-tools.ts#L2568-L2683)
return the created heartbeat summary, filter agent-target jobs out of
`list_schedules`, and reject them in `inspect_schedule`.

Use the successful **creation receipt** as configuration evidence. Verify its
actual `id`, `target.type: "agent"`, `target.agentId`, `status: "active"`,
`prompt`, `cadence.expression`/timezone, `nextRunAt`, `expiresAt` and `maxRuns`
against the approved request. Join its target to the actual PM's current
agent/workspace/project/cwd/Git observations. Runtime settings belong to that
agent, not a fresh-schedule config. The helper's flattened `kind`, `enabled`,
`cron` and mapping are this verified join, **not API creation fields**.
Save the full request/receipt and human decision in the existing private packet.

A complete creation receipt plus actual initial backlog/ownership observation
is sufficient to enable the local board. Do not delete a successfully configured
heartbeat merely because schedule inspection rejects it. This proves
**configured**, not **recurring operation verified**. Later actual wakeups in
the same PM conversation, with runtime provenance and bounded-pass receipts,
establish recurring delivery. A copied prompt or saved cron is not a wakeup.
Status uses those receipts and current agent state, with observation gaps stated;
do not fabricate a heartbeat-list/inspect API or require one to finish setup.

For adoption/recovery, inspect the saved operation receipt and actual caller
identity, pending changes and received wakeups. A stale receipt alone does not
prove a heartbeat is still active. If a creation response was lost or the job's
current identity/state is uncertain, keep the board gated and ask the human or
use a separately verified heartbeat-specific runtime surface. An empty schedule
list or a schedule-only rejection proves neither heartbeat absence nor failure.
Do not create another job to probe the uncertainty.

Pause/stop closes the local board gate **before** deleting the exact owned
heartbeat; queued prompts must return without dispatch. Keep the PM agent for
pause/resume and unresolved duties. A human may recreate only after complete
acknowledged deletion of the exact old ID, released/fenced old pass and preserved
target/scope/settings are verified. `delete_heartbeat` returns `{success: true}`
after deleting the caller-owned heartbeat at the source above; preserve that
receipt as deletion evidence without a second schedule query. A transport error,
generic not-found or wrong-target error is not that acknowledgement. Reconcile
uncertain delete/create responses through supported heartbeat-specific evidence
or the human before retry/replacement.
Preserve absolute expiry and remaining run budget when applicable; recreation
must not silently extend the original grant. Stop/end permits retirement only
after owned-wakeup absence and accepted transfer/end of all children/reporting.

## Required activation evidence

Before any job creation, identify the actual daemon version and supported
schemas/source behavior, actual PM placement and granted capabilities below.
After creating/adopting the one job while locally paused, verify its mode-specific
binding evidence and initial observation before enabling claims. Subsequent receipts
alone prove recurring delivery; future results are not precreation evidence.

1. **Fresh only:** same explicit cwd resolves each fresh scheduled run to the **existing**
   correct project/workspace, without per-run duplicates. Verify the effective
   repository/common directory/branch mapping, not only schedule configuration.
2. **Fresh only:** the schedule cannot auto-archive a shared workspace at finish/failure/restart.
   Use only supported settings verified against that runtime; do not guess an
   `archiveOnFinish` parameter from a different surface's implementation.
3. **Heartbeat only:** the human explicitly chose this conversation/lifetime mode.
   Verify the dedicated/reused PM agent is already in the one correct existing
   workspace/project/cwd, not a disposable bootstrap/reviewer, and the supported
   API binds the caller. After creation, verify the receipt's actual target
   equals that agent. Same-agent delivery must not provision/retire workspaces per tick. This mode
   does not need fresh-workspace-factory proof, but must prove actual agent
   binding and safe ongoing lifetime on the deployed host.
4. **Both modes:** PM passes can read/write the same durable board, inspect known agents,
   descendants, permissions and mode-specific wakeup evidence, and preserve/report results
   with narrow human-granted tools. Scheduler availability is not tool access.
5. **Both modes:** parent/child archival and callback visibility are known, or each still-needed
   parent is explicitly retained with a bounded role. `archive_agent` interrupts
   a running agent; `archive_workspace` may remove an owned Git worktree. Agent
   placement does not detach parentage. Never fake detachment or change
   `PASEO_AGENT_ID` to escape ownership.
6. **Both modes:** host/daemon availability and actual initial observation are verified. Later
   recurring receipts establish coverage, with explicit gaps; for heartbeat,
   observe multiple receipts on the **same PM agent**, not new agent launches. Tool
   permission prompts can block unattended reads indefinitely; missing approval
   is surfaced to the human, not treated as successful monitoring.

Evidence strings in the local helper are references, **not proof**. Unknown
mapping, access or retirement behavior stays unknown. Installation and local
tests can succeed while runtime activation remains blocked.
