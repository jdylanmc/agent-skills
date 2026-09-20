---
name: joe-mode-cmux
description: "Human-only session Joe-mode cockpit in CMUX. Reconcile one repository controller, launch pinned Maestro workers, and arrange PM, Discovery, stacked developers, and support without claiming unattended execution."
disable-model-invocation: true
user-invocable: true
---

# Joe-mode CMUX

Run Joe-mode as a visible, interactive CMUX cockpit. This is an adapter around
[Joe-mode](../joe-mode/SKILL.md), not another project-management policy or
controller. The human-authored [intent](intent.md) defines its purpose.

Read [LAYOUT](LAYOUT.md) before changing CMUX topology and [RUNTIME](RUNTIME.md)
before registering or spawning through Maestro. Apply Joe-mode's
[runtime guidance](../joe-mode/RUNTIME.md), shared
[team contract](../joe-mode-paseo/TEAM.md), and
[agent lifecycle](../squadron/LIFECYCLE.md). Independent writing deliveries
still follow [worktree placement](../ship/WORKSPACE.md), and pull-request
handoffs still follow [delivery readiness](../ship/DELIVERY.md) and
[Shepherd observation](../shepherd/OBSERVATION.md).

## Entry and ownership

**Human activation only.** Installing, discovering, restoring, or mentioning
this package does not start it. Once activated, it remains the session's
Joe-mode presentation until the human pauses, stops, or re-anchors it.

Resolve the repository, anchor, selected backlog, scope, exclusions, tracker,
and human authority exactly as Joe-mode requires. Reconcile the same repository
owner board with session Joe-mode and
[Joe-mode Paseo](../joe-mode-paseo/SKILL.md) and
[Joe-mode Orca](../joe-mode-orca/SKILL.md) before registering CMUX or
dispatching. There is one logical controller per repository across these
entrypoints. Join the existing controller or obtain observed release and
acknowledged transfer. Unknown ownership blocks activation.

The invoking conversation remains Project Manager and owns the human
conversation. Do not invoke another Joe-mode controller. Use Joe-mode's current
local routing sections directly under this adapter's human grant.

## Activate the cockpit

1. Verify the current directory is the selected repository root or resolve it
   explicitly. Read its guidance and current owner board.
2. Verify exact caller identity with CMUX, then run the Maestro
   `launch-settings` preflight from [RUNTIME](RUNTIME.md). Any missing,
   unavailable, or unpinned setting stops activation before terminal creation.
3. Register the exact caller workspace and surface as `PM · Joe Mode`, using
   `md-meditation` (`󱅻`) in teal. Keep the returned controller identity and
   token private.
4. Inspect the existing workspace tree. Reconcile the four areas from
   [LAYOUT](LAYOUT.md) additively when [RUNTIME](RUNTIME.md)'s placement
   capability passes, without creating a new workspace/window, stealing focus,
   or mutating an unowned surface. Otherwise keep managed workers beside the
   Project Manager and report the degraded layout.
5. Rename the repository workspace and publish an `active` Joe status only
   after ownership, CMUX identity, and Maestro readiness are verified.
6. Complete one useful bounded Joe-mode pass now: refresh the selected work,
   launch needed roles, and report actual dispatch, blockers, or human waits.
   A layout alone is not an activated team.

## Place useful roles

Keep one interactive Discovery owner when the anchor has unsettled product,
architecture, requirements, or planning questions. Its blue compass surface
stays in the Discovery pane while waiting for the human when placement is
supported; otherwise it remains beside the Project Manager. Do not create
several workers asking competing questions.

Launch developers only for selected non-overlapping delivery assignments.
Every launch uses Maestro's required pinned settings and a complete first task.
When [RUNTIME](RUNTIME.md)'s placement capability is verified, move the
returned exact surface into the developer pane and stack additional developers
there as tabs. Otherwise leave workers beside the Project Manager and report
the degraded layout. Name each worker for its delivery at spawn. Sharing a pane
does not permit sharing a writing worktree.

Launch one green shield-check Shepherd while accepted pull-request duties
exist. Put it in Support when placement is supported; otherwise leave it beside
the Project Manager. Support may also display review, test, log, or preview
surfaces. Do not create an idle Shepherd merely to fill the pane.

Respect Joe-mode's six developer slots by default and Maestro's stricter
eight-live-worker workspace bound. Effective developer capacity is the smaller
of six and `8 - live managed non-developer workers - retained worker
resources`. Reserve capacity for Discovery, Shepherd, and any required
interactive reviewer before filling the developer pane. Non-agent test, log,
and preview surfaces do not consume the Maestro worker bound. Finishing an
initial task does not free an open interactive session or retained terminal.

## Route work through Joe-mode

Use Joe-mode's backlog, Discovery, planning, Ship, Patch, Refactor, Roast,
Verify, and Shepherd routes without duplicating them here. Preserve their human
decisions, publication gates, independent review, permissions, ownership,
worktrees, and merge boundaries.

The cockpit changes presentation, not authority:

- role names, icons, colors, statuses, progress, and logs never prove success;
- worker launch does not prove task completion;
- terminal exit does not prove accepted work;
- CMUX restoration does not prove live supervision;
- the adapter does not grant tracker writes, approval, merge, production, or
  destructive authority.

Use CMUX status and logs for verified coordination events. Notify the human only
for decisions, material blockers, or pull requests ready for final review.
Keep routine chatter in role surfaces.

## Reconcile and continue

Use Maestro `status`, the Joe owner board, Git/provider state, and actual
artifacts to reconcile outcomes. Follow [RUNTIME](RUNTIME.md)'s interactive
boundary: the Project Manager cannot inject worker follow-ups or silently read
their conversations. When a worker needs human input, identify its exact tab
and surface. When its result must affect routing, obtain that result through a
supported channel or the human before claiming it was consumed.

Continue bounded Joe-mode passes while this human conversation remains active.
Do not promise work between turns or after the session ends. If unattended
recurring operation is requested, stop and offer the separately authorized
Paseo or Orca adapter with its own verified wake contract; never invent CMUX scheduling.

On pause or stop, follow Joe-mode ownership transfer and Maestro lifecycle
rules. Preserve active deliveries and Shepherd custody. Close interactive
sessions normally before archive; never kill processes, delete terminals, or
discard work to make the UI look clean.
