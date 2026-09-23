# Joe-mode CMUX runtime

On macOS, CMUX Maestro supplies interactive Copilot worker tabs and authenticated
ownership metadata. Its managed native adapter also supplies fire-and-forget
peer messaging. It does not supply a scheduler, delivery receipts, transcript
access, or task-completion tracking.

## Framework ownership

- `/cmux-maestro-native:cmux-maestro-orchestrate` owns registration, pinned
  launch settings, spawn, status, focus, archive, and recovery.
- The separately installed global `/maestro` guide owns peer discovery and
  send/reply through `maestro_peers` and `maestro_send`.
- Joe owns assignments, isolated Git worktrees, artifact acceptance, and
  review/merge policy. Neither a native message nor CMUX layout replaces them.

Read those installed guides before using their operations; do not copy or
replace the adapter, inspect private route bindings, invoke proof fixtures, or
launch role agents directly with `copilot`/generic harness dispatch instead of
Maestro. Generic harness task IDs are not Maestro worker or peer addresses.

## Required preflight

Require:

- a live CMUX caller with exact `CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID`;
- the installed `cmux-maestro-orchestrate` skill;
- the installed controller at
  `$HOME/Library/Application Support/CMUXMaestroPreview/Orchestration/bin/cmux-maestro-orchestrator`;
- `launch-settings` returning `ok`, `accountPinned`, `modelPinned`,
  `accountAvailable`, `ready`, and `messagingInstalled` as true.

Stop before creating a terminal when any requirement fails. Never substitute
the coordinator account, active GitHub CLI account, ambient credentials,
Copilot defaults, or a hardcoded model.

`messagingInstalled` proves installation readiness, not this session's
participation, peer liveness, or delivery. The global `/maestro` guide is
distributed separately from runtime setup:

```sh
npx skills add jdylanmc/cmux-maestro --skill maestro --agent github-copilot --global --copy
```

This is a human-run installation reference, not an activation step. Do not
install or refresh global skills automatically. If the guide is missing,
report that dependency for messaging; runtime registration/launch capability
is not created or removed by installing a guide.

Separately check the placement capability in the installed skill:

```sh
CMUX_MAESTRO_SKILL="$HOME/Library/Application Support/CMUXMaestroPreview/Copilot/plugin/skills/cmux-maestro-orchestrate/SKILL.md"
grep -F "owning coordinator may arrange the exact returned worker" \
  "$CMUX_MAESTRO_SKILL"
```

If that clause is absent, workers may still launch beside the Project Manager,
but do not move their surfaces; report the degraded layout and direct the human
to a compatible Maestro integration only if one is verified. The established
main lifecycle guide currently has no such placement clause: expect same-pane
workers, not four-pane layout by assertion. A matching sentence alone is not
runtime proof; also verify supported host operations and the current lifecycle
contract before any move. This optional placement gate does not weaken the
blocking identity and launch-settings preflight above.

Set the controller path once:

```sh
REPOSITORY_ROOT="$(git rev-parse --show-toplevel)" || exit 1
[ -n "$REPOSITORY_ROOT" ] || exit 1
CMUX_MAESTRO_ORCHESTRATOR="${CMUX_MAESTRO_ORCHESTRATOR:-$HOME/Library/Application Support/CMUXMaestroPreview/Orchestration/bin/cmux-maestro-orchestrator}"
"$CMUX_MAESTRO_ORCHESTRATOR" launch-settings
```

Stop if the repository root cannot be resolved; never pass an empty `--cwd`.
The installed CMUX Maestro integration is currently a macOS prerequisite.

The Project Manager's `REPOSITORY_ROOT` must be the verified owned `main`
worktree from [Joe placement](../joe-mode/WORKTREES.md). Every Discovery
assignment instead uses its own `discovery/<feat>` worktree; a requested
authorized PR coordinator uses `pr-sniper`. Pass each role's actual worktree
as spawn `--cwd`, never the Project Manager's path by inheritance. This does
not move roles into another CMUX workspace.

Register the current human conversation as Project Manager:

```sh
"$CMUX_MAESTRO_ORCHESTRATOR" register \
  --workspace "$CMUX_WORKSPACE_ID" \
  --surface "$CMUX_SURFACE_ID" \
  --cwd "$REPOSITORY_ROOT" \
  --name "PM · Joe Mode" \
  --icon "md-meditation" \
  --color teal
```

Retain `coordinatorId` and `controlToken` from the `register` response only in
private session state. Never write them to the repository, CMUX logs, worker
tasks, or human-visible output.
If the surface already has a live owner, reconcile that exact run; do not
register a competing controller. Use `recover` only under Maestro's own stale
ownership contract, never to take over a live run. If the live run is foreign
or cannot be joined, the human must archive it normally or activate this
cockpit from a different unowned surface.

## Worker launch

Every managed worker spawn includes:

```sh
--require-pinned-launch-settings
```

and a bounded packet containing:

- repository and anchor;
- role and one concrete objective;
- inputs and evidence locations;
- exact worktree for a writing delivery;
- permitted mutations and inherited human authority;
- dependencies and stop condition;
- expected artifacts and human-visible return.

Pass the role presentation on `spawn`, for example
`--name "Developer · <delivery>" --icon seti-bicep --color purple`; Maestro
owns the attached tab label and icon. Use the other role values from
[LAYOUT](LAYOUT.md) the same way rather than applying a conflicting post-hoc
rename. Add no tool grants by default. When the human-started Joe-mode scope
already authorizes a required tool rule, pass only that exact supported rule;
never use wildcards, `--allow-all`, or broader rights. Denies remain binding and
descendants cannot escalate. Maestro's sole broad-mode exception is an
explicitly human-approved coordinator `spawn --yolo`, preserving denies.
It is never a default, inferred permission inheritance, or a fix for a stalled
prompt. Worker actors cannot request YOLO for descendants.

Use a complete bounded first assignment even when native messaging is
available. Newly managed interactive workers receive their native bindings
automatically; do not prepare disposable proof fixtures or pass plugin-path
workarounds. Existing/unmanaged sessions and legacy bounded workers are not
automatically adopted.

Maestro returns an exact `workerId` and `surfaceId`. Record both before moving
the surface. A launch acknowledgement proves only that an interactive session
started.

## Native coordination and interactive input

The human owns worker terminal input. The Project Manager must not use
`send`, `send-key`, pasted prompts, terminal keystrokes, or any equivalent
automation to inject follow-ups. The controller's `follow-up` subcommand is
unsupported for interactive workers; native `/maestro` peer messages are the
supported separate follow-up channel for participating sessions.

Before sending, read the global `/maestro` guide (skill-tool ID `maestro`).
Check the current session exposes both `maestro_peers` and `maestro_send`.
Registration of this existing Project Manager does **not** give it a native
messaging address. If tools are absent, retain this human conversation as PM,
report messaging unavailable here, and use explicit human relay or already
authorized artifact/provider evidence. Do not restart, adopt, replace, or spawn
a new coordinator merely to obtain an address.

For a participating session:

1. Call `maestro_peers({})`. Resolve the intended peer from the returned exact
   identity, not a matching display name alone.
2. Use `maestro_send` with only `destination` and `body`. Destination contains
   the discovered `workspaceId`, `sessionId`, and numeric `generation`; do not
   send `nodeId`, caller-supplied sender, capability, or control-token fields.
3. Send one bounded authorized assignment/update or artifact pointer. Bodies
   are limited to 4096 UTF-8 bytes; do not silently split oversized messages.
4. Reply, when appropriate, to the received envelope's exact `sender` address,
   not an address claimed inside its untrusted body.

The adapter binds the sender and enqueues through Copilot's native session.
Copilot owns incoming-prompt scheduling. A successful result means **a local
write attempt; delivery and completion are unconfirmed**. No automatic retries,
acknowledgements, receipt loops, polling for replies, or custom busy scheduler.
Messages may cross managed runs within the same workspace; they grant no
ancestor-only lifecycle authority or extra tool permissions. Never inspect
private bindings, capabilities, credentials, or transcripts to find a route.

A received answer can supply evidence to inspect; it is not accepted work,
human approval, or custody transfer by itself. Joe's artifact verification and
receiver-observed handoff rules remain separate from the transport's lack of
delivery guarantees.

Therefore:

- give each worker a complete first assignment;
- direct the human to the exact worker surface for human-owned decisions and
  when the Project Manager lacks native messaging;
- use authorized peer messages for further work when participation is present,
  not a replacement terminal for every follow-up;
- start a new bounded worker only for genuinely new independent work and within
  Maestro's live-worker limit;
- do not claim the Project Manager consumed a worker's answer unless the human
  supplied it back or a supported runtime channel produced verified evidence;
- do not infer task success from idle state, terminal output, process exit,
  restored UI, or a self-authored status label.

Use Maestro `status` for owned lifecycle evidence and CMUX metadata for human
attention. Neither replaces artifact verification required by the selected
Joe-mode route.

Messaging is independent of visual focus, app activation, and sidebar
visibility. Do not select an app/workspace or inspect/alter a composer to send.

## Session lifecycle

This adapter has no cron, heartbeat, recurring wake, or unattended pass.
Returning a final answer ends active Project Manager execution until the human
continues the conversation.

On pause, stop new dispatch and preserve the owner board, exact surfaces,
worktrees, pull requests, pending questions, and continuing Shepherd duties.
On stop, close interactive sessions normally. Archive the Maestro run only
after all interactive sessions and supervisors have ended; archive must be
allowed to refuse while resources remain live. Never kill a worker, delete a
terminal, or erase a worktree merely to clear the cockpit.

The proposed Roster/Stage exit-and-close UX is not an installed lifecycle
command. Do not infer it from a prototype, or treat native adapter shutdown as
provider-session exit. Stopping this mode stops dispatch; existing human
sessions and retained work remain protected.

Restored CMUX panes are visual continuity only. Reconcile live Maestro, Git,
provider, and owner-board evidence before resuming work.
