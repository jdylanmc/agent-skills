# Native Orca runtime contract

Load [STATE.md](STATE.md) before activation or a pass. Its owner board and
atomic control operations are the only local serialization mechanism; native
Orca identity and human authority remain separate acceptance gates.

This adapter must load the installed, version-matched native guides before
running any runtime command:

- `ORCA skills get orchestration --full`
- `ORCA skills get orca-cli --full`, including its `references/automations.md`
- `ORCA <command> --help` for the exact installed command
- [Orca skills](https://www.onorca.dev/docs/cli/skills),
  [orchestration](https://www.onorca.dev/docs/cli/orchestration), and
  [automations](https://www.onorca.dev/docs/cli/automations)

Resolve the executable once for the actual stub and record it in the private
owner packet: `ORCA_CLI_COMMAND` if explicitly supplied; development
`ORCA_DEV_REPO_ROOT` resolves `orca-dev`; Linux outside a managed terminal
resolves `orca-ide`; otherwise bare `orca` is selected. `ORCA` in examples is prose, never a
shell variable, `eval`, spoofed environment, fallback binary, or remembered
flags. Prefer `--json`; use `--help` when a flag is unsupported. Missing
guides, executable, version evidence, or runtime blocks the operation: do not
install, start, or silently substitute.

## Activation and owner packet

Human kickoff must reconcile repository identity, existing controllers, Setup,
and active worktrees first. Ask only unset decisions: scope/readiness,
permissions and feature modes, merge gate, cadence/timezone/lifetime, and
child disposition. Invoke current [Setup](../setup/SKILL.md) completeness or
bootstrap only under that kickoff, preserving exact-file approvals.

Use one private durable owner record accessible to worktrees on the control host.
Verify access, readback, owner identity, repository/workspace mapping, and
actual exclusion; runtime identities belong in this private record, never
committed configuration. Remote workers report to its sole controller; do not
claim cross-host PM exclusion from a local file.
Initialize paused with the actual coordinator identity and selected mode.
Create or reuse one Run only after current native evidence, release/accept an
existing controller before binding, and complete the first pass immediately:
finish STATE's human initialization/resume, then enter RUN to dispatch eligible
work or report a precise blocker. RUN never initializes or resumes a board.
An explicitly requested
unsupported recurrence must remain blocked, not become session-only.

An Orca Run is a namespace/inbox, not a scheduler, lock, or repository-wide
fence. `run-use` changes binding, not exclusive ownership. A bounded pass
must claim and serialize through the same existing owner mechanism, observe an
owner/pass token or verified native fence, and release it on every normal exit.
An owner JSON file alone is not a lock. Before each external mutation recheck
paused/stopped/current ownership. Without a real fence, recurring mutations
remain disabled and the packet records the capability gap and human recovery.
No age-based lease stealing.

## Worker and permissions

Use only native `run-create`/`run-use`, task and worker operations, and current
injected task/dispatch identities. Load the native worker contract first.
`worker_done` with matching task and dispatch IDs and outcome succeeded/failed
settles automatically; do not task-update it completed. Process every FIFO
Delivery message before ack. Use `request-show` and the exact
`--retry-request` identity after unknown mutations. Accepted settlement comes
before reuse/retain/release; recover `release_pending`/unknown explicitly, never
with broad close/reset. Do not stop or abandon idle, timeout, null-status,
remote-loss, or unverifiable workers. Distinguish alive from useful progress,
and exact dispatch/host from a copied terminal handle. Apply the native
circuit breaker and Joe's one-fresh-work-attempt rule; permission denial is not
a retry.

Human-selected modes/features must propagate to every launch and be read back.
Prompt text, “inherit”, or a launch receipt without settings is not proof.
Unknown cross-provider equivalence blocks launch. Use runtime defaults for
model/effort unless explicitly selected; never add global settings or hidden
permissions.

## Issue placement and peer handoffs

Apply core Joe's [issue-centered swarms](../joe-mode/SKILL.md#issue-centered-swarms)
within the existing repository Run. A swarm does not create another Run or
controller per issue. Before launch, use the installed guides to inspect actual
placement, title and lineage capabilities; do not invent a grouping command,
workspace relationship or UI guarantee.

Choose the delivery owner's verified workspace as the primary delivery home.
Place read-only specialists there when supported and appropriate; pin their
candidate/evidence so a moving checkout cannot masquerade as the reviewed
commit. Additional writers use separately owned worktrees, explicitly associated
with this home. For every participant read back the actual execution host,
workspace/full worktree selector, Git path/branch/base, terminal, Task and
Dispatch IDs. Missing placement proof blocks writes, not permission to share
an index. Apply [WORKSPACE](../ship/WORKSPACE.md#orca-placement-when-used).

Use recognizable issue-and-role names, such as `<issue> Design`, `<issue> RED`,
`<issue> GREEN/Patch`, `<issue> Roast` and `<issue> Final verification`, only for
roles actually needed. Verify supported titles/lineage through native readback.
Where native grouping or naming is unavailable, retain exact explicit
associations on the [existing board](STATE.md#delivery-associations) and report
the UI limitation; do not claim agents were moved or grouped. Link shared
Shepherd/Discovery participation without relocating or cloning their services.

Use supported native messages for direct peer exchanges, including RED/GREEN
handoffs. Each exchange carries the delivery identity, sender and receiver's
exact Task/Dispatch IDs, immutable candidate commit and evidence references,
requested next action and integration owner. Preserve pending messages and
receiver-observed acknowledgment on the board; a send receipt is not acceptance
or Task settlement. PM receives boundary/decision escalations and coordinates
publication rather than relaying every test/commit exchange. Unsupported peer
messaging is an explicit capability gap routed through the existing owner, not
an invented terminal interaction. Peers cannot bypass the native settlement,
permissions, capacity, independent review or publication gates above.
