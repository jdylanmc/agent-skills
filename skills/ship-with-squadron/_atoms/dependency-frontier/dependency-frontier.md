---
name: dependency-frontier
description: Classify the local dependency graph into stable ready, active, blocked, completed, failed, and deferred sets and select work only up to available fleet capacity.
level: atom
allowed-tools: ["execute"]
includes: ["ship-with-squadron/_atoms/dependency-frontier/dependency-frontier.mjs"]
composes: []
used-by: ["ship-with-squadron/_molecules/fleet-control/fleet-control.md"]
---

# Dependency Frontier

## Required Files

1. [Dependency frontier helper](./dependency-frontier.mjs)

Use the dependency frontier helper after manifest
confirmation and after every assignment, worker terminal transition, observed
human merge, or dependency-state change.

The helper preserves explicit reasons:

- ready: `all-blocking-dependencies-satisfied`;
- merge-blocked: `awaiting-observed-human-merge:<issue>`;
- completion-blocked: `awaiting-completion:<issue>`;
- active, completed, failed, and deferred retain their own reasons.

Dispatch only the stable manifest-order prefix that fits the available
top-level capacity. Nested specialist teams do not consume additional fleet
issue slots. A predecessor's implementation completion does not satisfy an
edge requiring `human-merge`; only observed provider state does.

This scheduler is local. Do not import, compose, or anticipate
`chart-a-course`, and do not depend on issue 25.
