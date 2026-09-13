# Runtime and orchestration

Joe-mode targets GitHub Copilot and uses the actual tools exposed by the current harness. Tool names and capabilities are runtime facts, not assumptions inherited from another agent product.

## Skills and workers

- Invoke an available skill through the harness's skill tool. If the local skill is not registered and repository instructions permit direct loading, read its local `SKILL.md` and required references; do not substitute an upstream version or search a Claude plugin installation.
- Use the exposed agent-dispatch tool for bounded workers. In a Copilot session exposing `task`, `read_agent`, and `write_agent`, use those tools according to their current schemas. Other installations may expose different names or no worker support.
- Use background agents for genuinely concurrent discovery, planning, and delivery. Continue independent coordination while they work; consume notifications rather than polling for reassurance. Resume the known worker for follow-up when supported.
- Respect configured model preferences and runtime defaults. Do not hardcode model IDs, reasoning effort, or unverified context-window sizes from imported skills.
- Track work with session state/todo tools when available, otherwise a unique artifact in the session workspace or OS temporary directory. Do not create `TODO.md` in the repository as a silent fallback.

If required delegation, independent review, or monitoring is unavailable, name the missing capability and request direction for the affected path. Do not claim heavy orchestration while secretly doing every role inline, install plugins automatically, or fabricate a background worker. Other supported work can continue.

## Lifecycle

A background launch is not proof the worker started successfully. Confirm the actual agent ID/state and reconcile its first result or observation before claiming ownership transferred. In particular, Ship's Shepherd handoff requires a real monitor that has observed the PR.

The controller's human-facing conversation remains available while workers run. Questions from workers are queued with their owner and affected scope. Only actual human responses can clear human-decision gates.

Use the harness's documented notification/wait contract. Some runtimes wake a controller on completion; others require an explicit event wait. Do not copy `Task`, `TodoWrite`, `/clear`, `/compact`, or another runtime's wait syntax into a tool call unless that interface actually exists.

Joe-mode is session-long, not an installed service. A board on disk does not schedule work. On runtime loss, report the observation gap when resuming, inspect surviving workers and PRs, and explicitly restart only missing ownership. Persistent services require separate authorization and verified runtime support.

## Isolation and shared resources

Give each independent writing worker its own authorized workspace. Discovery/research sources remain read-only; POC writes stay in its agreed scratch environment. Domain/ADR writers do not edit the checkout an implementer is currently using.

Ship owns its delivery branch, integration queue, and nested workers. Joe-mode owns non-overlapping delivery groups and planning outputs, not cherry-picks into those branches. Transfer artifacts and permissions through the owner, with one writer/integrator per shared mutable target.

Read the repository's actual worktree guidance before creating any workspace. Do not infer that being in an existing linked worktree makes it safe for several writers. Never clean up a worker's branch, worktree, or process merely because its last message said "done."

## Copilot-specific restraint

Do not create `.claude/`, `CLAUDE.md`, Claude hooks, or Claude permission configuration to make Joe-mode work. Honor any repository guidance already present, but do not privilege Claude files over the instructions the current Copilot harness actually supplies.

Provider access uses the configured GitHub CLI or Azure DevOps integration and authenticated identity. A Copilot subscription, Git author email, or an available shell is not proof of tracker permissions.
