---
name: fleet-control
description: Establish the confirmed closed manifest, local dependency frontier, durable control state, and exclusive fresh-worker ownership that drive one fleet.
level: molecule
includes: ["ship-with-squadron/_atoms/fleet-manifest/fleet-manifest.md","ship-with-squadron/_atoms/dependency-frontier/dependency-frontier.md","ship-with-squadron/_atoms/fleet-state/fleet-state.md","ship-with-squadron/_atoms/assignment-ownership/assignment-ownership.md"]
composes: ["ship-with-squadron/_atoms/fleet-manifest/fleet-manifest.md","ship-with-squadron/_atoms/dependency-frontier/dependency-frontier.md","ship-with-squadron/_atoms/fleet-state/fleet-state.md","ship-with-squadron/_atoms/assignment-ownership/assignment-ownership.md"]
used-by: ["ship-with-squadron/SKILL.md"]
allowed-tools: ["execute","read","search","task"]
---

# Fleet Control

## Required References

1. Build and explicitly confirm [Fleet manifest](../../_atoms/fleet-manifest/fleet-manifest.md).
2. Create and persist [Fleet state](../../_atoms/fleet-state/fleet-state.md).
3. Compute [Dependency frontier](../../_atoms/dependency-frontier/dependency-frontier.md).
4. Fill available capacity with [Assignment ownership](../../_atoms/assignment-ownership/assignment-ownership.md).
5. Persist, reread, recompute, and replenish after every material transition.

The manifest stays closed. Source revisions are reobserved before dispatch. The
scheduler stays local and dispatches nothing after cancellation or at-ceiling
budget exhaustion. State writes serialize through revision-safe exclusive
ownership. Each active issue, branch, and worktree has exactly one mutable
owner.
