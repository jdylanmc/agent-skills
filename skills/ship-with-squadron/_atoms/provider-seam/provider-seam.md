---
name: provider-seam
description: Constrain provider adapters to allow-listed issue reads, change-request publication, and human-merge observation while preserving degradation and preventing duplicate publication.
level: atom
allowed-tools: ["execute","read"]
includes: ["ship-with-squadron/_atoms/provider-seam/provider-seam.mjs"]
composes: []
used-by: ["ship-with-squadron/_molecules/candidate-delivery/candidate-delivery.md"]
---

# Provider Seam

## Required Files

1. [Provider seam helper](./provider-seam.mjs)

Keep provider-specific behavior behind an adapter whose authority comes from
the persisted manifest and provider-configuration digests, never call input.
Use the provider seam helper to allow only:

- `read-issue`;
- `read-issue-set`;
- `publish-change-request`;
- `observe-merge`;
- `observe-change-request-revision`.

The revision operation is a narrow read-only receipt for one already-recorded
publication. Its exact schema binds invocation, stable provider key, provider,
repository, issue, change request, base branch/SHA, head branch/SHA, and
observation time. Unknown fields, wildcard paths, and generic API escape hatches
are rejected.

Every adapter condition is preserved. Unsupported, missing, unauthenticated,
degraded, and unobserved provider state is not empty, clean, published, or
merged state.

Before a provider call, persist one stable logical publication identity keyed
by manifest, configuration, issue, source, and branches, plus a separate
base/head observation for every revision. Reconcile that key before any retry.
An existing change request is reobserved after revision mutation and must return
the same provider identifier; stale confirmation is never current and crash
recovery never creates a duplicate. Every persisted provider attempt retains
the complete normalized invocation and publication identity, and recovery stops
at the manifest retry ceiling.
`published` or `found-existing` requires the provider-returned identifier; a
pushed branch or predicted identifier is not publication.

Only a complete terminal provider snapshot whose invocation key, provider,
repository, issue, change request, base branch/SHA, head branch/SHA, merge commit,
and valid observation time exactly reconcile to a confirmed publication proves
a human merge. The normalized persisted record has one exact schema and unique
publication/merge identity. Merge grants and worker reports are evidence, not
authority.

The seam has no operation for merge, approve, enable auto-merge, accept risk,
force-push, close issue, or close change request. All are explicitly refused.
