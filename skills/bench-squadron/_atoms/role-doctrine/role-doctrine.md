---
name: role-doctrine
description: Dispatch fresh supported Copilot SDK sessions with exact models, full verified doctrine sources and role-scoped custom file tools.
level: atom
allowed-tools: ["read","execute"]
includes: ["bench-squadron/_atoms/role-doctrine/role-doctrine.mjs","bench-squadron/_atoms/role-doctrine/role-doctrine.worker.mjs","bench-squadron/_atoms/role-doctrine/role-doctrine.smoke.mjs","bench-squadron/_atoms/role-doctrine/role-doctrine.runtime.mjs"]
composes: []
used-by: ["bench-squadron/_molecules/bench-control/bench-control.md"]
---

# Role Doctrine

## Required Files

- [Dispatch and file-tool boundary](./role-doctrine.mjs)
- [SDK session worker](./role-doctrine.worker.mjs)
- [Explicit import/live smoke](./role-doctrine.smoke.mjs)
- [Pinned external dependency setup and resolution](./role-doctrine.runtime.mjs)

The operator selects applicable doctrine IDs and exact implementation/review
model IDs. Each dispatch reads complete doctrine source text, verifies its
canonical manifest SHA-256 digest, includes the full text in the new session and
records IDs/digests separately from model, role, context and slot identity.
Unknown or unavailable models fail explicitly; no implicit fallback or automatic
generation policy substitutes for operator selection.

The supported `@github/copilot-sdk` client uses stdio and empty mode with an
explicit per-session base directory. The checked-in skill-local package/lock
are installed only by the explicit setup command into a machine-local cache
outside the skills tree. Startup verifies the source/cached manifest and lock
digests, SDK version and resolved package location; missing/stale setup fails
actionably. Package exports resolve from that cache with `createRequire.resolve`
and dynamic import, never `NODE_PATH` or a source-tree dependency fallback.
Every
assignment calls `createSession`, never resume or model-switch. Built-in and
MCP tools, discovered configuration and nested agents are disabled. An explicit
permission handler rejects ambient permission requests. Custom tools read only
authorized source paths; implementation additionally writes/deletes those files.
Legitimate dot paths such as `.github/workflows/` and `.gitignore` are available
only under the operator's explicit prefixes. Traversal, Git/control-state and
known credential locations remain denied, including beneath an otherwise
authorized directory. Native canonical paths are checked; symlinks (including
dangling links/junctions) and hard-linked files are denied. Directory listings
apply the same boundary rather than hide every dot entry. Review tools cannot
edit, run commands or access remote providers.

The worker sends `{prompt: ...}` MessageOptions and observes actual `session.idle`
independently of returned JSON, calls
SDK abort/stop, and exits. Its parent retains the slot until the entire recorded
process tree is released: a POSIX process group on macOS/Linux, or a native
Windows Job Object. Windows workers exchange bounded assignment/result messages
over redirected pipes; they have the same slot/context owner, not another pool.
Cancellation requests and timeouts alone never release capacity. POSIX uses
bounded TERM/KILL attempts; Windows first requests SDK cleanup, then terminates
only the owned job and checks kernel process accounting plus supervisor exit.
uncertain release retains ownership and fails the run closed. On controller
disconnect the worker attempts cleanup, while restart independently checks the
persisted platform owner. No session raw trace is copied into committed files.

The installed version's types and lifecycle implementation are the API authority.
Deterministic worker doubles prove controller policy, not live SDK capability.
The separately authorized smoke distinguishes import success, authentication,
advertised-model selection, idle observation and cleanup errors. It selects
only from the actual SDK model listing, sends one tiny zero-tool request, and
uses a 60-second parent deadline plus bounded cleanup. It never publishes work
or tries alternative authentication on failure.
