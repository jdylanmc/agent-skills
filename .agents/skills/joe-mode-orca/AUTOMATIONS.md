# Opt-in recurring Orca automations

Recurrence is optional and separately authorized. Native automation creation
must be disabled first, then inspected, owner-bound, observed, and explicitly
enabled. Configured state, initial observation, and verified recurrence are
different facts.

## Safe setup

1. Reconcile the private Joe owner packet and exact existing automation IDs.
   Never create a second controller or accept an ambiguous match.
2. Use `orca automations create` with `--disabled`, an exact existing
   `--workspace`, `--workspace-mode existing`, and the recorded provider,
   trigger, timezone, prompt, and `--reuse-session` choice. `--repo` creates
   a new worktree per run and is unsuitable for an ongoing PM tick.
3. Read back `orca automations show <id>` and verify the owner, repository,
   workspace, trigger, timezone, provider, disabled state, and reuse-session
   setting. A create receipt alone is not proof.
4. Verify owner binding, supported permission transition, and the next wake
   while disabled. Enable only after the human's explicit recurrence decision,
   then read back again and observe the first run.

`--reuse-session` reuses the automation's previous live session, not
necessarily the human's current PM chat. If that session is gone, Orca falls
back to a fresh terminal. That transition must be verified against the owner
record; an unexpected identity fails closed and must not create another Run or
controller. If owner binding, permission readback, host mapping, or recurrence
cannot be proven, leave it disabled and report the exact missing capability.

## Run and pause

At each wake, reconcile the same owner, Run, workspace, tasks, dispatches,
permissions, and pending operations before loading [RUN.md](RUN.md). A wake
may continue known work; it never repeats intake, starts a duplicate repair,
or silently revives a stopped team. `orca automations run <id>` is an
explicit operation, not evidence of successful worker execution; observe the
run and resulting task/dispatch.

On human pause, close or settle active dispatches first, disable only exact
owned automation IDs with `orca automations edit <id> --disabled`, and read
back the disabled state. Reconcile every issued operation, preserve output,
worktrees, branches, and history, and record child disposition. On stop,
remove only an exact unneeded owned automation after preserving its history
and verifying removal. Never use broad cleanup, reset, timers, or shell
sleep as a scheduler. No auto-resume after pause or stop.
