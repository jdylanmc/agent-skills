# Local Orca owner/control state

`scripts/owner.mjs` is the deliberately small local control seam for the
single-control-host case. It stores the Orca subsection on the existing Joe
owner board at `<canonical git commonDir>/joe-owner.json` by default; callers
must reuse an existing exact board locator recorded in custody. The board is
private, uncommitted state shared by worktrees, not a new approval ledger.

The helper preserves unrelated top-level JSON fields and refuses missing
identity, symlinks, corrupt/incompatible state, mismatched repository/common
directory/control host/coordinator/Run, and ambiguous paths. Every update uses
the existing `<board>.write-lock` spelling, exclusive creation, restrictive
permissions, an fsynced temporary file, atomic rename, and directory flush.
Lock collision is `busy`; no lock is stolen or erased by age. A crash-stale
lock requires a human to inspect the owner process and explicitly remove only
that exact lock before retrying.

If the same board contains the existing Joe/Paseo `pm` subsection with
`mode: "enabled"` or a non-null `pm.lease`, Orca reports a foreign active
adapter and refuses inspect/init/resume/claim/guard. Human reconciliation must
release or transfer that controller through its existing contract first; the
shared write lock is storage coordination, not cross-adapter ownership.

## Operations

The helper is an ESM module and CLI. JSON examples use placeholders that the
caller must replace with actual native identities; they do not grant authority:

```sh
node scripts/owner.mjs inspect '{"repo":"...","commonDir":"/abs/.git","controlHost":"host","coordinator":"pm","run":"run"}'
node scripts/owner.mjs init '{"repo":"...","commonDir":"/abs/.git","controlHost":"host","coordinator":"pm","run":"run","mode":"session"}'
node scripts/owner.mjs resume '{"repo":"...","commonDir":"/abs/.git","controlHost":"host","coordinator":"pm","run":"run"}'
node scripts/owner.mjs claim '{"repo":"...","commonDir":"/abs/.git","controlHost":"host","coordinator":"pm","run":"run"}'
node scripts/owner.mjs assert '{"repo":"...","commonDir":"/abs/.git","controlHost":"host","coordinator":"pm","run":"run","token":"TOKEN"}'
node scripts/owner.mjs record '{"repo":"...","commonDir":"/abs/.git","controlHost":"host","coordinator":"pm","run":"run","token":"TOKEN","operationId":"op-1","intent":"dispatch task"}'
node scripts/owner.mjs reconcile '{"repo":"...","commonDir":"/abs/.git","controlHost":"host","coordinator":"pm","run":"run","operationId":"op-1","status":"accepted"}'
node scripts/owner.mjs release '{"repo":"...","commonDir":"/abs/.git","controlHost":"host","coordinator":"pm","run":"run","token":"TOKEN"}'
```

`inspect` is read-only and reports `uninitialized` without creating state.
`init` creates a paused board, is idempotent for identical configuration, and
refuses conflict/reset. Human `resume` requires no active pass or unresolved
operation and, for recurring mode, an exact verified job binding. `claim`
atomically creates a unique pass token; `assert` must succeed immediately
before every external mutation. `record` durably writes a stable operation
intent before its effect; same-ID replay is allowed only for the identical
intent. `reconcile` clears an accepted/failed/unknown operation after
observation. `release` invalidates the token and preserves history but is
blocked by unresolved effects. `pause`/`stop` close the new-dispatch gate
first, preserve workers and operations, and never cancel children.

This is local atomic exclusion only on one control host and a filesystem with
the required primitives. It cannot fence another clone with another board,
remote host, network filesystem without verified locking, or a remote worker.
Cross-host continuation is blocked. Callers still verify human authority,
native runtime identity, handoff, and remote effects; a local token is not
proof that a remote process stopped.
