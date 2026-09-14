# Runtime and orchestration

Joe-mode targets GitHub Copilot using tools exposed by the current harness. Tool names and capabilities are runtime facts, not assumptions from another agent product.

## Skills and workers

- Use [Doctrine's catalog and metadata selection](../doctrine/SKILL.md) to assign standards without reading full bodies in the orchestrator. Follow [the common packet contract](../doctrine/APPLY.md): preserve scoped operator choices, add required IDs, and send work plus ID/reason/path/digest metadata. The applying sub-agent loads the full text and reports what it actually used.
- Invoke available skills through the harness's skill tool. If a local skill is unregistered and repository instructions permit direct loading, read its local `SKILL.md` and required references; do not substitute an upstream version or search a Claude plugin installation.
- Use the exposed agent-dispatch tool for bounded workers. In a Copilot session exposing `task`, `read_agent`, and `write_agent`, use those tools according to their current schemas. Other installations may expose different names or no worker support.
- Use background agents for genuinely concurrent discovery, planning, and delivery. Coordinate independent work meanwhile; consume notifications rather than polling for reassurance. Resume the known worker for follow-up when supported.
- Respect configured model preferences and runtime defaults. Do not hardcode model IDs, reasoning effort, or unverified context-window sizes from imported skills.
- Track work with session state/todo tools when available, otherwise a unique artifact in the session workspace or OS temporary directory. Do not create `TODO.md` in the repository as a silent fallback.

If required delegation, independent review, or monitoring is unavailable, name the gap and request direction for the affected path. Do not claim heavy orchestration while secretly doing every role inline, install plugins automatically, or fabricate background workers. Other supported work can continue.

## Lifecycle

A background launch does not prove the worker started successfully. Confirm actual agent ID/state and reconcile its first result or observation before claiming ownership transferred. Every delivery route's Shepherd handoff requires a real monitor that has observed the PR.

Keep the controller's human-facing conversation available while workers run. Queue worker questions with their owner and affected scope. Only actual human responses clear human-decision gates.

Use the harness's documented notification/wait contract. Some runtimes wake a controller on completion; others require an explicit event wait. Do not copy `Task`, `TodoWrite`, `/clear`, `/compact`, or another runtime's wait syntax into a tool call unless that interface actually exists.

Joe-mode is session-long, not an installed service. A board on disk does not schedule work. When resuming after runtime loss, report the observation gap, inspect surviving workers and PRs, and explicitly restart only missing ownership. Persistent services require separate authorization and verified runtime support.

## Isolation and shared resources

Give each independent writer its own authorized workspace. Discovery/research sources stay read-only; POC writes stay in its agreed scratch environment. Domain/ADR writers must not edit an active implementer's checkout.

The selected Ship, Patch, or Refactor owner owns its delivery branch, integration queue, and nested workers. Joe-mode uses Squadron for distinct assignments and owns their non-overlapping coverage, not cherry-picks into their branches. Transfer artifacts and permissions through the owner, with one writer/integrator per shared mutable target. Serialize Changelog updates through that integrator.

Read actual repository worktree guidance before creating any workspace. An existing linked worktree is not automatically safe for several writers. Never clean up a worker's branch, worktree, or process merely because its last message said "done."

Every PR-producing lane requires `worktrees`, including domain/ADR and documentation deliveries. Route workspace operations to the owning workflow's [workspace procedure](../ship/WORKSPACE.md); doctrine selection does not create a workspace or authorize publication.

## Copilot-specific restraint

Do not create `.claude/`, `CLAUDE.md`, Claude hooks, or Claude permission configuration to make Joe-mode work. Honor any repository guidance already present, but do not privilege Claude files over the instructions the current Copilot harness actually supplies.

Provider access uses the configured GitHub CLI or Azure DevOps integration and authenticated identity. A Copilot subscription, Git author email, or an available shell is not proof of tracker permissions.

Give all commit-producing workers the [shared commit-message policy](../setup/COMMIT-STYLE.md). It applies independently of chat style, respects repository/operator requirements, and authorizes no additional Git actions. Keep it with the library; do not install it into global Copilot configuration as a side effect.

Follow [invocation and communication contracts](../setup/INVOCATION.md). Prefer
terse exact worker messages without changing the human's chat mode. Caller
restrictions still apply when the runtime ignores invocation metadata.

Preserve objective-start evidence, parent/descendant ownership, cycle state,
and deduplicated report events in existing session storage. Status Report uses
available runtime events; missing objective timing/tool counts stay unavailable.
Do not install a recorder or infer a complete fleet from a partial tool view.
