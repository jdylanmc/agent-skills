---
name: fleet-state
description: Persist Bench queue, slot ownership, command receipts and publication identity under one local controller lock.
level: atom
allowed-tools: ["execute"]
includes: ["bench-squadron/_atoms/fleet-state/fleet-state.mjs","bench-squadron/_atoms/fleet-state/fleet-state.process.mjs","bench-squadron/_atoms/fleet-state/fleet-state.windows.ps1","bench-squadron/_atoms/fleet-state/fleet-state.windows.cs"]
composes: []
used-by: ["bench-squadron/_molecules/bench-control/bench-control.md"]
---

# Fleet State

## Required Files

[Local persistence](./fleet-state.mjs) uses bounded-run JSON state, fsync and
atomic rename under one explicit controller lock. This is Bench-owned state,
not another squadron's protocol. It assumes a local filesystem, not distributed
coordination. Keep state outside the delivery checkout and installed skills tree;
the CLI requires this separation from source discovery.

- [Platform process ownership](./fleet-state.process.mjs)
- [Windows native API host](./fleet-state.windows.ps1)
- [Windows Job Object implementation](./fleet-state.windows.cs)

State records normalized work, per-issue epochs/candidates/votes, reusable slot
owners and platform process trees, assignment budgets, command receipts, PR identity and
timestamped observations. A filesystem inbox admits operator commands without
concurrent state writers. Accepted/rejected receipts precede inbox removal.

Restart requires the same configuration and run identity. The controller verifies
prior process trees are released before reusing ownership. Missing launch identity
is uncertain, not idle. A live controller or unresolved group blocks recovery;
never remove its lock as a shortcut. Publication intent is durable before remote
effects and reconciles the original branch/PR after an interruption.

## Platform ownership

macOS/Linux use an explicitly owned POSIX process group. Windows uses a uniquely
named native Job Object with `KILL_ON_JOB_CLOSE` and no breakaway permission.
The target starts suspended, is assigned to the job, and only then resumes.
Normal SDK abort/stop runs first; bounded cancellation uses `TerminateJobObject`,
not `taskkill`, process-name matching, or a persisted PID kill.
Termination uses the original job handle retained by its native owner. Reopened
job handles are query-only. A stuck, already-established supervisor can be
terminated only through its still-owned native `ChildProcess` handle, never by
looking up its old PID.

Windows release requires kernel accounting to report no active job processes
(or the destroyed named job) and the original supervisor to have exited. Parent
exit, root-only exit, deadlines and late cancellation do not bypass descendant
cleanup. Cancelled launches are checked before creation and before resume.
Persisted job identity/spec support restart; a reused PID cannot redirect
termination to a new process. Missing identity, native API refusal or uncertain
cleanup retains ownership and fails closed.

The local PowerShell/C# host requires full-language Windows PowerShell and native
Job Object permission. Compilation uses a machine-local per-owner directory;
no global execution policy or environment configuration is changed. Normal
Windows `CreateProcess` descendants inherit the job. This is lifecycle
containment, not a hostile-code sandbox: trusted validation code must not
create unrelated processes through external brokers.

See Microsoft's [Job Objects documentation](https://learn.microsoft.com/windows/win32/procthread/job-objects)
for accounting, nested jobs and last-handle destruction semantics.
