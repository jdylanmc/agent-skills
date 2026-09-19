# Joe-mode CMUX runtime

On macOS, CMUX Maestro supplies interactive Copilot worker tabs and authenticated
ownership metadata. It does not supply a scheduler or a machine-readable worker
conversation channel.

## Required preflight

Require:

- a live CMUX caller with exact `CMUX_WORKSPACE_ID` and `CMUX_SURFACE_ID`;
- the installed `cmux-maestro-orchestrate` skill;
- the installed controller at
  `$HOME/Library/Application Support/CMUXMaestroPreview/Orchestration/bin/cmux-maestro-orchestrator`;
- `launch-settings` returning `ok`, `accountPinned`, `modelPinned`,
  `accountAvailable`, and `ready` as true.

Stop before creating a terminal when any requirement fails. Never substitute
the coordinator account, active GitHub CLI account, ambient credentials,
Copilot defaults, or a hardcoded model.

Separately check the placement capability in the installed skill:

```sh
CMUX_MAESTRO_SKILL="$HOME/Library/Application Support/CMUXMaestroPreview/Copilot/plugin/skills/cmux-maestro-orchestrate/SKILL.md"
grep -F "owning coordinator may arrange the exact returned worker" \
  "$CMUX_MAESTRO_SKILL"
```

If that clause is absent, workers may still launch beside the Project Manager,
but do not move their surfaces; report the degraded layout and direct the human
to update CMUX Maestro. This capability check does not weaken the blocking
identity and launch-settings preflight above.

Set the controller path once:

```sh
REPOSITORY_ROOT="$(git rev-parse --show-toplevel)" || exit 1
[ -n "$REPOSITORY_ROOT" ] || exit 1
CMUX_MAESTRO_ORCHESTRATOR="${CMUX_MAESTRO_ORCHESTRATOR:-$HOME/Library/Application Support/CMUXMaestroPreview/Orchestration/bin/cmux-maestro-orchestrator}"
"$CMUX_MAESTRO_ORCHESTRATOR" launch-settings
```

Stop if the repository root cannot be resolved; never pass an empty `--cwd`.
The installed CMUX Maestro integration is currently a macOS prerequisite.

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
descendants cannot escalate.

Maestro returns an exact `workerId` and `surfaceId`. Record both before moving
the surface. A launch acknowledgement proves only that an interactive session
started.

## Interactive boundary

The human owns worker terminal input. The Project Manager must not use
`send`, `send-key`, pasted prompts, terminal keystrokes, or any equivalent
automation to inject follow-ups. Programmatic follow-up for interactive workers
is unsupported.

Therefore:

- give each worker a complete first assignment;
- direct the human to the exact worker surface when a decision or follow-up is
  required;
- start a new bounded worker only for genuinely new independent work and within
  Maestro's live-worker limit;
- do not claim the Project Manager consumed a worker's answer unless the human
  supplied it back or a supported runtime channel produced verified evidence;
- do not infer task success from idle state, terminal output, process exit,
  restored UI, or a self-authored status label.

Use Maestro `status` for owned lifecycle evidence and CMUX metadata for human
attention. Neither replaces artifact verification required by the selected
Joe-mode route.

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

Restored CMUX panes are visual continuity only. Reconcile live Maestro, Git,
provider, and owner-board evidence before resuming work.
