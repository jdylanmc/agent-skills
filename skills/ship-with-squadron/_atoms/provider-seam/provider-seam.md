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
- `publish-change-request`;
- `observe-merge`.

Every adapter condition is preserved. Unsupported, missing, unauthenticated,
degraded, and unobserved provider state is not empty, clean, published, or
merged state.

Before a provider call, persist one stable publication intent keyed by the
manifest, configuration, issue, source, branch, and base. Reconcile that key
before any retry. Distinguish intent recorded, retryable degraded attempts, and
confirmed publication so crash recovery never creates a duplicate.
`published` or `found-existing` requires the provider-returned identifier; a
pushed branch or predicted identifier is not publication.

Only a complete terminal provider snapshot whose invocation key, provider,
repository, issue, change request, base branch, head branch/SHA, merge commit,
and valid observation time exactly reconcile to a confirmed publication proves
a human merge. Merge grants and worker reports are evidence, not authority.

The seam has no operation for merge, approve, enable auto-merge, accept risk,
force-push, close issue, or close change request. All are explicitly refused.
