---
name: assignment-ownership
description: Enforce one mutable owner per issue branch and worktree, fresh worker contexts, assignment generations, and validated continuation through orchestration-handoff.
level: atom
allowed-tools: ["read","task"]
includes: ["ship-with-squadron/_atoms/assignment-ownership/assignment-ownership.mjs"]
composes: []
used-by: ["ship-with-squadron/_molecules/fleet-control/fleet-control.md"]
---

# Assignment Ownership

## Required Files

1. [Assignment ownership helper](./assignment-ownership.mjs)

Every dispatch carries one issue, one fresh worker context, one isolated branch,
one isolated worktree, the confirmed criteria and boundary, and an explicit
return contract. Workers never select more backlog work.

Use the assignment ownership helper to reject concurrent
ownership of the same issue, branch, or worktree and reuse of any worker
context. Record monotonically increasing assignment generations.

For stalled, exhausted, timed-out, or crashed workers:

1. safely stop or recover owned processes;
2. capture committed and uncommitted state;
3. invoke the required `orchestration-handoff` skill;
4. reread its actual artifact and validate the invocation identity, successful
   persistence status, `schema_version: 1`, exact path, SHA-256 digest, reread
   verification, required orchestration fields, and all consolidated brief
   sections;
5. dispatch a fresh continuation context on the same owned branch and worktree.

The brief contains `GOAL`, `SCOPE`, `CONTEXT`, `ACCEPTANCE`, `VERIFY`,
`TIMEBOX`, `FORBIDDEN`, `REPORT`, and `STANDING`. Evidence and artifacts carry
forward; hidden reasoning and prior context do not.
